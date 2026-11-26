const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('groupNameAPI', {
    submit: (name) => ipcRenderer.send('group-name-window-submit', name),
    cancel: () => ipcRenderer.send('group-name-window-cancel'),
    onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme)),
    onLangChanged: (cb) => ipcRenderer.on('lang-changed', (_e, lang) => cb(lang))
});
