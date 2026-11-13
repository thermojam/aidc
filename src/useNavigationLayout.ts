import {useEffect, useRef, useState} from "react";

export function useNavigationLayout() {
    const [viewport, setViewport] = useState(document.documentElement.clientWidth);
    const viewportWidth = useRef(viewport);
    const [width, setWidth] = useState(() => Math.max(220, Math.min(320, Number(localStorage.getItem("navigation.width")) || 264)));
    const [wideOpen, setWideOpen] = useState(() => localStorage.getItem("navigation.open") !== "false");
    const [mediumOpen, setMediumOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const opener = useRef<HTMLElement | null>(null);
    const modal = viewport < 960;
    const open = modal ? sheetOpen : viewport >= 1200 ? wideOpen : mediumOpen;

    useEffect(() => {
        // Native WebKit page zoom also changes the CSS viewport; observe its size directly.
        function resize() {
            const next = document.documentElement.clientWidth;
            if (next === viewportWidth.current) return;
            viewportWidth.current = next;
            setViewport(next);
            setSheetOpen(false);
        }
        const observer = new ResizeObserver(resize);
        observer.observe(document.documentElement);
        window.addEventListener("resize", resize);
        return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
    }, []);
    function setOpen(next: boolean, source?: HTMLElement | null) {
        if (modal) {
            if (next) opener.current = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
            setSheetOpen(next);
        }
        else if (viewport >= 1200) {
            setWideOpen(next);
            localStorage.setItem("navigation.open", String(next));
        } else setMediumOpen(next);
    }
    function resizeWidth(next: number) {
        const bounded = Math.max(220, Math.min(320, next, viewport - 48 - 560));
        setWidth(bounded);
        localStorage.setItem("navigation.width", String(bounded));
    }
    function restoreFocus() {
        const previous = opener.current;
        (previous?.isConnected && previous.offsetParent && previous !== document.body ? previous : trigger.current)?.focus();
    }
    return {width, open, modal, viewport, trigger, search, setOpen, resizeWidth, restoreFocus};
}
