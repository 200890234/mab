const { contextBridge, ipcRenderer } = require('electron');

// Ctrl+滚轮缩放（侧边栏自身也需要）：交给主进程统一处理
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

    // 主进程推送的完整状态（工具列表 + 会话列表 + 当前激活项）
    onStateSync: (cb) => ipcRenderer.on('state-sync', (_e, data) => cb(data)),
    onViewCreated: (cb) => ipcRenderer.on('view-created', (_e, data) => cb(data)),
    onViewClosed: (cb) => ipcRenderer.on('view-closed', (_e, viewKey) => cb(viewKey)),
    onViewSwitched: (cb) => ipcRenderer.on('view-switched', (_e, viewKey) => cb(viewKey)),
    onViewRenamed: (cb) => ipcRenderer.on('view-renamed', (_e, data) => cb(data)),
    onNotification: (cb) => ipcRenderer.on('show-notification', (_e, message) => cb(message))
});
