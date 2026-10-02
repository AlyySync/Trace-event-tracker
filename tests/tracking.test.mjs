import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";

const source = await fs.readFile(
  new URL("../src/tracking.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const model = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const {
  createSession,
  pauseSession,
  resumeSession,
  closeSession,
  elapsed,
  freshState,
  recoverState,
  randomDelay,
  frameDifference,
  observe,
  trackedToday,
  loadState,
  TRACE_KEY,
} = model;

let session = createSession("  Design study  ", "Display 1", "screen", 1000);
assert.equal(session.label, "Design study");
assert.equal(elapsed(session, 11000), 10000);
session = pauseSession(session, 11000);
assert.equal(elapsed(session, 90000), 10000, "Paused time must not grow");
assert.equal(
  pauseSession(session, 15000),
  session,
  "Pausing twice must not add spans",
);
session = resumeSession(session, 51000, "Display 1", "screen");
session = closeSession(session, 61000);
assert.equal(elapsed(session, 100000), 20000, "Breaks must be excluded");
assert.equal(session.endedAt, 61000);

const interrupted = {
  ...createSession("Interrupted", "Display 1", "screen", 1000),
  lastSeen: 9000,
};
const recovered = recoverState({ ...freshState(), current: interrupted });
assert.equal(recovered.current.runningSince, null);
assert.equal(
  elapsed(recovered.current, 1000000),
  8000,
  "Recovery must stop at the last heartbeat",
);

assert.equal(
  randomDelay(30, 90, () => 0),
  30000,
);
assert.equal(
  randomDelay(30, 90, () => 0.5),
  60000,
);
assert.ok(randomDelay(30, 90, () => 0.99999) <= 90000);
const intervals = Array.from({ length: 100 }, () => randomDelay(30, 90));
assert.ok(intervals.every((value) => value >= 30000 && value <= 90000));
assert.ok(new Set(intervals).size > 1, "Capture intervals must vary");
for (const [min, max] of [
  [1, 90],
  [90, 30],
  [30, 30],
  [15, 3601],
  [NaN, 90],
]) {
  assert.throws(() => randomDelay(min, max), /interval/);
}

const black = new Uint8ClampedArray(16);
const halfWhite = new Uint8ClampedArray([
  255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255,
]);
assert.equal(frameDifference(black, black), 0);
assert.equal(frameDifference(black, halfWhite), 50);
const measured = observe(
  createSession("Sample", "Display 1", "screen", 1000),
  4000,
  1000,
  50,
  3,
  "idle",
);
assert.equal(measured.bins[0].observed, 3000);
assert.equal(measured.bins[0].changing, 3000);
assert.equal(measured.bins[0].idle, 3000);
assert.equal(
  measured.bins[0].active,
  0,
  "Screen change must not count as device input",
);
const delayed = observe(measured, 64000, 4000, 0, 3, "unknown");
assert.equal(
  delayed.bins[1].observed,
  2500,
  "A stalled sampler must not fabricate observations",
);
assert.equal(delayed.bins[1].idle, 0, "Unknown is not idle");
const midnight = new Date(2026, 8, 25, 0, 0, 0).getTime();
assert.equal(
  trackedToday(
    {
      ...freshState(),
      history: [
        {
          ...session,
          spans: [{ start: midnight - 5000, end: midnight + 10000 }],
        },
      ],
    },
    midnight + 20000,
  ),
  10000,
);

const saved = new Map();
globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null };
saved.set(TRACE_KEY, JSON.stringify({ version: 99 }));
assert.throws(loadState, /not readable/);
saved.clear();
saved.set(
  "tempo.workspace.v1",
  JSON.stringify({
    sessions: [],
    timer: {
      id: "legacy-session",
      label: "Legacy focus",
      createdAt: Date.now() - 120000,
      runningSince: Date.now() - 120000,
      segments: [],
      mode: "focus",
      targetMinutes: 1,
    },
  }),
);
const imported = loadState().current;
assert.equal(imported.id, "legacy-session");
assert.equal(imported.runningSince, null);
assert.equal(
  elapsed(imported, Date.now()),
  60000,
  "Legacy countdown must retain capped work time",
);
delete globalThis.localStorage;

console.log("PASS: elapsed time, pause/resume, recovery, random intervals, screen sampling, idle separation, day boundaries, browser migration.");
