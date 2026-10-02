use crate::{
    capture::{self, Source},
    device,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use trace_core::{now_ms, Capture, Event, Result, Settings, Store, WorkSession, Workspace};

pub const CAPTURE_BUSY: &str = "A screen capture is already in progress. Try again.";
pub const NOT_TRACKING: &str = "Start tracking before capturing";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: Workspace,
    pub connected: bool,
    pub device: String,
    pub change: Option<f64>,
    pub preview_frame: Option<String>,
    pub revision: u64,
    pub capture_revision: u64,
    pub error: String,
    pub notice: String,
}
pub struct Runtime {
    pub store: Store,
    pub workspace: Workspace,
    pub allowed: HashMap<String, Source>,
    pub source: Option<Source>,
    pub generation: u64,
    pub next_capture: Option<Instant>,
    pub previous: Option<Vec<u8>>,
    pub device: String,
    pub change: Option<f64>,
    pub preview: Option<String>,
    pub revision: u64,
    pub capture_revision: u64,
    pub error: String,
    pub notice: String,
    last_changing: Option<bool>,
    last_signal_at: i64,
}
impl Runtime {
    pub fn persist(&mut self) -> Result<()> {
        self.revision += 1;
        self.store.save(&self.workspace)
    }
    pub fn pause(&mut self, reason: &str, at: i64) -> Result<()> {
        self.generation += 1;
        self.source = None;
        self.next_capture = None;
        self.previous = None;
        self.preview = None;
        self.device = "unknown".into();
        self.change = None;
        if let Some(current) = &mut self.workspace.current {
            current.pause(at, reason);
        }
        self.notice = reason.into();
        self.persist()
    }
}
pub struct Engine {
    pub runtime: Mutex<Runtime>,
    pub path: PathBuf,
    capture_gate: Mutex<()>,
    quit: AtomicBool,
}
impl Engine {
    pub fn open(path: PathBuf) -> Result<Arc<Self>> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(parent) = path.parent() {
                std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
        }
        let store = Store::open(&path)?;
        let mut workspace = store.load()?;
        workspace.recover();
        store.save(&workspace)?;
        Ok(Arc::new(Self {
            path,
            runtime: Mutex::new(Runtime {
                store,
                workspace,
                allowed: HashMap::new(),
                source: None,
                generation: 0,
                next_capture: None,
                previous: None,
                device: "unknown".into(),
                change: None,
                preview: None,
                revision: 1,
                capture_revision: 0,
                error: String::new(),
                notice: String::new(),
                last_changing: None,
                last_signal_at: 0,
            }),
            capture_gate: Mutex::new(()),
            quit: AtomicBool::new(false),
        }))
    }
    pub fn status(&self) -> Result<Status> {
        let r = self.runtime.lock().map_err(|e| e.to_string())?;
        Ok(Status {
            state: r.workspace.clone(),
            connected: r.source.is_some(),
            device: r.device.clone(),
            change: r.change,
            preview_frame: r.preview.clone(),
            revision: r.revision,
            capture_revision: r.capture_revision,
            error: r.error.clone(),
            notice: r.notice.clone(),
        })
    }
    pub fn sources(&self) -> Result<Vec<Source>> {
        let sources = capture::list_sources()?;
        self.runtime.lock().map_err(|e| e.to_string())?.allowed = sources
            .iter()
            .map(|item| (item.id.clone(), item.clone()))
            .collect();
        Ok(sources)
    }
    pub fn start(&self, source_id: &str, label: &str) -> Result<Status> {
        let _gate = self.capture_gate.lock().map_err(|e| e.to_string())?;
        let (source, generation) = {
            let r = self.runtime.lock().map_err(|e| e.to_string())?;
            if r.source.is_some() {
                return Err("Pause before selecting another source".into());
            }
            (
                r.allowed
                    .get(source_id)
                    .cloned()
                    .ok_or("Choose an available source first")?,
                r.generation,
            )
        };
        if device::state() == "locked" {
            return Err("Unlock your device before tracking".into());
        }
        let first = capture::frame(&source)?;
        let thumbnail = STANDARD.encode(capture::png(&first, 960)?);
        let now = now_ms();
        let mut r = self.runtime.lock().map_err(|e| e.to_string())?;
        if r.generation != generation {
            return Err("Connection was cancelled".into());
        }
        if let Some(current) = &mut r.workspace.current {
            current.resume(now, &source.name, &source.kind);
        } else {
            r.workspace.current = Some(WorkSession::new(label, &source.name, &source.kind, now));
        }
        r.next_capture = Some(Instant::now() + r.workspace.settings.random_delay());
        r.last_changing = None;
        r.last_signal_at = 0;
        r.previous = Some(capture::pixels(&first));
        r.source = Some(source);
        r.change = None;
        r.preview = if r.workspace.settings.hide_preview {
            None
        } else {
            Some(format!("data:image/png;base64,{thumbnail}"))
        };
        r.error.clear();
        r.notice = "Tracking started. Random screenshots are enabled.".into();
        if let Err(error) = r.persist() {
            let _ = r.pause("Could not save the session", now);
            return Err(error);
        }
        drop(r);
        self.status()
    }
    pub fn pause(&self, reason: &str) -> Result<Status> {
        self.runtime
            .lock()
            .map_err(|e| e.to_string())?
            .pause(reason, now_ms())?;
        self.status()
    }
    pub fn finish(&self) -> Result<Status> {
        let mut r = self.runtime.lock().map_err(|e| e.to_string())?;
        r.pause("Screen disconnected", now_ms())?;
        r.workspace.finish(now_ms());
        r.notice = "Session saved to your timeline.".into();
        r.persist()?;
        drop(r);
        self.status()
    }
    pub fn preferences(&self, settings: Settings) -> Result<Status> {
        settings.validate()?;
        let mut r = self.runtime.lock().map_err(|e| e.to_string())?;
        if r.source.is_some()
            && (settings.capture_min != r.workspace.settings.capture_min
                || settings.capture_max != r.workspace.settings.capture_max)
        {
            r.next_capture = Some(Instant::now() + settings.random_delay());
        }
        if settings.hide_preview {
            r.preview = None;
        }
        r.workspace.settings = settings;
        r.notice = "Tracking preferences saved.".into();
        r.persist()?;
        drop(r);
        self.status()
    }
    pub fn sample(&self, manual: bool) -> Result<()> {
        let _gate = match self.capture_gate.try_lock() {
            Ok(gate) => gate,
            Err(_) => {
                return if manual {
                    Err(CAPTURE_BUSY.into())
                } else {
                    Ok(())
                }
            }
        };
        let (source, generation) = {
            let mut r = self.runtime.lock().map_err(|e| e.to_string())?;
            let Some(source) = r.source.clone() else {
                return if manual {
                    Err(NOT_TRACKING.into())
                } else {
                    Ok(())
                };
            };
            let last_seen = r
                .workspace
                .current
                .as_ref()
                .ok_or("No active session")?
                .last_seen;
            if now_ms() - last_seen > 15000 {
                r.pause(
                    "Device slept or capture was interrupted. Reconnect to continue.",
                    last_seen,
                )?;
                return Ok(());
            }
            (source, r.generation)
        };
        let device = device::state();
        if device == "locked" {
            self.pause("Device locked. Tracking paused.")?;
            return Ok(());
        }
        let image = capture::frame(&source)?;
        let pixels = capture::pixels(&image);
        let mut r = self.runtime.lock().map_err(|e| e.to_string())?;
        if r.generation != generation || r.source.is_none() {
            return Ok(());
        }
        let now = now_ms();
        let last_seen = r.workspace.current.as_ref().ok_or("No session")?.last_seen;
        if now - last_seen > 15000 {
            r.pause(
                "Capture feed was interrupted. Reconnect to continue.",
                last_seen,
            )?;
            return Ok(());
        }
        let change = r
            .previous
            .as_ref()
            .map(|previous| trace_core::frame_difference(previous, &pixels));
        r.previous = Some(pixels);
        r.change = change;
        if device != r.device {
            r.workspace.current.as_mut().unwrap().push(Event::new(
                "device",
                match device {
                    "idle" => "Device became idle",
                    "active" => "Device activity detected",
                    _ => "Device signal unavailable",
                },
                now,
            ));
        }
        r.device = device.into();
        let sensitivity = r.workspace.settings.sensitivity;
        if let Some(score) = change {
            r.workspace
                .current
                .as_mut()
                .unwrap()
                .observe(now, score, sensitivity, device);
            let changing = score >= sensitivity;
            if r.last_changing != Some(changing) && now - r.last_signal_at >= 10000 {
                r.last_changing = Some(changing);
                r.last_signal_at = now;
                r.workspace.current.as_mut().unwrap().push(Event::new(
                    "signal",
                    if changing {
                        "Screen content changed"
                    } else {
                        "Screen content became steady"
                    },
                    now,
                ));
            }
        } else {
            r.workspace.current.as_mut().unwrap().last_seen = now;
        }
        r.preview = if r.workspace.settings.hide_preview {
            None
        } else {
            Some(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(capture::png(&image, 960)?)
            ))
        };
        let automatic = r.next_capture.is_some_and(|at| Instant::now() >= at);
        if manual || automatic {
            let current = r.workspace.current.as_ref().unwrap();
            let resized = capture::resized(&image, 2560);
            let width = resized.width();
            let height = resized.height();
            let capture = Capture {
                id: trace_core::id(),
                session_id: Some(current.id.clone()),
                label: current.label.clone(),
                created_at: now,
                elapsed_ms: current.elapsed(now),
                width,
                height,
                kind: if manual { "manual" } else { "automatic" }.into(),
                source_label: source.name,
            };
            let png = capture::png(&resized, 2560)?;
            let mut workspace = r.workspace.clone();
            let mut event = Event::new(
                "capture",
                if manual {
                    "Manual screenshot captured"
                } else {
                    "Random screenshot captured"
                },
                now,
            );
            event.capture_id = Some(capture.id.clone());
            workspace.current.as_mut().unwrap().push(event);
            r.store.save_capture(&capture, &png, &workspace)?;
            r.workspace = workspace;
            r.capture_revision += 1;
            r.notice = if manual {
                "Screenshot saved."
            } else {
                "Random screenshot saved."
            }
            .into();
            if !manual {
                r.next_capture = Some(Instant::now() + r.workspace.settings.random_delay());
            }
        }
        r.persist()
    }
    pub fn failure(&self, error: String) {
        if let Ok(mut r) = self.runtime.lock() {
            let last_seen = r
                .workspace
                .current
                .as_ref()
                .map_or(now_ms(), |s| s.last_seen);
            let _ = r.pause(
                "Tracking paused after a capture or storage error",
                last_seen,
            );
            r.error = error;
            r.revision += 1;
        }
    }
    pub fn run(self: &Arc<Self>) {
        let engine = self.clone();
        std::thread::spawn(move || {
            let mut next_sample = Instant::now();
            while !engine.quit.load(Ordering::Relaxed) {
                if Instant::now() >= next_sample {
                    if let Err(error) = engine.sample(false) {
                        engine.failure(error);
                    }
                    next_sample = Instant::now() + Duration::from_millis(2500);
                }
                // Automatic deadlines are independent of the WebView event loop.
                let due = engine
                    .runtime
                    .lock()
                    .map(|r| r.next_capture.is_some_and(|at| Instant::now() >= at))
                    .unwrap_or(false);
                if due {
                    if let Err(error) = engine.sample(false) {
                        engine.failure(error);
                    }
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        });
    }
    pub fn shutdown(&self) {
        self.quit.store(true, Ordering::Relaxed);
        let _ = self.pause("App closed. Tracking paused.");
    }
}
