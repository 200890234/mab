const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('downloadsAPI', {
    get: () => ipcRenderer.invoke('downloads-get'),
    cancel: (id) => ipcRenderer.send('download-cancel', id),
    open: (id) => ipcRenderer.send('download-open', id),
    show: (id) => ipcRenderer.send('download-show', id),
    clear: () => ipcRenderer.send('downloads-clear'),
    onState: (cb) => ipcRenderer.on('downloads-state', (_e, list) => cb(list)),
    onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme)),
    onLangChanged: (cb) => ipcRenderer.on('lang-changed', (_e, lang) => cb(lang))
});
