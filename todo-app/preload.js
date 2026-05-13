const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('todoAPI', {
  loadData: () => ipcRenderer.invoke('todo:load'),
  saveData: (data) => ipcRenderer.invoke('todo:save', data)
});

contextBridge.exposeInMainWorld('settingsAPI', {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (settings) => ipcRenderer.invoke('settings:save', settings)
});

contextBridge.exposeInMainWorld('notifyAPI', {
  show: (title, body) => ipcRenderer.invoke('notify:show', { title, body })
});

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximizeChange: (cb) => {
    ipcRenderer.on('window:maximized', (_e, isMax) => cb(isMax));
  }
});
