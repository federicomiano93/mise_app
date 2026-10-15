import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { FROM_RECIPE_LINK, recipeAddress } from '@mise/shared/recipe-link';
import { KEEP_FOCUS } from '../shell/Page';

// What the list puts in the navigation `state` when it opens a screen one level down (a product, a
// new product, Settings): «you came from the list, so Back is the browser's Back». KEEP_FOCUS comes
// with it: the page then leaves the focus alone, and the screen that opens puts it on its own title.
//
// (A copy of stocktake/stocktakeNav.ts: a feature never imports from another feature's folder.)
export const FROM_LIST = { ...KEEP_FOCUS, fromList: true } as const;

// What a product puts in the state when it opens its margin history on a phone: «you came from the
// product, so Back is the browser's Back».
export const FROM_PRODUCT = { ...KEEP_FOCUS, fromProduct: true } as const;

export function cameFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromList' in state;
}

export function cameFromProduct(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromProduct' in state;
}

// How a screen one level down steps back up to the list.
//
// ⚠️ NEVER A PILE OF DUPLICATE HISTORY ENTRIES. Opened from the list, the entry behind it IS the
// list, so Back is `navigate(-1)` and the browser's own Back keeps meaning the same thing. Opened
// by its address (a bookmark, a reload with nothing behind it) there is nothing to step back to,
// so it goes to `fallback` by REPLACING itself.
//
// `onLeaving` runs first: the screen says which button opened it, so the focus can be handed back
// to that button once the list is on screen (handBack.ts).
export function useLeave(fallback: string, onLeaving: () => void): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const fromList = cameFromList(state);

  return useCallback(() => {
    onLeaving();
    if (fromList) void navigate(-1);
    else void navigate(fallback, { replace: true, state: KEEP_FOCUS });
  }, [navigate, fromList, fallback, onLeaving]);
}

// ── Opened from a recipe ──────────────────────────────────────────────────────────────────────────

// «The recipe is the history entry behind this one»: the recipe's «Open in Food cost» button pushes with
// it (FROM_RECIPE_LINK), and the entry's replaces carry it on.
export function cameFromRecipe(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromRecipeLink' in state;
}

// «Put the focus on your own title when you appear»: the entry's replace says it (the page itself keeps
// the focus, KEEP_FOCUS), and so does a move from the list (FROM_LIST).
export function wantsTitleFocus(state: unknown): boolean {
  return cameFromList(state) || (typeof state === 'object' && state !== null && 'focusTitle' in state);
}

// The state of the entry's replace and of the draft giving way: the app arranging itself (the page keeps
// the focus), the recipe link carried on, the target's title asked to take the focus.
export function entryState(incoming: unknown): Record<string, unknown> {
  return { ...KEEP_FOCUS, focusTitle: true, ...(cameFromRecipe(incoming) ? FROM_RECIPE_LINK : {}) };
}

// How a screen opened from a recipe steps back to it.
//
// ⚠️ NEVER A SECOND ENTRY FOR THE RECIPE (the current app showed two pages per trip). When the state says
// the recipe is the entry behind, Back is the browser's Back; otherwise (an address typed, a reload that lost
// the state) the screen REPLACES itself with the recipe. Nothing happens for a null id.
export function useBackToRecipe(recipeId: string | null): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const behind = cameFromRecipe(state);
  return useCallback(() => {
    if (recipeId === null) return;
    if (behind) {
      void navigate(-1);
      return;
    }
    const to = recipeAddress(recipeId);
    if (to !== null) void navigate(to, { replace: true });
  }, [navigate, behind, recipeId]);
}
