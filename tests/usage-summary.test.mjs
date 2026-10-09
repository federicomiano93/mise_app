// scripts/usage-summary.mjs — the pure half of the owner's usage reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  usagePath, lineFrom, linesFrom, isStale, summarise, summaryLines, toJson, median, dayOf, PRUNE_DAYS,
} from '../scripts/usage-summary.mjs';

const DEV_A = 'AbCdEfGhIjKlMnOpQrSt';
const DEV_B = 'ZyXwVuTsRqPoNmLkJiHg';
const NOW = new Date(2026, 9, 10, 12, 0).getTime();

const ints = o => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { integerValue: String(v) }])) } });

function row(lid, device, dayKey, uid, fields = {}) {
  return {
    document: {
      name: `projects/p/databases/(default)/documents/locations/${lid}/usage/${device}_${dayKey}_${uid}`,
      fields: { kind: { stringValue: 'phone' }, appVersion: { stringValue: '649' }, ...fields },
    },
  };
}

test('only a usage line in a venue may be deleted', () => {
  assert.ok(usagePath(`locations/bakery/usage/${DEV_A}_20261009_u1`));
  assert.ok(usagePath(`locations/loc-e015733e55e7/usage/${DEV_A}_20261009_u1`));
  assert.equal(usagePath(`locations/bakery/devices/${DEV_A}`), null);
  assert.equal(usagePath(`locations/bakery/usage/${DEV_A}_20261009_u1/x/y`), null);
  assert.equal(usagePath(`locations/bakery/usage/short_20261009_u1`), null);
  assert.equal(usagePath(`locations/bakery/usage/${DEV_A}_1999_u1`), null);
  assert.equal(usagePath('locations/../usage/x'), null);
  assert.equal(usagePath(undefined), null);
});

test('a row becomes a line; names written by a device are checked, numbers clamped', () => {
  const line = lineFrom(row('bakery', DEV_A, '20261009', 'u1', {
    screens: ints({ orders: 3, 'BAD KEY': 9, neg: -1 }),
    routes: ints({ 'index>orders': 2, nonsense: 5, other: 1 }),
    actions: ints({ 'order-sent': 1, 'Bad Action': 4 }),
    firstMinute: { integerValue: '540' }, lastMinute: { integerValue: '99999' },
    offlineSeconds: { integerValue: '999999' },
  }).document);
  assert.equal(line.locationId, 'bakery');
  assert.deepEqual(line.screens, { orders: 3 });
  assert.deepEqual(line.routes, { 'index>orders': 2, other: 1 });
  assert.deepEqual(line.actions, { 'order-sent': 1 });
  assert.equal(line.firstMinute, 540);
  assert.equal(line.lastMinute, null);
  assert.equal(line.offlineSeconds, 86400);
});

test('a row that is not a usage line is dropped, and so is an impossible day', () => {
  assert.equal(lineFrom({ name: 'projects/p/databases/(default)/documents/locations/bakery/errors/abc' }), null);
  assert.equal(lineFrom(row('bakery', DEV_A, '20261399', 'u1').document), null);
  assert.equal(linesFrom([{}, { readTime: 'x' }, row('bakery', DEV_A, '20261009', 'u1')]).length, 1);
  assert.deepEqual(linesFrom(null), []);
  assert.equal(dayOf('20260230'), null);
});

test('a line is stale after 400 days', () => {
  const day = d => ({ dayKey: d });
  assert.equal(PRUNE_DAYS, 400);
  assert.equal(isStale(day('20261001'), NOW), false);
  assert.equal(isStale(day('20250101'), NOW), true);
  assert.equal(isStale(day('garbage'), NOW), true);
});

test('the median of load times', () => {
  assert.equal(median([300, 100, 200]), 200);
  assert.equal(median([100, 200]), 150);
  assert.equal(median([]), null);
});

function sample() {
  return linesFrom([
    row('bakery', DEV_A, '20261009', 'u1', {
      screens: ints({ index: 2, orders: 3 }), seconds: ints({ orders: 600, index: 60 }),
      routes: ints({ 'index>orders': 2 }), actions: ints({ 'order-sent': 1 }),
      firstMinute: { integerValue: '480' }, lastMinute: { integerValue: '605' },
      loads: ints({ orders: 2 }), loadMs: ints({ orders: 2000 }), offlineSeconds: { integerValue: '120' },
    }),
    row('bakery', DEV_B, '20261009', 'u2', {
      screens: ints({ orders: 1 }), seconds: ints({ orders: 120 }),
      routes: ints({ 'index>orders': 1, 'orders>orders:supplier': 4 }),
      loads: ints({ orders: 1 }), loadMs: ints({ orders: 400 }),
      firstMinute: { integerValue: '540' }, lastMinute: { integerValue: '560' },
    }),
    row('bakery', DEV_A, '20260901', 'u1', { screens: ints({ orders: 5 }) }),
    row('loc-b', DEV_A, '20261008', 'u3', { screens: ints({ catalogue: 1 }), appVersion: { stringValue: '640' } }),
  ]);
}

test('per venue: the last 7 and 30 days, people and devices per day, screens, routes, hours, loads', () => {
  const venues = summarise(sample(), NOW);
  assert.deepEqual(venues.map(v => v.locationId), ['bakery', 'loc-b']);
  const b = venues[0];
  assert.equal(b.total, 3);
  assert.equal(b.last7.lines, 2);
  assert.equal(b.last30.lines, 2, 'the 1 Sep line is older than 30 days');
  assert.deepEqual(b.last7.perDay, [['20261009', 2, 2]]);
  assert.deepEqual(b.last7.screens, [['orders', 4], ['index', 2]]);
  assert.deepEqual(b.last7.activeMinutes, [['orders', 12], ['index', 1]]);
  assert.deepEqual(b.last7.routes[0], ['orders>orders:supplier', 4]);
  assert.deepEqual(b.last7.routes[1], ['index>orders', 3]);
  assert.deepEqual(b.last7.actions, [['order-sent', 1]]);
  assert.equal(b.last7.hours[8], 1);
  assert.equal(b.last7.hours[9], 2);
  assert.equal(b.last7.hours[10], 1);
  assert.equal(b.last7.hours[11], 0);
  assert.deepEqual(b.last7.loadMedianMs, [['orders', 700]]);
  assert.equal(b.last7.offlineMinutes, 2);
  assert.deepEqual(b.last7.versions, [['649', 2]]);
});

test('the top routes are fifteen at most', () => {
  const routes = {};
  for (let i = 0; i < 40; i += 1) routes[`a${i}>b${i}`] = i + 1;
  const lines = linesFrom([row('bakery', DEV_A, '20261009', 'u1', { routes: ints(routes) })]);
  assert.equal(summarise(lines, NOW)[0].last7.routes.length, 15);
});

test('the printout names people by first name only and never prints an id', () => {
  const venues = summarise(sample(), NOW);
  const names = new Map([['u1', 'Anna'], ['u2', 'Anna']]);
  const text = summaryLines(venues[0], 'The Bakery', names).join('\n');
  assert.match(text, /The Bakery \(bakery\)/);
  assert.match(text, /index → orders 3/);
  assert.match(text, /active days per person: .*Anna/);
  assert.match(text, /Anna \(2\)/, 'two people with one name are told apart by a number');
  assert.ok(!text.includes(DEV_A) && !text.includes(DEV_B));
  assert.ok(!/\bu1\b|\bu2\b/.test(text));
});

test('the json holds the numbers and no uid, device id or name', () => {
  const venues = summarise(sample(), NOW);
  const json = JSON.stringify(toJson(venues, new Map([['bakery', 'The Bakery']])));
  assert.ok(!json.includes(DEV_A) && !json.includes(DEV_B));
  assert.ok(!/"u[123]"/.test(json));
  const data = JSON.parse(json);
  assert.equal(data[0].name, 'The Bakery');
  assert.equal(data[0].last7.people, 2);
  assert.equal(data[0].last7.routes[0][0], 'orders>orders:supplier');
});

test('the script reads production like read-devices and prunes only through the path check', () => {
  const src = readFileSync(new URL('../scripts/read-usage.mjs', import.meta.url), 'utf8');
  assert.match(src, /const PROJECT = 'bakery-app-ebf90'/);
  assert.match(src, /gcloud auth print-access-token/);
  assert.match(src, /collectionId: 'usage', allDescendants: true/);
  assert.match(src, /usagePath\(line\.path\)/);
  assert.match(src, /method: 'DELETE'/);
});
