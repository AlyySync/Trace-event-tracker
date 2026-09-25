export type DesktopSource = {
  id: string;
  name: string;
  thumbnail: string;
  type: 'screen' | 'window';
};
declare global {
  interface Window {
    traceDesktop?: {
      listSources: () => Promise<DesktopSource[]>;
      selectSource: (id: string) => Promise<void>;
      stopCapture: () => Promise<void>;
      deviceSignals: () => Promise<{
        idleSeconds: number;
        state: 'active' | 'idle' | 'locked' | 'unknown';
      }>;
      onInterrupt: (callback: (reason: string) => void) => () => void;
      platform: string;
    };
  }
}
