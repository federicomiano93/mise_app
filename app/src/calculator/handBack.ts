import { createContext, useContext, useMemo, useRef } from 'react';

// Back from Settings, or from a screen of it, hands the focus back to the button that opened it, so a keyboard
// or screen-reader user lands where they left instead of at the top of the page.
//
// The buttons that open a screen one level down register themselves here under a name; the parent says which
// one it wants when it opens the screen (a stack: the work view opened Settings, Settings opened Extra dough);
// when a screen comes back on screen it asks for the focus, and takes it only if the button on top of the stack
// is one of ITS OWN. Wanted from the opening, so the phone's back gesture (the browser's Back, which runs no
// code of the screen it leaves) hands the focus back too.
//
// (The same idea as foodcost/handBack.ts: a feature never imports from another feature's folder.)

// The names the openers register under.
export const SETTINGS_OPENER = 'settings';
export const ADD_RECIPE_OPENER = 'add-recipe';
export const CHOOSE_RECIPES_OPENER = 'choose-recipes';
export const CLIENTS_OPENER = 'clients';
export const RECIPES_OPENER = 'recipes';
export const EXTRA_OPENER = 'extra';
export const DIVISOR_OPENER = 'divisor';
export const LOG_OPENER = 'log';
export const ADD_CLIENT_OPENER = 'add-client';
export const ADD_RECIPE_ROW_OPENER = 'add-recipe-row';
export const clientOpener = (id: string): string => `client:${id}`;
export const recipeOpener = (id: string): string => `recipe:${id}`;
export const divisorRecipeOpener = (id: string): string => `divisor:${id}`;

export interface HandBack {
  // A button that opens a screen one level down. null when it goes away.
  register(name: string, node: HTMLElement | null): void;
  // This opener's screen is open: give it the focus when its parent is back.
  expect(name: string): void;
  // The parent comes back by a move that is not a step back: nobody is owed the focus.
  forget(): void;
  // A screen has just appeared: if the opener on top of the stack is one of its own buttons, it takes the
  // focus. The root screen (the work view) is the bottom of the stack, so it also clears whatever is left.
  deliver(root?: boolean): void;
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

// The most openers waiting at once: the work view, Settings and one screen of it, with room to spare.
const DEPTH = 8;

// The state behind the provider: one object for the life of the section, so it never re-renders whoever reads it.
export function useHandBackState(): HandBack {
  const openers = useRef(new Map<string, HTMLElement>());
  const wanted = useRef<string[]>([]);
  return useMemo<HandBack>(() => ({
    register(name, node) {
      if (node) openers.current.set(name, node);
      else openers.current.delete(name);
    },
    expect(name) {
      wanted.current = [...wanted.current.filter(known => known !== name), name].slice(-DEPTH);
    },
    forget() {
      wanted.current = [];
    },
    deliver(root = false) {
      const name = wanted.current[wanted.current.length - 1];
      const node = name === undefined ? undefined : openers.current.get(name);
      if (node) {
        wanted.current = wanted.current.slice(0, -1);
        node.focus();
      }
      if (root) wanted.current = [];
    },
  }), []);
}
