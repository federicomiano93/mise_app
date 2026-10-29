import { useCallback, useLayoutEffect, useRef } from 'react';
import type { FocusEvent, RefObject } from 'react';

// ⚠️ THE FOCUS NEVER FALLS TO <body> WHEN THE ITEM THAT HELD IT GOES (step 3f-5). A row answered here — or by another phone, whose
// answer arrives through the live data — is removed from the list together with the button the focus was on; a keyboard or
// screen-reader user would be dropped on the page. The items that matter carry `data-keep="<key>"`; the container's
// `onFocusCapture` notes which one the focus was last in, and when the list changes and the focus has been lost, it goes to the
// item now at that place (the next one), to the first button in it that is not disabled, or else to `fallback` (the screen's title).
//
// Only a LOST focus is repaired: focus that is in a dialog opened over the list, or on anything else outside it, is left alone. A
// dialog that closes gives the focus back a frame later, so the check is made after two frames, when it has settled.
export function useKeepFocus(
  container: RefObject<HTMLElement | null>,
  fallback: RefObject<HTMLElement | null>,
  // Changes whenever the items, or what is enabled in them, change.
  signature: string,
) {
  const last = useRef<{ key: string; index: number } | null>(null);

  const onFocusCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    const root = container.current;
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-keep]');
    if (!root || !item || !root.contains(item)) return;
    const all = Array.from(root.querySelectorAll<HTMLElement>('[data-keep]'));
    last.current = { key: item.dataset.keep ?? '', index: all.indexOf(item) };
  }, [container]);

  useLayoutEffect(() => {
    const at = last.current;
    if (at === null) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const root = container.current;
        if (!root) return;
        const active = document.activeElement;
        const lost = active === null || active === document.body || (root.contains(active) && (active as HTMLButtonElement).disabled === true);
        if (!lost) return;
        const items = Array.from(root.querySelectorAll<HTMLElement>('[data-keep]'));
        const item = items.find(node => node.dataset.keep === at.key) ?? items[Math.min(at.index, items.length - 1)];
        const buttons = item ? Array.from(item.querySelectorAll<HTMLButtonElement>('button')) : [];
        const target = buttons.find(button => !button.disabled) ?? (item?.matches('button') ? item : null) ?? fallback.current;
        target?.focus();
        last.current = item && target !== fallback.current ? { key: item.dataset.keep ?? '', index: items.indexOf(item) } : null;
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [signature, container, fallback]);

  return onFocusCapture;
}
