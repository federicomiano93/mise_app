// js/viewport-height.js — the visible height, for the browsers that cannot say it in CSS.
//
// ⚠️ DRIVEN ON THE LAB TABLET (SM-T550, Android 7, Chrome 101, 31 Oct 2026). Its Chrome stops at
// 101 — the newest Google Play serves it — and `dvh` arrived in Chrome 108. Every stylesheet reads
// var(--vh100), which tokens.css sets to 100vh and switches to 100dvh inside @supports. On Android
// Chrome 100vh is the height WITHOUT the address bar and tab strip: 744px on a screen that shows 648,
// so every pinned screen was 96px taller than the glass and the Calculator's footer («Storico
// impasti», «Ordini», «Impostazioni») could not be reached by finger. So where dvh is unknown,
// --vh100 is set inline on <html> to the real layout height (inline wins over the stylesheet).
//
// It reads the LAYOUT viewport (clientHeight), not innerHeight: innerHeight follows pinch-zoom and
// the layout does not. It follows the on-screen keyboard (Mise 2 measured it on the same tablet,
// 13 Oct 2026: 648 → 328). Nothing is set where dvh works. Same approach as Mise 2's
// app/src/shell/viewportHeight.ts, so the switch-over changes nothing on the tablet.
//
// Returns a function that stops it (the tests use it; the pages never stop).
export const VH_VAR = '--vh100';

export function installViewportHeight(win = globalThis) {
  if (win.CSS?.supports?.('height', '100dvh') === true) return () => {};
  const root = win.document?.documentElement;
  if (!root) return () => {};
  let written = -1;
  const update = () => {
    const height = root.clientHeight;
    // A height of 0 is a page not laid out yet (a hidden tab): writing it would collapse
    // every screen to nothing, so the stylesheet's 100vh stays until a real value comes.
    if (!(height > 0) || height === written) return;
    written = height;
    root.style.setProperty(VH_VAR, `${height}px`);
  };
  update();
  win.addEventListener('resize', update);
  win.addEventListener('orientationchange', update);
  return () => {
    win.removeEventListener('resize', update);
    win.removeEventListener('orientationchange', update);
    root.style.removeProperty(VH_VAR);
  };
}

// Every page imports this first (js/pages/*.js), so it runs before any of the page's own scripts.
if (typeof window !== 'undefined' && window.document) installViewportHeight(window);
