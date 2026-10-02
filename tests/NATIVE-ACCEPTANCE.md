# Native acceptance checks

Run these in the actual Tauri desktop window, on a supported target OS, with a real screen or window. Browser preview QA cannot validate them.

1. **Build and start:** `cargo check --manifest-path src-tauri/Cargo.toml`, then `npm run desktop`. Open a second instance; the existing window should focus. Preferences should show the absolute path to `trace.sqlite3`.
2. **Permission and source boundaries:** cancel/deny screen permission and confirm no session time or screenshot is created. Retry, select one real screen/window, and check the image is that source. Minimize/close a selected window; tracking should pause with feedback. On Wayland, verify the explicit unsupported-session message.
3. **Time and lifecycle:** run for a few seconds, pause, wait, resume by selecting a source, then finish. Paused time must not increase. Reload or close/reopen and confirm the session is recovered paused. Verify the circular stopwatch and sidebar agree. Move Trace to the background and confirm backend capture continues.
4. **Random and manual capture:** set 15–25 seconds. Check several automatic intervals, a manual capture, and that manual capture does not postpone the automatic deadline. Hide preview and confirm capture continues. Pause and confirm no new image arrives. Test real idle, screen lock, suspend and resume separately; observe the documented platform limits.
5. **SQLite and gallery:** inspect a real capture's PNG, timestamp, elapsed time and dimensions in the gallery. Export via native Save dialog and open the saved PNG. Quit/reopen and verify persistence. Cancel a deletion, then confirm it, restart and verify removal. Delete a completed session and confirm its screenshots remain. With the app stopped, inspect `captures` in SQLite and match the timestamp/elapsed metadata to the image.

If a check cannot run because of missing permissions, packages or display access, record it as unavailable, not passed. No synthetic screen frames count as real OS capture validation.
