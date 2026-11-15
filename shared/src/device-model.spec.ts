// Unit tests for the device count (P15), run against BOTH implementations: the TypeScript port in
// shared/ and the js/ file the live app uses today. Ported from tests/device-model.test.mjs; the
// two must stay equal until the switch to Mise 2.
//
// The line a device writes is pinned by firestore.rules (match /devices/{id}): the venue, the uid
// and four facts, never a name or an email.

import { describe, expect, test, vi } from 'vitest';
import * as ported from './device-model';
import * as legacyJs from '../../js/device-model.js';

const legacy = legacyJs as unknown as typeof ported;

// A result that may be null, asserted present and handed back typed.
function made<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('kind follows the SHORTER side of the screen, then the pointer', () => {
    expect(m.deviceKind({ width: 360, height: 800, coarse: true })).toBe('phone');
    expect(m.deviceKind({ width: 800, height: 360, coarse: true })).toBe('phone');   // a phone on its side
    expect(m.deviceKind({ width: 599, height: 2000, coarse: false })).toBe('phone');
    expect(m.deviceKind({ width: 600, height: 1024, coarse: true })).toBe('tablet');
    expect(m.deviceKind({ width: 1024, height: 600, coarse: true })).toBe('tablet');
    expect(m.deviceKind({ width: 1920, height: 1080, coarse: false })).toBe('computer');
    expect(m.deviceKind({ width: 600, height: 900, coarse: false })).toBe('computer');
  });

  test('an unreadable screen is a computer, never a throw', () => {
    for (const bad of [undefined, {}, { width: 0, height: 0 }, { width: 'x', height: NaN }]) {
      expect(m.deviceKind(bad)).toBe('computer');
    }
  });

  test('an id is 20 letters or digits, equally likely, and null without enough bytes', () => {
    const id = made(m.newDeviceId(Uint8Array.from({ length: 64 }, (_, i) => (i * 3) % 256)));
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(m.isValidDeviceId(id)).toBe(true);
    // Bytes at or above 248 are skipped: they would favour the first characters.
    expect(m.newDeviceId([255, 250, 248, ...Array(20).fill(0)])).toBe('A'.repeat(20));
    expect(m.newDeviceId([1, 2, 3])).toBe(null);
    expect(m.newDeviceId(new Uint8Array(64).fill(255))).toBe(null);
    expect(m.newDeviceId(undefined)).toBe(null);
  });

  test('every character of the alphabet can come out', () => {
    const seen = new Set<string>();
    for (let b = 0; b < 248; b += 1) seen.add(made(m.newDeviceId([b, ...Array(19).fill(0)])).charAt(0));
    expect(seen.size).toBe(62);
  });

  test('isValidDeviceId accepts only the shape the rules accept', () => {
    expect(m.isValidDeviceId('Ab3dEf6hIj9lMn2pQr5t')).toBe(true);
    for (const bad of ['', 'short', 'Ab3dEf6hIj9lMn2pQr5tX', 'Ab3dEf6hIj9lMn2pQr5-', null, undefined, 5]) {
      expect(m.isValidDeviceId(bad), String(bad)).toBe(false);
    }
  });

  test('a venue is due when its last ping was not today', () => {
    expect(m.dueToday(null, '2026-10-09')).toBe(true);
    expect(m.dueToday(undefined, '2026-10-09')).toBe(true);
    expect(m.dueToday('2026-10-08', '2026-10-09')).toBe(true);
    expect(m.dueToday('2026-10-09', '2026-10-09')).toBe(false);
    expect(m.dueToday(null, 'garbage')).toBe(false);   // no usable today: say nothing
  });

  test('the day key is the LOCAL date', () => {
    expect(m.localDayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(m.localDayKey(new Date(2026, 9, 9, 0, 1))).toBe('2026-10-09');
  });

  // Added: the default is the clock. Tried with a fixed one a minute before midnight, so a day key
  // taken from UTC instead of local time (or from yesterday) would show.
  test('with no date the day key is today, by the local clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 9, 23, 59, 30));
      expect(m.localDayKey()).toBe('2026-10-09');
    } finally {
      vi.useRealTimers();
    }
  });

  // Added: sameSession had no test in tests/device-model.test.mjs. It guards the ping's wait: the
  // line must never be written under the wrong venue or account on a shared tablet.
  test('the same session is the same venue AND the same person, and both must be ready', () => {
    const ready = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };
    expect(m.sameSession(ready, { ...ready })).toBe(true);
    expect(m.sameSession(ready, { ...ready, locationId: 'restaurant' })).toBe(false);
    expect(m.sameSession(ready, { ...ready, user: { uid: 'u2' } })).toBe(false);
    expect(m.sameSession(ready, { ...ready, status: 'loading' })).toBe(false);
    expect(m.sameSession({ ...ready, status: 'loading' }, ready)).toBe(false);
    expect(m.sameSession(ready, { ...ready, locationId: '' })).toBe(false);
    expect(m.sameSession(ready, { ...ready, user: null })).toBe(false);
    expect(m.sameSession(ready, { ...ready, user: {} })).toBe(false);
    expect(m.sameSession(ready, null)).toBe(false);
    expect(m.sameSession(undefined, ready)).toBe(false);
    expect(m.sameSession(null, null)).toBe(false);
  });

  test('the payload is the venue, the uid and the four facts, and never a name or an email', () => {
    // Held in a variable so the two extra fields reach the function the way they would at run time.
    const facts = { locationId: 'bakery', uid: 'u1', kind: 'tablet', appVersion: '643', installed: true, email: 'a@b.c', name: 'X' };
    const p = made(m.devicePayload(facts));
    expect(p).toStrictEqual({ bakery: 'bakery', uid: 'u1', kind: 'tablet', appVersion: '643', installed: true });
    expect(Object.keys(p).sort()).toStrictEqual(['appVersion', 'bakery', 'installed', 'kind', 'uid']);
  });

  test('an unknown or too long version is null; installed is a strict boolean', () => {
    const base = { locationId: 'b', uid: 'u1', kind: 'phone' };
    expect(made(m.devicePayload({ ...base, appVersion: null })).appVersion).toBe(null);
    expect(made(m.devicePayload({ ...base, appVersion: '1234567890123' })).appVersion).toBe(null);
    expect(made(m.devicePayload({ ...base, appVersion: '123456789012' })).appVersion).toBe('123456789012');
    expect(made(m.devicePayload({ ...base, installed: 'yes' })).installed).toBe(false);
  });

  test('no payload without a venue, without a uid, or with a kind the rules would refuse', () => {
    expect(m.devicePayload({ uid: 'u1', kind: 'phone' })).toBe(null);
    expect(m.devicePayload({ locationId: '', uid: 'u1', kind: 'phone' })).toBe(null);
    expect(m.devicePayload({ locationId: 'b', kind: 'phone' })).toBe(null);
    expect(m.devicePayload({ locationId: 'b', uid: '', kind: 'phone' })).toBe(null);
    expect(m.devicePayload({ locationId: 'b', uid: 'u1', kind: 'watch' })).toBe(null);
    expect(m.devicePayload()).toBe(null);
  });
});
