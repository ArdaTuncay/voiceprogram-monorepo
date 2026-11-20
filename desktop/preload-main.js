// Bridge for the main window: the page can only ask to recolor the native
// window buttons (titleBarOverlay) when its theme changes — nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zircleDesktop', {
  setTitleBarTheme: (theme) => ipcRenderer.send('titlebar:theme', theme === 'light' ? 'light' : 'dark'),
});
