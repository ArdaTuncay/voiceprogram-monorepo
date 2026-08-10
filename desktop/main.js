const { app, BrowserWindow, protocol, net } = require('electron');
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

const DIST_DIR = path.join(__dirname, '../frontend/dist-electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
  });

  win.loadURL('app://zircle/index.html');
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
