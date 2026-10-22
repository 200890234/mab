const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toolsAPI', {
    getTools: () => ipcRenderer.invoke('tools-get'),
    addTool: (name, url) => ipcRenderer.invoke('tools-add', name, url),
    updateTool: (key, patch) => ipcRenderer.invoke('tools-update', key, patch),
    removeTool: (key) => ipcRenderer.invoke('tools-remove', key),
    reorderTool: (fromKey, toKey) => ipcRenderer.invoke('tools-reorder', fromKey, toKey),
    openJsonFile: (inFolder) => ipcRenderer.send('tools-open-json', inFolder),
    // Fired when tools.json is edited externally (fs.watch in the main process)
    onExternalReload: (cb) => ipcRenderer.on('tools-external-reload', () => cb()),
    onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme)),
    onLangChanged: (cb) => ipcRenderer.on('lang-changed', (_e, lang) => cb(lang))
});
