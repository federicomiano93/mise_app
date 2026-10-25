// Unit tests for the local cache wipe (P15), run against BOTH implementations: the TypeScript port
// in shared/ and the js/ file the live app uses today. Ported from tests/local-data.test.mjs; the
// two must stay equal until the switch to Mise 2 — they share ONE origin and so ONE localStorage,
// and either app's sign-out runs its list over the other's keys.
//
// Two failures matter here and they are opposites:
//   - keeping a location's cached data after a switch → the next location briefly sees the
//     previous one's recipes and settings;
//   - clearing Firebase's own auth storage → signing in immediately signs you back out, and the
//     app looks broken for everyone.

import { describe, expect, test } from 'vitest';
import * as ported from './local-data';
import * as legacyJs from '../../js/local-data.js';

const legacy = legacyJs as unknown as typeof ported;

const LOCATION_DATA = [
  'calculator-config',
  'catalogue-recipes',
  'catalogue-usage',
  'catalogue-scaled',
  'logs-cache',
  'logs-migrated-v1',
  'orders-config',
  'orders-reminder-date',
  'qty-ING1', 'total-ING1', 'lock-ING1', 'revealed-ING1', 'extra-ING1', 'extra-unit-ING1',
];

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('every cache holding a location’s data is cleared', () => {
    const doomed = m.keysToClear(LOCATION_DATA);
    expect(doomed.sort()).toStrictEqual([...LOCATION_DATA].sort());
  });

  test('Firebase’s own session storage is NEVER cleared', () => {
    const keys = [
      'firebase:authUser:AIzaSyXXXX:[DEFAULT]',
      'firebase:host:bakery-app-ebf90.firebaseio.com',
      'firebaseLocalStorageDb',
    ];
    expect(m.keysToClear(keys)).toStrictEqual([]);
  });

  test('what belongs to nobody, or to the app itself, survives', () => {
    const keys = ['uk-bank-holidays', 'whats-new-seen', 'active-location'];
    expect(m.keysToClear(keys)).toStrictEqual([]);
  });

  test('an unknown key is cleared by default, not kept', () => {
    // The bias that matters: a cache added in six months, by someone who never reads this file,
    // must fail SAFE. Clearing costs one refetch; keeping leaks.
    expect(m.keysToClear(['some-future-cache', 'orders-something-new']))
      .toStrictEqual(['some-future-cache', 'orders-something-new']);
  });

  test('the keep list is prefix-based, so versioned keys stay covered', () => {
    expect(m.KEEP_PREFIXES.includes('firebase:')).toBe(true);
    expect(m.keysToClear(['firebase:authUser:another-key:[DEFAULT]'])).toStrictEqual([]);
  });

  // Added: every entry of the keep list is exercised, not only the ones the original names. A new
  // prefix added to one file and not the other is also caught by parity.spec.ts; this one catches
  // a prefix that stops protecting its own key.
  test('keysToClear keeps every KEEP_PREFIXES key — the bare prefix and anything starting with it', () => {
    for (const prefix of m.KEEP_PREFIXES) {
      expect(m.keysToClear([prefix, `${prefix}x`, `${prefix}2026-10-11`]), prefix).toStrictEqual([]);
    }
    expect(m.keysToClear([...m.KEEP_PREFIXES])).toStrictEqual([]);
  });

  test('keysToClear clears an unknown key, and a kept name that only appears inside it', () => {
    expect(m.keysToClear(['unknown-key'])).toStrictEqual(['unknown-key']);
    // startsWith, not includes: a prefix in the middle of a key protects nothing, and neither does
    // a different case.
    const lookalikes = ['x-firebase:', 'my-active-location', 'Firebase:authUser', 'ACTIVE-LOCATION', 'device', 'kiosk', 'usage'];
    expect(m.keysToClear(lookalikes)).toStrictEqual(lookalikes);
    // The mix keeps its order: only what is kept goes missing.
    expect(m.keysToClear(['calculator-config', 'kiosk-mode', 'qty-ING1', 'usage-2026-10-11']))
      .toStrictEqual(['calculator-config', 'qty-ING1']);
  });

  test('keysToClear takes no notice of anything that is not a string key, and forgives a missing list', () => {
    expect(m.keysToClear([5, null, undefined, {}, ['a'], 'a'])).toStrictEqual(['a']);
    expect(m.keysToClear(null)).toStrictEqual([]);
    expect(m.keysToClear(undefined)).toStrictEqual([]);
    expect(m.keysToClear('')).toStrictEqual([]);
  });

  test('keysToClear honours a keep list handed to it, and does not mutate its input', () => {
    const keys = ['a-1', 'b-1', 'firebase:x'];
    const before = [...keys];
    expect(m.keysToClear(keys, ['a-'])).toStrictEqual(['b-1', 'firebase:x']);
    expect(keys).toStrictEqual(before);
  });

  test('the keep list is frozen, so no screen can quietly add to it', () => {
    expect(Object.isFrozen(m.KEEP_PREFIXES)).toBe(true);
    // Every device-level setting the file documents is on the list.
    for (const prefix of ['kiosk-', 'device-id', 'device-ping-', 'error-reports', 'usage-', m.OFFLINE_CACHE_OWNER_KEY]) {
      expect(m.KEEP_PREFIXES.includes(prefix), prefix).toBe(true);
    }
  });

  test('clearLocalData removes exactly those keys from real storage', () => {
    type Store = Record<string, unknown> & { removeItem(key: string): void };
    const store: Store = {
      'calculator-config': '{}',
      'catalogue-recipes': '[]',
      'firebase:authUser:X:[DEFAULT]': 'token',
      'uk-bank-holidays': '[]',
      removeItem(key: string) { delete store[key]; },
    };
    // Object.keys picks up removeItem too; a function value is still just a key to the wipe, which
    // is why the test asserts on what SURVIVES.
    m.clearLocalData(store);
    expect(store['calculator-config']).toBeUndefined();
    expect(store['catalogue-recipes']).toBeUndefined();
    expect(store['firebase:authUser:X:[DEFAULT]']).toBe('token');
    expect(store['uk-bank-holidays']).toBe('[]');
  });

  // Added: a stand-in that behaves like a real Storage (removeItem lives on the prototype, so
  // Object.keys sees only the data), which lets the returned count be pinned exactly.
  test('clearLocalData returns how many keys it removed', () => {
    const proto = { removeItem(this: Record<string, unknown>, key: string) { delete this[key]; } };
    const store = Object.assign(Object.create(proto), {
      'calculator-config': '{}',
      'qty-ING1': '3',
      'firebase:authUser:X:[DEFAULT]': 'token',
      'device-id': 'abc',
    });
    expect(m.clearLocalData(store)).toBe(2);
    expect(Object.keys(store).sort()).toStrictEqual(['device-id', 'firebase:authUser:X:[DEFAULT]']);
    expect(m.clearLocalData(store)).toBe(0);
  });

  test('storage being unavailable is survivable, not a crash', () => {
    // Private browsing and blocked storage throw on access; losing the wipe is bad but taking the
    // whole app down with it is worse.
    const hostile = { get length() { throw new Error('blocked'); } };
    Object.defineProperty(hostile, 'anything', { get() { throw new Error('blocked'); } });
    expect(m.clearLocalData(null)).toBe(0);
    expect(() => m.clearLocalData(hostile as never)).not.toThrow();
  });

  // Added: the two places a Storage can throw — listing its keys, and removing one.
  test('a storage that throws when listed, or when a key is removed, is survivable too', () => {
    const unlistable = new Proxy({}, { ownKeys() { throw new Error('blocked'); } });
    expect(m.clearLocalData(unlistable as never)).toBe(0);

    const proto = { removeItem() { throw new Error('blocked'); } };
    const unremovable = Object.assign(Object.create(proto), { 'calculator-config': '{}', 'qty-ING1': '3' });
    expect(() => m.clearLocalData(unremovable)).not.toThrow();
    expect(Object.keys(unremovable).sort()).toStrictEqual(['calculator-config', 'qty-ING1']);
  });

  // ── Clearing on the way IN, not only on the way out ────────────────────────
  //
  // Signing out and switching location both wipe the cache, but a phone can reach the sign-in form
  // without passing through either: a session that expires or is revoked, and the leftover
  // anonymous session the app discards on sight. Whoever signs in next would open their own
  // location with the previous one's data on screen. This is the check that catches those — and
  // the one that must NOT fire when nothing changed.

  test('opening a DIFFERENT location clears this device first', () => {
    expect(m.shouldClearLocalData('bakery', 'restaurant')).toBe(true);
    expect(m.shouldClearLocalData('restaurant', 'bakery')).toBe(true);
  });

  test('opening the SAME location keeps the cache', () => {
    // The cache belongs to the LOCATION, not to the person. Two people from the same venue sharing
    // a phone must find the app ready, not emptied — and clearing here would slow every single
    // sign-in for no gain.
    expect(m.shouldClearLocalData('bakery', 'bakery')).toBe(false);
  });

  test('nothing remembered clears: a fresh install, or a phone from the pre-login app', () => {
    // The old single-venue app never wrote this key, so `null` is exactly the phone whose cache
    // could otherwise leak into a venue it never belonged to.
    expect(m.shouldClearLocalData(null, 'restaurant')).toBe(true);
    expect(m.shouldClearLocalData(undefined, 'bakery')).toBe(true);
    expect(m.shouldClearLocalData('', 'bakery')).toBe(true);
  });

  test('nothing being opened decides nothing', () => {
    // Guard against a caller with no location: clearing on a non-event would wipe a working phone
    // for free.
    expect(m.shouldClearLocalData('bakery', null)).toBe(false);
    expect(m.shouldClearLocalData('bakery', undefined)).toBe(false);
    expect(m.shouldClearLocalData('bakery', '')).toBe(false);
    expect(m.shouldClearLocalData(null, null)).toBe(false);
  });

  test('the wipe that follows never touches the sign-in itself', () => {
    // Belt and braces with the KEEP_PREFIXES tests above: if entering a location cleared
    // Firebase's own storage, the sign-in that just happened would be undone.
    const storage = {
      'firebase:authUser:abc': 'session',
      'firebaseLocalStorageDb': 'session',
      'active-location': 'restaurant',
      'calculator-config': '{}',
    };
    const gone = m.keysToClear(Object.keys(storage));
    expect(gone).toStrictEqual(['calculator-config']);
  });

  // Added: the location names are compared exactly. «Bakery» is not «bakery», and a stray space is
  // a different venue — the cache is wiped rather than shared across the two.
  test('a location is the same only when it is spelt exactly the same', () => {
    expect(m.shouldClearLocalData('bakery', 'Bakery')).toBe(true);
    expect(m.shouldClearLocalData('bakery ', 'bakery')).toBe(true);
  });

  // ── Whose data the offline database holds ──────────────────────────────────
  //
  // ⚠️ Firestore's own offline cache holds every document read and answers with no signal, where
  // the rules are never asked. The verdict decides the one case sign-out cannot see: a DIFFERENT
  // person arriving without the previous one signing out (an expired or revoked session).

  test('the offline cache is claimed by whoever opens first, kept for its owner, wiped for anybody else', () => {
    const TABLE: readonly (readonly [unknown, unknown, 'claim' | 'keep' | 'wipe'])[] = [
      // [recorded owner, account opening the page, verdict]
      [null, 'u1', 'claim'],
      [undefined, 'u1', 'claim'],
      ['', 'u1', 'claim'],
      ['u1', 'u1', 'keep'],
      ['u1', 'u2', 'wipe'],
      ['u1', 'U1', 'wipe'],
      ['u1', 'u1 ', 'wipe'],
      ['u1', ' u1', 'wipe'],
    ];
    for (const [owner, uid, verdict] of TABLE) {
      expect(m.offlineCacheVerdict(owner, uid), `${String(owner)} / ${String(uid)}`).toBe(verdict);
    }
  });

  // No account on the page (signed out, or still loading) can never wipe anything: the answer is
  // «keep» whoever is recorded, so a page that boots signed out does not empty the phone.
  test('with no account on the page the verdict is keep, whoever is recorded', () => {
    for (const uid of [null, undefined, '', 0]) {
      for (const owner of [null, undefined, '', 'u1']) {
        expect(m.offlineCacheVerdict(owner, uid), `${String(owner)} / ${String(uid)}`).toBe('keep');
      }
    }
  });

  test('the key that records the owner survives a venue switch, or the next boot could not tell people apart', () => {
    expect(m.OFFLINE_CACHE_OWNER_KEY).toBe('offline-cache-uid');
    expect(m.keysToClear([m.OFFLINE_CACHE_OWNER_KEY])).toStrictEqual([]);
  });
});
