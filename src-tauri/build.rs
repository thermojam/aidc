fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "list_history",
                "start_mock_generation",
                "stop_generation",
            ]),
        ),
    )
    .unwrap();
}
