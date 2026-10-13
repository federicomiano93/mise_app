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
// The Dough history: the work view's door, the Add button, the History button of one log, and the titles that take
// the focus when a screen is left by a move that has no button to go back to (a log deleted, a version restored).
export const DOUGH_HISTORY_OPENER = 'dough-history';
export const ADD_LOG_OPENER = 'add-log';
export const LOG_HISTORY_OPENER = 'log-history';
export const EDIT_LOG_OPENER = 'edit-log';
export const LOG_LIST_TITLE = 'log-list-title';
export const LOG_HISTORY_TITLE = 'log-history-title';
// Orders received: the work view's door, and the banner above the tabs (either may be the one that opened it).
export const CLIENT_ORDERS_OPENER = 'client-orders';
export const ORDERS_BANNER_OPENER = 'orders-banner';
export const logOpener =(id: string): string => `log:${id}`;
export const versionOpener = (n: number): string => `version:${n}`;
// The openers that belong to the Dough history's LIST (its cards, its Add button, its title), which stays mounted
// beside the log that is open.
export const isListOpener = (name: string): boolean => name === ADD_LOG_OPENER || name === LOG_LIST_TITLE || name.startsWith('log:');
export const clientOpener = (id: string): string => `client:${id}`;
// The WhatsApp editor: the hub's door, a row of the top (a list or a direct client) and a client's card in a list.
export const WHATSAPP_OPENER = 'whatsapp';
export const whatsappItemOpener = (group: 'list' | 'direct', id: string): string => `whatsapp-${group}:${id}`;
export const whatsappEntryOpener = (clientId: string): string => `whatsapp-entry:${clientId}`;
export const recipeOpener = (id: string): string => `recipe:${id}`;
export const divisorRecipeOpener = (id: string): string => `divisor:${id}`;

export interface HandBack {
  // A button that opens a screen one level down. null when it goes away.
  register(name: string, node: HTMLElement | null): void;
  // This opener's screen is open: give it the focus when its parent is back.
  expect(name: string): void;
  // The parent comes back by a move that is not a step back: nobody is owed the focus.
  forget(): void;
  // The screen on top of the stack is being left by a move of its own (it deleted what it showed, it restored a
  // version): the opener it was owed is replaced by `name`, usually the title of the screen it lands on.
  replaceTop(name: string): void;
  // A screen has just appeared: if the opener on top of the stack is one of its own buttons, it takes the
  // focus. The root screen (the work view) is the bottom of the stack, so it also clears whatever is left.
  // `accepts` narrows «its own» by name, for a screen that appears BESIDE another one that is still mounted (the
  // Dough history's list and the log open next to it): a button of the screen that stays must not be handed the
  // focus by the one that has just arrived.
  deliver(root?: boolean, accepts?: (name: string) => boolean): void;
}

const NOTHING: HandBack = {
  register() { /* no section around: nothing to hand back to */ },
  expect() { /* ditto */ },
  forget() { /* ditto */ },
  replaceTop() { /* ditto */ },
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
    replaceTop(name) {
      wanted.current = [...wanted.current.slice(0, -1).filter(known => known !== name), name].slice(-DEPTH);
    },
    deliver(root = false, accepts) {
      const name = wanted.current[wanted.current.length - 1];
      const node = name === undefined || (accepts && !accepts(name)) ? undefined : openers.current.get(name);
      if (node) {
        wanted.current = wanted.current.slice(0, -1);
        node.focus();
      }
      if (root) wanted.current = [];
    },
  }), []);
}
