import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { KEEP_FOCUS } from '../shell/Page';
import { ORDERS_PATH } from './ordersPath';

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

function numberIn(state: unknown, key: string): number | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const value = (state as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

// How many history entries lie between this screen and the list (1 when the list is the entry right behind it).
export function stepsUpOf(state: unknown): number {
  return numberIn(state, 'stepsUp') ?? 1;
}

// The state the supplier's «What they sell» button writes: FROM_SUPPLIER, plus how far the supplier's own entry is from the
// list, so a lateral pick on the split can tell how far the list is from the items screen it replaces. Written only when the
// supplier itself was opened from the list.
export function fromSupplierState(supplierState: unknown) {
  return cameFromList(supplierState) ? { ...FROM_SUPPLIER, behindSteps: stepsUpOf(supplierState) } : FROM_SUPPLIER;
}

// The state of a screen that REPLACES the one on show (a lateral pick on the split), so it knows where Back goes.
//
// ⚠️ A REPLACE KEEPS THE HISTORY BEHIND IT. History [list, A, items of A] with B picked beside the list becomes [list, A, B]:
// B's Back is no longer `navigate(-1)` (that lands on A, a step sideways) but as many steps as lie between B and the list.
// `stepsUp` carries that count (read only by useLeave); it is 1, and so left out, whenever the list is right behind.
export function replacedState(state: unknown) {
  if (!cameFromList(state)) return KEEP_FOCUS;
  const behind = numberIn(state, 'behindSteps');
  // A confirm screen knows how far the list is (confirmState).
  const steps = numberIn(state, 'toList') ?? (cameFromSupplier(state) && behind !== undefined ? behind + 1 : stepsUpOf(state));
  return steps > 1 ? { ...FROM_LIST, stepsUp: steps } : FROM_LIST;
}

// How a screen steps back up one level.
//
// ⚠️ NEVER A PILE OF DUPLICATE HISTORY ENTRIES. Opened from the screen above it, the entry behind IS that screen, so Back is
// `navigate(-1)` and the browser's own Back keeps meaning the same thing. Opened by its address (a bookmark, a reload with
// nothing behind it) there is nothing to step back to, so it goes to `fallback` by REPLACING itself.
//
// Several steps up when a lateral pick on the split replaced entries (replacedState).
//
// `onLeaving` runs first: the screen says which row opened it, so the focus can be handed back to that row once the screen
// above is on show again (handBack.ts).
export function useLeave(fallback: string, onLeaving: () => void, cameFrom: (state: unknown) => boolean = cameFromList): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const came = cameFrom(state);
  const steps = stepsUpOf(state);

  return useCallback(() => {
    onLeaving();
    if (came) void navigate(-steps);
    else void navigate(fallback, { replace: true, state: KEEP_FOCUS });
  }, [navigate, came, steps, fallback, onLeaving]);
}

// The state a confirm screen is opened with (one supplier's «Order placed…», or the ticked suppliers of the picker). It is
// FROM_LIST (Back is the browser's Back, the screen puts the focus on its own title) plus `toList`: how many history entries
// lie between it and the list, when the list is in the history behind it. A recorded order goes back to the LIST, not to the
// screen it was opened from (P20: after a save, back to the list), and the number says how far that is.
export function confirmState(openerState: unknown, extra: Readonly<Record<string, unknown>> = {}) {
  const toList = cameFromList(openerState) ? stepsUpOf(openerState) + 1 : undefined;
  return { ...FROM_LIST, ...(toList === undefined ? {} : { toList }), ...extra };
}

// Steps up to the list again after an order was recorded: the history is walked back when the list is in it, else the
// screen replaces itself with the list. `onLeaving` runs first (the focus owed to the control that opened the screen).
export function useLeaveToList(onLeaving: () => void): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const toList = numberIn(state, 'toList');
  return useCallback(() => {
    onLeaving();
    if (toList !== undefined) void navigate(-toList);
    else void navigate(ORDERS_PATH, { replace: true, state: KEEP_FOCUS });
  }, [navigate, toList, onLeaving]);
}
