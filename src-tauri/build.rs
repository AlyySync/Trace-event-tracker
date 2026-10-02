fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "native_status",
            "list_sources",
            "start_tracking",
            "pause_tracking",
            "finish_tracking",
            "capture_now",
            "set_preferences",
            "rename_session",
            "record_interactions",
            "list_captures",
            "read_capture",
            "export_capture",
            "delete_capture",
            "delete_session",
            "storage_info",
        ]),
    ))
    .expect("Tauri build configuration failed");
}
