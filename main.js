const { app, BaseWindow, WebContentsView, Menu, ipcMain, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 固定 userData 目录，避免 Electron 依据 package.json 的 name/productName 推导路径。
// 之前曾因名称漂移（my_ai_browser / Mervyn's AI Browser）导致 sessions.json 与登录态找不到、重启清零。
const FIXED_USER_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'MyAIBrowser');
try { app.setPath('userData', FIXED_USER_DATA); } catch (e) { console.error('[init] 设置 userData 失败:', e); }

// 统一应用名（菜单中显示的名称，避免带版本号）
try { app.setName('MAB'); } catch (e) { console.error('[init] 设置应用名失败:', e); }
const APP_FULL_NAME = "Mervyn's AI Browser";

let sidebarWidth = 220;
const SIDEBAR_MIN_WIDTH = 140;
const SIDEBAR_MAX_WIDTH = 480;

// 代理配置：设为 null 表示直连。可通过环境变量 AI_BROWSER_PROXY 覆盖。
const PROXY_RULES = process.env.AI_BROWSER_PROXY || null;

let mainWindow = null;
let sidebarView = null;

/** @type {Map<string, {view: WebContentsView, toolKey: string, name: string, partition: string}>} */
const views = new Map();
let currentViewKey = null;
let seqCounter = 0;

// 配置文件：定义所有AI工具
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
        url: 'https://www.qianwenai.com',
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

// 初始默认会话（仅首次启动、无历史记录时使用）
const DEFAULT_SESSIONS = ['gemini', 'gemini', 'deepseek'];

// ---------------- 会话持久化 ----------------
// 存到 userData 目录，与 partition 数据同级，卸载/清理时一起走
let _userDataDir = null;
function getUserDataDir() {
    if (!_userDataDir) _userDataDir = app.getPath('userData');
    return _userDataDir;
}
const STATE_FILE = () => path.join(getUserDataDir(), 'sessions.json');
const AUTOSTART_FILE = () => path.join(getUserDataDir(), 'autostart.json');
const STATE_VERSION = 1;

// 开机自启动偏好（独立文件，避免与 sessions 混在一起）
function getAutoStart() {
    try {
        const f = AUTOSTART_FILE();
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).enabled === true;
    } catch (e) { /* 忽略，回退默认 */ }
    return false;
}
function setAutoStart(enabled) {
    const on = !!enabled;
    try {
        fs.writeFileSync(AUTOSTART_FILE(), JSON.stringify({ enabled: on }), 'utf8');
    } catch (e) {
        console.error('[autostart] 保存偏好失败:', e);
    }
    // 注意：开发模式 (npm start) 下 app.isPackaged 为 false，Windows 上设置可能被忽略；
    // 打包后的 exe 才会真正写入系统开机启动项。
    try {
        app.setLoginItemSettings({ openAtLogin: on, path: app.getPath('exe') });
    } catch (e) {
        console.error('[autostart] setLoginItemSettings 失败:', e);
    }
    return on;
}

function loadState() {
    try {
        const file = STATE_FILE();
        if (!fs.existsSync(file)) {
            console.log('[persist] 未找到状态文件，使用默认会话');
            return null;
        }
        console.log('[persist] 发现状态文件:', file);
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!raw || raw.version !== STATE_VERSION || !Array.isArray(raw.sessions)) return null;
        // 过滤掉工具已被移除的旧记录，避免 AI_TOOLS[toolKey] 为 undefined 而崩溃
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
        console.error('读取会话状态失败，将使用默认会话:', err);
        return null;
    }
}

function saveState() {
    // 窗口已销毁时 getBounds() 会抛错，此时保留上一次的窗口尺寸
    let windowBounds = lastWindowBounds;
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            windowBounds = mainWindow.getBounds();
            lastWindowBounds = windowBounds;
        }
    } catch { /* 忽略 */ }

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
            // 记录当前实际地址，重启后回到原来那个对话
            url: getLiveURL(entry)
        }))
    };

    try {
        const file = STATE_FILE();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // 先写临时文件再改名，避免退出中途断电写出半个 JSON
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, file);
        console.log('[persist] 已保存会话状态:', data.sessions.length, '个标签页 ->', file);
    } catch (err) {
        console.error('[persist] 保存会话状态失败:', err);
    }
}

function getLiveURL(entry) {
    try {
        const wc = entry.view.webContents;
        if (wc.isDestroyed()) return entry.lastURL || null;
        const url = wc.getURL();
        // data: 错误页不值得保存，回退到工具首页
        if (!url || url.startsWith('data:')) return null;
        return url;
    } catch {
        return entry.lastURL || null;
    }
}

// 防抖保存，避免频繁导航时反复写盘
let saveTimer = null;
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 800);
}

let lastWindowBounds = null;
// 标记是否在 close 事件中已保存过，避免 before-quit 在窗口销毁后用空数据覆盖
let savedAtExit = false;

function getContentArea() {
    if (!mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
    // 使用 contentBounds 而非 getSize()，后者含窗口边框会导致内容溢出
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
    // 仅布局当前显示的视图，隐藏视图在切换时再赋予正确尺寸
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
    // 必须编码，否则换行/引号会截断 data URL
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createView(tool, partitionName, initialURL) {
    const view = new WebContentsView({
        webPreferences: {
            partition: `persist:${partitionName}`, // 隔离 + 登录态落盘的关键
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    const wc = view.webContents;

    // 仅对需要代理的站点设置代理，避免无代理时全部站点打不开
    const proxyPromise = (PROXY_RULES && tool.needsProxy)
        ? wc.session.setProxy({ proxyRules: PROXY_RULES })
            .catch(err => console.error(`代理设置失败 (${partitionName}):`, err))
        : Promise.resolve();

    const target = initialURL || tool.url;

    // 网络类错误通常可重试（代理未就绪、网络瞬断、用户主动中断等），
    // 不应直接渲染错误页；其它持续性错误才展示错误页。
    const RETRIABLE = new Set([-3 /* ABORTED */, -21 /* NETWORK_CHANGED */, -2 /* FAILED */, -105 /* NAME_NOT_RESOLVED */, -106 /* INTERNET_DISCONNECTED */, -118 /* CONNECTION_TIMED_OUT */, -137 /* NAME_RESOLUTION_FAILED */]);
    let retryCount = 0;
    const MAX_RETRY = 3;

    const tryLoad = () => proxyPromise.then(() => wc.loadURL(target)).catch(err => {
        console.error(`加载失败 (${partitionName}):`, err);
        wc.loadURL(buildErrorPage(err && err.message));
    });

    // 首次加载（代理就绪后再发起）
    tryLoad();

    // 记录地址变化，供退出时保存
    wc.on('did-navigate', () => scheduleSave());
    wc.on('did-navigate-in-page', () => scheduleSave());

    // 页面导航失败时处理（仅主框架）
    wc.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame) return;
        if (RETRIABLE.has(errorCode) && retryCount < MAX_RETRY) {
            retryCount++;
            console.warn(`会话 ${partitionName} 加载被中断(${errorCode})，第 ${retryCount} 次重试…`);
            setTimeout(() => { if (!wc.isDestroyed()) tryLoad(); }, 800 * retryCount);
            return;
        }
        wc.loadURL(buildErrorPage(`${errorDescription} (${errorCode})`));
    });

    // 外部链接用系统浏览器打开，避免弹窗把会话顶掉
    wc.setWindowOpenHandler(({ url }) => {
        if (/^https?:/.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });

    wc.on('page-title-updated', (_e, title) => {
        syncTitle();
        void title;
    });

    // 右键菜单：后退/前进/刷新/复制粘贴等
    attachContextMenu(view);

    return view;
}

function syncTitle() {
    if (!mainWindow || !currentViewKey) return;
    const entry = views.get(currentViewKey);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    // 用标签页名称（可重命名）作为标题核心
    const tabName = entry.name || 'Untitled';
    mainWindow.setTitle(`MAB - ${tabName} - ${APP_FULL_NAME}`);
}

function switchView(viewKey) {
    const entry = views.get(viewKey);
    if (!entry || !mainWindow) return false;
    if (currentViewKey === viewKey && entry.view.getVisible()) return true;

    // 隐藏其余视图（保持挂载，从而保留页面状态、不被替换）
    for (const [key, item] of views) {
        item.view.setVisible(key === viewKey);
    }

    // 确保已挂载并置于最上层
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

// 当前激活视图的 webContents（菜单操作目标）
function getActiveWebContents() {
    if (!currentViewKey) return null;
    const entry = views.get(currentViewKey);
    if (!entry || entry.view.webContents.isDestroyed()) return null;
    return entry.view.webContents;
}

// 更新检查状态
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
    }).catch(err => console.error('[update] 检查失败:', err));
}

// 顶部应用菜单
function buildAppMenu() {
    const template = [];

    // 有更新时，在最顶层直接显示提示（不隐藏到子菜单）
    if (updateAvailable) {
        template.push({
            label: `Update available ↓ (v${latestVersion})`,
            click: () => shell.openExternal('https://github.com/200890234/mab/releases/latest')
        });
    }

    template.push({
        label: 'File',
            submenu: [
                {
                    label: 'New Session',
                    submenu: Object.entries(AI_TOOLS).map(([key, tool]) => ({
                        label: `${tool.icon} ${tool.name}`,
                        click: () => addSession(key)
                    }))
                },
                { type: 'separator' },
                { role: 'quit', label: 'Quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Back',
                    accelerator: 'CmdOrCtrl+Left',
                    click: () => { const wc = getActiveWebContents(); if (wc && wc.canGoBack()) wc.goBack(); }
                },
                {
                    label: 'Forward',
                    accelerator: 'CmdOrCtrl+Right',
                    click: () => { const wc = getActiveWebContents(); if (wc && wc.canGoForward()) wc.goForward(); }
                },
                {
                    label: 'Reload',
                    accelerator: 'F5',
                    click: () => { const wc = getActiveWebContents(); if (wc) wc.reload(); }
                },
                {
                    label: 'Force Reload',
                    accelerator: 'Ctrl+F5',
                    click: () => { const wc = getActiveWebContents(); if (wc) wc.reloadIgnoringCache(); }
                },
                { type: 'separator' },
                { role: 'resetZoom', label: 'Reset Zoom' },
                { role: 'zoomIn', label: 'Zoom In' },
                { role: 'zoomOut', label: 'Zoom Out' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Open DevTools',
                    accelerator: 'F12',
                    click: () => { const wc = getActiveWebContents(); if (wc) wc.toggleDevTools(); }
                },
                {
                    label: 'About',
                    click: () => {
                        if (sidebarView && !sidebarView.webContents.isDestroyed()) {
                            sidebarView.webContents.send('show-notification', "MAB - Mervyn's AI Browser");
                        }
                    }
                }
            ]
        }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 右键上下文菜单（绑定到某个 WebContentsView）
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

// 重命名会话标签（仅改显示名，不影响 partition/登录态）
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

function addSession(toolKey, { notify = true, activate = true, restore = null } = {}) {
    const tool = AI_TOOLS[toolKey];
    if (!tool || !mainWindow) return null;

    let viewKey, partitionName, name;

    if (restore) {
        // 恢复时必须沿用原 key 与 partition，否则会读不到已保存的登录态
        viewKey = restore.key;
        partitionName = restore.partition;
        name = restore.name || tool.name;
        if (views.has(viewKey)) return null; // 防重复恢复
    } else {
        // 全局自增序号，key 永不复用，避免覆盖已有视图
        seqCounter += 1;
        viewKey = `${toolKey}-${seqCounter}`;
        // 同一 AI 工具共享一个 partition，使已登录态在新建标签页间复用（免登录）
        partitionName = `${toolKey}_account`;
        let ordinal = 1;
        for (const entry of views.values()) {
            if (entry.toolKey === toolKey) ordinal += 1;
        }
        name = `${tool.name} #${ordinal}`;
    }

    const view = createView(tool, partitionName, restore && restore.url);

    // 诊断：恢复时打印该 partition 已保存的 cookie 数量，确认登录态是否持久化
    if (restore) {
        const sess = session.fromPartition(partitionName);
        sess.cookies.get({}).then(cookies => {
            console.log(`[persist] 恢复 ${toolKey} (${partitionName}): 发现 ${cookies.length} 个 cookie, url=${restore.url}`);
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
        // WebContentsView 没有 destroy()，销毁其 webContents 即可释放
        if (!wc.isDestroyed()) wc.close();
    } catch (err) {
        console.error('销毁视图失败:', err);
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
    const { response } = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['Close', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Close session',
        message: `Close "${entry.name || toolName}"?`,
        detail: 'The session tab will be removed. Login state is kept and can be restored by reopening the same AI tool.',
    });
    if (response === 1) return;

    // 注意：主动关闭标签不再清除登录态，登录数据由 persist: partition 自动落盘，
    // 关闭后再新建（同一 partition）可保持登录态；如需彻底清除某账号数据，由用户显式触发。
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
        ses.clearStorageData().catch(err => console.error('清除会话数据失败:', err));
    } catch (err) {
        console.error('清除会话数据失败:', err);
    }
}

// 清理升级前遗留的 _session_N 旧 partition（登录态现已统一到 ${toolKey}_account）。
// 这些目录已废弃且占用磁盘，启动时安全删除。
function cleanupLegacyPartitions() {
    try {
        const all = session.getAllPaths ? session.getAllPaths() : {};
        for (const [partition, dir] of Object.entries(all)) {
            if (partition.includes('_session_')) {
                try {
                    fs.rmSync(dir, { recursive: true, force: true });
                    console.log(`[cleanup] 已删除废弃 partition: ${partition}`);
                } catch (e) {
                    console.error(`[cleanup] 删除 ${partition} 失败:`, e);
                }
            }
        }
    } catch (e) {
        console.error('[cleanup] 枚举 partition 失败:', e);
    }
}

function createWindow() {
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
        backgroundColor: '#1e1e1e',
        icon: (() => {
            const ico = path.join(__dirname, 'assets', 'icon.ico');
            const png = path.join(__dirname, 'assets', 'icon.png');
            return fs.existsSync(ico) ? ico : (fs.existsSync(png) ? png : undefined);
        })()
    });
    lastWindowBounds = mainWindow.getBounds();

    // 清理升级前遗留的废弃 partition
    cleanupLegacyPartitions();

    // 应用已保存的开机自启动偏好
    try { setAutoStart(getAutoStart()); } catch (e) { console.error('[autostart] 应用偏好失败:', e); }

    // 构建顶部菜单（后退/前进/刷新/缩放等）
    buildAppMenu();
    // 启动后检查更新（有更新时会在顶层菜单显示提示）
    checkForUpdate();

    // 侧边栏作为一个 WebContentsView
    sidebarView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.contentView.addChildView(sidebarView);
    sidebarView.webContents.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('resize', () => { layout(); scheduleSave(); });
    mainWindow.on('move', scheduleSave);
    mainWindow.on('maximize', layout);
    mainWindow.on('unmaximize', layout);
    // 关闭前窗口还活着，此时保存才能拿到真实的 bounds 和页面 URL
    mainWindow.on('close', () => {
        // 窗口还活着，此时保存才能拿到真实 bounds 和页面 URL
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

    // 等侧边栏就绪后再创建会话，确保 UI 能收到事件
    sidebarView.webContents.once('did-finish-load', () => {
        layout();
        if (views.size === 0) {
            if (saved) {
                // 恢复上次的标签页；seqCounter 必须先还原，防止新建会话与旧 key 冲突
                seqCounter = saved.seqCounter;
                for (const s of saved.sessions) {
                    addSession(s.toolKey, { notify: false, activate: false, restore: s });
                }
                // 兜底：万一全部恢复失败，退回默认会话
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
        // 一次性把完整状态推给渲染进程
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

// IPC 通信
ipcMain.on('switch-view', (_event, viewKey) => switchView(viewKey));
ipcMain.on('create-new-view', (_event, toolKey) => addSession(toolKey));
ipcMain.on('close-view', (_event, viewKey) => closeSession(viewKey));
ipcMain.on('rename-view', (_event, viewKey, newName) => renameSession(viewKey, newName));
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
ipcMain.on('reload-view', (_event, viewKey) => {
    const entry = views.get(viewKey);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    const tool = AI_TOOLS[entry.toolKey];
    // 错误页无法 reload 回原站点，直接重新加载目标 URL
    entry.view.webContents.loadURL(tool.url).catch(err => console.error('重载失败:', err));
});

app.on('before-quit', () => {
    // close 事件已保存过完整状态（此时窗口还活着）。若 before-quit 在 closed 之后才触发，
    // views 已被清空，再 saveState() 会用空数据覆盖文件，导致重启后标签页全丢。
    // 因此仅在尚未保存时（异常退出路径）才兜底保存。
    clearTimeout(saveTimer);
    if (!savedAtExit) {
        console.log('[persist] before-quit 兜底保存 (views=' + views.size + ')');
        saveState();
    } else {
        console.log('[persist] before-quit: close 已保存，跳过覆盖');
    }
    for (const entry of views.values()) destroyView(entry);
    views.clear();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
