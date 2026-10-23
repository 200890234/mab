[English](README.md) · [中文](README.zh-CN.md)

# Mervyn's AI Browser

A multi-session AI browser built with Electron. Open Gemini, DeepSeek, ChatGPT, Doubao, Qwen, Zhipu AI, and Claude side by side in isolated, persistent sessions.

English is the default UI language.

## Screenshot

**Light mode**

![Mervyn's AI Browser — Light](assets/screenshot/light.png)

**Dark mode**

![Mervyn's AI Browser — Dark](assets/screenshot/dark.png)

## Features

- **Multi-session tabs** — Create multiple sessions per AI tool; each session keeps its own page state.
- **Persistent login** — Sessions are isolated via Electron `persist:` partitions, so login state survives restarts (same machine).
- **Session restore** — Tabs, active tab, window size, and sidebar width are restored on the next launch.
- **Proxy support** — Per-tool proxy via the `AI_BROWSER_PROXY` environment variable (applied only to tools flagged `needsProxy`).
- **Auto-launch** — Optional "Launch at startup" toggle in Settings.
- **Auto retry** — Transient network errors (e.g. proxy not ready yet) are retried automatically instead of showing an error page.
- **Context menu & app menu** — Back / forward / reload / zoom / DevTools, plus right-click copy / paste / cut / reload.

## Development

```bash
npm install
npm start          # run in development mode (electron .)
```

## Build

```bash
npm run dist       # build installer -> dist/Mervyn's AI Browser Setup x.x.x.exe
npm run pack       # build unpacked directory only -> dist/win-unpacked/
```

The build output goes to `dist/` as an NSIS installer (selectable install directory, desktop + start menu shortcuts).

## Data location

User data (tabs, login state) is stored at:

```
C:\Users\<username>\AppData\Roaming\MyAIBrowser
```

- Reinstalling or restarting on the same PC keeps tabs and login state.
- Moving to another PC requires re-login (Windows encrypts cookies per machine).

## Settings

Open **Settings** from the sidebar footer:

| Option | Description |
| --- | --- |
| Launch at startup | Add the app to the system login items. |

> **Proxy** is not set in the UI. Configure it through the environment variable below.

## Proxy configuration

By default the app follows the system proxy (e.g. Clash's "System Proxy" / TUN mode), and the rules apply to every tab. Optionally set the `AI_BROWSER_PROXY` environment variable before launching to override it with explicit rules:

```bash
# Windows (PowerShell)
$env:AI_BROWSER_PROXY = "http=127.0.0.1:7890;https=127.0.0.1:7890"
npm start
```

## Managing AI services

The sidebar service list is user-configurable and stored in `services.json` inside the user data directory (`%APPDATA%\MyAIBrowser\services.json` on Windows). It is the single source of truth: the sidebar, the `File > New Session` menu and per-service login partitions are all derived from it.

- **In-app editor**: open `Settings` (gear icon) and click `Manage AI Services…` to add, rename, remove or drag-to-reorder services. Changes apply immediately.
- **Manual editing**: use `File > Open services.json` to open the file in your editor; saved changes are picked up live, no restart needed. Each entry looks like this:

| Field | Description |
| --- | --- |
| `key` | Stable identifier (also names the login partition). Auto-generated for new services. |
| `name` | Display name (also used as the default tab name). |
| `url` | Home URL loaded for the service. |
| `icon` | Optional short text badge shown in the sidebar (defaults to the first letter of `name`). |
| `color` | Brand color for the sidebar badge. |
| `logo` | Optional path to a logo image (`assets/logos/<name>.png`). |

Removing a service that still has open sessions asks for confirmation: its tabs disappear on the next launch, while its login data stays on disk (cleanable in `Settings > Cache`).

Service logos live in `assets/logos/`. The app icon (`assets/icon.ico`) takes effect after rebuild.

To regenerate the icon, run `python gen_icon.py` (writes `assets/icon.ico`).

## Security notes

- `nodeIntegration` is disabled and `contextIsolation` is enabled everywhere.
- The AI-site views run in a `sandbox: true` and use isolated `persist:` partitions.
- The sidebar UI sets a strict Content-Security-Policy and uses `textContent` / `CSS.escape` to avoid injection.
- No credentials are hardcoded; login state is stored locally in the user data directory.
- The preload script exposes only a minimal, scoped API through `contextBridge`.

## Trademark & brand notice

This software is an independent, unofficial project and is **not affiliated with, endorsed by, or sponsored by** any AI service provider.

The brand names, logos, and trademarks of ChatGPT/OpenAI, Gemini/Google, DeepSeek, Doubao/ByteDance, Qwen/Alibaba, Zhipu AI, Claude/Anthropic, and any other services referenced here are the property of their respective owners. Any such logos included in `assets/logos/` are used solely as functional indicators to identify each service within the app's UI, and do not imply any relationship with the respective companies.

All other trademarks, service marks, and trade names referenced in this project are the property of their respective holders.

## License

MIT © 2026 Mervyn — see [LICENSE](LICENSE).
