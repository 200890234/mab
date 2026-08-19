# Changelog

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
