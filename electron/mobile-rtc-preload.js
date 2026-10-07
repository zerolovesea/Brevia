const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('transport', {
  on: (callback) => ipcRenderer.on('mobile.rtc.command', (_, value) => callback(value)),
  send: (value) => ipcRenderer.send('mobile.rtc.event', value),
});
