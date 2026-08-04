const { contextBridge, ipcRenderer } = require('electron');

// Ctrl+wheel zoom (the sidebar itself needs it too): delegate to the main process for unified handling
window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    ipcRenderer.send('zoom-wheel', delta);
}, { passive: false });

contextBridge.exposeInMainWorld('electronAPI', {
    switchView: (viewKey) => ipcRenderer.send('switch-view', viewKey),
    createView: (toolKey) => ipcRenderer.send('create-new-view', toolKey),
    closeView: (viewKey) => ipcRenderer.send('close-view', viewKey),
    reloadView: (viewKey) => ipcRenderer.send('reload-view', viewKey),
    renameView: (viewKey, newName) => ipcRenderer.send('rename-view', viewKey, newName),
    reorderView: (fromKey, toKey, after) => ipcRenderer.send('reorder-view', fromKey, toKey, after),
    sidebarResize: (width) => ipcRenderer.send('sidebar-resize', width),
    getAutoStart: () => ipcRenderer.sendSync('get-autostart'),
    setAutoStart: (enabled) => ipcRenderer.send('set-autostart', enabled),
    getConfig: () => ipcRenderer.invoke('get-config'),
    setConfig: (patch) => ipcRenderer.invoke('set-config', patch),

    // Full state pushed by the main process (tool list + session list + current active item)
    onStateSync: (cb) => ipcRenderer.on('state-sync', (_e, data) => cb(data)),
    onViewCreated: (cb) => ipcRenderer.on('view-created', (_e, data) => cb(data)),
    onViewClosed: (cb) => ipcRenderer.on('view-closed', (_e, viewKey) => cb(viewKey)),
    onViewSwitched: (cb) => ipcRenderer.on('view-switched', (_e, viewKey) => cb(viewKey)),
    onViewRenamed: (cb) => ipcRenderer.on('view-renamed', (_e, data) => cb(data)),
    onNotification: (cb) => ipcRenderer.on('show-notification', (_e, message) => cb(message)),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    onUpdateInfo: (cb) => ipcRenderer.on('update-info', (_e, info) => cb(info))
});
