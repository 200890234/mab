[English](README.md) · [中文](README.zh-CN.md)

# Mervyn 的 AI 浏览器

基于 Electron 构建的多会话 AI 浏览器。可并排打开 Gemini、DeepSeek、ChatGPT、豆包、千问、智谱清言、Claude 等，每个会话相互独立并保留登录态。

默认界面语言为英文。

## 功能特性

- **多会话标签页** —— 每个 AI 工具可创建多个会话，各自保留页面状态。
- **登录态持久化** —— 通过 Electron `persist:` 分区隔离会话，重启后登录态保留（同一台电脑）。
- **会话恢复** —— 下次启动时自动恢复标签页、当前激活项、窗口尺寸与侧边栏宽度。
- **代理支持** —— 通过环境变量 `AI_BROWSER_PROXY` 为单个工具设置代理（仅对标记为 `needsProxy` 的工具生效）。
- **开机自启动** —— 在「设置」中可开启「开机自动启动」。
- **自动重试** —— 临时性网络错误（如代理尚未就绪）会自动延时重试，不再直接弹出错误页。
- **菜单与右键菜单** —— 后退 / 前进 / 刷新 / 缩放 / 开发者工具，以及右键复制 / 粘贴 / 剪切 / 重新加载。

## 开发

```bash
npm install
npm start          # 开发模式启动（electron .）
```

## 打包

```bash
npm run dist       # 生成安装包 -> dist/Mervyn's AI Browser Setup x.x.x.exe
npm run pack       # 仅生成免安装目录 -> dist/win-unpacked/
```

打包产物位于 `dist/`，为 NSIS 格式安装包（可自选安装目录，自动创建桌面与开始菜单快捷方式）。

## 数据位置

用户数据（标签页、登录态）保存在：

```
C:\Users\<用户名>\AppData\Roaming\MyAIBrowser
```

- 同一台电脑重装/重启程序会保留标签页与登录态。
- 换到另一台电脑需要重新登录（Windows 系统对 cookie 有加密保护）。

## 设置

点击侧边栏底部的「设置」入口：

| 选项 | 说明 |
| --- | --- |
| 开机自动启动 | 将程序加入系统登录项。 |

> **代理**不在界面中设置，请通过下方环境变量配置。

## 代理配置

启动前设置环境变量 `AI_BROWSER_PROXY`（例如 `http=127.0.0.1:7890;https=127.0.0.1:7890`）。该代理仅应用于 `needsProxy: true` 的工具。

```bash
# Windows (PowerShell)
$env:AI_BROWSER_PROXY = "http=127.0.0.1:7890;https=127.0.0.1:7890"
npm start
```

## 自定义 AI 工具

编辑 `main.js` 顶部的 `AI_TOOLS` 对象即可增删 AI 工具：

| 字段 | 说明 |
| --- | --- |
| `name` | 显示名称（同时作为默认标签页名称）。 |
| `url` | 该工具加载的首页地址。 |
| `icon` | 侧边栏显示的简短文字徽标（如 `GPT`、`豆`）。 |
| `color` | 侧边栏圆点/徽标的品牌色。 |
| `logo` | 可选 logo 图片路径（`assets/logos/<名称>.png`）。 |
| `needsProxy` | 设为 `true` 时该工具走 `AI_BROWSER_PROXY` 代理。 |

各工具 logo 位于 `assets/logos/`。应用图标 `assets/icon.ico` 在重新打包后生效。

重新生成图标可运行 `python gen_icon.py`（写入 `assets/icon.ico`）。

## 安全说明

- 所有视图均关闭 `nodeIntegration` 并启用 `contextIsolation`。
- AI 站点视图运行在 `sandbox: true` 下，并使用相互隔离的 `persist:` 分区。
- 侧边栏界面设置了严格的 Content-Security-Policy，并使用 `textContent` / `CSS.escape` 防止注入。
- 没有硬编码任何凭据，登录态保存在本地用户数据目录。
- preload 脚本仅通过 `contextBridge` 暴露最小化、受限的 API。

## 商标与品牌声明

本项目是独立的第三方开源软件，**与任何 AI 服务提供商均无隶属、合作或赞助关系**。

ChatGPT/OpenAI、Gemini/Google、DeepSeek、豆包/字节跳动、通义千问/阿里巴巴、智谱 AI、Claude/Anthropic，以及本项目涉及的其他服务名称、标识与商标，均归各自所有者所有。`assets/logos/` 中收录的相关标识仅用于应用界面内标识对应服务，不构成与相应公司的任何关联。

其余被提及的商标、服务标志与商号均归各自权利人所有。

## 许可证

MIT © 2026 Mervyn —— 详见 [LICENSE](LICENSE)。
