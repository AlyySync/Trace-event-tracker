const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  powerMonitor,
  session,
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let window;
let selectedSource = null;
let allowedSources = new Set();
const rendererPath = path.join(
  app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
  'dist', 'index.html',
);
const entry = pathToFileURL(rendererPath).href;

function assertSender(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !event.senderFrame.url.startsWith(entry)
  ) {
    throw new Error('Untrusted request');
  }
}

async function sources() {
  return desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: false,
  });
}

app.setName('Trace');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionCheckHandler(
      (_contents, permission) => permission === 'display-capture',
    );
    session.defaultSession.setPermissionRequestHandler(
      (_contents, permission, callback) =>
        callback(permission === 'display-capture' && !!selectedSource),
    );
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        try {
          if (!selectedSource) {
            callback({});
            return;
          }
          const requestedId = selectedSource;
          const available = await sources();
          const source = available.find((item) => item.id === requestedId);
          if (!source || selectedSource !== requestedId) {
            selectedSource = null;
            callback({});
            return;
          }
          callback({ video: source });
        } catch {
          selectedSource = null;
          callback({});
        }
      },
    );

    ipcMain.handle('trace:list-sources', async (event) => {
      assertSender(event);
      const available = await sources();
      allowedSources = new Set(available.map((item) => item.id));
      return available.map((item) => ({
        id: item.id,
        name: item.name,
        thumbnail: item.thumbnail.toDataURL(),
        type: item.id.startsWith('screen:') ? 'screen' : 'window',
      }));
    });
    ipcMain.handle('trace:select-source', (event, id) => {
      assertSender(event);
      if (typeof id !== 'string' || !allowedSources.has(id))
        throw new Error('Choose an available screen or window.');
      selectedSource = id;
    });
    ipcMain.handle('trace:stop-capture', (event) => {
      assertSender(event);
      selectedSource = null;
    });
    ipcMain.handle('trace:device-signals', (event) => {
      assertSender(event);
      if (!selectedSource) throw new Error('Tracking is not active.');
      return {
        idleSeconds: powerMonitor.getSystemIdleTime(),
        state: powerMonitor.getSystemIdleState(60),
      };
    });

    window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 1000,
      minHeight: 700,
      title: 'Trace',
      backgroundColor: '#0d1112',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== entry) event.preventDefault();
    });
    window.on('closed', () => {
      selectedSource = null;
      window = null;
    });
    window.loadFile(rendererPath);
    const interrupt = (reason) => {
      selectedSource = null;
      if (window && !window.isDestroyed())
        window.webContents.send('trace:interrupt', reason);
    };
    powerMonitor.on('lock-screen', () =>
      interrupt('Device locked. Tracking paused.'),
    );
    powerMonitor.on('suspend', () =>
      interrupt('Device went to sleep. Tracking paused.'),
    );
  });
}
app.on('window-all-closed', () => app.quit());
