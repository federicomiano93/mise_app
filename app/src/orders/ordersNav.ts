import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { KEEP_FOCUS } from '../shell/Page';

// What the list puts in the navigation `state` when it opens a screen one level down: «you came from the list, so Back is
// the browser's Back». KEEP_FOCUS comes with it: the page then leaves the focus alone, and the screen that opens puts it on
// its own title.
//
// (A copy of suppliers/suppliersNav.ts: a feature never imports from another feature's folder.)
export const FROM_LIST = { ...KEEP_FOCUS, fromList: true } as const;

export function cameFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromList' in state;
}

// What a supplier's order screen puts in the `state` when its «What they sell» button opens the items list. `fromList` stays
// in it on purpose: the entry behind is the supplier's screen, so Back is still the browser's Back (useLeave) and the screen
// still puts the focus on its own title. `fromSupplier` only says WHICH button to hand the focus back to.
export const FROM_SUPPLIER = { ...FROM_LIST, fromSupplier: true } as const;

export function cameFromSupplier(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromSupplier' in state;
}

// How a screen steps back up one level.
//
// ⚠️ NEVER A PILE OF DUPLICATE HISTORY ENTRIES. Opened from the screen above it, the entry behind IS that screen, so Back is
// `navigate(-1)` and the browser's own Back keeps meaning the same thing. Opened by its address (a bookmark, a reload with
// nothing behind it) there is nothing to step back to, so it goes to `fallback` by REPLACING itself.
//
// `onLeaving` runs first: the screen says which row opened it, so the focus can be handed back to that row once the screen
// above is on show again (handBack.ts).
export function useLeave(fallback: string, onLeaving: () => void, cameFrom: (state: unknown) => boolean = cameFromList): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const came = cameFrom(state);

  return useCallback(() => {
    onLeaving();
    if (came) void navigate(-1);
    else void navigate(fallback, { replace: true, state: KEEP_FOCUS });
  }, [navigate, came, fallback, onLeaving]);
}
