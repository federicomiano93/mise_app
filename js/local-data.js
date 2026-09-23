// local-data.js — wipe this device's cached copies of a location's data when
// the session changes (log out, or switch to another location).
//
// WHY IT MATTERS. The app keeps local copies so it opens instantly and survives
// a bad connection: the calculator's configuration, the recipe catalogue, the
// logs, the Orders settings, and every quantity typed into the calculator. Those
// are one location's data sitting in a phone's storage. Without this, switching
// locations would show the previous one's recipes and settings until the
// network answered — on a shared device, that is a leak between two businesses.
//
// THE DEFAULT IS TO CLEAR. keysToClear removes everything except an explicit keep
// list, rather than removing a list of known caches. The difference shows up in
// six months, when a new cache is added and nobody remembers this file: with a
// clear-list it would leak silently; this way it is simply cleared, which at
// worst costs one refetch.

// Prefixes that must SURVIVE a session change, and why each one is here.
import { t } from './i18n.js';

// ── The OTHER copy: Firestore's own offline database ─────────────────────────
//
// ⚠️⚠️ THE KEYS ABOVE ARE ONLY HALF OF WHAT A PHONE KEEPS (security audit, 23 Sep 2026).
// Firestore's offline cache (js/firebase.js) holds every document the app has read —
// a manager's ingredient prices included — in IndexedDB, and clearing localStorage
// never touched it. On a shared phone the next person could read them with no signal,
// where the rules are not asked. js/firebase.js now wipes it on sign-out and on a
// venue switch; this decides the one case those two cannot see: a DIFFERENT person
// arriving without the previous one signing out (an expired or revoked session).
export const OFFLINE_CACHE_OWNER_KEY = 'offline-cache-uid';

// What to do with the offline copy for the account a page opened with.
//   'claim' — nobody is recorded yet: record this account, keep the copy
//   'keep'  — the copy is this account's own
//   'wipe'  — the copy belongs to somebody else: clear it before anything is read
// ⚠️ ASKED ONLY WHEN A PAGE BOOTS, never on a sign-in inside a page. A join that
// creates an account replaces the person mid-page and then reloads by itself; wiping
// in the middle of it could cut the invitation off half-way. The next boot is before
// any read, so that is where the question is asked.
export function offlineCacheVerdict(owner, uid) {
  if (!uid) return 'keep';
  if (!owner) return 'claim';
  return owner === uid ? 'keep' : 'wipe';
}

export const KEEP_PREFIXES = Object.freeze([
  'firebase:',            // Firebase Auth's own session — clearing it logs you back out
  'firebaseLocalStorage', // ditto (SDK fallback storage)
  'uk-bank-holidays',     // public data, belongs to nobody
  'whats-new-seen',       // about the app version you have seen, not about a location
  'lastHiddenAt',         // idle-reset timer
  'active-location',    // which location to open next — managed by the session itself
  // WHOSE data the offline database copy holds (see offlineCacheVerdict below). It has
  // to outlive a venue switch, or the next boot could not tell a new person from the old.
  OFFLINE_CACHE_OWNER_KEY,
]);

// Given every key currently in storage, which ones must go.
export function keysToClear(allKeys, keepPrefixes = KEEP_PREFIXES) {
  return (allKeys || []).filter(key =>
    typeof key === 'string' && !keepPrefixes.some(prefix => key.startsWith(prefix)));
}

// Does OPENING a location have to wipe this device's cache first?
//
// Clearing on the way OUT (sign out, switch location) is not enough on its own: a
// phone can reach the sign-in form without ever passing through those. A session
// that expires or is revoked, and the leftover ANONYMOUS session that firebase.js
// discards by itself, both land on the form with the previous location's recipes,
// settings and typed quantities still in storage. Whoever signs in next would see
// them until the network replaced them — and offline they would simply stay.
//
// So the question is asked again on the way IN, where it can be answered from the
// only fact that matters: is the location being opened the one this cache belongs to?
//
// SAME location → KEEP. The cache belongs to the LOCATION, not to the person: two
// people from the same venue sharing a phone must find the app ready, not emptied.
// Nothing is gained by clearing there, and instant start-up is lost.
//
// Nothing remembered (a fresh install, or a phone coming from the pre-login app that
// never wrote this key) → CLEAR. Harmless when storage is empty, and it is exactly
// the case where an old single-venue cache could otherwise leak into a new venue.
export function shouldClearLocalData(remembered, opening) {
  if (!opening) return false;         // nothing is being opened; nothing to decide
  return remembered !== opening;
}

// Apply it to real storage. Returns how many keys were removed.
export function clearLocalData(storage = globalThis.localStorage) {
  if (!storage) return 0;
  let keys = [];
  try { keys = Object.keys(storage); } catch { return 0; } // private mode / blocked
  const doomed = keysToClear(keys);
  doomed.forEach(key => { try { storage.removeItem(key); } catch { /* ignore */ } });
  return doomed.length;
}
