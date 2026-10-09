// The pure half of scripts/read-devices.mjs. The script itself talks to production and is
// never run by the tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devicePath, deviceFrom, devicesFrom, isStale, summarise, summaryLines, relativePath } from '../scripts/device-summary.mjs';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ID = 'Ab3dEf6hIj9lMn2pQr5t';
const iso = daysAgo => new Date(NOW - daysAgo * DAY).toISOString();

function row(lid, daysAgo, { kind = 'phone', installed = false, appVersion = '643', id = ID, uid = null } = {}) {
  return { document: {
    name: `projects/bakery-app-ebf90/databases/(default)/documents/locations/${lid}/devices/${id}`,
    fields: {
      bakery: { stringValue: lid }, ...(uid ? { uid: { stringValue: uid } } : {}), kind: { stringValue: kind }, installed: { booleanValue: installed },
      appVersion: appVersion === null ? { nullValue: null } : { stringValue: appVersion },
      lastSeen: { timestampValue: iso(daysAgo) },
    },
  } };
}

test('a delete may name one device line in one venue, and nothing else', () => {
  assert.deepEqual(devicePath(`locations/loc-e015733e55e7/devices/${ID}`),
    { path: `locations/loc-e015733e55e7/devices/${ID}`, locationId: 'loc-e015733e55e7', id: ID });
  for (const bad of [
    'locations/bakery', 'locations/bakery/devices', `locations/bakery/feedback/${ID}`,
    `locations/bakery/devices/${ID}/more`, `../locations/bakery/devices/${ID}`,
    'locations/bakery/devices/short', 'locations/bakery/devices/abc 123',
    `locations/bakery/devices/${ID}x`, 'users/u1', '', null, undefined,
  ]) assert.equal(devicePath(bad), null, String(bad));
});

test('the REST name is cut down to the document path', () => {
  assert.equal(relativePath(row('bakery', 0).document.name), `locations/bakery/devices/${ID}`);
  assert.equal(relativePath('nonsense'), null);
});

test('a REST row becomes a device; anything else is dropped', () => {
  const d = deviceFrom(row('bakery', 2, { kind: 'tablet', installed: true, appVersion: '640' }).document);
  assert.equal(d.locationId, 'bakery');
  assert.equal(d.kind, 'tablet');
  assert.equal(d.installed, true);
  assert.equal(d.appVersion, '640');
  assert.equal(d.lastSeenMs, NOW - 2 * DAY);
  assert.equal(deviceFrom(row('bakery', 1, { appVersion: null }).document).appVersion, null);
  assert.equal(devicesFrom([{ readTime: 'x' }, row('bakery', 1), null]).length, 1);
  assert.deepEqual(devicesFrom(undefined), []);
});

test('stale means not seen for 90 days, or never readable', () => {
  const at = daysAgo => deviceFrom(row('bakery', daysAgo).document);
  assert.equal(isStale(at(89), NOW), false);
  assert.equal(isStale(at(91), NOW), true);
  assert.equal(isStale({ lastSeenMs: null }, NOW), true);
});

test('the summary counts per venue, by window, kind, installed and release (newest first)', () => {
  const devices = devicesFrom([
    row('bakery', 1, { kind: 'phone', installed: true, appVersion: '643' }),
    row('bakery', 3, { kind: 'phone', installed: false, appVersion: '9' }),
    row('bakery', 20, { kind: 'tablet', installed: true, appVersion: '100' }),
    row('bakery', 60, { kind: 'computer', appVersion: null }),
    row('loc-x', 0, { kind: 'computer' }),
  ]);
  const [bakery, other] = summarise(devices, NOW);
  assert.equal(bakery.locationId, 'bakery');
  assert.deepEqual([bakery.last7, bakery.last30, bakery.total], [2, 3, 4]);
  assert.deepEqual(bakery.kinds, [['phone', 2], ['tablet', 1]]);
  assert.deepEqual(bakery.installed, { installed: 2, browser: 1 });
  assert.deepEqual(bakery.versions, [['643', 1], ['100', 1], ['9', 1]]);
  assert.deepEqual([other.locationId, other.last7, other.total], ['loc-x', 1, 1]);
});

test('an unknown release sorts last', () => {
  const [v] = summarise(devicesFrom([row('b', 1, { appVersion: null }), row('b', 1, { appVersion: '5' })]), NOW);
  assert.deepEqual(v.versions, [['5', 1], ['unknown', 1]]);
});

test('the printout is numbers only: no id, no path', () => {
  const [v] = summarise(devicesFrom([row('bakery', 1)]), NOW);
  const text = summaryLines(v, 'The Bakery').join('\n');
  assert.ok(!text.includes(ID));
  assert.ok(!text.includes('/devices/'));
  assert.match(text, /last 7 days 1 · last 30 days 1 · on file 1/);
});

test('the version is cleaned like a venue name: control characters out, length capped', () => {
  const d = deviceFrom(row('bakery', 1, { appVersion: 'a\u0007b\nc' }).document);
  assert.equal(d.appVersion, 'a b c');
  assert.equal(deviceFrom(row('bakery', 1, { appVersion: '   ' }).document).appVersion, null);
});

const UID_A = 'uidAlice1111111111';
const UID_B = 'uidBob22222222222';
const UID_C = 'uidAlice3333333333';
const people = () => summarise(devicesFrom([
  row('bakery', 1, { uid: UID_A, id: 'Aaaaaaaaaaaaaaaaaaaa' }),
  row('bakery', 2, { uid: UID_A, id: 'Bbbbbbbbbbbbbbbbbbbb' }),
  row('bakery', 3, { uid: UID_B, id: 'Cccccccccccccccccccc' }),
  row('bakery', 4, { uid: UID_C, id: 'Dddddddddddddddddddd' }),
  row('bakery', 5, { id: 'Eeeeeeeeeeeeeeeeeeee' }),
]), NOW)[0];

test('devices per person: most devices first, a line with no uid is not a person', () => {
  const v = people();
  assert.deepEqual(v.people, [[UID_A, 2], [UID_C, 1], [UID_B, 1]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  const names = new Map([[UID_A, 'Alice'], [UID_B, 'Bob']]);
  assert.match(summaryLines(v, 'The Bakery', names).join('\n'), /devices per person: Alice 2, someone 1, Bob 1/);
});

test('an unknown person is «someone»', () => {
  const text = summaryLines(people(), 'The Bakery', new Map()).join('\n');
  assert.match(text, /devices per person: someone 2, someone \(2\) 1, someone \(3\) 1/);
});

test('two people with the same first name are told apart by a number', () => {
  const names = new Map([[UID_A, 'Alice'], [UID_C, 'Alice'], [UID_B, 'Bob']]);
  assert.match(summaryLines(people(), 'The Bakery', names).join('\n'), /devices per person: Alice 2, Alice \(2\) 1, Bob 1/);
});

test('no uid and no device id ever appears in the printout', () => {
  const names = new Map([[UID_A, 'Alice'], [UID_B, 'Bob']]);
  for (const text of [summaryLines(people(), 'The Bakery', names).join('\n'), summaryLines(people(), 'The Bakery').join('\n')]) {
    for (const secret of [UID_A, UID_B, UID_C, 'Aaaaaaaaaaaaaaaaaaaa', 'Bbbbbbbbbbbbbbbbbbbb']) assert.ok(!text.includes(secret), secret);
  }
});
