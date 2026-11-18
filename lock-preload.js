const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lockAPI', {
    // unlock mode
    submit: (password) => ipcRenderer.invoke('lock-submit', password),
    // set / reset mode
    setPassword: (password) => ipcRenderer.invoke('lock-set', password),
    // Removing protection: verified against the current password in the main process
    removeWithPassword: (password) => ipcRenderer.invoke('lock-remove', password),
    cancel: () => ipcRenderer.send('lock-cancel'),
    onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme)),
    onLangChanged: (cb) => ipcRenderer.on('lang-changed', (_e, lang) => cb(lang))
});
