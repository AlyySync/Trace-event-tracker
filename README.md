# Trace

A desktop screen tracker built with **Tauri 2, Rust, React and TypeScript**. The graphite/mint interface, animations and Tempo-style circular stopwatch are preserved. Electron has been removed.

## Run on your PC

Install Node.js 22+, Rust stable, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS. Then, from this folder:

```sh
npm ci
npm run desktop
```

`desktop` opens the native Tauri window. Vite serves the interface during development only. For a bundled desktop app:

```sh
npm run desktop:build
```

The installer output goes under `src-tauri/target/release/bundle/` on the machine where you build. A release uses the bundled interface and does not need a web server. This archive is source code, not a signed installer.

The GitHub Actions workflow in `.github/workflows/desktop.yml` checks TypeScript, browser tracking tests, Rust core tests, the frontend build and native compilation on Linux and Windows for pushes and pull requests to `main`. Run it manually or push a `v*` tag to also package Linux AppImage/DEB and Windows NSIS installers, downloadable from the workflow artifacts.

### Ubuntu / Debian prerequisites

The following packages cover Tauri, XCap screen capture and X11 idle detection on Ubuntu 24.04:

```sh
sudo apt update
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev \
  libclang-dev libxcb1-dev libxrandr-dev libdbus-1-dev \
  libpipewire-0.3-dev libwayland-dev libegl-dev libxss-dev
```

**This capture adapter currently requires an X11 session on Linux.** It reports a clear error on Wayland. A persistent Wayland portal/PipeWire capture session is not implemented. On Windows, install the C++ Build Tools and WebView2 required by Tauri. On macOS, install Xcode Command Line Tools and grant Screen Recording access to the app. Native capture and permission behavior must be validated on your target PC.

## Where is the database?

The Rust backend creates **`trace.sqlite3`** on first desktop launch. Open **Preferences → Data on this device** to see its exact path.

| OS | Default database path |
| --- | --- |
| Linux | `~/.local/share/com.trace.app/trace.sqlite3` |
| Windows | `%APPDATA%\com.trace.app\trace.sqlite3` |
| macOS | `~/Library/Application Support/com.trace.app/trace.sqlite3` |

Linux uses `$XDG_DATA_HOME/com.trace.app/trace.sqlite3` when `XDG_DATA_HOME` is set. The app resolves the location using Tauri's `app_data_dir()`, with bundle identifier `com.trace.app`.

**The screenshots are inside the SQLite database**, as PNG BLOBs in the `captures` table. There is no separate screenshots folder. Export a screenshot from Captures to choose a PNG destination using the native Save dialog.

| Table / field | Contents |
| --- | --- |
| `captures.id` | Unique screenshot ID |
| `captures.png` | Actual PNG image bytes |
| `captures.captured_at` | Capture timestamp, UTC Unix epoch milliseconds |
| `captures.elapsed_ms` | Connected session time at capture, excluding pauses, in milliseconds |
| `captures.session_id`, `label` | Session association and label at capture |
| `captures.source_label`, `kind` | Selected source and `manual` or `automatic` |
| `captures.width`, `height` | Stored PNG dimensions |
| `workspace.json` | Session history, activity bins, timeline events and preferences |
| `workspace.updated_at` | Last workspace write, UTC epoch milliseconds |

The interface displays timestamps in your local timezone. You can inspect the SQLite file using DB Browser for SQLite. This query lists captures without loading the large image bytes:

```sql
SELECT id, label,
       datetime(captured_at / 1000.0, 'unixepoch', 'localtime') AS captured_local,
       elapsed_ms / 1000.0 AS elapsed_seconds,
       kind, source_label, width, height, length(png) AS png_bytes
FROM captures
ORDER BY captured_at DESC;
```

SQLite uses WAL mode, so `trace.sqlite3-wal` and `trace.sqlite3-shm` can exist beside the database. For backup, use SQLite's backup facility, or quit Trace before copying the database and any remaining sidecar files. Data is local and is not encrypted by this app. Nothing uploads screenshots. Captures remain until you delete them.

### Your previous Electron/browser data

The old version stores screenshot PNGs in **IndexedDB → `tempo-captures` → `captures`**, with fields `blob`, `createdAt` and `elapsedMs`. Sessions/settings use the localStorage key `trace.workspace.v2`.

**Existing Electron/browser records are not automatically imported into Tauri.** The profiles are separate; the migration does not delete or overwrite the old profile. Export any images you need from the old app. The optional browser preview continues using its existing browser storage. Its records do not sync to the desktop database.

## How tracking works

1. Name a session, click Start, and choose a screen or window. Native capture must return a real frame before session time starts.
2. Rust samples that source about every 2.5 seconds, records visual changes and separately observes device idle time where supported.
3. Screenshots are saved after randomized intervals, initially 60–180 seconds. Preferences accepts a 15–3600 second range with maximum greater than minimum. Capture now adds a screenshot without postponing the automatic deadline.
4. The circular HH:MM:SS stopwatch uses this same session. Pause stops capture and time. Resume asks for a source again. Finish saves the session to Timeline.
5. Browse, filter, export and delete images in Captures. The image dialog shows the capture timestamp and elapsed session time. Hiding the screen preview keeps tracking active.

The Rust worker owns time state, random deadlines, capture and SQLite writes. It continues when the interface is in the background. The renderer only requests actions and reads status. A screenshot and its timeline event are committed in one SQLite transaction.

Closing/reloading the window pauses tracking. Reopening recovers any interrupted session at its last saved heartbeat, excluding offline time. Detected screen locks, missing/minimized selected windows, capture/storage failures and sampling gaps longer than 15 seconds pause capture. Lock detection depends on OS facilities and is polled; short suspend intervals and unsupported lock signals need target-platform testing.

## What behavior is measured?

- **Tracked time:** connected session time, including observed idle time; pauses are excluded.
- **Screen changes:** pixel differences, not activity classification or a productivity score. Videos and animations can change pixels; reading can leave them steady.
- **Device activity:** the OS idle signal with a 60-second threshold, where available. Unknown signals are not counted as idle.
- **Trace interactions:** clicks, scroll bursts and foreground/background changes inside Trace only. There is no keylogger, global input recording, active-app attribution, OCR or AI analysis.
- **Context:** timestamped screenshots of your selected source, stored locally.

## Development and validation

```sh
npm run typecheck
npm run test:tracking
npm run test:rust
npm run build
npm run desktop
```

The five Rust core tests cover SQLite PNG/timestamp persistence across reopen, deletion, atomic rollback, pause/resume/recovery, random ranges and separation of pixel changes from device input. The JavaScript tests cover the browser model and legacy browser history. `tests/tests.json` contains five interface workflows; `tests/NATIVE-ACCEPTANCE.md` covers native OS checks.

The source archive reports passing TypeScript checks, the Vite build, JavaScript tracking tests and all five Rust core tests. Native compilation is checked by the GitHub workflow; consult its latest run for results. Real OS capture, permission dialogs, lock/sleep behavior and installer behavior still require the target-PC checks in `tests/NATIVE-ACCEPTANCE.md`.

The optional [interface preview](https://tempo-9k62n8.v2.appdeploy.ai/) runs the browser adapter. Google Fonts supplies Manrope and DM Sans, with system-font fallbacks offline.
