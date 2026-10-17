import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { recipeAddress } from '@mise/shared/recipe-link';
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

// «The recipe is DEPTH entries behind this one»: the recipe's «Open in Food cost» button pushes with
// FROM_RECIPE_LINK (depth 1), every push inside Food cost adds one (recipeDepth), every replace carries
// the same number on. A positive integer, or null when the state does not say.
export function recipeDepth(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null;
  if ('recipeDepth' in state) {
    const depth = (state as { recipeDepth: unknown }).recipeDepth;
    return typeof depth === 'number' && Number.isInteger(depth) && depth >= 1 && depth <= 1000 ? depth : null;
  }
  return 'fromRecipeLink' in state ? 1 : null;
}

export function cameFromRecipe(state: unknown): boolean {
  return recipeDepth(state) !== null;
}

// The depth to write into the state of a PUSH made from `state` (one entry deeper), or nothing.
export function pushDepth(state: unknown): { recipeDepth?: number } {
  const depth = recipeDepth(state);
  return depth === null ? {} : { recipeDepth: depth + 1 };
}

// The depth to write into the state of a REPLACE made from `state` (same distance), or nothing.
export function keepDepth(state: unknown): { recipeDepth?: number } {
  const depth = recipeDepth(state);
  return depth === null ? {} : { recipeDepth: depth };
}

// «Put the focus on your own title when you appear»: the entry's replace says it (the page itself keeps
// the focus, KEEP_FOCUS), and so does a move from the list (FROM_LIST).
export function wantsTitleFocus(state: unknown): boolean {
  return cameFromList(state) || (typeof state === 'object' && state !== null && 'focusTitle' in state);
}

// The state of the entry's replace and of the draft giving way: the app arranging itself (the page keeps
// the focus), the recipe link carried on, the target's title asked to take the focus.
export function entryState(incoming: unknown): Record<string, unknown> {
  return { ...KEEP_FOCUS, focusTitle: true, ...keepDepth(incoming), ...(cameFromRecipe(incoming) ? { fromRecipeLink: true } : {}) };
}

// How a screen opened from a recipe steps back to it.
//
// ⚠️ NEVER A SECOND ENTRY FOR THE RECIPE (the current app showed two pages per trip). The state counts how
// many history entries sit between this one and the recipe (recipeDepth: 1 right after the recipe's button,
// +1 for each push inside Food cost, unchanged by a replace), so Back is the browser's Back by exactly that
// many entries — from the narrowed list, but also from the product or history beside it on the split, where
// a plain «-1» is not enough. With no depth (an address typed, a reload that lost the state) the screen
// REPLACES itself with the recipe. Nothing happens for a null id.
export function useBackToRecipe(recipeId: string | null): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  const depth = recipeDepth(state);
  return useCallback(() => {
    if (recipeId === null) return;
    if (depth !== null) {
      void navigate(-depth);
      return;
    }
    const to = recipeAddress(recipeId);
    if (to !== null) void navigate(to, { replace: true });
  }, [navigate, depth, recipeId]);
}
