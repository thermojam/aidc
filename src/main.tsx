import {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {Channel, invoke} from "@tauri-apps/api/core";
import MarkdownMessage from "./MarkdownMessage";
import ArtifactPanel, {type ArtifactVersion} from "./ArtifactPanel";
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
    artifacts: ArtifactVersion[];
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
type Conversation = { id: number; title: string; archived: boolean; pinned: boolean; project_id: number | null };
type Project = { id: number; title: string; archived: boolean };

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
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [projectFilter, setProjectFilter] = useState<number | null>(null);
    const [renameTarget, setRenameTarget] = useState<{kind: "project" | "conversation"; id: number; title: string} | null>(null);
    const [conversationSearch, setConversationSearch] = useState("");
    const [searchMatches, setSearchMatches] = useState<number[] | null>(null);
    const [conversationId, setConversationId] = useState(1);
    const [history, setHistory] = useState<History>({
        messages: [],
        attachments: [],
        artifacts: [],
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
    const [selectedArtifactId, setSelectedArtifactId] = useState<number | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const settingsButton = useRef<HTMLButtonElement>(null);
    const compactSettingsButton = useRef<HTMLButtonElement>(null);
    const settingsDialog = useRef<HTMLDialogElement>(null);
    const artifactTrigger = useRef<HTMLElement | null>(null);
    const promptField = useRef<HTMLTextAreaElement>(null);
    const historyRequest = useRef(0);
    const contextRequest = useRef(0);
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem("appearance");
        return saved === "light" || saved === "dark" ? saved : "system";
    });

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("appearance", theme);
    }, [theme]);

    useEffect(() => {
        if (settingsOpen) settingsDialog.current?.showModal();
        else settingsDialog.current?.close();
    }, [settingsOpen]);

    function closeSettings() {
        setSettingsOpen(false);
        requestAnimationFrame(() => (compactSettingsButton.current?.offsetParent ? compactSettingsButton.current : settingsButton.current)?.focus());
    }

    async function reload(id = conversationId) {
        const request = ++historyRequest.current;
        const next = await invoke<History>("list_history", {conversationId: id});
        if (request === historyRequest.current) setHistory(next);
    }

    async function refreshConversations() {
        const items = await invoke<Conversation[]>("list_conversations");
        setConversations(items);
        return items;
    }

    async function refreshProjects() {
        const items = await invoke<Project[]>("list_projects");
        setProjects(items);
        return items;
    }

    useEffect(() => {
        const query = conversationSearch.trim();
        if (!query) { setSearchMatches(null); return; }
        let current = true;
        const timer = window.setTimeout(() => {
            invoke<Conversation[]>("search_conversations", {query, projectFilter})
                .then((items) => { if (current) setSearchMatches(items.map((item) => item.id)); })
                .catch((reason) => { if (current) setError(String(reason)); });
        }, 150);
        return () => { current = false; window.clearTimeout(timer); };
    }, [conversationSearch, conversations, projectFilter]);

    useEffect(() => {
        refreshConversations().then((items) => {
            if (!items.some((item) => item.id === conversationId && !item.archived)) {
                setConversationId(items.find((item) => !item.archived)?.id ?? items[0]?.id ?? 1);
            }
        }).catch((reason) => setError(String(reason)));
        refreshProjects().catch((reason) => setError(String(reason)));
        invoke<string[]>("list_backups").then(setBackups).catch((reason) => setError(String(reason)));
        invoke<ModelCatalog | null>("list_models").then(setCatalog).catch((reason) => setCatalogError(String(reason)));
        invoke<ModelCategory[]>("list_model_categories").then(setCategories).catch((reason) => setCatalogError(String(reason)));
        invoke<boolean>("key_status").then(setKeySaved).catch((reason) => setError(String(reason)));
        invoke<ModelCatalog>("refresh_models").then((result) => { setCatalog(result); setContextPreview(null); setCatalogError(""); }).catch((reason) => setCatalogError(String(reason)));
    }, []);

    useEffect(() => {
        reload(conversationId).catch((reason) => setError(String(reason)));
    }, [conversationId]);

    async function switchConversation(id: number, discardConfirmed = false) {
        if (busy || id === conversationId) return;
        if (!discardConfirmed && (prompt.trim() || pendingAttachments.length) && !window.confirm("Перейти в другую беседу? Черновик и выбранные файлы будут убраны.")) return;
        try {
            for (const attachment of pendingAttachments) await invoke("remove_text_attachment", {id: attachment.id});
            setPendingAttachments([]);
            setPrompt("");
            contextRequest.current++;
            setContextPreview(null);
            setSelectedArtifactId(null);
            setSidebarOpen(false);
            historyRequest.current++;
            setHistory({messages: [], attachments: [], artifacts: [], active_leaf_id: null, contexts: [], attempts: []});
            setConversationId(id);
            setError("");
        } catch (reason) { setError(String(reason)); }
    }

    async function createConversation() {
        if (busy) return;
        if ((prompt.trim() || pendingAttachments.length) && !window.confirm("Создать беседу? Черновик и выбранные файлы будут убраны.")) return;
        try {
            const id = await invoke<number>("create_conversation");
            if (projectFilter && projectFilter > 0) await invoke("move_conversation", {conversationId: id, projectId: projectFilter});
            await refreshConversations();
            await switchConversation(id, true);
        } catch (reason) { setError(String(reason)); }
    }

    async function saveRename() {
        if (!renameTarget) return;
        try {
            if (renameTarget.kind === "conversation") {
                await invoke("rename_conversation", {conversationId: renameTarget.id, title: renameTarget.title});
                await refreshConversations();
            } else {
                await invoke("rename_project", {id: renameTarget.id, title: renameTarget.title});
                await refreshProjects();
            }
            setRenameTarget(null);
            setError("");
        } catch (reason) { setError(String(reason)); }
    }

    async function archiveConversation(item: Conversation) {
        if (busy) return;
        if (item.id === conversationId && !item.archived && (prompt.trim() || pendingAttachments.length)
            && !window.confirm("Архивировать беседу? Черновик и выбранные файлы будут убраны.")) return;
        try {
            await invoke("archive_conversation", {conversationId: item.id, archived: !item.archived});
            const items = await refreshConversations();
            setError("");
            if (item.id === conversationId && !item.archived) {
                let nextId = items.find((candidate) => !candidate.archived)?.id;
                if (!nextId) {
                    nextId = await invoke<number>("create_conversation");
                    await refreshConversations();
                }
                await switchConversation(nextId, true);
            }
        } catch (reason) { setError(String(reason)); }
    }

    async function togglePin(item: Conversation) {
        try {
            await invoke("set_conversation_pinned", {conversationId: item.id, pinned: !item.pinned});
            await refreshConversations();
            setError("");
        } catch (reason) { setError(String(reason)); }
    }

    async function createProject() {
        try {
            const id = await invoke<number>("create_project");
            await refreshProjects();
            setProjectFilter(id);
            setError("");
        } catch (reason) { setError(String(reason)); }
    }

    async function archiveProject(item: Project) {
        try {
            await invoke("archive_project", {id: item.id, archived: !item.archived});
            await refreshProjects();
            if (!item.archived && projectFilter === item.id) setProjectFilter(null);
            setError("");
        } catch (reason) { setError(String(reason)); }
    }

    async function moveConversation(projectId: number | null) {
        try {
            await invoke("move_conversation", {conversationId, projectId});
            await refreshConversations();
            setProjectFilter(projectId ?? 0);
            setError("");
        } catch (reason) { setError(String(reason)); }
    }

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
            const items = await refreshConversations();
            setProjects(await invoke<Project[]>("list_projects"));
            setProjectFilter(null);
            const nextId = items.some((item) => item.id === conversationId && !item.archived)
                ? conversationId : items.find((item) => !item.archived)?.id ?? items[0]?.id ?? 1;
            setConversationId(nextId);
            await reload(nextId);
            setCatalog(await invoke<ModelCatalog | null>("list_models"));
            setCategories(await invoke<ModelCategory[]>("list_model_categories"));
            setModelId("local-mock");
            setPendingAttachments([]);
            setSelectedArtifactId(null);
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
            await invoke<number>(command, {conversationId, ...args, onEvent: channel});
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
        if (!value || busy || !contextPreview || previewSignature !== JSON.stringify([conversationId, value, pendingAttachments.map((attachment) => attachment.id), modelId, history.active_leaf_id])) return;
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
            await invoke("select_branch", {conversationId, messageId});
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
        const request = ++contextRequest.current;
        try {
            const ids = pendingAttachments.map((attachment) => attachment.id);
            const signature = JSON.stringify([conversationId, prompt.trim(), ids, modelId, history.active_leaf_id]);
            const preview = await invoke<ContextPreview>("preview_context", {conversationId, prompt, attachmentIds: ids, modelId});
            if (request !== contextRequest.current) return;
            setContextPreview(preview);
            setPreviewSignature(signature);
            setError("");
        } catch (reason) {
            if (request !== contextRequest.current) return;
            setContextPreview(null);
            setError(String(reason));
        }
    }

    async function openArtifact(messageId: number, kind: "code" | "html" | "svg", title: string, content: string) {
        artifactTrigger.current = document.activeElement as HTMLElement;
        try {
            const id = await invoke<number>("create_artifact", {messageId, kind, title, content});
            await reload();
            setSelectedArtifactId(id);
            setError("");
        } catch (reason) {
            setError(String(reason));
        }
    }

    async function exportArtifact(id: number) {
        try {
            await invoke("export_artifact", {id});
            setError("");
        } catch (reason) {
            setError(String(reason));
        }
    }

    function closeArtifact() {
        setSelectedArtifactId(null);
        requestAnimationFrame(() => (artifactTrigger.current?.isConnected ? artifactTrigger.current : promptField.current)?.focus());
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
    const selectedArtifact = history.artifacts.find((artifact) => artifact.id === selectedArtifactId);
    const selectedConversation = conversations.find((item) => item.id === conversationId);
    const selectedProject = projects.find((item) => item.id === projectFilter && !item.archived);
    const activeProjects = projects.filter((item) => !item.archived);
    const archivedProjects = projects.filter((item) => item.archived);
    const shownConversations = (searchMatches === null ? conversations : conversations.filter((item) => searchMatches.includes(item.id)))
        .filter((item) => projectFilter === null || item.project_id === (projectFilter || null));
    const activeConversations = shownConversations.filter((item) => !item.archived);
    const archivedConversations = shownConversations.filter((item) => item.archived);
    const selectedModel = catalog?.models.find((model) => model.id === modelId);
    const selectedCategory = categories.find((item) => item.model_id === modelId);
    function follows(message: Message, ancestorId: number): boolean {
        for (let parentId = message.parent_id; parentId !== null;) {
            if (parentId === ancestorId) return true;
            parentId = byId.get(parentId)?.parent_id ?? null;
        }
        return false;
    }
    return (
        <main className={`app-shell${selectedArtifact ? " with-artifact" : ""}${sidebarOpen ? " sidebar-open" : ""}`}>
            <aside className="sidebar" aria-label="Чаты">
                <div className="sidebar-heading">AI Desktop Client
                    <button type="button" className="secondary-button sidebar-close" aria-label="Закрыть список чатов"
                            onClick={() => setSidebarOpen(false)}>×</button>
                </div>
                <div className="sidebar-label">Проекты</div>
                <div className="project-controls">
                    <select aria-label="Выбранный проект" value={projectFilter ?? -1}
                            onChange={(event) => { setProjectFilter(Number(event.target.value) === -1 ? null : Number(event.target.value)); setSearchMatches(null); }}>
                        <option value={-1}>Все беседы</option><option value={0}>Без проекта</option>
                        {activeProjects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                    </select>
                    <button type="button" className="secondary-button" aria-label="Создать проект" onClick={() => void createProject()}>+</button>
                </div>
                {selectedProject && <div className="project-actions">
                    <button type="button" className="secondary-button" onClick={() => setRenameTarget({kind: "project", id: selectedProject.id, title: selectedProject.title})}>Переименовать</button>
                    <button type="button" className="secondary-button" onClick={() => void archiveProject(selectedProject)}>Архивировать</button>
                </div>}
                {archivedProjects.length > 0 && <details className="archived-chats"><summary>Архив проектов</summary>
                    {archivedProjects.map((item) => <div className="project-archived" key={item.id}>
                        <span>{item.title}</span><button type="button" className="chat-action" onClick={() => void archiveProject(item)}>Вернуть</button>
                    </div>)}
                </details>}
                {renameTarget && <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void saveRename(); }}>
                    <label htmlFor="rename-title">Название {renameTarget.kind === "project" ? "проекта" : "беседы"}</label>
                    <input id="rename-title" autoFocus maxLength={80} value={renameTarget.title}
                           onChange={(event) => setRenameTarget({...renameTarget, title: event.target.value})}
                           onKeyDown={(event) => { if (event.key === "Escape") setRenameTarget(null); }}/>
                    <div><button type="submit" disabled={!renameTarget.title.trim()}>Сохранить</button>
                        <button type="button" onClick={() => setRenameTarget(null)}>Отмена</button></div>
                </form>}
                <div className="sidebar-label">Беседы</div>
                <button type="button" className="secondary-button new-chat" disabled={busy}
                        onClick={() => void createConversation()}>Новая беседа</button>
                <input className="chat-search" type="search" aria-label="Поиск бесед" placeholder="Поиск бесед"
                       maxLength={100} value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)}/>
                <div className="sidebar-chats">
                    {shownConversations.length === 0 && <p className="sidebar-empty">Ничего не найдено</p>}
                    {activeConversations.map((item) => <div className="chat-item" key={item.id}>
                        <button type="button" className="chat-item-title chat-select" title={item.title}
                                aria-current={item.id === conversationId ? "page" : undefined} disabled={busy}
                                onClick={() => void switchConversation(item.id)}>{item.title}</button>
                        <button type="button" className="chat-action" aria-label={`${item.pinned ? "Открепить" : "Закрепить"} ${item.title}`}
                                aria-pressed={item.pinned} onClick={() => void togglePin(item)}>{item.pinned ? "★" : "☆"}</button>
                        <button type="button" className="chat-action" aria-label={`Переименовать ${item.title}`} disabled={busy}
                                onClick={() => setRenameTarget({kind: "conversation", id: item.id, title: item.title})}>✎</button>
                        <button type="button" className="chat-action" aria-label={`Архивировать ${item.title}`}
                                disabled={busy}
                                onClick={() => void archiveConversation(item)}>▤</button>
                    </div>)}
                    {archivedConversations.length > 0 && <details key={conversationSearch.trim() ? "search" : "browse"} className="archived-chats" open={!!conversationSearch.trim()}>
                        <summary>Архив</summary>
                        {archivedConversations.map((item) => <div className="chat-item" key={item.id}>
                            <span className="chat-item-title" title={item.title}>{item.title}</span>
                            <button type="button" className="chat-action" aria-label={`${item.pinned ? "Открепить" : "Закрепить"} ${item.title}`}
                                    aria-pressed={item.pinned} onClick={() => void togglePin(item)}>{item.pinned ? "★" : "☆"}</button>
                            <button type="button" className="chat-action" aria-label={`Вернуть ${item.title} из архива`} disabled={busy}
                                    onClick={() => void archiveConversation(item)}>↩</button>
                        </div>)}
                    </details>}
                </div>
                <button ref={settingsButton} type="button" className="secondary-button sidebar-settings"
                        onClick={() => { setSidebarOpen(false); setSettingsOpen(true); }}>Настройки</button>
            </aside>
            <section className="chat-panel" aria-label={selectedConversation?.title ?? "Беседа"}>
                <header className="chat-header">
                    <button type="button" className="secondary-button sidebar-toggle" aria-label="Открыть список чатов" aria-expanded={sidebarOpen}
                            onClick={() => setSidebarOpen((open) => !open)}>☰</button>
                    <h1>{selectedConversation?.title ?? "Беседа"}</h1>
                    <select className="conversation-project" aria-label="Проект беседы" value={selectedConversation?.project_id ?? 0}
                            disabled={busy || !selectedConversation} onChange={(event) => void moveConversation(Number(event.target.value) || null)}>
                        <option value={0}>Без проекта</option>
                        {projects.filter((item) => !item.archived || item.id === selectedConversation?.project_id)
                            .map((item) => <option key={item.id} value={item.id}>{item.title}{item.archived ? " (архив)" : ""}</option>)}
                    </select>
                    <button ref={compactSettingsButton} type="button" className="secondary-button compact-settings"
                            onClick={() => setSettingsOpen(true)}>Настройки</button>
                </header>
                <div className="history" aria-label="История сообщений" role="log">
                    <div className="history-content">
                    {visible.length === 0 && !busy && (
                        <div className="empty-state">
                            <h2>Начните разговор</h2>
                            <p>Выберите модель и напишите сообщение. История хранится на этом компьютере.</p>
                        </div>
                    )}
                    {visible.map((message) => (
                        <article className={`message message-${message.role}`} key={message.id}>
                            <strong>{message.role === "user" ? "Вы" : "Ответ"}</strong>
                            {message.role === "assistant" && message.status === "completed" ?
                                <MarkdownMessage content={message.content} messageId={message.id} onArtifact={(id, kind, title, content) => void openArtifact(id, kind, title, content)}/> :
                                <p>{message.content}</p>}
                            {history.attachments.filter((attachment) => attachment.message_id === message.id).map((attachment) => (
                                <small
                                    key={attachment.sha256 + attachment.name}>Файл: {attachment.name} · {attachment.size} Б
                                    · SHA-256 {attachment.sha256.slice(0, 12)}…</small>
                            ))}
                            {message.role !== "assistant" && message.status !== "completed" &&
                                <small>{statusLabel[message.status] ?? message.status}</small>}
                            {message.role === "assistant" && <small>
                                Модель: {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.model_id ?? "локальный тест"}
                                {message.status === "completed" ? " · Завершено" : ` · ${statusLabel[message.status] ?? message.status}`}
                                {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.model_id !== "local-mock" &&
                                    history.attempts.find((attempt) => attempt.assistant_id === message.id)?.model_id &&
                                    (history.attempts.find((attempt) => attempt.assistant_id === message.id)?.usage ? " · Сумма не подтверждена" : " · Usage и сумма неизвестны")}
                            </small>}
                            {message.role === "assistant" && (
                                <div className="branch-actions">
                                    {history.artifacts.filter((artifact) => artifact.message_id === message.id).map((artifact) =>
                                        <button type="button" className="secondary-button" key={artifact.id}
                                                onClick={(event) => { artifactTrigger.current = event.currentTarget; setSelectedArtifactId(artifact.id); }}>Artifact #{artifact.id} · {artifact.title}</button>)}
                                    <details className="answer-details">
                                        <summary>Детали ответа</summary>
                                        <p>HTTP: {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.http_status ?? "неизвестен"}</p>
                                        <p>Код ошибки: {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.error_code ?? "нет"}</p>
                                        <p>Request ID: {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.server_request_id ?? "неизвестен"}</p>
                                        <p>Response ID: {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.server_response_id ?? "неизвестен"}</p>
                                        <p>Usage сервера: {history.attempts.find((attempt) => attempt.assistant_id === message.id)?.usage ? JSON.stringify(history.attempts.find((attempt) => attempt.assistant_id === message.id)?.usage) : "неизвестен"}</p>
                                        {history.contexts.find((item) => item.assistant_id === message.id) && <details>
                                            <summary>Отправленный контекст</summary>
                                            {history.contexts.find((item) => item.assistant_id === message.id)?.context.messages.map((part, index) =>
                                                <pre
                                                    key={index}>{part.role} · {part.source_message_id ?? "система"}{"\n"}{part.content}</pre>)}
                                        </details>}
                                        {history.messages.filter((candidate) => candidate.role === "assistant" && follows(candidate, message.id)).length > 0 && <details>
                                            <summary>Продолжения этой ветки</summary>
                                            {history.messages.filter((candidate) => candidate.role === "assistant" && follows(candidate, message.id)).map((candidate) =>
                                                <button type="button" className="secondary-button" key={candidate.id} disabled={busy || activeIds.has(candidate.id)}
                                                        onClick={() => void selectBranch(candidate.id)}>Ответ #{candidate.id}</button>)}
                                        </details>}
                                    </details>
                                    {history.messages.filter((candidate) => candidate.role === "assistant" && candidate.parent_id === message.parent_id).length > 1 && history.messages.filter((candidate) => candidate.role === "assistant" && candidate.parent_id === message.parent_id).map((candidate, index) => (
                                        <button type="button" className="secondary-button" key={candidate.id}
                                                disabled={busy || candidate.id === message.id}
                                                onClick={() => void selectBranch(candidate.id)}>
                                            Ответ {index + 1}{candidate.id === message.id ? " · выбран" : ""}
                                        </button>
                                    ))}
                                    <button type="button" className="secondary-button" disabled={busy}
                                            onClick={() => void retry(message.id)}>Повторить · новый ответ
                                    </button>
                                </div>
                            )}
                        </article>
                    ))}
                    {busy && <article className="message message-assistant"><strong>Ответ</strong>
                        <p>{draft || "Ожидание ответа…"}</p><small>Ответ продолжается</small></article>}
                    </div>
                </div>
                <form className="composer" onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                }}>
                    <label className="sr-only" htmlFor="prompt">Сообщение</label>
                    <textarea ref={promptField} id="prompt" value={prompt} maxLength={2000}
                              placeholder="Напишите сообщение" onChange={(event) => {
                        setPrompt(event.target.value);
                        setContextPreview(null);
                    }}/>
                    <div className="attachment-controls">
                        {pendingAttachments.map((attachment) => (
                            <div className="attachment-item" key={attachment.id}>
                                <span title={attachment.name}>{attachment.name} · {attachment.size} Б · SHA-256 {attachment.sha256.slice(0, 12)}…</span>
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
                        <div className="composer-tools">
                            <label className="sr-only" htmlFor="model">Модель для следующей попытки</label>
                            <select id="model" title={selectedModel ? `${selectedModel.name} · ${selectedModel.id}` : "Локальный тест"} value={modelId} disabled={busy} onChange={(event) => {
                                setModelId(event.target.value);
                                setContextPreview(null);
                            }}>
                                <option value="local-mock">Локальный тест</option>
                                {categoryOrder.map((category) => <optgroup key={category} label={categoryLabel[category]}>
                                    {catalog?.models.filter((model) => (categories.find((item) => item.model_id === model.id)?.category ?? "other") === category)
                                        .map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
                                </optgroup>)}
                            </select>
                            <button type="button" className="secondary-button" disabled={busy || pendingAttachments.length >= 5}
                                    onClick={() => void pickAttachment()}>Прикрепить файл</button>
                            <details className="model-details">
                                <summary>О модели</summary>
                                <p>{catalog ? `Каталог: ${new Date(catalog.fetched_at * 1000).toLocaleString()}` : "Каталог ещё не загружен"}</p>
                                {catalogError && <p role="alert">Ошибка обновления каталога: {catalogError}. {catalog ? "Сохранённый каталог доступен." : "Каталог недоступен."}</p>}
                                {modelId !== "local-mock" && <>
                                    <p>Цена: {selectedModel?.input_rubles_per_million ?? "неизвестна"} ₽/млн входных; {selectedModel?.output_rubles_per_million ?? "неизвестна"} ₽/млн выходных. Лимит контекста и пригодность для текстового чата не подтверждены.</p>
                                    <label htmlFor="model-category">Ваша категория модели</label>
                                    <select id="model-category" value={selectedCategory?.category ?? "other"} onChange={(event) => void changeCategory(event.target.value)}>
                                        <option value="other">Остальные</option><option value="thinking">Мышление</option>
                                        <option value="speed">Скорость</option><option value="economy">Экономия</option>
                                    </select>
                                    <p>{selectedCategory ? `Помечено вами: ${new Date(selectedCategory.updated_at * 1000).toLocaleString()}. ` : ""}Свойства модели не проверены.</p>
                                </>}
                            </details>
                        </div>
                        <div className="actions">
                            <button type="button" className="secondary-button" disabled={busy || !prompt.trim()}
                                    onClick={() => void checkContext()}>Проверить контекст
                            </button>
                            {busy ? <button type="button" onClick={() => void stop()}>Остановить</button> : <button type="submit"
                                    disabled={busy || !prompt.trim() || (modelId !== "local-mock" && !keySaved) || !contextPreview || previewSignature !== JSON.stringify([conversationId, prompt.trim(), pendingAttachments.map((attachment) => attachment.id), modelId, history.active_leaf_id])}>Отправить
                            </button>}
                        </div>
                    </div>
                    <p className="send-warning">{modelId === "local-mock" ? "Локальный тест · без сети" : "Отправка в SimpleClaw может стоить денег. Расход при обрыве неизвестен."}</p>
                    {modelId !== "local-mock" && !keySaved && <p role="alert">Ключ SimpleClaw не сохранён. Откройте настройки.</p>}
                    {catalogError && <p role="alert">Ошибка обновления каталога. {catalog ? "Сохранённый каталог доступен." : "Каталог недоступен."}</p>}
                    {error && <p role="alert">{error}</p>}
                </form>
            </section>
            {selectedArtifact && <ArtifactPanel artifact={selectedArtifact} versions={history.artifacts}
                                                 onSelect={setSelectedArtifactId} onClose={closeArtifact}
                                                 onExport={(id) => void exportArtifact(id)} onError={setError}/>}
            <dialog ref={settingsDialog} className="settings-dialog" aria-labelledby="settings-title"
                    onCancel={(event) => { event.preventDefault(); closeSettings(); }}>
                <header className="settings-header"><h2 id="settings-title">Настройки</h2>
                    <button type="button" className="secondary-button" onClick={closeSettings}>Закрыть</button></header>
                <section className="settings-section" aria-labelledby="connection-title">
                    <h3 id="connection-title">Подключение</h3>
                    <label htmlFor="api-key">Ключ SimpleClaw · {keySaved ? "сохранён" : "не сохранён"}</label>
                    <input id="api-key" type="password" value={key} autoComplete="off"
                           onChange={(event) => setKey(event.target.value)} placeholder="Введите ключ"/>
                    <div className="settings-actions">
                        <button type="button" className="secondary-button" disabled={!key.trim() || busy}
                                onClick={() => void saveKey()}>Сохранить ключ</button>
                        {keySaved && <button type="button" className="secondary-button" disabled={busy}
                                             onClick={() => void deleteKey()}>Удалить ключ</button>}
                    </div>
                </section>
                <section className="settings-section" aria-labelledby="appearance-title">
                    <h3 id="appearance-title">Внешний вид</h3>
                    <label htmlFor="theme">Тема</label>
                    <select id="theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                        <option value="system">Системная</option><option value="light">Светлая</option><option value="dark">Тёмная</option>
                    </select>
                </section>
                <section className="settings-section" aria-labelledby="data-title">
                    <h3 id="data-title">Данные</h3>
                    <button type="button" className="secondary-button" disabled={busy}
                            onClick={() => void createBackup()}>Создать копию</button>
                    <label htmlFor="backup">Резервные копии</label>
                    <select id="backup" value={selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)}>
                        <option value="">Выберите копию</option>
                        {backups.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <button type="button" className="secondary-button" disabled={busy || !selectedBackup}
                            onClick={() => void restoreBackup()}>Восстановить</button>
                </section>
                {error && <p role="alert">{error}</p>}
            </dialog>
        </main>
    );
}

createRoot(document.getElementById("root")!).render(<App/>);
