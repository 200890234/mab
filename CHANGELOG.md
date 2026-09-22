# Changelog

## v1.5.0
- Added a **Cache** entry to the Settings panel: it shows how much disk the tab partitions currently occupy, and a `Clean` action that clears the HTTP and code caches of every partition still in use (through Electron's own APIs, so cookies, local storage and login state are preserved) and deletes partition directories that no longer belong to any tab, such as closed web-tool tabs and leftovers from older naming schemes. A partition is only removed when nothing references it, and the freed space is reported when the cleanup finishes.
- Tabs are now written to `sessions.json` as soon as they are created or closed, instead of waiting for the debounced save, so a crash or a forced kill no longer loses tab changes.
- Fixed the app not exiting completely: the floating pronunciation window is destroyed on `before-quit`, so no lingering process keeps it alive in the background.
- Removed the noisy session-save logging.
- Removed the dead `cleanupLegacyPartitions()` helper, which relied on a `session.getAllPaths` API that does not exist and therefore never ran; orphaned partition cleanup is now handled by the Settings action instead.

## v1.4.0
- Added in-page search (`Ctrl+F`): a floating find bar shows match count (e.g. `3/12`) with previous/next navigation; `Enter` jumps to the next match, `Shift+Enter` to the previous, and `Esc` closes the bar. The shortcut is scoped so it won't conflict with the browser's native search.
- Added phonetic lookup & read-aloud on right-click: select any text and right-click to show IPA phonetics, part of speech, and a speaker button that plays either the dictionary's official audio or synthesized speech.
- Added a self-contained Microsoft Edge online neural TTS engine (`tts-edge.js`): re-implements the edge-tts protocol including the Sec-MS-GEC anti-bot token, fixing the HTTP 403 error from the stale npm `edge-tts` package; pure Node.js with no Python runtime required (defaults to `en-US-AriaNeural`).
- Added the `ws` dependency for WebSocket communication used by the TTS engine and find bar.

## v1.3.1
- Fixed a blank strip at the bottom of the sidebar and the content area on startup (re-run layout to resync the viewport).
- Hidden the vertical scrollbar on the left session list while keeping scrolling functional.

## v1.3.0
- Redesigned the menu bar and removed the native menu: the system native menu bar is gone, and a self-drawn `MAB | File | View | Help` menu is rendered on the same row as the toolbar just below the native title bar, opening as a native popup menu without covering page content.
- Added a web toolbar: a custom web toolbar now sits to the right of the menu, where you can click `+` to open any URL as an in-app tab; tabs align to the content area in real time as the sidebar is resized.

## v1.2.4
- Proxy logic now defaults to following the system proxy (`mode: 'system'`), removing the previous restriction that only some sites used the proxy.
- Clash's system-proxy / TUN mode now automatically takes over traffic for all tabs, and rule-based domain routing applies to every site.
- You can still override the system setting by specifying explicit proxy rules via the `AI_BROWSER_PROXY` environment variable.
- Release notes are now auto-generated (`generate_release_notes: true`).

## v1.2.3
- Fixed an issue where the theme content went blank after running for a while (only the title bar and menu bar remained):
  - Added automatic reload recovery after renderer crashes / process loss (for both views and the sidebar).
  - Refresh layout on window restore / show / minimize to fix stale view bounds after hide-and-show.

## v1.2.2
- Fixed an issue where the update-reminder badge always showed: root cause was CSS `.update-badge { display:inline-flex }` overriding the HTML `hidden` attribute; added `.update-badge[hidden] { display:none !important }`.
- The Help menu's "Check for Updates" now checks first and then shows a dialog (displaying the latest version and release notes, with an "Open Download" button only when a newer version truly exists).

## v1.2.1
- Removed the debug-only simulated update reminder.
