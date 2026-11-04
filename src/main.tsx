import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Channel, invoke } from "@tauri-apps/api/core";
import "./style.css";

type Message = { id: number; role: "user" | "assistant"; content: string; status: string };
type StreamEvent =
  | { event: "delta"; data: { attempt_id: number; seq: number; text: string } }
  | { event: "end"; data: { attempt_id: number; status: string } };

function App() {
  const [history, setHistory] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    setHistory(await invoke<Message[]>("list_history"));
  }

  useEffect(() => {
    reload().catch((reason) => setError(String(reason)));
  }, []);

  async function send() {
    const value = prompt.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    setDraft("");
    setPrompt("");
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
      await invoke<number>("start_mock_generation", { prompt: value, onEvent: channel });
      await reload();
    } catch (reason) {
      setBusy(false);
      setPrompt(value);
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

  const visible = busy ? history.filter((message) => message.status !== "streaming") : history;
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
