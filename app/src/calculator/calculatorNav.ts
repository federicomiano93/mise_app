import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { KEEP_FOCUS } from '../shell/Page';

// What the work view and the hub put in the navigation `state` when they open a screen one level down
// (Settings, a Settings screen): «you came from the level above, so Back is the browser's Back». KEEP_FOCUS
// comes with it: the page then leaves the focus alone, and the screen that opens puts it on its own title.
//
// (The same idea as foodcost/foodcostNav.ts: a feature never imports from another feature's folder.)
export const FROM_PARENT = { ...KEEP_FOCUS, fromParent: true } as const;

export function cameFromParent(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromParent' in state;
}

// How a screen one level down steps back up.
//
// ⚠️ NEVER A PILE OF DUPLICATE HISTORY ENTRIES. Opened from the level above, the entry behind it IS that level,
// so Back is `navigate(-1)` and the browser's own Back keeps meaning the same thing. Opened by its address (a
// bookmark, a reload with nothing behind it) there is nothing to step back to, so it goes to `fallback` by
// REPLACING itself.
export function useLeave(fallback: string): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const fromParent = cameFromParent(state);

  return useCallback(() => {
    if (fromParent) void navigate(-1);
    else void navigate(fallback, { replace: true, state: KEEP_FOCUS });
  }, [navigate, fromParent, fallback]);
}
