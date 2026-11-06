import {useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import {Channel, invoke} from "@tauri-apps/api/core";
import "./style.css";

type Message = { id: number; parent_id: number | null; role: "user" | "assistant"; content: string; status: string };
type Attachment = { message_id: number; name: string; size: number; sha256: string };
type PendingAttachment = { id: number; name: string; size: number; sha256: string; preview: string };
type ContextMessage = { role: string; content: string; source_message_id: number | null; attachment_ids: number[] };
type ContextPreview = {
    model_id: string;
    catalog_fetched_at: number | null;
    input_rubles_per_million: number | null;
    output_rubles_per_million: number | null;
    messages: ContextMessage[];
    omitted_exchanges: number;
    bytes: number;
    warning: string
};
type CatalogModel = {
    id: string;
    name: string;
    input_rubles_per_million: number | null;
    output_rubles_per_million: number | null
};
type ModelCatalog = { fetched_at: number; models: CatalogModel[] };
type ModelCategory = { model_id: string; category: string; source: string; updated_at: number };
type History = {
    messages: Message[];
    attachments: Attachment[];
    active_leaf_id: number | null;
    contexts: { assistant_id: number; context: ContextPreview }[];
    attempts: { assistant_id: number; model_id: string | null; server_response_id: string | null;
        server_request_id: string | null; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
        error_code: string | null; http_status: number | null }[]
};
type StreamEvent =
    | { event: "delta"; data: { attempt_id: number; seq: number; text: string } }
    | { event: "end"; data: { attempt_id: number; status: string; error_code: string | null; request_id: string | null; http_status: number | null } };
type Theme = "system" | "light" | "dark";

const statusLabel: Record<string, string> = {
    interrupted: "Ответ прерван",
    stopped: "Остановлено",
    failed: "Ошибка",
    streaming: "Ответ продолжается",
};
const categoryLabel: Record<string, string> = {
    thinking: "Мышление", speed: "Скорость", economy: "Экономия", other: "Остальные"
};
const categoryOrder = ["thinking", "speed", "economy", "other"];

function App() {
    const [history, setHistory] = useState<History>({
        messages: [],
        attachments: [],
        active_leaf_id: null,
        contexts: [],
        attempts: []
    });
    const [prompt, setPrompt] = useState("");
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState("");
    const [error, setError] = useState("");
    const [backups, setBackups] = useState<string[]>([]);
    const [selectedBackup, setSelectedBackup] = useState("");
    const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
    const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
    const [categories, setCategories] = useState<ModelCategory[]>([]);
    const [catalogError, setCatalogError] = useState("");
    const [modelId, setModelId] = useState("local-mock");
    const [key, setKey] = useState("");
    const [keySaved, setKeySaved] = useState(false);
    const [contextPreview, setContextPreview] = useState<ContextPreview | null>(null);
    const [previewSignature, setPreviewSignature] = useState("");
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem("appearance");
        return saved === "light" || saved === "dark" ? saved : "system";
    });

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("appearance", theme);
    }, [theme]);

    async function reload() {
        setHistory(await invoke<History>("list_history"));
    }

    useEffect(() => {
        reload().catch((reason) => setError(String(reason)));
        invoke<string[]>("list_backups").then(setBackups).catch((reason) => setError(String(reason)));
        invoke<ModelCatalog | null>("list_models").then(setCatalog).catch((reason) => setCatalogError(String(reason)));
        invoke<ModelCategory[]>("list_model_categories").then(setCategories).catch((reason) => setCatalogError(String(reason)));
        invoke<boolean>("key_status").then(setKeySaved).catch((reason) => setError(String(reason)));
        invoke<ModelCatalog>("refresh_models").then((result) => { setCatalog(result); setContextPreview(null); setCatalogError(""); }).catch((reason) => setCatalogError(String(reason)));
    }, []);

    async function createBackup() {
        try {
            await invoke<string>("create_backup");
            setBackups(await invoke<string[]>("list_backups"));
            setError("");
        } catch (reason) {
            setError(String(reason));
        }
    }

    async function restoreBackup() {
        if (!selectedBackup || busy || !window.confirm(`Восстановить копию ${selectedBackup}? Текущая история будет сохранена отдельной копией.`)) return;
        try {
            await invoke("restore_backup", {name: selectedBackup});
            await reload();
            setCatalog(await invoke<ModelCatalog | null>("list_models"));
            setCategories(await invoke<ModelCategory[]>("list_model_categories"));
            setModelId("local-mock");
            setPendingAttachments([]);
            setContextPreview(null);
            setBackups(await invoke<string[]>("list_backups"));
            setError("");
        } catch (reason) {
            setError(String(reason));
        }
    }

    async function saveKey() {
        try {
            await invoke("save_key", {key});
            setKey("");
            setKeySaved(true);
            setError("");
        } catch (reason) { setError(String(reason)); }
    }

    async function deleteKey() {
        try {
            await invoke("delete_key");
            setKeySaved(false);
            setError("");
        } catch (reason) { setError(String(reason)); }
    }

    async function runGeneration(command: string, args: Record<string, unknown>, restorePrompt?: string): Promise<boolean> {
        if (busy) return false;
        setBusy(true);
        setError("");
        setDraft("");
        const channel = new Channel<StreamEvent>();
        let lastSeq = 0;
        let pending = "";
        let frame = 0;
        channel.onmessage = (message) => {
            if (message.event === "delta") {
                if (message.data.seq === lastSeq + 1) {
                    lastSeq = message.data.seq;
                    pending += message.data.text;
                    if (!frame) frame = requestAnimationFrame(() => {
                        setDraft((current) => current + pending);
                        pending = "";
                        frame = 0;
                    });
                } else if (message.data.seq > lastSeq + 1) {
                    reload().catch((reason) => setError(String(reason)));
                }
            } else {
                if (frame) cancelAnimationFrame(frame);
                setBusy(false);
                setDraft("");
                if (message.data.error_code) setError(`${message.data.http_status ? `HTTP ${message.data.http_status} · ` : ""}${message.data.error_code}${message.data.request_id ? ` · запрос ${message.data.request_id}` : ""}. Расход неизвестен.`);
                reload().catch((reason) => setError(String(reason)));
            }
        };
        try {
            await invoke<number>(command, {...args, onEvent: channel});
            await reload();
            return true;
        } catch (reason) {
            if (frame) cancelAnimationFrame(frame);
            setBusy(false);
            if (restorePrompt !== undefined) setPrompt(restorePrompt);
            setError(String(reason));
            return false;
        }
    }

    async function send() {
        const value = prompt.trim();
        if (!value || busy || !contextPreview || previewSignature !== JSON.stringify([value, pendingAttachments.map((attachment) => attachment.id), modelId, history.active_leaf_id])) return;
        setPrompt("");
        const ids = pendingAttachments.map((attachment) => attachment.id);
        if (await runGeneration(modelId === "local-mock" ? "start_mock_generation" : "start_generation", {prompt: value, attachmentIds: ids, modelId}, value)) {
            setPendingAttachments((current) => current.filter((attachment) => !ids.includes(attachment.id)));
            setContextPreview(null);
        }
    }

    async function pickAttachment() {
        try {
            const attachment = await invoke<PendingAttachment | null>("pick_text_attachment");
            if (attachment) {
                setPendingAttachments((current) => [...current, attachment]);
                setContextPreview(null);
            }
            setError("");
        } catch (reason) {
            setError(String(reason));
        }
    }

    async function removeAttachment(id: number) {
        try {
            await invoke("remove_text_attachment", {id});
            setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
            setContextPreview(null);
        } catch (reason) {
            setError(String(reason));
        }
    }

    async function retry(assistantId: number) {
        if (modelId !== "local-mock" && !window.confirm("Повторить платный запрос? Предыдущий запрос мог быть принят и списан. Расход при обрыве неизвестен.")) return;
        await runGeneration(modelId === "local-mock" ? "retry_mock_generation" : "retry_generation", {assistantId, modelId});
    }

    async function selectBranch(messageId: number) {
        try {
            await invoke("select_branch", {messageId});
            await reload();
            setContextPreview(null);
        } catch (reason) {
            setError(String(reason));
        }
    }

    async function changeCategory(category: string) {
        try {
            await invoke("set_model_category", {modelId, category});
            setCategories(await invoke<ModelCategory[]>("list_model_categories"));
            setCatalogError("");
        } catch (reason) {
            setCatalogError(String(reason));
        }
    }

    async function stop() {
        try {
            await invoke("stop_generation");
        } catch (reason) {
            setError(String(reason));
        }
    }

    async function checkContext() {
        try {
            const ids = pendingAttachments.map((attachment) => attachment.id);
            const signature = JSON.stringify([prompt.trim(), ids, modelId, history.active_leaf_id]);
            const preview = await invoke<ContextPreview>("preview_context", {prompt, attachmentIds: ids, modelId});
            setContextPreview(preview);
            setPreviewSignature(signature);
            setError("");
        } catch (reason) {
            setContextPreview(null);
            setError(String(reason));
        }
    }

    const byId = new Map(history.messages.map((message) => [message.id, message]));
    const activeIds = new Set<number>();
    for (let id = history.active_leaf_id; id !== null;) {
        const message = byId.get(id);
        if (!message || activeIds.has(id)) break;
        activeIds.add(id);
        id = message.parent_id;
    }
    const visible = history.messages.filter((message) => activeIds.has(message.id) && (!busy || message.status !== "streaming"));
    return (
        <main className="app-shell">
            <aside className="sidebar" aria-label="Чаты">
                <div className="sidebar-heading">AI Desktop Client</div>
                <div className="sidebar-label">Чаты</div>
                <div className="chat-item" aria-current="page">
                    <span className="chat-item-title">Локальный чат</span>
                    <span className="chat-item-count">{history.messages.length}</span>
                </div>
                <div className="backup-controls">
                    <button type="button" className="secondary-button" disabled={busy}
                            onClick={() => void createBackup()}>Создать копию
                    </button>
                    <label htmlFor="backup">Резервные копии</label>
                    <select id="backup" value={selectedBackup}
                            onChange={(event) => setSelectedBackup(event.target.value)}>
                        <option value="">Выберите копию</option>
                        {backups.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <button type="button" className="secondary-button" disabled={busy || !selectedBackup}
                            onClick={() => void restoreBackup()}>Восстановить
                    </button>
                </div>
                <div className="key-control">
                    <label htmlFor="api-key">Ключ SimpleClaw · {keySaved ? "сохранён" : "не сохранён"}</label>
                    <input id="api-key" type="password" value={key} autoComplete="off"
                           onChange={(event) => setKey(event.target.value)} placeholder="Введите ключ"/>
                    <button type="button" className="secondary-button" disabled={!key.trim() || busy}
                            onClick={() => void saveKey()}>Сохранить ключ</button>
                    {keySaved && <button type="button" className="secondary-button" disabled={busy}
                                         onClick={() => void deleteKey()}>Удалить ключ</button>}
                </div>
                <div className="sidebar-footer">История хранится на этом компьютере</div>
            </aside>
            <section className="chat-panel" aria-label="Локальный чат">
                <header className="chat-header">
                    <div>
                        <h1>Локальный чат</h1>
                        <p>Локальный тест или явный запрос к SimpleClaw</p>
                    </div>
                    {history.messages.some((message) => message.role === "assistant") && (
                        <label htmlFor="branch">
                            Ветка
                            <select id="branch" value={history.active_leaf_id ?? ""} disabled={busy}
                                    onChange={(event) => void selectBranch(Number(event.target.value))}>
                                {history.messages.filter((message) => message.role === "assistant").map((message) => (
                                    <option key={message.id} value={message.id}>Ответ #{message.id}</option>
                                ))}
                            </select>
                        </label>
                    )}
                    <label className="theme-control" htmlFor="theme">
                        <span>Тема</span>
                        <select id="theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                            <option value="system">Системная</option>
                            <option value="light">Светлая</option>
                            <option value="dark">Тёмная</option>
                        </select>
                    </label>
                    <label htmlFor="model">
                        Модель для следующей попытки
                        <select id="model" value={modelId} disabled={busy} onChange={(event) => {
                            setModelId(event.target.value);
                            setContextPreview(null);
                        }}>
                            <option value="local-mock">Локальный тест</option>
                            {categoryOrder.map((category) => <optgroup key={category} label={categoryLabel[category]}>
                                {catalog?.models.filter((model) => (categories.find((item) => item.model_id === model.id)?.category ?? "other") === category)
                                    .map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
                            </optgroup>)}
                        </select>
                        <small>{catalog ? `Каталог: ${new Date(catalog.fetched_at * 1000).toLocaleString()}` : "Каталог ещё не загружен"}</small>
                        {catalogError && <small>{catalogError}</small>}
                        {modelId !== "local-mock" &&
                            <small>Цена: {catalog?.models.find((model) => model.id === modelId)?.input_rubles_per_million ?? "неизвестна"} ₽/млн
                                входных; {catalog?.models.find((model) => model.id === modelId)?.output_rubles_per_million ?? "неизвестна"} ₽/млн
                                выходных. Лимит контекста и пригодность для текстового чата не подтверждены.</small>}
                    </label>
                    {modelId !== "local-mock" && <label htmlFor="model-category">
                        Ваша категория модели
                        <select id="model-category" value={categories.find((item) => item.model_id === modelId)?.category ?? "other"}
                                onChange={(event) => void changeCategory(event.target.value)}>
                            <option value="other">Остальные</option>
                            <option value="thinking">Мышление</option>
                            <option value="speed">Скорость</option>
                            <option value="economy">Экономия</option>
                        </select>
                        <small>{categories.find((item) => item.model_id === modelId) ?
                            `Помечено вами: ${new Date(categories.find((item) => item.model_id === modelId)!.updated_at * 1000).toLocaleString()}. ` : ""}
                            Свойства модели не проверены.</small>
                    </label>}
                </header>
                <div className="history" aria-label="История сообщений" role="log">
                    {visible.length === 0 && !busy && (
                        <div className="empty-state">
                            <h2>Начните разговор</h2>
                            <p>Отправьте сообщение, чтобы увидеть локальный тестовый ответ. Данные сохраняются на этом
                                компьютере.</p>
                        </div>
                    )}
                    {visible.map((message) => (
                        <article className={`message message-${message.role}`} key={message.id}>
                            <strong>{message.role === "user" ? "Вы" : "Ответ"}</strong>
                            <p>{message.content}</p>
                            {history.attachments.filter((attachment) => attachment.message_id === message.id).map((attachment) => (
                                <small
                                    key={attachment.sha256 + attachment.name}>Файл: {attachment.name} · {attachment.size} Б
                                    · SHA-256 {attachment.sha256.slice(0, 12)}…</small>
                            ))}
                            {message.status !== "completed" &&
                                <small>{statusLabel[message.status] ?? message.status}</small>}
                            {history.attempts.find((attempt) => attempt.assistant_id === message.id) && <small>
                                Модель: {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.model_id ?? "локальный тест"}
                                {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.error_code &&
                                    ` · ошибка ${history.attempts.find((attempt) => attempt.assistant_id === message.id)?.http_status ? `HTTP ${history.attempts.find((attempt) => attempt.assistant_id === message.id)?.http_status} ` : ""}${history.attempts.find((attempt) => attempt.assistant_id === message.id)?.error_code}`}
                                {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.server_request_id &&
                                    ` · запрос ${history.attempts.find((attempt) => attempt.assistant_id === message.id)?.server_request_id}`}
                                {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.usage ?
                                    ` · usage сервера: ${JSON.stringify(history.attempts.find((attempt) => attempt.assistant_id === message.id)?.usage)}` :
                                    " · usage неизвестен"}
                            </small>}
                            {message.role === "assistant" && (
                                <div className="branch-actions">
                                    {history.contexts.find((item) => item.assistant_id === message.id) && (
                                        <details>
                                            <summary>Отправленный контекст</summary>
                                            {history.contexts.find((item) => item.assistant_id === message.id)?.context.messages.map((part, index) =>
                                                <pre
                                                    key={index}>{part.role} · {part.source_message_id ?? "система"}{"\n"}{part.content}</pre>)}
                                        </details>
                                    )}
                                    {history.messages.filter((candidate) => candidate.role === "assistant" && candidate.parent_id === message.parent_id).map((candidate, index) => (
                                        <button type="button" className="secondary-button" key={candidate.id}
                                                disabled={busy || candidate.id === message.id}
                                                onClick={() => void selectBranch(candidate.id)}>
                                            Ответ {index + 1}{candidate.id === message.id ? " · выбран" : ""}
                                        </button>
                                    ))}
                                    <button type="button" className="secondary-button" disabled={busy}
                                            onClick={() => void retry(message.id)}>Retry · новый ответ
                                    </button>
                                </div>
                            )}
                        </article>
                    ))}
                    {busy && <article className="message message-assistant"><strong>Ответ</strong>
                        <p>{draft || "Ожидание ответа…"}</p><small>Ответ продолжается</small></article>}
                </div>
                <form className="composer" onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                }}>
                    <label htmlFor="prompt">Сообщение</label>
                    <textarea id="prompt" value={prompt} maxLength={2000}
                              placeholder="Напишите сообщение" onChange={(event) => {
                        setPrompt(event.target.value);
                        setContextPreview(null);
                    }}/>
                    <div className="attachment-controls">
                        <button type="button" className="secondary-button"
                                disabled={busy || pendingAttachments.length >= 5}
                                onClick={() => void pickAttachment()}>Прикрепить текстовый файл
                        </button>
                        {pendingAttachments.map((attachment) => (
                            <div className="attachment-item" key={attachment.id}>
                                <span>{attachment.name} · {attachment.size} Б · SHA-256 {attachment.sha256.slice(0, 12)}…</span>
                                <button type="button" className="secondary-button" disabled={busy}
                                        onClick={() => void removeAttachment(attachment.id)}>Убрать
                                </button>
                                <details>
                                    <summary>Содержимое</summary>
                                    <pre>{attachment.preview}</pre>
                                </details>
                            </div>
                        ))}
                    </div>
                    {contextPreview && <details open className="context-preview">
                        <summary>Состав запроса · {contextPreview.bytes} Б · пропущено завершённых
                            обменов: {contextPreview.omitted_exchanges}</summary>
                        <p>{contextPreview.warning}</p>
                        {contextPreview.messages.map((part, index) => <pre
                            key={index}>{part.role} · {part.source_message_id ?? "новое сообщение или система"} · вложения: {part.attachment_ids.join(", ") || "нет"}{"\n"}{part.content}</pre>)}
                    </details>}
                    <div className="composer-footer">
                        <span>{modelId === "local-mock" ? "Локальный тест без сетевого POST" : "Отправка в SimpleClaw может стоить денег. Расход при обрыве неизвестен."}</span>
                        <div className="actions">
                            {busy && <button type="button" className="secondary-button"
                                             onClick={() => void stop()}>Остановить</button>}
                            <button type="button" className="secondary-button" disabled={busy || !prompt.trim()}
                                    onClick={() => void checkContext()}>Проверить контекст
                            </button>
                            <button type="submit"
                                    disabled={busy || !prompt.trim() || (modelId !== "local-mock" && !keySaved) || !contextPreview || previewSignature !== JSON.stringify([prompt.trim(), pendingAttachments.map((attachment) => attachment.id), modelId, history.active_leaf_id])}>Отправить
                            </button>
                        </div>
                    </div>
                    {error && <p role="alert">{error}</p>}
                </form>
            </section>
        </main>
    );
}

createRoot(document.getElementById("root")!).render(<App/>);
