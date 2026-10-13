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
      // A recipe that was deleted has no row any more: the focus then stays where it is.
      openers.current.get(name)?.focus();
    },
  }), []);
}
