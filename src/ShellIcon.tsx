export default function ShellIcon({name}: {name: "chat" | "folder" | "settings" | "panel" | "more" | "close"}) {
    const paths = {
        chat: "M4 4h16v12H9l-5 4V4Z",
        folder: "M3 6h7l2 2h9v12H3V6Z",
        settings: "M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
        panel: "M3 4h18v16H3V4Zm6 0v16",
        more: "M5 12h1m5 0h1m5 0h1",
        close: "m6 6 12 12M6 18 18 6",
    };
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
