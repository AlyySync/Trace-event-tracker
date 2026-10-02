import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  Focus,
  History,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Monitor,
  MousePointer2,
  Pause,
  Play,
  ScanLine,
  Settings2,
  ShieldCheck,
  Shuffle,
  Signal,
  SlidersHorizontal,
  Square,
  Trash2,
  Waves,
  X,
} from "lucide-react";
import { useTracker } from "./useTracker";
import SessionTimer from './SessionTimer';
import { durationLabel, elapsed, trackedToday } from "./tracking";
import type { ActivityBin, Motion, WorkSession } from "./tracking";
import type { Capture } from "./storage";
import { desktop, isDesktop } from "./desktop";
import type { DesktopSource, StorageInfo } from "./desktop";

type Page = "overview" | "timeline" | "captures";
const time = (at: number) =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const date = (at: number) =>
  new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
const range = (min: number, max: number) =>
  min % 60 === 0 && max % 60 === 0
    ? `${min / 60}–${max / 60} min`
    : `${min}–${max} sec`;

function Dialog({
  open,
  close,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  close: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="dialog-title">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function LiveVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      aria-label="Live preview of the selected screen"
    />
  );
}

function SignalChart({
  bins,
  now,
  active,
}: {
  bins: ActivityBin[];
  now: number;
  active: boolean;
}) {
  const [selected, setSelected] = useState<ActivityBin | null>(null);
  const display = bins.slice(-48);
  const slots: (ActivityBin | null)[] = [
    ...Array(Math.max(0, 48 - display.length)).fill(null),
    ...display,
  ];
  return (
    <div className="signal-chart">
      <div className="chart-grid">
        <span />
        <span />
        <span />
      </div>
      <div
        className="chart-bars"
        role="group"
        aria-label="Screen change history"
      >
        {slots.map((bin, index) => (
          <button
            key={bin?.at ?? `empty-${index}`}
            disabled={!bin}
            className={`${bin ? "measured" : ""} ${selected?.at === bin?.at && bin ? "selected" : ""}`}
            style={
              {
                "--height": `${bin ? Math.max(7, (bin.changing / Math.max(1, bin.observed)) * 100) : 3}%`,
                "--delay": `${index * 10}ms`,
              } as CSSProperties
            }
            onClick={() => setSelected(bin)}
            onMouseEnter={() => setSelected(bin)}
            onFocus={() => setSelected(bin)}
            aria-label={
              bin
                ? `${time(bin.at)}: ${Math.round((bin.changing / Math.max(1, bin.observed)) * 100)} percent of sampled time with screen changes`
                : "No sample"
            }
            title={
              bin
                ? `${time(bin.at)} · ${Math.round(bin.peak)}% peak frame difference`
                : undefined
            }
          >
            <i />
          </button>
        ))}
      </div>
      {!bins.length && (
        <div className="chart-empty">
          <Signal size={16} />
          {active
            ? "Listening for screen changes…"
            : "Your activity signal will appear here"}
        </div>
      )}
      <div className="chart-labels">
        <span>
          {display.length ? time(display[0].at).slice(0, 5) : "Session start"}
        </span>
        <span>
          {selected
            ? `${time(selected.at)} · ${Math.round((selected.changing / Math.max(1, selected.observed)) * 100)}% changing`
            : "Click a bar to inspect"}
        </span>
        <span>
          {active
            ? "Now"
            : display.length
              ? time(display[display.length - 1].at).slice(0, 5)
              : time(now).slice(0, 5)}
        </span>
      </div>
    </div>
  );
}

export default function TraceApp() {
  const tracker = useTracker();
  const { state, now, captures, stream, connected, previewFrame, device } = tracker;
  const [page, setPage] = useState<Page>("overview");
  const [label, setLabel] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState('');
  const [draft, setDraft] = useState(state.settings);
  const [settingsError, setSettingsError] = useState("");
  const [sources, setSources] = useState<DesktopSource[] | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [largePreview, setLargePreview] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [captureFilter, setCaptureFilter] = useState<
    "all" | "automatic" | "manual"
  >("all");
  const [confirmation, setConfirmation] = useState<{
    title: string;
    text: string;
    action: () => void | Promise<void>;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const current = state.current;
  const running = connected && current?.runningSince != null;
  const native = isDesktop;
  const allSessions = [...(current ? [current] : []), ...state.history];
  const inspected =
    allSessions.find((item) => item.id === selectedSession) ??
    current ??
    state.history[0] ??
    null;
  const focusSession =
    page === "timeline" ? inspected : (current ?? state.history[0] ?? null);
  const bins = focusSession?.bins ?? [];
  const today = new Date(now).setHours(0, 0, 0, 0);
  const todayCaptures = captures.filter(
    (capture) => capture.createdAt >= today,
  );
  const todayBins = allSessions
    .flatMap((session) => session.bins)
    .filter((bin) => bin.at >= today);
  const observed = todayBins.reduce((sum, bin) => sum + bin.observed, 0);
  const changing = todayBins.reduce((sum, bin) => sum + bin.changing, 0);
  const idle = todayBins.reduce((sum, bin) => sum + bin.idle, 0);
  const knownDevice = todayBins.reduce(
    (sum, bin) => sum + bin.idle + bin.active,
    0,
  );
  const tracked = trackedToday(state, now);
  const urls = useMemo(
    () =>
      new Map(
        captures.map((capture) => [
          capture.id,
          URL.createObjectURL(capture.blob),
        ]),
      ),
    [captures],
  );
  const preview = captures.find((capture) => capture.id === previewId);
  const shownCaptures = captures.filter(
    (capture) => captureFilter === "all" || capture.kind === captureFilter,
  );
  const recentEvents = focusSession?.events.slice(-5).reverse() ?? [];

  useEffect(
    () => () => urls.forEach((url) => URL.revokeObjectURL(url)),
    [urls],
  );
  useEffect(() => {
    document.title = running
      ? `Trace · ${durationLabel(elapsed(current, now), true)}`
      : "Trace — Screen activity";
  }, [running, current, now]);
  const showSettings = () => {
    setDraft(state.settings);
    setSettingsError("");
    setSettingsOpen(true);
    if (native) {
      setStorageError('');
      void desktop.storageInfo().then(setStorageInfo).catch(failure => setStorageError(String(failure)));
    }
  };
  const startTracking = async () => {
    if (native) {
      if (running) await tracker.pause("Changing screen source");
      setSourceLoading(true);
      tracker.setError("");
      try {
        const available = await desktop.listSources();
        if (!available.length) throw new Error("No sources");
        setSources(available);
      } catch (failure) {
        tracker.setError(`Could not list screens: ${String(failure)}. Check screen-recording permission and try again.`);
      } finally {
        setSourceLoading(false);
      }
    } else {
      if (running) await tracker.pause("Changing screen source");
      await tracker.start(label);
    }
  };
  const download = async (capture: Capture) => {
    if (native) {
      try {
        if (await desktop.exportCapture(capture.id)) tracker.setNotice('PNG saved to the location you selected.');
      } catch (failure) { tracker.setError(`Could not export screenshot: ${String(failure)}`); }
      return;
    }
    const url = urls.get(capture.id);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `Trace-${new Date(capture.createdAt).toISOString().replace(/[:.]/g, "-")}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    tracker.setNotice("Screenshot download started.");
  };
  const deleteShot = (capture: Capture) =>
    setConfirmation({
      title: "Delete screenshot?",
      text: "This removes the image from this device. Your session time stays unchanged.",
      action: async () => {
        await tracker.removeCapture(capture.id);
        setPreviewId(null);
      },
    });
  const deleteSession = (session: WorkSession) =>
    setConfirmation({
      title: "Delete session?",
      text: `Remove “${session.label}” and its activity history? Saved screenshots will remain in Captures.`,
      action: () => tracker.removeSession(session),
    });
  const saveSettings = () => {
    if (
      ![draft.captureMin, draft.captureMax].every(Number.isInteger) ||
      draft.captureMin < 15 ||
      draft.captureMax > 3600 ||
      draft.captureMax <= draft.captureMin
    ) {
      setSettingsError(
        "Use whole seconds between 15 and 3600. The maximum must be greater than the minimum.",
      );
      return;
    }
    tracker.updateSettings(draft);
    setSettingsOpen(false);
  };

  const captureTile = (capture: Capture, compact = false) => (
    <article
      className={`capture-tile ${compact ? "compact" : ""}`}
      key={capture.id}
    >
      <button
        className="capture-image"
        onClick={() => setPreviewId(capture.id)}
        aria-label={`Open screenshot from ${time(capture.createdAt)}`}
      >
        <img
          src={urls.get(capture.id)}
          alt={`Captured screen for ${capture.label}`}
          loading="lazy"
        />
        <span className="capture-kind">
          {capture.kind === "automatic" ? (
            <Shuffle size={11} />
          ) : (
            <Camera size={11} />
          )}
          {capture.kind === "automatic" ? "Random" : "Manual"}
        </span>
        <span className="image-open">
          <Maximize2 size={19} />
        </span>
      </button>
      <div className="capture-info">
        <div>
          <strong>{compact ? time(capture.createdAt) : capture.label}</strong>
          <span>
            {compact
              ? capture.sourceLabel || "Screen capture"
              : `${date(capture.createdAt)} · ${time(capture.createdAt)}`}
          </span>
        </div>
        <button
          className="icon-button"
          onClick={() => download(capture)}
          aria-label={`Download screenshot ${time(capture.createdAt)}`}
        >
          <ArrowDownToLine size={16} />
        </button>
        {!compact && (
          <button
            className="icon-button danger-hover"
            onClick={() => deleteShot(capture)}
            aria-label={`Delete screenshot ${time(capture.createdAt)}`}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </article>
  );

  return (
    <div className={`trace-app motion-${state.settings.motion}`}>
      <aside className="sidebar">
        <button
          className="brand"
          aria-label="Trace overview"
          onClick={() => setPage("overview")}
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
            <i />
            <b />
          </span>
          trace
        </button>
        <div className="workspace-label">
          <span className="workspace-avatar">P</span>
          <div>
            <strong>Personal workspace</strong>
            <small>On this device</small>
          </div>
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {(
            [
              { id: "overview", title: "Overview", icon: LayoutDashboard },
              { id: "timeline", title: "Timeline", icon: History },
              { id: "captures", title: "Captures", icon: Camera },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "selected" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => setPage(item.id)}
            >
              <item.icon size={18} />
              <span>{item.title}</span>
              {item.id === "captures" && captures.length > 0 && (
                <b>{captures.length}</b>
              )}
              {item.id === "overview" && running && <i className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-session">
          <div className="micro-label">CURRENT SESSION</div>
          <div className={`session-indicator ${running ? "on" : ""}`}>
            <span />
            {running
              ? "Tracking in progress"
              : current
                ? "Session paused"
                : "Ready to connect"}
          </div>
          <span className="sidebar-time">
            {durationLabel(elapsed(current, now), true)}
          </span>
          {current && <p title={current.label}>{current.label}</p>}
        </div>
        <div className="sidebar-bottom">
          <button onClick={showSettings} className="nav-item">
            <Settings2 size={18} />
            <span>Preferences</span>
          </button>
          <div className="private-badge">
            <ShieldCheck size={17} />
            <span>
              Private by default<small>Saved locally. Always yours.</small>
            </span>
          </div>
          <div className="desktop-label">
            <Monitor size={12} />
            {native ? "DESKTOP APP" : "DESKTOP PREVIEW"}
            <span>v2.0</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>
              {page === "overview"
                ? "Overview"
                : page === "timeline"
                  ? "Timeline"
                  : "Captures"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-chip">
              <LockKeyhole size={12} />
              Local only
            </span>
            <button
              className="icon-button"
              aria-label="Open preferences"
              onClick={showSettings}
            >
              <SlidersHorizontal size={17} />
            </button>
            <span className="avatar">P</span>
          </div>
        </header>
        <div className="page-heading">
          <div>
            <div className="date-label">
              {new Date(now).toLocaleDateString("en", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              <span className="heading-divider">/</span>Your workspace
            </div>
            <h1>
              {page === "overview"
                ? "Your work, in view."
                : page === "timeline"
                  ? "Every moment, connected."
                  : "A picture of your work."}
            </h1>
          </div>
          <div className="tracking-actions">
            {current && (
              <button
                className="stop-button"
                onClick={tracker.finish}
                disabled={tracker.readOnly || tracker.busy}
              >
                <Square size={13} fill="currentColor" />
                Finish session
              </button>
            )}
            <button
              className={`primary-button ${running ? "recording" : ""}`}
              onClick={() => (running ? tracker.pause() : void startTracking())}
              disabled={
                !tracker.ready ||
                tracker.readOnly ||
                tracker.busy ||
                sourceLoading
              }
            >
              {tracker.busy || sourceLoading ? (
                <LoaderCircle className="spin" size={17} />
              ) : running ? (
                <Pause size={17} />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              {tracker.busy || sourceLoading
                ? "Connecting…"
                : running
                  ? "Pause tracking"
                  : current
                    ? "Resume tracking"
                    : "Start tracking"}
            </button>
          </div>
        </div>
        {tracker.readOnly && (
          <div className="info-banner">
            <Monitor size={17} />
            Another Trace window owns tracking. Close it and reopen this one to
            take over.
          </div>
        )}
        {tracker.error && (
          <div className="error-banner" role="alert">
            <span>{tracker.error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => tracker.setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}

        {page === "overview" && (
          <>
            <section className="metrics" aria-label="Today’s activity">
              <div className="metric">
                <div className="metric-label">
                  <Clock3 size={15} />
                  Tracked today
                </div>
                <div className="metric-value">
                  {Math.floor(tracked / 3600000)}
                  <small>h</small>{" "}
                  {String(Math.floor(tracked / 60000) % 60).padStart(2, "0")}
                  <small>m</small>
                </div>
                <span className="metric-note">
                  {running ? (
                    <>
                      <i className="live-dot" />
                      Tracking now
                    </>
                  ) : (
                    "Across your work sessions"
                  )}
                </span>
              </div>
              <div className="metric">
                <div className="metric-label">
                  <Activity size={15} />
                  Screen changes
                </div>
                <div className="metric-value">
                  {observed ? Math.round((changing / observed) * 100) : "—"}
                  {observed > 0 && <small>%</small>}
                </div>
                <span className="metric-note">
                  Share of sampled screen time
                </span>
              </div>
              <div className="metric">
                <div className="metric-label">
                  <Camera size={15} />
                  Screenshots
                </div>
                <div className="metric-value">
                  {String(todayCaptures.length).padStart(2, "0")}
                </div>
                <span className="metric-note">
                  <Shuffle size={12} />
                  Random, every{" "}
                  {range(state.settings.captureMin, state.settings.captureMax)}
                </span>
              </div>
              <div className="metric">
                <div className="metric-label">
                  <MousePointer2 size={15} />
                  Observed idle
                </div>
                <div className="metric-value small-value">
                  {knownDevice ? durationLabel(idle) : "—"}
                </div>
                <span className="metric-note">
                  {native
                    ? "From device activity signals"
                    : "Available in the desktop app"}
                </span>
              </div>
            </section>
            <SessionTimer
              elapsedMs={elapsed(current, now)}
              running={running}
              hasSession={!!current}
              label={current?.label ?? label}
              disabled={
                !tracker.ready || tracker.readOnly || tracker.busy || sourceLoading
              }
              connecting={tracker.busy || sourceLoading}
              onToggle={() => (running ? tracker.pause() : void startTracking())}
              onFinish={tracker.finish}
            />
            <div className="overview-grid">
              <section className="panel feed-panel">
                <div className="panel-heading">
                  <div className="panel-title">
                    <span
                      className={`source-status ${running ? "connected" : ""}`}
                    />
                    <h2>Screen overview</h2>
                    <span className="tag">
                      {running ? "LIVE" : current ? "PAUSED" : "STANDBY"}
                    </span>
                  </div>
                  <div className="panel-actions">
                    <button
                      className="icon-button"
                      disabled={!connected}
                      aria-label={
                        state.settings.hidePreview
                          ? "Show live preview"
                          : "Hide live preview"
                      }
                      onClick={() =>
                        tracker.commit((value) => ({
                          ...value,
                          settings: {
                            ...value.settings,
                            hidePreview: !value.settings.hidePreview,
                          },
                        }))
                      }
                    >
                      {state.settings.hidePreview ? (
                        <EyeOff size={16} />
                      ) : (
                        <Eye size={16} />
                      )}
                    </button>
                    <button
                      className="icon-button"
                      disabled={!connected || state.settings.hidePreview}
                      aria-label="Expand screen preview"
                      onClick={() => setLargePreview(true)}
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                </div>
                <div
                  className={`screen-stage ${running ? "is-live" : ""} ${tracker.capturing ? "capturing" : ""}`}
                  onPointerMove={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    event.currentTarget.style.setProperty(
                      "--pointer-x",
                      `${((event.clientX - bounds.left) / bounds.width) * 100}%`,
                    );
                    event.currentTarget.style.setProperty(
                      "--pointer-y",
                      `${((event.clientY - bounds.top) / bounds.height) * 100}%`,
                    );
                  }}
                >
                  {connected && !state.settings.hidePreview ? (
                    native ? (previewFrame ? <img className="native-screen-frame" src={previewFrame} alt="Selected screen, refreshed every few seconds" /> : <div className="preview-loading">Waiting for the next frame…</div>) : stream ? <LiveVideo stream={stream} /> : null
                  ) : (
                    <div className="screen-empty">
                      <div className="scan-grid" />
                      <div className="scan-beam" />
                      <span className="focus-corner top-left" />
                      <span className="focus-corner top-right" />
                      <span className="focus-corner bottom-left" />
                      <span className="focus-corner bottom-right" />
                      <div className="capture-orbit">
                        <i />
                        <i />
                        <span>
                          {connected ? (
                            <EyeOff size={29} strokeWidth={1.3} />
                          ) : (
                            <ScanLine size={32} strokeWidth={1.3} />
                          )}
                        </span>
                      </div>
                      <h3>
                        {connected
                          ? "Preview hidden"
                          : current
                            ? "Ready when you are."
                            : "Bring your work into focus."}
                      </h3>
                      <p>
                        {connected
                          ? "Tracking and random screenshots are still running."
                          : "Start tracking and choose a screen or window."}
                      </p>
                      <div className="empty-features">
                        <span>
                          <Monitor size={12} />
                          Live screen
                        </span>
                        <i />
                        <span>
                          <Shuffle size={12} />
                          Random captures
                        </span>
                        <i />
                        <span>
                          <Activity size={12} />
                          Activity timeline
                        </span>
                      </div>
                    </div>
                  )}
                  {running && (
                    <div className="live-overlay">
                      <span>
                        <i className="live-dot" />
                        {state.settings.hidePreview
                          ? "PREVIEW HIDDEN"
                          : "LIVE VIEW"}
                      </span>
                      <span>
                        {tracker.capturing
                          ? "Saving screenshot"
                          : current?.sourceType === "window"
                            ? "WINDOW"
                            : "SCREEN"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="feed-controls">
                  <div className="source-description">
                    <span className="source-icon">
                      <Monitor size={18} />
                    </span>
                    <div>
                      <strong>
                        {current?.source || "No screen connected"}
                      </strong>
                      <span>
                        {running
                          ? "Capture permission is active"
                          : "Your screen stays private until you start"}
                      </span>
                    </div>
                  </div>
                  <button
                    className="subtle-button"
                    onClick={() => void startTracking()}
                    disabled={
                      !tracker.ready ||
                      tracker.readOnly ||
                      tracker.busy ||
                      sourceLoading
                    }
                  >
                    {running ? "Change source" : "Connect"}
                    <ChevronRight size={14} />
                  </button>
                </div>
                <div className="session-name-row">
                  <label htmlFor="session-name">Session</label>
                  <input
                    id="session-name"
                    placeholder="What are you working on?"
                    maxLength={100}
                    value={current?.label ?? label}
                    disabled={tracker.readOnly}
                    onChange={(event) =>
                      current
                        ? tracker.commit((value) =>
                            value.current
                              ? {
                                  ...value,
                                  current: {
                                    ...value.current,
                                    label: event.target.value,
                                  },
                                }
                              : value,
                          )
                        : setLabel(event.target.value)
                    }
                  />
                  <button
                    className="capture-now"
                    disabled={!running || tracker.capturing}
                    onClick={() => void tracker.snapshot()}
                  >
                    <Camera size={16} />
                    Capture now
                  </button>
                </div>
              </section>
              <aside className="insights-column">
                <section className="panel signals-panel">
                  <div className="panel-heading">
                    <div className="panel-title">
                      <h2>Live signals</h2>
                    </div>
                    <span className="signal-icon">
                      <Signal size={17} />
                    </span>
                  </div>
                  <div className="screen-signal">
                    <span>Screen difference</span>
                    <strong>
                      {tracker.change === null
                        ? "—"
                        : `${Math.round(tracker.change)}%`}
                      <small>
                        {running
                          ? tracker.change === null
                            ? "Collecting first samples"
                            : tracker.change >= state.settings.sensitivity
                              ? "Content is changing"
                              : "Content is steady"
                          : "Waiting for a screen"}
                      </small>
                    </strong>
                    <div className="signal-meter">
                      {Array.from({ length: 28 }, (_, index) => (
                        <i
                          key={index}
                          className={
                            tracker.change !== null &&
                            index < Math.ceil((tracker.change / 100) * 28)
                              ? "lit"
                              : ""
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <div className="device-row">
                    <span>
                      <MousePointer2 size={14} />
                      Device state
                    </span>
                    <b className={device === "active" ? "positive" : ""}>
                      {device === "unknown"
                        ? native
                          ? "Waiting"
                          : "Desktop only"
                        : device === "active"
                          ? "Active"
                          : "Idle"}
                    </b>
                  </div>
                  <p className="signal-explanation">
                    Screen movement and device activity are separate signals. A
                    video can move while you’re away.
                  </p>
                </section>
                <section className="random-card">
                  <span className="random-icon">
                    <Shuffle size={19} />
                  </span>
                  <div>
                    <h3>Random, by design.</h3>
                    <p>A new capture window every time.</p>
                  </div>
                  <button className="random-range" onClick={showSettings}>
                    <strong>
                      {range(
                        state.settings.captureMin,
                        state.settings.captureMax,
                      )}
                    </strong>
                    <SlidersHorizontal size={15} />
                  </button>
                  <div className="random-status">
                    <span className={running ? "active" : ""} />
                    {running
                      ? "Random captures are running"
                      : "Starts with your session"}
                  </div>
                </section>
                <section className="scope-note">
                  <ShieldCheck size={19} />
                  <div>
                    <strong>Your screen. Your control.</strong>
                    <p>Pause stops capture immediately. Nothing is uploaded.</p>
                  </div>
                </section>
              </aside>
            </div>
            <div className="lower-grid">
              <section className="panel rhythm-panel">
                <div className="panel-heading">
                  <div className="panel-title">
                    <h2>Work rhythm</h2>
                    <span className="tag">SCREEN CHANGES</span>
                  </div>
                  <span className="secondary-text">
                    {focusSession?.label || "This session"}
                  </span>
                </div>
                <SignalChart bins={bins} now={now} active={running} />
                <p className="chart-note">
                  Sampled visual changes. Steady content doesn’t mean you’re
                  idle.
                </p>
              </section>
              <section className="panel recent-events">
                <div className="panel-heading">
                  <h2>Recent activity</h2>
                  <button
                    className="text-button"
                    onClick={() => setPage("timeline")}
                  >
                    Timeline <ArrowUpRight size={14} />
                  </button>
                </div>
                {recentEvents.length ? (
                  <div className="mini-events">
                    {recentEvents.map((item) => (
                      <button
                        key={item.id}
                        className="mini-event"
                        disabled={!item.captureId || !urls.has(item.captureId)}
                        onClick={() =>
                          item.captureId && setPreviewId(item.captureId)
                        }
                      >
                        <span
                          className={
                            item.kind === "capture" ? "event-capture" : ""
                          }
                        >
                          {item.kind === "capture" ? (
                            <Camera size={13} />
                          ) : (
                            <Activity size={13} />
                          )}
                        </span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{time(item.at)}</small>
                        </div>
                        {item.captureId && urls.has(item.captureId) && (
                          <ChevronRight size={13} />
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mini-empty">
                    <History size={22} />
                    <p>
                      A timeline of your work will
                      <br />
                      take shape here.
                    </p>
                  </div>
                )}
              </section>
            </div>
            <section className="recent-captures">
              <div className="section-heading">
                <h2>
                  Latest captures <span>{captures.length}</span>
                </h2>
                <button
                  className="text-button"
                  onClick={() => setPage("captures")}
                >
                  View gallery <ArrowRight size={15} />
                </button>
              </div>
              {captures.length ? (
                <div className="capture-grid recent">
                  {captures
                    .slice(0, 3)
                    .map((capture) => captureTile(capture, true))}
                </div>
              ) : (
                <div className="captures-empty-line">
                  <span>
                    <Camera size={21} />
                  </span>
                  <div>
                    <strong>No screenshots yet</strong>
                    <p>
                      Your first random capture arrives after tracking starts.
                    </p>
                  </div>
                  <span className="empty-range">
                    <Shuffle size={13} />
                    {range(
                      state.settings.captureMin,
                      state.settings.captureMax,
                    )}
                  </span>
                </div>
              )}
            </section>
          </>
        )}

        {page === "timeline" && (
          <div className="timeline-layout">
            <section className="panel session-browser">
              <div className="panel-heading">
                <h2>Sessions</h2>
                <span className="count-badge">{allSessions.length}</span>
              </div>
              {allSessions.length ? (
                allSessions.map((session) => (
                  <button
                    className={`session-choice ${inspected?.id === session.id ? "chosen" : ""}`}
                    onClick={() => setSelectedSession(session.id)}
                    key={session.id}
                  >
                    <span className="session-choice-icon">
                      {session.runningSince !== null ? (
                        <Activity size={17} />
                      ) : (
                        <History size={17} />
                      )}
                    </span>
                    <div>
                      <strong>{session.label || "Work session"}</strong>
                      <small>
                        {date(session.createdAt)} ·{" "}
                        {durationLabel(elapsed(session, now))}
                      </small>
                    </div>
                    <ChevronRight size={14} />
                  </button>
                ))
              ) : (
                <div className="mini-empty">
                  <History size={25} />
                  <p>
                    Completed and current sessions
                    <br />
                    will appear here.
                  </p>
                </div>
              )}
            </section>
            <section className="panel timeline-detail">
              {inspected ? (
                <>
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">
                        {inspected.imported
                          ? "IMPORTED SESSION"
                          : inspected.endedAt
                            ? "COMPLETED SESSION"
                            : inspected.runningSince
                              ? "LIVE SESSION"
                              : "PAUSED SESSION"}
                      </p>
                      <h2 className="session-detail-title">
                        {inspected.label || "Work session"}
                      </h2>
                    </div>
                    {inspected.endedAt && (
                      <button
                        className="icon-button danger-hover"
                        aria-label="Delete selected session"
                        onClick={() => deleteSession(inspected)}
                      >
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                  <div className="session-summary">
                    <span>
                      <Clock3 size={15} />
                      {durationLabel(elapsed(inspected, now))}
                    </span>
                    <span>
                      <Camera size={15} />
                      {
                        captures.filter(
                          (capture) => capture.sessionId === inspected.id,
                        ).length
                      }{" "}
                      captures
                    </span>
                    <span>
                      <Monitor size={15} />
                      {inspected.sourceType === "imported"
                        ? "Time only"
                        : inspected.sourceType}
                    </span>
                  </div>
                  <SignalChart
                    bins={inspected.bins}
                    now={now}
                    active={inspected.runningSince !== null}
                  />
                  <div className="timeline-events">
                    {inspected.events
                      .slice()
                      .reverse()
                      .map((item) => (
                        <div
                          className={`timeline-event ${item.kind}`}
                          key={item.id}
                        >
                          <span className="event-time">{time(item.at)}</span>
                          <span className="event-node">
                            {item.kind === "capture" ? (
                              <Camera size={13} />
                            ) : item.kind === "pause" ? (
                              <Pause size={12} />
                            ) : (
                              <Activity size={13} />
                            )}
                          </span>
                          <div>
                            <strong>{item.title}</strong>
                            {item.detail && <p>{item.detail}</p>}
                            {item.captureId && urls.has(item.captureId) && (
                              <button
                                className="event-thumbnail"
                                onClick={() => setPreviewId(item.captureId!)}
                                aria-label={`View timeline screenshot ${time(item.at)}`}
                              >
                                <img
                                  src={urls.get(item.captureId)}
                                  alt="Captured work screen"
                                />
                                <span>
                                  View screenshot <Maximize2 size={13} />
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                  <div className="interaction-summary">
                    <MousePointer2 size={15} />
                    <span>
                      Inside Trace: <b>{inspected.clicks}</b> clicks ·{" "}
                      <b>{inspected.scrolls}</b> scroll bursts ·{" "}
                      <b>{inspected.switches}</b> background transitions
                    </span>
                  </div>
                  <p className="detail-note">
                    These interaction counts apply only to Trace. Other apps and
                    typed content are not read.
                  </p>
                </>
              ) : (
                <div className="large-empty">
                  <span>
                    <History size={32} />
                  </span>
                  <h2>Your work has a story.</h2>
                  <p>
                    Start tracking to connect screen activity and screenshots in
                    one timeline.
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => setPage("overview")}
                  >
                    Go to overview <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {page === "captures" && (
          <section className="gallery-page">
            <div className="gallery-toolbar">
              <div className="segmented" aria-label="Filter captures">
                {(["all", "automatic", "manual"] as const).map((filter) => (
                  <button
                    key={filter}
                    aria-pressed={captureFilter === filter}
                    onClick={() => setCaptureFilter(filter)}
                  >
                    {filter === "all"
                      ? "All captures"
                      : filter === "automatic"
                        ? "Random"
                        : "Manual"}
                  </button>
                ))}
              </div>
              <button
                className="secondary-button"
                disabled={!running || tracker.capturing}
                onClick={() => void tracker.snapshot()}
              >
                <Camera size={16} />
                Capture now
              </button>
            </div>
            {shownCaptures.length ? (
              <div className="capture-grid">
                {shownCaptures.map((capture) => captureTile(capture))}
              </div>
            ) : (
              <div className="panel large-empty">
                <span>
                  <Camera size={34} strokeWidth={1.3} />
                </span>
                <h2>
                  {captureFilter === "all"
                    ? "Small moments. The whole picture."
                    : `No ${captureFilter === "automatic" ? "random" : "manual"} captures yet.`}
                </h2>
                <p>
                  {captureFilter === "all"
                    ? "Random screenshots from your work sessions appear here. Open any capture to inspect or download it."
                    : "Switch to All captures or start a session to create new ones."}
                </p>
                <button
                  className="secondary-button"
                  onClick={() =>
                    captureFilter !== "all"
                      ? setCaptureFilter("all")
                      : setPage("overview")
                  }
                >
                  {captureFilter !== "all"
                    ? "Show all captures"
                    : "Go to overview"}
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
            <p className="gallery-note">
              <LockKeyhole size={13} />
              Stored on this device. Download anything you want to keep before
              clearing app data.
            </p>
          </section>
        )}
        <footer>
          <span>
            <ShieldCheck size={13} />
            Your work stays with you.
          </span>
          <span>
            TRACE <i />
            SCREEN ACTIVITY
          </span>
        </footer>
      </main>

      {tracker.notice && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{tracker.notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => tracker.setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <Dialog
        open={settingsOpen}
        close={() => setSettingsOpen(false)}
        title="Make it work your way"
      >
        <div className="settings-section">
          <div className="settings-label">
            <Shuffle size={18} />
            <div>
              <h3>Random screenshots</h3>
              <p>A fresh random interval after every automatic capture.</p>
            </div>
          </div>
          <div className="preset-options">
            {[
              [30, 90],
              [60, 180],
              [180, 420],
            ].map(([min, max]) => (
              <button
                key={min}
                aria-pressed={
                  draft.captureMin === min && draft.captureMax === max
                }
                onClick={() =>
                  setDraft((value) => ({
                    ...value,
                    captureMin: min,
                    captureMax: max,
                  }))
                }
              >
                {range(min, max)}
              </button>
            ))}
          </div>
          <div className="range-inputs">
            <label>
              Minimum interval
              <input
                type="number"
                min="15"
                max="3600"
                step="1"
                aria-label="Minimum screenshot interval in seconds"
                value={draft.captureMin || ""}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    captureMin: Number(event.target.value),
                  }))
                }
              />
              <span>seconds</span>
            </label>
            <span className="range-arrow">→</span>
            <label>
              Maximum interval
              <input
                type="number"
                min="15"
                max="3600"
                step="1"
                aria-label="Maximum screenshot interval in seconds"
                value={draft.captureMax || ""}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    captureMax: Number(event.target.value),
                  }))
                }
              />
              <span>seconds</span>
            </label>
          </div>
          {settingsError && (
            <p className="settings-error" role="alert">
              {settingsError}
            </p>
          )}
        </div>
        <div className="settings-section">
          <div className="settings-label">
            <Waves size={18} />
            <div>
              <h3>Motion style</h3>
              <p>A little atmosphere, or just the essentials.</p>
            </div>
          </div>
          <div className="motion-options">
            {(
              [
                {
                  id: "ambient",
                  icon: Waves,
                  title: "Ambient",
                  text: "Fluid & expressive",
                },
                {
                  id: "focused",
                  icon: Focus,
                  title: "Focused",
                  text: "Quiet & precise",
                },
                {
                  id: "reduced",
                  icon: Pause,
                  title: "Reduced",
                  text: "No motion",
                },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                aria-pressed={draft.motion === item.id}
                onClick={() =>
                  setDraft((value) => ({ ...value, motion: item.id as Motion }))
                }
              >
                <item.icon size={19} />
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="settings-section sensitivity-section">
          <div>
            <h3>Screen change sensitivity</h3>
            <p>Screen pixels only. Never a productivity score.</p>
          </div>
          <select
            aria-label="Screen change sensitivity"
            value={draft.sensitivity}
            onChange={(event) =>
              setDraft((value) => ({
                ...value,
                sensitivity: Number(event.target.value),
              }))
            }
          >
            <option value="1">High</option>
            <option value="3">Balanced</option>
            <option value="8">Low</option>
          </select>
        </div>
        <div className="settings-section storage-section">
          <div className="settings-label">
            <ShieldCheck size={18} />
            <div><h3>Data on this device</h3><p>{native ? 'Screenshots, timestamps and sessions are stored in SQLite.' : 'This preview stores data in this browser.'}</p></div>
          </div>
          {native ? <>
            <span className="storage-caption">DATABASE LOCATION</span>
            <code className="storage-path">{storageInfo?.databasePath || storageError || 'Reading database location…'}</code>
            <p className="storage-details">PNG images: <code>captures.png</code><br />Capture time: <code>captured_at</code> · elapsed time: <code>elapsed_ms</code><br />Times are saved in milliseconds. Capture timestamps use UTC.</p>
          </> : <>
            <code className="storage-path">IndexedDB → tempo-captures → captures</code>
            <p className="storage-details">Each record includes the PNG, capture time and session elapsed time. The Tauri desktop app uses a separate local SQLite database.</p>
          </>}
        </div>
        <div className="settings-scope">
          <LockKeyhole size={16} />
          <p>
            Captures happen only during active tracking. Pause or finish stops capture.
            Detected screen locks and interrupted capture feeds pause tracking too.
          </p>
        </div>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={() => setSettingsOpen(false)}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={tracker.readOnly}
            onClick={saveSettings}
          >
            Save preferences <Check size={15} />
          </button>
        </div>
      </Dialog>
      <Dialog
        open={sources !== null}
        close={() => setSources(null)}
        title="Choose what Trace can see"
        wide
      >
        <p className="source-picker-note">
          Only the screen or window you select is tracked. Avoid selecting Trace
          itself for a cleaner activity signal.
        </p>
        <div className="source-grid">
          {sources?.map((source) => (
            <button
              key={source.id}
              onClick={() => {
                setSources(null);
                void tracker.start(label, source);
              }}
            >
              {source.thumbnail ? <img src={source.thumbnail} alt={`Preview of ${source.name}`} /> : <span className="source-placeholder"><Monitor size={32} /><span>{source.type === 'screen' ? 'Screen' : 'Window'}</span></span>}
              <span>
                <Monitor size={16} />
                <strong>{source.name}</strong>
                <small>{source.type}</small>
              </span>
            </button>
          ))}
        </div>
      </Dialog>
      <Dialog
        open={!!preview}
        close={() => setPreviewId(null)}
        title={preview?.label || "Screenshot"}
        wide
      >
        {preview && (
          <>
            <img
              className="full-capture"
              src={urls.get(preview.id)}
              alt={`Screenshot of ${preview.label}`}
            />
            <div className="preview-bottom">
              <div>
                <strong>
                  {preview.kind === "automatic"
                    ? "Random capture"
                    : "Manual capture"}
                </strong>
                <span>
                  {date(preview.createdAt)} · {time(preview.createdAt)} ·{" "}
                  {preview.width} × {preview.height} · {durationLabel(preview.elapsedMs, true)} into session
                </span>
              </div>
              <button
                className="secondary-button"
                onClick={() => download(preview)}
              >
                <ArrowDownToLine size={16} />
                Download PNG
              </button>
              <button
                className="icon-button danger-hover"
                onClick={() => deleteShot(preview)}
                aria-label="Delete opened screenshot"
              >
                <Trash2 size={17} />
              </button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog
        open={largePreview && connected}
        close={() => setLargePreview(false)}
        title="Live screen preview"
        wide
      >
        {connected && (
          <div className="expanded-preview">
            {native && previewFrame ? <img className="native-screen-frame" src={previewFrame} alt="Selected screen preview" /> : stream ? <LiveVideo stream={stream} /> : null}
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!confirmation}
        close={() => !deleting && setConfirmation(null)}
        title={confirmation?.title || "Confirm"}
      >
        <p className="confirm-copy">{confirmation?.text}</p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={deleting}
            onClick={() => setConfirmation(null)}
          >
            Cancel
          </button>
          <button
            className="danger-button"
            disabled={deleting}
            onClick={async () => {
              if (!confirmation) return;
              setDeleting(true);
              try {
                await confirmation.action();
                setConfirmation(null);
              } catch {
                tracker.setError(
                  "Could not delete the item. Please try again.",
                );
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
