// local-data.ts — wipe this device's cached copies of a location's data when the session changes
// (sign out, or switch to another location).
//
// TypeScript port of js/local-data.js for Mise 2. Behaviour is identical, input for input:
// local-data.spec.ts runs every test against BOTH files and parity.spec.ts compares their exports.
//
// ⚠️ ONE ORIGIN, ONE STORAGE. Mise 2 is served from the same address as the current app, so the
// two share localStorage AND the Firestore/Auth IndexedDB. Either app's sign-out or venue switch
// runs this same list over the other's keys: a key Mise 2 must keep across a venue switch has to
// start with a prefix below — in BOTH files — or the current app will wipe it.
//
// THE DEFAULT IS TO CLEAR: everything except an explicit keep list goes, so a cache added in six
// months that nobody remembers to list is cleared (one refetch) rather than leaked between two
// businesses on a shared phone.

// ── The OTHER copy: Firestore's own offline database ────────────────────────────────────────
// ⚠️⚠️ localStorage is only half of what a phone keeps (security audit, 23 Sep 2026): Firestore's
// offline cache holds every document read — a manager's ingredient prices included — and answers
// with no signal, where the rules are never asked. Sign-out and a venue switch wipe it; this
// decides the one case they cannot see: a DIFFERENT person arriving without the previous one
// signing out (an expired or revoked session).
export const OFFLINE_CACHE_OWNER_KEY = 'offline-cache-uid';

export type OfflineCacheVerdict = 'claim' | 'keep' | 'wipe';

// What to do with the offline copy for the account a page opened with.
//   'claim' — nobody is recorded yet: record this account, keep the copy
//   'keep'  — the copy is this account's own
//   'wipe'  — the copy belongs to somebody else: clear it before anything is read
// ⚠️ ASKED ONLY WHEN A PAGE BOOTS, never on a sign-in inside a page: a join replaces the person
// mid-page and reloads by itself, and wiping half-way could cut the invitation off.
export function offlineCacheVerdict(owner: unknown, uid: unknown): OfflineCacheVerdict {
  if (!uid) return 'keep';
  if (!owner) return 'claim';
  return owner === uid ? 'keep' : 'wipe';
}

// Prefixes that must SURVIVE a session change, and why each one is here.
export const KEEP_PREFIXES: readonly string[] = Object.freeze([
  'firebase:',            // Firebase Auth's own session — clearing it logs you back out
  'firebaseLocalStorage', // ditto (SDK fallback storage)
  'uk-bank-holidays',     // public data, belongs to nobody
  'whats-new-seen',       // about the app version you have seen, not about a location
  'active-location',      // which location to open next — managed by the session itself
  // WHOSE data the offline database holds: it has to outlive a venue switch, or the next boot
  // could not tell a new person from the old.
  OFFLINE_CACHE_OWNER_KEY,
  // Kiosk mode: a setting of THIS DEVICE (a lab tablet), not of a person or a venue.
  'kiosk-',
  // The device count: this device's random id and the day each account last reported. Wiped on
  // every switch, one phone would count as a new device each time.
  'device-id',
  'device-ping-',
  // The error reports' daily throttle: wiped on a sign-out, signing out and in again would be a
  // way round the daily cap.
  'error-reports',
  // The usage record: the day's accumulator IS the truth; wiped, the next write would carry
  // smaller totals and replace the bigger line on the server.
  'usage-',
]);

// Given every key currently in storage, which ones must go.
export function keysToClear(allKeys: unknown, keepPrefixes: readonly string[] = KEEP_PREFIXES): string[] {
  // As the original: anything falsy is "no keys", and a non-list throws rather than guessing.
  return ((allKeys || []) as unknown[]).filter((key): key is string =>
    typeof key === 'string' && !keepPrefixes.some(prefix => key.startsWith(prefix)));
}

// Does OPENING a location have to wipe this device's cache first? Clearing on the way OUT is not
// enough: an expired or revoked session lands on the sign-in form with the previous location's
// data still stored. SAME location → KEEP (the cache belongs to the venue, not the person).
// Nothing remembered → CLEAR (harmless when empty, and exactly the case where an old cache could
// leak into a new venue).
export function shouldClearLocalData(remembered: unknown, opening: unknown): boolean {
  if (!opening) return false;         // nothing is being opened; nothing to decide
  return remembered !== opening;
}

// The one thing clearLocalData needs from a Storage (shared/ has no DOM types).
export interface KeyedStorage { removeItem(key: string): void }

// Apply it to real storage. Returns how many keys were removed.
export function clearLocalData(
  storage: KeyedStorage | null | undefined = (globalThis as { localStorage?: KeyedStorage }).localStorage,
): number {
  if (!storage) return 0;
  let keys: string[] = [];
  try { keys = Object.keys(storage); } catch { return 0; } // private mode / blocked
  const doomed = keysToClear(keys);
  doomed.forEach(key => { try { storage.removeItem(key); } catch { /* ignore */ } });
  return doomed.length;
}
