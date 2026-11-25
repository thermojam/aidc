import {useEffect, useRef, useState, type RefObject} from "react";
import {invoke} from "@tauri-apps/api/core";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {isPermissionGranted, onAction, requestPermission, sendNotification} from "@tauri-apps/plugin-notification";

export type ScheduledAgentTask = { id: number; conversation_id: number; title: string; prompt: string; interval_minutes: number; next_run_at: number; status: "active" | "awaiting_confirmation" | "stopped"; due_at: number | null };
type ScheduledAgentRun = {id: number; title: string; due_at: number; notified_at: number | null};
type ScheduledAgentResult = {title: string; content: string};
type Options = {conversationId: number; tasksView: boolean; closeNavigationSheet: RefObject<() => void>;
    setTasksView: (open: boolean) => void; clear: (operation: string) => void; report: (operation: string, reason: unknown) => void};

export function useScheduledTasks({conversationId, tasksView, closeNavigationSheet, setTasksView, clear, report}: Options) {
    const scheduledResultRequest = useRef(0);
    const [scheduledTasks, setScheduledTasks] = useState<ScheduledAgentTask[]>([]);
    const [scheduledRuns, setScheduledRuns] = useState<ScheduledAgentRun[]>([]);
    const [openedScheduledResult, setOpenedScheduledResult] = useState<ScheduledAgentResult | null>(null);
    const [scheduleNotificationsEnabled, setScheduleNotificationsEnabled] = useState(localStorage.getItem("scheduleNotifications") === "enabled");
    const [notificationListenerReady, setNotificationListenerReady] = useState(false);
    const [notificationTaskId, setNotificationTaskId] = useState<number | null>(null);
    const notifiedDueTasks = useRef(new Set<string>());
    const notifiedRuns = useRef(new Set<number>());
    const [scheduleTitle, setScheduleTitle] = useState("");
    const [schedulePrompt, setSchedulePrompt] = useState("");
    const [scheduleInterval, setScheduleInterval] = useState("60");
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

    useEffect(() => {
        invoke<ScheduledAgentTask[]>("list_scheduled_agent_tasks").then(setScheduledTasks).catch((reason) => report("scheduledTasks", reason));
        invoke<ScheduledAgentRun[]>("list_scheduled_agent_runs").then(setScheduledRuns).catch((reason) => report("scheduledRuns", reason));
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

    function openScheduledResult(runId: number) {
        const request = ++scheduledResultRequest.current;
        void invoke<ScheduledAgentResult>("get_scheduled_agent_result", {runId}).then((result) => { if (request === scheduledResultRequest.current) setOpenedScheduledResult(result); }).catch((reason) => { if (request === scheduledResultRequest.current) report("scheduledRuns", reason); });
    }

    function resetScheduledTasks() {
        scheduledResultRequest.current++;
        setOpenedScheduledResult(null);
        setNotificationTaskId(null);
        setScheduledTasks([]);
        setScheduledRuns([]);
        notifiedDueTasks.current.clear();
        notifiedRuns.current.clear();
    }

    return {scheduledTasks, refreshScheduledTasks, refreshScheduledRuns, resetScheduledTasks,
        view: {scheduledTasks, scheduledRuns, openedScheduledResult, setOpenedScheduledResult, scheduleNotificationsEnabled, setScheduleNotificationsEnabled,
            scheduleTitle, setScheduleTitle, schedulePrompt, setSchedulePrompt, scheduleInterval, setScheduleInterval,
            enableScheduleNotifications, createScheduledTask, stopScheduledTask, openScheduledResult}};
}
