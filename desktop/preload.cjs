const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('traceDesktop', {
  listSources: () => ipcRenderer.invoke('trace:list-sources'),
  selectSource: (id) => ipcRenderer.invoke('trace:select-source', id),
  stopCapture: () => ipcRenderer.invoke('trace:stop-capture'),
  deviceSignals: () => ipcRenderer.invoke('trace:device-signals'),
  onInterrupt: (callback) => {
    const listener = (_event, reason) => callback(reason);
    ipcRenderer.on('trace:interrupt', listener);
    return () => ipcRenderer.removeListener('trace:interrupt', listener);
  },
  platform: process.platform,
});
