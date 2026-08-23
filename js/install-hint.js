// install-hint.js — whether somebody who has JUST joined should be shown how to put
// the app on their phone's home screen. PURE (no DOM, no Firestore, no storage of its
// own), so every silence below is asserted in a unit test rather than hunted for on a
// screen that is supposed to stay quiet (P15).
//
// ⚠️⚠️ WHY THIS EXISTS AT ALL. An invitation link lands somebody in the app inside a
// BROWSER TAB, and nothing ever told them the app is meant to live on their home
// screen. The sign-in screen carries a link to install-guide.html — but whoever
// arrives by invitation never sees the sign-in screen: the link takes them straight
// to the join form. So the one person who most needs the guide was the one person
// structurally unable to reach it.
//
// ⚠️⚠️ AND THE ORDER IS NOT A PREFERENCE, IT IS A CONSTRAINT. Telling them to install
// FIRST would be the natural instruction and it would lose the invitation: the code
// travels in the URL fragment, and an installed app always starts from its own
// start_url with no fragment on it. Join first, install second — which is why this is
// offered AFTER the join and not in the message that carried the link.

// ⚠️ localStorage, NOT sessionStorage, and this is the one place the difference
// matters. Joining ends with location.reload() (js/auth-gate.js), and on iOS a
// reload after a sign-in can land in a fresh page context; more to the point, the
// notice waits for the Home, the splash and any other dialog, and an app closed in
// that gap must still be told. A flag that dies with the window would be spent by
// somebody who never saw it — the exact fault js/install-version-boot.js records in
// its own comment about when to adopt.
export const JUST_JOINED_KEY = 'just-joined';

function read(storage) {
  try { return storage.getItem(JUST_JOINED_KEY) === '1'; } catch { return false; }
}

function clear(storage) {
  try { storage.removeItem(JUST_JOINED_KEY); } catch { /* private mode */ }
}

// Called the moment a join succeeds, before the reload that picks up the membership.
export function markJustJoined(storage) {
  try { storage.setItem(JUST_JOINED_KEY, '1'); return true; } catch { return false; }
}

// ⚠️ THE SILENCES ARE THE DESIGN, exactly as in js/install-version.js. This notice is
// worth showing once to somebody who has just been handed a way in; it is worth
// nothing to anybody else, and a notice that appears when it has nothing to say is
// how a notice stops being read.
//
//   nobody just joined            → silent, and nothing is written
//   already an installed app      → silent, AND the flag is dropped: somebody who
//                                   joined inside the installed app has done the very
//                                   thing this would ask them to do
//   storage unreadable            → silent (a private window is not a broken app)
//
// ⚠️ IT RETURNS AN `adopt`, IT DOES NOT CLEAR ON ITS OWN. The caller has to wait for
// the Home, the splash and any other dialog first, and it must spend the one notice
// only when it is actually about to show it — the same order, for the same reason, as
// js/install-version-boot.js.
export function checkInstallHint({ storage, standalone }) {
  const silent = { offer: false, adopt() {} };
  if (!read(storage)) return silent;
  if (standalone) { clear(storage); return silent; }
  return { offer: true, adopt: () => clear(storage) };
}
