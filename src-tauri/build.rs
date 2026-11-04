fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "list_history",
                "start_mock_generation",
                "retry_mock_generation",
                "select_branch",
                "stop_generation",
                "save_key",
                "delete_key",
                "key_status",
                "create_backup",
            ]),
        ),
    )
    .unwrap();
}
