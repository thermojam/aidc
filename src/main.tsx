import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {Channel, invoke} from "@tauri-apps/api/core";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {getCurrentWebview} from "@tauri-apps/api/webview";
import {listen} from "@tauri-apps/api/event";
import {isPermissionGranted, onAction, requestPermission, sendNotification} from "@tauri-apps/plugin-notification";
import MarkdownMessage from "./MarkdownMessage";
import ArtifactPanel, {type ArtifactVersion} from "./ArtifactPanel";
import {Button} from "./components/ui/button";
import {Dialog, DialogContent, DialogTitle} from "./components/ui/dialog";
import {NativeSelect} from "./components/ui/native-select";
import {OperationNotice, OperationToaster, useOperationErrors, type ErrorArea, AnswerFailure, notify} from "./OperationErrors";
import RenderBoundary from "./RenderBoundary";
import ProjectSidebar, {type Conversation, type Project, type ProjectGroup} from "./ProjectSidebar";
import ShellIcon from "./ShellIcon";
import ModelPicker from "./ModelPicker";
import {generationCommand} from "./modelSource";
import {useNavigationLayout} from "./useNavigationLayout";
import "./style.css";

type Message = { id: number; parent_id: number | null; role: "user" | "assistant"; content: string; status: string };
type Attachment = { message_id: number; name: string; mime: string; size: number; sha256: string };
type PendingAttachment = { id: number; name: string; mime: string; size: number; sha256: string; preview: string };
type DropResult = {name: string; attachment: PendingAttachment | null; error: string | null};
type ContextMessage = { role: string; content: string; source_message_id: number | null; attachment_ids: number[] };
type AgentSource = { relative_path: string; line: number; excerpt: string };
type AgentSkill = { material_id: number; name: string; version: number; size: number; sha256: string; instructions: string; enabled: boolean };
type ContextPreview = {
    confirmation_id: string;
    model_id: string;
    response_style: "concise" | "balanced" | "detailed";
    catalog_fetched_at: number | null;
    input_rubles_per_million: number | null;
    output_rubles_per_million: number | null;
    messages: ContextMessage[];
    omitted_exchanges: number;
    bytes: number;
    request_bytes: number;
    agent_sources?: AgentSource[];
    project_search_enabled?: boolean;
    agent_files_read?: string[];
    agent_skill?: AgentSkill | null;
    warning: string
};
type CatalogModel = {
    id: string;
    name: string;
    input_rubles_per_million: number | null;
    output_rubles_per_million: number | null;
    protocols: string[];
    request_rubles: number | null;
    audio_rubles_per_minute: number | null
};
type ModelCatalog = { fetched_at: number; models: CatalogModel[] };
type GeneratedImage = { model_id: string; price_rubles: number; data_url: string };
type CapturedSnapshot = { mime: string; size: number; sha256: string; preview: string };
type TranscriptionResult = { text: string };
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
type ProjectMaterial = { id: number; name: string; version: number; size: number; sha256: string };
type ProjectFolderFile = { relative_path: string; size: number | null; blocked_reason: string | null };
type ProjectFolderView = { folder_name: string; max_entries: number; max_file_bytes: number; files: ProjectFolderFile[] };
type SyntheticTask = { id: number; title: string; status: "awaiting_approval" | "completed" | "denied"; created_at: number;
    steps: { id: number; ordinal: number; action: string; decision: "pending" | "approved" | "denied"; result: string | null }[] };
type ScheduledAgentTask = { id: number; conversation_id: number; title: string; prompt: string; interval_minutes: number; next_run_at: number; status: "active" | "awaiting_confirmation" | "stopped"; due_at: number | null };
type PreparedScheduledAgentTask = {prompt: string; run_id: number};
type ScheduledAgentRun = {id: number; title: string; due_at: number; notified_at: number | null};
type ScheduledAgentResult = {title: string; content: string};
type AgentBoard = {
    plan: {id: number; ordinal: number; action: string; status: "pending" | "completed"}[];
    queue: {id: number; text: string; status: "queued" | "submitted"}[];
    steering: {id: number; text: string; status: "pending" | "submitted"}[];
};
type BoardInputSource = {kind: "queue" | "steering"; id: number; text: string};

const statusLabel: Record<string, string> = {
    interrupted: "Ответ прерван",
    stopped: "Остановлено",
    failed: "Ошибка",
    streaming: "Ответ продолжается",
};
const categoryLabel: Record<string, string> = {
    thinking: "Мышление", speed: "Скорость", economy: "Экономия", other: "Остальные"
};

function App() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [projectGroups, setProjectGroups] = useState<ProjectGroup[]>([]);
    const [projectFilter, setProjectFilter] = useState<number | null>(null);
    const [materialsOpen, setMaterialsOpen] = useState(false);
    const [materialPreview, setMaterialPreview] = useState<PendingAttachment | null>(null);
    const materialsTrigger = useRef<HTMLButtonElement>(null);
    const materialsBack = useRef<HTMLButtonElement>(null);
    const materialRequest = useRef(0);
    const [materialsLoading, setMaterialsLoading] = useState(false);
    const [projectMaterials, setProjectMaterials] = useState<ProjectMaterial[]>([]);
    const materialListProject = useRef<number | null>(null);
    const [projectFolderView, setProjectFolderView] = useState<ProjectFolderView | null>(null);
    const [folderPreview, setFolderPreview] = useState<PendingAttachment | null>(null);
    const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([]);
    const renamePending = useRef(false);
    const [renameTarget, setRenameTarget] = useState<{kind: "project" | "conversation" | "group"; id: number; title: string} | null>(null);
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
    const [createConversationConfirm, setCreateConversationConfirm] = useState(false);
    const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
    const confirmationResolve = useRef<((confirmed: boolean) => void) | null>(null);
    const confirmationTrigger = useRef<HTMLElement | null>(null);
    const [composerToolsOpen, setComposerToolsOpen] = useState(false);
    const [composerSettingsOpen, setComposerSettingsOpen] = useState(false);
    const composerMenu = useRef<HTMLDivElement>(null);
    const composerMenuButton = useRef<HTMLButtonElement>(null);
    const [closeVoiceConfirm, setCloseVoiceConfirm] = useState(false);
    const [replaceVoiceConfirm, setReplaceVoiceConfirm] = useState(false);
    const [transcriptionConfirm, setTranscriptionConfirm] = useState(false);
    const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState("");
    const historyRef = useRef<HTMLDivElement>(null);
    const historyAtBottom = useRef(true);
    const [showNewMessages, setShowNewMessages] = useState(false);
    useLayoutEffect(() => {
        historyAtBottom.current = true;
        setShowNewMessages(false);
    }, [conversationId]);
    useLayoutEffect(() => {
        const element = historyRef.current;
        if (element && historyAtBottom.current) element.scrollTop = element.scrollHeight;
    }, [history, draft, busy, conversationId]);
    const {errors, report, clear} = useOperationErrors(conversationId);
    const [backups, setBackups] = useState<string[]>([]);
    const [selectedBackup, setSelectedBackup] = useState("");
    const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
    const [draggingFiles, setDraggingFiles] = useState(false);
    const [dropResults, setDropResults] = useState<{batch: number; name: string; status: string}[]>([]);
    const [dropLoading, setDropLoading] = useState(false);
    const dropBusy = useRef(false);
    const pickerBusy = useRef(false);
    const chatPanel = useRef<HTMLElement>(null);
    const dropState = useRef({busy, conversationId, slots: 5});
    dropState.current = {busy: busy || materialsOpen, conversationId, slots: Math.max(0, 5 - pendingAttachments.length - selectedMaterialIds.length)};
    const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
    const [categories, setCategories] = useState<ModelCategory[]>([]);

    const [modelId, setModelId] = useState("local-mock");
    const [modelSource, setModelSource] = useState<"simpleclaw" | "ollama">("simpleclaw");
    const currentModelSource = useRef(modelSource);
    currentModelSource.current = modelSource;
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [ollamaStatus, setOllamaStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const ollamaRequest = useRef(0);
    const [agentMode, setAgentMode] = useState(false);
    const [agentSkill, setAgentSkill] = useState<AgentSkill | null>(null);
    const [responseStyle, setResponseStyle] = useState<ContextPreview["response_style"]>("balanced");
    const [syntheticTasks, setSyntheticTasks] = useState<SyntheticTask[]>([]);
    const [view, setView] = useState<"chat" | "tasks" | "image">("chat");
    const tasksView = view === "tasks";
    const imageView = view === "image";
    const setTasksView = (open: boolean) => setView(open ? "tasks" : "chat");
    const imageBack = useRef<HTMLButtonElement>(null);
    const tasksBack = useRef<HTMLButtonElement>(null);
    const scheduledResultRequest = useRef(0);
    const [scheduledTasks, setScheduledTasks] = useState<ScheduledAgentTask[]>([]);
    const [scheduledRuns, setScheduledRuns] = useState<ScheduledAgentRun[]>([]);
    const [scheduledDraft, setScheduledDraft] = useState<PreparedScheduledAgentTask | null>(null);
    const [openedScheduledResult, setOpenedScheduledResult] = useState<ScheduledAgentResult | null>(null);
    const [scheduleNotificationsEnabled, setScheduleNotificationsEnabled] = useState(localStorage.getItem("scheduleNotifications") === "enabled");
    const [notificationListenerReady, setNotificationListenerReady] = useState(false);
    const [notificationTaskId, setNotificationTaskId] = useState<number | null>(null);
    const notifiedDueTasks = useRef(new Set<string>());
    const notifiedRuns = useRef(new Set<number>());
    const [scheduleTitle, setScheduleTitle] = useState("");
    const [schedulePrompt, setSchedulePrompt] = useState("");
    const [scheduleInterval, setScheduleInterval] = useState("60");
    const [agentBoard, setAgentBoard] = useState<AgentBoard>({plan: [], queue: [], steering: []});
    const [planDraft, setPlanDraft] = useState("");
    const [queueDraft, setQueueDraft] = useState("");
    const [steeringDraft, setSteeringDraft] = useState("");
    const [boardInputSource, setBoardInputSource] = useState<BoardInputSource | null>(null);
    const [imagePrompt, setImagePrompt] = useState("");
    const [imageModelId, setImageModelId] = useState("");
    const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null);
    const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
    const [imageSaved, setImageSaved] = useState(false);
    const [imageSaving, setImageSaving] = useState(false);
    const imageSavePending = useRef(false);
    const [uncertainImageSignatures, setUncertainImageSignatures] = useState<Set<string>>(new Set());
    const imageRequestPending = useRef(false);
    const [voiceOpen, setVoiceOpen] = useState(false);
    const [voicePreparation, setVoicePreparation] = useState<"microphone" | "audio" | null>(null);
    const voicePreparing = voicePreparation !== null;
    const permissionRequest = useRef(0);
    const voicePending = useRef(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const cancelRecording = useRef(false);
    const [recording, setRecording] = useState(false);
    const [recordedAudio, setRecordedAudio] = useState<{id: string; base64: string; mime: string; seconds: number} | null>(null);
    const [transcriptionText, setTranscriptionText] = useState("");
    const [transcriptionAvailable, setTranscriptionAvailable] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [uncertainTranscription, setUncertainTranscription] = useState("");
    const snapshotGeneration = useRef(0);
    const [choosingWindow, setChoosingWindow] = useState(false);
    const [captureNotice, setCaptureNotice] = useState("");
    const [capturedSnapshot, setCapturedSnapshot] = useState<CapturedSnapshot | null>(null);
    const [transcriptionModelId, setTranscriptionModelId] = useState("");
    const recorder = useRef<MediaRecorder | null>(null);
    const recordingStream = useRef<MediaStream | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const audioSize = useRef(0);
    const [key, setKey] = useState("");
    const [keySaved, setKeySaved] = useState(false);
    const [contextPreview, setContextPreview] = useState<ContextPreview | null>(null);
    const [previewSignature, setPreviewSignature] = useState("");
    const [selectedArtifactId, setSelectedArtifactId] = useState<number | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState("");
    const [slashDismissed, setSlashDismissed] = useState(false);
    const [slashIndex, setSlashIndex] = useState(0);
    const [mentionDismissed, setMentionDismissed] = useState(false);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [promptCaret, setPromptCaret] = useState(0);
    const checkAfterSlash = useRef(false);
    const navigation = useNavigationLayout();
    const focusPromptOnSheetClose = useRef(false);
    const closeNavigationSheet = useRef(() => {});
    closeNavigationSheet.current = () => { if (navigation.modal) navigation.setOpen(false); };
    const [recentIds, setRecentIds] = useState<number[]>(() => {
        try { const saved = JSON.parse(localStorage.getItem("navigation.recent") ?? "[]"); return Array.isArray(saved) ? saved.filter(Number.isInteger).slice(0, 10) : []; }
        catch { return []; }
    });
    useEffect(() => {
        if (!conversations.some((item) => item.id === conversationId && !item.archived)) return;
        setRecentIds((previous) => {
            const next = [conversationId, ...previous.filter((id) => id !== conversationId)].slice(0, 10);
            return next;

        });
    }, [conversationId, conversations]);
    useEffect(() => { localStorage.setItem("navigation.recent", JSON.stringify(recentIds)); }, [recentIds]);
    const settingsButton = useRef<HTMLButtonElement>(null);
    const compactSettingsButton = useRef<HTMLButtonElement>(null);
    const paletteInput = useRef<HTMLInputElement>(null);
    const paletteTrigger = useRef<HTMLElement | null>(null);
    const settingsTrigger = useRef<HTMLElement | null>(null);
    const chatSearchField = navigation.search;
    const artifactTrigger = useRef<HTMLElement | null>(null);
    const promptField = useRef<HTMLTextAreaElement>(null);
    const activeConversation = useRef(conversationId);
    activeConversation.current = conversationId;
    const currentModel = useRef(modelId);
    currentModel.current = modelId;
    const navigationRequest = useRef(0);
    const conversationGeneration = useRef(0);
    const generationRequest = useRef(0);
    const catalogRequest = useRef(0);
    const historyRequest = useRef(0);
    const boardRequest = useRef(0);
    const skillRequest = useRef(0);
    const contextRequest = useRef(0);
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem("appearance");
        return saved === "light" || saved === "dark" ? saved : "system";
    });

    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        function applyTheme() {
            document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
        }
        applyTheme();
        localStorage.setItem("appearance", theme);
        media.addEventListener("change", applyTheme);
        return () => media.removeEventListener("change", applyTheme);
    }, [theme]);

    useEffect(() => {
        let disposed = false;
        const cleanups: (() => void)[] = [];
        const register = (promise: Promise<() => void>) => void promise.then((unlisten) => disposed ? unlisten() : cleanups.push(unlisten));
        const inChat = (x: number, y: number) => {
            const rect = chatPanel.current?.getBoundingClientRect();
            const scale = window.devicePixelRatio;
            return !!rect && x / scale >= rect.left && x / scale < rect.right && y / scale >= rect.top && y / scale < rect.bottom;
        };
        register(getCurrentWebview().onDragDropEvent(({payload}) => {
            if (payload.type === "leave" || payload.type === "drop") setDraggingFiles(false);
            else setDraggingFiles(inChat(payload.position.x, payload.position.y));
        }));
        register(listen<{sequence: number; x: number; y: number; names: string[]}>("attachment-drop", async ({payload}) => {
            if (!inChat(payload.x, payload.y) || dropState.current.busy || dropBusy.current || pickerBusy.current) {
                if (inChat(payload.x, payload.y)) setDropResults((current) => [...current, ...payload.names.map((name) => ({batch: payload.sequence, name, status: "Дождитесь завершения текущего действия и повторите"}))]);
                void invoke("accept_dropped_files", {sequence: payload.sequence, slots: 0}).catch(() => {});
                return;
            }
            dropBusy.current = true;
            setDropLoading(true);
            setDropResults(payload.names.map((name) => ({batch: payload.sequence, name, status: "Проверка…"})));
            setContextPreview(null);
            const {conversationId: target, slots} = dropState.current;
            try {
                const results = await invoke<DropResult[]>("accept_dropped_files", {sequence: payload.sequence, slots});
                const attachments = results.flatMap((item) => item.attachment ? [item.attachment] : []);
                if (disposed || target !== activeConversation.current) {
                    await Promise.all(attachments.map((item) => invoke("remove_text_attachment", {id: item.id})));
                } else {
                    setPendingAttachments((current) => [...current, ...attachments]);
                    setContextPreview(null);
                    setDropResults((current) => [...results.map((item) => ({batch: payload.sequence, name: item.name, status: item.error ?? "Добавлен"})), ...current.filter((item) => item.batch !== payload.sequence)]);
                }
            } catch {
                if (!disposed) setDropResults((current) => [...payload.names.map((name) => ({batch: payload.sequence, name, status: "Не удалось проверить файл"})), ...current.filter((item) => item.batch !== payload.sequence)]);
            } finally {
                dropBusy.current = false;
                if (!disposed) setDropLoading(false);
            }
        }));
        return () => { disposed = true; cleanups.forEach((unlisten) => unlisten()); };
    }, []);

    useEffect(() => {
        function onShortcut(event: KeyboardEvent) {
            const target = event.target;
            const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
            if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || paletteOpen || settingsOpen) return;
            const shortcut = event.key.toLowerCase();
            const dialogs = document.querySelectorAll('[role="dialog"], dialog[open]');
            if (dialogs.length && !(shortcut === "b" && dialogs.length === 1 && dialogs[0].classList.contains("navigation-sheet"))) return;
            if (shortcut === "k" && typing) return;
            if (!["k", "n", "b", ","].includes(shortcut)) return;
            event.preventDefault();
            if (shortcut === "b") navigation.setOpen(!navigation.open);
            else if (shortcut === "n") void createConversation();
            else if (shortcut === ",") { settingsTrigger.current = target instanceof HTMLElement ? target : null; setSettingsOpen(true); }
            else { paletteTrigger.current = target instanceof HTMLElement ? target : null; setPaletteQuery(""); setPaletteOpen(true); }
        }
        window.addEventListener("keydown", onShortcut);
        return () => window.removeEventListener("keydown", onShortcut);
    });

    function closePalette() {
        setPaletteOpen(false);
    }

    function closeSettings() {
        setSettingsOpen(false);
    }

    async function reload(id = conversationId) {
        if (id !== activeConversation.current) return;
        const request = ++historyRequest.current;
        const next = await invoke<History>("list_history", {conversationId: id});
        if (request === historyRequest.current && id === activeConversation.current) { setHistory(next); clear("history"); }
    }

    async function refreshConversations() {
        const items = await invoke<Conversation[]>("list_conversations");
        setConversations(items);
        return items;
    }

    async function refreshSyntheticTasks() {
        setSyntheticTasks(await invoke<SyntheticTask[]>("list_synthetic_tasks"));
    }

    async function refreshScheduledTasks() {
        setScheduledTasks(await invoke<ScheduledAgentTask[]>("list_scheduled_agent_tasks"));
    }

    async function refreshScheduledRuns() {
        setScheduledRuns(await invoke<ScheduledAgentRun[]>("list_scheduled_agent_runs"));
    }

    async function enableScheduleNotifications() {
        try {
            const granted = await isPermissionGranted() || await requestPermission() === "granted";
            if (!granted) { report("enableScheduleNotifications", "Уведомления запрещены в настройках системы."); return; }
            localStorage.setItem("scheduleNotifications", "enabled");
            setScheduleNotificationsEnabled(true);
            clear("enableScheduleNotifications");
        } catch (reason) { report("enableScheduleNotifications", reason); }
    }

    async function createScheduledTask() {
        try {
            await invoke("create_scheduled_agent_task", {conversationId, title: scheduleTitle, prompt: schedulePrompt, intervalMinutes: Number(scheduleInterval)});
            setScheduleTitle(""); setSchedulePrompt("");
            await refreshScheduledTasks();
            clear("createScheduledTask");
        } catch (reason) { report("createScheduledTask", reason); }
    }

    async function stopScheduledTask(taskId: number) {
        try { await invoke("stop_scheduled_agent_task", {taskId}); await refreshScheduledTasks(); clear("stopScheduledTask"); }
        catch (reason) { report("stopScheduledTask", reason); }
    }

    function confirmAction(message: string): Promise<boolean> {
        if (confirmationResolve.current) return Promise.resolve(false);
        confirmationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        return new Promise((resolve) => {
            confirmationResolve.current = resolve;
            setConfirmationMessage(message);
        });
    }

    function finishConfirmation(confirmed: boolean) {
        const resolve = confirmationResolve.current;
        confirmationResolve.current = null;
        setConfirmationMessage(null);
        resolve?.(confirmed);
    }

    async function prepareScheduledTask(task: ScheduledAgentTask) {
        if (busy) return;
        if (!await confirmAction(`Задача «${task.title}» наступила по расписанию. Продолжить и поместить её в черновик? При переходе текущий черновик, несохранённые записи плана и файлы будут убраны. Платный запрос не отправится. Проверьте модель, контекст и стоимость, затем отправьте вручную.`)) return;
        try {
            if (task.conversation_id !== conversationId && !await switchConversation(task.conversation_id, true)) return;
            const prepared = await invoke<PreparedScheduledAgentTask>("prepare_scheduled_agent_task", {taskId: task.id});
            if (task.conversation_id !== activeConversation.current || modelId !== currentModel.current || modelSource !== currentModelSource.current) return;
            setPrompt(prepared.prompt);
            setScheduledDraft(prepared);
            setModelSource("simpleclaw");
            setModelId("gpt-oss-20b");
            setAgentMode(true);
            setContextPreview(null);
            setSelectedArtifactId(null);
            setTasksView(false);
            requestAnimationFrame(() => promptField.current?.focus());
            await refreshScheduledTasks();
            clear("prepareScheduledTask");
        } catch (reason) { report("prepareScheduledTask", reason); }
    }

    async function refreshAgentBoard(id = conversationId) {
        const request = ++boardRequest.current;
        const board = await invoke<AgentBoard>("get_agent_board", {conversationId: id});
        if (request === boardRequest.current && id === activeConversation.current) { setAgentBoard(board); clear("agentBoard"); }
    }

    async function refreshAgentSkill(id = conversationId) {
        const request = ++skillRequest.current;
        const skill = await invoke<AgentSkill | null>("get_agent_skill", {conversationId: id});
        if (request === skillRequest.current && id === activeConversation.current) { setAgentSkill(skill); clear("agentSkill"); }
    }

    async function saveAgentSkill(materialId: number | null, enabled: boolean) {
        try {
            await invoke("set_agent_skill", {conversationId, materialId, enabled});
            if (conversationId === activeConversation.current) {
                await refreshAgentSkill(conversationId);
                setContextPreview(null);
            }
            clear("saveAgentSkill");
        } catch (reason) { report("saveAgentSkill", reason); }
    }

    async function addPlanStep() {
        try {
            await invoke("add_agent_plan_step", {conversationId, action: planDraft});
            if (conversationId === activeConversation.current) setPlanDraft("");
            if (conversationId === activeConversation.current) await refreshAgentBoard(conversationId);
            clear("addPlanStep");
        } catch (reason) { report("addPlanStep", reason); }
    }

    async function completePlanStep(stepId: number) {
        try {
            await invoke("complete_agent_plan_step", {conversationId, stepId});
            if (conversationId === activeConversation.current) await refreshAgentBoard(conversationId);
            clear("completePlanStep");
        } catch (reason) { report("completePlanStep", reason); }
    }

    async function addBoardInput(kind: "queue" | "steering") {
        const text = kind === "queue" ? queueDraft : steeringDraft;
        try {
            await invoke(kind === "queue" ? "add_agent_queue_item" : "add_agent_steering_note",
                {conversationId, [kind === "queue" ? "request" : "note"]: text});
            if (conversationId === activeConversation.current) {
                if (kind === "queue") setQueueDraft(""); else setSteeringDraft("");
                await refreshAgentBoard(conversationId);
            }
            clear("addBoardInput");
        } catch (reason) { report("addBoardInput", reason); }
    }

    function useBoardInput(kind: "queue" | "steering", item: {id: number; text: string; status: string}) {
        if (item.status !== (kind === "queue" ? "queued" : "pending")) return;
        if (prompt.length + (prompt ? 1 : 0) + item.text.length > 2000) return;
        const nextPrompt = prompt ? `${prompt}\n${item.text}` : item.text;
        setPrompt(nextPrompt);
        setBoardInputSource({kind, id: item.id, text: nextPrompt.trim()});
        setContextPreview(null);
        requestAnimationFrame(() => promptField.current?.focus());
    }

    async function startSyntheticTask() {
        try {
            await invoke("start_synthetic_task");
            await refreshSyntheticTasks();
            clear("startSyntheticTask");
        } catch (reason) { report("startSyntheticTask", reason); }
    }

    async function decideSyntheticStep(taskId: number, stepId: number, decision: "approve" | "deny") {
        try {
            await invoke(decision === "approve" ? "approve_synthetic_step" : "deny_synthetic_step", {taskId, stepId});
            await refreshSyntheticTasks();
            clear("decideSyntheticStep");
        } catch (reason) { report("decideSyntheticStep", reason); }
    }

    async function generateImage() {
        const selectedImageModelId = selectedImageModel?.id || "";
        const model = catalog?.models.find((item) => item.id === selectedImageModelId);
        if (!model || !model.protocols.includes("images_generations") || model.request_rubles === null) return;
        const signature = JSON.stringify([selectedImageModelId, imagePrompt.trim()]);
        if (imageRequestPending.current || imageSavePending.current || uncertainImageSignatures.has(signature)) return;
        if (!await confirmAction(`Отправить запрос в SimpleClaw?\nМодель: ${model.name} (${model.id})\nЦена: ${model.request_rubles} ₽ за успешный запрос. Автоповтора не будет.`)) return;
        imageRequestPending.current = true;
        setImageGenerationBusy(true);
        setGeneratedImage(null);
        setImageSaved(false);
        clear("generateImage");
        try {
            setGeneratedImage(await invoke<GeneratedImage>("generate_image", {
                modelId: selectedImageModelId, prompt: imagePrompt, expectedPriceRubles: model.request_rubles
            }));
        } catch (reason) {
            const message = String(reason);
            if (message.includes("NETWORK_RESULT_UNKNOWN") || message.includes("GENERATION_RESULT_UNKNOWN") || /GENERATION_HTTP_5\d\d/.test(message)) {
                setUncertainImageSignatures((current) => new Set(current).add(signature));
                report("generateImage", "Результат генерации неизвестен; запрос мог быть принят и оплачен. Для продолжения измените описание или модель, чтобы не повторить тот же запрос.");
            } else if (message.includes("Цена изменилась")) {
                try {
                    setCatalog(await invoke<ModelCatalog>("refresh_models"));
                    report("generateImage", "Цена каталога изменилась. Проверьте новую сумму, затем подтвердите запрос ещё раз.");
                } catch (refreshReason) { report("generateImage", `Не удалось обновить цену: ${String(refreshReason)}`); }
            } else report("generateImage", message);
        }
        finally { imageRequestPending.current = false; setImageGenerationBusy(false); }
    }

    async function saveGeneratedImage() {
        if (!generatedImage || imageSavePending.current) return;
        imageSavePending.current = true;
        setImageSaving(true);
        setImageSaved(false);
        clear("saveGeneratedImage");
        try {
            const saved = await invoke<boolean>("save_generated_image", {dataUrl: generatedImage.data_url});
            setImageSaved(saved);
        } catch (reason) { report("saveGeneratedImage", reason); }
        finally { imageSavePending.current = false; setImageSaving(false); }
    }

    async function startVoiceRecording(replace = false) {
        if (voicePending.current || transcribing) return;
        if (!replace && (recordedAudio || transcriptionText)) { setReplaceVoiceConfirm(true); return; }
        voicePending.current = true;
        const request = ++permissionRequest.current;
        clear("startVoiceRecording");
        setVoicePreparation("microphone");
        try {
            if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new DOMException("", "NotSupportedError");
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            if (request !== permissionRequest.current) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            recordingStream.current = stream;
            audioChunks.current = [];
            audioSize.current = 0;
            cancelRecording.current = false;
            const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? {mimeType: "audio/webm;codecs=opus"} : {};
            const nextRecorder = new MediaRecorder(stream, options);
            recorder.current = nextRecorder;
            nextRecorder.ondataavailable = (event) => {
                if (!event.data.size) return;
                audioSize.current += event.data.size;
                if (audioSize.current <= 25 * 1024 * 1024) audioChunks.current.push(event.data);
                else {
                    report("startVoiceRecording", "Запись превысила 25 МиБ и удалена. Попробуйте короче.");
                    if (nextRecorder.state === "recording") nextRecorder.stop();
                }
            };
            nextRecorder.onstop = () => {
                stream.getTracks().forEach((track) => track.stop());
                recordingStream.current = null;
                setRecording(false);
                setVoicePreparation("audio");
                if (cancelRecording.current) { audioChunks.current = []; voicePending.current = false; setVoicePreparation(null); return; }
                if (audioSize.current > 25 * 1024 * 1024) { setRecordedAudio(null); voicePending.current = false; setVoicePreparation(null); return; }
                const seconds = Math.min(600, (Date.now() - startedAt.current) / 1000);
                void new Blob(audioChunks.current, {type: nextRecorder.mimeType}).arrayBuffer().then((buffer) => {
                    const bytes = new Uint8Array(buffer);
                    let binary = "";
                    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                    setRecordedAudio({id: crypto.randomUUID(), base64: btoa(binary), mime: nextRecorder.mimeType.split(";")[0] || "audio/webm", seconds});
                }).catch(() => report("startVoiceRecording", "Не удалось подготовить запись."))
                    .finally(() => { voicePending.current = false; setVoicePreparation(null); });
            };
            startedAt.current = Date.now();
            nextRecorder.start(1000);
            setRecordedAudio(null);
            setTranscriptionText("");
            setTranscriptionAvailable(false);
            setRecording(true);
            setVoicePreparation(null);
            window.setTimeout(() => { if (recorder.current === nextRecorder && nextRecorder.state === "recording") nextRecorder.stop(); }, 600_000);
        } catch (reason) {
            if (request !== permissionRequest.current) return;
            voicePending.current = false;
            setVoicePreparation(null);
            recordingStream.current?.getTracks().forEach((track) => track.stop());
            recordingStream.current = null;
            report("startVoiceRecording", reason);
        }
    }

    const voiceAtRisk = useRef(false);
    voiceAtRisk.current = recording || voicePreparing || !!recordedAudio || !!transcriptionText || transcribing;
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let disposed = false;
        void getCurrentWindow().onCloseRequested((event) => {
            if (voiceAtRisk.current || voicePending.current) { event.preventDefault(); setCloseVoiceConfirm(true); }
        }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
        return () => { disposed = true; unlisten?.(); };
    }, []);

    useEffect(() => {
        if (!composerToolsOpen) return;
        composerMenu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        function dismiss(event: PointerEvent) {
            if (!composerMenu.current?.contains(event.target as Node) && !composerMenuButton.current?.contains(event.target as Node)) setComposerToolsOpen(false);
        }
        document.addEventListener("pointerdown", dismiss);
        return () => document.removeEventListener("pointerdown", dismiss);
    }, [composerToolsOpen]);

    const startedAt = useRef(0);

    useEffect(() => {
        if (!recording) return;
        setRecordingSeconds(0);
        const timer = window.setInterval(() => setRecordingSeconds(Math.min(600, Math.floor((Date.now() - startedAt.current) / 1000))), 1000);
        return () => window.clearInterval(timer);
    }, [recording]);

    useEffect(() => () => {
        permissionRequest.current++;
        if (recorder.current?.state === "recording") recorder.current.stop();
        recordingStream.current?.getTracks().forEach((track) => track.stop());
    }, []);

    function stopVoiceRecording() {
        if (recorder.current?.state === "recording") recorder.current.stop();
    }

    async function transcribeVoice(confirmed = false) {
        if (!recordedAudio || voicePending.current || transcribing) return;
        const model = selectedTranscriptionModel;
        if (!model || model.audio_rubles_per_minute === null || !model.protocols.includes("audio_transcriptions")) return;
        const signature = recordedAudio.id;
        if (uncertainTranscription === signature) return;
        if (!confirmed) { setTranscriptionConfirm(true); return; }
        setTranscribing(true);
        clear("transcribeVoice");
        try {
            const result = await invoke<TranscriptionResult>("transcribe_audio", {
                modelId: model.id, audioBase64: recordedAudio.base64, mimeType: recordedAudio.mime,
                durationSeconds: recordedAudio.seconds, expectedRatePerMinute: model.audio_rubles_per_minute
            });
            setTranscriptionText(result.text);
            setTranscriptionAvailable(true);
            setRecordedAudio(null);
        } catch (reason) {
            const message = String(reason);
            if (message.includes("UNKNOWN") || /TRANSCRIPTION_HTTP_5\d\d/.test(message)) {
                setUncertainTranscription(signature);
                report("transcribeVoice", "Результат распознавания неизвестен; запрос мог быть принят и оплачен. Автоповтора нет.");
            } else if (message.includes("Ставка изменилась")) {
                try { setCatalog(await invoke<ModelCatalog>("refresh_models")); report("transcribeVoice", "Тариф изменился. Обновите оценку и подтвердите отправку снова."); }
                catch (refreshReason) { report("transcribeVoice", `Не удалось обновить тариф: ${String(refreshReason)}`); }
            } else report("transcribeVoice", message);
        } finally { setTranscribing(false); }
    }

    async function refreshOllamaCatalog() {
        const request = ++ollamaRequest.current;
        setOllamaStatus("loading");
        try {
            const models = await invoke<string[]>("list_ollama_models");
            if (request === ollamaRequest.current) { setOllamaModels(models); setOllamaStatus("ready"); }
        } catch { if (request === ollamaRequest.current) { setOllamaModels([]); setOllamaStatus("error"); } }
    }

    async function refreshModelCatalog() {
        const request = ++catalogRequest.current;
        try {
            const result = await invoke<ModelCatalog>("refresh_models");
            if (request !== catalogRequest.current) return;
            setCatalog(result);
            if (currentModelSource.current === "simpleclaw") setContextPreview(null);
            clear("catalog");
        } catch (reason) { if (request === catalogRequest.current) report("catalog", reason); }
    }

    async function refreshProjects() {
        const [items, groups] = await Promise.all([invoke<Project[]>("list_projects"), invoke<ProjectGroup[]>("list_project_groups")]);
        setProjects(items);
        setProjectGroups(groups);
        return items;
    }

    useEffect(() => {
        const query = conversationSearch.trim();
        if (!query) { setSearchMatches(null); return; }
        let current = true;
        const timer = window.setTimeout(() => {
            invoke<Conversation[]>("search_conversations", {query, projectFilter})
                .then((items) => { if (current) setSearchMatches(items.map((item) => item.id)); })
                .catch((reason) => { if (current) report("search", reason); });
        }, 150);
        return () => { current = false; window.clearTimeout(timer); };
    }, [conversationSearch, conversations, projectFilter]);

    const currentConversation = conversations.find((item) => item.id === conversationId && !item.archived);
    const conversationProjectId = projects.find((item) => item.id === currentConversation?.project_id && !item.archived)?.id ?? null;
    const activeMaterialProject = useRef(conversationProjectId);
    activeMaterialProject.current = conversationProjectId;
    const eligibleSkills = projectMaterials.filter((material) => material.name.toLowerCase().endsWith(".md") && material.size > 0 && material.size <= 16 * 1024);
    useEffect(() => {
        let current = true;
        setSelectedMaterialIds([]);
        setContextPreview(null);
        setFolderPreview(null);
        setMaterialPreview(null);
        setMaterialsLoading(false);
        setMaterialsOpen(false);
        materialRequest.current++;
        materialListProject.current = null;
        setProjectMaterials([]);
        setProjectFolderView(null);
        if (conversationProjectId === null) {
            setProjectMaterials([]);
            setProjectFolderView(null);
            return () => { current = false; };
        }
        invoke<ProjectMaterial[]>("list_project_materials", {projectId: conversationProjectId})
            .then((items) => { if (current) { materialListProject.current = conversationProjectId; setProjectMaterials(items); } })
            .catch((reason) => { if (current) report("materials", reason); });
        return () => { current = false; };
    }, [conversationProjectId, conversationId]);

    useEffect(() => {
        refreshConversations().then((items) => {
            if (!items.some((item) => item.id === activeConversation.current && !item.archived)) {
                setConversationId(items.find((item) => !item.archived)?.id ?? items[0]?.id ?? 1);
            }
        }).catch((reason) => report("navigation", reason));
        refreshProjects().catch((reason) => report("projects", reason));
        invoke<string[]>("list_backups").then(setBackups).catch((reason) => report("backups", reason));
        invoke<ModelCatalog | null>("list_models").then((cached) => { setCatalog((current) => current ?? cached); }).catch(() => {
            // The concurrent refresh reports catalog failure; a late cache read must not replace its result.
        });
        invoke<ContextPreview["response_style"]>("get_response_style").then(setResponseStyle).catch((reason) => report("responseStyle", reason));
        invoke<ModelCategory[]>("list_model_categories").then(setCategories).catch((reason) => report("categories", reason));
        invoke<boolean>("key_status").then(setKeySaved).catch((reason) => report("keyStatus", reason));
        invoke<SyntheticTask[]>("list_synthetic_tasks").then(setSyntheticTasks).catch((reason) => report("syntheticTasks", reason));
        invoke<ScheduledAgentTask[]>("list_scheduled_agent_tasks").then(setScheduledTasks).catch((reason) => report("scheduledTasks", reason));
        invoke<ScheduledAgentRun[]>("list_scheduled_agent_runs").then(setScheduledRuns).catch((reason) => report("scheduledRuns", reason));

        void refreshModelCatalog();
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            invoke<ScheduledAgentTask[]>("list_scheduled_agent_tasks").then(setScheduledTasks).catch((reason) => report("scheduledTasks", reason));
            invoke<ScheduledAgentRun[]>("list_scheduled_agent_runs").then(setScheduledRuns).catch((reason) => report("scheduledRuns", reason));
        }, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        let active = true;
        let listener: Awaited<ReturnType<typeof onAction>> | null = null;
        onAction((event) => {
            if (event.actionId !== "tap") return;
            closeNavigationSheet.current();
            const runId = event.notification?.extra?.scheduledRunId;
            if (typeof runId === "number") {
                setTasksView(true);
                void getCurrentWindow().show().then(() => getCurrentWindow().setFocus()).catch((reason) => report("notifications", reason));
                const request = ++scheduledResultRequest.current;
                void invoke<ScheduledAgentResult>("get_scheduled_agent_result", {runId}).then((result) => { if (request === scheduledResultRequest.current) setOpenedScheduledResult(result); }).catch((reason) => { if (request === scheduledResultRequest.current) report("scheduledRuns", reason); });
                return;
            }
            const taskId = event.notification?.extra?.scheduledTaskId;
            if (typeof taskId === "number") {
                setTasksView(true);
                scheduledResultRequest.current++;
                void getCurrentWindow().show().then(() => getCurrentWindow().setFocus()).catch((reason) => report("scheduledRuns", reason));
                setNotificationTaskId(taskId);
            }
        }).then((registered) => {
            if (!active) void registered.unregister();
            else { listener = registered; setNotificationListenerReady(true); }
        }).catch((reason) => report("notifications", reason));
        return () => { active = false; if (listener) void listener.unregister(); };
    }, []);

    useEffect(() => {
        if (!scheduleNotificationsEnabled || !notificationListenerReady) return;
        let active = true;
        isPermissionGranted().then((granted) => {
            if (!active || !granted) return;
            for (const task of scheduledTasks) {
                if (task.status !== "awaiting_confirmation" || task.due_at === null) continue;
                const key = `${task.id}:${task.due_at}`;
                if (notifiedDueTasks.current.has(key)) continue;
                notifiedDueTasks.current.add(key);
                sendNotification({title: "Пора подтвердить задачу", body: "Откройте приложение, чтобы просмотреть её.", extra: {scheduledTaskId: task.id}});
            }
        }).catch((reason) => report("notifications", reason));
        return () => { active = false; };
    }, [scheduledTasks, scheduleNotificationsEnabled, notificationListenerReady]);

    useEffect(() => {
        if (!scheduleNotificationsEnabled || !notificationListenerReady) return;
        let active = true;
        isPermissionGranted().then((granted) => {
            if (!active || !granted) return;
            for (const run of scheduledRuns) {
                if (run.notified_at !== null || notifiedRuns.current.has(run.id)) continue;
                try {
                    sendNotification({title: "Агентная задача завершена", body: "Откройте приложение, чтобы посмотреть результат.", extra: {scheduledRunId: run.id}});
                    notifiedRuns.current.add(run.id);
                    void invoke("mark_scheduled_agent_run_notified", {runId: run.id}).catch((reason) => report("notifications", reason));
                } catch (reason) { report("notifications", reason); }
            }
        }).catch((reason) => report("notifications", reason));
        return () => { active = false; };
    }, [scheduledRuns, scheduleNotificationsEnabled, notificationListenerReady]);

    useEffect(() => {
        if (notificationTaskId === null || !scheduledTasks.some((task) => task.id === notificationTaskId && task.status === "awaiting_confirmation")) return;
        const notice = document.getElementById(`scheduled-task-${notificationTaskId}`);
        notice?.scrollIntoView({block: "center"});
        notice?.querySelector<HTMLButtonElement>("button")?.focus();
        setNotificationTaskId(null);
    }, [notificationTaskId, scheduledTasks, tasksView]);

    useEffect(() => {
        if (!openedScheduledResult) return;
        document.getElementById("scheduled-task-result")?.scrollIntoView({block: "center"});
    }, [openedScheduledResult, tasksView]);

    useEffect(() => {
        reload(conversationId).catch((reason) => report("history", reason));
        refreshAgentBoard(conversationId).catch((reason) => report("agentBoard", reason));
        refreshAgentSkill(conversationId).catch((reason) => report("agentSkill", reason));
    }, [conversationId]);

    async function switchConversation(id: number, discardConfirmed = false) {
        if (busy || dropBusy.current) return false;
        if (id === conversationId) { if (navigation.modal) navigation.setOpen(false); return true; }
        if (!discardConfirmed && (prompt.trim() || pendingAttachments.length || capturedSnapshot || planDraft.trim() || queueDraft.trim() || steeringDraft.trim()) && !await confirmAction("Перейти в другую беседу? Черновик, несохранённые записи плана и выбранные файлы будут убраны.")) return false;
        const request = ++navigationRequest.current;
        try {
            for (const attachment of pendingAttachments) await invoke("remove_text_attachment", {id: attachment.id});
            if (request !== navigationRequest.current) return false;
            setPendingAttachments([]);
            setDropResults([]);
            setPrompt("");
            setScheduledDraft(null);
            discardSnapshot();
            setBoardInputSource(null);
            boardRequest.current++;
            skillRequest.current++;
            setAgentBoard({plan: [], queue: [], steering: []});
            setAgentSkill(null);
            setPlanDraft(""); setQueueDraft(""); setSteeringDraft("");
            contextRequest.current++;
            setContextPreview(null);
            setSelectedArtifactId(null);
            if (navigation.modal && navigation.open) {
                focusPromptOnSheetClose.current = true;
                navigation.setOpen(false);
            }
            historyRequest.current++;
            setHistory({messages: [], attachments: [], artifacts: [], active_leaf_id: null, contexts: [], attempts: []});
            conversationGeneration.current++;
            activeConversation.current = id;
            setConversationId(id);
            setDraft("");
            return true;
        } catch (reason) { report("switchConversation", reason); return false; }
    }

    async function createConversation(draftForConfirmation = prompt, confirmed = false) {
        if (busy || dropBusy.current) return;
        if (!confirmed && (draftForConfirmation.trim() || pendingAttachments.length || capturedSnapshot || planDraft.trim() || queueDraft.trim() || steeringDraft.trim())) { setCreateConversationConfirm(true); return; }
        try {
            const id = await invoke<number>("create_conversation");
            if (projectFilter && projectFilter > 0) await invoke("move_conversation", {conversationId: id, projectId: projectFilter});
            await refreshConversations();
            if (await switchConversation(id, true)) { setTasksView(false); requestAnimationFrame(() => promptField.current?.focus()); }
            clear("createConversation");
        } catch (reason) { report("createConversation", reason); }
    }

    async function saveRename() {
        if (!renameTarget || renamePending.current) return;
        renamePending.current = true;
        let operation = renameTarget.kind === "group" && renameTarget.id === 0 ? "createGroup" : "saveRename";
        try {
            if (renameTarget.kind === "conversation") {
                await invoke("rename_conversation", {conversationId: renameTarget.id, title: renameTarget.title});
                await refreshConversations();
            } else if (renameTarget.kind === "group") {
                if (renameTarget.id === 0) {
                    await invoke("create_project_group", {title: renameTarget.title});
                    setRenameTarget(null);
                    clear(operation);
                    operation = "projects";
                } else await invoke("rename_project_group", {id: renameTarget.id, title: renameTarget.title});
                await refreshProjects();
            } else {
                await invoke("rename_project", {id: renameTarget.id, title: renameTarget.title});
                await refreshProjects();
            }
            setRenameTarget(null);
            clear(operation);
        } catch (reason) { report(operation, reason); }
        finally { renamePending.current = false; }
    }

    async function updateResponseStyle(style: ContextPreview["response_style"]) {
        try {
            await invoke("set_response_style", {style});
            setResponseStyle(style);
            setContextPreview(null);
            clear("updateResponseStyle");
        } catch (reason) { report("updateResponseStyle", reason); }
    }

    async function archiveConversation(item: Conversation) {
        if (busy) return;
        if (item.id === conversationId && !item.archived && (prompt.trim() || pendingAttachments.length || capturedSnapshot || planDraft.trim() || queueDraft.trim() || steeringDraft.trim())
            && !await confirmAction("Архивировать беседу? Черновик, несохранённые записи плана и выбранные файлы будут убраны.")) return;
        try {
            await invoke("archive_conversation", {conversationId: item.id, archived: !item.archived});
            const items = await refreshConversations();
            clear("archiveConversation");
            if (item.id === conversationId && !item.archived) {
                let nextId = items.find((candidate) => !candidate.archived)?.id;
                if (!nextId) {
                    nextId = await invoke<number>("create_conversation");
                    await refreshConversations();
                }
                await switchConversation(nextId, true);
            }
        } catch (reason) { report("archiveConversation", reason); }
    }

    async function togglePin(item: Conversation) {
        try {
            await invoke("set_conversation_pinned", {conversationId: item.id, pinned: !item.pinned});
            await refreshConversations();
            clear("togglePin");
        } catch (reason) { report("togglePin", reason); }
    }

    async function createProject() {
        try {
            const id = await invoke<number>("create_project");
            await refreshProjects();
            setProjectFilter(id);
            clear("createProject");
        } catch (reason) { report("createProject", reason); }
    }

    async function deleteProjectGroup(group: ProjectGroup) {
        if (!await confirmAction(`Удалить группу «${group.title}»? Проекты и беседы сохранятся, проекты останутся без группы.`)) return;
        try {
            await invoke("delete_project_group", {id: group.id});
            await refreshProjects();
            clear("projectGroups");
        } catch (reason) { report("projectGroups", reason); }
    }

    async function moveProjectToGroup(id: number, groupId: number | null) {
        try {
            await invoke("move_project_to_group", {id, groupId});
            await refreshProjects();
            clear("projectGroups");
        } catch (reason) { report("projectGroups", reason); }
    }

    async function archiveProject(item: Project) {
        try {
            await invoke("archive_project", {id: item.id, archived: !item.archived});
            await refreshProjects();
            if (!item.archived && projectFilter === item.id) setProjectFilter(null);
            clear("archiveProject");
        } catch (reason) { report("archiveProject", reason); }
    }

    async function moveConversation(projectId: number | null, id = conversationId) {
        if (busy) return;
        try {
            await invoke("move_conversation", {conversationId: id, projectId});
            await refreshConversations();
            if (id === conversationId) setProjectFilter(projectId ?? 0);
            clear("moveConversation");
        } catch (reason) { report("moveConversation", reason); }
    }

    async function openMaterials() {
        if (conversationProjectId === null) return;
        setMaterialsOpen(true);
        requestAnimationFrame(() => materialsBack.current?.focus());
        await refreshMaterials();
    }

    function closeMaterials() {
        setMaterialsOpen(false);
        requestAnimationFrame(() => materialsTrigger.current?.focus());
    }

    async function refreshMaterials() {
        if (conversationProjectId === null) return;
        const request = ++materialRequest.current;
        setMaterialsLoading(true);
        setFolderPreview(null);
        setMaterialPreview(null);
        const current = () => request === materialRequest.current && conversationId === activeConversation.current && conversationProjectId === activeMaterialProject.current;
        await Promise.all([
            invoke<ProjectMaterial[]>("list_project_materials", {projectId: conversationProjectId})
                .then((items) => { if (current()) { materialListProject.current = conversationProjectId; setProjectMaterials(items); clear("materials"); } })
                .catch((reason) => { if (current()) { setProjectMaterials([]); report("materials", reason); } }),
            invoke<ProjectFolderView | null>("list_project_folder", {projectId: conversationProjectId})
                .then((folder) => { if (current()) { setProjectFolderView(folder); clear("folder"); } })
                .catch((reason) => { if (current()) { setProjectFolderView(null); report("folder", reason); } })
        ]);
        if (current()) setMaterialsLoading(false);
    }

    async function previewMaterial(materialId: number) {
        const request = ++materialRequest.current;
        setMaterialPreview(null);
        try {
            const result = await invoke<PendingAttachment>("preview_project_material", {conversationId, materialId});
            if (request !== materialRequest.current || conversationId !== activeConversation.current || conversationProjectId !== activeMaterialProject.current) return;
            setMaterialPreview(result);
            clear("previewMaterial");
        } catch (reason) { if (request === materialRequest.current) report("previewMaterial", reason); }
    }

    async function addProjectMaterial() {
        if (conversationProjectId === null) return;
        try {
            const attachment = await invoke<PendingAttachment | null>("pick_text_attachment", {allowDuplicate: true});
            if (!attachment) return;
            const material = await invoke<ProjectMaterial>("save_project_material", {projectId: conversationProjectId, attachmentId: attachment.id});
            if (conversationId !== activeConversation.current || conversationProjectId !== activeMaterialProject.current) return;
            materialListProject.current = conversationProjectId;
            setProjectMaterials((items) => [...items.filter((item) => item.id !== material.id), material]);
            setContextPreview(null);
            clear("addProjectMaterial");
        } catch (reason) { report("addProjectMaterial", reason); }
    }

    async function chooseProjectFolder() {
        if (conversationProjectId === null) return;
        try {
            const chosen = await invoke<string | null>("choose_project_folder", {projectId: conversationProjectId});
            if (!chosen) return;
            const folder = await invoke<ProjectFolderView | null>("list_project_folder", {projectId: conversationProjectId});
            if (conversationId !== activeConversation.current || conversationProjectId !== activeMaterialProject.current) return;
            setProjectFolderView(folder);
            setFolderPreview(null);
            clear("chooseProjectFolder");
        } catch (reason) { report("chooseProjectFolder", reason); }
    }

    async function previewProjectFile(relativePath: string) {
        if (conversationProjectId === null) return;
        const request = ++materialRequest.current;
        try {
            setFolderPreview(null);
            const result = await invoke<PendingAttachment>("preview_project_file", {projectId: conversationProjectId, relativePath});
            if (conversationId !== activeConversation.current || conversationProjectId !== activeMaterialProject.current) return;
            if (request !== materialRequest.current) return;
            setFolderPreview(result);
            clear("previewProjectFile");
        } catch (reason) { report("previewProjectFile", reason); }
    }

    async function saveFolderPreview() {
        if (conversationProjectId === null || !folderPreview) return;
        try {
            const material = await invoke<ProjectMaterial>("save_project_folder_material", {
                projectId: conversationProjectId, relativePath: folderPreview.name, expectedSha256: folderPreview.sha256
            });
            if (conversationId !== activeConversation.current || conversationProjectId !== activeMaterialProject.current) return;
            materialListProject.current = conversationProjectId;
            setProjectMaterials((items) => [...items, material]);
            setFolderPreview(null);
            clear("saveFolderPreview");
        } catch (reason) { report("saveFolderPreview", reason); }
    }

    async function createBackup() {
        try {
            await invoke<string>("create_backup");
            setBackups(await invoke<string[]>("list_backups"));
            clear("createBackup", "Резервная копия создана");
        } catch (reason) {
            report("createBackup", reason);
        }
    }

    async function restoreBackup() {
        if (!selectedBackup || busy || !await confirmAction(`Восстановить копию ${selectedBackup}? Текущая история будет сохранена отдельной копией. Выбранные файлы и несохранённые записи плана, очереди и уточнений будут убраны.`)) return;
        try {
            await invoke("restore_backup", {name: selectedBackup});
            conversationGeneration.current++;
            discardSnapshot();
            scheduledResultRequest.current++;
            setOpenedScheduledResult(null);
            setScheduledDraft(null);
            setNotificationTaskId(null);
            setScheduledTasks([]);
            setScheduledRuns([]);
            notifiedDueTasks.current.clear();
            notifiedRuns.current.clear();
            await Promise.all([refreshScheduledTasks(), refreshScheduledRuns()]);
            const items = await refreshConversations();
            await refreshProjects();
            setProjectFilter(null);
            const nextId = items.some((item) => item.id === conversationId && !item.archived)
                ? conversationId : items.find((item) => !item.archived)?.id ?? items[0]?.id ?? 1;
            boardRequest.current++;
            skillRequest.current++;
            setAgentBoard({plan: [], queue: [], steering: []});
            setAgentSkill(null);
            setPlanDraft(""); setQueueDraft(""); setSteeringDraft(""); setBoardInputSource(null);
            activeConversation.current = nextId;
            setConversationId(nextId);
            await Promise.all([refreshAgentBoard(nextId), refreshAgentSkill(nextId), refreshSyntheticTasks()]);
            await reload(nextId);
            setCatalog(await invoke<ModelCatalog | null>("list_models"));
            setCategories(await invoke<ModelCategory[]>("list_model_categories"));
            setModelSource("simpleclaw");
            setModelId("local-mock");
            setPendingAttachments([]);
            setSelectedArtifactId(null);
            setContextPreview(null);
            setBackups(await invoke<string[]>("list_backups"));
            clear("restoreBackup", "Резервная копия восстановлена");
        } catch (reason) {
            report("restoreBackup", reason);
        }
    }

    async function saveKey() {
        try {
            await invoke("save_key", {key});
            setKey("");
            setKeySaved(true);
            clear("saveKey", "Ключ сохранён");
        } catch (reason) { report("saveKey", reason); }
    }

    async function deleteKey() {
        try {
            await invoke("delete_key");
            setKeySaved(false);
            clear("deleteKey", "Ключ удалён");
        } catch (reason) { report("deleteKey", reason); }
    }

    async function runGeneration(command: string, args: Record<string, unknown>, restorePrompt?: string): Promise<boolean> {
        if (busy || currentModelSource.current === "ollama") return false;
        const request = ++generationRequest.current;
        setBusy(true);
        clear("runGeneration");
        setDraft("");
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
                if (message.data.status === "failed" || message.data.status === "interrupted") {
                    notify("Не удалось завершить ответ. Полученный текст сохранён. Без usage расход неизвестен; подробности у ответа.", `attempt:${message.data.attempt_id}`, Infinity);
                }
                void reload().then(() => {
                    if (request === generationRequest.current && conversationId === activeConversation.current) setDraft("");
                }).catch((reason) => report("history", reason));
                refreshScheduledRuns().catch((reason) => report("scheduledRuns", reason));
            }
        };
        try {
            await invoke<number>(command, {conversationId, ...args, onEvent: channel});
            if (request !== generationRequest.current || conversationId !== activeConversation.current) return false;
            await reload();
            return true;
        } catch (reason) {
            if (request !== generationRequest.current || conversationId !== activeConversation.current) return false;
            if (frame) cancelAnimationFrame(frame);
            setBusy(false);
            if (restorePrompt !== undefined) setPrompt((current) => current || restorePrompt);
            setContextPreview(null);
            report("runGeneration", reason);
            return false;
        }
    }

    function contextSignature() {
        return JSON.stringify([conversationId, prompt.trim(), pendingAttachments.map((attachment) => attachment.id), selectedMaterialIds, modelSource, modelId, history.active_leaf_id, agentMode, agentSkill?.material_id ?? null, agentSkill?.enabled ?? false, responseStyle, conversationProjectId]);
    }

    async function submitPrompt() {
        if (busy || dropBusy.current || !prompt.trim() || modelSource === "ollama") return;
        if (!contextPreview?.confirmation_id || previewSignature !== contextSignature()) {
            notify("Проверьте состав запроса. Для отправки нажмите Enter ещё раз или «Отправить».", "composer-check", 6000);
            await checkContext();
            return;
        }
        if ((modelId !== "local-mock" && !keySaved) || (hasImage && !imageModelSupported)) return;
        await send();
    }

    useEffect(() => {
        const field = promptField.current;
        if (!field) return;
        const resize = () => {
            field.style.height = "auto";
            field.style.height = `${Math.min(field.scrollHeight, 8 * 18 + 8)}px`;
        };
        resize();
        const observer = new ResizeObserver(() => {
            if (field.clientWidth !== width) { width = field.clientWidth; resize(); }
        });
        let width = field.clientWidth;
        observer.observe(field);
        return () => observer.disconnect();
    }, [prompt]);

    async function send() {
        const value = prompt.trim();
        const signature = contextSignature();
        if (!value || busy || modelSource === "ollama" || !contextPreview?.confirmation_id || previewSignature !== signature) return;
        const tools = contextPreview.project_search_enabled ? "калькулятор и поиск по выбранной папке проекта" : "только калькулятор";
        if (agentMode && !await confirmAction(`Агентный режим отправит до двух платных запросов модели. Сейчас проверен только gpt-oss-20b. Доступны: ${tools}; команды недоступны.`)) return;
        if (scheduledDraft && value === scheduledDraft.prompt && (!agentMode || modelId !== "gpt-oss-20b")) {
            report("send", "Для результата задачи по расписанию выберите агентный режим и модель gpt-oss-20b.");
            return;
        }
        if (currentModelSource.current !== modelSource || currentModel.current !== modelId || signature !== liveContextSignature.current) return;
        setPrompt("");
        const ids = pendingAttachments.map((attachment) => attachment.id);
        const inputSource = boardInputSource?.text === value ? boardInputSource : null;
        if (await runGeneration(generationCommand(modelSource, modelId, false)!, {confirmationId: contextPreview.confirmation_id, prompt: value, attachmentIds: ids, projectMaterialIds: selectedMaterialIds, modelId, agentMode, scheduledRunId: scheduledDraft?.prompt === value ? scheduledDraft.run_id : null}, value)) {
            setScheduledDraft(null);
            clear("send");
            if (inputSource) {
                try {
                    await invoke("mark_agent_input_submitted", {conversationId, kind: inputSource.kind, itemId: inputSource.id});
                    setBoardInputSource(null);
                    await refreshAgentBoard();
                } catch (reason) { report("send", reason); }
            }
            setPendingAttachments((current) => current.filter((attachment) => !ids.includes(attachment.id)));
            setSelectedMaterialIds([]);
            setContextPreview(null);
        }
    }

    async function pickAttachment() {
        if (dropBusy.current || pickerBusy.current) return;
        pickerBusy.current = true;
        const generation = conversationGeneration.current;
        try {
            const attachment = await invoke<PendingAttachment | null>("pick_text_attachment");
            if (!attachment) return;
            if (generation !== conversationGeneration.current || conversationId !== activeConversation.current) {
                await invoke("remove_text_attachment", {id: attachment.id});
                return;
            }
            if (attachment) {
                setPendingAttachments((current) => [...current, attachment]);
                setContextPreview(null);
            }
            clear("pickAttachment");
        } catch (reason) {
            report("pickAttachment", reason);
        } finally { pickerBusy.current = false; }
    }

    async function pickImageAttachment() {
        if (dropBusy.current || pickerBusy.current) return;
        pickerBusy.current = true;
        const generation = conversationGeneration.current;
        try {
            const attachment = await invoke<PendingAttachment | null>("pick_image_attachment");
            if (!attachment) return;
            if (attachment) {
                const image = new Image();
                image.src = attachment.preview;
                try { await image.decode(); }
                catch {
                    await invoke("remove_text_attachment", {id: attachment.id});
                    throw new Error("Не удалось декодировать изображение");
                }
                if (image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 16_000_000) {
                    await invoke("remove_text_attachment", {id: attachment.id});
                    throw new Error("Изображение превышает локальный предел 16 мегапикселей");
                }
                if (generation !== conversationGeneration.current || conversationId !== activeConversation.current) {
                    await invoke("remove_text_attachment", {id: attachment.id});
                    return;
                }
                setPendingAttachments((current) => [...current, attachment]);
                setContextPreview(null);
            }
            clear("pickImageAttachment");
        } catch (reason) { report("pickImageAttachment", reason); }
        finally { pickerBusy.current = false; }
    }

    function discardSnapshot() {
        snapshotGeneration.current++;
        setCapturedSnapshot(null);
        setCaptureNotice("");
        clear("captureWindowSnapshot");
    }

    async function captureWindowSnapshot() {
        if (capturedSnapshot || choosingWindow) return;
        const generation = snapshotGeneration.current;
        setChoosingWindow(true);
        clear("captureWindowSnapshot");
        setCaptureNotice("");
        try {
            const snapshot = await invoke<CapturedSnapshot | null>("capture_window_snapshot");
            if (generation !== snapshotGeneration.current || conversationId !== activeConversation.current) return;
            if (snapshot) setCapturedSnapshot(snapshot);
            else setCaptureNotice("Снимок не создан. Если вы не отменяли выбор, проверьте разрешение «Запись экрана» в настройках macOS.");
        } catch (reason) {
            if (generation !== snapshotGeneration.current || conversationId !== activeConversation.current) return;
            report("captureWindowSnapshot", reason);
        } finally { setChoosingWindow(false); }
    }

    async function attachCapturedSnapshot() {
        if (dropBusy.current || pickerBusy.current || !capturedSnapshot || pendingAttachments.length + selectedMaterialIds.length >= 5) return;
        const generation = snapshotGeneration.current;
        pickerBusy.current = true;
        try {
            const attachment = await invoke<PendingAttachment>("add_captured_snapshot", {dataUrl: capturedSnapshot.preview});
            if (generation !== snapshotGeneration.current || conversationId !== activeConversation.current) {
                await invoke("remove_text_attachment", {id: attachment.id});
                return;
            }
            setPendingAttachments((current) => [...current, attachment]);
            setCapturedSnapshot(null);
            setContextPreview(null);
            clear("attachCapturedSnapshot");
        } catch (reason) { report("attachCapturedSnapshot", reason); }
        finally { pickerBusy.current = false; }
    }

    async function removeAttachment(id: number) {
        try {
            await invoke("remove_text_attachment", {id});
            setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
            setContextPreview(null);
            clear("removeAttachment");
        } catch (reason) {
            report("removeAttachment", reason);
        }
    }

    async function retry(assistantId: number) {
        if (modelSource === "ollama") return;
        if (modelId !== "local-mock" && !await confirmAction("Повторить платный запрос? Предыдущий запрос мог быть принят и списан. Расход при обрыве неизвестен.")) return;
        await runGeneration(generationCommand(modelSource, modelId, true)!, {assistantId, modelId});
    }

    async function selectBranch(messageId: number) {
        try {
            await invoke("select_branch", {conversationId, messageId});
            await reload();
            setContextPreview(null);
            clear("selectBranch");
        } catch (reason) {
            report("selectBranch", reason);
        }
    }

    async function changeCategory(category: string) {
        try {
            await invoke("set_model_category", {modelId, category});
            setCategories(await invoke<ModelCategory[]>("list_model_categories"));
            clear("changeCategory");
        } catch (reason) {
            report("changeCategory", reason);
        }
    }

    async function stop() {
        try {
            await invoke("stop_generation");
        } catch (reason) {
            report("stop", reason);
        }
    }

    const liveContextSignature = useRef("");
    liveContextSignature.current = contextSignature();

    async function checkContext() {
        if (dropBusy.current || modelSource === "ollama") return;
        const request = ++contextRequest.current;
        const signature = contextSignature();
        setContextPreview(null);
        try {
            const ids = pendingAttachments.map((attachment) => attachment.id);
            const materialIds = selectedMaterialIds;
            const preview = await invoke<ContextPreview>("preview_context", {conversationId, prompt, attachmentIds: ids, projectMaterialIds: materialIds, modelId, agentMode});
            if (request !== contextRequest.current || signature !== liveContextSignature.current) return;
            setContextPreview(preview);
            setPreviewSignature(signature);
            clear("checkContext");
        } catch (reason) {
            if (request !== contextRequest.current || signature !== liveContextSignature.current) return;
            setContextPreview(null);
            report("checkContext", reason);
        }
    }

    useEffect(() => {
        if (!checkAfterSlash.current) return;
        checkAfterSlash.current = false;
        if (prompt.trim() && !busy) void checkContext();
        else promptField.current?.focus();
    }, [prompt]);

    async function openArtifact(messageId: number, kind: "code" | "html" | "svg", title: string, content: string, trigger: HTMLButtonElement) {
        artifactTrigger.current = trigger;
        try {
            const id = await invoke<number>("create_artifact", {messageId, kind, title, content});
            await reload();
            setSelectedArtifactId(id);
            clear("openArtifact");
        } catch (reason) {
            report("openArtifact", reason);
        }
    }

    async function exportArtifact(id: number) {
        try {
            await invoke("export_artifact", {id});
            clear("exportArtifact");
        } catch (reason) {
            report("exportArtifact", reason);
        }
    }

    function closeArtifact() {
        setSelectedArtifactId(null);
        requestAnimationFrame(() => (artifactTrigger.current?.isConnected ? artifactTrigger.current : promptField.current)?.focus({preventScroll: true}));
    }

    function runCommand(command: string) {
        if (command === "new") {
            void createConversation();
        } else if (command === "search") {
            navigation.setOpen(true);
            requestAnimationFrame(() => chatSearchField.current?.focus());
        } else if (command === "settings") {
            if (navigation.modal) navigation.setOpen(false);
            settingsTrigger.current = paletteTrigger.current;
            setSettingsOpen(true);
        } else if (command === "navigation") {
            navigation.setOpen(!navigation.open);
        } else if (command === "context") {
            if (prompt.trim() && !busy) void checkContext();
            else promptField.current?.focus();
        } else if (command === "attach") {
            requestAnimationFrame(() => void pickAttachment());
        } else if (command === "attach-image") {
            requestAnimationFrame(() => void pickImageAttachment());
        } else if (command === "artifact") {
            const latest = history.artifacts.at(-1);
            if (!latest) { report("runPaletteCommand", "В этой беседе пока нет результатов."); return; }
            artifactTrigger.current = promptField.current;
            setSelectedArtifactId(latest.id);
        }
    }

    const paletteCommands = [
        {id: "new", label: "Новая беседа", shortcut: "⌘N / Ctrl+N"},
        {id: "search", label: "Найти беседу"},
        {id: "context", label: "Проверить контекст"},
        {id: "navigation", label: "Показать или скрыть навигацию", shortcut: "⌘B / Ctrl+B"},
        {id: "settings", label: "Настройки", shortcut: "⌘, / Ctrl+,"},
        {id: "attach", label: "Прикрепить текстовый файл"},
        {id: "attach-image", label: "Прикрепить изображение"},
        {id: "artifact", label: "Открыть последний результат"},
    ].filter((command) => command.label.toLocaleLowerCase().includes(paletteQuery.trim().toLocaleLowerCase()));

    const lineStart = prompt.lastIndexOf("\n", Math.max(0, promptCaret - 1)) + 1;
    const lineEnd = prompt.indexOf("\n", promptCaret);
    const line = prompt.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    const slashQuery = /^\/([^\n]*)$/.exec(line);
    const slashCommands = [
        {id: "new", label: "Новая беседа"},
        {id: "search", label: "Найти беседу"},
        {id: "context", label: "Проверить контекст"},
    ].filter((command) => command.label.toLocaleLowerCase().includes((slashQuery?.[1] ?? "").trim().toLocaleLowerCase()));
    const mentionMatch = /(?:^|\s)@([^@\n]*)$/.exec(prompt.slice(0, promptCaret));
    const mentionStart = mentionMatch ? promptCaret - mentionMatch[1].length - 1 : 0;
    const mentionQuery = (mentionMatch?.[1] ?? "").toLocaleLowerCase();
    const mentionItems = (conversationProjectId !== null
        ? (materialListProject.current === conversationProjectId ? projectMaterials : []).map((item) => ({kind: "material" as const, id: item.id, name: item.name, detail: `версия ${item.version} · ${item.name.includes(".") ? item.name.split(".").pop() : "файл"}`}))
        : pendingAttachments.map((item) => ({kind: "attachment" as const, id: item.id, name: item.name, detail: item.mime})))
        .filter((item) => item.name.toLocaleLowerCase().includes(mentionQuery));
    const mentionOpen = !!mentionMatch && !mentionDismissed;
    const activeMention = Math.min(mentionIndex, mentionItems.length - 1);
    const mentionDisabled = (item: typeof mentionItems[number]) => busy || dropLoading || (item.kind === "material" && !selectedMaterialIds.includes(item.id) && pendingAttachments.length + selectedMaterialIds.length >= 5);
    function chooseMention(item: typeof mentionItems[number]) {
        if (mentionDisabled(item)) return;
        const replacement = "";
        const next = prompt.slice(0, mentionStart) + replacement + prompt.slice(promptCaret);
        if (next.length > 2000) return;
        if (item.kind === "material") setSelectedMaterialIds((ids) => ids.includes(item.id) ? ids : [...ids, item.id]);
        const caret = mentionStart + replacement.length;
        setPrompt(next);
        setPromptCaret(caret);
        setMentionDismissed(true);
        setContextPreview(null);
        requestAnimationFrame(() => { promptField.current?.focus(); promptField.current?.setSelectionRange(caret, caret); });
    }
    useEffect(() => {
        if (mentionOpen && activeMention >= 0) document.getElementById(`mention-${mentionItems[activeMention].kind}-${mentionItems[activeMention].id}`)?.scrollIntoView({block: "nearest"});
    }, [mentionOpen, activeMention, mentionQuery]);
    const slashOpen = !!slashQuery && !mentionOpen && !slashDismissed;
    const activeSlash = Math.min(slashIndex, slashCommands.length - 1);
    const slashRemainder = prompt.slice(0, lineStart) + (lineEnd < 0 ? "" : prompt.slice(lineEnd + 1));
    const slashDisabled = (command: string) => (busy && ["new", "context"].includes(command)) || (command === "context" && !slashRemainder.trim());

    function runSlashCommand(command: string) {
        setSlashDismissed(true);
        if (command === "new") { void createConversation(slashRemainder); return; }
        if (command === "context") checkAfterSlash.current = true;
        setPrompt(slashRemainder);
        setContextPreview(null);
        if (command !== "context") runCommand(command);
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
    const artifactSide = navigation.viewport >= 48 + (navigation.open && !navigation.modal ? navigation.width : 0) + 560 + 360;
    const selectedConversation = conversations.find((item) => item.id === conversationId);
    const imageModels = catalog?.models.filter((model) => model.protocols.includes("images_generations")) ?? [];
    const selectedImageModel = imageModels.find((model) => model.id === imageModelId) ?? imageModels[0];
    const transcriptionModels = catalog?.models.filter((model) => model.protocols.includes("audio_transcriptions") && model.audio_rubles_per_minute !== null) ?? [];
    const selectedTranscriptionModel = transcriptionModels.find((model) => model.id === transcriptionModelId) ?? transcriptionModels[0];
    const selectedModel = catalog?.models.find((model) => model.id === modelId);
    const hasImage = pendingAttachments.some((attachment) => attachment.mime.startsWith("image/"));
    const imageModelSupported = modelId === "gpt-6-luna";
    const selectedCategory = categories.find((item) => item.model_id === modelId);
    function follows(message: Message, ancestorId: number): boolean {
        for (let parentId = message.parent_id; parentId !== null;) {
            if (parentId === ancestorId) return true;
            parentId = byId.get(parentId)?.parent_id ?? null;
        }
        return false;
    }
    function operationErrors(area: ErrorArea, operations?: string[]) {
        return errors.filter((error) => error.area === area && (!operations || operations.some((operation) => error.id.endsWith(`:${operation}`)))).map((error) => <OperationNotice key={error.id} error={error}>
            {area === "connection" && <Button type="button" onClick={() => setSettingsOpen(true)}>Настройки подключения</Button>}
            {area === "catalog" && error.id.endsWith(":catalog") && <>
                <p>{catalog ? `Каталог устарел. Сохранённый список от ${new Date(catalog.fetched_at * 1000).toLocaleString()} доступен.` : "Не удалось загрузить модели. Локальный тест остаётся доступным."}</p>
                <Button type="button" onClick={() => void refreshModelCatalog()}>Обновить каталог</Button>
            </>}
            {error.id.endsWith(":categories") && <Button type="button" onClick={() => void invoke<ModelCategory[]>("list_model_categories").then((items) => {
                setCategories(items); clear("categories");
            }).catch((reason) => report("categories", reason))}>Загрузить категории</Button>}
            {error.id.endsWith(":changeCategory") && <p>Выберите категорию ещё раз в сведениях модели.</p>}
            {error.id.endsWith(":history") && <Button type="button" onClick={() => void reload().catch((reason) => report("history", reason))}>Загрузить историю заново</Button>}
        </OperationNotice>);
    }
    const sidebar = <ProjectSidebar conversations={conversations} projects={projects} groups={projectGroups} selectedId={conversationId}
        projectFilter={projectFilter} busy={busy} query={conversationSearch} matches={searchMatches} recentIds={recentIds}
        searchRef={chatSearchField} onQuery={setConversationSearch} onFilter={(id) => { setProjectFilter(id); setSearchMatches(null); }}
        onSelect={(id) => void switchConversation(id).then((switched) => { if (switched) setTasksView(false); })} onNew={() => void createConversation()} onNewProject={() => void createProject()}
        onNewGroup={() => setRenameTarget({kind: "group", id: 0, title: ""})} onDeleteGroup={(group) => void deleteProjectGroup(group)} onMoveProject={(id, groupId) => void moveProjectToGroup(id, groupId)}
        onRename={setRenameTarget} onArchive={(item) => void archiveConversation(item)} onPin={(item) => void togglePin(item)}
        onArchiveProject={(item) => void archiveProject(item)} onMove={(id, projectId) => void moveConversation(projectId, id)}>
        {operationErrors("navigation")}
    </ProjectSidebar>;
    return (
        <main className={`app-shell${tasksView || imageView ? " tasks-view-open" : ""}${selectedArtifact && !tasksView && !imageView ? ` with-artifact${artifactSide ? " artifact-side" : ""}` : ""}${navigation.open && !navigation.modal ? " navigation-open" : ""}`}
              style={{"--navigation-width": `${navigation.width}px`} as React.CSSProperties}>
            <nav className="app-dock" aria-label="Разделы приложения">
                <button type="button" className={`dock-button${view === "chat" ? " dock-current" : ""}`} aria-label="Беседы" aria-current={view === "chat" ? "page" : undefined} title="Беседы · ⌘B / Ctrl+B"
                        onClick={(event) => { if (view !== "chat") setTasksView(false); else navigation.setOpen(!navigation.open, event.currentTarget); }}><ShellIcon name="chat"/></button>
                <button type="button" className={`dock-button${tasksView ? " dock-current" : ""}`} aria-label={scheduledTasks.some((task) => task.status === "awaiting_confirmation") ? "Задачи: ожидают подтверждения" : "Задачи"} aria-current={tasksView ? "page" : undefined} title="Задачи" onClick={() => { setTasksView(true); requestAnimationFrame(() => tasksBack.current?.focus()); }}><ShellIcon name="clock"/>{scheduledTasks.some((task) => task.status === "awaiting_confirmation") && <span className="task-indicator" aria-hidden="true"/>}</button>
                <button type="button" className={`dock-button${imageView ? " dock-current" : ""}`} aria-label="Генерация изображений" aria-current={imageView ? "page" : undefined} title="Генерация изображений" onClick={() => { setView("image"); requestAnimationFrame(() => imageBack.current?.focus()); }}><ShellIcon name="image"/></button>
                <button ref={settingsButton} type="button" className="dock-button dock-settings" aria-label="Настройки" title="Настройки · ⌘, / Ctrl+,"
                        onClick={() => setSettingsOpen(true)}><ShellIcon name="settings"/></button>
            </nav>
            {!navigation.modal && navigation.open && <aside className="project-sidebar" aria-label="Навигация">
                <div className="navigation-heading"><strong>Беседы</strong><button type="button" className="navigation-menu" aria-label="Скрыть навигацию" onClick={() => navigation.setOpen(false)}><ShellIcon name="panel"/></button></div>
                {sidebar}
                <div className="navigation-resizer" role="separator" aria-label="Ширина навигации" aria-orientation="vertical" tabIndex={0}
                     aria-valuemin={220} aria-valuemax={320} aria-valuenow={navigation.width}
                     onKeyDown={(event) => {
                         if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                         event.preventDefault(); navigation.resizeWidth(event.key === "Home" ? 220 : event.key === "End" ? 320 : navigation.width + (event.key === "ArrowRight" ? 10 : -10));
                     }} onPointerDown={(event) => { if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId); }}
                     onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) navigation.resizeWidth(event.clientX - 48); }}
                     onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}/>
            </aside>}
            <Dialog open={navigation.modal && navigation.open} onOpenChange={navigation.setOpen}>
                <DialogContent className="navigation-sheet top-0 left-12 translate-x-0 translate-y-0" aria-describedby={undefined}
                               onOpenAutoFocus={(event) => { event.preventDefault(); chatSearchField.current?.focus(); }}
                               onCloseAutoFocus={(event) => {
                                   event.preventDefault();
                                   if (tasksView) tasksBack.current?.focus();
                                   else if (imageView) imageBack.current?.focus();
                                   else if (focusPromptOnSheetClose.current) promptField.current?.focus();
                                   else navigation.restoreFocus();
                                   focusPromptOnSheetClose.current = false;
                               }}>
                    <div className="navigation-heading"><DialogTitle>Беседы</DialogTitle><button type="button" className="navigation-menu" aria-label="Закрыть навигацию" onClick={() => navigation.setOpen(false)}><ShellIcon name="close"/></button></div>
                    {navigation.modal && sidebar}
                    <button type="button" className="secondary-button" onClick={() => { navigation.setOpen(false); setTasksView(true); }}>Задачи{scheduledTasks.some((task) => task.status === "awaiting_confirmation") ? " · ожидают подтверждения" : ""}</button>
                    <button type="button" className="secondary-button" onClick={() => { navigation.setOpen(false); setView("image"); }}>Генерация изображений</button>
                    <button type="button" className="secondary-button sheet-settings" onClick={() => { navigation.setOpen(false); setSettingsOpen(true); }}>Настройки</button>
                </DialogContent>
            </Dialog>
            <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
                <DialogContent className="navigation-actions" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); (chatSearchField.current ?? navigation.trigger.current)?.focus(); }}>
                    <DialogTitle>{renameTarget?.kind === "group" && renameTarget.id === 0 ? "Создать группу" : `Переименовать ${renameTarget?.kind === "project" ? "проект" : renameTarget?.kind === "group" ? "группу" : "беседу"}`}</DialogTitle>
                    {renameTarget && <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void saveRename(); }}>
                        <label htmlFor="rename-title">Название</label><input id="rename-title" maxLength={80} value={renameTarget.title} onChange={(event) => setRenameTarget({...renameTarget, title: event.target.value})}/>
                        <Button type="submit" disabled={!renameTarget.title.trim()}>Сохранить</Button><Button type="button" onClick={() => setRenameTarget(null)}>Отмена</Button>
                    </form>}
                </DialogContent>
            </Dialog>
            <section ref={chatPanel} className={`chat-panel${draggingFiles ? " file-dragging" : ""}`} aria-label={selectedConversation?.title ?? "Беседа"}>
                {draggingFiles && <div className="file-drop-hint" role="status">Добавить файлы в сообщение</div>}
                <header className="chat-header">
                    <button ref={navigation.trigger} type="button" className="navigation-menu navigation-toggle" aria-label={scheduledTasks.some((task) => task.status === "awaiting_confirmation") ? "Открыть навигацию: задачи ожидают подтверждения" : "Открыть навигацию"} aria-expanded={navigation.open} title="Навигация · ⌘B / Ctrl+B"
                            onClick={(event) => navigation.setOpen(!navigation.open, event.currentTarget)}><ShellIcon name="panel"/>{scheduledTasks.some((task) => task.status === "awaiting_confirmation") && <span className="compact-task-indicator" aria-hidden="true"/>}</button>
                    <h1>{selectedConversation?.title ?? "Беседа"}</h1>
                    <select className="conversation-project" aria-label="Проект беседы" value={selectedConversation?.project_id ?? 0}
                            disabled={busy || !selectedConversation} onChange={(event) => void moveConversation(Number(event.target.value) || null)}>
                        <option value={0}>Без проекта</option>
                        {projects.filter((item) => !item.archived || item.id === selectedConversation?.project_id)
                            .map((item) => <option key={item.id} value={item.id}>{item.title}{item.archived ? " (архив)" : ""}</option>)}
                    </select>
                    {conversationProjectId !== null && <button ref={materialsTrigger} type="button" className="secondary-button" aria-expanded={materialsOpen}
                            onClick={() => materialsOpen ? closeMaterials() : void openMaterials()}>Материалы</button>}
                    <button ref={compactSettingsButton} type="button" className="secondary-button compact-settings"
                            onClick={() => setSettingsOpen(true)}>Настройки</button>
                </header>
                    {materialsOpen && conversationProjectId !== null && <section className="project-materials" aria-label="Материалы проекта">
                        <div className="project-materials-heading"><button ref={materialsBack} type="button" className="secondary-button" onClick={closeMaterials}>Назад к беседе</button><button type="button" className="secondary-button" disabled={materialsLoading || busy} onClick={() => void refreshMaterials()}>Обновить материалы</button></div>
                        <h2>{projects.find((item) => item.id === conversationProjectId)?.title} · Материалы</h2>
                        <p>Выберите версии для следующего запроса. Вместе с вложениями — не больше пяти. Добавление в библиотеку само по себе ничего не отправляет.</p>
                        {operationErrors("attachment")}
                        {materialsLoading && <p role="status">Загрузка материалов…</p>}
                        <div className="project-materials-heading">
                            <h3>Библиотека версий</h3>
                            <button type="button" className="secondary-button" disabled={busy || materialsLoading}
                                    onClick={() => void addProjectMaterial()}>Добавить материал</button>
                        </div>
                        <div className="project-folder-heading">
                            <span>{projectFolderView ? `Папка: ${projectFolderView.folder_name} · только первый уровень · максимум ${projectFolderView.max_entries} элементов, ${Math.round(projectFolderView.max_file_bytes / 1024)} КБ на файл` : "Папка проекта не выбрана"}</span>
                            <button type="button" className="secondary-button" disabled={busy || materialsLoading} onClick={() => void chooseProjectFolder()}>
                                {projectFolderView ? "Сменить папку" : "Выбрать папку"}
                            </button>
                        </div>
                        {projectFolderView?.files.map((file) => <div className="project-folder-file" key={file.relative_path}>
                            <span>{file.relative_path} · {file.size === null ? "размер неизвестен" : `${file.size} Б`}{file.blocked_reason ? ` · ${file.blocked_reason}` : ""}</span>
                            {file.blocked_reason === null && <button type="button" className="secondary-button" disabled={busy || materialsLoading}
                                    onClick={() => void previewProjectFile(file.relative_path)}>Просмотр</button>}
                        </div>)}
                        {projectFolderView && !projectFolderView.files.length && <p>Поддерживаемых файлов в корне папки нет.</p>}
                        {folderPreview && <details open className="folder-preview">
                            <summary>{folderPreview.name} · {folderPreview.size} Б · SHA-256 {folderPreview.sha256}</summary>
                            <pre>{folderPreview.preview}</pre>
                            <button type="button" className="secondary-button" disabled={busy || materialsLoading} onClick={() => void saveFolderPreview()}>
                                Добавить эту версию в материалы
                            </button>
                        </details>}
                        {projectMaterials.map((material) => <div className="project-material" key={material.id}><label>
                            <input type="checkbox" checked={selectedMaterialIds.includes(material.id)} disabled={busy || dropLoading || materialsLoading || (!selectedMaterialIds.includes(material.id) && pendingAttachments.length + selectedMaterialIds.length >= 5)}
                                   onChange={(event) => {
                                       setSelectedMaterialIds((ids) => event.target.checked ? (pendingAttachments.length + ids.length < 5 && !ids.includes(material.id) ? [...ids, material.id] : ids) : ids.filter((id) => id !== material.id));
                                       setContextPreview(null);
                                   }}/>
                            <span>{material.name} · версия {material.version} · {material.size} Б · SHA-256 {material.sha256}</span>
                        </label><button type="button" className="secondary-button" disabled={busy || materialsLoading} onClick={() => void previewMaterial(material.id)}>Просмотр {material.name} · версия {material.version}</button></div>)}
                        {!projectMaterials.length && <p>В проекте пока нет материалов.</p>}
                        {materialPreview && <section className="folder-preview" aria-label="Сохранённая версия">
                            <h3>{materialPreview.name}</h3><p>{materialPreview.size} Б · SHA-256 {materialPreview.sha256}</p>
                            <pre>{materialPreview.preview}</pre>
                        </section>}
                    </section>}
                <div className="conversation-view" hidden={materialsOpen}>
                <div className="history" aria-label="История сообщений" role="region" ref={historyRef} onScroll={(event) => {
                    const element = event.currentTarget;
                    historyAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
                    setShowNewMessages(!historyAtBottom.current);
                }}>
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
                                <RenderBoundary key={message.id} sourceText={message.content}><MarkdownMessage content={message.content} messageId={message.id} onArtifact={(id, kind, title, content, trigger) => void openArtifact(id, kind, title, content, trigger)}/></RenderBoundary> :
                                <p>{message.content}</p>}
                            {history.attachments.filter((attachment) => attachment.message_id === message.id).map((attachment) => (
                                <small
                                    key={attachment.sha256 + attachment.name}>{attachment.mime.startsWith("image/") ? "Изображение" : "Файл"}: {attachment.name} · {attachment.size} Б
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
                            {message.role === "assistant" && (message.status === "interrupted" || message.status === "failed") && (() => {
                                const attempt = history.attempts.find((item) => item.assistant_id === message.id);
                                return <AnswerFailure key={`${message.id}:${message.status}`} assistantId={message.id} status={message.status}
                                    code={attempt?.error_code ?? null} httpStatus={attempt?.http_status ?? null} requestId={attempt?.server_request_id ?? null}
                                    onConnection={() => setSettingsOpen(true)}/>;
                            })()}
                            {message.role === "assistant" && (() => {
                                const context = history.contexts.find((item) => item.assistant_id === message.id)?.context;
                                const sources = context?.agent_sources ?? [];
                                const filesRead = context?.agent_files_read ?? [];
                                return filesRead.length > 0 && <details className="agent-sources">
                                    <summary>Папка проекта: прочитано файлов {filesRead.length}, фрагментов передано {sources.length}</summary>
                                    <p>Прочитанные файлы:</p>
                                    <ul>{filesRead.map((file) => <li key={file}>{file}</li>)}</ul>
                                    {sources.length === 0 && <p>Совпадений по запросу нет.</p>}
                                    {sources.map((source, index) => <div key={`${source.relative_path}:${source.line}:${index}`}>
                                        <strong>{source.relative_path}:{source.line}</strong>
                                        <pre>{source.excerpt}</pre>
                                    </div>)}
                                </details>;
                            })()}
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
                                    <button type="button" className="secondary-button" disabled={busy || modelSource === "ollama"}
                                            onClick={() => void retry(message.id)}>Повторить · новый ответ
                                    </button>
                                </div>
                            )}
                        </article>
                    ))}
                <details className="agent-board-panel">
                    <summary>План и очередь этой беседы</summary>
                    {operationErrors("agent", ["agentBoard", "addPlanStep", "completePlanStep", "addBoardInput"])}
                    <p>Локальные записи сохраняются в этой беседе. Использование очереди или уточнения только вставляет текст в черновик; запрос отправится лишь после проверки контекста и нажатия «Отправить».</p>
                    <p>Текст добавляется к текущему черновику. Если превышен предел 2000 символов, сократите черновик.</p>
                    <section>
                        <h2>План</h2>
                        <div className="agent-board-entry">
                            <input value={planDraft} maxLength={200} placeholder="Следующий шаг плана" onChange={(event) => setPlanDraft(event.target.value)}/>
                            <button type="button" className="secondary-button" disabled={!planDraft.trim()} onClick={() => void addPlanStep()}>Сохранить шаг</button>
                        </div>
                        {agentBoard.plan.map((step) => <div className="agent-board-item" key={step.id}>
                            <span>{step.ordinal + 1}. {step.action} · {step.status === "completed" ? "выполнено" : "ожидает"}</span>
                            {step.status === "pending" && <button type="button" className="secondary-button" onClick={() => void completePlanStep(step.id)}>Отметить выполненным</button>}
                        </div>)}
                        {!agentBoard.plan.length && <p>Шаги ещё не добавлены.</p>}
                    </section>
                    <section>
                        <h2>Очередь</h2>
                        <div className="agent-board-entry">
                            <input value={queueDraft} maxLength={2000} placeholder="Следующая просьба" onChange={(event) => setQueueDraft(event.target.value)}/>
                            <button type="button" className="secondary-button" disabled={!queueDraft.trim()} onClick={() => void addBoardInput("queue")}>Добавить</button>
                        </div>
                        {agentBoard.queue.map((item) => <div className="agent-board-item" key={item.id}>
                            <span>{item.text} · {item.status === "submitted" ? "отправлено" : "ожидает"}</span>
                            {item.status === "queued" && <button type="button" className="secondary-button" disabled={prompt.length + (prompt ? 1 : 0) + item.text.length > 2000} onClick={() => useBoardInput("queue", item)}>Вставить в черновик</button>}
                        </div>)}
                        {!agentBoard.queue.length && <p>Очередь пуста.</p>}
                    </section>
                    <section>
                        <h2>Уточнения</h2>
                        <div className="agent-board-entry">
                            <input value={steeringDraft} maxLength={1000} placeholder="Уточнить направление" onChange={(event) => setSteeringDraft(event.target.value)}/>
                            <button type="button" className="secondary-button" disabled={!steeringDraft.trim()} onClick={() => void addBoardInput("steering")}>Сохранить уточнение</button>
                        </div>
                        {agentBoard.steering.map((item) => <div className="agent-board-item" key={item.id}>
                            <span>{item.text} · {item.status === "submitted" ? "отправлено" : "ожидает"}</span>
                            {item.status === "pending" && <button type="button" className="secondary-button" disabled={prompt.length + (prompt ? 1 : 0) + item.text.length > 2000} onClick={() => useBoardInput("steering", item)}>Вставить в черновик</button>}
                        </div>)}
                        {!agentBoard.steering.length && <p>Уточнений нет.</p>}
                    </section>
                </details>
                    {!busy && draft && <article className="message message-assistant"><strong>Полученный текст</strong><p>{draft}</p>
                        <small>Загрузка сохранённого ответа не завершена. Проверьте историю; расход без usage неизвестен.</small></article>}
                    {busy && <article className="message message-assistant"><strong>Ответ</strong>
                        <p>{draft || "Ожидание ответа…"}</p><small>Модель: {modelId} · Ответ продолжается</small></article>}
                    </div>
                {showNewMessages && <button type="button" className="history-latest secondary-button" onClick={() => {
                    historyAtBottom.current = true;
                    historyRef.current?.scrollTo({top: historyRef.current.scrollHeight});
                    setShowNewMessages(false);
                }}>К новым сообщениям</button>}
                </div>
                <form className="composer" onSubmit={(event) => {
                    event.preventDefault();
                    void submitPrompt();
                }}>
                    {operationErrors("attachment")}
                    {dropResults.length > 0 && <div className="file-drop-results" aria-live="polite">{dropResults.map((item, index) => <div key={index}>{item.name}: {item.status}</div>)}</div>}
                    <div className="composer-project">Проект: {projects.find((project) => project.id === conversationProjectId)?.title ?? "Без проекта"}</div>
                    {(pendingAttachments.length + selectedMaterialIds.length > 0) && <div className="composer-chips" aria-label="Выбранный контекст">
                        {pendingAttachments.slice(0, 2).map((item) => <span key={item.id}><span>{item.name} · {item.mime} · {item.size} Б</span> <button type="button" disabled={busy} aria-label={`Убрать ${item.name}`} onClick={() => void removeAttachment(item.id)}>×</button></span>)}
                        {selectedMaterialIds.slice(0, Math.max(0, 2 - pendingAttachments.length)).map((id) => {
                            const item = projectMaterials.find((material) => material.id === id);
                            return <span key={id}><span>{item?.name ?? "Материал недоступен"} · версия {item?.version} · {item?.size} Б</span> <button type="button" disabled={busy} aria-label={`Убрать ${item?.name ?? "материал"}`} onClick={() => { setSelectedMaterialIds((ids) => ids.filter((value) => value !== id)); setContextPreview(null); }}>×</button></span>;
                        })}
                        <button type="button" className="secondary-button" onClick={() => setComposerSettingsOpen(true)}>{pendingAttachments.length + selectedMaterialIds.length > 2 ? `Ещё ${pendingAttachments.length + selectedMaterialIds.length - 2}` : "Просмотреть / убрать"}</button>
                    </div>}
                    {choosingWindow && <p role="status">Выберите окно для снимка или нажмите Escape.</p>}
                    {captureNotice && <p role="status">{captureNotice}</p>}
                    {!voiceOpen && (recording || voicePreparing || recordedAudio || transcriptionText || transcribing) && <button type="button" className="secondary-button" onClick={() => setVoiceOpen(true)}>Открыть голосовой ввод · {recording ? "идёт запись" : "есть несохранённые данные"}</button>}
                    {!selectedArtifact && operationErrors("artifact")}
                    <label className="sr-only" htmlFor="prompt">Сообщение</label>
                    <textarea ref={promptField} id="prompt" value={prompt} maxLength={2000} rows={2}
                              aria-autocomplete="list" aria-controls={mentionOpen ? "material-mentions" : slashOpen ? "slash-commands" : undefined}
                              aria-activedescendant={mentionOpen && activeMention >= 0 ? `mention-${mentionItems[activeMention].kind}-${mentionItems[activeMention].id}` : slashOpen && activeSlash >= 0 ? `slash-command-${slashCommands[activeSlash].id}` : undefined}
                              onSelect={(event) => setPromptCaret(event.currentTarget.selectionStart)}
                              onBlur={(event) => { setSlashDismissed(true); if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.id === "mention-pick-file")) setMentionDismissed(true); }}
                              onKeyDown={(event) => {
                                  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                                  if (mentionOpen) {
                                      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMentionDismissed(true); return; }
                                      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); if (mentionItems.length) setMentionIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + mentionItems.length) % mentionItems.length); return; }
                                      if ((event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) || (event.key === "Tab" && !event.shiftKey && activeMention >= 0 && !mentionDisabled(mentionItems[activeMention]))) { event.preventDefault(); if (activeMention >= 0) chooseMention(mentionItems[activeMention]); return; }
                                  }
                                  if (slashOpen) {
                                      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setSlashDismissed(true); return; }
                                      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); if (slashCommands.length) setSlashIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + slashCommands.length) % slashCommands.length); return; }
                                      if ((event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) || (event.key === "Tab" && !event.shiftKey && activeSlash >= 0 && !slashDisabled(slashCommands[activeSlash].id))) { event.preventDefault(); if (activeSlash >= 0 && !slashDisabled(slashCommands[activeSlash].id)) runSlashCommand(slashCommands[activeSlash].id); return; }
                                  }
                                  if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.defaultPrevented || slashOpen || mentionOpen) return;
                                  event.preventDefault();
                                  void submitPrompt();
                              }}
                              placeholder="Напишите сообщение" onChange={(event) => {
                        setPrompt(event.target.value);
                        setPromptCaret(event.target.selectionStart);
                        setSlashDismissed(false);
                        setSlashIndex(0);
                        setMentionDismissed(false);
                        setMentionIndex(0);
                        setBoardInputSource((source) => source && source.text !== event.target.value ? null : source);
                        setContextPreview(null);
                    }}/>
                    {mentionOpen && <div className="slash-commands mention-commands">
                        <div id="material-mentions" role="listbox" aria-label="Материалы для сообщения">
                            {mentionItems.map((item, index) => <div id={`mention-${item.kind}-${item.id}`} key={`${item.kind}-${item.id}`} role="option"
                                aria-selected={index === activeMention} aria-disabled={mentionDisabled(item)}
                                onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMention(item)}>{item.name} · {item.detail}</div>)}
                        </div>
                        {!mentionItems.length && <><p role="status">Нет доступных материалов</p><button id="mention-pick-file" type="button" disabled={busy || dropLoading || pendingAttachments.length + selectedMaterialIds.length >= 5}
                            onBlur={() => setMentionDismissed(true)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMentionDismissed(true); promptField.current?.focus(); } }} onClick={() => { setMentionDismissed(true); void pickAttachment(); }}>Выбрать файл…</button></>}
                    </div>}
                    {slashOpen && <div id="slash-commands" className="slash-commands" role="listbox" aria-label="Команды сообщения">
                        {slashCommands.map((command, index) => <div id={`slash-command-${command.id}`} key={command.id} role="option"
                            aria-selected={index === activeSlash} aria-disabled={slashDisabled(command.id)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => { if (!slashDisabled(command.id)) runSlashCommand(command.id); }}>{command.label}{command.id === "context" && !slashRemainder.trim() ? " · добавьте текст сообщения" : ""}</div>)}
                        {!slashCommands.length && <p role="status">Команды не найдены.</p>}
                    </div>}
                    {prompt.length >= 1600 && <small aria-live="polite">{prompt.length}/2000</small>}
                    {composerToolsOpen && <div ref={composerMenu} className="composer-menu" role="menu" aria-label="Добавить к сообщению" onKeyDown={(event) => {
                        if (event.key === "Escape") { event.preventDefault(); setComposerToolsOpen(false); composerMenuButton.current?.focus(); }
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                            buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
                        }
                    }}>
                        <button type="button" className="secondary-button" role="menuitem" disabled={busy || dropLoading || pendingAttachments.length + selectedMaterialIds.length >= 5} onClick={() => { setComposerToolsOpen(false); void pickAttachment(); }}>Прикрепить файл</button>
                        <button type="button" className="secondary-button" role="menuitem" disabled={busy || dropLoading || pendingAttachments.length + selectedMaterialIds.length >= 5} onClick={() => { setComposerToolsOpen(false); void pickImageAttachment(); }}>Прикрепить изображение</button>
                        <button type="button" className="secondary-button" role="menuitem" onClick={() => { setVoiceOpen(true); setComposerToolsOpen(false); }}>Голосовой ввод…</button>
                        <button type="button" className="secondary-button" role="menuitem" disabled={busy || choosingWindow || !!capturedSnapshot || pendingAttachments.length + selectedMaterialIds.length >= 5 || !isMac} onClick={() => { setComposerToolsOpen(false); void captureWindowSnapshot(); }}>Снимок окна…</button>
                        {!isMac && <small>Снимок окна доступен только на macOS.</small>}
                        {capturedSnapshot && <small>Сначала прикрепите или удалите текущий снимок.</small>}
                        <button type="button" className="secondary-button" role="menuitem" onClick={() => { setComposerToolsOpen(false); setComposerSettingsOpen(true); }}>Дополнительные настройки…</button>
                    </div>}
                    {voiceOpen && <section className="voice-input" aria-label="Голосовой ввод">
                        {operationErrors("voice")}
                        <div className="voice-controls">
                            {recording ? <button type="button" className="secondary-button" onClick={stopVoiceRecording}>Остановить запись</button> :
                                <button type="button" className="secondary-button" disabled={busy || transcribing || voicePreparing} onClick={() => void startVoiceRecording()}>Записать голос</button>}
                            {voicePreparation === "microphone" && <>
                                <span role="status">Ожидаем доступ к микрофону. Проверьте системный запрос разрешения.</span>
                                <button type="button" className="secondary-button" onClick={() => {
                                    permissionRequest.current++;
                                    voicePending.current = false;
                                    setVoicePreparation(null);
                                }}>Отменить ожидание</button>
                            </>}
                            {recording && <><span role="status">Идёт запись · {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")} / 10:00</span><button type="button" className="secondary-button" onClick={() => { cancelRecording.current = true; stopVoiceRecording(); }}>Отменить запись</button></>}
            {recordedAudio && <span>Запись: {recordedAudio.seconds.toFixed(1)} с · {(recordedAudio.base64.length * 0.75 / 1024).toFixed(0)} КБ</span>}
                        </div>
                        {transcriptionModels.length > 0 && <>
                            <div className="voice-controls">
                                <label htmlFor="transcription-model">Распознавание</label>
                                <select id="transcription-model" value={selectedTranscriptionModel?.id ?? ""} onChange={(event) => setTranscriptionModelId(event.target.value)}>
                                    {transcriptionModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.audio_rubles_per_minute} ₽/мин</option>)}
                                </select>
                                <button type="button" className="secondary-button" disabled={!recordedAudio || voicePreparing || recording || transcribing || !keySaved || !selectedTranscriptionModel || uncertainTranscription === recordedAudio?.id} onClick={() => void transcribeVoice()}>
                                    {transcribing ? "Распознавание…" : "Распознать"}
                                </button>
                            </div>
                            <small>SimpleClaw · тариф из <a href="https://simple-claw.ru/docs/provider-api" target="_blank" rel="noreferrer">Provider API</a>, каталог от {catalog ? new Date(catalog.fetched_at * 1000).toLocaleString() : "неизвестной даты"}. Сначала покажем оценку и запросим подтверждение. Аудио временно хранится в памяти этого окна.</small>
                        </>}
                        {!transcriptionModels.length && <small>Нет моделей распознавания с опубликованным тарифом.</small>}
                        {recordedAudio && <button type="button" className="secondary-button" disabled={transcribing} onClick={() => setRecordedAudio(null)}>Удалить запись</button>}
                        {transcriptionAvailable && <div className="transcription-result">
                            <label htmlFor="transcription-text">Распознанный текст — проверьте и исправьте</label>
                            <textarea id="transcription-text" value={transcriptionText} maxLength={2000} onChange={(event) => setTranscriptionText(event.target.value)}/>
                            <button type="button" className="secondary-button" disabled={!transcriptionText.trim() || prompt.length + transcriptionText.trim().length + (prompt ? 1 : 0) > 2000} onClick={() => {
                                setPrompt((current) => current ? `${current}\n${transcriptionText.trim()}` : transcriptionText.trim());
                                setContextPreview(null);
                                setTranscriptionText("");
                                setTranscriptionAvailable(false);
                                promptField.current?.focus();
                            }}>Вставить в сообщение</button>
                        </div>}
                    <button type="button" className="secondary-button" onClick={() => setVoiceOpen(false)}>Скрыть голосовой ввод</button>
                    </section>}
                    <div className="attachment-controls">
                        {capturedSnapshot && <div className="snapshot-preview">
                            <img src={capturedSnapshot.preview} alt="Предпросмотр снимка окна"/>
                            <div><strong>Снимок пока не прикреплён</strong>
                                <small>{capturedSnapshot.size} Б · SHA-256 {capturedSnapshot.sha256.slice(0, 12)}…</small>
                                <div className="actions">
                                    <button type="button" disabled={busy || pendingAttachments.length + selectedMaterialIds.length >= 5} onClick={() => void attachCapturedSnapshot()}>Прикрепить снимок</button>
                                    <button type="button" className="secondary-button" onClick={() => setCapturedSnapshot(null)}>Удалить снимок</button>
                                </div>
                            </div>
                        </div>}
                        {pendingAttachments.map((attachment) => (
                            <div className="attachment-item" key={attachment.id}>
                                <span title={attachment.name}>{attachment.name} · {attachment.size} Б · SHA-256 {attachment.sha256.slice(0, 12)}…</span>
                                <button type="button" className="secondary-button" disabled={busy}
                                        onClick={() => void removeAttachment(attachment.id)}>Убрать
                                </button>
                                {attachment.mime.startsWith("image/") ? <img className="image-attachment-preview" src={attachment.preview} alt={attachment.name}/> : <details>
                                    <summary>Содержимое</summary>
                                    <pre>{attachment.preview}</pre>
                                </details>}
                            </div>
                        ))}
                    </div>
                    {composerSettingsOpen && <section className="composer-extra" aria-label="Дополнительные настройки">
                    <button type="button" className="secondary-button" onClick={() => setComposerSettingsOpen(false)}>Скрыть дополнительные настройки</button>
                    {conversationProjectId !== null && <div className="agent-skill-picker">
                            {operationErrors("agent", ["agentSkill", "saveAgentSkill"])}
                            <h3>Локальный навык</h3>
                            <p>Выберите Markdown-материал этого проекта. Инструкция попадёт только в агентный запрос после явного включения; навык не добавляет доступ к файлам, командам или сети.</p>
                            <label htmlFor="agent-skill-source">Источник</label>
                            <select id="agent-skill-source" value={agentSkill?.material_id ?? ""} disabled={busy}
                                    onChange={(event) => void saveAgentSkill(event.target.value ? Number(event.target.value) : null, false)}>
                                <option value="">Не выбран</option>
                                {eligibleSkills.map((material) => <option key={material.id} value={material.id}>{material.name} · версия {material.version}</option>)}
                            </select>
                            <label className="agent-skill-toggle">
                                <input type="checkbox" checked={agentSkill?.enabled ?? false} disabled={busy || !agentSkill}
                                       onChange={(event) => agentSkill && void saveAgentSkill(agentSkill.material_id, event.target.checked)}/>
                                Включить этот навык для агентных запросов
                            </label>
                            {agentSkill && <details>
                                <summary>{agentSkill.name} · версия {agentSkill.version} · {agentSkill.size} Б · SHA-256 {agentSkill.sha256}</summary>
                                <pre>{agentSkill.instructions}</pre>
                            </details>}
                            {!eligibleSkills.length && <small>В библиотеке проекта нет Markdown-файлов до 16 КиБ.</small>}
                    </div>}
                            <label htmlFor="request-mode">Режим следующего запроса</label>
                            <select id="request-mode" value={agentMode ? "agent" : "chat"} disabled={busy} onChange={(event) => { setAgentMode(event.target.value === "agent"); setContextPreview(null); }}>
                                <option value="chat">Чат</option>
                                <option value="agent" disabled={modelId !== "gpt-oss-20b"}>Агент · только gpt-oss-20b</option>
                            </select>
                            <small>Агент: калькулятор и поиск при явно подключённой папке; команды недоступны. До двух платных запросов с подтверждением.</small>
                    {selectedMaterialIds.map((id) => { const item = projectMaterials.find((material) => material.id === id); return <div key={id}>
                        <span>{item?.name ?? "Материал недоступен"} · версия {item?.version} · {item?.size} Б</span>
                        <button type="button" disabled={busy} aria-label={`Убрать ${item?.name ?? "материал"} · версия ${item?.version ?? id}`} onClick={() => { setSelectedMaterialIds((ids) => ids.filter((value) => value !== id)); setContextPreview(null); }}>Убрать</button>
                    </div>; })}
                    {selectedMaterialIds.length > 0 && <button type="button" onClick={() => void openMaterials()}>Просмотреть выбранные версии</button>}
                    </section>}
                    {contextPreview && <details open className="context-preview">
                        <summary>Состав запроса · стиль: {{concise: "кратко", balanced: "сбалансированно", detailed: "подробно"}[contextPreview.response_style]} · текст {contextPreview.bytes} Б · запрос {contextPreview.request_bytes} Б · пропущено завершённых
                            обменов: {contextPreview.omitted_exchanges}</summary>
                        <p>{contextPreview.warning}</p>
                        {contextPreview.agent_skill && <p>В этом снимке включён навык «{contextPreview.agent_skill.name}», версия {contextPreview.agent_skill.version}, SHA-256 {contextPreview.agent_skill.sha256}. Текст инструкции показан ниже в составе сообщений.</p>}
                        {contextPreview.messages.map((part, index) => <pre
                            key={index}>{part.role} · {part.source_message_id ?? "новое сообщение или система"} · вложения: {part.attachment_ids.join(", ") || "нет"}{"\n"}{part.content}</pre>)}
                    </details>}
                    <div className="composer-footer">
                        <div className="composer-tools">
                            <button ref={composerMenuButton} type="button" className="secondary-button" aria-label="Добавить вложение или открыть инструменты" aria-haspopup="menu" aria-expanded={composerToolsOpen} onClick={() => setComposerToolsOpen((open) => !open)}>+</button>
                            <ModelPicker models={catalog?.models ?? []} categories={categories} value={modelId} source={modelSource} ollamaModels={ollamaModels} ollamaStatus={ollamaStatus} onRefreshOllama={() => void refreshOllamaCatalog()} disabled={busy}
                                         fetchedAt={catalog?.fetched_at ?? null} catalogFailed={errors.some((error) => error.area === "catalog")}
                                         onChange={(id, source) => { setModelSource(source); setModelId(id); if (source === "ollama" || id !== "gpt-oss-20b") setAgentMode(false); setContextPreview(null); }}/>
                            {agentMode && <span className="agent-mode-chip">Агент · калькулятор{conversationProjectId !== null ? " и поиск при подключённой папке" : ""}</span>}
                            {modelSource === "simpleclaw" && operationErrors("catalog")}
                            <details className="model-details">
                                <summary>О модели</summary>
                                {modelSource === "simpleclaw" && <p>{catalog ? `Каталог: ${new Date(catalog.fetched_at * 1000).toLocaleString()}` : "Каталог ещё не загружен"}</p>}
                                {modelSource === "ollama" && <p>Источник: Локально · Ollama. Отправка будет доступна в следующем обновлении.</p>}
                                {modelSource === "simpleclaw" && modelId !== "local-mock" && <>
                                    <p>Цена: {selectedModel?.input_rubles_per_million ?? "неизвестна"} ₽/млн входных; {selectedModel?.output_rubles_per_million ?? "неизвестна"} ₽/млн выходных. Источник и дата каталога: <a href="https://simple-claw.ru/docs/provider-api" target="_blank" rel="noreferrer">Provider API, GET /v1/models</a>, {catalog ? new Date(catalog.fetched_at * 1000).toLocaleString() : "неизвестны"}.</p>
                                    <p>Окно контекста и токенизатор: неизвестны — каталог их не сообщает. Возможность работы с текстом отдельно для этой модели не подтверждена.</p>
                                    <p>Изображения: пример с gpt-6-luna опубликован в <a href="https://simple-claw.ru/docs/provider-api" target="_blank" rel="noreferrer">документации Provider API</a>, проверено 9 ноября 2026. Для остальных моделей поддержка неизвестна.</p>
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
                            <button type="button" className="secondary-button" disabled={busy || dropLoading || !prompt.trim() || modelSource === "ollama"}
                                    onClick={() => void checkContext()}>Проверить контекст
                            </button>
                            {busy ? <button type="button" onClick={() => void stop()}>Остановить</button> : <button type="submit"
                                    disabled={busy || dropLoading || !prompt.trim() || modelSource === "ollama" || (modelId !== "local-mock" && !keySaved) || (hasImage && !imageModelSupported) || !contextPreview?.confirmation_id || previewSignature !== contextSignature()}>Отправить
                            </button>}
                        </div>
                    </div>
                    {operationErrors("send")}
                    {!settingsOpen && operationErrors("connection")}
                    <p className="send-warning">{modelSource === "ollama" ? "Отправка в Ollama пока недоступна." : modelId === "local-mock" ? "Локальный тест · без сети" : "Перед отправкой: контекстное окно и токенизатор неизвестны; размер в байтах не подтверждает, что запрос поместится. Запрос в SimpleClaw может стоить денег, а расход при обрыве неизвестен."}</p>
                    {hasImage && !imageModelSupported && <p role="alert">Изображения поддерживаются только для gpt-6-luna по документации SimpleClaw. Выберите эту модель или удалите изображение.</p>}
                    {modelSource === "simpleclaw" && modelId !== "local-mock" && !keySaved && <p role="alert">Подключите API-ключ. <Button type="button" onClick={() => setSettingsOpen(true)}>Настройки подключения</Button></p>}

                </form>
                </div>
            </section>
            {imageView && <section className="tasks-view" aria-label="Генерация изображений">
                <header className="chat-header"><button ref={imageBack} type="button" className="secondary-button" onClick={() => { setSelectedArtifactId(null); setView("chat"); requestAnimationFrame(() => promptField.current?.focus()); }}>К беседе</button><h1>Генерация изображений</h1></header>
                <div className="tasks-content"><div className="image-generation-panel">
                    {operationErrors("image")}
                    {operationErrors("connection", ["generateImage"])}
                    {operationErrors("catalog")}
                    <p>Поставщик: SimpleClaw. Один запрос создаёт одно изображение. Перед каждым платным запросом потребуется подтверждение.</p>
                    <label htmlFor="image-generation-model">Модель</label>
                    <select id="image-generation-model" value={selectedImageModel?.id || ""} disabled={imageGenerationBusy}
                            onChange={(event) => setImageModelId(event.target.value)}>
                        {imageModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
                    </select>
                    {imageModels.length > 0 && <p>Цена: {imageModels.find((model) => model.id === (imageModelId || imageModels[0]?.id))?.request_rubles == null
                        ? "неизвестна — запрос заблокирован"
                        : `${imageModels.find((model) => model.id === (imageModelId || imageModels[0]?.id))?.request_rubles} ₽ за успешный запрос`}.
                        Источник и дата: <a href="https://simple-claw.ru/v1/models" target="_blank" rel="noreferrer">публичный каталог моделей</a>, {catalog ? new Date(catalog.fetched_at * 1000).toLocaleString() : "неизвестны"}.
                    </p>}
                    <button type="button" className="secondary-button" disabled={imageGenerationBusy} onClick={() => void refreshModelCatalog()}>Обновить каталог и цену</button>
                    {!imageModels.length && <p>В сохранённом каталоге нет подтверждённых моделей генерации.</p>}
                    <label htmlFor="image-generation-prompt">Описание изображения</label>
                    <textarea id="image-generation-prompt" maxLength={32_000} value={imagePrompt} disabled={imageGenerationBusy}
                              onChange={(event) => setImagePrompt(event.target.value)} placeholder="Опишите изображение"/>
                    <button type="button" disabled={imageGenerationBusy || imageSaving || !imagePrompt.trim() || uncertainImageSignatures.has(JSON.stringify([selectedImageModel?.id || "", imagePrompt.trim()])) || !imageModels.some((model) => model.id === (imageModelId || imageModels[0]?.id) && model.request_rubles !== null)}
                            onClick={() => void generateImage()}>{imageGenerationBusy ? "Запрос выполняется…" : "Проверить цену и сгенерировать"}</button>
                    {uncertainImageSignatures.has(JSON.stringify([selectedImageModel?.id || "", imagePrompt.trim()])) && <p role="alert">Результат предыдущего запроса неизвестен; повтор этого же запроса заблокирован.</p>}
                    {generatedImage && <div className="generated-image-result">
                        <img src={generatedImage.data_url} alt={`Результат ${generatedImage.model_id}`}/>
                        <p>{generatedImage.model_id} · {generatedImage.price_rubles} ₽ за успешный запрос</p>
                        <button type="button" className="secondary-button" disabled={imageSaving} onClick={() => void saveGeneratedImage()}>
                            {imageSaving ? "Сохранение…" : imageSaved ? "Файл сохранён" : "Сохранить PNG…"}
                        </button>
                    </div>}
                </div></div>
            </section>}
            {tasksView && <section className="tasks-view" aria-label="Задачи">
                <header className="chat-header"><button ref={tasksBack} type="button" className="secondary-button" onClick={() => { setSelectedArtifactId(null); setTasksView(false); requestAnimationFrame(() => promptField.current?.focus()); }}>К беседе</button><h1>Задачи</h1></header>
                <div className="tasks-content">
                {openedScheduledResult && <section className="scheduled-task-notice" role="region" aria-label="Результат агентной задачи" id="scheduled-task-result">
                    <strong>Результат задачи: {openedScheduledResult.title}</strong>
                    <p className="scheduled-result-content">{openedScheduledResult.content || "Ответ завершён без текста."}</p>
                    <button type="button" className="secondary-button" onClick={() => setOpenedScheduledResult(null)}>Закрыть результат</button>
                </section>}
                {operationErrors("navigation")}
                {scheduledTasks.filter((task) => task.status === "awaiting_confirmation").map((task) => <section className="scheduled-task-notice" role="status" id={`scheduled-task-${task.id}`} key={task.id}>
                    <strong>По расписанию наступила задача: {task.title}</strong>
                    <p>Автоматический запуск не выполнялся. После подтверждения текст попадёт в черновик; платный запрос потребует обычной проверки контекста и отдельного подтверждения.</p>
                    <button type="button" disabled={busy} onClick={() => void prepareScheduledTask(task)}>Подтвердить и подготовить черновик</button>
                    <button type="button" className="secondary-button" onClick={() => void stopScheduledTask(task.id)}>Остановить расписание</button>
                </section>)}
                <div className="scheduled-task-panel">
                    <h2>Результаты</h2>
                    {!scheduledRuns.length && <p>Готовых результатов пока нет.</p>}
                    {scheduledRuns.map((run) => <div className="scheduled-task-row" key={run.id}>
                        <span>{run.title} · {new Date(run.due_at * 1000).toLocaleString()}</span>
                        <button type="button" className="secondary-button" onClick={() => {
                            const request = ++scheduledResultRequest.current;
                            void invoke<ScheduledAgentResult>("get_scheduled_agent_result", {runId: run.id}).then((result) => { if (request === scheduledResultRequest.current) setOpenedScheduledResult(result); }).catch((reason) => { if (request === scheduledResultRequest.current) report("scheduledRuns", reason); });
                        }}>Открыть результат</button>
                    </div>)}
                </div>
                <div className="scheduled-task-panel">
                    <h2>Новое расписание</h2>
                    <p>Беседа: {selectedConversation?.title ?? "Текущая беседа"}</p>
                    {operationErrors("schedule")}
                    <p>Срок проверяется при запуске приложения и каждые 30 секунд, пока окно открыто. Уведомление ведёт к ожидающей задаче или готовому результату. Закрытое приложение не выполняет задачи. Отправка всегда остаётся ручной.</p>
                    {scheduleNotificationsEnabled ?
                        <button type="button" className="secondary-button" onClick={() => { localStorage.removeItem("scheduleNotifications"); setScheduleNotificationsEnabled(false); }}>Выключить уведомления</button> :
                        <button type="button" className="secondary-button" onClick={() => void enableScheduleNotifications()}>Включить уведомления</button>}
                    <label>Название<input value={scheduleTitle} maxLength={120} onChange={(event) => setScheduleTitle(event.target.value)}/></label>
                    <label>Текст задачи<textarea value={schedulePrompt} maxLength={2000} rows={2} onChange={(event) => setSchedulePrompt(event.target.value)}/></label>
                    <label>Повторять каждые, минут<input type="number" min={1} max={10080} value={scheduleInterval} onChange={(event) => setScheduleInterval(event.target.value)}/></label>
                    <button type="button" className="secondary-button" disabled={!scheduleTitle.trim() || !schedulePrompt.trim() || !scheduleInterval}
                            onClick={() => void createScheduledTask()}>Сохранить расписание</button>
                    {scheduledTasks.map((task) => <div className="scheduled-task-row" key={task.id}>
                        <span>{task.title} · {conversations.find((item) => item.id === task.conversation_id)?.title ?? "Беседа"} · каждые {task.interval_minutes} мин · {task.status === "active" ? `следующий срок ${new Date(task.next_run_at * 1000).toLocaleString()}` : task.status === "awaiting_confirmation" ? "ожидает подтверждения" : "остановлено"}</span>
                        {task.status !== "stopped" && <button type="button" className="secondary-button" onClick={() => void stopScheduledTask(task.id)}>Остановить</button>}
                    </div>)}
                </div>
                </div>
            </section>}
            {selectedArtifact && !tasksView && !imageView && <ArtifactPanel artifact={selectedArtifact} versions={history.artifacts}
                                                 onSelect={setSelectedArtifactId} onClose={closeArtifact}
                                                 onExport={(id) => void exportArtifact(id)} side={artifactSide} errorNotice={operationErrors("artifact")}/>}
            <Dialog open={confirmationMessage !== null} onOpenChange={(open) => { if (!open) finishConfirmation(false); }}>
                <DialogContent aria-describedby="confirmation-message" onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    if (confirmationTrigger.current?.isConnected) confirmationTrigger.current.focus();
                }}>
                    <DialogTitle>Подтвердить действие</DialogTitle>
                    <p id="confirmation-message">{confirmationMessage}</p>
                    <button type="button" className="secondary-button" onClick={() => finishConfirmation(false)}>Отмена</button>
                    <button type="button" onClick={() => finishConfirmation(true)}>Подтвердить</button>
                </DialogContent>
            </Dialog>
            <Dialog open={createConversationConfirm} onOpenChange={setCreateConversationConfirm}>
                <DialogContent aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); promptField.current?.focus(); }}>
                    <DialogTitle>Создать беседу?</DialogTitle>
                    <p>Черновик, несохранённые записи плана и выбранные файлы будут убраны.</p>
                    <button type="button" className="secondary-button" onClick={() => setCreateConversationConfirm(false)}>Отмена</button>
                    <button type="button" onClick={() => { setCreateConversationConfirm(false); void createConversation(undefined, true); }}>Создать беседу</button>
                </DialogContent>
            </Dialog>
            <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
              <DialogContent className="command-palette" aria-describedby={undefined}
                    onOpenAutoFocus={(event) => { event.preventDefault(); paletteInput.current?.focus(); }}
                    onCloseAutoFocus={(event) => { event.preventDefault(); (paletteTrigger.current?.isConnected ? paletteTrigger.current : promptField.current)?.focus(); }}>
                <DialogTitle id="command-palette-title">Команды</DialogTitle>
                <input ref={paletteInput} type="search" aria-label="Поиск команд" placeholder="Введите команду…"
                       value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)}
                       onKeyDown={(event) => {
                           const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".command-list button:not(:disabled)");
                           if (event.key === "ArrowDown" && buttons?.length) { event.preventDefault(); buttons[0].focus(); }
                           else if (event.key === "Enter" && buttons?.length === 1) { event.preventDefault(); buttons[0].click(); }
                       }}/>
                <div className="command-list">
                    {paletteCommands.map((command) => <button key={command.id} type="button" className="secondary-button"
                        disabled={busy && ["new", "context", "attach", "attach-image"].includes(command.id)}
                        onKeyDown={(event) => {
                            const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
                            const index = buttons.indexOf(event.currentTarget);
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                buttons[(index + 1) % buttons.length]?.focus();
                            } else if (event.key === "ArrowUp") {
                                event.preventDefault();
                                if (index === 0) paletteInput.current?.focus();
                                else buttons[index - 1]?.focus();
                            }
                        }}
                        onClick={() => { closePalette(); requestAnimationFrame(() => runCommand(command.id)); }}>{command.label}{command.shortcut && <span>{command.shortcut}</span>}</button>)}
                    {!paletteCommands.length && <p>Команды не найдены.</p>}
                </div>
                <p className="palette-hint">↑ ↓ выбрать · Enter открыть · Esc закрыть · ⌘K / Ctrl+K</p>
              </DialogContent>
            </Dialog>
            <Dialog open={replaceVoiceConfirm} onOpenChange={setReplaceVoiceConfirm}>
                <DialogContent aria-describedby={undefined}>
                    <DialogTitle>Начать новую запись?</DialogTitle>
                    <p>Текущая запись и распознанный текст будут удалены.</p>
                    <div className="actions"><button type="button" className="secondary-button" onClick={() => setReplaceVoiceConfirm(false)}>Отмена</button>
                        <button type="button" onClick={() => { setReplaceVoiceConfirm(false); void startVoiceRecording(true); }}>Удалить и записать</button></div>
                </DialogContent>
            </Dialog>
            <Dialog open={transcriptionConfirm} onOpenChange={setTranscriptionConfirm}>
                <DialogContent aria-describedby={undefined}>
                    <DialogTitle>Отправить запись на распознавание?</DialogTitle>
                    {recordedAudio && selectedTranscriptionModel && <p>SimpleClaw · {selectedTranscriptionModel.name} ({selectedTranscriptionModel.id}) · {recordedAudio.seconds.toFixed(1)} с · {selectedTranscriptionModel.audio_rubles_per_minute} ₽/мин. Оценка с запасом 1 с: {((Math.ceil(recordedAudio.seconds) + 1) / 60 * (selectedTranscriptionModel.audio_rubles_per_minute ?? 0)).toFixed(2)} ₽. Итог может отличаться; автоматического повтора не будет.</p>}
                    <div className="actions"><button type="button" className="secondary-button" onClick={() => setTranscriptionConfirm(false)}>Отмена</button>
                        <button type="button" onClick={() => { setTranscriptionConfirm(false); void transcribeVoice(true); }}>Подтвердить отправку</button></div>
                </DialogContent>
            </Dialog>
            <Dialog open={closeVoiceConfirm} onOpenChange={setCloseVoiceConfirm}>
                <DialogContent aria-describedby={undefined}>
                    <DialogTitle>Закрыть приложение?</DialogTitle>
                    <p>Запись и распознанный текст будут потеряны. Если распознавание выполняется, запрос мог быть оплачен.</p>
                    <div className="actions">
                        <button type="button" className="secondary-button" onClick={() => setCloseVoiceConfirm(false)}>Вернуться</button>
                        <button type="button" onClick={() => void getCurrentWindow().destroy()}>Закрыть и потерять данные</button>
                    </div>
                </DialogContent>
            </Dialog>
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogContent className="settings-content" aria-describedby={undefined}
                               onCloseAutoFocus={(event) => {
                                   event.preventDefault();
                                   (settingsTrigger.current?.isConnected && settingsTrigger.current.offsetParent ? settingsTrigger.current : compactSettingsButton.current?.offsetParent ? compactSettingsButton.current : settingsButton.current)?.focus();
                                   settingsTrigger.current = null;
                               }}>
                <header className="settings-header"><DialogTitle className="text-base font-semibold">Настройки</DialogTitle>
                    <Button type="button" onClick={closeSettings}>Закрыть</Button></header>
                <section className="settings-section" aria-labelledby="connection-title">
                    <h3 id="connection-title">Подключение</h3>
                    {operationErrors("connection")}
                    <label htmlFor="api-key">Ключ SimpleClaw · {keySaved ? "сохранён" : "не сохранён"}</label>
                    <input id="api-key" type="password" value={key} autoComplete="off"
                           onChange={(event) => setKey(event.target.value)} placeholder="Введите ключ"/>
                    <div className="settings-actions">
                        <Button type="button" disabled={!key.trim() || busy}
                                onClick={() => void saveKey()}>Сохранить ключ</Button>
                        {keySaved && <Button type="button" disabled={busy}
                                             onClick={() => void deleteKey()}>Удалить ключ</Button>}
                    </div>
                </section>
                <section className="settings-section" aria-labelledby="appearance-title">
                    <h3 id="appearance-title">Внешний вид</h3>
                    <label htmlFor="theme">Тема</label>
                    <NativeSelect id="theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                        <option value="system">Системная</option><option value="light">Светлая</option><option value="dark">Тёмная</option>
                    </NativeSelect>
                </section>
                <section className="settings-section" aria-labelledby="response-style-title">
                    <h3 id="response-style-title">Стиль ответа</h3>
                    <label htmlFor="response-style">Для следующих запросов</label>
                    <NativeSelect id="response-style" value={responseStyle} disabled={busy}
                            onChange={(event) => void updateResponseStyle(event.target.value as ContextPreview["response_style"])}>
                        <option value="concise">Кратко</option><option value="balanced">Сбалансированно</option>
                        <option value="detailed">Подробно</option>
                    </NativeSelect>
                </section>
                <section className="settings-section" aria-labelledby="data-title">
                    <h3 id="data-title">Данные</h3>
                    {operationErrors("data")}
                    <Button type="button" disabled={busy}
                            onClick={() => void createBackup()}>Создать копию</Button>
                    <label htmlFor="backup">Резервные копии</label>
                    <NativeSelect id="backup" value={selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)}>
                        <option value="">Выберите копию</option>
                        {backups.map((name) => <option key={name} value={name}>{name}</option>)}
                    </NativeSelect>
                    <Button type="button" disabled={busy || !selectedBackup}
                            onClick={() => void restoreBackup()}>Восстановить</Button>
                </section>

                <details className="synthetic-task-panel">
                    <summary>Тестовый режим: многошаговая демонстрация</summary>
                    {operationErrors("agent", ["startSyntheticTask", "decideSyntheticStep", "syntheticTasks"])}
                    <p>Синтетические шаги работают только в SQLite. Здесь нет сетевых запросов, файловых команд или внешних инструментов.</p>
                    <button type="button" className="secondary-button" onClick={() => void startSyntheticTask()}>Создать демонстрацию</button>
                    {syntheticTasks.map((task) => <article className="synthetic-task" key={task.id}>
                        <h2>{task.title} · {task.status === "awaiting_approval" ? "ожидает решения" : task.status === "completed" ? "завершена" : "отклонена"}</h2>
                        {task.steps.map((step) => <div className="synthetic-task-step" key={step.id}>
                            <p>{step.ordinal + 1}. {step.action} · {step.decision === "pending" ? "ожидает разрешения" : step.decision === "approved" ? "разрешено" : "отклонено"}</p>
                            {step.result && <p>{step.result}</p>}
                            {step.decision === "pending" && <div className="actions">
                                <button type="button" onClick={() => void decideSyntheticStep(task.id, step.id, "approve")}>Разрешить и выполнить</button>
                                <button type="button" className="secondary-button" onClick={() => void decideSyntheticStep(task.id, step.id, "deny")}>Отклонить</button>
                            </div>}
                        </div>)}
                    </article>)}
                </details>
                </DialogContent>
            </Dialog>
        </main>
    );
}

createRoot(document.getElementById("root")!).render(<><OperationToaster/><RenderBoundary><App/></RenderBoundary></>);
