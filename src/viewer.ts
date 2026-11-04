import { Channel, invoke } from "@tauri-apps/api/core";

const result = document.getElementById("result")!;
Promise.allSettled([
  invoke("list_history"),
  invoke("start_mock_generation", { prompt: "viewer must fail", onEvent: new Channel() }),
  invoke("stop_generation"),
  invoke("save_key", { key: "viewer must fail" }),
  invoke("delete_key"),
  invoke("key_status"),
  invoke("create_backup"),
]).then((calls) => {
  result.textContent = calls.every((call) => call.status === "rejected")
    ? "PASS: все семь команд отклонены"
    : "FAIL: хотя бы одна команда доступна";
});
