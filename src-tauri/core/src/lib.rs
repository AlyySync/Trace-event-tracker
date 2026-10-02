use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;
pub fn id() -> String {
    Uuid::new_v4().to_string()
}
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub capture_min: u64,
    pub capture_max: u64,
    pub sensitivity: f64,
    pub motion: String,
    pub hide_preview: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            capture_min: 60,
            capture_max: 180,
            sensitivity: 3.0,
            motion: "ambient".into(),
            hide_preview: false,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<()> {
        if self.capture_min < 15 || self.capture_max > 3600 || self.capture_max <= self.capture_min
        {
            return Err("Use a screenshot interval between 15 and 3600 seconds; maximum must exceed minimum.".into());
        }
        if ![1.0, 3.0, 8.0].contains(&self.sensitivity)
            || !["ambient", "focused", "reduced"].contains(&self.motion.as_str())
        {
            return Err("Invalid tracking preferences.".into());
        }
        Ok(())
    }
    pub fn random_delay(&self) -> Duration {
        Duration::from_millis(rand::random_range(
            self.capture_min * 1000..=self.capture_max * 1000,
        ))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Span {
    pub start: i64,
    pub end: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub at: i64,
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_id: Option<String>,
}
impl Event {
    pub fn new(kind: &str, title: &str, at: i64) -> Self {
        Self {
            id: id(),
            at,
            kind: kind.into(),
            title: title.into(),
            detail: None,
            capture_id: None,
        }
    }
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
pub struct Bin {
    pub at: i64,
    pub observed: i64,
    pub changing: i64,
    pub idle: i64,
    pub active: i64,
    pub peak: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkSession {
    pub id: String,
    pub label: String,
    pub created_at: i64,
    pub ended_at: Option<i64>,
    pub running_since: Option<i64>,
    pub last_seen: i64,
    pub spans: Vec<Span>,
    pub source: String,
    pub source_type: String,
    pub bins: Vec<Bin>,
    pub events: Vec<Event>,
    pub clicks: u64,
    pub scrolls: u64,
    pub switches: u64,
    #[serde(default)]
    pub imported: bool,
}
impl WorkSession {
    pub fn new(label: &str, source: &str, kind: &str, now: i64) -> Self {
        Self {
            id: id(),
            label: if label.trim().is_empty() {
                "Work session".into()
            } else {
                label.trim().chars().take(100).collect()
            },
            created_at: now,
            ended_at: None,
            running_since: Some(now),
            last_seen: now,
            source: source.into(),
            source_type: kind.into(),
            spans: vec![],
            bins: vec![],
            events: vec![Event::new("start", "Screen tracking started", now)],
            clicks: 0,
            scrolls: 0,
            switches: 0,
            imported: false,
        }
    }
    pub fn elapsed(&self, now: i64) -> i64 {
        self.spans
            .iter()
            .map(|s| (s.end - s.start).max(0))
            .sum::<i64>()
            + self.running_since.map_or(0, |start| (now - start).max(0))
    }
    pub fn push(&mut self, event: Event) {
        self.events.push(event);
        if self.events.len() > 2000 {
            self.events.drain(..self.events.len() - 2000);
        }
    }
    pub fn pause(&mut self, at: i64, reason: &str) {
        if let Some(start) = self.running_since.take() {
            let end = at.max(start);
            self.spans.push(Span { start, end });
            self.last_seen = end;
            self.push(Event::new("pause", reason, end));
        }
    }
    pub fn resume(&mut self, at: i64, source: &str, kind: &str) {
        self.running_since = Some(at);
        self.last_seen = at;
        self.source = source.into();
        self.source_type = kind.into();
        self.push(Event::new("resume", "Tracking resumed", at));
    }
    pub fn observe(&mut self, now: i64, change: f64, sensitivity: f64, device: &str) {
        let gap = (now - self.last_seen).max(0);
        let measured = if gap > 7500 { gap.min(2500) } else { gap };
        let at = now / 60000 * 60000;
        if self.bins.last().map(|b| b.at) != Some(at) {
            self.bins.push(Bin {
                at,
                ..Bin::default()
            });
        }
        let bin = self.bins.last_mut().unwrap();
        bin.observed += measured;
        if change >= sensitivity {
            bin.changing += measured;
        }
        if device == "idle" {
            bin.idle += measured;
        }
        if device == "active" {
            bin.active += measured;
        }
        bin.peak = bin.peak.max(change);
        self.last_seen = now;
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub version: u32,
    pub current: Option<WorkSession>,
    pub history: Vec<WorkSession>,
    pub settings: Settings,
}
impl Default for Workspace {
    fn default() -> Self {
        Self {
            version: 2,
            current: None,
            history: vec![],
            settings: Settings::default(),
        }
    }
}
impl Workspace {
    pub fn recover(&mut self) {
        if let Some(current) = &mut self.current {
            current.pause(
                current.last_seen,
                "Tracking interrupted. Reconnect to resume.",
            );
        }
    }
    pub fn finish(&mut self, now: i64) {
        if let Some(mut current) = self.current.take() {
            current.pause(now, "Screen disconnected");
            current.ended_at = Some(now);
            current.push(Event::new("finish", "Session saved", now));
            self.history.insert(0, current);
        }
    }
}
pub fn frame_difference(previous: &[u8], current: &[u8]) -> f64 {
    if previous.len() != current.len() || current.is_empty() {
        return 0.0;
    }
    let changed = previous
        .chunks_exact(4)
        .zip(current.chunks_exact(4))
        .filter(|(a, b)| {
            (0..3)
                .map(|i| (a[i] as f64 - b[i] as f64).abs())
                .sum::<f64>()
                / 3.0
                > 22.0
        })
        .count();
    changed as f64 / (current.len() / 4) as f64 * 100.0
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub id: String,
    pub session_id: Option<String>,
    pub label: String,
    pub created_at: i64,
    pub elapsed_ms: i64,
    pub width: u32,
    pub height: u32,
    pub kind: String,
    pub source_label: String,
}
pub struct Store {
    connection: Connection,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch(include_str!("../schema.sql"))
            .map_err(|e| e.to_string())?;
        Ok(Self { connection: db })
    }
    pub fn load(&self) -> Result<Workspace> {
        let data: Option<String> = self
            .connection
            .query_row("SELECT json FROM workspace WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        let workspace: Workspace = match data {
            Some(value) => serde_json::from_str(&value).map_err(|e| e.to_string())?,
            None => Workspace::default(),
        };
        if workspace.version != 2 {
            return Err("Unsupported saved workspace version".into());
        }
        workspace.settings.validate()?;
        Ok(workspace)
    }
    pub fn save(&self, workspace: &Workspace) -> Result<()> {
        self.connection.execute("INSERT INTO workspace(id, json, updated_at) VALUES(1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at",
            params![serde_json::to_string(workspace).map_err(|e| e.to_string())?, now_ms()]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn save_capture(
        &mut self,
        capture: &Capture,
        png: &[u8],
        workspace: &Workspace,
    ) -> Result<()> {
        if !png.starts_with(b"\x89PNG\r\n\x1a\n")
            || png.len() > 64 * 1024 * 1024
            || capture.width == 0
            || capture.height == 0
        {
            return Err("Invalid PNG screenshot".into());
        }
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        transaction.execute("INSERT INTO captures(id, session_id, label, captured_at, elapsed_ms, width, height, kind, source_label, png) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![capture.id, capture.session_id, capture.label, capture.created_at, capture.elapsed_ms, capture.width, capture.height, capture.kind, capture.source_label, png]).map_err(|e| e.to_string())?;
        transaction.execute("INSERT INTO workspace(id,json,updated_at) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at",
            params![serde_json::to_string(workspace).map_err(|e| e.to_string())?, now_ms()]).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())
    }
    pub fn captures(&self) -> Result<Vec<Capture>> {
        let mut query = self.connection.prepare("SELECT id,session_id,label,captured_at,elapsed_ms,width,height,kind,source_label FROM captures ORDER BY captured_at DESC").map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |row| {
                Ok(Capture {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    label: row.get(2)?,
                    created_at: row.get(3)?,
                    elapsed_ms: row.get(4)?,
                    width: row.get(5)?,
                    height: row.get(6)?,
                    kind: row.get(7)?,
                    source_label: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn capture_png(&self, id: &str) -> Result<Vec<u8>> {
        self.connection
            .query_row("SELECT png FROM captures WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())
    }
    pub fn delete_capture(&self, id: &str) -> Result<()> {
        self.connection
            .execute("DELETE FROM captures WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paused_time_resume_and_recovery_are_exact() {
        let mut session = WorkSession::new("Focus", "Screen 1", "screen", 1000);
        session.pause(11000, "Pause");
        session.pause(51000, "Pause again");
        assert_eq!(session.elapsed(99999), 10000);
        session.resume(51000, "Screen 1", "screen");
        assert_eq!(session.elapsed(61000), 20000);
        session.last_seen = 59000;
        let mut workspace = Workspace {
            current: Some(session),
            ..Workspace::default()
        };
        workspace.recover();
        assert_eq!(workspace.current.as_ref().unwrap().elapsed(999999), 18000);
        workspace.finish(65000);
        assert!(workspace.current.is_none());
        assert_eq!(workspace.history[0].elapsed(999999), 18000);
    }
    #[test]
    fn random_range_is_validated_and_stays_inside_bounds() {
        let mut settings = Settings::default();
        settings.capture_min = 30;
        settings.capture_max = 90;
        for _ in 0..100 {
            let delay = settings.random_delay().as_millis();
            assert!((30000..=90000).contains(&delay));
        }
        settings.capture_max = 30;
        assert!(settings.validate().is_err());
        settings.capture_min = 0;
        assert!(settings.validate().is_err());
    }
    #[test]
    fn screen_changes_do_not_imply_user_input() {
        assert_eq!(
            frame_difference(&[0; 8], &[255, 255, 255, 255, 0, 0, 0, 0]),
            50.0
        );
        let mut session = WorkSession::new("Test", "Screen 1", "screen", 1000);
        session.observe(3500, 50.0, 3.0, "unknown");
        assert_eq!(session.bins[0].changing, 2500);
        assert_eq!(session.bins[0].active, 0);
        assert_eq!(session.bins[0].idle, 0);
    }
    #[test]
    fn sqlite_retains_timestamp_elapsed_and_png_after_reopening() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trace.sqlite3");
        let workspace = Workspace::default();
        let capture = Capture {
            id: id(),
            session_id: Some("session-1".into()),
            label: "Work".into(),
            created_at: 1790680000123,
            elapsed_ms: 72500,
            width: 1,
            height: 1,
            kind: "automatic".into(),
            source_label: "Screen 1".into(),
        };
        let png = b"\x89PNG\r\n\x1a\nfixture";
        {
            let mut store = Store::open(&path).unwrap();
            store.save_capture(&capture, png, &workspace).unwrap();
        }
        let store = Store::open(&path).unwrap();
        let records = store.captures().unwrap();
        assert_eq!(records[0].created_at, 1790680000123);
        assert_eq!(records[0].elapsed_ms, 72500);
        assert_eq!(store.capture_png(&capture.id).unwrap(), png);
        store.delete_capture(&capture.id).unwrap();
        drop(store);
        assert!(Store::open(&path).unwrap().captures().unwrap().is_empty());
    }
    #[test]
    fn invalid_capture_and_duplicate_id_do_not_overwrite_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(&dir.path().join("trace.sqlite3")).unwrap();
        let original = Workspace::default();
        store.save(&original).unwrap();
        let mut changed = original.clone();
        changed.settings.motion = "reduced".into();
        let capture = Capture {
            id: "one".into(),
            session_id: None,
            label: "Test".into(),
            created_at: 100,
            elapsed_ms: 0,
            width: 1,
            height: 1,
            kind: "manual".into(),
            source_label: "screen".into(),
        };
        assert!(store.save_capture(&capture, b"invalid", &changed).is_err());
        assert_eq!(store.load().unwrap().settings.motion, "ambient");
        store
            .save_capture(&capture, b"\x89PNG\r\n\x1a\nfixture", &original)
            .unwrap();
        assert!(store
            .save_capture(&capture, b"\x89PNG\r\n\x1a\nfixture", &changed)
            .is_err());
        assert_eq!(store.load().unwrap().settings.motion, "ambient");
    }
}
