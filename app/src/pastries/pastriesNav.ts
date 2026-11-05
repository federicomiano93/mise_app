import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { KEEP_FOCUS } from '../shell/Page';

// What the day panel puts in the navigation `state` when it opens a screen one level down (the
// editor, Records): «you came from the day, so Back is the browser's Back». KEEP_FOCUS comes with
// it: the page then leaves the focus alone, and the screen that opens puts it on its own title.
export const FROM_DAY = { ...KEEP_FOCUS, fromDay: true } as const;

export function cameFromDay(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromDay' in state;
}

// How a screen one level down (the editor, Records) steps back up.
//
// ⚠️ NEVER A PILE OF DUPLICATE HISTORY ENTRIES. Opened from the day, the entry behind it IS the
// day, so Back is `navigate(-1)` and the browser's own Back keeps meaning the same thing. Opened by
// its address (a bookmark, a reload with nothing behind it) there is nothing to step back to, so
// it goes to `fallback` by REPLACING itself: pushing the day on top would leave the editor one
// press of Back away from the day it just left.
//
// `onLeaving` runs first, only for these two ways out (Back and, in the editor, a finished Save):
// the day panel then knows to hand the focus back to the pencil that opened the screen.
export function useLeave(fallback: string, onLeaving: () => void): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const fromDay = cameFromDay(state);

  return useCallback(() => {
    onLeaving();
    if (fromDay) void navigate(-1);
    else void navigate(fallback, { replace: true, state: KEEP_FOCUS });
  }, [navigate, fromDay, fallback, onLeaving]);
}
