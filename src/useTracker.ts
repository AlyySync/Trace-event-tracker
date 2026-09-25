import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeSession,
  createSession,
  elapsed,
  event,
  frameDifference,
  freshState,
  loadState,
  observe,
  pauseSession,
  randomDelay,
  recoverState,
  resumeSession,
  TRACE_KEY,
} from "./tracking";
import type { DeviceState, TraceState, WorkSession } from "./tracking";
import { deleteCapture, listCaptures, saveCapture } from "./storage";
import type { Capture } from "./storage";
import type { DesktopSource } from "./desktop";

export function useTracker() {
  const [state, setState] = useState<TraceState>(freshState);
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [device, setDevice] = useState<DeviceState>("unknown");
  const [change, setChange] = useState<number | null>(null);
  const stateRef = useRef(state);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ownerRef = useRef(false);
  const releaseRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const captureBusy = useRef(false);
  const connectBusy = useRef(false);
  const previousPixels = useRef<Uint8ClampedArray | null>(null);
  const previousAt = useRef(0);
  const nextCapture = useRef(Infinity);
  const lastSignal = useRef<boolean | null>(null);
  const lastSignalEvent = useRef(0);
  const pendingClicks = useRef(0);
  const pendingScrolls = useRef(0);
  const deviceRef = useRef<DeviceState>("unknown");

  const commit = useCallback((update: (current: TraceState) => TraceState) => {
    if (!ownerRef.current) return;
    const updated = update(stateRef.current);
    stateRef.current = updated;
    setState(updated);
  }, []);
  const persist = useCallback((value: TraceState) => {
    try {
      localStorage.setItem(TRACE_KEY, JSON.stringify(value));
    } catch {
      setError(
        "Local storage is full or unavailable. Export important screenshots and free some space.",
      );
    }
  }, []);
  useEffect(() => {
    if (ready && ownerRef.current) persist(state);
  }, [state, ready, persist]);

  const stopStream = useCallback(() => {
    generationRef.current += 1;
    nextCapture.current = Infinity;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    videoRef.current = null;
    previousPixels.current = null;
    setStream(null);
    setChange(null);
    setDevice("unknown");
    deviceRef.current = "unknown";
    void window.traceDesktop?.stopCapture().catch(() => undefined);
  }, []);

  const pause = useCallback(
    (reason = "Tracking paused", at = Date.now()) => {
      stopStream();
      commit((current) =>
        current.current
          ? { ...current, current: pauseSession(current.current, at, reason) }
          : current,
      );
      persist(stateRef.current);
    },
    [commit, persist, stopStream],
  );

  useEffect(() => {
    let disposed = false;
    const initialize = () => {
      try {
        const loaded = recoverState(loadState());
        stateRef.current = loaded;
        setState(loaded);
        setReady(true);
      } catch {
        setError(
          "Saved activity could not be read. Your previous data has not been overwritten.",
        );
        ownerRef.current = false;
        setReadOnly(true);
        setReady(true);
      }
    };
    if (navigator.locks) {
      void navigator.locks
        .request(
          "trace-tracking-owner",
          { ifAvailable: true },
          async (lock) => {
            if (disposed) return;
            if (!lock) {
              setReadOnly(true);
              setReady(true);
              try {
                const loaded = loadState();
                stateRef.current = loaded;
                setState(loaded);
              } catch {
                setError("Could not read the current session.");
              }
              return;
            }
            ownerRef.current = true;
            initialize();
            await new Promise<void>((resolve) => {
              releaseRef.current = resolve;
              if (disposed) resolve();
            });
          },
        )
        .catch(() => {
          if (!disposed) {
            ownerRef.current = true;
            initialize();
          }
        });
    } else {
      ownerRef.current = true;
      initialize();
    }
    listCaptures()
      .then((items) => {
        if (!disposed) setCaptures(items);
      })
      .catch(() => {
        if (!disposed)
          setError(
            "Screenshot storage is unavailable. Allow local storage before tracking.",
          );
      });
    const sync = (message: StorageEvent) => {
      if (message.key === TRACE_KEY && !ownerRef.current && message.newValue) {
        try {
          const loaded = JSON.parse(message.newValue) as TraceState;
          stateRef.current = loaded;
          setState(loaded);
        } catch {
          /* Keep the last readable view. */
        }
      }
    };
    window.addEventListener("storage", sync);
    return () => {
      disposed = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      releaseRef.current?.();
      releaseRef.current = null;
      ownerRef.current = false;
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    const beforeClose = () => {
      if (ownerRef.current && stateRef.current.current?.runningSince != null)
        pause("App closed. Tracking paused.");
    };
    window.addEventListener("beforeunload", beforeClose);
    const unsubscribe = window.traceDesktop?.onInterrupt((reason) => {
      pause(reason);
      setNotice(reason);
    });
    return () => {
      window.removeEventListener("beforeunload", beforeClose);
      unsubscribe?.();
    };
  }, [pause]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const schedule = useCallback(() => {
    const settings = stateRef.current.settings;
    nextCapture.current =
      Date.now() + randomDelay(settings.captureMin, settings.captureMax);
  }, []);

  const start = async (label: string, source?: DesktopSource) => {
    if (!ownerRef.current || connectBusy.current || streamRef.current) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "Screen capture is unavailable in this preview. Use the Trace desktop project to track your PC.",
      );
      return;
    }
    setError("");
    setBusy(true);
    connectBusy.current = true;
    const generation = generationRef.current;
    let media: MediaStream | null = null;
    try {
      if (source && window.traceDesktop)
        await window.traceDesktop.selectSource(source.id);
      media = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 8, max: 12 } },
        audio: false,
      });
      if (generation !== generationRef.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = media.getVideoTracks()[0];
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = media;
      streamRef.current = media;
      videoRef.current = video;
      track.addEventListener(
        "ended",
        () => {
          pause("Screen sharing stopped");
          setNotice("Screen disconnected. Time and captures are paused.");
        },
        { once: true },
      );
      await video.play();
      if (generation !== generationRef.current) return;
      await new Promise<void>((resolve, reject) => {
        if (video.videoWidth && video.readyState >= 2) {
          resolve();
          return;
        }
        const timeout = window.setTimeout(
          () => reject(new Error("No screen frames received")),
          10000,
        );
        video.addEventListener(
          "loadeddata",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });
      if (generation !== generationRef.current) return;
      const stamp = Date.now();
      const sourceName = source?.name || track.label || "Selected screen";
      const sourceType =
        source?.type || track.getSettings().displaySurface || "screen";
      commit((current) => ({
        ...current,
        current: current.current
          ? resumeSession(current.current, stamp, sourceName, sourceType)
          : createSession(label, sourceName, sourceType, stamp),
      }));
      previousAt.current = stamp;
      previousPixels.current = null;
      lastSignal.current = null;
      pendingClicks.current = 0;
      pendingScrolls.current = 0;
      setStream(media);
      setNow(stamp);
      schedule();
      setNotice("Tracking started. Random screenshots are enabled.");
    } catch (failure) {
      media?.getTracks().forEach((track) => track.stop());
      stopStream();
      const name = (failure as DOMException).name;
      setError(
        name === "NotAllowedError" || name === "InvalidStateError"
          ? "Screen permission was not granted. No time or screenshots were recorded. Choose a source and try again."
          : "Could not connect to that screen. Check screen-recording permission and try again.",
      );
    } finally {
      connectBusy.current = false;
      setBusy(false);
    }
  };

  const snapshot = useCallback(
    async (kind: "manual" | "automatic" = "manual") => {
      const current = stateRef.current.current;
      const video = videoRef.current;
      if (
        !current ||
        current.runningSince === null ||
        !video ||
        captureBusy.current ||
        !ownerRef.current
      )
        return;
      captureBusy.current = true;
      setCapturing(true);
      const generation = generationRef.current;
      try {
        if (
          !video.videoWidth ||
          video.readyState < 2 ||
          streamRef.current?.getVideoTracks()[0]?.readyState !== "live"
        )
          throw new Error("No screen signal");
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 2560 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Capture unavailable");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value ? resolve(value) : reject(new Error("Capture failed")),
            "image/png",
          ),
        );
        if (
          generation !== generationRef.current ||
          stateRef.current.current?.runningSince === null
        )
          return;
        const stamp = Date.now();
        const capture: Capture = {
          id: crypto.randomUUID(),
          sessionId: current.id,
          label: current.label,
          createdAt: stamp,
          elapsedMs: elapsed(current, stamp),
          width: canvas.width,
          height: canvas.height,
          blob,
          kind,
          sourceLabel: current.source,
        };
        await saveCapture(capture);
        setCaptures((items) => [capture, ...items]);
        const captureEvent = {
          ...event(
            "capture",
            kind === "automatic"
              ? "Random screenshot captured"
              : "Manual screenshot captured",
            stamp,
            current.source,
          ),
          captureId: capture.id,
        };
        commit((value) => {
          if (value.current?.id === current.id)
            return {
              ...value,
              current: {
                ...value.current,
                events: [...value.current.events, captureEvent].slice(-2000),
              },
            };
          return {
            ...value,
            history: value.history.map((item) =>
              item.id === current.id
                ? {
                    ...item,
                    events: [...item.events, captureEvent].slice(-2000),
                  }
                : item,
            ),
          };
        });
        setNotice(
          kind === "automatic"
            ? "Random screenshot saved."
            : "Screenshot saved.",
        );
      } catch {
        setError(
          "Screenshot could not be saved. Tracking is paused. Check storage and reconnect your screen.",
        );
        pause("Screenshot storage or screen signal failed");
      } finally {
        captureBusy.current = false;
        setCapturing(false);
      }
    },
    [commit, pause],
  );

  useEffect(() => {
    let disposed = false;
    let sampling = false;
    let lastSample = 0;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const sample = async (stamp: number) => {
      const current = stateRef.current.current;
      const video = videoRef.current;
      if (
        !current ||
        current.runningSince === null ||
        !video ||
        !context ||
        sampling
      )
        return;
      if (stamp - current.lastSeen > 15000) {
        pause(
          "Capture feed was interrupted. Reconnect to continue.",
          current.lastSeen,
        );
        return;
      }
      if (video.readyState < 2 || !video.videoWidth) return;
      sampling = true;
      const generation = generationRef.current;
      try {
        if (window.traceDesktop) {
          try {
            const signals = await window.traceDesktop.deviceSignals();
            if (generation !== generationRef.current || disposed) return;
            if (signals.state === "locked") {
              pause("Device locked. Tracking paused.");
              return;
            }
            if (deviceRef.current !== signals.state) {
              deviceRef.current = signals.state;
              setDevice(signals.state);
              commit((value) =>
                value.current
                  ? {
                      ...value,
                      current: {
                        ...value.current,
                        events: [
                          ...value.current.events,
                          event(
                            "device",
                            signals.state === "idle"
                              ? "Device became idle"
                              : signals.state === "active"
                                ? "Device activity detected"
                                : "Device signal unavailable",
                            stamp,
                          ),
                        ].slice(-2000),
                      },
                    }
                  : value,
              );
            }
          } catch {
            deviceRef.current = "unknown";
            setDevice("unknown");
          }
        }
        if (generation !== generationRef.current || disposed) return;
        context.drawImage(video, 0, 0, 64, 36);
        const pixels = context.getImageData(0, 0, 64, 36).data;
        const score = previousPixels.current
          ? frameDifference(previousPixels.current, pixels)
          : 0;
        const hasBaseline = previousPixels.current !== null;
        previousPixels.current = new Uint8ClampedArray(pixels);
        setChange(hasBaseline ? score : null);
        const changing = score >= stateRef.current.settings.sensitivity;
        const transition =
          hasBaseline &&
          lastSignal.current !== changing &&
          stamp - lastSignalEvent.current >= 10000;
        if (transition) {
          lastSignal.current = changing;
          lastSignalEvent.current = stamp;
        }
        const clicks = pendingClicks.current;
        const scrolls = pendingScrolls.current;
        pendingClicks.current = 0;
        pendingScrolls.current = 0;
        commit((value) => {
          if (
            !value.current ||
            value.current.id !== current.id ||
            value.current.runningSince === null
          )
            return value;
          const measured = hasBaseline
            ? observe(
                value.current,
                stamp,
                previousAt.current,
                score,
                value.settings.sensitivity,
                deviceRef.current,
              )
            : { ...value.current, lastSeen: stamp };
          return {
            ...value,
            current: {
              ...measured,
              clicks: measured.clicks + clicks,
              scrolls: measured.scrolls + scrolls,
              events: transition
                ? [
                    ...measured.events,
                    event(
                      "signal",
                      changing
                        ? "Screen content changed"
                        : "Screen content became steady",
                      stamp,
                      "Visual change only; not a measure of productivity.",
                    ),
                  ].slice(-2000)
                : measured.events,
            },
          };
        });
        previousAt.current = stamp;
      } catch {
        pause("Screen signal unavailable. Tracking paused.");
        setError("The screen signal was lost. Reconnect a screen to continue.");
      } finally {
        sampling = false;
      }
    };
    const timer = window.setInterval(() => {
      const stamp = Date.now();
      setNow(stamp);
      if (
        !ownerRef.current ||
        stateRef.current.current?.runningSince == null ||
        !streamRef.current
      )
        return;
      if (stamp - lastSample >= 2500) {
        lastSample = stamp;
        void sample(stamp);
      }
      if (stamp >= nextCapture.current && !captureBusy.current) {
        nextCapture.current = Infinity;
        void snapshot("automatic").finally(() => {
          if (
            !disposed &&
            streamRef.current &&
            stateRef.current.current?.runningSince != null
          )
            schedule();
        });
      }
    }, 500);
    let lastScroll = 0;
    const click = () => {
      if (streamRef.current && ownerRef.current) pendingClicks.current += 1;
    };
    const scroll = () => {
      if (
        streamRef.current &&
        ownerRef.current &&
        Date.now() - lastScroll > 700
      ) {
        pendingScrolls.current += 1;
        lastScroll = Date.now();
      }
    };
    const visibility = () => {
      if (!ownerRef.current || !streamRef.current) return;
      commit((value) =>
        value.current
          ? {
              ...value,
              current: {
                ...value.current,
                switches: value.current.switches + (document.hidden ? 1 : 0),
                events: [
                  ...value.current.events,
                  event(
                    "visibility",
                    document.hidden
                      ? "Trace moved to background"
                      : "Trace brought to foreground",
                  ),
                ].slice(-2000),
              },
            }
          : value,
      );
    };
    window.addEventListener("pointerdown", click, { passive: true });
    window.addEventListener("scroll", scroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", click);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [commit, pause, schedule, snapshot]);

  const finish = () => {
    stopStream();
    commit((current) =>
      current.current
        ? {
            ...current,
            history: [
              closeSession(current.current, Date.now()),
              ...current.history,
            ],
            current: null,
          }
        : current,
    );
    persist(stateRef.current);
    setNotice("Session saved to your timeline.");
  };
  const updateSettings = (settings: TraceState["settings"]) => {
    randomDelay(settings.captureMin, settings.captureMax);
    commit((current) => ({ ...current, settings }));
    if (streamRef.current) schedule();
    setNotice("Tracking preferences saved.");
  };
  const removeCapture = async (id: string) => {
    await deleteCapture(id);
    setCaptures((items) => items.filter((item) => item.id !== id));
    setNotice("Screenshot deleted.");
  };
  const removeSession = (session: WorkSession) => {
    commit((current) => ({
      ...current,
      history: current.history.filter((item) => item.id !== session.id),
    }));
    setNotice("Session removed. Its screenshots are still in Captures.");
  };
  return {
    state,
    now,
    ready,
    readOnly,
    error,
    setError,
    notice,
    setNotice,
    busy,
    capturing,
    captures,
    stream,
    device,
    change,
    start,
    pause,
    finish,
    snapshot,
    updateSettings,
    removeCapture,
    removeSession,
    commit,
  };
}
