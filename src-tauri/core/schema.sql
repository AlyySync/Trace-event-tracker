PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = ON;

CREATE TABLE IF NOT EXISTS workspace (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS captures (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    label TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0),
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    kind TEXT NOT NULL CHECK (kind IN ('manual', 'automatic')),
    source_label TEXT NOT NULL,
    png BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS captures_time ON captures(captured_at DESC);
CREATE INDEX IF NOT EXISTS captures_session ON captures(session_id);
PRAGMA user_version = 1;
