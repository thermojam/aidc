import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Channel, invoke } from "@tauri-apps/api/core";
import "./style.css";

type Message = { id: number; parent_id: number | null; role: "user" | "assistant"; content: string; status: string };
type History = { messages: Message[]; active_leaf_id: number | null };
type StreamEvent =
  | { event: "delta"; data: { attempt_id: number; seq: number; text: string } }
  | { event: "end"; data: { attempt_id: number; status: string } };
type Theme = "system" | "light" | "dark";

const statusLabel: Record<string, string> = {
  interrupted: "Ответ прерван",
  stopped: "Остановлено",
  failed: "Ошибка",
  streaming: "Ответ продолжается",
};

function App() {
  const [history, setHistory] = useState<History>({ messages: [], active_leaf_id: null });
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("appearance");
    return saved === "light" || saved === "dark" ? saved : "system";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("appearance", theme);
  }, [theme]);

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
    <main className="app-shell">
      <aside className="sidebar" aria-label="Чаты">
        <div className="sidebar-heading">AI Desktop Client</div>
        <div className="sidebar-label">Чаты</div>
        <div className="chat-item" aria-current="page">
          <span className="chat-item-title">Локальный чат</span>
          <span className="chat-item-count">{history.messages.length}</span>
        </div>
        <div className="sidebar-footer">Локальный тест · без сети</div>
      </aside>
      <section className="chat-panel" aria-label="Локальный чат">
        <header className="chat-header">
          <div>
            <h1>Локальный чат</h1>
            <p>Проверка интерфейса и потока ответов</p>
          </div>
          {history.messages.some((message) => message.role === "assistant") && (
            <label htmlFor="branch">
              Ветка
              <select id="branch" value={history.active_leaf_id ?? ""} disabled={busy} onChange={(event) => void selectBranch(Number(event.target.value))}>
                {history.messages.filter((message) => message.role === "assistant").map((message) => (
                  <option key={message.id} value={message.id}>Ответ #{message.id}</option>
                ))}
              </select>
            </label>
          )}
          <label className="theme-control" htmlFor="theme">
            <span>Тема</span>
            <select id="theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
              <option value="system">Системная</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </label>
        </header>
        <div className="history" aria-label="История сообщений" role="log">
          {visible.length === 0 && !busy && (
            <div className="empty-state">
              <h2>Начните разговор</h2>
              <p>Отправьте сообщение, чтобы увидеть локальный тестовый ответ. Данные сохраняются на этом компьютере.</p>
            </div>
          )}
          {visible.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              <strong>{message.role === "user" ? "Вы" : "Тестовый ответ"}</strong>
              <p>{message.content}</p>
              {message.status !== "completed" && <small>{statusLabel[message.status] ?? message.status}</small>}
              {message.role === "assistant" && (
                <div className="branch-actions">
                  {history.messages.filter((candidate) => candidate.role === "assistant" && candidate.parent_id === message.parent_id).map((candidate, index) => (
                    <button type="button" className="secondary-button" key={candidate.id} disabled={busy || candidate.id === message.id} onClick={() => void selectBranch(candidate.id)}>
                      Ответ {index + 1}{candidate.id === message.id ? " · выбран" : ""}
                    </button>
                  ))}
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => void retry(message.id)}>Повторить тестовый ответ</button>
                </div>
              )}
            </article>
          ))}
          {busy && <article className="message message-assistant"><strong>Тестовый ответ</strong><p>{draft || "Ожидание ответа…"}</p><small>Ответ продолжается</small></article>}
        </div>
        <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <label htmlFor="prompt">Сообщение</label>
          <textarea id="prompt" value={prompt} maxLength={2000} placeholder="Напишите сообщение для локального теста" onChange={(event) => setPrompt(event.target.value)} />
          <div className="composer-footer">
            <span>Запросы в сеть не отправляются</span>
            <div className="actions">
              {busy && <button type="button" className="secondary-button" onClick={() => void stop()}>Остановить</button>}
              <button type="submit" disabled={busy || !prompt.trim()}>Отправить</button>
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
        </form>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
