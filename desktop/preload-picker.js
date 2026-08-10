const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  onSources: (callback) => {
    ipcRenderer.on('picker:sources', (_event, sources) => callback(sources));
  },
  selectSource: (sourceId) => {
    ipcRenderer.send('picker:selected', sourceId);
  },
  cancel: () => {
    ipcRenderer.send('picker:cancelled');
  },
});
