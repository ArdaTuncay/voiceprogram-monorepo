const { app, BrowserWindow, protocol, net, session, desktopCapturer, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Must run before app.whenReady() — Electron ignores this once the app has
// started. `secure`/`standard`/`corsEnabled` make app:// behave like http(s)
// (a real origin the backend's CORS/check_origin can allow-list) instead of
// the opaque `null` origin a file:// page would send.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const DIST_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'dist-electron')
  : path.join(__dirname, '../frontend/dist-electron');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Zircle',
    width: 1280,
    height: 800,
  });

  mainWindow.loadURL('app://zircle/index.html');
}

/**
 * Opens the source-picker modal and resolves with the DesktopCapturerSource
 * the user chose, or null if they cancelled (closed the window, hit Escape,
 * or clicked "İptal") — mirrors a browser's own getDisplayMedia prompt,
 * where cancelling is a normal, non-error outcome for the caller to handle.
 */
function pickSource(sources) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      width: 900,
      height: 600,
      webPreferences: {
        preload: path.join(__dirname, 'preload-picker.js'),
        contextIsolation: true,
      },
    });

    // Guards against resolving twice — e.g. a "picker:selected" message
    // arriving right as the user also closes the window would otherwise
    // both try to settle this promise.
    let settled = false;
    function settle(source) {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('picker:selected', onSelected);
      ipcMain.removeListener('picker:cancelled', onCancelled);
      resolve(source);
      if (!picker.isDestroyed()) picker.close();
    }

    function onSelected(_event, sourceId) {
      settle(sources.find((s) => s.id === sourceId) ?? null);
    }
    function onCancelled() {
      settle(null);
    }

    ipcMain.once('picker:selected', onSelected);
    ipcMain.once('picker:cancelled', onCancelled);
    picker.once('closed', () => settle(null));

    picker.webContents.once('did-finish-load', () => {
      picker.webContents.send(
        'picker:sources',
        sources.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.id.startsWith('screen:') ? 'screen' : 'window',
          thumbnail: s.thumbnail.toDataURL(),
        }))
      );
    });

    picker.loadFile(path.join(__dirname, 'picker.html'));
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const requestedPath = decodeURIComponent(url.pathname);
    const resolvedPath = path.normalize(
      path.join(DIST_DIR, requestedPath === '/' ? '/index.html' : requestedPath)
    );

    // Reject anything that resolves outside DIST_DIR (e.g. app://zircle/../../secret.txt).
    if (resolvedPath !== DIST_DIR && !resolvedPath.startsWith(DIST_DIR + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(pathToFileURL(resolvedPath).toString());
  });

  // Without this, navigator.mediaDevices.getDisplayMedia() always rejects
  // with NotSupportedError — Electron requires an explicit handler, there's
  // no default. `useSystemPicker` only does anything on macOS 15+ (Electron
  // docs mark it "_macOS_ _Experimental_"); on Windows it's a no-op, so the
  // handler below always runs and shows our own picker (see pickSource)
  // instead of relying on an OS-native chooser.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 300, height: 200 },
        })
        .then(async (sources) => {
          const chosen = await pickSource(sources);
          if (!chosen) {
            // User cancelled — callback({}) with no video source is how a
            // browser's own getDisplayMedia rejects with NotAllowedError,
            // same as clicking "Cancel" in Chrome's native picker would.
            callback({});
            return;
          }
          // 'loopback' captures system audio (Windows-only) — only offered
          // when the page actually asked for an audio track, since Zircle's
          // getDisplayMedia({ video: true }) call today doesn't.
          callback({
            video: chosen,
            ...(request.audioRequested ? { audio: 'loopback' } : {}),
          });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: true }
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
