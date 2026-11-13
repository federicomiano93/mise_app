// joinLinkBoot.ts — the page's join flow, with the join link read and taken out of the address.
//
// ⚠️⚠️ IMPORTED FIRST BY main.tsx, AND THAT ORDER IS THE SECURITY OF THE LINK (main.spec.ts pins it).
// ES modules run in import order, and the router (router.ts creates the hash router as it is
// imported, and starts listening to the address at once) and the telemetry come later: by the time
// either looks at the address, the token is gone from it and from the history entry. A `#join=…`
// left there would also be read by the router as a page and drawn as «Not found».
//
// ⚠️ A LINK OPENED IN A TAB ALREADY RUNNING THE APP CHANGES ONLY THE FRAGMENT, and the browser does
// not reload for that (the current app paid for this one: js/auth-gate.js, the hashchange listener).
// The browser pushes a new history entry with no state. The listener below is added before the
// router's own, so it runs first: it takes the token out, rewrites that entry as the screen the app
// was on WITH THE ROUTER'S OWN HISTORY STATE (its key and index), and stops the event, so the router
// never sees a move. Left to the router, an entry with no index would make it skip every «Leave?»
// question (useBlocker) on a later Back across it (code review, 13 Nov 2026). The entry stays in the
// tab's history as a copy of the screen before it: the first Back after such a link shows the same
// screen once more. Cannot be helped: the entry was made by the browser, not by the app.
//
// ⚠️ WHAT NO PAGE CAN DO: the browser's own global history (and the address bar's suggestions) keeps
// the address it was asked to open, `#join=…` included. replaceState cleans the tab's Back history
// and the address bar, not that list. The current app has the same exposure, for longer. A link is
// single use and dies in 24 hours.

import { createJoinFlow, hasJoinField, takeJoinLink } from './joinFlow';
import type { KeyValueStorage } from './backend';

// sessionStorage can itself throw (blocked site data); such a window remembers the invitation only
// as long as the page, which is the safe way to fail.
function windowStorage(): KeyValueStorage {
  const target = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };
  return {
    getItem: key => target()?.getItem(key) ?? null,
    setItem: (key, value) => { target()?.setItem(key, value); },
    removeItem: key => { target()?.removeItem(key); },
  };
}

// The screen the app is on, as a fragment ('#/orders'), and the router's history state for it, for the
// listener below. Set by main.tsx once the router exists (this module must not import it: that would
// run the router first).
export interface ReturnPoint {
  readonly fragment: string;
  readonly state: unknown;
}
let currentScreen: () => ReturnPoint = () => ({ fragment: '', state: null });
export function setJoinLinkReturn(screen: () => ReturnPoint): void {
  currentScreen = screen;
}

export const joinFlow = createJoinFlow(windowStorage());

const atStart = takeJoinLink(window);
if (atStart) joinFlow.remember(atStart);

function onAddressChange(event: Event): void {
  if (!hasJoinField(window.location.hash)) return;
  // Nobody after this listener (the router) hears of this entry: it is about to become the screen the app is already on.
  event.stopImmediatePropagation();
  let back: ReturnPoint = { fragment: '', state: null };
  try { back = currentScreen(); } catch { /* the router is not there yet: the app's start */ }
  const token = takeJoinLink(window, back.fragment, back.state);
  if (token) joinFlow.remember(token);
}
window.addEventListener('popstate', onAddressChange);
window.addEventListener('hashchange', onAddressChange);
