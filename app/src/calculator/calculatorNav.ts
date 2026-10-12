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

// The WhatsApp editor's screens are up to three levels below its top, and Save returns to the top from any of them:
// each entry it pushes carries how many entries it is above the top (`depth`), so Save can step back that many at once
// instead of leaving a trail of screens behind it. Absent (an address typed or reloaded into) means «none».
export const fromParentAt = (depth: number) => ({ ...FROM_PARENT, depth }) as const;

export function depthOf(state: unknown): number {
  if (typeof state !== 'object' || state === null || !('depth' in state)) return 0;
  const depth = (state as { depth: unknown }).depth;
  return typeof depth === 'number' && Number.isInteger(depth) && depth > 0 ? depth : 0;
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
