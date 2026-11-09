import {isValidElement, memo} from "react";
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

function MarkdownMessage({content, messageId, onArtifact}: Props) {
    return <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            a({children, href}) { return <span>{children}{href ? ` (${href})` : ""}</span>; },
            img() { return null; },
            pre({children}) {
                if (!isValidElement<{className?: string; children?: unknown}>(children)) return <pre>{children}</pre>;
                const language = children.props.className?.replace(/^language-/, "") ?? "";
                const code = String(children.props.children ?? "").replace(/\n$/, "");
                const kind = language === "html" ? "html" : language === "svg" ? "svg" : "code";
                const highlighted = language && hljs.getLanguage(language)
                    ? hljs.highlight(code, {language, ignoreIllegals: true}).value
                    : null;
                return <div className="code-block">
                    <div className="code-block-heading"><span>{language || "Код"}</span>
                        <button type="button" className="secondary-button"
                                onClick={() => onArtifact(messageId, kind, language || "code", code)}>Открыть как Artifact</button>
                    </div>
                    <pre><code className="hljs" {...(highlighted ? {dangerouslySetInnerHTML: {__html: highlighted}} : {children: code})}/></pre>
                </div>;
            }
        }}>{content}</ReactMarkdown>
    </div>;
}

export default memo(MarkdownMessage);
