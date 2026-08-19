const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toolbarAPI', {
    // Web tools (top toolbar tabs)
    onWebTools: (cb) => ipcRenderer.on('webtools-sync', (_e, list) => cb(list)),
    onActiveWebTool: (cb) => ipcRenderer.on('webtool-active', (_e, key) => cb(key)),
    addWebTool: (url, name) => ipcRenderer.send('add-webtool', url, name),
    switchWebTool: (key) => ipcRenderer.send('switch-webtool', key),
    closeWebTool: (key) => ipcRenderer.send('close-webtool', key),
    // Localized labels for the self-drawn menu buttons (File / View / Help)
    onMenuItems: (cb) => ipcRenderer.on('menu-items', (_e, data) => cb(data)),
    // Ask the main process to show a native popup menu for File/View/Help
    showMenuPopup: (type, x, y) => ipcRenderer.send('show-menu-popup', type, x, y),
    // Title bar: sidebar width sync (aligns the web-tool area with the content area below)
    onSidebarWidth: (cb) => ipcRenderer.on('set-sidebar-width', (_e, w) => cb(w)),
    // Theme
    onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme))
});
