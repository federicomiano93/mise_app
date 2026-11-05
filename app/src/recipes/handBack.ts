import { createContext, useContext, useMemo, useRef } from 'react';

// Back from a recipe hands the focus back to the row that opened it, so a keyboard or screen-reader
// user lands where they left instead of at the top of the page.
//
// The rows register themselves here under a name; the section says which one it wants when it opens
// a recipe (and the screen says it again when its own Back is pressed); once the list is on screen
// again, the section gives the focus to it — once. Wanted from the opening, so the phone's own back
// gesture (the browser's Back, which runs no code of the screen it leaves) hands the focus back too.
//
// (A copy of foodcost/handBack.ts with this section's opener: a feature never imports from another
// feature's folder.)

export const recipeOpener = (id: string): string => `recipe:${id}`;
// The door to the Allergen sheet, at the foot of the list: Back from the sheet returns the focus to it.
export const ALLERGENS_OPENER = 'allergens-door';
// A row of the Allergen sheet: Back from a recipe opened from the sheet returns the focus to its row.
export const sheetOpener = (id: string): string => `sheet:${id}`;
// The list's search box: where the focus goes when the row it is owed no longer exists.
export const SEARCH_OPENER = 'search';
// The door to the label Settings, at the foot of the list (after the Allergen sheet's): Back from Settings returns the focus to it.
export const SETTINGS_OPENER = 'settings-door';
// The «New recipe» button at the top of the list: Back from a new recipe's editor returns the focus to it.
export const NEW_OPENER = 'new-door';

export interface HandBack {
  // A row that opens a recipe. null when it goes away.
  register(name: string, node: HTMLElement | null): void;
  // This opener's recipe is open: give it the focus when the list is back.
  expect(name: string): void;
  // The list comes back by a move that is not a step back: nobody is owed the focus.
  forget(): void;
  // Gives the focus to the opener that was expected, if its row is still there, and forgets it.
  deliver(): void;
}

const NOTHING: HandBack = {
  register() { /* no section around: nothing to hand back to */ },
  expect() { /* ditto */ },
  forget() { /* ditto */ },
  deliver() { /* ditto */ },
};

// ⚠️ A ROW IN THE FOLDED «Archived» GROUP CANNOT TAKE THE FOCUS while its <details> is closed: it is opened first, and its own
// toggle event tells the list, whose open state follows. (The idea of suppliers/handBack.ts, copied: a feature never imports
// another feature's folder.)
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
export function useHandBackState(): HandBack {
  const openers = useRef(new Map<string, HTMLElement>());
  const wanted = useRef<string | null>(null);
  return useMemo<HandBack>(() => ({
    register(name, node) {
      if (node) openers.current.set(name, node);
      else openers.current.delete(name);
    },
    expect(name) {
      wanted.current = name;
    },
    forget() {
      wanted.current = null;
    },
    deliver() {
      const name = wanted.current;
      if (name === null) return;
      wanted.current = null;
      const row = openers.current.get(name);
      if (row) {
        reveal(row).focus();
        return;
      }
      // ⚠️ A RECIPE THAT WAS DELETED HAS NO ROW ANY MORE. If the focus fell to the page with the screen
      // that held it, it goes to the search box (a keyboard or screen-reader user would otherwise be
      // left at the top of nowhere); if it is somewhere real, it stays there.
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) openers.current.get(SEARCH_OPENER)?.focus();
    },
  }), []);
}
