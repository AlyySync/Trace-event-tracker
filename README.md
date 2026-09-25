# Trace

A personal desktop screen tracker with a dark graphite interface, mint accents, a Tempo-style circular stopwatch, animated screen scanning, live activity signals, and a visual work timeline.

## Run on your PC

Install Node.js 22 or newer, extract this project, and run these commands from its root:

```sh
npm ci
npm ci --prefix desktop
npm run desktop
```

This builds the interface and opens an Electron desktop window on Linux or Windows. No web server, account, API key, or backend is required. Allow screen-recording access when your operating system asks.

## Build Linux and Windows apps

After installing the dependencies above, run `npm run package:linux` on Linux or `npm run package:windows` on Windows. Outputs go into `release/`:

- Linux x64: an AppImage and a tar.gz archive. Make the AppImage executable and open it. If your distribution lacks AppImage/FUSE support, extract the archive and run `trace` inside it.
- Windows x64: an unsigned `.exe` installer with a choice of installation folder and a desktop shortcut.

The packaged apps include Electron and do not require Node.js on the destination laptop. Builds are unsigned; Windows may show an unknown-publisher warning. Linux screen capture depends on the desktop session and its PipeWire/portal support. Real capture, sleep, and lock behavior must be verified on each target system.

To install the Linux build for your user account, run `bash desktop/install-linux.sh` after packaging. This copies the app to `~/.local/share/trace` and adds **Trace** to your applications menu. Its launcher uses X11/XWayland and GTK 3 for compatibility with this laptop's display environment, while retaining Electron's renderer sandbox.

The GitHub Actions workflow in `.github/workflows/desktop.yml` builds both platforms on their native runners when manually triggered or when a `v*` tag is pushed. Download its build artifacts after it finishes. Windows packaging from Linux may need Wine; the native Windows workflow avoids that requirement.

## Tracking

1. Name your work session and select **Start tracking**.
2. Choose the screen or window you want Trace to see. Tracking starts only after a live screen feed connects.
   The Overview stopwatch shows this session as hours, minutes, and seconds. Its Start, Pause, Resume, and Finish controls use the same screen-tracking session, so breaks are excluded and screenshots pause with the timer.
3. Screenshots save at newly randomized intervals, initially **1–3 minutes**. Preferences offers presets and a custom range from 15 to 3600 seconds, with the maximum greater than the minimum. **Capture now** takes an extra screenshot without resetting the random schedule.
4. Inspect live screen changes, observed device idle time, session events, and captures. Hide the live preview for less distraction; capture continues while tracking is active.
5. **Pause tracking** disconnects the screen and stops capture and elapsed time. Resume asks you to choose a source again. **Finish session** saves the session in Timeline.
6. Open Captures to filter random/manual screenshots, inspect them, download PNGs, or delete with confirmation.

Ambient and Focused motion styles change the animation. Reduced mode and the operating system's reduced-motion preference disable motion.

## What the signals mean

- **Tracked time:** elapsed connected session time, including observed idle time; pauses are excluded.
- **Screen changes:** visual differences between small sampled screen frames, about every 2.5 seconds. Animation and video can produce changes. A steady screen can mean reading. This is not a productivity score or semantic classification of what you are doing.
- **Device activity:** Electron's operating-system idle signal, with a 60-second idle threshold where supported. It is separate from screen changes. Unsupported signals are shown as unavailable, never guessed.
- **Trace interactions:** pointer clicks and scroll bursts inside this app only. Trace does not log typed text or global keyboard/mouse events and does not identify the active application in other windows.
- **Context:** timestamped screenshots of the selected source and an event timeline. No OCR or AI analysis runs on your screen.

Sleep and screen-lock events pause tracking in the desktop integration. Reopening or reloading recovers the last session paused at its last saved heartbeat, with no new offline elapsed time. An interrupted sampling loop also pauses the session. Native event support and permissions vary by OS and must be checked on your target PC.

## Local data

Sessions and settings use localStorage; PNG screenshots use IndexedDB within Electron's local profile. There is no screenshot upload endpoint. Clearing app data removes local history; download screenshots you want to keep. The preview and the installed desktop app have separate profiles and do not sync.

Existing Tempo history and screenshots in the same browser profile are retained when opening the updated interface. Imported records contain time only, because the previous timer did not measure screen activity.

## Development and verification

```sh
npm run dev
npx tsc --noEmit
npm run test:tracking
npm run build
```

The tracking tests cover time accounting, recovery, random interval bounds, visual signals, legacy migration, and desktop authorization using a mocked Electron harness. They do not test actual OS permission prompts, real screen feeds, or lock/sleep delivery on a PC. `tests/tests.json` contains interface acceptance scenarios.

Stack: React 19, TypeScript, Vite, Electron, and lucide-react. Google Fonts supplies Manrope and DM Sans; offline use falls back to system fonts. The optional browser interface preview is https://tempo-9k62n8.v2.appdeploy.ai/ and has browser-limited capture permissions and background timing. Use the desktop entry point for PC tracking.
