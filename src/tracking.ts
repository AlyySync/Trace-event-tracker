export type DeviceState = "active" | "idle" | "locked" | "unknown";
export type Motion = "ambient" | "focused" | "reduced";
export type Span = { start: number; end: number };
export type TraceEvent = {
  id: string;
  at: number;
  kind: string;
  title: string;
  detail?: string;
  captureId?: string;
};
export type ActivityBin = {
  at: number;
  observed: number;
  changing: number;
  idle: number;
  active: number;
  peak: number;
};
export type WorkSession = {
  id: string;
  label: string;
  createdAt: number;
  endedAt: number | null;
  runningSince: number | null;
  lastSeen: number;
  spans: Span[];
  source: string;
  sourceType: string;
  bins: ActivityBin[];
  events: TraceEvent[];
  clicks: number;
  scrolls: number;
  switches: number;
  imported?: boolean;
};
export type TraceState = {
  version: 2;
  current: WorkSession | null;
  history: WorkSession[];
  settings: {
    captureMin: number;
    captureMax: number;
    sensitivity: number;
    motion: Motion;
    hidePreview: boolean;
  };
};
export const TRACE_KEY = "trace.workspace.v2";
export function freshState(): TraceState {
  return {
    version: 2,
    current: null,
    history: [],
    settings: {
      captureMin: 60,
      captureMax: 180,
      sensitivity: 3,
      motion: "ambient",
      hidePreview: false,
    },
  };
}
export function event(
  kind: string,
  title: string,
  at = Date.now(),
  detail?: string,
): TraceEvent {
  return { id: crypto.randomUUID(), at, kind, title, detail };
}
export function createSession(
  label: string,
  source: string,
  sourceType: string,
  now: number,
): WorkSession {
  return {
    id: crypto.randomUUID(),
    label: label.trim() || "Work session",
    source,
    sourceType,
    createdAt: now,
    endedAt: null,
    runningSince: now,
    lastSeen: now,
    spans: [],
    bins: [],
    events: [event("start", "Screen tracking started", now, source)],
    clicks: 0,
    scrolls: 0,
    switches: 0,
  };
}
export function elapsed(session: WorkSession | null, now: number): number {
  if (!session) return 0;
  return (
    session.spans.reduce(
      (total, span) => total + Math.max(0, span.end - span.start),
      0,
    ) +
    (session.runningSince === null
      ? 0
      : Math.max(0, now - session.runningSince))
  );
}
export function pauseSession(
  session: WorkSession,
  now: number,
  reason = "Tracking paused",
): WorkSession {
  if (session.runningSince === null) return session;
  const end = Math.max(session.runningSince, now);
  return {
    ...session,
    runningSince: null,
    lastSeen: end,
    spans: [...session.spans, { start: session.runningSince, end }],
    events: [...session.events, event("pause", reason, end)].slice(-2000),
  };
}
export function resumeSession(
  session: WorkSession,
  now: number,
  source: string,
  sourceType: string,
): WorkSession {
  return {
    ...session,
    source,
    sourceType,
    runningSince: now,
    lastSeen: now,
    events: [
      ...session.events,
      event("resume", "Tracking resumed", now, source),
    ].slice(-2000),
  };
}
export function closeSession(session: WorkSession, now: number): WorkSession {
  const paused = pauseSession(session, now, "Screen disconnected");
  return {
    ...paused,
    endedAt: now,
    events: [...paused.events, event("finish", "Session saved", now)].slice(
      -2000,
    ),
  };
}
export function recoverState(state: TraceState): TraceState {
  if (!state.current || state.current.runningSince === null) return state;
  return {
    ...state,
    current: pauseSession(
      state.current,
      Math.max(state.current.runningSince, state.current.lastSeen),
      "Tracking interrupted. Reconnect to resume.",
    ),
  };
}
export function loadState(): TraceState {
  const stored = localStorage.getItem(TRACE_KEY);
  if (stored) {
    const value = JSON.parse(stored) as TraceState;
    if (value.version !== 2 || !Array.isArray(value.history) || !value.settings)
      throw new Error("Saved data is not readable");
    return value;
  }
  const state = freshState();
  const legacy = localStorage.getItem("tempo.workspace.v1");
  if (!legacy) return state;
  const old = JSON.parse(legacy);
  state.history = (old.sessions ?? []).map(
    (item: {
      id: string;
      label: string;
      startedAt: number;
      finishedAt: number;
      segments: Span[];
    }) => ({
      ...createSession(
        item.label,
        "Previous timer session",
        "imported",
        item.startedAt,
      ),
      id: item.id,
      createdAt: item.startedAt,
      endedAt: item.finishedAt,
      lastSeen: item.finishedAt,
      runningSince: null,
      spans: item.segments,
      bins: [],
      events: [
        event(
          "import",
          "Imported from Tempo",
          item.finishedAt,
          "Tracked time only. No screen activity was recorded.",
        ),
      ],
      imported: true,
    }),
  );
  if (old.timer?.createdAt) {
    const session = createSession(
      old.timer.label,
      "Previous timer session",
      "imported",
      old.timer.createdAt,
    );
    const spans: Span[] = [...(old.timer.segments ?? [])];
    if (
      old.timer.runningSince != null &&
      Number.isFinite(old.timer.runningSince)
    ) {
      const saved = spans.reduce(
        (sum, span) => sum + Math.max(0, span.end - span.start),
        0,
      );
      const remaining =
        old.timer.mode === "focus"
          ? Math.max(0, old.timer.targetMinutes * 60000 - saved)
          : Infinity;
      spans.push({
        start: old.timer.runningSince,
        end: Math.min(
          Math.max(old.timer.runningSince, Date.now()),
          old.timer.runningSince + remaining,
        ),
      });
    }
    state.current = {
      ...session,
      id: old.timer.id,
      runningSince: null,
      spans,
      imported: true,
      events: [
        event(
          "import",
          "Previous timer paused",
          Date.now(),
          "Previously saved time is retained. Reconnect a screen to start tracking.",
        ),
      ],
    };
  }
  return state;
}
export function frameDifference(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
): number {
  if (previous.length !== current.length || current.length === 0) return 0;
  let changed = 0;
  for (let index = 0; index < current.length; index += 4) {
    const delta =
      (Math.abs(previous[index] - current[index]) +
        Math.abs(previous[index + 1] - current[index + 1]) +
        Math.abs(previous[index + 2] - current[index + 2])) /
      3;
    if (delta > 22) changed += 1;
  }
  return (changed / (current.length / 4)) * 100;
}
export function randomDelay(
  minSeconds: number,
  maxSeconds: number,
  random = secureRandom,
): number {
  if (
    !Number.isFinite(minSeconds) ||
    !Number.isFinite(maxSeconds) ||
    minSeconds < 15 ||
    maxSeconds <= minSeconds ||
    maxSeconds > 3600
  )
    throw new Error(
      "Choose an interval between 15 and 3600 seconds, with the maximum above the minimum.",
    );
  return Math.round((minSeconds + random() * (maxSeconds - minSeconds)) * 1000);
}
function secureRandom() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 4294967296;
}
export function observe(
  session: WorkSession,
  now: number,
  previousAt: number,
  change: number,
  sensitivity: number,
  device: DeviceState,
): WorkSession {
  const gap = now - previousAt;
  const measured = gap > 7500 ? Math.min(2500, gap) : Math.max(0, gap);
  const bins = session.bins.slice();
  const at = Math.floor(now / 60000) * 60000;
  const last = bins[bins.length - 1];
  const bin: ActivityBin =
    last?.at === at
      ? { ...last }
      : { at, observed: 0, changing: 0, idle: 0, active: 0, peak: 0 };
  bin.observed += measured;
  bin.changing += change >= sensitivity ? measured : 0;
  bin.idle += device === "idle" || device === "locked" ? measured : 0;
  bin.active += device === "active" ? measured : 0;
  bin.peak = Math.max(bin.peak, change);
  if (last?.at === at) bins[bins.length - 1] = bin;
  else bins.push(bin);
  return { ...session, lastSeen: now, bins };
}
export function durationLabel(ms: number, precise = false) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (precise)
    return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function trackedToday(state: TraceState, now: number) {
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  return [...state.history, ...(state.current ? [state.current] : [])].reduce(
    (sum, session) => {
      const spans = [
        ...session.spans,
        ...(session.runningSince !== null
          ? [{ start: session.runningSince, end: now }]
          : []),
      ];
      return (
        sum +
        spans.reduce(
          (total, span) =>
            total +
            Math.max(
              0,
              Math.min(now, span.end) - Math.max(dayStart, span.start),
            ),
          0,
        )
      );
    },
    0,
  );
}
