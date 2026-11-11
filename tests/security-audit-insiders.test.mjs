// The insider fixes of the security audit of 2 Nov 2026.
//
// None of these let anybody in; each let somebody already inside put words in another
// person's mouth, or leave a mess nobody could clean up:
//  - an order list «from Federico», sent by an employee (fromName is free text);
//  - a «New order — <any text>» on every phone, from a client-order an employee made up;
//  - the print agent's password file falling back to the shared temp folder.
//
// ⚠️ The server halves are SOURCE checks, for the reason tests/redeem-never-demotes.test.mjs
// gives: functions/ needs the Admin SDK, which the root suite never installs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { shownSender } from '../js/orders/order-request-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

function between(src, start, end, label, min = 200) {
  const at = src.indexOf(start);
  assert.notEqual(at, -1, `${label}: could not find ${start}`);
  const stop = src.indexOf(end, at);
  assert.notEqual(stop, -1, `${label}: could not find the end of ${start}`);
  const body = src.slice(at, stop);
  assert.ok(body.length > min, `${label} read as ${body.length} characters — this test can no longer see it`);
  return body;
}

// ── The name on a received order list ────────────────────────────────────────

const roster = new Map([
  ['u-marco', { firstName: 'Marco', lastName: 'Rossi', email: 'marco@example.com' }],
  ['u-noname', { firstName: '', lastName: '', email: 'anna@example.com' }],
]);

test('the roster name wins over the name the sender typed', () => {
  assert.equal(shownSender({ fromUid: 'u-marco', fromName: 'Federico (owner)' }, roster), 'Marco Rossi');
});

test('a roster row with no name still beats the typed one, by its address', () => {
  assert.equal(shownSender({ fromUid: 'u-noname', fromName: 'Federico' }, roster), 'anna@example.com');
});

test('the typed name is only the fallback: no roster yet, or a sender it no longer has', () => {
  assert.equal(shownSender({ fromUid: 'u-marco', fromName: 'Marco' }, null), 'Marco');
  assert.equal(shownSender({ fromUid: 'u-gone', fromName: 'Ex worker' }, roster), 'Ex worker');
  assert.equal(shownSender(null, roster), '');
});

test('both screens draw the list under shownSender, never under fromName alone', () => {
  const screen = read('js/orders/order-requests.js');
  assert.equal((screen.match(/shownSender\(request, /g) || []).length, 2,
    'the card and the open list must both ask shownSender');
  assert.doesNotMatch(screen, /who: request\.fromName/, 'a screen shows the typed name again');
  const main = read('js/orders/orders-main.js');
  assert.equal((main.match(/roster: rosterByUid,/g) || []).length, 2,
    'both screens must be handed the roster');
});

test('the order-list push takes the sender from the roster, not from the list', () => {
  const index = read('functions/index.js');
  const fn = between(index, 'export const notifyOrderRequest', '\n);', 'notifyOrderRequest');
  assert.match(fn, /const fromName = await rosterNameOf\(lid, request\.fromUid\);/);
  assert.match(fn, /orderRequestNotification\(\{ \.\.\.request, fromName \}/);
  const helper = between(index, 'async function rosterNameOf', '\n}\n', 'rosterNameOf');
  assert.match(helper, /\/\^\[A-Za-z0-9\]\{1,128\}\$\/\.test\(uid\)/, 'the uid goes into a path and must be checked');
  assert.match(helper, /locations\/\$\{lid\}\/members\/\$\{uid\}/);
});

// ── «New order» on every phone ────────────────────────────────────────────────

test('a client-order push carries only the address-book name and a real date', () => {
  const fn = between(read('functions/index.js'), 'export const notifyClientOrder', '\n);', 'notifyClientOrder');
  const call = fn.slice(fn.indexOf('const message = orderNotification('));
  assert.match(call, /clientName: bookName,/, 'the title must use the bakery\'s own name only');
  assert.match(call, /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(order\.date\)/, 'the date must be a date');
  assert.doesNotMatch(fn, /orderNotification\(bookName \? /, 'the order\'s own name is back as a fallback');
  assert.doesNotMatch(fn, /\.\.\.order/, 'the whole order is handed to the notification again');
});

// ── The print agent's password file ───────────────────────────────────────────

test('the print agent never keeps its password in the shared temp folder', () => {
  const agent = read('print-agent/agent.mjs');
  const path = between(agent, 'function configPath()', '\n}\n', 'configPath', 80);
  assert.doesNotMatch(path, /tmpdir\(\)/, 'the settings file can land in /tmp again');
  assert.match(path, /join\(homedir\(\), '\.config'\)/);
});

test('…and refuses a settings file other accounts can read, before reading it', () => {
  const agent = read('print-agent/agent.mjs');
  const load = between(agent, 'function loadConfig()', 'readFileSync(path', 'loadConfig', 40);
  assert.match(load, /refuseIfShared\(path\);/, 'the permission check must run before the password is read');
  assert.match(agent, /if \(mode & 0o077\) \{/);
});
