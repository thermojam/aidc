import {Channel, invoke} from "@tauri-apps/api/core";

const result = document.getElementById("result")!;
Promise.allSettled([
    invoke("list_history", {conversationId: 1}),
    invoke("list_conversations"),
    invoke("search_conversations", {query: "viewer"}),
    invoke("set_conversation_pinned", {conversationId: 1, pinned: true}),
    invoke("create_conversation"),
    invoke("rename_conversation", {conversationId: 1, title: "viewer"}),
    invoke("archive_conversation", {conversationId: 1, archived: true}),
    invoke("start_mock_generation", {
        conversationId: 1,
        prompt: "viewer must fail",
        attachmentIds: [],
        modelId: "local-mock",
        onEvent: new Channel()
    }),
    invoke("retry_mock_generation", {conversationId: 1, assistantId: 2, modelId: "local-mock", onEvent: new Channel()}),
    invoke("start_generation", {conversationId: 1, prompt: "viewer must fail", attachmentIds: [], modelId: "synthetic-model", onEvent: new Channel()}),
    invoke("retry_generation", {conversationId: 1, assistantId: 2, modelId: "synthetic-model", onEvent: new Channel()}),
    invoke("select_branch", {conversationId: 1, messageId: 2}),
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
    invoke("preview_context", {conversationId: 1, prompt: "viewer must fail", attachmentIds: [], modelId: "local-mock"}),
    invoke("create_artifact", {messageId: 2, kind: "html", title: "viewer", content: "<p>test</p>"}),
    invoke("export_artifact", {id: 1}),
]).then((calls) => {
    result.textContent = calls.every((call) => call.status === "rejected" && /not allowed|explicitly denied/i.test(String(call.reason)))
        ? "PASS: все двадцать восемь команд отклонены"
        : "FAIL: хотя бы одна команда доступна";
});
