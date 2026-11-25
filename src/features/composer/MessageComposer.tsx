import {useEffect, useRef, useState, type ReactNode, type RefObject} from "react";

type Material = {id: number; name: string; version: number};
type Attachment = {id: number; name: string; mime: string};
type Props = {
    prompt: string; promptField: RefObject<HTMLTextAreaElement | null>; busy: boolean; dropLoading: boolean;
    conversationProjectId: number | null; materialsAvailable: boolean; projectMaterials: Material[];
    pendingAttachments: Attachment[]; selectedMaterialIds: number[];
    onPromptChange: (value: string) => void; onMentionPromptChange: (value: string) => void;
    onSelectMaterial: (id: number) => void; onSlashCommand: (command: string, remainder: string) => void;
    pickAttachment: () => Promise<void>; pickImageAttachment: () => Promise<void>;
    openVoice: () => void; openSettings: () => void; choosingWindow: boolean; hasSnapshot: boolean; isMac: boolean;
    captureWindowSnapshot: () => Promise<void>; submitPrompt: () => Promise<void>; checkContext: () => Promise<void>;
    stop: () => Promise<void>; sendDisabled: boolean;
    beforeInput: ReactNode; afterInput: ReactNode; tools: ReactNode; afterActions: ReactNode;
};

export default function MessageComposer({prompt, promptField, busy, dropLoading, conversationProjectId, materialsAvailable,
    projectMaterials, pendingAttachments, selectedMaterialIds, onPromptChange, onMentionPromptChange, onSelectMaterial,
    onSlashCommand, pickAttachment, pickImageAttachment, openVoice, openSettings, choosingWindow, hasSnapshot, isMac, captureWindowSnapshot, submitPrompt, checkContext, stop, sendDisabled, beforeInput, afterInput, tools, afterActions}: Props) {
    const [composerToolsOpen, setComposerToolsOpen] = useState(false);
    const composerMenu = useRef<HTMLDivElement>(null);
    const composerMenuButton = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!composerToolsOpen) return;
        composerMenu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        function dismiss(event: PointerEvent) {
            if (!composerMenu.current?.contains(event.target as Node) && !composerMenuButton.current?.contains(event.target as Node)) setComposerToolsOpen(false);
        }
        document.addEventListener("pointerdown", dismiss);
        return () => document.removeEventListener("pointerdown", dismiss);
    }, [composerToolsOpen]);

    const [slashDismissed, setSlashDismissed] = useState(false);
    const [slashIndex, setSlashIndex] = useState(0);
    const [mentionDismissed, setMentionDismissed] = useState(false);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [promptCaret, setPromptCaret] = useState(0);
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
        ? (materialsAvailable ? projectMaterials : []).map((item) => ({kind: "material" as const, id: item.id, name: item.name, detail: `версия ${item.version} · ${item.name.includes(".") ? item.name.split(".").pop() : "файл"}`}))
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
        if (item.kind === "material") onSelectMaterial(item.id);
        const caret = mentionStart + replacement.length;
        onMentionPromptChange(next);
        setPromptCaret(caret);
        setMentionDismissed(true);
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
        onSlashCommand(command, slashRemainder);
    }

    return <form className="composer" onSubmit={(event) => { event.preventDefault(); void submitPrompt(); }}>
        {beforeInput}
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
                        onPromptChange(event.target.value);
                        setPromptCaret(event.target.selectionStart);
                        setSlashDismissed(false);
                        setSlashIndex(0);
                        setMentionDismissed(false);
                        setMentionIndex(0);
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
                        <button type="button" className="secondary-button" role="menuitem" onClick={() => { openVoice(); setComposerToolsOpen(false); }}>Голосовой ввод…</button>
                        <button type="button" className="secondary-button" role="menuitem" disabled={busy || choosingWindow || hasSnapshot || pendingAttachments.length + selectedMaterialIds.length >= 5 || !isMac} onClick={() => { setComposerToolsOpen(false); void captureWindowSnapshot(); }}>Снимок окна…</button>
                        {!isMac && <small>Снимок окна доступен только на macOS.</small>}
                        {hasSnapshot && <small>Сначала прикрепите или удалите текущий снимок.</small>}
                        <button type="button" className="secondary-button" role="menuitem" onClick={() => { setComposerToolsOpen(false); openSettings(); }}>Дополнительные настройки…</button>
                    </div>}
        {afterInput}
        <div className="composer-footer">
            <div className="composer-tools">
                            <button ref={composerMenuButton} type="button" className="secondary-button" aria-label="Добавить вложение или открыть инструменты" aria-haspopup="menu" aria-expanded={composerToolsOpen} onClick={() => setComposerToolsOpen((open) => !open)}>+</button>
                {tools}
            </div>
            <div className="actions">
                <button type="button" className="secondary-button" disabled={busy || dropLoading || !prompt.trim()} onClick={() => void checkContext()}>Проверить контекст</button>
                {busy ? <button type="button" onClick={() => void stop()}>Остановить</button> : <button type="submit" disabled={sendDisabled}>Отправить</button>}
            </div>
        </div>
        {afterActions}
    </form>;
}
