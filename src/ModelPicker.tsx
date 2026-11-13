import {useId, useRef, useState} from "react";
import {Dialog, DialogContent, DialogTitle} from "./components/ui/dialog";

type Model = {id: string; name: string; protocols: string[]; input_rubles_per_million: number | null; output_rubles_per_million: number | null};
type Category = {model_id: string; category: string};
const labels: Record<string, string> = {thinking: "Мышление", speed: "Скорость", economy: "Экономия", other: "Остальные"};

export default function ModelPicker({models, categories, value, disabled, fetchedAt, catalogFailed, onChange}: {
    models: Model[]; categories: Category[]; value: string; disabled: boolean;
    fetchedAt: number | null; catalogFailed: boolean; onChange: (id: string) => void;
}) {
    const id = useId();
    const nativePopover = typeof HTMLElement.prototype.showPopover === "function";
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const [storageError, setStorageError] = useState("");
    const [favorites, setFavorites] = useState<string[]>(() => {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem("modelFavorites.v1") ?? "[]");
            return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : [];
        } catch { return []; }
    });
    const selected = models.find((model) => model.id === value);
    const choices = [{id: "local-mock", name: "Локальный тест", protocols: [], input_rubles_per_million: null, output_rubles_per_million: null}, ...models.filter((model) => !model.protocols.length || model.protocols.includes("chat_completions"))]
        .filter((model) => `${model.name} ${model.id} ${model.id === "local-mock" ? "без сети" : "SimpleClaw"}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
            && (!category || (categories.find((item) => item.model_id === model.id)?.category ?? "other") === category))
        .sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));

    function toggleFavorite(modelId: string) {
        const next = favorites.includes(modelId) ? favorites.filter((item) => item !== modelId) : [...favorites, modelId];
        try {
            localStorage.setItem("modelFavorites.v1", JSON.stringify(next));
            setFavorites(next);
            setStorageError("");
        } catch { setStorageError("Не удалось сохранить избранное на этом компьютере."); }
    }

    function close() {
        if (nativePopover) { panel.current?.hidePopover(); trigger.current?.focus(); }
        else setOpen(false);
    }

    const content = <div onKeyDown={(event) => {
        event.stopPropagation();
        if (nativePopover && event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
    }}>
            <div className="model-picker-heading"><strong>Выбор модели</strong><button type="button" onClick={close}>Закрыть</button></div>
            <label htmlFor={`${id}-search`}>Поиск по имени или ID</label>
            <input ref={search} id={`${id}-search`} value={query} onChange={(event) => setQuery(event.target.value)}/>
            <label htmlFor={`${id}-category`}>Ваша категория</label>
            <select id={`${id}-category`} value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">Все категории</option>
                {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <p>{fetchedAt ? `Снимок каталога и цен: ${new Date(fetchedAt * 1000).toLocaleString()}.` : "Каталог недоступен."} {fetchedAt && (catalogFailed || Date.now() / 1000 - fetchedAt > 86400) ? "Устаревший кэш; актуальность цен не подтверждена." : ""}</p>
            <p>Источник: <a href="https://simple-claw.ru/docs/provider-api" target="_blank" rel="noreferrer">SimpleClaw · GET /v1/models</a>. Каталог не проверяет ключ или готовность отправки. Лимит контекста и расход неизвестны.</p>
            {storageError && <p role="alert">{storageError}</p>}
            <div className="model-picker-results" aria-label="Модели">
                {!choices.length && <p role="status">Модели не найдены. Измените поиск или категорию.</p>}
                {choices.map((model) => <div key={model.id} className="model-picker-row">
                    <button type="button" className="secondary-button model-picker-choice" disabled={disabled} aria-pressed={value === model.id}
                            onClick={() => { onChange(model.id); close(); }}>
                        <strong>{model.name}</strong><span>{model.id}</span>
                        <span>{model.id === "local-mock" ? "Без сети" : "API: SimpleClaw · провайдер модели неизвестен"}</span>
                        <span>{model.id === "local-mock" ? "Локальная демонстрация" : `Доступна для выбора · свойства не подтверждены · ${labels[categories.find((item) => item.model_id === model.id)?.category ?? "other"]}`}</span>
                        {model.id !== "local-mock" && <span>Вход: {model.input_rubles_per_million ?? "неизвестно"}; выход: {model.output_rubles_per_million ?? "неизвестно"} ₽/млн токенов</span>}
                    </button>
                    <button type="button" className="secondary-button" aria-pressed={favorites.includes(model.id)} aria-label={`Избранное: ${model.name}`}
                            onClick={() => toggleFavorite(model.id)}>{favorites.includes(model.id) ? "★" : "☆"}</button>
                </div>)}
            </div>

    </div>;

    return <>
        <button ref={trigger} type="button" className="secondary-button model-picker-trigger" disabled={disabled} popoverTarget={nativePopover ? id : undefined} onClick={() => { if (!nativePopover) setOpen(true); }}
                title={value === "local-mock" ? "Локальный тест · без сети" : `${selected?.name ?? value} · ${value}`}
                aria-label={`Модель: ${value === "local-mock" ? "Локальный тест · без сети" : selected?.name ?? value}`}>
            {value === "local-mock" ? "Локальный тест · без сети" : selected?.name ?? value}
        </button>
        {nativePopover ? <div ref={panel} id={id} popover="auto" className="model-picker" role={open ? "dialog" : undefined} aria-label="Выбор модели"
             onToggle={() => { const visible = panel.current?.matches(":popover-open") ?? false; setOpen(visible); if (visible) search.current?.focus(); }}>{content}</div> :
            <Dialog open={open} onOpenChange={setOpen}><DialogContent className="model-picker" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }} onOpenAutoFocus={(event) => { event.preventDefault(); search.current?.focus(); }}>
                <DialogTitle className="sr-only">Выбор модели</DialogTitle>{content}
            </DialogContent></Dialog>}
    </>;
}
