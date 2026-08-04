// 仅注入到内容视图（WebContentsView）的轻量预加载脚本。
// 作用：在渲染进程内监听 Ctrl+鼠标滚轮，通过 IPC 通知主进程缩放，
// 比主进程监听 mouse-wheel 事件更可靠（不受网页自身处理 wheel 的影响）。
const { ipcRenderer } = require('electron');

window.addEventListener('wheel', (e) => {
    // 仅当按下 Ctrl 时才接管，否则让网页正常滚动
    if (!e.ctrlKey) return;
    // 阻止 Chromium 原生 Ctrl+滚轮缩放（避免与我们手动设置叠加成双重缩放）
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1; // 上滚放大，下滚缩小
    ipcRenderer.send('zoom-wheel', delta);
}, { passive: false });
