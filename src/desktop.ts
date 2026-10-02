import { invoke, isTauri } from '@tauri-apps/api/core';
import type { DeviceState, TraceState } from './tracking';

export const isDesktop = isTauri();
export type DesktopSource = {
  id: string;
  name: string;
  thumbnail: string;
  type: 'screen' | 'window';
};
export type NativeStatus = {
  state: TraceState;
  connected: boolean;
  device: DeviceState;
  change: number | null;
  previewFrame: string | null;
  revision: number;
  captureRevision: number;
  error: string;
  notice: string;
};
export type StorageInfo = {
  backend: string;
  databasePath: string;
  screenshots: string;
  timestamps: string;
};
export const desktop = {
  listSources: () => invoke<DesktopSource[]>('list_sources'),
  storageInfo: () => invoke<StorageInfo>('storage_info'),
  exportCapture: (id: string) => invoke<boolean>('export_capture', { id }),
};
