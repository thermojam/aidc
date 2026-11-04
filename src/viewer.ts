import { Channel, invoke } from "@tauri-apps/api/core";

const result = document.getElementById("result")!;
Promise.allSettled([
  invoke("list_history"),
  invoke("start_mock_generation", { prompt: "viewer must fail", onEvent: new Channel() }),
  invoke("retry_mock_generation", { assistantId: 2, onEvent: new Channel() }),
  invoke("select_branch", { messageId: 2 }),
  invoke("stop_generation"),
  invoke("save_key", { key: "viewer must fail" }),
  invoke("delete_key"),
  invoke("key_status"),
  invoke("create_backup"),
]).then((calls) => {
  result.textContent = calls.every((call) => call.status === "rejected" && /not allowed|explicitly denied/i.test(String(call.reason)))
    ? "PASS: все девять команд отклонены"
    : "FAIL: хотя бы одна команда доступна";
});
