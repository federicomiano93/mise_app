import { useCallback } from 'react';
import { isWeekday } from '@mise/shared/pastries-model';
import type { Weekday } from '@mise/shared/pastries-model';
import { useLocation, useNavigate } from 'react-router';
import { KEEP_FOCUS } from '../shell/Page';

// What the day panel puts in the navigation `state` when it opens a screen one level down (the
// editor, Records): «you came from the day, so Back is the browser's Back». KEEP_FOCUS comes with
// it: the page then leaves the focus alone, and the screen that opens puts it on its own title.
export const FROM_DAY = { ...KEEP_FOCUS, fromDay: true } as const;

export function cameFromDay(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromDay' in state;
}

// What «Copy day» puts in the navigation `state` beside FROM_DAY: the day whose list pre-fills the
// editor, and the work date on which the person already said «yes, edit this recorded day» (null if
// the target was not recorded or they were never asked). The date, not a flag: it lives in the
// browser's history entry, so a reload tomorrow must ask again.
export type CopyState = { readonly from: Weekday; readonly editAgreedOn: string | null };

// ⚠️ THE STATE IS READ AS UNTRUSTED: a history entry survives reloads and can be anything. A shape
// that is not exactly this one means «no copy», an ordinary edit.
export function copyOf(state: unknown): CopyState | null {
  if (typeof state !== 'object' || state === null || !('copy' in state)) return null;
  const copy = state.copy;
  if (typeof copy !== 'object' || copy === null) return null;
  const from = 'from' in copy ? copy.from : undefined;
  const editAgreedOn = 'editAgreedOn' in copy ? copy.editAgreedOn : undefined;
  if (!isWeekday(from)) return null;
  if (editAgreedOn !== null && typeof editAgreedOn !== 'string') return null;
  return { from, editAgreedOn };
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
