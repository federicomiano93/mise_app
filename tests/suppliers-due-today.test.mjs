// «Quando è il giorno che bisogna ordinare un fornitore, evidenziarlo nella lista dei fornitori»
// (Federico's note). A supplier is lit in BOTH lists (Orders, Fornitori) while it is STILL to order
// today: the same rule as the «Ordina oggi» strip's open chips. The rule is pure and tested here
// directly; the wiring has no DOM to run in, so it is pinned by reading the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dueTodayIds, todayOrders } from '../js/orders/reminders.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

// 6 November 2026 is a Friday.
const FRIDAY = '2026-11-06';
const LAST_FRIDAY = '2026-10-30';
const ALBA = { id: 'alba', name: 'Alba', orderDays: ['Friday'], active: true };
const MONDAYS = { id: 'mon', name: 'Mondays', orderDays: ['Monday'], active: true };
const dueOf = (args) => [...dueTodayIds({ today: FRIDAY, history: [], ...args })];

test('dueTodayIds: order day today, nothing recorded, not closed → in', () => {
  assert.deepEqual(dueOf({ suppliers: [ALBA] }), ['alba']);
});

test('dueTodayIds: an order recorded today takes the supplier out', () => {
  const history = [{ id: `${FRIDAY}_alba`, date: FRIDAY, supplierId: 'alba' }];
  assert.deepEqual(dueOf({ suppliers: [ALBA], history }), []);
});

test('dueTodayIds: closed as not ordered TODAY → out; closed on another day → still in', () => {
  assert.deepEqual(dueOf({ suppliers: [ALBA], skipped: { alba: FRIDAY } }), []);
  assert.deepEqual(dueOf({ suppliers: [ALBA], skipped: { alba: LAST_FRIDAY } }), ['alba']);
});

test('dueTodayIds: placed AND skipped → out', () => {
  const history = [{ id: `${FRIDAY}_alba`, date: FRIDAY, supplierId: 'alba' }];
  assert.deepEqual(dueOf({ suppliers: [ALBA], history, skipped: { alba: FRIDAY } }), []);
});

test('dueTodayIds: inactive, or another order day → out', () => {
  assert.deepEqual(dueOf({ suppliers: [{ ...ALBA, active: false }] }), []);
  assert.deepEqual(dueOf({ suppliers: [MONDAYS] }), []);
});

test('dueTodayIds: no today → an empty Set, never a throw', () => {
  const ids = dueTodayIds({ suppliers: [ALBA], history: [], today: '' });
  assert.ok(ids instanceof Set);
  assert.equal(ids.size, 0);
});

test('dueTodayIds agrees with the strip: exactly the rows neither placed nor skipped', () => {
  const suppliers = [ALBA, { id: 'brava', name: 'Brava', orderDays: ['Friday'], active: true }];
  const args = { suppliers, history: [], today: FRIDAY, skipped: { brava: FRIDAY } };
  const open = todayOrders(args).filter(r => !r.placed && !r.skipped).map(r => r.supplier.id);
  assert.deepEqual([...dueTodayIds(args)], open);
});

test('Orders list: the row carries the tag always, toggled in place by markDue', () => {
  const src = read('js/orders/suppliers.js');
  assert.match(src, /data\.dueToday\?\.has\(supplier\.id\)/);
  assert.match(src, /class: 'supplier-due-tag', id: `due-\$\{supplier\.id\}`, text: t\('orders\.list\.dueToday'\)/);
  assert.match(src, /dueTag\.hidden = !due/);
  assert.match(src, /supplier-row--due/);
  assert.match(src, /markDue\(ids\)/);
  assert.match(src, /classList\.toggle\('supplier-row--due', due\)/);
  assert.match(src, /tag\.hidden = !due/);
  const markDue = src.slice(src.indexOf('markDue(ids)'));
  assert.doesNotMatch(markDue.slice(0, 300), /replaceChildren|buildSupplierRow|paint\(\)/,
    'markDue must not rebuild rows');
});

test('Orders screen: the highlight waits for suppliers, history AND the draft, and follows renderReminders', () => {
  const src = read('js/orders/orders-main.js');
  const fn = src.slice(src.indexOf('function dueTodayNow()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /state\.loaded\.suppliers/);
  assert.match(body, /state\.loaded\.history/);
  assert.match(body, /state\.loaded\.draft/);
  assert.match(body, /state\.showingCopy/);
  assert.match(src, /dueToday: dueTodayNow\(\)/);
  const reminders = src.slice(src.indexOf('function renderReminders()'));
  assert.match(reminders.slice(0, reminders.indexOf('\n}\n')), /cardsView\?\.markDue\(/);
  assert.match(reminders.slice(0, reminders.indexOf('\n}\n')), /remindersDay = todayISO\(\)/);
  // Midnight: the strip and the highlight are redrawn for the new day.
  assert.match(src, /setInterval\(\(\) => \{\s*\n\s*if \(remindersDay && todayISO\(\) !== remindersDay\) scheduleRender\('reminders'\);/);
  assert.ok(src.indexOf("let remindersDay = ''") > 0
    && src.indexOf("let remindersDay = ''") < src.indexOf('let cardsView = null') + 200, 'declared with the other top-level state (TDZ)');
});

test('Fornitori page: a dueToday getter, two bounded listeners last, redraw only on change', () => {
  const main = read('js/orders/registry-main.js');
  assert.match(main, /dueToday: dueForPaint/);
  assert.match(main, /dueTodayIds\(/);
  assert.match(main, /watchRecentHistory\(todayISO\(\)/);
  assert.match(main, /watchDoc\(COLLECTIONS\.drafts, 'current'/);
  assert.ok(main.indexOf('watchRecentHistory(todayISO()') > main.indexOf('watchIngredientPrices('),
    'the two highlight listeners come after the four the rows need');
  // Review of 6 Nov: no forced redraw on a first answer (two extra rebuilds of 302 rows on every
  // open), and the painted signature is also kept when the refresh did not ask the getter.
  const fn = main.slice(main.indexOf('function refreshIfDueChanged('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.doesNotMatch(body, /first/, 'no redraw forced on a listener\'s first answer');
  assert.match(body, /if \(now === paintedDue\) return;/);
  assert.match(body, /paintedDue = now;\s*\n\s*screen\.refresh\(\);/);
  assert.match(main.slice(main.indexOf('function dueForPaint()')), /paintedDue = idsSignature\(ids\)/);
  assert.match(main, /setInterval\(\(\) => refreshIfDueChanged\(\), 60 \* 1000\)/, 'midnight repaints the highlight');

  const reg = read('js/orders/registry.js');
  assert.match(reg, /data\.dueToday\?\.\(\)/);
  assert.match(reg, /classList\.add\('reg-due'\)/);
  assert.match(reg, /text: t\('orders\.list\.dueToday'\)/);
});

test('both languages have the tag text', () => {
  const src = read('js/i18n.js');
  assert.match(src, /'orders\.list\.dueToday': 'To order today'/);
  assert.match(src, /'orders\.list\.dueToday': 'Da ordinare oggi'/);
});

test('CSS: crust colours (not the green pane marker), and the picked row keeps its own tint', () => {
  const css = read('orders.css');
  assert.match(css, /\.mgmt-item\.reg-due:not\(\[aria-current="true"\]\)\s*\{[^}]*var\(--crust\)/);
  assert.match(css, /\.supplier-due-tag\s*\{[^}]*var\(--crust-bg\)[^}]*var\(--crust-ink\)/);
  assert.match(css,
    /body\[data-section="orders"\] \.supplier-row\.supplier-row--due > \.supplier-row-open\s*\{[^}]*var\(--crust\)/);
});
