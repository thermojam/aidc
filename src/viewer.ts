import {Channel, invoke} from "@tauri-apps/api/core";

const result = document.getElementById("result")!;
Promise.allSettled([
    invoke("list_history"),
    invoke("start_mock_generation", {
        prompt: "viewer must fail",
        attachmentIds: [],
        modelId: "local-mock",
        onEvent: new Channel()
    }),
    invoke("retry_mock_generation", {assistantId: 2, modelId: "local-mock", onEvent: new Channel()}),
    invoke("start_generation", {prompt: "viewer must fail", attachmentIds: [], modelId: "synthetic-model", onEvent: new Channel()}),
    invoke("retry_generation", {assistantId: 2, modelId: "synthetic-model", onEvent: new Channel()}),
    invoke("select_branch", {messageId: 2}),
    invoke("stop_generation"),
    invoke("save_key", {key: "viewer must fail"}),
    invoke("delete_key"),
    invoke("key_status"),
    invoke("create_backup"),
    invoke("list_backups"),
    invoke("restore_backup", {name: "history-missing.sqlite"}),
    invoke("pick_text_attachment"),
    invoke("remove_text_attachment", {id: 1}),
    invoke("list_models"),
    invoke("list_model_categories"),
    invoke("set_model_category", {modelId: "synthetic-model", category: "speed"}),
    invoke("refresh_models"),
    invoke("preview_context", {prompt: "viewer must fail", attachmentIds: [], modelId: "local-mock"}),
]).then((calls) => {
    result.textContent = calls.every((call) => call.status === "rejected" && /not allowed|explicitly denied/i.test(String(call.reason)))
        ? "PASS: все двадцать команд отклонены"
        : "FAIL: хотя бы одна команда доступна";
});
