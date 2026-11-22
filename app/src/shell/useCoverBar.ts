import { useLayoutEffect } from 'react';
import { useTitleSlot } from './titleSlot';

// A section's own full-screen layer (Cakes' open cake, from 700px) is drawn over the shell's top bar. Drawn over is not enough: the bar, with
// the section's title in it, must also be out of reach of the keyboard and of a screen reader, or Tab walks into controls nobody can see and
// the h1 under the layer is still the page's first heading. While `covered`, the bar is made unreachable; when the layer goes it is given
// back exactly as it was.
//
// ⚠️ THE LAB TABLET'S CHROME 101 HAS NO `inert` (Chrome 102+): there the bar gets `aria-hidden` AND every control in it leaves the tab order
// (tabindex -1, the old value remembered and put back). Only for what is in the bar when the layer opens: a control that appears in it while
// the layer is up (a kiosk pill) is reachable on such a browser until the layer closes.
// ⚠️ WITHOUT A SLOT (a spec drawing a section alone, outside the shell) THERE IS NO BAR, and nothing is done.
export function useCoverBar(covered: boolean): void {
  const slot = useTitleSlot();

  useLayoutEffect(() => {
    const bar = slot?.closest('header') ?? null;
    if (!covered || bar === null) return undefined;
    return makeUnreachable(bar);
  }, [covered, slot]);
}

type MaybeInert = HTMLElement & { inert?: boolean };

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

// Returns the way back.
export function makeUnreachable(bar: HTMLElement): () => void {
  const node = bar as MaybeInert;
  if ('inert' in node) {
    const before = node.inert;
    node.inert = true;
    return () => { node.inert = before; };
  }
  const hiddenBefore = bar.getAttribute('aria-hidden');
  bar.setAttribute('aria-hidden', 'true');
  const tabindexes = new Map<Element, string | null>();
  bar.querySelectorAll(FOCUSABLE).forEach(control => {
    tabindexes.set(control, control.getAttribute('tabindex'));
    control.setAttribute('tabindex', '-1');
  });
  return () => {
    if (hiddenBefore === null) bar.removeAttribute('aria-hidden');
    else bar.setAttribute('aria-hidden', hiddenBefore);
    tabindexes.forEach((value, control) => {
      if (value === null) control.removeAttribute('tabindex');
      else control.setAttribute('tabindex', value);
    });
  };
}
