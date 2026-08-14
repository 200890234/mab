# Changelog

## v1.2.4
- 代理逻辑改为默认跟随系统代理（`mode: 'system'`），放开原先仅部分站点走代理的限制。
- 现在 Clash 的系统代理 / TUN 模式会自动接管所有标签页流量，规则模式下的域名分流对所有站点生效。
- 仍可通过环境变量 `AI_BROWSER_PROXY` 指定显式代理规则以覆盖系统设置。
- 发布流程改为自动生成 release notes（`generate_release_notes: true`）。

## v1.2.3
- 修复程序运行一段时间后主题内容空白（仅剩标题栏和菜单栏）的问题：
  - 增加渲染进程崩溃 / 消失后的自动重载恢复（视图与侧边栏）。
  - 窗口 restore / show / minimize 时刷新布局，修正隐藏再显示后视图边界未更新的问题。

## v1.2.2
- 修复更新提醒红点始终显示的问题：根因为 CSS `.update-badge { display:inline-flex }` 覆盖了 HTML `hidden` 属性，新增 `.update-badge[hidden] { display:none !important }`。
- 帮助菜单的「检查更新」改为先检测再弹窗（显示最新版本、更新内容，仅在确有新版本时提供打开下载页按钮）。

## v1.2.1
- 移除调试用的模拟更新提醒。
