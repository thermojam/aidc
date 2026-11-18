import {isValidElement, memo, useState} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import "highlight.js/styles/github.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("svg", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);

type Props = {content: string; messageId: number; onArtifact: (messageId: number, kind: "code" | "html" | "svg", title: string, content: string) => void};

function CodeBlock({code, language, complete, onArtifact}: {code: string; language: string; complete: boolean; onArtifact: () => void}) {
    const [copyStatus, setCopyStatus] = useState("");
    const highlighted = complete && language && hljs.getLanguage(language)
        ? hljs.highlight(code, {language, ignoreIllegals: true}).value : null;
    async function copy() {
        try { await navigator.clipboard.writeText(code); setCopyStatus("Скопировано"); }
        catch { setCopyStatus("Не удалось скопировать код. Выделите его и скопируйте вручную."); }
    }
    return <div className="code-block">
        <div className="code-block-heading"><span>{language || "Код"}</span>
            <div><button type="button" className="secondary-button" onClick={() => void copy()}>Копировать</button>
                <button type="button" className="secondary-button" onClick={onArtifact}>Открыть как Artifact</button></div>
        </div>
        {copyStatus && <p role="status">{copyStatus}</p>}
        <pre><code className="hljs" {...(highlighted ? {dangerouslySetInnerHTML: {__html: highlighted}} : {children: code})}/></pre>
    </div>;
}

function MarkdownMessage({content, messageId, onArtifact}: Props) {
    return <div className="markdown">
        <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
            a({children, href}) { return <span>{children}{href ? ` (${href})` : ""}</span>; },
            img({alt}) { return <span>[Изображение не загружено{alt ? `: ${alt}` : ""}]</span>; },
            table({children}) { return <div className="markdown-table" role="region" aria-label="Таблица" tabIndex={0}><table>{children}</table></div>; },
            pre({children, node}) {
                if (!isValidElement<{className?: string; children?: unknown}>(children)) return <pre>{children}</pre>;
                const language = children.props.className?.replace(/^language-/, "") ?? "";
                const code = String(children.props.children ?? "").replace(/\n$/, "");
                const kind = language === "html" ? "html" : language === "svg" ? "svg" : "code";
                const start = node?.position?.start.offset;
                const end = node?.position?.end.offset;
                const source = start !== undefined && end !== undefined ? content.slice(start, end) : "";
                const lines = source.split("\n");
                const fence = /(?:^|[\s>])(`{3,}|~{3,})[^`~]*$/.exec(lines[0]);
                const closing = fence && lines.slice(1).some((line) => new RegExp(`^[\\s>]*${fence[1][0]}{${fence[1].length},}\\s*$`).test(line));
                return <CodeBlock code={code} language={language} complete={Boolean(closing)}
                    onArtifact={() => onArtifact(messageId, kind, language || "code", code)}/>;
            }
        }}>{content}</ReactMarkdown>
    </div>;
}

export default memo(MarkdownMessage);
