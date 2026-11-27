import {act, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {mockIPC} from "@tauri-apps/api/mocks";
import {useChatGeneration} from "./useChatGeneration";
import type {ModelSource} from "../../modelSource";

type Event = {event: "delta"; data: {attempt_id: number; seq: number; text: string}} |
    {event: "end"; data: {attempt_id: number; status: string; error_code: null; request_id: null; http_status: null}};
const channels: {onmessage: (event: Event) => void}[] = [];
const calls: {command: string; args: Record<string, unknown>}[] = [];
let generation: ReturnType<typeof useChatGeneration>;
let changeConversation: (id: number) => void;
let approve = false;
let failReload = false;
mockIPC((command, args) => {
    if (command === "stop_generation") return null;
    calls.push({command, args: args as Record<string, unknown>});
    channels.push((args as {onEvent: {onmessage: (event: Event) => void}}).onEvent);
    return calls.length;
});

function Harness() {
    const [conversationId, setConversationId] = useState(1);
    const [, setPrompt] = useState("");
    const activeConversation = useRef(conversationId);
    activeConversation.current = conversationId;
    const currentModelSource = useRef<ModelSource>("ollama");
    changeConversation = setConversationId;
    generation = useChatGeneration({conversationId, activeConversation, currentModelSource, setPrompt,
        history: {attempts: [{assistant_id: 1, model_id: "paid"}], contexts: [{assistant_id: 1, context: {model_source: "simpleclaw"}}]},
        clearContext: () => {}, reload: async () => { if (failReload) throw new Error("history unavailable"); }, refreshScheduledRuns: async () => {},
        confirmAction: async () => approve, clear: () => {}, report: () => {}});
    return <div>{generation.busy ? "busy" : "idle"}:{generation.draft}</div>;
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const delta = (id: number, seq: number, text: string): Event => ({event: "delta", data: {attempt_id: id, seq, text}});
const end = (id: number): Event => ({event: "end", data: {attempt_id: id, status: "stopped", error_code: null, request_id: null, http_status: null}});

async function run() {
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    let frame: FrameRequestCallback = () => {};
    window.requestAnimationFrame = (callback) => { frame = callback; return 1; };
    window.cancelAnimationFrame = () => {};
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<Harness/>));
    await act(async () => { await generation.retry(1); });
    check(calls.length === 0, "cancelled paid retry started a request");
    approve = true;
    await act(async () => { await generation.retry(1); });
    check(Number(calls.length) === 1 && calls[0].command === "retry_generation" && calls[0].args.modelId === "paid", "retry lost saved provider or model");
    await act(async () => { channels[0].onmessage(delta(1, 1, "part")); channels[0].onmessage(delta(1, 1, "duplicate")); frame(0); });
    check(generation.draft === "part", "duplicate delta changed the response");
    await act(async () => { channels[0].onmessage(end(1)); });
    await act(async () => { await generation.retry(1); });
    await act(async () => { channels[0].onmessage(delta(1, 2, "late")); channels[1].onmessage(delta(2, 1, "new")); frame(0); });
    check(String(generation.draft) === "new", "old event changed the new attempt");
    await act(async () => { channels[1].onmessage(end(2)); });
    failReload = true;
    await act(async () => { await generation.retry(1); });
    check(generation.busy, "history failure released an active stream");
    failReload = false;
    await act(async () => { changeConversation(2); });
    await act(async () => { channels[2].onmessage(delta(3, 1, "wrong conversation")); channels[2].onmessage(end(3)); });
    check(!document.body.textContent?.includes("wrong conversation"), "event changed another conversation");
    await act(async () => root.unmount());
    calls.length = 0;
    channels.length = 0;
    const duplicateRoot = createRoot(document.getElementById("root")!);
    await act(async () => duplicateRoot.render(<Harness/>));
    await act(async () => {
        const send = generation.runGeneration;
        await Promise.all([send("start_ollama_generation", {}), send("start_ollama_generation", {})]);
    });
    check(Number(calls.length) === 1, "two sends before the next render reached IPC");
    await act(async () => { channels[0].onmessage(delta(1, 1, "accepted")); frame(0); });
    check(String(generation.draft) === "accepted", "duplicate send replaced the active stream");
    await act(async () => { channels[0].onmessage(end(1)); });
    await act(async () => { await generation.runGeneration("start_ollama_generation", {}); });
    check(Number(calls.length) === 2, "completed attempt blocked the next send");
    await act(async () => duplicateRoot.unmount());
}
run().then(() => { document.getElementById("result")!.textContent = "PASS"; }, (error) => { document.getElementById("result")!.textContent = `FAIL: ${String(error)}`; });
