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

// The row that opens a supplier's order, the list icon of that row that opens «What they sell», and (on the split) its clipboard
// icon that opens the order summary.
export const supplierOpener = (id: string): string => `supplier:${id}`;
export const itemsOpener = (id: string): string => `items:${id}`;
export const summaryOpener = (id: string): string => `summary:${id}`;
// A supplier's screen: its «What they sell» button, where Back from the items list returns the focus.
export const ITEMS_DOOR = 'items-door';
// A supplier's screen: its «Summary (N)» button, where Back from the summary returns the focus.
export const SUMMARY_DOOR = 'summary-door';
// A supplier's screen: its «Order placed…» button, where Back from the confirm screen returns the focus.
export const PLACE_DOOR = 'place-door';
// The list's two buttons under the suppliers: «Order placed…» (the picker of the suppliers to record) and «Clear quantities…».
export const PLACE_ALL_OPENER = 'place-all';
export const CLEAR_OPENER = 'clear';
// The list's send arrow, beside the search box: where Back from the send screen returns the focus.
export const SEND_OPENER = 'send';
// The swap button of the list's head (step 3f-8b): where the focus lands once the view («by supplier» / «by ingredient») changed.
export const SWAP_OPENER = 'swap';
// The doors to the cards of «Ingredients & suppliers» (step 3f-8b): where the focus returns after the trip (cardTrip.ts). A name's
// button is registered under its ingredient's id and where it is; the others have one place each on the screen.
// ⚠️ THE NAME SAYS WHERE THE DOOR IS: on the split the flat view and a supplier's screen are mounted together, with the same ingredient
// in both, and one's unmounting must not delete the other's registration.
export const cardDoor = (id: string, where: 'flat' | 'supplier'): string => `card:${where}:${id}`;
export const ADD_DOOR = 'add-door';
export const SUPPLIER_DOOR = 'supplier-door';
// What the focus falls back to when the door is gone: the supplier screen's title, the lists' search box.
export const SUPPLIER_TITLE = 'supplier-title';
export const SEARCH_BOX = 'search-box';
// A pending banner's «Placed …» (the supplier's id), in the notices under the bell: where Back from its confirm screen returns the
// focus. Gone once the order was recorded: then the supplier's row takes it (pendingFallback).
export const pendingOpener = (id: string): string => `pending:${id}`;
// A closed supplier's chip in «Order today» (checklist item 3): where Back from the summary it opened returns the focus. Gone once the
// supplier is reopened or ordered: then the supplier's row takes it (pendingFallback).
export const todayOpener = (id: string): string => `today:${id}`;
// The summary's «Order placed…» (checklist item 3): where Back from the confirm screen it opened returns the focus.
export const SUMMARY_PLACE_DOOR = 'summary-place-door';
// Back to the list owed to a button that is gone: the supplier's row takes the focus instead. A pending banner goes once the order is
// recorded; a row's summary button goes once the supplier has no quantity left (another phone placed or cleared it while the summary
// was open), or when the window narrows below the split — without this the focus fell to the page (review of 3f-8c).
export const pendingFallback = (name: string): string | null => {
  if (name.startsWith('pending:')) return supplierOpener(name.slice('pending:'.length));
  if (name.startsWith('summary:')) return supplierOpener(name.slice('summary:'.length));
  if (name.startsWith('today:')) return supplierOpener(name.slice('today:'.length));
  return null;
};

export interface HandBack {
  // A control that opens a screen. null when it goes away.
  register(name: string, node: HTMLElement | null): void;
  // This opener's screen is open: give it the focus when the screen above is back.
  expect(name: string): void;
  // The screen above comes back by a move that is not a step back: nobody is owed the focus.
  forget(): void;
  // Gives the focus to the opener that was expected, if it is still there, and forgets it. Gone, `instead` may name another.
  deliver(instead?: (name: string) => string | null): void;
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
    deliver(instead) {
      const name = wanted.current;
      if (name === null) return;
      wanted.current = null;
      const fallback = instead?.(name);
      const row = openers.current.get(name) ?? (fallback ? openers.current.get(fallback) : undefined);
      if (row) reveal(row).focus();
    },
  }), []);
}

// The list's gear (step 3f-4): where Back from the Orders settings returns the focus.
export const SETTINGS_OPENER = 'settings';
// Settings' «Supplier order» door (step 3f-8a): where Back from the supplier order returns the focus.
export const SUPPLIER_ORDER_DOOR = 'supplier-order-door';
// The list's «History» door, beside the gear (3 Nov 2026, it was in the settings): where Back from History returns the focus.
export const HISTORY_DOOR = 'history-door';
// A History card's «Correct» button (the record's id), and a day's «Send all» (the day): where Back from the editor and from the
// day screen return the focus.
export const correctOpener = (id: string): string => `correct:${id}`;
export const sendDayOpener = (date: string): string => `send-day:${date}`;
// The list's two doors under the head (step 3f-5): where Back from Incoming and from «To re-order» returns the focus.
export const INCOMING_DOOR = 'incoming-door';
export const REORDER_DOOR = 'reorder-door';
// The list's «Order lists» door (step 3f-7): where Back from the lists returns the focus. And a card of that screen (the list's id):
// where Back from one list returns it.
export const LISTS_DOOR = 'lists-door';
export const listOpener = (id: string): string => `list:${id}`;
// An Incoming row (the order's id): where Back from «What arrived?» returns the focus.
export const arrivalOpener = (id: string): string => `arrival:${id}`;
