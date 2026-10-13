import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { KEEP_FOCUS } from '../shell/Page';

// What the list puts in the navigation `state` when it opens a recipe one level down: «you came from
// the list, so Back is the browser's Back». KEEP_FOCUS comes with it: the page then leaves the focus
// alone, and the screen that opens puts it on its own title.
//
// (A copy of foodcost/foodcostNav.ts: a feature never imports from another feature's folder.)
export const FROM_LIST = { ...KEEP_FOCUS, fromList: true } as const;

// The same, from the Allergen sheet: Back from the recipe returns to the sheet, and the focus is owed to the
// sheet's row rather than the list's.
export const FROM_SHEET = { ...FROM_LIST, fromSheet: true } as const;

// The same, from a recipe to its label (step 3d-3): Back from the label is the browser's Back, and the label opens
// beside nothing of the list's. Deliberately NOT `fromList`: picking another recipe in the list beside an open label
// REPLACES the label's entry with the recipe, and that entry must not claim the list is one step behind it.
export const FROM_RECIPE = { ...KEEP_FOCUS, fromRecipe: true } as const;

export function cameFromRecipe(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromRecipe' in state;
}

export function cameFromSheet(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromSheet' in state;
}

export function cameFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromList' in state;
}

// How a recipe steps back up to the list.
//
// ⚠️ NEVER A PILE OF DUPLICATE HISTORY ENTRIES. Opened from the list, the entry behind it IS the
// list, so Back is `navigate(-1)` and the browser's own Back keeps meaning the same thing. Opened by
// its address (a bookmark, a reload with nothing behind it) there is nothing to step back to, so it
// goes to `fallback` by REPLACING itself.
//
// `onLeaving` runs first: the screen says which row opened it, so the focus can be handed back to
// that row once the list is on screen (handBack.ts).
export function useLeave(fallback: string, onLeaving: () => void, cameFrom: (state: unknown) => boolean = cameFromList): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const fromList = cameFrom(state);

  return useCallback(() => {
    onLeaving();
    if (fromList) void navigate(-1);
    else void navigate(fallback, { replace: true, state: KEEP_FOCUS });
  }, [navigate, fromList, fallback, onLeaving]);
}
