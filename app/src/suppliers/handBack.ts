import { createContext, useContext, useMemo, useRef } from 'react';
import type { SupplierDeletions } from './supplierDeletions';

// Back from a supplier hands the focus back to the row that opened it, so a keyboard or screen-reader
// user lands where they left instead of at the top of the page.
//
// The rows register themselves here under a name; the section says which one it wants when it opens
// a supplier (and the screen says it again when its own Back is pressed); once the list is on screen
// again, the section gives the focus to it — once. Wanted from the opening, so the phone's own back
// gesture (the browser's Back, which runs no code of the screen it leaves) hands the focus back too.
//
// (A copy of recipes/handBack.ts with this section's opener: a feature never imports from another
// feature's folder.)

const OPENER_PREFIX = 'supplier:';
export const supplierOpener = (id: string): string => `${OPENER_PREFIX}${id}`;
// The list's search box: where the focus goes when the row it is owed no longer exists.
export const SEARCH_OPENER = 'search';
// The «New supplier» button at the top of the list: Back from a new supplier's card returns the focus to it.
export const NEW_OPENER = 'new-door';
// The door to Settings, at the foot of the list: Back from Settings returns the focus to it.
export const SETTINGS_OPENER = 'settings-door';
// The door to «Import from invoices», beside the one to Settings: Back from the import returns the focus to it.
export const IMPORT_OPENER = 'import-door';
// The door to «Price changes», right after the import's: Back from the report returns the focus to it.
export const PRICE_CHANGES_OPENER = 'price-changes-door';
// An ingredient or packaging row of a list: Back from its card returns the focus to it.
export const itemOpener = (id: string): string => `item:${id}`;
// The same item on a supplier's own screen, and that screen's «Add ingredient» button.
export const supplierItemOpener = (id: string): string => `supplier-item:${id}`;
export const ADD_INGREDIENT_OPENER = 'add-ingredient';

export interface HandBack {
  // A row that opens a supplier. null when it goes away.
  register(name: string, node: HTMLElement | null): void;
  // This opener's supplier is open: give it the focus when the list is back.
  expect(name: string): void;
  // The list comes back by a move that is not a step back: nobody is owed the focus.
  forget(): void;
  // Gives the focus to the opener that was expected, if its row is still there, and forgets it.
  deliver(): void;
  // A supplier's card is closing: its screen is owed the focus on «Edit» when it is drawn again. Taken once, for that
  // supplier only.
  wantEdit(id: string): void;
  takeEdit(id: string): boolean;
  // An ingredient's card opened from a supplier's screen is closing: that screen is owed the focus on `opener` (the row, or
  // «Add ingredient») when it is drawn again. Taken once, for that supplier only; null when nothing is owed.
  wantOn(supplierId: string, opener: string): void;
  takeOn(supplierId: string): string | null;
  // Gives the focus to a registered opener now; false when it is not there.
  focus(name: string): boolean;
}

const NOTHING: HandBack = {
  register() { /* no section around: nothing to hand back to */ },
  expect() { /* ditto */ },
  forget() { /* ditto */ },
  deliver() { /* ditto */ },
  wantEdit() { /* ditto */ },
  takeEdit: () => false,
  wantOn() { /* ditto */ },
  takeOn: () => null,
  focus: () => false,
};

// ⚠️ A ROW IN A FOLDED GROUP («Not in use», 3e-5b) CANNOT TAKE THE FOCUS while its <details> is closed: it is opened first, and
// its own toggle event tells the list, whose open state follows. Without it a just-switched-off item's Save left the focus at the
// top of the page (found driving it at 1024/360/296).
function reveal(node: HTMLElement): HTMLElement {
  const group = node.closest('details');
  if (group && !group.open) group.open = true;
  return node;
}

const HandBackContext = createContext<HandBack>(NOTHING);
export const HandBackProvider = HandBackContext.Provider;

export function useHandBack(): HandBack {
  return useContext(HandBackContext);
}

// The state behind the provider: one object for the life of the section, so it never re-renders
// whoever reads it.
//
// `deletions` are the suppliers this phone has just deleted: their row may still be in the list while the delete travels, and
// the focus must not go to a row that is about to disappear.
export function useHandBackState(deletions: SupplierDeletions): HandBack {
  const openers = useRef(new Map<string, HTMLElement>());
  const wanted = useRef<string | null>(null);
  const editOf = useRef<string | null>(null);
  const onSupplier = useRef<{ supplierId: string; opener: string } | null>(null);
  // The opener whose row went away while it held the focus, until the end of that commit.
  const moving = useRef<string | null>(null);
  return useMemo<HandBack>(() => ({
    register(name, node) {
      if (node) {
        openers.current.set(name, node);
        // ⚠️ A ROW THAT MOVES KEEPS THE FOCUS (3e-5b): an item switched off goes from the list into the «Not in use» group (and
        // back), which is a NEW element in the same commit. Measured at 1024: Back handed the focus to the row, the store's
        // answer then moved it, and the focus fell to the top of the page.
        if (moving.current === name) {
          moving.current = null;
          reveal(node).focus();
        }
      } else {
        // React lets go of the ref before it takes the element out, so the element still knows it has the focus.
        const old = openers.current.get(name);
        if (old !== undefined && old === document.activeElement) {
          moving.current = name;
          // Only a row drawn again in the SAME commit is the same row moving: anything later is a different story.
          queueMicrotask(() => { if (moving.current === name) moving.current = null; });
        }
        openers.current.delete(name);
      }
    },
    expect(name) {
      wanted.current = name;
    },
    forget() {
      wanted.current = null;
    },
    wantEdit(id) {
      editOf.current = id;
    },
    takeEdit(id) {
      if (editOf.current !== id) return false;
      editOf.current = null;
      return true;
    },
    wantOn(supplierId, opener) {
      onSupplier.current = { supplierId, opener };
    },
    takeOn(supplierId) {
      const owed = onSupplier.current;
      if (owed === null || owed.supplierId !== supplierId) return null;
      onSupplier.current = null;
      return owed.opener;
    },
    focus(name) {
      const node = openers.current.get(name);
      if (node) reveal(node).focus();
      return node !== undefined;
    },
    deliver() {
      const name = wanted.current;
      if (name === null) return;
      wanted.current = null;
      const deleted = name.startsWith(OPENER_PREFIX) && deletions.has(name.slice(OPENER_PREFIX.length));
      const row = deleted ? undefined : openers.current.get(name);
      if (row) {
        reveal(row).focus();
        return;
      }
      // ⚠️ A SUPPLIER THAT WAS DELETED HAS NO ROW ANY MORE. If the focus fell to the page with the screen
      // that held it, it goes to the search box (a keyboard or screen-reader user would otherwise be
      // left at the top of nowhere); if it is somewhere real, it stays there.
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) openers.current.get(SEARCH_OPENER)?.focus();
    },
  }), [deletions]);
}
