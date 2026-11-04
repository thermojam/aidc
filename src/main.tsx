import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Channel, invoke } from "@tauri-apps/api/core";
import "./style.css";

type Message = { id: number; parent_id: number | null; role: "user" | "assistant"; content: string; status: string };
type History = { messages: Message[]; active_leaf_id: number | null };
type StreamEvent =
  | { event: "delta"; data: { attempt_id: number; seq: number; text: string } }
  | { event: "end"; data: { attempt_id: number; status: string } };

function App() {
  const [history, setHistory] = useState<History>({ messages: [], active_leaf_id: null });
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    setHistory(await invoke<History>("list_history"));
  }

  useEffect(() => {
    reload().catch((reason) => setError(String(reason)));
  }, []);

  async function runMock(command: string, args: Record<string, unknown>, restorePrompt?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setDraft("");
    const channel = new Channel<StreamEvent>();
    let lastSeq = 0;
    channel.onmessage = (message) => {
      if (message.event === "delta") {
        if (message.data.seq === lastSeq + 1) {
          lastSeq = message.data.seq;
          setDraft((current) => current + message.data.text);
        } else if (message.data.seq > lastSeq + 1) {
          reload().catch((reason) => setError(String(reason)));
        }
      } else {
        setBusy(false);
        setDraft("");
        reload().catch((reason) => setError(String(reason)));
      }
    };
    try {
      await invoke<number>(command, { ...args, onEvent: channel });
      await reload();
    } catch (reason) {
      setBusy(false);
      if (restorePrompt !== undefined) setPrompt(restorePrompt);
      setError(String(reason));
    }
  }

  async function send() {
    const value = prompt.trim();
    if (!value || busy) return;
    setPrompt("");
    await runMock("start_mock_generation", { prompt: value }, value);
  }

  async function retry(assistantId: number) {
    await runMock("retry_mock_generation", { assistantId });
  }

  async function selectBranch(messageId: number) {
    try {
      await invoke("select_branch", { messageId });
      await reload();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function stop() {
    try {
      await invoke("stop_generation");
    } catch (reason) {
      setError(String(reason));
    }
  }

  const byId = new Map(history.messages.map((message) => [message.id, message]));
  const activeIds = new Set<number>();
  for (let id = history.active_leaf_id; id !== null;) {
    const message = byId.get(id);
    if (!message || activeIds.has(id)) break;
    activeIds.add(id);
    id = message.parent_id;
  }
  const visible = history.messages.filter((message) => activeIds.has(message.id) && (!busy || message.status !== "streaming"));
  return (
    <main>
      <header>
        <h1>AI Desktop Client</h1>
        <p>Локальный тест потока. Запросы в сеть не отправляются.</p>
      </header>
      <section className="history" aria-label="История сообщений">
        {visible.map((message) => (
          <article key={message.id}>
            <strong>{message.role === "user" ? "Вы" : "Тестовый ответ"}</strong>
            <p>{message.content}</p>
            {message.status !== "completed" && <small>{message.status}</small>}
            {message.role === "assistant" && (
              <div className="branch-actions">
                {history.messages.filter((candidate) => candidate.role === "assistant" && candidate.parent_id === message.parent_id).map((candidate, index) => (
                  <button type="button" key={candidate.id} disabled={busy || candidate.id === message.id} onClick={() => void selectBranch(candidate.id)}>
                    Ответ {index + 1}{candidate.id === message.id ? " · выбран" : ""}
                  </button>
                ))}
                <button type="button" disabled={busy} onClick={() => void retry(message.id)}>Повторить тестовый ответ</button>
              </div>
            )}
          </article>
        ))}
        {busy && <article><strong>Тестовый ответ</strong><p>{draft || "Ожидание ответа…"}</p></article>}
      </section>
      <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label htmlFor="prompt">Сообщение</label>
        <textarea id="prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} />
        <div className="actions">
          <button type="submit" disabled={busy || !prompt.trim()}>Отправить в локальный тест</button>
          {busy && <button type="button" onClick={() => void stop()}>Остановить</button>}
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
