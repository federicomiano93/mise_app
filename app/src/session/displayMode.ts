// The media query that says «this page runs as the installed app», in every display mode an installed app can have.
//
// ⚠️ TWO MODES, NOT ONE: an installed PC app whose title bar is folded into the page (Window Controls Overlay, manifest.json's
// display_override, 22 Nov 2026) reports `window-controls-overlay`, and `(display-mode: standalone)` then NO LONGER MATCHES. A check for
// standalone alone would take the PC app for a browser tab: the install hint would come back, the device ping would count it as «not installed»,
// and push would think the app is not on the home screen. (iOS answers neither: it sets navigator.standalone, read beside this query.)
export const INSTALLED_DISPLAY_QUERY = '(display-mode: standalone), (display-mode: window-controls-overlay)';
