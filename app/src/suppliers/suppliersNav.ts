import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { KEEP_FOCUS } from '../shell/Page';
import type { SuppliersTab } from './suppliersPath';

// What the list puts in the navigation `state` when it opens a supplier one level down: «you came from
// the list, so Back is the browser's Back». KEEP_FOCUS comes with it: the page then leaves the focus
// alone, and the screen that opens puts it on its own title.
//
// (A copy of recipes/recipesNav.ts: a feature never imports from another feature's folder.)
export const FROM_LIST = { ...KEEP_FOCUS, fromList: true } as const;

export function cameFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromList' in state;
}

// The same, from a supplier's own screen to its card (its «Edit»): Back from the card is the browser's Back, which lands on
// the supplier. Deliberately NOT `fromList`: the card is two levels below the list, and the supplier it comes back to knows
// by its own entry how it was opened.
export const FROM_SUPPLIER = { ...KEEP_FOCUS, fromSupplier: true } as const;

export function cameFromSupplier(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromSupplier' in state;
}

// How a supplier steps back up to the list.
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

// An ingredient's or packaging item's card, opened from the list: Back is the browser's Back, and the state also carries
// the tab the list was on, so the same tab stays beside the card (a packaging item opened from the Ingredients tab by its
// address would otherwise show the Packaging tab).
export const fromListTab = (tab: SuppliersTab) => ({ ...FROM_LIST, tab }) as const;

export function tabOfState(state: unknown): SuppliersTab | null {
  if (typeof state !== 'object' || state === null || !('tab' in state)) return null;
  const tab = (state as { tab: unknown }).tab;
  return tab === 'ingredients' || tab === 'suppliers' || tab === 'packaging' ? tab : null;
}

// The same card, opened from a supplier's own screen («What they sell», «Add ingredient»): Back is the browser's Back, which
// lands on that supplier's screen, and the list beside the card stays on the Suppliers tab.
export const fromSupplierScreen = (supplierId: string) => ({ ...KEEP_FOCUS, fromSupplierScreen: supplierId }) as const;

export function supplierScreenOf(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('fromSupplierScreen' in state)) return null;
  const id = (state as { fromSupplierScreen: unknown }).fromSupplierScreen;
  return typeof id === 'string' ? id : null;
}

// Did the card's own Back have a screen to step back to (the list, or a supplier's screen)?
export const cameFromListOrSupplierScreen = (state: unknown): boolean => cameFromList(state) || supplierScreenOf(state) !== null;
