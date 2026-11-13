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
// The listener below is added before the router's own, so it runs first: it takes the token out and
// puts back the screen the app was on, so the router sees no move at all and nothing typed is lost.

import { createJoinFlow, takeJoinLink } from './joinFlow';
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

// The screen the app is on, as a fragment ('#/orders'), for the listener below. Set by main.tsx once
// the router exists (this module must not import it: that would run the router first).
let currentScreen: () => string = () => '';
export function setJoinLinkReturn(screen: () => string): void {
  currentScreen = screen;
}

export const joinFlow = createJoinFlow(windowStorage());

const atStart = takeJoinLink(window);
if (atStart) joinFlow.remember(atStart);

function onAddressChange(): void {
  let back = '';
  try { back = currentScreen(); } catch { /* the router is not there yet: the app's start */ }
  const token = takeJoinLink(window, back);
  if (token) joinFlow.remember(token);
}
window.addEventListener('popstate', onAddressChange);
window.addEventListener('hashchange', onAddressChange);
