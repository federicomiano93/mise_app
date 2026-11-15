// installGuide.ts — the address of the install guide, and whether the app is already installed (staff slice 2).
//
// ⚠️ THE GUIDE STAYS THE CURRENT APP'S OWN PAGE (docs/parity/staff-plan.md, slice 2): install-guide.html at the SITE'S ROOT.
// Until the switch Mise 2 is served from `<site>/mise2/`, after it from the site's root, and the guide stays where it is in
// both (scripts/build-pages-site.mjs KEPT_PAGES; the service worker hands it to the network untouched). So the folder
// `mise2/`, when the app is served from it, is stepped out of — as calculator/clientOrdersSource.ts does for order.html.

export function installGuideAddress(pageHref: string): string {
  const folder = new URL('.', pageHref);
  const root = folder.pathname.endsWith('/mise2/') ? new URL('..', folder) : folder;
  return new URL('install-guide.html', root).href;
}

// Is this page running as the installed app (from the home screen) rather than in a browser tab?
// ⚠️ BOTH TESTS, because they disagree by platform (js/install-hint-boot.js): Chromium answers the media query, iOS Safari sets
// navigator.standalone and nothing else.
export function runsInstalled(win: Pick<Window, 'matchMedia' | 'navigator'> = window): boolean {
  try {
    if (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches) return true;
  } catch { /* an old engine: fall through to the iOS flag */ }
  return (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// Goes to the guide. An object, so a spec can spy on the navigation (jsdom cannot follow one), as settings' pageReload does.
export const guidePage = {
  open(): void {
    window.location.assign(installGuideAddress(window.location.href));
  },
};
