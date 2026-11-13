import {useRef, useState, type ReactNode, type RefObject, type MouseEvent} from "react";
import {Dialog, DialogContent, DialogTitle} from "./components/ui/dialog";
import {Button} from "./components/ui/button";
import ShellIcon from "./ShellIcon";

export type Conversation = {id: number; title: string; archived: boolean; pinned: boolean; project_id: number | null};
export type Project = {id: number; title: string; archived: boolean};
type Target = {kind: "conversation"; item: Conversation} | {kind: "project"; item: Project};

type Props = {
    conversations: Conversation[]; projects: Project[]; selectedId: number; projectFilter: number | null;
    busy: boolean; query: string; matches: number[] | null; recentIds: number[];
    searchRef: RefObject<HTMLInputElement | null>; children: ReactNode;
    onQuery: (query: string) => void; onFilter: (id: number | null) => void;
    onSelect: (id: number) => void; onNew: () => void; onNewProject: () => void;
    onRename: (target: {kind: "project" | "conversation"; id: number; title: string}) => void;
    onArchive: (item: Conversation) => void; onPin: (item: Conversation) => void;
    onArchiveProject: (item: Project) => void; onMove: (id: number, projectId: number | null) => void;
};

export default function ProjectSidebar(props: Props) {
    const [collapsed, setCollapsed] = useState<number[]>(() => {
        try { const saved = JSON.parse(localStorage.getItem("navigation.collapsed") ?? "[]"); return Array.isArray(saved) ? saved.filter(Number.isInteger) : []; }
        catch { return []; }
    });
    const [target, setTarget] = useState<Target | null>(null);
    const menuTrigger = useRef<HTMLElement | null>(null);
    const activeProjects = props.projects.filter((item) => !item.archived);
    const filtered = props.conversations.filter((item) => (props.matches === null || props.matches.includes(item.id))
        && (props.projectFilter === null || item.project_id === (props.projectFilter || null)));
    const active = filtered.filter((item) => !item.archived);
    const archived = filtered.filter((item) => item.archived);
    const recent = props.recentIds.map((id) => props.conversations.find((item) => item.id === id && !item.archived)).filter((item) => item !== undefined).slice(0, 10);
    function showMenu(next: Target, trigger: HTMLElement) { menuTrigger.current = trigger; setTarget(next); }
    function contextMenu(event: MouseEvent<HTMLDivElement>, next: Target) {
        event.preventDefault();
        const button = event.currentTarget.querySelector<HTMLButtonElement>(".navigation-menu");
        if (button) showMenu(next, button);
    }
    function toggleProject(id: number) {
        const next = collapsed.includes(id) ? collapsed.filter((value) => value !== id) : [...collapsed, id];
        setCollapsed(next); localStorage.setItem("navigation.collapsed", JSON.stringify(next));
    }
    function row(item: Conversation) {
        return <div className="navigation-row" key={item.id} onContextMenu={(event) => contextMenu(event, {kind: "conversation", item})}>
            <button type="button" className="navigation-title" title={item.title} aria-current={item.id === props.selectedId ? "page" : undefined}
                    disabled={props.busy || item.archived} onClick={() => props.onSelect(item.id)}>
                <ShellIcon name="chat"/><span>{item.pinned ? "Закреплено · " : ""}{item.title}</span>
            </button>
            <button type="button" className="navigation-menu" aria-label={`Действия беседы ${item.title}`} onClick={(event) => showMenu({kind: "conversation", item}, event.currentTarget)}><ShellIcon name="more"/></button>
        </div>;
    }
    return <>
        <div className="navigation-tools">
            <button type="button" className="secondary-button" disabled={props.busy} onClick={props.onNew}>Новая беседа</button>
            <input ref={props.searchRef} type="search" aria-label="Поиск бесед" placeholder="Поиск бесед" maxLength={100} value={props.query} onChange={(event) => props.onQuery(event.target.value)}/>
            <select aria-label="Выбранный проект" value={props.projectFilter ?? -1} onChange={(event) => props.onFilter(Number(event.target.value) === -1 ? null : Number(event.target.value))}>
                <option value={-1}>Все беседы</option><option value={0}>Без проекта</option>
                {activeProjects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
        </div>
        <nav className="navigation-scroll" aria-label="Проекты и беседы">
            {props.children}
            {!!recent.length && !props.query.trim() && props.projectFilter === null && <section aria-label="Недавние беседы"><h2>Недавние</h2>{recent.map(row)}</section>}
            <div className="navigation-section-heading"><h2>Проекты</h2><button type="button" className="secondary-button" onClick={props.onNewProject}>Создать</button></div>
            {activeProjects.filter((project) => props.projectFilter === null || props.projectFilter === project.id).map((project) => <section key={project.id}>
                <div className="navigation-row" onContextMenu={(event) => contextMenu(event, {kind: "project", item: project})}>
                    <button type="button" className="navigation-title" aria-expanded={!collapsed.includes(project.id)} title={project.title} onClick={() => toggleProject(project.id)}><ShellIcon name="folder"/><span>{project.title}</span><span aria-hidden="true">{collapsed.includes(project.id) ? "›" : "⌄"}</span></button>
                    <button type="button" className="navigation-menu" aria-label={`Действия проекта ${project.title}`} onClick={(event) => showMenu({kind: "project", item: project}, event.currentTarget)}><ShellIcon name="more"/></button>
                </div>
                {(!collapsed.includes(project.id) || !!props.query.trim()) && <div className="project-conversations">{active.filter((item) => item.project_id === project.id).map(row)}
                    {!active.some((item) => item.project_id === project.id) && <p className="sidebar-empty">{props.query.trim() ? "Ничего не найдено" : "Пока нет бесед"}</p>}
                </div>}
            </section>)}
            {(props.projectFilter === null || props.projectFilter === 0) && <section aria-label="Беседы без проекта"><h2>Без проекта</h2>{active.filter((item) => item.project_id === null).map(row)}</section>}
            {!filtered.length && (props.projectFilter === 0 || !activeProjects.length) && <p className="sidebar-empty">{props.query.trim() ? "Ничего не найдено" : "Пока нет бесед"}</p>}
            {!!archived.length && <details open={!!props.query.trim()}><summary>Архив бесед</summary>{archived.map(row)}</details>}
            {props.projects.some((item) => item.archived) && <details open={!!props.query.trim()}><summary>Архив проектов</summary>{props.projects.filter((item) => item.archived).map((item) => <section key={item.id}>
                <div className="navigation-row" onContextMenu={(event) => contextMenu(event, {kind: "project", item})}>
                    <span className="archived-project-title">{item.title}</span><button type="button" className="navigation-menu" aria-label={`Действия проекта ${item.title}`} onClick={(event) => showMenu({kind: "project", item}, event.currentTarget)}><ShellIcon name="more"/></button>
                </div>{active.filter((conversation) => conversation.project_id === item.id).map(row)}
            </section>)}</details>}
        </nav>
        <Dialog open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }}>
            <DialogContent className="navigation-actions" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); if (document.getElementById("rename-title")) return; if (menuTrigger.current?.isConnected) menuTrigger.current.focus(); else props.searchRef.current?.focus(); }}>
                <DialogTitle>{target?.item.title}</DialogTitle>
                {target && <>
                    <Button type="button" disabled={props.busy} onClick={() => { props.onRename({kind: target.kind, id: target.item.id, title: target.item.title}); setTarget(null); }}>Переименовать</Button>
                    {target.kind === "conversation" ? <>
                        <Button type="button" onClick={() => { props.onPin(target.item); setTarget(null); }}>{target.item.pinned ? "Открепить" : "Закрепить"}</Button>
                        <label>Переместить в проект<select aria-label="Переместить беседу" disabled={props.busy || target.item.archived} value={target.item.project_id ?? 0} onChange={(event) => { props.onMove(target.item.id, Number(event.target.value) || null); setTarget(null); }}>
                            <option value={0}>Без проекта</option>{activeProjects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                        </select></label>
                        <Button type="button" disabled={props.busy} onClick={() => { props.onArchive(target.item); setTarget(null); }}>{target.item.archived ? "Восстановить" : "Архивировать"}</Button>
                    </> : <Button type="button" disabled={props.busy} onClick={() => { props.onArchiveProject(target.item); setTarget(null); }}>{target.item.archived ? "Восстановить" : "Архивировать"}</Button>}
                </>}
                <Button type="button" onClick={() => setTarget(null)}>Закрыть</Button>
            </DialogContent>
        </Dialog>
    </>;
}
