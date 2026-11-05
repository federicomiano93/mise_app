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
// A supplier's screen: its «Order placed…» button, where Back from the confirm screen returns the focus.
export const PLACE_DOOR = 'place-door';
// The list's two buttons under the suppliers: «Order placed…» (the picker of the suppliers to record) and «Clear quantities…».
export const PLACE_ALL_OPENER = 'place-all';
export const CLEAR_OPENER = 'clear';
// The list's send arrow, beside the search box: where Back from the send screen returns the focus.
export const SEND_OPENER = 'send';

export interface HandBack {
  // A control that opens a screen. null when it goes away.
  register(name: string, node: HTMLElement | null): void;
  // This opener's screen is open: give it the focus when the screen above is back.
  expect(name: string): void;
  // The screen above comes back by a move that is not a step back: nobody is owed the focus.
  forget(): void;
  // Gives the focus to the opener that was expected, if it is still there, and forgets it.
  deliver(): void;
  // Like deliver(), but only when the opener that is expected is this one: a screen that must not take the focus from
  // another opener's hand-back (a supplier opened FROM the list) asks for its own door only.
  deliverIf(name: string): void;
  // Like deliverIf(), for an opener whose name is built from an id (a card's button): any expected name the test accepts.
  deliverWhere(accepts: (name: string) => boolean): void;
  // Gives the focus to a registered opener now; false when it is not there.
  focus(name: string): boolean;
}

const NOTHING: HandBack = {
  register() { /* no section around: nothing to hand back to */ },
  expect() { /* ditto */ },
  forget() { /* ditto */ },
  deliver() { /* ditto */ },
  deliverIf() { /* ditto */ },
  deliverWhere() { /* ditto */ },
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
    deliverWhere(accepts) {
      if (wanted.current !== null && accepts(wanted.current)) this.deliver();
    },
    deliverIf(name) {
      if (wanted.current === name) this.deliver();
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

// The list's gear (step 3f-4): where Back from the Orders settings returns the focus.
export const SETTINGS_OPENER = 'settings';
// The settings screen's «Past orders» door: where Back from History returns the focus.
export const HISTORY_DOOR = 'history-door';
// A History card's «Correct» button (the record's id), and a day's «Send all» (the day): where Back from the editor and from the
// day screen return the focus.
export const correctOpener = (id: string): string => `correct:${id}`;
export const sendDayOpener = (date: string): string => `send-day:${date}`;
// The list's two doors under the head (step 3f-5): where Back from Incoming and from «To re-order» returns the focus.
export const INCOMING_DOOR = 'incoming-door';
export const REORDER_DOOR = 'reorder-door';
// An Incoming row (the order's id): where Back from «What arrived?» returns the focus.
export const arrivalOpener = (id: string): string => `arrival:${id}`;
