// js/device-model.js — the pure half of the device count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceKind, newDeviceId, isValidDeviceId, dueToday, devicePayload, localDayKey, sameSession } from '../js/device-model.js';

test('kind follows the SHORTER side of the screen, then the pointer', () => {
  assert.equal(deviceKind({ width: 360, height: 800, coarse: true }), 'phone');
  assert.equal(deviceKind({ width: 800, height: 360, coarse: true }), 'phone');   // a phone on its side
  assert.equal(deviceKind({ width: 599, height: 2000, coarse: false }), 'phone');
  assert.equal(deviceKind({ width: 600, height: 1024, coarse: true }), 'tablet');
  assert.equal(deviceKind({ width: 1024, height: 600, coarse: true }), 'tablet');
  assert.equal(deviceKind({ width: 1920, height: 1080, coarse: false }), 'computer');
  assert.equal(deviceKind({ width: 600, height: 900, coarse: false }), 'computer');
});

test('an unreadable screen is a computer, never a throw', () => {
  for (const bad of [undefined, {}, { width: 0, height: 0 }, { width: 'x', height: NaN }]) {
    assert.equal(deviceKind(bad), 'computer');
  }
});

test('an id is 20 letters or digits, equally likely, and null without enough bytes', () => {
  const id = newDeviceId(Uint8Array.from({ length: 64 }, (_, i) => (i * 3) % 256));
  assert.match(id, /^[A-Za-z0-9]{20}$/);
  assert.equal(isValidDeviceId(id), true);
  // Bytes at or above 248 are skipped: they would favour the first characters.
  assert.equal(newDeviceId([255, 250, 248, ...Array(20).fill(0)]), 'A'.repeat(20));
  assert.equal(newDeviceId([1, 2, 3]), null);
  assert.equal(newDeviceId(new Uint8Array(64).fill(255)), null);
  assert.equal(newDeviceId(undefined), null);
});

test('every character of the alphabet can come out', () => {
  const seen = new Set();
  for (let b = 0; b < 248; b += 1) seen.add(newDeviceId([b, ...Array(19).fill(0)])[0]);
  assert.equal(seen.size, 62);
});

test('isValidDeviceId accepts only the shape the rules accept', () => {
  assert.equal(isValidDeviceId('Ab3dEf6hIj9lMn2pQr5t'), true);
  for (const bad of ['', 'short', 'Ab3dEf6hIj9lMn2pQr5tX', 'Ab3dEf6hIj9lMn2pQr5-', null, undefined, 5]) {
    assert.equal(isValidDeviceId(bad), false, String(bad));
  }
});

test('a venue is due when its last ping was not today', () => {
  assert.equal(dueToday(null, '2026-10-09'), true);
  assert.equal(dueToday(undefined, '2026-10-09'), true);
  assert.equal(dueToday('2026-10-08', '2026-10-09'), true);
  assert.equal(dueToday('2026-10-09', '2026-10-09'), false);
  assert.equal(dueToday(null, 'garbage'), false);   // no usable today: say nothing
});

test('the day key is the LOCAL date', () => {
  assert.equal(localDayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(localDayKey(new Date(2026, 9, 9, 0, 1)), '2026-10-09');
});

test('the payload is the venue, the uid and the four facts, and never a name or an email', () => {
  const p = devicePayload({ locationId: 'bakery', uid: 'u1', kind: 'tablet', appVersion: '643', installed: true, email: 'a@b.c', name: 'X' });
  assert.deepEqual(p, { bakery: 'bakery', uid: 'u1', kind: 'tablet', appVersion: '643', installed: true });
  assert.deepEqual(Object.keys(p).sort(), ['appVersion', 'bakery', 'installed', 'kind', 'uid']);
});

test('an unknown or too long version is null; installed is a strict boolean', () => {
  const base = { locationId: 'b', uid: 'u1', kind: 'phone' };
  assert.equal(devicePayload({ ...base, appVersion: null }).appVersion, null);
  assert.equal(devicePayload({ ...base, appVersion: '1234567890123' }).appVersion, null);
  assert.equal(devicePayload({ ...base, appVersion: '123456789012' }).appVersion, '123456789012');
  assert.equal(devicePayload({ ...base, installed: 'yes' }).installed, false);
});

test('no payload without a venue, without a uid, or with a kind the rules would refuse', () => {
  assert.equal(devicePayload({ uid: 'u1', kind: 'phone' }), null);
  assert.equal(devicePayload({ locationId: '', uid: 'u1', kind: 'phone' }), null);
  assert.equal(devicePayload({ locationId: 'b', kind: 'phone' }), null);
  assert.equal(devicePayload({ locationId: 'b', uid: '', kind: 'phone' }), null);
  assert.equal(devicePayload({ locationId: 'b', uid: 'u1', kind: 'watch' }), null);
  assert.equal(devicePayload(), null);
});
