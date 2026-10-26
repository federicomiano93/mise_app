import { createContext, useContext, useMemo, useRef } from 'react';

// Back from a supplier's screen hands the focus back to the button that opened it, so a keyboard or screen-reader user lands
// where they left instead of at the top of the page.
//
// The rows register themselves here under a name; the section says which one it wants when it opens a screen (and the
// screen says it again when its own Back is pressed); once the screen above is on show again, the section gives the focus
// to it — once. Wanted from the opening, so the phone's own back gesture (the browser's Back, which runs no code of the screen
// it leaves) hands the focus back too.
//
// (A copy of suppliers/handBack.ts, cut down to what the order list needs: a feature never imports from another feature's
// folder.)

// The row that opens a supplier's order, and the list icon of that row that opens «What they sell».
export const supplierOpener = (id: string): string => `supplier:${id}`;
export const itemsOpener = (id: string): string => `items:${id}`;
// A supplier's screen: its «What they sell» button, where Back from the items list returns the focus.
export const ITEMS_DOOR = 'items-door';

export interface HandBack {
  // A control that opens a screen. null when it goes away.
  register(name: string, node: HTMLElement | null): void;
  // This opener's screen is open: give it the focus when the screen above is back.
  expect(name: string): void;
  // The screen above comes back by a move that is not a step back: nobody is owed the focus.
  forget(): void;
  // Gives the focus to the opener that was expected, if it is still there, and forgets it.
  deliver(): void;
  // Gives the focus to a registered opener now; false when it is not there.
  focus(name: string): boolean;
}

const NOTHING: HandBack = {
  register() { /* no section around: nothing to hand back to */ },
  expect() { /* ditto */ },
  forget() { /* ditto */ },
  deliver() { /* ditto */ },
  focus: () => false,
};

// ⚠️ A ROW IN A CLOSED <details> CANNOT TAKE THE FOCUS: it is opened first (its own toggle event tells the list).
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

// The state behind the provider: one object for the life of the section, so it never re-renders whoever reads it.
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
    focus(name) {
      const node = openers.current.get(name);
      if (node) reveal(node).focus();
      return node !== undefined;
    },
    deliver() {
      const name = wanted.current;
      if (name === null) return;
      wanted.current = null;
      const row = openers.current.get(name);
      if (row) reveal(row).focus();
    },
  }), []);
}
