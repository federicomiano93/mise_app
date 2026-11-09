import { useLayoutEffect, useRef } from 'react';

// Keeps the focus on the control it was on when the rows around it are REORDERED (the «To order today» suppliers jump to the top
// of the list when the data arrives or the day changes). A keyed row is moved, not rebuilt, but a browser can drop the focus of a
// node that is taken out and put back; here the focus is handed back, and ONLY when it fell to nothing (the page body): a person
// who moved on, or a dialog that took the focus, is never overridden — nothing is stolen.
//
// `key` changes when the order may have: the render that sees it new reads where the focus is BEFORE the page is touched (the
// render phase runs ahead of the commit), and the layout effect looks again right after the move.
export function useKeepFocus(key: unknown): void {
  const before = useRef<Element | null>(null);
  before.current = typeof document === 'undefined' ? null : document.activeElement;
  useLayoutEffect(() => {
    const was = before.current;
    if (!(was instanceof HTMLElement) || was === document.body || !was.isConnected) return;
    const now = document.activeElement;
    if (now === was || (now !== null && now !== document.body)) return;
    was.focus({ preventScroll: true });
  }, [key]);
}
