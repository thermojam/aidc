import {useRef, useState, type Dispatch, type RefObject, type SetStateAction} from "react";
import {Channel, invoke} from "@tauri-apps/api/core";
import {safeDiagnostic, type OperationError} from "../../OperationErrors";
import {retryTarget, type ModelSource} from "../../modelSource";

type StreamEvent =
    | { event: "delta"; data: { attempt_id: number; seq: number; text: string } }
    | { event: "end"; data: { attempt_id: number; status: string; error_code: string | null; request_id: string | null; http_status: number | null } };
type Options = {
    conversationId: number;
    activeConversation: RefObject<number>;
    currentModelSource: RefObject<ModelSource>;
    history: {attempts: {assistant_id: number; model_id: string | null}[]; contexts: {assistant_id: number; context: {model_source: ModelSource}}[]};
    setPrompt: Dispatch<SetStateAction<string>>;
    clearContext: () => void;
    reload: () => Promise<void>;
    refreshScheduledRuns: () => Promise<void>;
    confirmAction: (message: string) => Promise<boolean>;
    clear: (operation: string) => void;
    report: (operation: string, reason: unknown) => void;
};

export function useChatGeneration({conversationId, activeConversation, currentModelSource, history, setPrompt,
    clearContext, reload, refreshScheduledRuns, confirmAction, clear, report}: Options) {
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState("");
    const [streamAnnouncement, setStreamAnnouncement] = useState("");
    const [retryError, setRetryError] = useState<{assistantId: number; error: OperationError} | null>(null);
    const generationRequest = useRef(0);

    async function runGeneration(command: string, args: Record<string, unknown>, restorePrompt?: string, retrySource?: "simpleclaw" | "ollama"): Promise<boolean> {
        if (busy || (retrySource === undefined && (currentModelSource.current === "ollama") !== (command === "start_ollama_generation"))) return false;
        const request = ++generationRequest.current;
        setBusy(true);
        clear("runGeneration");
        setDraft("");
        setStreamAnnouncement("");
        const channel = new Channel<StreamEvent>();
        let lastSeq = 0;
        let pending = "";
        let frame = 0;
        let ended = false;
        channel.onmessage = (message) => {
            if (ended || request !== generationRequest.current || conversationId !== activeConversation.current) return;
            if (message.event === "delta") {
                if (message.data.seq === lastSeq + 1) {
                    lastSeq = message.data.seq;
                    pending += message.data.text;
                    if (!frame) frame = requestAnimationFrame(() => {
                        if (request !== generationRequest.current || conversationId !== activeConversation.current) return;
                        const chunk = pending;
                        pending = "";
                        setDraft((current) => current + chunk);
                        frame = 0;
                    });
                } else if (message.data.seq > lastSeq + 1) {
                    reload().catch((reason) => report("history", reason));
                }
            } else {
                ended = true;
                if (frame) cancelAnimationFrame(frame);
                const tail = pending;
                pending = "";
                setDraft((current) => current + tail);
                setBusy(false);
                if (["failed", "interrupted", "stopped"].includes(message.data.status)) setStreamAnnouncement(message.data.status === "stopped" ? "Ответ остановлен. Частичный текст сохранён." : "Ответ прерван. Частичный текст сохранён; подробности у ответа.");
                void reload().then(() => {
                    if (request === generationRequest.current && conversationId === activeConversation.current) setDraft("");
                }).catch((reason) => report("history", reason));
                refreshScheduledRuns().catch((reason) => report("scheduledRuns", reason));
            }
        };
        try {
            await invoke<number>(command, {conversationId, ...args, onEvent: channel});
            if (request !== generationRequest.current || conversationId !== activeConversation.current) return false;
            await reload().catch((reason) => report("history", reason));
            return true;
        } catch (reason) {
            if (request !== generationRequest.current || conversationId !== activeConversation.current) return false;
            if (frame) cancelAnimationFrame(frame);
            setBusy(false);
            if (restorePrompt !== undefined) setPrompt((current) => current || restorePrompt);
            clearContext();
            if (retrySource !== undefined && typeof args.assistantId === "number") {
                const diagnostic = safeDiagnostic("Повтор ответа", reason);
                setRetryError({assistantId: args.assistantId, error: {...diagnostic, id: `retry:${args.assistantId}`, area: diagnostic.connection ? "connection" : "send", conversation: conversationId,
                    message: diagnostic.connection ? "Ключ не принят. Откройте настройки подключения перед повтором." : "Не удалось начать повтор. Проверьте состояние подключения и попробуйте снова."}});
            } else report("runGeneration", reason);
            return false;
        }
    }

    async function retry(assistantId: number) {
        const attempt = history.attempts.find((item) => item.assistant_id === assistantId);
        if (!attempt) return;
        const target = retryTarget(attempt, history.contexts.find((item) => item.assistant_id === assistantId)?.context.model_source);
        if (target.source === "simpleclaw" && target.model !== "local-mock" && !await confirmAction("Повторить платный запрос? Предыдущий запрос мог быть принят и списан. Расход при обрыве неизвестен.")) return;
        setRetryError(null);
        await runGeneration(target.command, {assistantId, modelId: target.model}, undefined, target.source);
    }

    async function stop() {
        try {
            await invoke("stop_generation");
        } catch (reason) {
            report("stop", reason);
        }
    }

    return {busy, draft, setDraft, runGeneration, retry, retryError, streamAnnouncement, stop};
}
