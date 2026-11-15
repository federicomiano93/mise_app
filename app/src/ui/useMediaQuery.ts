import { useCallback, useSyncExternalStore } from 'react';

// Whether a media query matches right now, and again whenever that changes (a tablet turned from
// upright to landscape, a window resized).
//
// For what a stylesheet cannot say: LAYOUT is always CSS (a media query in the module), and this
// is only for the few attributes that must agree with it, such as a tab list's aria-orientation.
//
// ⚠️ jsdom has no matchMedia, and the specs that do stub it give back a bare `{ matches }`: both
// read as «does not match», never as an error.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
    list?.addEventListener?.('change', notify);
    return () => { list?.removeEventListener?.('change', notify); };
  }, [query]);

  const read = useCallback(
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches === true : false),
    [query],
  );

  return useSyncExternalStore(subscribe, read, () => false);
}
