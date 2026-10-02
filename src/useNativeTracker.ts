import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { freshState } from './tracking';
import type { TraceState, WorkSession } from './tracking';
import type { Capture } from './storage';
import type { DesktopSource, NativeStatus } from './desktop';

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function useNativeTracker() {
  const [status, setStatus] = useState<NativeStatus>(() => ({
    state: freshState(),
    connected: false,
    device: 'unknown',
    change: null,
    previewFrame: null,
    revision: -1,
    captureRevision: -1,
    error: '',
    notice: '',
  }));
  const statusRef = useRef(status);
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const captureCache = useRef(new Map<string, Capture>());
  const pending = useRef({ clicks: 0, scrolls: 0 });
  const starting = useRef(false);
  const savingCapture = useRef(false);
  const mounted = useRef(true);

  const apply = useCallback((next: NativeStatus) => {
    if (!mounted.current || next.revision < statusRef.current.revision) return;
    if (
      next.notice &&
      (next.notice !== statusRef.current.notice ||
        next.captureRevision !== statusRef.current.captureRevision)
    )
      setNotice(next.notice);
    if (next.error !== statusRef.current.error) setError(next.error);
    statusRef.current = next;
    setStatus(next);
    setReady(true);
    setNow(Date.now());
  }, []);
  const command = useCallback(
    async (name: string, args?: Record<string, unknown>) => {
      try {
        const result = await invoke<NativeStatus>(name, args);
        apply(result);
        return result;
      } catch (failure) {
        if (mounted.current) setError(message(failure));
        return null;
      }
    },
    [apply],
  );

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const next = await invoke<NativeStatus>('native_status');
        if (!disposed) apply(next);
      } catch (failure) {
        if (!disposed)
          setError(`Could not read the desktop backend: ${message(failure)}`);
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void poll();
    }, 1000);
    return () => {
      disposed = true;
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [apply]);

  useEffect(() => {
    if (status.captureRevision < 0) return;
    let disposed = false;
    const load = async () => {
      try {
        const metadata = await invoke<Omit<Capture, 'blob'>[]>('list_captures');
        const loaded: Capture[] = [];
        // Transfer PNG bytes through the narrow Rust command, never a filesystem URL.
        for (const item of metadata) {
          if (disposed) return;
          let capture = captureCache.current.get(item.id);
          if (!capture) {
            const bytes = await invoke<ArrayBuffer>('read_capture', {
              id: item.id,
            });
            capture = {
              ...item,
              blob: new Blob([bytes], { type: 'image/png' }),
            };
          }
          loaded.push(capture);
        }
        if (!disposed) {
          captureCache.current = new Map(loaded.map((item) => [item.id, item]));
          setCaptures(loaded);
        }
      } catch (failure) {
        if (!disposed)
          setError(`Could not load screenshots: ${message(failure)}`);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [status.captureRevision]);

  const flush = useCallback(async (hidden?: boolean) => {
    const batch = pending.current;
    pending.current = { clicks: 0, scrolls: 0 };
    if (
      !statusRef.current.connected ||
      (!batch.clicks && !batch.scrolls && hidden === undefined)
    )
      return;
    try {
      await invoke('record_interactions', { ...batch, hidden: hidden ?? null });
    } catch (failure) {
      if (mounted.current) setError(message(failure));
    }
  }, []);
  useEffect(() => {
    let lastScroll = 0;
    const click = () => {
      if (statusRef.current.connected)
        pending.current.clicks = Math.min(1000, pending.current.clicks + 1);
    };
    const scroll = () => {
      if (statusRef.current.connected && Date.now() - lastScroll > 700) {
        pending.current.scrolls = Math.min(1000, pending.current.scrolls + 1);
        lastScroll = Date.now();
      }
    };
    const visibility = () => {
      void flush(document.hidden);
    };
    const timer = window.setInterval(() => {
      void flush();
    }, 2500);
    window.addEventListener('pointerdown', click, { passive: true });
    window.addEventListener('scroll', scroll, { passive: true, capture: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', click);
      window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [flush]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const start = async (label: string, source?: DesktopSource) => {
    if (starting.current || statusRef.current.connected) return;
    if (!source) {
      setError('Choose a screen or window to start tracking.');
      return;
    }
    starting.current = true;
    setBusy(true);
    setError('');
    try {
      await command('start_tracking', { label, sourceId: source.id });
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };
  const pause = async (reason = 'Tracking paused') => {
    await flush();
    await command('pause_tracking', { reason });
  };
  const finish = async () => {
    await flush();
    await command('finish_tracking');
  };
  const snapshot = async (_kind: 'manual' | 'automatic' = 'manual') => {
    if (savingCapture.current) return;
    savingCapture.current = true;
    setCapturing(true);
    setError('');
    try {
      await command('capture_now');
    } finally {
      savingCapture.current = false;
      setCapturing(false);
    }
  };
  const updateSettings = async (settings: TraceState['settings']) => {
    await command('set_preferences', { settings });
  };
  const removeCapture = async (id: string) => {
    if (!(await command('delete_capture', { id })))
      throw new Error('Screenshot could not be deleted.');
  };
  const removeSession = async (session: WorkSession) => {
    if (!(await command('delete_session', { id: session.id })))
      throw new Error('Session could not be deleted.');
  };
  const commit = (update: (current: TraceState) => TraceState) => {
    const old = statusRef.current.state;
    const next = update(old);
    if (JSON.stringify(old.settings) !== JSON.stringify(next.settings))
      void updateSettings(next.settings);
    if (next.current && next.current.label !== old.current?.label)
      void command('rename_session', { label: next.current.label });
  };

  return {
    state: status.state,
    now,
    ready,
    readOnly: false,
    error,
    setError,
    notice,
    setNotice,
    busy,
    capturing,
    captures,
    stream: null as MediaStream | null,
    connected: status.connected,
    previewFrame: status.previewFrame,
    device: status.device,
    change: status.change,
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
