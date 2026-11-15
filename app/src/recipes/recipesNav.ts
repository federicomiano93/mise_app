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

// The same, from a row of the HACCP list to that recipe's HACCP label (image labels step 2): Back from the label is the browser's
// Back, and the focus is owed to the row. Deliberately NOT `fromList`: the label is not a recipe opened from the list.
export const FROM_HACCP = { ...KEEP_FOCUS, fromHaccp: true } as const;

// The same, from a recipe link of the ingredient book (14 Nov 2026): Back from the recipe is the browser's Back and returns to the
// book, and the focus is owed to the link that was followed (`ingredientRow`, its hand-back name). Like the sheet's, NOT a recipe
// «from the list» for the editor's two-step return (RecipeView), though it carries `fromList` for the recipe's own Back.
export const fromIngredients = (ingredientRow: string) => ({ ...FROM_LIST, fromIngredients: true, ingredientRow }) as const;

export function cameFromIngredients(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromIngredients' in state;
}

// The hand-back name of the ingredient book's link that opened this recipe, or null.
export function ingredientRowOf(state: unknown): string | null {
  if (!cameFromIngredients(state)) return null;
  const row = (state as { ingredientRow?: unknown }).ingredientRow;
  return typeof row === 'string' && row !== '' ? row : null;
}

// The same two moves, made from the «Labels» section's list of recipes (app/src/labels, 13 Nov 2026) into this section's own
// label screens. Each carries the marker its screen already reads, so the screen is the very one the recipe and the HACCP list
// open, with no branch of its own: Back is the browser's Back, which is the Labels list one step behind it, and the screen puts
// the focus on its title when it opens. `fromLabels` only says where the move started, for whoever needs to tell it apart.
export const FROM_LABELS_PRODUCT = { ...FROM_RECIPE, fromLabels: true } as const;
export const FROM_LABELS_HACCP = { ...FROM_HACCP, fromLabels: true } as const;

export function cameFromHaccp(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromHaccp' in state;
}

export function cameFromRecipe(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromRecipe' in state;
}

// Set on the recipe's «Edit» navigation: the recipe entry itself was opened from the LIST (not the Allergen sheet, not an
// address), so [list, recipe, editor] are all behind a Save or a Delete and one jump of two steps lands before the list.
export function recipeCameFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'recipeFromList' in state && state.recipeFromList === true;
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
