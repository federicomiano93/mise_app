// The visible height, for the browsers that cannot say it in CSS.
//
// ⚠️⚠️ DRIVEN ON THE LAB TABLET (Android 7, Chrome 101, 13 Oct 2026). `dvh` arrived in Chrome 108; before it,
// `--vh100` is 100vh (tokens.css), and on Android Chrome `100vh` is the height WITHOUT the address bar and tab strip:
// 744px on a screen that shows 648. Every Mise 2 screen was 96px taller than the window — the rail's last item cut,
// the page and its panes scrolling twice. So where `dvh` is unknown, `--vh100` is set inline on <html> to the real
// visible height and kept up to date as the bars come and go (inline wins over the stylesheet). Nothing is set where
// dvh works. It reads the LAYOUT viewport (clientHeight): innerHeight follows pinch-zoom, and the layout does not.
//
// Returns a function that stops it (the specs use it; the app never stops).
export const VH_VAR = '--vh100';

type Win = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
  CSS?: { supports?: (property: string, value: string) => boolean };
  document: { documentElement: Pick<HTMLElement, 'style' | 'clientHeight'> };
};

export function installViewportHeight(win: Win = window): () => void {
  if (win.CSS?.supports?.('height', '100dvh') === true) return () => {};
  const root = win.document.documentElement;
  let written = -1;
  const update = () => {
    const height = root.clientHeight;
    if (height === written) return;
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
