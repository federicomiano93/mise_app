// Closing a calendar notice you have read, without losing it.
//
// ⚠️⚠️ ONLY THE CALENDAR NOTICES CLOSE, AND THAT IS THE POINT (Federico, 24 Aug 2026).
// A coming holiday is something to read once. Everything else on that screen is WORK
// — orders to place today, orders that never arrived, something added nobody was told
// about — and a closeable piece of work is one somebody can close by mistake and never
// see again. What this file is handed is only ever what #orders-alerts holds, which
// notifications.js has already narrowed to the calendar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  visibleAlerts, hiddenAlerts, pruneDismissed, withDismissed, reopenAll,
  readDismissed, writeDismissed, DISMISSED_KEY,
} from '../js/orders/alert-dismissal.js';
import { _dictionaries } from '../js/i18n.js';

const XMAS = { key: 'bh-2026-12-25', kind: 'holiday', text: 'Christmas' };
const CLASH = { key: 'conf-SUP_A-2026-12-25', kind: 'conflict', text: 'clash' };
const NEWYEAR = { key: 'bh-2027-01-01', kind: 'holiday', text: 'New Year' };

// ── 1. Closing one, and what is left ─────────────────────────────────────────

test('a closed notice is not shown; the others are', () => {
  const dismissed = withDismissed([], XMAS.key);
  assert.deepEqual(visibleAlerts([XMAS, CLASH], dismissed).map(a => a.key), [CLASH.key]);
  assert.deepEqual(hiddenAlerts([XMAS, CLASH], dismissed).map(a => a.key), [XMAS.key]);
});

test('closing the same one twice does not double it', () => {
  const once = withDismissed([], XMAS.key);
  assert.deepEqual(withDismissed(once, XMAS.key), once);
});

test('nothing closed: everything is shown, and there is nothing to reopen', () => {
  assert.equal(visibleAlerts([XMAS, CLASH], []).length, 2);
  assert.equal(hiddenAlerts([XMAS, CLASH], []).length, 0);
});

// ⚠️ The pill stands for "the notices you put away", so it puts them ALL back. Doing
// it one at a time would mean tapping three times to find out there is nothing new.
test('⚠️ reopening clears the lot', () => {
  assert.deepEqual(reopenAll(), []);
  assert.equal(visibleAlerts([XMAS, CLASH], reopenAll()).length, 2);
});

// ── 2. A DIFFERENT holiday is a different question ───────────────────────────

// ⚠️⚠️ THIS IS WHAT MAKES "IT COMES BACK ON ITS OWN" TRUE, and it costs nothing: the
// keys were already stable and already carried the date the notice is about.
test('⚠️⚠️ closing Christmas says nothing about New Year', () => {
  const dismissed = withDismissed([], XMAS.key);
  assert.deepEqual(visibleAlerts([NEWYEAR], dismissed).map(a => a.key), [NEWYEAR.key]);
});

// ── 3. The memory cleans itself, BY DATE ─────────────────────────────────────

// ⚠️⚠️ THE DEFECT THIS REPLACES, AND IT WAS FOUND BY RELOADING THE REAL APP. The first
// version kept only the keys still among "today's alerts", which sounds tighter and is
// not: the alerts are recomputed on every paint and the FIRST paint happens before the
// suppliers have arrived. With no suppliers there is no delivery-clash alert, so its
// key was pruned as though the notice had expired — and the moment the suppliers
// landed it reopened, wide, a notice somebody had explicitly put away.
test('⚠️⚠️ a key is kept even when this paint has no such alert yet', () => {
  const dismissed = [XMAS.key, CLASH.key];
  assert.deepEqual(pruneDismissed(dismissed, '2026-08-24'), dismissed,
    'an incomplete snapshot must not be able to forget a dismissal');
});

test('a notice whose day has passed takes its key with it', () => {
  assert.deepEqual(pruneDismissed([XMAS.key, NEWYEAR.key], '2026-12-26'), [NEWYEAR.key]);
});

test('the day itself still counts as future — the notice is about today', () => {
  assert.deepEqual(pruneDismissed([XMAS.key], '2026-12-25'), [XMAS.key]);
});

// ⚠️ None exist today. If a kind ever arrives without a date it will reopen rather
// than be silenced for ever, which is the safe direction for something whose whole
// job is to be read.
test('⚠️ a key with no date in it is dropped, not kept for ever', () => {
  assert.deepEqual(pruneDismissed(['something-else'], '2026-08-24'), []);
});

test('junk in, no throw out', () => {
  assert.deepEqual(pruneDismissed(null, '2026-08-24'), []);
  assert.deepEqual(visibleAlerts(null, null), []);
  assert.deepEqual(hiddenAlerts(null, null), []);
  assert.deepEqual(withDismissed(null, null), []);
});

// ── 4. Storage, and which way to fail ────────────────────────────────────────

const store = (initial) => {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_k, v) => { value = v; },
    read: () => value,
  };
};

test('what is written is what comes back', () => {
  const s = store(null);
  writeDismissed(s, [XMAS.key]);
  assert.deepEqual(readDismissed(s), [XMAS.key]);
});

// ⚠️⚠️ THE SAFE DIRECTION IS DECIDED BY WHAT THE SILENCE WOULD COST. whats-new-boot.js
// stays quiet when storage is unreadable, because the worst it costs is a missed
// announcement. Here silence HIDES something true about the week ahead.
test('⚠️⚠️ unreadable storage shows everything — it never hides a notice', () => {
  const broken = { getItem() { throw new Error('private window'); } };
  assert.deepEqual(readDismissed(broken), []);
  assert.equal(visibleAlerts([XMAS, CLASH], readDismissed(broken)).length, 2);
});

test('storage that refuses to be written is not worth an error', () => {
  const broken = { setItem() { throw new Error('full'); } };
  assert.equal(writeDismissed(broken, [XMAS.key]), false);
});

test('a corrupt value reads as "nothing dismissed"', () => {
  assert.deepEqual(readDismissed(store('not json')), []);
  assert.deepEqual(readDismissed(store('{"not":"a list"}')), []);
  assert.deepEqual(readDismissed(store('[1,2,{"x":1}]')), [], 'only strings are keys');
});

// ── 5. The wiring nothing on screen can show ─────────────────────────────────

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ⚠️⚠️ THE KEY MUST NOT SURVIVE A CHANGE OF VENUE. js/local-data.js clears everything
// whose prefix is not on its keep-list, and this is about THIS venue's week — the same
// reasoning that leaves `just-joined` and `orders-reminder-date` off it.
test('⚠️⚠️ the dismissal is forgotten when the venue changes', () => {
  const local = read('js/local-data.js');
  assert.ok(!local.includes(DISMISSED_KEY),
    `${DISMISSED_KEY} must NOT be in KEEP_PREFIXES — it belongs to one venue's calendar`);
});

// ⚠️ Only the calendar reaches this container: notifications.js drops the "order"
// kind before drawing. If that ever changed, work would become closeable.
test('⚠️ only calendar notices can be closed', () => {
  const src = codeOf(read('js/orders/notifications.js'));
  assert.match(src, /filter\(a => a\.kind !== 'order'\)/,
    'the "orders to place today" alert must stay out of the closeable container');
});

test('the close button is a sibling of the text, never inside it', () => {
  const src = read('js/orders/notifications.js');
  const fn = src.slice(src.indexOf('function renderAlert('));
  const body = fn.slice(0, fn.search(/^\}/m));
  assert.ok(body.length > 100, 'the slice must not be empty');
  assert.ok(body.includes("class: 'alert-close'"), 'there is a close control');
  assert.ok(body.indexOf('alert-body') < body.indexOf('alert-close'),
    'the text is its own element and the button sits beside it — a button may not '
    + 'nest inside a button, and the frame belongs to the row (PR #31)');
});

test('every new phrase exists in BOTH languages', () => {
  for (const [lang, dict] of Object.entries(_dictionaries())) {
    for (const key of ['orders.alert.close', 'orders.alert.reopen']) {
      assert.ok(typeof dict[key] === 'string' && dict[key].trim(), `${key} missing in ${lang}`);
    }
  }
});
