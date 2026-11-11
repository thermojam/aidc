import {useEffect, useRef, useState} from "react";

export function useNavigationLayout() {
    const [viewport, setViewport] = useState(window.innerWidth);
    const [width, setWidth] = useState(() => Math.max(220, Math.min(320, Number(localStorage.getItem("navigation.width")) || 264)));
    const [wideOpen, setWideOpen] = useState(() => localStorage.getItem("navigation.open") !== "false");
    const [mediumOpen, setMediumOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const modal = viewport < 960;
    const open = modal ? sheetOpen : viewport >= 1200 ? wideOpen : mediumOpen;

    useEffect(() => {
        function resize() { setViewport(window.innerWidth); setSheetOpen(false); }
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);
    function setOpen(next: boolean) {
        if (modal) setSheetOpen(next);
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
    return {width, open, modal, viewport, trigger, search, setOpen, resizeWidth};
}
