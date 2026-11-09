import {useMemo, useState} from "react";
import DOMPurify from "dompurify";

export type ArtifactVersion = {
    id: number; message_id: number; previous_version_id: number | null; kind: "code" | "html" | "svg";
    title: string; content: string; sha256: string; created_at: number
};

const csp = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

export default function ArtifactPanel({artifact, versions, onSelect, onClose, onExport, onError}: {
    artifact: ArtifactVersion;
    versions: ArtifactVersion[];
    onSelect: (id: number) => void;
    onClose: () => void;
    onExport: (id: number) => void;
    onError: (reason: string) => void
}) {
    const [mode, setMode] = useState<"code" | "preview">("code");
    const preview = useMemo(() => {
        if (artifact.kind === "code") return "";
        const clean = DOMPurify.sanitize(artifact.content, {
            FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "link", "meta", "base", "audio", "video"],
            FORBID_ATTR: ["src", "href", "xlink:href", "action", "formaction"]
        });
        return `<meta http-equiv="Content-Security-Policy" content="${csp}"><body>${clean}</body>`;
    }, [artifact]);

    return <aside className="artifact-panel" aria-label="Artifact">
        <header className="artifact-heading"><strong>{artifact.title}</strong>
            <button type="button" className="secondary-button" onClick={onClose}><span className="compact-only">Назад к чату</span><span className="wide-only">Закрыть</span></button></header>
        <label htmlFor="artifact-version">Версия</label>
        <select id="artifact-version" value={artifact.id} onChange={(event) => onSelect(Number(event.target.value))}>
            {versions.filter((version) => version.message_id === artifact.message_id).map((version) =>
                <option key={version.id} value={version.id}>#{version.id} · {new Date(version.created_at * 1000).toLocaleString()}</option>)}
        </select>
        <div className="artifact-actions">
            <button type="button" className="secondary-button" onClick={() => setMode("code")}>Code</button>
            {artifact.kind !== "code" && <button type="button" className="secondary-button" onClick={() => setMode("preview")}>Статический Preview</button>}
            <button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(artifact.content).catch((reason) => onError(String(reason)))}>Копировать</button>
            <button type="button" className="secondary-button" onClick={() => onExport(artifact.id)}>Экспорт</button>
        </div>
        {mode === "preview" && artifact.kind !== "code" ? <>
            <p>Интерактивный просмотр недоступен. Скрипты, формы и внешние ресурсы отключены.</p>
            <iframe key={artifact.id} title={`Статический Preview ${artifact.title}`} sandbox="" referrerPolicy="no-referrer" srcDoc={preview}/>
        </> : <pre><code>{artifact.content}</code></pre>}
    </aside>;
}
