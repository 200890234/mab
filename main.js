const { app, BaseWindow, WebContentsView, Menu, ipcMain, shell, session, dialog, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Fixed userData directory, to avoid Electron deriving the path from package.json name/productName.
// Previously name drift (my_ai_browser / Mervyn's AI Browser) caused sessions.json and login state to be lost on restart.
const FIXED_USER_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'MyAIBrowser');
try { app.setPath('userData', FIXED_USER_DATA); } catch (e) { console.error('[init] set userData failed:', e); }

// Unified app name (shown in the menu, without a version suffix)
try { app.setName('MAB'); } catch (e) { console.error('[init] set app name failed:', e); }
const APP_FULL_NAME = "Mervyn's AI Browser";

let sidebarWidth = 220;
const SIDEBAR_MIN_WIDTH = 140;
const SIDEBAR_MAX_WIDTH = 480;

// Proxy config: null means direct connection. Can be overridden via the AI_BROWSER_PROXY env var.
const PROXY_RULES = process.env.AI_BROWSER_PROXY || null;

let mainWindow = null;
let sidebarView = null;

/** @type {Map<string, {view: WebContentsView, toolKey: string, name: string, partition: string}>} */
let views = new Map();
let currentViewKey = null;
let seqCounter = 0;

// Config: defines all AI tools
const AI_TOOLS = {
    gemini: {
        name: 'Gemini',
        url: 'https://gemini.google.com/app',
        icon: 'G',
        logo: 'assets/logos/gemini.png',
        color: '#4285F4',
        needsProxy: true
    },
    deepseek: {
        name: 'DeepSeek',
        url: 'https://chat.deepseek.com',
        icon: 'DS',
        logo: 'assets/logos/deepseek.png',
        color: '#4D6BFE',
        needsProxy: false
    },
    chatgpt: {
        name: 'ChatGPT',
        url: 'https://chat.openai.com',
        icon: 'GPT',
        logo: 'assets/logos/chatgpt.png',
        color: '#10A37F',
        needsProxy: true
    },
    doubao: {
        name: '豆包',
        url: 'https://www.doubao.com',
        icon: '豆',
        color: '#1E9AFF',
        needsProxy: false
    },
    qianwen: {
        name: '千问',
        url: 'https://qianwen.com',
        icon: '千',
        color: '#FF6A00',
        needsProxy: false
    },
    zhipu: {
        name: '智谱清言',
        url: 'https://chatglm.cn',
        icon: '智',
        color: '#4D6BFE',
        needsProxy: false
    },
    claude: {
        name: 'Claude',
        url: 'https://claude.ai',
        icon: 'C',
        color: '#D97757',
        needsProxy: true
    }
};

// Initial default sessions (used only on first launch with no history)
const DEFAULT_SESSIONS = ['gemini', 'gemini', 'deepseek'];

// ---------------- Session persistence ----------------
// Stored in the userData directory alongside partition data, so it is cleaned up together on uninstall.
let _userDataDir = null;
function getUserDataDir() {
    if (!_userDataDir) _userDataDir = app.getPath('userData');
    return _userDataDir;
}
const STATE_FILE = () => path.join(getUserDataDir(), 'sessions.json');
const AUTOSTART_FILE = () => path.join(getUserDataDir(), 'autostart.json');
const CONFIG_FILE = () => path.join(getUserDataDir(), 'config.json');
const STATE_VERSION = 1;

// ---------------- App config (language / theme) persistence ----------------
// Stored in the userData directory alongside login state and sessions.
const DEFAULT_CONFIG = { lang: 'en', theme: 'dark' };
function loadConfig() {
    try {
        const f = CONFIG_FILE();
        if (!fs.existsSync(f)) return { ...DEFAULT_CONFIG };
        const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
        return {
            lang: cfg.lang === 'zh' ? 'zh' : 'en',
            theme: cfg.theme === 'light' ? 'light' : 'dark'
        };
    } catch (e) {
        return { ...DEFAULT_CONFIG };
    }
}
function saveConfig(patch) {
    const cfg = { ...loadConfig(), ...patch };
    try {
        fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg), 'utf8');
    } catch (e) {
        console.error('[config] save failed:', e);
    }
    return cfg;
}
// Active config (read once at startup, may change at runtime)
let appConfig = { ...DEFAULT_CONFIG };
function applyTheme(theme) {
    nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
    // In light mode set the window background to match the sidebar (#ECEFF4) so the system
    // separator line at the bottom of the menu bar blends in and is barely visible.
    // In dark mode keep #1e1e1e to merge with the dark sidebar.
    if (mainWindow && mainWindow.setBackgroundColor) {
        try { mainWindow.setBackgroundColor(theme === 'light' ? '#ECEFF4' : '#1e1e1e'); } catch (e) {}
    }
    // Sync background color of all open content views so theme switching applies immediately
    const bg = theme === 'light' ? '#ECEFF4' : '#1e1e1e';
    views.forEach(entry => {
        try { entry.view.setBackgroundColor(bg); } catch (e) {}
    });
}

// Auto-start preference (separate file, to avoid mixing with sessions)
function getAutoStart() {
    try {
        const f = AUTOSTART_FILE();
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).enabled === true;
    } catch (e) { /* ignore, fall back to default */ }
    return false;
}
function setAutoStart(enabled) {
    const on = !!enabled;
    try {
        fs.writeFileSync(AUTOSTART_FILE(), JSON.stringify({ enabled: on }), 'utf8');
    } catch (e) {
        console.error('[autostart] save preference failed:', e);
    }
    // Note: in dev mode (npm start) app.isPackaged is false, so Windows may ignore this setting;
    // only the packaged exe actually writes the system auto-start entry.
    try {
        app.setLoginItemSettings({ openAtLogin: on, path: app.getPath('exe') });
    } catch (e) {
        console.error('[autostart] setLoginItemSettings failed:', e);
    }
    return on;
}

function loadState() {
    try {
        const file = STATE_FILE();
        if (!fs.existsSync(file)) {
            console.log('[persist] no state file found, using default sessions');
            return null;
        }
        console.log('[persist] state file found:', file);
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!raw || raw.version !== STATE_VERSION || !Array.isArray(raw.sessions)) return null;
        // Drop stale records whose tool was removed, to avoid AI_TOOLS[toolKey] being undefined and crashing
        const sessions = raw.sessions.filter(
            s => s && typeof s.key === 'string'
                && typeof s.partition === 'string'
                && AI_TOOLS[s.toolKey]
        );
        if (sessions.length === 0) return null;
        return {
            sessions,
            activeKey: sessions.some(s => s.key === raw.activeKey) ? raw.activeKey : sessions[0].key,
            seqCounter: Number.isInteger(raw.seqCounter) ? raw.seqCounter : 0,
            windowBounds: raw.windowBounds || null,
            sidebarWidth: Number.isInteger(raw.sidebarWidth) ? raw.sidebarWidth : 220
        };
    } catch (err) {
        console.error('failed to read session state, will use default sessions:', err);
        return null;
    }
}

function saveState() {
    // When the window is destroyed getBounds() throws, so keep the last known size
    let windowBounds = lastWindowBounds;
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            windowBounds = mainWindow.getBounds();
            lastWindowBounds = windowBounds;
        }
    } catch { /* ignore */ }

    const data = {
        version: STATE_VERSION,
        seqCounter,
        activeKey: currentViewKey,
        windowBounds,
        sidebarWidth,
        sessions: [...views].map(([key, entry]) => ({
            key,
            toolKey: entry.toolKey,
            name: entry.name,
            partition: entry.partition,
            // Record the actual current URL so restart returns to the same conversation
            url: getLiveURL(entry)
        }))
    };

    try {
        const file = STATE_FILE();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // Write to a temp file then rename, to avoid a half-written JSON if power is lost mid-exit
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, file);
        console.log('[persist] session state saved:', data.sessions.length, 'tabs ->', file);
    } catch (err) {
        console.error('[persist] failed to save session state:', err);
    }
}

function getLiveURL(entry) {
    try {
        const wc = entry.view.webContents;
        if (wc.isDestroyed()) return entry.lastURL || null;
        const url = wc.getURL();
        // data: error pages are not worth saving; fall back to the tool's home page
        if (!url || url.startsWith('data:')) return null;
        return url;
    } catch {
        return entry.lastURL || null;
    }
}

// Debounced save, to avoid repeated disk writes during frequent navigation
let saveTimer = null;
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 800);
}

let lastWindowBounds = null;
// Flag whether we already saved in the close event, to avoid before-quit overwriting with empty data after the window is destroyed
let savedAtExit = false;

function getContentArea() {
    if (!mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
    // Use contentBounds instead of getSize(); the latter includes window borders and would cause content overflow
    const { width, height } = mainWindow.getContentBounds();
    return {
        x: sidebarWidth,
        y: 0,
        width: Math.max(0, width - sidebarWidth),
        height: Math.max(0, height)
    };
}

function layout() {
    if (!mainWindow) return;
    const { width, height } = mainWindow.getContentBounds();
    if (sidebarView) {
        sidebarView.setBounds({ x: 0, y: 0, width: sidebarWidth, height });
    }
    const area = getContentArea();
    // Only layout the currently visible view; hidden views get correct dimensions when switched to
    const entry = currentViewKey ? views.get(currentViewKey) : null;
    if (entry) entry.view.setBounds(area);
    void width;
}

function buildErrorPage(message) {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,Segoe UI,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1e1e1e;color:#fff}
.error{text-align:center;max-width:520px;padding:24px}
h1{color:#ff6b6b;font-size:20px;margin-bottom:12px}
p{color:#aaa;font-size:13px;line-height:1.6;word-break:break-all}
</style></head><body><div class="error">
<h1>⚠️ Failed to load</h1><p>${String(message || 'Please check your network connection or proxy settings')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
<p style="color:#666;margin-top:16px">Click this session in the sidebar to reload</p>
</div></body></html>`;
    // Must be encoded, otherwise newlines/quotes would truncate the data URL
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createView(tool, partitionName, initialURL) {
    const view = new WebContentsView({
        webPreferences: {
            partition: `persist:${partitionName}`, // key to isolation + persisting login state to disk
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'zoom-preload.js')
        }
    });
    // Content view background follows the theme: light #ECEFF4 / dark #1e1e1e,
    // so the system separator line at the bottom of the menu bar blends in on both sides.
    view.setBackgroundColor(appConfig.theme === 'light' ? '#ECEFF4' : '#1e1e1e');

    const wc = view.webContents;

    // Ctrl+wheel zoom is listened for inside the renderer by zoom-preload.js and reported to the
    // main process via 'zoom-wheel'; this is more reliable than the main process listening to
    // mouse-wheel (unaffected by the page's own wheel handling).
    // Ctrl+0 resets to 100%
    wc.on('before-input-event', (event, input) => {
        if (input.control && input.key === '0') { event.preventDefault(); wc.setZoomLevel(0); }
    });

    // Only set a proxy for sites that need it, so that without a proxy all sites still open
    const proxyPromise = (PROXY_RULES && tool.needsProxy)
        ? wc.session.setProxy({ proxyRules: PROXY_RULES })
            .catch(err => console.error(`代理设置失败 (${partitionName}):`, err))
        : Promise.resolve();

    const target = initialURL || tool.url;

    // Network errors are usually retryable (proxy not ready, brief network drop, user abort, etc.)
    // and should not render an error page directly; only other persistent errors show the error page.
    const RETRIABLE = new Set([-3 /* ABORTED */, -21 /* NETWORK_CHANGED */, -2 /* FAILED */, -105 /* NAME_NOT_RESOLVED */, -106 /* INTERNET_DISCONNECTED */, -118 /* CONNECTION_TIMED_OUT */, -137 /* NAME_RESOLUTION_FAILED */]);
    let retryCount = 0;
    const MAX_RETRY = 3;

    const tryLoad = () => proxyPromise.then(() => wc.loadURL(target)).catch(err => {
        console.error(`load failed (${partitionName}):`, err);
        wc.loadURL(buildErrorPage(err && err.message));
    });

    // First load (after the proxy is ready)
    tryLoad();

    // Record URL changes for saving on exit
    wc.on('did-navigate', () => scheduleSave());
    wc.on('did-navigate-in-page', () => scheduleSave());

    // Handle page navigation failures (main frame only)
    wc.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame) return;
        if (RETRIABLE.has(errorCode) && retryCount < MAX_RETRY) {
            retryCount++;
            console.warn(`session ${partitionName} load interrupted (${errorCode}), retry #${retryCount}…`);
            setTimeout(() => { if (!wc.isDestroyed()) tryLoad(); }, 800 * retryCount);
            return;
        }
        wc.loadURL(buildErrorPage(`${errorDescription} (${errorCode})`));
    });

    // Open external links in the system browser, so popups don't replace the session
    wc.setWindowOpenHandler(({ url }) => {
        if (/^https?:/.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });

    wc.on('page-title-updated', (_e, title) => {
        syncTitle();
        void title;
    });

    // Right-click context menu: back/forward/reload/copy/paste etc.
    attachContextMenu(view);

    return view;
}

function syncTitle() {
    if (!mainWindow || !currentViewKey) return;
    const entry = views.get(currentViewKey);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    // Use the tab name (renamable) as the title core
    const tabName = entry.name || 'Untitled';
    mainWindow.setTitle(`MAB - ${tabName} - ${APP_FULL_NAME}`);
}

function switchView(viewKey) {
    const entry = views.get(viewKey);
    if (!entry || !mainWindow) return false;
    if (currentViewKey === viewKey && entry.view.getVisible()) return true;

    // Hide the other views (keep them mounted so page state is preserved and not replaced)
    for (const [key, item] of views) {
        item.view.setVisible(key === viewKey);
    }

    // Ensure it is mounted and brought to the top
    mainWindow.contentView.addChildView(entry.view);
    entry.view.setBounds(getContentArea());

    currentViewKey = viewKey;
    syncTitle();
    notifyRenderer('view-switched', viewKey);
    return true;
}

function notifyRenderer(channel, payload) {
    if (sidebarView && !sidebarView.webContents.isDestroyed()) {
        sidebarView.webContents.send(channel, payload);
    }
}

// The webContents of the currently active view (target of menu actions)
function getActiveWebContents() {
    if (!currentViewKey) return null;
    const entry = views.get(currentViewKey);
    if (!entry || entry.view.webContents.isDestroyed()) return null;
    return entry.view.webContents;
}

// Update check state
let updateAvailable = false;
let latestVersion = '';

function compareVersions(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}

function checkForUpdate() {
    const current = app.getVersion();
    fetch('https://api.github.com/repos/200890234/mab/releases/latest', {
        headers: { 'User-Agent': 'mab-updater' }
    }).then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }).then(data => {
        const tag = (data.tag_name || '').replace(/^v/, '');
        if (!tag) return;
        const newer = compareVersions(tag, current) > 0;
        if (newer !== updateAvailable || tag !== latestVersion) {
            updateAvailable = newer;
            latestVersion = tag;
            buildAppMenu();
        }
    }).catch(err => console.error('[update] check failed:', err));
}

// Top application menu text (switches with language)
const MENU_I18N = {
    en: {
        update: (v) => `Update available ↓ (v${v})`,
        file: 'File',
        newSession: 'New Session',
        quit: 'Quit',
        view: 'View',
        back: 'Back',
        forward: 'Forward',
        reload: 'Reload',
        forceReload: 'Force Reload',
        resetZoom: 'Reset Zoom',
        zoomIn: 'Zoom In',
        zoomOut: 'Zoom Out',
        help: 'Help',
        openDevTools: 'Open DevTools',
        about: 'About'
    },
    zh: {
        update: (v) => `有更新 ↓ (v${v})`,
        file: '文件',
        newSession: '新建会话',
        quit: '退出',
        view: '视图',
        back: '后退',
        forward: '前进',
        reload: '重新加载',
        forceReload: '强制重新加载',
        resetZoom: '重置缩放',
        zoomIn: '放大',
        zoomOut: '缩小',
        help: '帮助',
        openDevTools: '打开开发者工具',
        about: '关于'
    }
};
function menuT() {
    return MENU_I18N[appConfig.lang === 'zh' ? 'zh' : 'en'];
}

// Top application menu
function buildAppMenu() {
    const m = menuT();
    const template = [];

    // When an update exists, show the hint at the very top level (not hidden in a submenu)
    if (updateAvailable) {
        template.push({
            label: m.update(latestVersion),
            click: () => shell.openExternal('https://github.com/200890234/mab/releases/latest')
        });
    }

    template.push({
        label: m.file,
        submenu: [
            {
                label: m.newSession,
                submenu: Object.entries(AI_TOOLS).map(([key, tool]) => ({
                    label: `${tool.icon} ${tool.name}`,
                    click: () => addSession(key)
                }))
            },
            { type: 'separator' },
            { role: 'quit', label: m.quit }
        ]
    });

    template.push({
        label: m.view,
        submenu: [
            {
                label: m.back,
                accelerator: 'CmdOrCtrl+Left',
                click: () => { const wc = getActiveWebContents(); if (wc && wc.canGoBack()) wc.goBack(); }
            },
            {
                label: m.forward,
                accelerator: 'CmdOrCtrl+Right',
                click: () => { const wc = getActiveWebContents(); if (wc && wc.canGoForward()) wc.goForward(); }
            },
            {
                label: m.reload,
                accelerator: 'F5',
                click: () => { const wc = getActiveWebContents(); if (wc) wc.reload(); }
            },
            {
                label: m.forceReload,
                accelerator: 'Ctrl+F5',
                click: () => { const wc = getActiveWebContents(); if (wc) wc.reloadIgnoringCache(); }
            },
            { type: 'separator' },
            { role: 'resetZoom', label: m.resetZoom, accelerator: 'CommandOrControl+0' },
            { role: 'zoomIn', label: m.zoomIn, accelerator: 'CommandOrControl+=' },
            { role: 'zoomOut', label: m.zoomOut, accelerator: 'CommandOrControl+-' }
        ]
    });

    template.push({
        label: m.help,
        submenu: [
            {
                label: m.openDevTools,
                accelerator: 'F12',
                click: () => { const wc = getActiveWebContents(); if (wc) wc.toggleDevTools(); }
            },
            {
                label: m.about,
                click: () => {
                    const isZh = appConfig.lang === 'zh';
                    const version = app.getVersion();
                    const ico = (() => {
                        const png = path.join(__dirname, 'assets', 'icon.png');
                        return fs.existsSync(png) ? png : undefined;
                    })();
                    dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: isZh ? '关于 MAB' : 'About MAB',
                        message: isZh ? 'Mervyn 的 AI 浏览器' : "Mervyn's AI Browser",
                        detail: isZh
                            ? `版本 ${version}\n\n基于 Electron 构建的多会话 AI 浏览器，可并排打开 Gemini、DeepSeek、ChatGPT、豆包、千问、智谱清言、Claude 等，每个会话相互独立并保留登录态。\n\n© 2026 Mervyn`
                            : `Version ${version}\n\nA multi-session AI browser built with Electron. Open Gemini, DeepSeek, ChatGPT, Doubao, Qwen, Zhipu AI, and Claude side by side in isolated, persistent sessions.\n\n© 2026 Mervyn`,
                        buttons: [isZh ? '确定' : 'OK'],
                        icon: ico,
                        noLink: true
                    });
                }
            }
        ]
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Right-click context menu (bound to a specific WebContentsView)
function attachContextMenu(view) {
    const wc = view.webContents;

    wc.on('context-menu', (_e, params) => {
        const menu = Menu.buildFromTemplate([
            {
                label: 'Back',
                enabled: wc.canGoBack(),
                click: () => wc.canGoBack() && wc.goBack()
            },
            {
                label: 'Forward',
                enabled: wc.canGoForward(),
                click: () => wc.canGoForward() && wc.goForward()
            },
            {
                label: 'Reload',
                click: () => wc.reload()
            },
            { type: 'separator' },
            { role: 'copy', enabled: params.editFlags.canCopy, label: 'Copy' },
            { role: 'paste', enabled: params.editFlags.canPaste, label: 'Paste' },
            { role: 'cut', enabled: params.editFlags.canCut, label: 'Cut' },
            { role: 'selectAll', label: 'Select All' },
            { type: 'separator' },
            {
                label: 'Open DevTools Here',
                click: () => wc.toggleDevTools()
            },
            { type: 'separator' },
            {
                label: appConfig.lang === 'zh' ? '复制页面地址' : 'Copy page URL',
                click: () => { try { clipboard.writeText(wc.getURL()); } catch (e) {} }
            }
        ]);
        menu.popup();
    });
}

function serializeView(key, entry) {
    const tool = AI_TOOLS[entry.toolKey];
    return {
        key,
        toolKey: entry.toolKey,
        name: entry.name,
        icon: tool.icon,
        logo: tool.logo || null,
        color: tool.color
    };
}

// Rename a session tab (only changes the display name; does not affect partition/login state)
function renameSession(viewKey, newName) {
    const entry = views.get(viewKey);
    if (!entry) return;
    const trimmed = String(newName || '').trim();
    if (!trimmed) return;
    entry.name = trimmed;
    notifyRenderer('view-renamed', { key: viewKey, name: trimmed });
    if (viewKey === currentViewKey) syncTitle();
    scheduleSave();
}

function reorderView(fromKey, toKey, after = false) {
    if (fromKey === toKey) return;
    if (!views.has(fromKey) || !views.has(toKey)) return;
    if (views.get(fromKey).toolKey !== views.get(toKey).toolKey) return; // only allow reordering within the same group
    const entry = views.get(fromKey);
    views.delete(fromKey);
    const newMap = new Map();
    for (const [k, v] of views) {
        if (k === toKey) {
            if (after) {
                // Insert after toKey: put toKey first, then fromKey
                newMap.set(k, v);
                newMap.set(fromKey, entry);
            } else {
                // Insert before toKey: put fromKey first, then toKey
                newMap.set(fromKey, entry);
                newMap.set(k, v);
            }
        } else {
            newMap.set(k, v);
        }
    }
    // Fallback (should not trigger in practice)
    if (!newMap.has(fromKey)) newMap.set(fromKey, entry);
    views = newMap;
    scheduleSave();
    notifyRenderer('state-sync', {
        tools: Object.fromEntries(
            Object.entries(AI_TOOLS).map(([k, t]) => [k, { name: t.name, icon: t.icon, color: t.color, logo: t.logo || null }])
        ),
        views: [...views].map(([key, e]) => serializeView(key, e)),
        activeKey: currentViewKey
    });
}

function addSession(toolKey, { notify = true, activate = true, restore = null } = {}) {
    const tool = AI_TOOLS[toolKey];
    if (!tool || !mainWindow) return null;

    let viewKey, partitionName, name;

    if (restore) {
        // On restore, must reuse the original key and partition, otherwise saved login state can't be read
        viewKey = restore.key;
        partitionName = restore.partition;
        name = restore.name || tool.name;
        if (views.has(viewKey)) return null; // prevent duplicate restore
    } else {
        // Globally incrementing sequence; keys are never reused, to avoid overwriting existing views
        seqCounter += 1;
        viewKey = `${toolKey}-${seqCounter}`;
        // The same AI tool shares one partition, so login state is reused across new tabs (no re-login)
        partitionName = `${toolKey}_account`;
        let ordinal = 1;
        for (const entry of views.values()) {
            if (entry.toolKey === toolKey) ordinal += 1;
        }
        name = `${tool.name} #${ordinal}`;
    }

    const view = createView(tool, partitionName, restore && restore.url);

    // Diagnostics: on restore, print the number of saved cookies for this partition to confirm login state persistence
    if (restore) {
        const sess = session.fromPartition(partitionName);
        sess.cookies.get({}).then(cookies => {
            console.log(`[persist] restore ${toolKey} (${partitionName}): found ${cookies.length} cookies, url=${restore.url}`);
        }).catch(() => {});
    }
    const entry = {
        view,
        toolKey,
        name,
        partition: partitionName,
        lastURL: (restore && restore.url) || tool.url
    };
    views.set(viewKey, entry);

    mainWindow.contentView.addChildView(view);
    view.setBounds(getContentArea());
    view.setVisible(false);

    if (notify) notifyRenderer('view-created', serializeView(viewKey, entry));
    if (activate) switchView(viewKey);
    scheduleSave();
    return viewKey;
}

function destroyView(entry) {
    try {
        const wc = entry.view.webContents;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.contentView.removeChildView(entry.view);
        }
        // WebContentsView has no destroy(); closing its webContents is enough to release it
        if (!wc.isDestroyed()) wc.close();
    } catch (err) {
        console.error('failed to destroy view:', err);
    }
}

function closeSession(viewKey) {
    if (views.size <= 1) {
        notifyRenderer('show-notification', 'Keep at least one session open');
        return;
    }
    const entry = views.get(viewKey);
    if (!entry) return;

    const toolName = (AI_TOOLS[entry.toolKey] && AI_TOOLS[entry.toolKey].name) || entry.toolKey;
    const zh = appConfig.lang === 'zh';
    const response = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: zh ? ['关闭', '取消'] : ['Close', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: zh ? '关闭会话' : 'Close session',
        message: zh ? `关闭“${entry.name || toolName}”？` : `Close "${entry.name || toolName}"?`,
        detail: zh
            ? '会话标签页将被移除。登录状态会保留，重新打开同一 AI 工具即可恢复。'
            : 'The session tab will be removed. Login state is kept and can be restored by reopening the same AI tool.',
    });
    // showMessageBoxSync returns a button index (number); Cancel is 1, selecting it aborts the close
    if (response === 1) return;

    // Note: actively closing a tab no longer clears login state; login data is auto-persisted by the
    // persist: partition. Reopening the same AI tool (same partition) keeps the login state. To fully
    // clear an account's data, the user must trigger it explicitly.
    destroyView(entry);
    views.delete(viewKey);

    if (currentViewKey === viewKey) {
        currentViewKey = null;
        const nextKey = views.keys().next().value;
        if (nextKey) switchView(nextKey);
    }
    notifyRenderer('view-closed', viewKey);
    scheduleSave();
}

function clearPartitionData(partitionName) {
    try {
        const ses = session.fromPartition(`persist:${partitionName}`);
        ses.clearStorageData().catch(err => console.error('failed to clear session data:', err));
    } catch (err) {
        console.error('failed to clear session data:', err);
    }
}

// Clean up the legacy _session_N partitions left over from before the upgrade (login state is now
// unified under ${toolKey}_account). These directories are obsolete and waste disk space; safe to
// delete at startup.
function cleanupLegacyPartitions() {
    try {
        const all = session.getAllPaths ? session.getAllPaths() : {};
        for (const [partition, dir] of Object.entries(all)) {
            if (partition.includes('_session_')) {
                try {
                    fs.rmSync(dir, { recursive: true, force: true });
                    console.log(`[cleanup] deleted obsolete partition: ${partition}`);
                } catch (e) {
                    console.error(`[cleanup] failed to delete ${partition}:`, e);
                }
            }
        }
    } catch (e) {
        console.error('[cleanup] failed to enumerate partitions:', e);
    }
}

function createWindow() {
    // Apply saved language / theme (app is ready, safe to read userData)
    appConfig = loadConfig();
    applyTheme(appConfig.theme);

    const saved = loadState();
    const bounds = saved && saved.windowBounds;
    if (saved && Number.isInteger(saved.sidebarWidth)) {
        sidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, saved.sidebarWidth));
    }

    mainWindow = new BaseWindow({
        width: (bounds && bounds.width) || 1400,
        height: (bounds && bounds.height) || 900,
        ...(bounds && Number.isInteger(bounds.x) ? { x: bounds.x, y: bounds.y } : {}),
        minWidth: 800,
        minHeight: 600,
        title: `MAB - ${APP_FULL_NAME}`,
        backgroundColor: '#1e1e1e',   // same as v1.0.0: opaque background to avoid the system separator line at the bottom of the menu bar
        icon: (() => {
            const ico = path.join(__dirname, 'assets', 'icon.ico');
            const png = path.join(__dirname, 'assets', 'icon.png');
            return fs.existsSync(ico) ? ico : (fs.existsSync(png) ? png : undefined);
        })()
    });
    lastWindowBounds = mainWindow.getBounds();

    // Clean up obsolete partitions left over from before the upgrade
    cleanupLegacyPartitions();

    // Apply saved auto-start preference
    try { setAutoStart(getAutoStart()); } catch (e) { console.error('[autostart] apply preference failed:', e); }

    // Build the top menu (back/forward/reload/zoom etc.)
    buildAppMenu();
    // Check for updates after launch (shows a hint in the top-level menu when an update is available)
    checkForUpdate();

    // Sidebar as a WebContentsView
    sidebarView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.contentView.addChildView(sidebarView);
    sidebarView.webContents.loadFile(path.join(__dirname, 'index.html'));

    // Ctrl+wheel zoom: zoom-preload.js listens inside the renderer and notifies the main process via
    // this channel. e.sender is the content view's webContents that initiated the wheel; setZoomLevel on it.
    ipcMain.on('zoom-wheel', (e, delta) => {
        const wc = e.sender;
        if (!wc || wc.isDestroyed()) return;
        const lvl = wc.getZoomLevel(); // synchronous return value (number)
        wc.setZoomLevel(lvl + delta);
    });

    mainWindow.on('resize', () => { layout(); scheduleSave(); });
    mainWindow.on('move', scheduleSave);
    mainWindow.on('maximize', layout);
    mainWindow.on('unmaximize', layout);
    // Save while the window is still alive, so we can read the real bounds and page URL
    mainWindow.on('close', () => {
        // Window is still alive here, so we can read the real bounds and page URL
        clearTimeout(saveTimer);
        saveState();
        savedAtExit = true;
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
        sidebarView = null;
        views.clear();
        currentViewKey = null;
    });

    // Wait until the sidebar is ready before creating sessions, so the UI can receive events
    sidebarView.webContents.once('did-finish-load', () => {
        layout();
        if (views.size === 0) {
            if (saved) {
                // Restore last tabs; seqCounter must be restored first to avoid new sessions colliding with old keys
                seqCounter = saved.seqCounter;
                for (const s of saved.sessions) {
                    addSession(s.toolKey, { notify: false, activate: false, restore: s });
                }
                // Fallback: if all restores fail, fall back to default sessions
                if (views.size === 0) {
                    DEFAULT_SESSIONS.forEach(k => addSession(k, { notify: false, activate: false }));
                }
                const target = views.has(saved.activeKey)
                    ? saved.activeKey
                    : views.keys().next().value;
                if (target) switchView(target);
            } else {
                DEFAULT_SESSIONS.forEach(k => addSession(k, { notify: false, activate: false }));
                const firstKey = views.keys().next().value;
                if (firstKey) switchView(firstKey);
            }
        }
        // Push the full state to the renderer in one shot
        notifyRenderer('state-sync', {
            tools: Object.fromEntries(
                Object.entries(AI_TOOLS).map(([k, t]) => [k, { name: t.name, icon: t.icon, color: t.color, logo: t.logo || null }])
            ),
            views: [...views].map(([key, entry]) => serializeView(key, entry)),
            activeKey: currentViewKey
        });
    });

    layout();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (!mainWindow) createWindow();
    });
});

// IPC communication
ipcMain.on('switch-view', (_event, viewKey) => switchView(viewKey));
ipcMain.on('create-new-view', (_event, toolKey) => addSession(toolKey));
ipcMain.on('close-view', (_event, viewKey) => closeSession(viewKey));
ipcMain.on('rename-view', (_event, viewKey, newName) => renameSession(viewKey, newName));
ipcMain.on('reorder-view', (_event, fromKey, toKey, after) => reorderView(fromKey, toKey, !!after));
ipcMain.on('sidebar-resize', (_event, width) => {
    const w = Math.round(Number(width) || sidebarWidth);
    sidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w));
    layout();
    scheduleSave();
});
ipcMain.on('get-autostart', (event) => {
    event.returnValue = getAutoStart();
});
ipcMain.on('set-autostart', (_event, enabled) => {
    setAutoStart(enabled);
});
// Language / theme config
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('set-config', async (_event, patch) => {
    const cfg = saveConfig(patch || {});
    const langChanged = patch && appConfig.lang !== cfg.lang;
    appConfig = cfg;
    if (patch && patch.theme) applyTheme(cfg.theme);
    if (langChanged) buildAppMenu(); // rebuild the top menu when language changes
    return cfg;
});
ipcMain.on('reload-view', (_event, viewKey) => {
    const entry = views.get(viewKey);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    const tool = AI_TOOLS[entry.toolKey];
    // Error pages can't reload back to the original site, so directly reload the target URL
    entry.view.webContents.loadURL(tool.url).catch(err => console.error('reload failed:', err));
});

app.on('before-quit', () => {
    // The close event already saved the full state (window still alive then). If before-quit fires
    // after closed, views is already cleared, and calling saveState() would overwrite the file with
    // empty data, losing all tabs on next restart. So only save as a fallback when not yet saved.
    clearTimeout(saveTimer);
    if (!savedAtExit) {
        console.log('[persist] before-quit fallback save (views=' + views.size + ')');
        saveState();
    } else {
        console.log('[persist] before-quit: already saved by close, skip overwrite');
    }
    for (const entry of views.values()) destroyView(entry);
    views.clear();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
