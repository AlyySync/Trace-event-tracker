#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod device;
mod engine;

use engine::{Engine, Status};
use serde::Serialize;
use std::sync::Arc;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use trace_core::{now_ms, Capture, Event, Result, Settings};

type Backend<'a> = State<'a, Arc<Engine>>;

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn native_status(engine: Backend<'_>) -> Result<Status> {
    let engine = engine.inner().clone();
    blocking(move || engine.status()).await
}
#[tauri::command]
async fn list_sources(engine: Backend<'_>) -> Result<Vec<capture::Source>> {
    let engine = engine.inner().clone();
    blocking(move || engine.sources()).await
}
#[tauri::command]
async fn start_tracking(engine: Backend<'_>, source_id: String, label: String) -> Result<Status> {
    let engine = engine.inner().clone();
    blocking(move || engine.start(&source_id, &label)).await
}
#[tauri::command]
async fn pause_tracking(engine: Backend<'_>, reason: Option<String>) -> Result<Status> {
    let engine = engine.inner().clone();
    let reason: String = reason
        .unwrap_or_else(|| "Tracking paused".into())
        .chars()
        .take(180)
        .collect();
    blocking(move || engine.pause(&reason)).await
}
#[tauri::command]
async fn finish_tracking(engine: Backend<'_>) -> Result<Status> {
    let engine = engine.inner().clone();
    blocking(move || engine.finish()).await
}
#[tauri::command]
async fn capture_now(engine: Backend<'_>) -> Result<Status> {
    let engine = engine.inner().clone();
    blocking(move || {
        if let Err(error) = engine.sample(true) {
            // A concurrent automatic capture is harmless; the next click can retry.
            if error != engine::CAPTURE_BUSY && error != engine::NOT_TRACKING {
                engine.failure(error.clone());
            }
            return Err(error);
        }
        engine.status()
    })
    .await
}
#[tauri::command]
async fn set_preferences(engine: Backend<'_>, settings: Settings) -> Result<Status> {
    let engine = engine.inner().clone();
    blocking(move || engine.preferences(settings)).await
}
#[tauri::command]
async fn rename_session(engine: Backend<'_>, label: String) -> Result<Status> {
    let engine = engine.inner().clone();
    blocking(move || {
        let mut r = engine.runtime.lock().map_err(|e| e.to_string())?;
        let current = r.workspace.current.as_mut().ok_or("No session to rename")?;
        current.label = if label.trim().is_empty() {
            "Work session".into()
        } else {
            label.trim().chars().take(100).collect()
        };
        r.persist()?;
        drop(r);
        engine.status()
    })
    .await
}
#[tauri::command]
async fn record_interactions(
    engine: Backend<'_>,
    clicks: u32,
    scrolls: u32,
    hidden: Option<bool>,
) -> Result<()> {
    if clicks > 1000 || scrolls > 1000 {
        return Err("Invalid interaction batch".into());
    }
    let engine = engine.inner().clone();
    blocking(move || {
        let mut r = engine.runtime.lock().map_err(|e| e.to_string())?;
        if r.source.is_none() {
            return Ok(());
        }
        if let Some(current) = &mut r.workspace.current {
            current.clicks += u64::from(clicks);
            current.scrolls += u64::from(scrolls);
            if let Some(hidden) = hidden {
                current.switches += u64::from(hidden);
                current.push(Event::new(
                    "visibility",
                    if hidden {
                        "Trace moved to background"
                    } else {
                        "Trace brought to foreground"
                    },
                    now_ms(),
                ));
            }
            r.persist()?;
        }
        Ok(())
    })
    .await
}
#[tauri::command]
async fn list_captures(engine: Backend<'_>) -> Result<Vec<Capture>> {
    let engine = engine.inner().clone();
    blocking(move || {
        engine
            .runtime
            .lock()
            .map_err(|e| e.to_string())?
            .store
            .captures()
    })
    .await
}
#[tauri::command]
async fn read_capture(engine: Backend<'_>, id: String) -> Result<tauri::ipc::Response> {
    let engine = engine.inner().clone();
    blocking(move || {
        let png = engine
            .runtime
            .lock()
            .map_err(|e| e.to_string())?
            .store
            .capture_png(&id)?;
        Ok(tauri::ipc::Response::new(png))
    })
    .await
}
#[tauri::command]
async fn export_capture(app: tauri::AppHandle, engine: Backend<'_>, id: String) -> Result<bool> {
    let engine = engine.inner().clone();
    blocking(move || {
        let png = engine
            .runtime
            .lock()
            .map_err(|e| e.to_string())?
            .store
            .capture_png(&id)?;
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("PNG screenshot", &["png"])
            .set_file_name(format!("Trace-{id}.png"))
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        std::fs::write(path, png).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
}
#[tauri::command]
async fn delete_capture(engine: Backend<'_>, id: String) -> Result<Status> {
    let engine = engine.inner().clone();
    blocking(move || {
        let mut r = engine.runtime.lock().map_err(|e| e.to_string())?;
        r.store.delete_capture(&id)?;
        r.capture_revision += 1;
        r.revision += 1;
        r.notice = "Screenshot deleted.".into();
        drop(r);
        engine.status()
    })
    .await
}
#[tauri::command]
async fn delete_session(engine: Backend<'_>, id: String) -> Result<Status> {
    let engine = engine.inner().clone();
    blocking(move || {
        let mut r = engine.runtime.lock().map_err(|e| e.to_string())?;
        if r.workspace.current.as_ref().is_some_and(|s| s.id == id) {
            return Err("Finish this session before deleting it".into());
        }
        r.workspace.history.retain(|s| s.id != id);
        r.notice = "Session removed. Its screenshots are still in Captures.".into();
        r.persist()?;
        drop(r);
        engine.status()
    })
    .await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    backend: &'static str,
    database_path: String,
    screenshots: &'static str,
    timestamps: &'static str,
}
#[tauri::command]
fn storage_info(engine: Backend<'_>) -> StorageInfo {
    StorageInfo { backend: "SQLite", database_path: engine.path.to_string_lossy().into_owned(),
        screenshots: "captures.png · PNG image bytes", timestamps: "captures.captured_at · UTC epoch milliseconds; captures.elapsed_ms · session elapsed milliseconds" }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("trace.sqlite3");
            let engine = Engine::open(path).map_err(std::io::Error::other)?;
            engine.run();
            app.manage(engine);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(engine) = window.try_state::<Arc<Engine>>() {
                    let _ = engine.pause("Window closed. Tracking paused.");
                }
            }
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(engine) = webview.try_state::<Arc<Engine>>() {
                    let _ = engine.pause("Interface reloaded. Reconnect to resume.");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            native_status,
            list_sources,
            start_tracking,
            pause_tracking,
            finish_tracking,
            capture_now,
            set_preferences,
            rename_session,
            record_interactions,
            list_captures,
            read_capture,
            export_capture,
            delete_capture,
            delete_session,
            storage_info
        ])
        .build(tauri::generate_context!())
        .expect("Could not start Trace. Check that its app data directory is writable.");
    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let Some(engine) = app.try_state::<Arc<Engine>>() {
                engine.shutdown();
            }
        }
    });
}
