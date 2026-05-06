const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arch', {
  detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),
  openUrl: (browserPath, url) => ipcRenderer.invoke('open-url', { browserPath, url }),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getLocalHistory: (icon, limit) => ipcRenderer.invoke('get-local-history', { icon, limit }),
  isElectron: true,
});
