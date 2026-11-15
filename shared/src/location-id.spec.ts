// Unit tests for the tenant path builder (P15), run against BOTH implementations: the TypeScript
// port in shared/ and js/location.js, which the live app uses today. Ported from
// tests/location-path.test.mjs.
//
// location-id.ts is the PURE half of js/location.js only (DEFAULT_LOCATION_ID, isValidLocationId,
// buildPath, locationDocPath). Which venue is open on a page is state, and in Mise 2 it belongs to
// the session, so this module is NOT paired in parity.spec.ts (js/location.js exports more).
// NOT PORTED — the four tests of that state (currentLocationId, setCurrentLocationId,
// clearCurrentLocationId, isLocationSet, pathFor): «before sign-in there is NO location», «once the
// session opens a location, pathFor follows it», «setting the current location moves every path»
// and «setting an invalid location throws and leaves the current one alone».
//
// This is the boundary between two locations' data. The tests that matter are the REFUSALS: every
// input that could send a write somewhere other than the intended location's folder must throw,
// because the alternative — quietly writing into a shared or wrong location — is invisible until
// someone sees another location's suppliers.

import { describe, expect, test } from 'vitest';
import * as ported from './location-id';
import * as legacyJs from '../../js/location.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('a collection name becomes a path inside the location folder', () => {
    expect(m.buildPath('bakery', 'suppliers')).toBe('locations/bakery/suppliers');
    expect(m.buildPath('trattoria-x', 'orders-history')).toBe('locations/trattoria-x/orders-history');
  });

  test('the location document has its own path', () => {
    expect(m.locationDocPath('bakery')).toBe('locations/bakery');
  });

  test('a slash in the location id is REFUSED, not sanitised', () => {
    // '../suppliers' or 'main/../other' would re-point the write. Throwing is the whole point: a
    // screen that errors is fixable, a wrong write is not noticed.
    for (const bad of ['a/b', '../x', 'main/', '/main', 'locations/bakery']) {
      expect(() => m.buildPath(bad, 'suppliers'), `${bad} must throw`).toThrow(/Invalid location id/);
    }
  });

  test('an empty or non-string location id is REFUSED', () => {
    for (const bad of [undefined, null, '', ' ', 0, 42, {}, [], true]) {
      expect(() => m.buildPath(bad, 'suppliers'), `${JSON.stringify(bad)} must throw`)
        .toThrow(/Invalid location id/);
    }
  });

  test('a dotted id is refused (Firestore reserves . and ..)', () => {
    for (const bad of ['.', '..', '.hidden']) {
      expect(() => m.buildPath(bad, 'suppliers')).toThrow(/Invalid location id/);
    }
  });

  test('an id longer than the limit is refused', () => {
    expect(m.isValidLocationId('a'.repeat(64))).toBe(true);
    expect(m.isValidLocationId('a'.repeat(65))).toBe(false);
  });

  test('a bad collection name is refused too', () => {
    for (const bad of [undefined, null, '', 'a/b', 42]) {
      expect(() => m.buildPath('main', bad), `${JSON.stringify(bad)} must throw`)
        .toThrow(/Invalid collection name/);
    }
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('the default location is the bakery, and it is a valid id', () => {
    expect(m.DEFAULT_LOCATION_ID).toBe('bakery');
    expect(m.isValidLocationId(m.DEFAULT_LOCATION_ID)).toBe(true);
    expect(m.locationDocPath(m.DEFAULT_LOCATION_ID)).toBe('locations/bakery');
  });

  // Only letters, digits, dash and underscore, starting with a letter or digit: the shape a
  // hand-typed id in the console should ever have. Anything else — a space, a newline, a dot, an
  // accent — is refused rather than guessed at.
  test('isValidLocationId accepts the real ids and refuses everything with a space, a dot or a symbol', () => {
    for (const good of ['bakery', 'restaurant', 'loc-e015733e55e7', 'trattoria-x', 'a', '0', 'A_b-9', 'a'.repeat(64)]) {
      expect(m.isValidLocationId(good), good).toBe(true);
    }
    for (const bad of ['bakery ', ' bakery', 'bak ery', 'bakery\n', 'bakery\t', 'a.b', '-bakery', '_bakery', 'bakery!',
      'bäkery', 'ba​kery', 'a/b', '\\', '%2F', '', 'a'.repeat(65)]) {
      expect(m.isValidLocationId(bad), JSON.stringify(bad)).toBe(false);
    }
    for (const notText of [undefined, null, 0, 1, true, {}, [], ['bakery'], new String('bakery')]) {
      expect(m.isValidLocationId(notText), String(notText)).toBe(false);
    }
  });

  test('the location document path refuses a bad id the same way', () => {
    for (const bad of ['a/b', '..', '', ' ', undefined, null, 42, {}]) {
      expect(() => m.locationDocPath(bad), `${JSON.stringify(bad)} must throw`).toThrow(/Invalid location id/);
    }
  });

  // The id is checked before the collection, so a request with BOTH wrong names the id.
  test('a bad id is reported before a bad collection name', () => {
    expect(() => m.buildPath('a/b', '')).toThrow(/Invalid location id/);
    expect(() => m.buildPath(undefined, undefined)).toThrow(/Invalid location id/);
  });

  test('a collection name with a space, a dot or a dash is kept as given — only an empty one or a slash is refused', () => {
    expect(m.buildPath('main', 'orders-history')).toBe('locations/main/orders-history');
    expect(m.buildPath('main', 'a b')).toBe('locations/main/a b');
    expect(() => m.buildPath('main', 'a/b')).toThrow(/Invalid collection name/);
    expect(() => m.buildPath('main', '/')).toThrow(/Invalid collection name/);
  });
});
