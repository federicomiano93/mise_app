// The visible height, for the browsers that cannot say it in CSS.
//
// ⚠️⚠️ DRIVEN ON THE LAB TABLET (Android 7, Chrome 101, 14 Oct 2026). `dvh` arrived in Chrome 108; before it, every
// stylesheet falls back to `vh`, and on Android Chrome `100vh` is the height WITHOUT the address bar and tab strip:
// 744px on a screen that shows 648. Every Mise 2 screen was 96px taller than the window — the rail's last item cut,
// the page and its panes scrolling twice. So where `dvh` is unknown, `--vh100` is set to the real visible height
// (innerHeight) and kept up to date as the bars come and go; the stylesheets' fallback lines read
// `var(--vh100, 100vh)` and the `dvh` line after them wins wherever it is understood. Nothing is set where dvh works.
//
// Returns a function that stops it (the specs use it; the app never stops).
export const VH_VAR = '--vh100';

type Win = Pick<Window, 'innerHeight' | 'addEventListener' | 'removeEventListener'> & {
  CSS?: { supports?: (property: string, value: string) => boolean };
  document: Pick<Document, 'documentElement'>;
};

export function installViewportHeight(win: Win = window): () => void {
  if (win.CSS?.supports?.('height', '100dvh') === true) return () => {};
  const root = win.document.documentElement;
  const update = () => { root.style.setProperty(VH_VAR, `${win.innerHeight}px`); };
  update();
  win.addEventListener('resize', update);
  win.addEventListener('orientationchange', update);
  return () => {
    win.removeEventListener('resize', update);
    win.removeEventListener('orientationchange', update);
    root.style.removeProperty(VH_VAR);
  };
}
