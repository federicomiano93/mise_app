import { createContext, useContext, useMemo, useRef } from 'react';

// Back from a product, a new product or Settings hands the focus back to the button that opened
// it, so a keyboard or screen-reader user lands where they left instead of at the top of the page.
//
// The buttons that open a screen one level down (a row, «New product», «Settings») register
// themselves here under a name; the section says which one it wants when it opens that screen (and
// the screen says it again when its own Back is pressed); once the list is on screen again, the
// section gives the focus to it — once. Wanted from the opening, so the phone's own back gesture
// (the browser's Back, which runs no code of the screen it leaves) hands the focus back too.
//
// (A copy of stocktake/handBack.ts with this section's openers: a feature never imports from
// another feature's folder.)

// The names the openers register under.
export const NEW_OPENER = 'new';
export const SETTINGS_OPENER = 'settings';
export const productOpener = (id: string): string => `product:${id}`;

export interface HandBack {
  // A button that opens a screen one level down. null when it goes away.
  register(name: string, node: HTMLElement | null): void;
  // This opener's screen is open: give it the focus when the list is back.
  expect(name: string): void;
  // The list comes back by a move that is not a step back: nobody is owed the focus.
  forget(): void;
  // Gives the focus to the opener that was expected — or, if that one is gone, to «New product» — and
  // forgets it.
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
      // ⚠️ THE OPENER MAY BE GONE (a product that was deleted has no row any more): «New product» is
      // always there, so the focus lands somewhere instead of dropping to the page.
      (openers.current.get(name) ?? openers.current.get(NEW_OPENER))?.focus();
    },
  }), []);
}
