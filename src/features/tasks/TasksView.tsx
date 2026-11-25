import type {ReactNode, RefObject} from "react";
import type {Conversation} from "../../ProjectSidebar";
import type {ScheduledAgentTask, useScheduledTasks} from "./useScheduledTasks";

type Props = {tasks: ReturnType<typeof useScheduledTasks>["view"]; busy: boolean; conversations: Conversation[];
    selectedConversation: Conversation | undefined; backRef: RefObject<HTMLButtonElement | null>; onBack: () => void;
    onPrepare: (task: ScheduledAgentTask) => Promise<void>; navigationErrors: ReactNode; scheduleErrors: ReactNode};

export default function TasksView({tasks, busy, conversations, selectedConversation, backRef: tasksBack, onBack, onPrepare, navigationErrors, scheduleErrors}: Props) {
    const {scheduledTasks, scheduledRuns, openedScheduledResult, setOpenedScheduledResult, scheduleNotificationsEnabled, setScheduleNotificationsEnabled,
        scheduleTitle, setScheduleTitle, schedulePrompt, setSchedulePrompt, scheduleInterval, setScheduleInterval,
        enableScheduleNotifications, createScheduledTask, stopScheduledTask, openScheduledResult} = tasks;
    return <section className="tasks-view" aria-label="Задачи">
                <header className="chat-header"><button ref={tasksBack} type="button" className="secondary-button" onClick={onBack}>К беседе</button><h1>Задачи</h1></header>
                <div className="tasks-content">
                {openedScheduledResult && <section className="scheduled-task-notice" role="region" aria-label="Результат агентной задачи" id="scheduled-task-result">
                    <strong>Результат задачи: {openedScheduledResult.title}</strong>
                    <p className="scheduled-result-content">{openedScheduledResult.content || "Ответ завершён без текста."}</p>
                    <button type="button" className="secondary-button" onClick={() => setOpenedScheduledResult(null)}>Закрыть результат</button>
                </section>}
                {navigationErrors}
                {scheduledTasks.filter((task) => task.status === "awaiting_confirmation").map((task) => <section className="scheduled-task-notice" role="status" id={`scheduled-task-${task.id}`} key={task.id}>
                    <strong>По расписанию наступила задача: {task.title}</strong>
                    <p>Автоматический запуск не выполнялся. После подтверждения текст попадёт в черновик; платный запрос потребует обычной проверки контекста и отдельного подтверждения.</p>
                    <button type="button" disabled={busy} onClick={() => void onPrepare(task)}>Подтвердить и подготовить черновик</button>
                    <button type="button" className="secondary-button" onClick={() => void stopScheduledTask(task.id)}>Остановить расписание</button>
                </section>)}
                <div className="scheduled-task-panel">
                    <h2>Результаты</h2>
                    {!scheduledRuns.length && <p>Готовых результатов пока нет.</p>}
                    {scheduledRuns.map((run) => <div className="scheduled-task-row" key={run.id}>
                        <span>{run.title} · {new Date(run.due_at * 1000).toLocaleString()}</span>
                        <button type="button" className="secondary-button" onClick={() => openScheduledResult(run.id)}>Открыть результат</button>
                    </div>)}
                </div>
                <div className="scheduled-task-panel">
                    <h2>Новое расписание</h2>
                    <p>Беседа: {selectedConversation?.title ?? "Текущая беседа"}</p>
                    {scheduleErrors}
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
            </section>;
}
