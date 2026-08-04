// Lightweight preload script injected only into content views (WebContentsView).
// Purpose: listen for Ctrl+wheel inside the renderer and notify the main process to zoom via IPC.
// This is more reliable than the main process listening to mouse-wheel (unaffected by the page's own wheel handling).
const { ipcRenderer } = require('electron');

window.addEventListener('wheel', (e) => {
    // Only take over when Ctrl is held; otherwise let the page scroll normally
    if (!e.ctrlKey) return;
    // Prevent Chromium's native Ctrl+wheel zoom (avoid double-zoom stacking with our manual setting)
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1; // scroll up = zoom in, scroll down = zoom out
    ipcRenderer.send('zoom-wheel', delta);
}, { passive: false });
