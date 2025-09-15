// Preload script for Bob Electron app
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
    ipcRenderer.on('repository-selected', (event, path) => callback(path));
  },
  
  // Remove listeners
  removeRepositorySelectedListener: () => {
    ipcRenderer.removeAllListeners('repository-selected');
  }
});

// Expose a limited API for development
if (process.env.NODE_ENV === 'development') {
  contextBridge.exposeInMainWorld('electronDev', {
    platform: process.platform,
    versions: process.versions
  });
}
