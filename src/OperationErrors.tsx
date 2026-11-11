import {useEffect, useRef, useState} from "react";
import {toast, Toaster} from "sonner";
import {Button} from "./components/ui/button";
import {Dialog, DialogContent, DialogTitle} from "./components/ui/dialog";

export type ErrorArea = "catalog" | "send" | "attachment" | "data" | "connection" | "navigation" | "voice" | "image" | "agent" | "schedule" | "artifact";
type Operation = {area: ErrorArea; title: string; global?: boolean};
const operations: Record<string, Operation> = {
    catalog: {area: "catalog", title: "Обновление каталога", global: true},
    categories: {area: "catalog", title: "Категории моделей", global: true},
    changeCategory: {area: "catalog", title: "Изменение категории модели", global: true},
    runGeneration: {area: "send", title: "Отправка запроса"},
    send: {area: "send", title: "Подготовка отправки"},
    checkContext: {area: "send", title: "Проверка контекста"},
    history: {area: "send", title: "Загрузка истории"},
    selectBranch: {area: "send", title: "Выбор ветки"},
    stop: {area: "send", title: "Остановка ответа"},
    pickAttachment: {area: "attachment", title: "Выбор файла"},
    pickImageAttachment: {area: "attachment", title: "Выбор изображения"},
    captureWindowSnapshot: {area: "attachment", title: "Снимок окна"},
    attachCapturedSnapshot: {area: "attachment", title: "Прикрепление снимка"},
    removeAttachment: {area: "attachment", title: "Удаление вложения"},
    materials: {area: "attachment", title: "Загрузка материалов"},
    folder: {area: "attachment", title: "Загрузка папки"},
    addProjectMaterial: {area: "attachment", title: "Добавление материала"},
    chooseProjectFolder: {area: "attachment", title: "Выбор папки"},
    previewProjectFile: {area: "attachment", title: "Просмотр файла"},
    saveFolderPreview: {area: "attachment", title: "Добавление файла папки"},
    createBackup: {area: "data", title: "Создание резервной копии", global: true},
    restoreBackup: {area: "data", title: "Восстановление резервной копии", global: true},
    backups: {area: "data", title: "Список резервных копий", global: true},
    responseStyle: {area: "data", title: "Загрузка стиля ответа", global: true},
    updateResponseStyle: {area: "data", title: "Сохранение стиля ответа", global: true},
    saveKey: {area: "connection", title: "Сохранение ключа", global: true},
    deleteKey: {area: "connection", title: "Удаление ключа", global: true},
    keyStatus: {area: "connection", title: "Проверка подключения", global: true},
    startVoiceRecording: {area: "voice", title: "Запись голоса"},
    transcribeVoice: {area: "voice", title: "Распознавание голоса"},
    generateImage: {area: "image", title: "Генерация изображения"},
    saveGeneratedImage: {area: "image", title: "Сохранение изображения"},
    agentBoard: {area: "agent", title: "Загрузка плана"},
    agentSkill: {area: "agent", title: "Загрузка навыка"},
    saveAgentSkill: {area: "agent", title: "Сохранение навыка"},
    addPlanStep: {area: "agent", title: "Добавление шага"},
    completePlanStep: {area: "agent", title: "Завершение шага"},
    addBoardInput: {area: "agent", title: "Добавление в очередь"},
    startSyntheticTask: {area: "agent", title: "Создание демонстрации"},
    decideSyntheticStep: {area: "agent", title: "Подтверждение шага"},
    syntheticTasks: {area: "agent", title: "Загрузка демонстраций"},
    enableScheduleNotifications: {area: "schedule", title: "Разрешение уведомлений", global: true},
    createScheduledTask: {area: "schedule", title: "Создание задачи", global: true},
    stopScheduledTask: {area: "schedule", title: "Остановка задачи", global: true},
    prepareScheduledTask: {area: "schedule", title: "Подготовка задачи", global: true},
    scheduledTasks: {area: "schedule", title: "Загрузка задач", global: true},
    scheduledRuns: {area: "schedule", title: "Загрузка результатов", global: true},
    notifications: {area: "schedule", title: "Уведомления о задачах", global: true},
    openArtifact: {area: "artifact", title: "Открытие Artifact"},
    exportArtifact: {area: "artifact", title: "Экспорт Artifact"},
    navigation: {area: "navigation", title: "Загрузка бесед", global: true},
    projects: {area: "navigation", title: "Загрузка проектов", global: true},
    search: {area: "navigation", title: "Поиск бесед", global: true},
    switchConversation: {area: "navigation", title: "Переход в беседу"},
    createConversation: {area: "navigation", title: "Создание беседы", global: true},
    saveRename: {area: "navigation", title: "Переименование", global: true},
    archiveConversation: {area: "navigation", title: "Архивирование беседы", global: true},
    togglePin: {area: "navigation", title: "Закрепление беседы", global: true},
    createProject: {area: "navigation", title: "Создание проекта", global: true},
    archiveProject: {area: "navigation", title: "Архивирование проекта", global: true},
    moveConversation: {area: "navigation", title: "Перенос беседы"},
    runPaletteCommand: {area: "artifact", title: "Открытие результата"},
    artifact: {area: "artifact", title: "Просмотр Artifact"},
};

const recovery: Record<ErrorArea, string> = {
    catalog: "Локальный тест доступен. Попробуйте обновить каталог ещё раз.",
    send: "Проверьте состояние ответа и контекст перед новой отправкой. Автоматического повтора нет; расход без usage неизвестен.",
    attachment: "Текст сообщения сохранён. Выберите файл заново или удалите недоступное вложение.",
    data: "Данные автоматически не удаляются. Проверьте список копий и повторите нужное действие.",
    connection: "Проверьте ключ в настройках подключения и повторите действие.",
    navigation: "Повторите действие в списке бесед. Данные автоматически не удаляются.",
    voice: "Проверьте запись и разрешение микрофона. После неизвестного результата платный запрос не повторяется.",
    image: "Проверьте модель, цену и состояние результата. После неизвестного результата платный запрос не повторяется.",
    agent: "Проверьте состояние шага и повторите нужное действие. Автоматической отправки нет.",
    schedule: "Проверьте задачу и разрешение уведомлений. Платный запрос автоматически не повторяется.",
    artifact: "Ответ сохранён в истории. Откройте Artifact снова или повторите экспорт.",
};

export type OperationError = {
    id: string; operation: string; area: ErrorArea; conversation: number | null;
    time: string; code: string; httpStatus: number | null; requestId: string | null; message: string;
};

// Never retain the original exception: native errors can contain file paths or request data.
export function safeDiagnostic(operation: string, reason: unknown, metadata?: {code: string | null; httpStatus: number | null; requestId: string | null}) {
    const text = typeof reason === "string" ? reason : "";
    const knownCodes = ["UPSTREAM_USAGE_UNCERTAIN", "RUBLE_LIMIT", "TOKEN_LIMIT", "UNAUTHORIZED", "INVALID_API_KEY", "HTTP_ERROR", "STREAM_INTERRUPTED", "NETWORK_ERROR", "PRICE_CHANGED", "IMAGE_PRICE_CHANGED", "AUDIO_PRICE_CHANGED", "SERVER_ERROR", "NETWORK_RESULT_UNKNOWN", "STREAM_IDLE_TIMEOUT", "INVALID_SSE", "RESPONSE_TOO_LARGE", "DATABASE_ERROR", "MODEL_SNAPSHOT_MISMATCH", "TOOL_LOOP_LIMIT", "INVALID_TOOL_CALL", "UNKNOWN_TOOL", "RUBLE_RATE_LIMIT", "TOKEN_RATE_LIMIT"];
    const candidate = metadata?.code ?? text;
    const code = knownCodes.includes(candidate) ? candidate : reason instanceof TypeError ? "TYPE_ERROR" : "OPERATION_FAILED";
    const nativeHttp = /^(?:GENERATION_HTTP_|TRANSCRIPTION_HTTP_|HTTP )(\d{3})$/.exec(text);
    const httpStatus = metadata?.httpStatus ?? (nativeHttp ? Number(nativeHttp[1]) : text === "401" ? 401 : null);
    const requestId = metadata?.requestId && /^(?:request_|req_)[a-f0-9-]{8,64}$/i.test(metadata.requestId) ? metadata.requestId : null;
    const connection = httpStatus === 401 || code === "UNAUTHORIZED" || code === "INVALID_API_KEY" || text === "Сначала сохраните ключ SimpleClaw";
    return {time: new Date().toISOString(), operation, code, httpStatus, requestId, connection};
}

export function useOperationErrors(conversation: number) {
    const activeConversation = useRef(conversation);
    activeConversation.current = conversation;
    const [errors, setErrors] = useState<Record<string, OperationError>>({});
    function identity(operation: string) {
        return `${operations[operation]?.global ? "global" : conversation}:${operation}`;
    }
    function report(operation: string, reason: unknown, metadata?: Parameters<typeof safeDiagnostic>[2]) {
        const definition = operations[operation] ?? {area: "navigation", title: "Действие в списке бесед"};
        const diagnostic = safeDiagnostic(definition.title, reason, metadata);
        const area = diagnostic.connection ? "connection" : definition.area;
        const safeReasons = ["Файл больше 256 КБ", "Изображение больше 3 МиБ", "Файл должен быть в UTF-8 или UTF-16 с BOM", "Поддерживаются только выбранные текстовые форматы", "Некорректный UTF-16 файл", "Файл с возможными секретами нельзя прикрепить", "Файл не похож на текстовый", "Не удалось открыть файл", "Не удалось прочитать файл", "Не удалось проверить файл", "Выберите обычный файл", "Выберите корректное изображение PNG, JPEG или WebP", "Файл изображения повреждён", "Размер изображения превышает локальный предел 16 мегапикселей", "Файл не найден", "Выбранный файл не найден", "Символические ссылки не поддерживаются", "Не удалось декодировать изображение", "Изображение превышает локальный предел 16 мегапикселей", "Уведомления запрещены в настройках системы.", "Для результата задачи по расписанию выберите агентный режим и модель gpt-oss-20b."];
        const reasonText = typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "";
        const safeReason = safeReasons.includes(reasonText) ? `${reasonText}. ` : "";
        const message = diagnostic.connection ? "Подключите API-ключ или замените ключ, который сервер не принял." : `Не удалось выполнить: ${definition.title.toLowerCase()}. ${safeReason}${recovery[area]}`;
        const id = identity(operation);
        const error: OperationError = {...diagnostic, id, area, conversation: definition.global ? null : conversation, message};
        setErrors((current) => ({...current, [id]: error}));
        if (operation !== "stop" && (definition.global || conversation === activeConversation.current)) notify(message, id, area === "catalog" || area === "schedule" ? 8000 : Infinity);
    }
    function clear(operation: string, success?: string) {
        const id = identity(operation);
        setErrors((current) => {
            const next = {...current};
            delete next[id];
            return next;
        });
        toast.dismiss(id);
        if (success) notify(success, `${id}:success`, 4000);
    }
    return {errors: Object.values(errors).filter((error) => error.conversation === null || error.conversation === conversation), report, clear};
}

export function OperationNotice({error, children}: {error: OperationError; children?: React.ReactNode}) {
    const [open, setOpen] = useState(false);
    const [copyStatus, setCopyStatus] = useState("");
    // Only these explicitly selected fields are copied; no raw exception or state dump.
    const diagnostic = {time: error.time, operation: error.operation, code: error.code, httpStatus: error.httpStatus, requestId: error.requestId, message: error.message};
    async function copy() {
        try { await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2)); setCopyStatus("Скопировано"); }
        catch { setCopyStatus("Не удалось скопировать. Выделите подробности вручную."); }
    }
    return <div className="operation-error" data-operation={error.id}>
        <p role={error.area === "catalog" || error.area === "schedule" ? "status" : "alert"}>{error.message}</p>
        {children}
        <Button type="button" onClick={() => { setCopyStatus(""); setOpen(true); }}>Технические подробности</Button>
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent aria-describedby={undefined}>
                <DialogTitle>Подробности операции</DialogTitle>
                <dl><dt>Время обнаружения</dt><dd>{error.time}</dd><dt>Операция</dt><dd>{error.operation}</dd>
                    <dt>Код</dt><dd>{error.code}</dd><dt>HTTP</dt><dd>{error.httpStatus ?? "неизвестен"}</dd>
                    <dt>Request ID</dt><dd>{error.requestId ?? "неизвестен"}</dd></dl>
                <p>{error.message}</p>
                <Button type="button" onClick={() => void copy()}>Скопировать диагностику</Button>
                <p role="status">{copyStatus}</p>
                <Button type="button" onClick={() => setOpen(false)}>Закрыть</Button>
            </DialogContent>
        </Dialog>
    </div>;
}

// Sonner owns stacking; this timer also pauses for keyboard focus, which Sonner 2.0.8 does not do.
function TimedNotice({message, id, duration}: {message: string; id: string; duration: number}) {
    const content = useRef<HTMLDivElement>(null);
    const remaining = useRef(duration);
    const [hover, setHover] = useState(false);
    const [focus, setFocus] = useState(false);
    useEffect(() => {
        const element = content.current?.closest("[data-sonner-toast]");
        if (!element) return;
        const onFocus = () => setFocus(true);
        const onBlur = (event: Event) => {
            if (!element.contains((event as FocusEvent).relatedTarget as Node | null)) setFocus(false);
        };
        element.addEventListener("focusin", onFocus);
        element.addEventListener("focusout", onBlur);
        return () => { element.removeEventListener("focusin", onFocus); element.removeEventListener("focusout", onBlur); };
    }, []);
    useEffect(() => {
        if (hover || focus || duration === Infinity) return;
        const started = Date.now();
        const timer = window.setTimeout(() => toast.dismiss(id), remaining.current);
        return () => { window.clearTimeout(timer); remaining.current -= Date.now() - started; };
    }, [hover, focus, duration, id]);
    return <div ref={content} className="operation-toast-content" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <span role="status">{message}</span><button type="button" aria-label="Закрыть уведомление" onClick={() => toast.dismiss(id)}>×</button>
    </div>;
}

let notificationRevision = 0;
export function notify(message: string, id: string, duration: number) {
    const revision = ++notificationRevision;
    toast.custom(() => <TimedNotice key={revision} message={message} id={id} duration={duration}/>, {id, duration: Infinity});
}

export function OperationToaster() {
    return <Toaster position="top-right" offset={{top: "48px", right: "16px"}} visibleToasts={3} duration={4000}
                    closeButton containerAriaLabel="Уведомления" toastOptions={{className: "operation-toast"}}/>;
}

export function AnswerFailure({status, code, httpStatus, requestId, assistantId, onConnection}: {
    status: string; code: string | null; httpStatus: number | null; requestId: string | null; assistantId: number; onConnection: () => void;
}) {
    const [diagnostic] = useState(() => safeDiagnostic(`Ответ #${assistantId}`, "", {code, httpStatus, requestId}));
    const error: OperationError = {...diagnostic, id: `answer:${assistantId}`, area: "send", conversation: null,
        message: status === "interrupted" ? "Ответ прерван. Частичный текст сохранён. Расход неизвестен. Повтор возможен только по вашему действию." :
            diagnostic.connection ? "Ключ не принят. Откройте настройки подключения." : "Не удалось завершить ответ. Полученный текст сохранён. Без usage расход неизвестен; проверьте детали перед повтором."};
    return <OperationNotice error={error}>{diagnostic.connection && <Button type="button" onClick={onConnection}>Настройки подключения</Button>}</OperationNotice>;
}
