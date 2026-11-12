/**
 * PulseCtrl Preload Script
 * Secure IPC bridge between Main process and Renderer UI
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulseAPI', {
  // Listeners from Main process
  onStatus: (callback) => {
    ipcRenderer.on('helper-status', (_, data) => callback(data));
  },
  onSessionReady: (callback) => {
    ipcRenderer.on('session-ready', (_, data) => callback(data));
  },
  onPairRequest: (callback) => {
    ipcRenderer.on('pair-request', (_, data) => callback(data));
  },
  onPaired: (callback) => {
    ipcRenderer.on('phone-paired', (_, data) => callback(data));
  },

  // Actions sent from UI to Main process
  sendPairApproval: (allow) => {
    ipcRenderer.invoke('pair-approval', allow);
  },
  requestNewQr: () => {
    ipcRenderer.invoke('request-new-qr');
  },
  disconnect: () => {
    ipcRenderer.invoke('disconnect-session');
  }
});
