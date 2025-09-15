const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Repository selection
  selectRepository: () => ipcRenderer.invoke('select-repository'),

  // App info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // Listen for repository selection from menu
  onRepositorySelected: (callback) => {
    ipcRenderer.on('repository-selected', (event, path) => {
      callback(path);
    });
  },

  // Remove repository selection listener
  removeRepositorySelectedListener: () => {
    ipcRenderer.removeAllListeners('repository-selected');
  },

  // Platform info
  platform: process.platform,

  // Versions
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});