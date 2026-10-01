// The order-unit choice in the DATA layer: the draft carries a unit, the history freezes
// it, and two orders in different units are refused instead of added up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  changedEntries, quantityPathsFor, buildSupplierArchive, mergeArchives, unitConflicts, unitConflictList,
} from '../js/orders/archive.js';
import { routeSendsToSupplier } from '../js/orders/send-routes.js';
import { stillToReorder, applyReorder } from '../js/orders/deliveries.js';
import { confirmedEntries } from '../js/orders/untold-changes.js';

const SUPPLIER = { id: 'sup', name: 'Supplier' };
const FLOUR = { id: 'flour', name: 'Farina', weight: '2.5 kg', supplierId: 'sup', unit: 'cartone', packUnit: 'busta' };
const SALT = { id: 'salt', name: 'Sale', supplierId: 'sup', unit: 'sacco' };
const INGREDIENTS = [FLOUR, SALT];
const NOW = new Date(2026, 8, 30, 9, 0);
const cardUnitOf = id => INGREDIENTS.find(i => i.id === id)?.unit;

const archive = entries => buildSupplierArchive({
  supplier: SUPPLIER, ingredients: INGREDIENTS, entries, date: '2026-09-30', now: NOW,
});

// ── changedEntries ───────────────────────────────────────────────────────────

test('an ordinary entry keeps exactly {qty, stock}', () => {
  const out = changedEntries({ salt: { qty: 2, stock: 1 } }, {});
  assert.deepEqual(out, { salt: { qty: 2, stock: 1 } });
  assert.ok(!('unit' in out.salt));
});

test('switching a row to another unit sends the unit', () => {
  const known = { flour: { qty: 2, stock: 0 } };
  const out = changedEntries({ flour: { qty: 2, stock: 0, unit: 'busta' } }, known);
  assert.deepEqual(out, { flour: { qty: 2, stock: 0, unit: 'busta' } });
});

test('going back to the card unit sends unit: "" explicitly (a merge never deletes a key)', () => {
  const known = { flour: { qty: 2, stock: 0, unit: 'busta' } };
  const out = changedEntries({ flour: { qty: 2, stock: 0 } }, known);
  assert.deepEqual(out, { flour: { qty: 2, stock: 0, unit: '' } });
  assert.ok('unit' in out.flour);
});

test('an unchanged unit is not a change, in any spelling of "nothing"', () => {
  assert.deepEqual(changedEntries(
    { flour: { qty: 2, stock: 0, unit: ' busta ' } },
    { flour: { qty: 2, stock: 0, unit: 'busta' } }), {});
  assert.deepEqual(changedEntries(
    { flour: { qty: 2, stock: 0, unit: '' } },
    { flour: { qty: 2, stock: 0 } }), {});
});

test('a blank row that carries a unit is stored; a blank row with none still is not', () => {
  assert.deepEqual(changedEntries({ flour: { qty: 0, stock: 0 } }, {}), {});
  assert.deepEqual(changedEntries({ flour: { qty: 0, stock: 0, unit: 'busta' } }, {}),
    { flour: { qty: 0, stock: 0, unit: 'busta' } });
});

// ── Clearing ─────────────────────────────────────────────────────────────────

test('«Clear quantities» also deletes the unit, so the row returns to the card unit', () => {
  const paths = quantityPathsFor(['sup'], INGREDIENTS);
  assert.ok(paths.includes('entries.flour.qty'));
  assert.ok(paths.includes('entries.flour.unit'));
  assert.ok(paths.includes('entries.salt.unit'));
  assert.ok(!paths.includes('entries.flour'), 'the stock reading must survive');
});

// ── buildSupplierArchive ─────────────────────────────────────────────────────

test('units are frozen only for lines with a choice or a non-default unit', () => {
  const record = archive({
    flour: { qty: 2, stock: 0 },                 // has a choice, default unit
    salt: { qty: 1, stock: 0 },                  // ordinary
  });
  assert.deepEqual(record.units, { flour: 'cartone' });
});

test('a line ordered in the package freezes the package', () => {
  const record = archive({ flour: { qty: 3, stock: 0, unit: 'busta' } });
  assert.deepEqual(record.units, { flour: 'busta' });
});

test('the units key is omitted entirely when no line needs one (old shape preserved)', () => {
  const record = archive({ salt: { qty: 1, stock: 0 } });
  assert.ok(!('units' in record));
});

test('a line with a unit but no quantity freezes nothing', () => {
  const record = archive({ flour: { qty: 0, stock: 0, unit: 'busta' }, salt: { qty: 1, stock: 0 } });
  assert.ok(!('units' in record));
});

test('confirmedEntries keeps the unit of the row it confirms', () => {
  const out = confirmedEntries({ flour: { qty: 9, stock: 1, unit: 'busta' } }, [FLOUR], { flour: 2 });
  assert.deepEqual(out.flour, { qty: 2, stock: 1, unit: 'busta' });
});

// ── mergeArchives ────────────────────────────────────────────────────────────

test('the same ingredient in two different units is refused, with its ids', () => {
  const first = archive({ flour: { qty: 2, stock: 0 } });
  const second = archive({ flour: { qty: 1, stock: 0, unit: 'busta' }, salt: { qty: 1, stock: 0 } });
  assert.throws(() => mergeArchives(first, second, { cardUnitOf }), err => {
    assert.equal(err.code, 'orders/unit-conflict');
    assert.deepEqual(err.ids, ['flour']);
    return true;
  });
});

test('the same unit merges: quantities add and the units are kept', () => {
  const first = archive({ flour: { qty: 2, stock: 0, unit: 'busta' } });
  const second = archive({ flour: { qty: 1, stock: 0, unit: 'busta' }, salt: { qty: 4, stock: 0 } });
  const merged = mergeArchives(first, second, { cardUnitOf });
  assert.deepEqual(merged.quantities, { flour: 3, salt: 4 });
  assert.deepEqual(merged.units, { flour: 'busta' });
});

test('a different ingredient in a different unit is not a conflict', () => {
  const first = archive({ flour: { qty: 2, stock: 0, unit: 'busta' } });
  const second = archive({ salt: { qty: 1, stock: 0 } });
  const merged = mergeArchives(first, second, { cardUnitOf });
  assert.deepEqual(merged.quantities, { flour: 2, salt: 1 });
  assert.deepEqual(merged.units, { flour: 'busta' });
});

test('an old record without units counts as the card unit', () => {
  const old = { date: '2026-09-30', supplierId: 'sup', quantities: { flour: 2 }, stock: { flour: 0 },
    names: {}, createdAt: 'a', updatedAt: 'a' };
  const sameAsCard = archive({ flour: { qty: 1, stock: 0 } });
  assert.equal(mergeArchives(old, sameAsCard, { cardUnitOf }).quantities.flour, 3);

  const inPackage = archive({ flour: { qty: 1, stock: 0, unit: 'busta' } });
  assert.throws(() => mergeArchives(old, inPackage, { cardUnitOf }), { code: 'orders/unit-conflict' });
});

test('a unit that differs only by case or spaces is the same unit', () => {
  const first = { ...archive({ flour: { qty: 2, stock: 0, unit: 'busta' } }), units: { flour: 'Busta' } };
  const second = archive({ flour: { qty: 1, stock: 0, unit: 'busta' } });
  assert.equal(mergeArchives(first, second, { cardUnitOf }).quantities.flour, 3);
});

test('with no units anywhere, merging behaves exactly as before and adds no key', () => {
  const first = archive({ salt: { qty: 1, stock: 0 } });
  const second = archive({ salt: { qty: 2, stock: 0 } });
  const merged = mergeArchives(first, second);
  assert.equal(merged.quantities.salt, 3);
  assert.ok(!('units' in merged));
});

test('a first order (no existing record) is returned untouched', () => {
  const only = archive({ flour: { qty: 1, stock: 0 } });
  assert.equal(mergeArchives(null, only, { cardUnitOf }), only);
});

// ── Re-ordering from Incoming ────────────────────────────────────────────────

test('re-ordering carries the unit the record froze, and only when it froze one', () => {
  const history = [{
    id: '2026-09-28_sup', date: '2026-09-28', supplierId: 'sup',
    quantities: { flour: 2, salt: 1 }, units: { flour: 'busta' },
    missing: { flour: true, salt: true },
  }];
  const items = stillToReorder(history, {});
  const flour = items.find(i => i.id === 'flour');
  const salt = items.find(i => i.id === 'salt');
  assert.equal(flour.unit, 'busta');
  assert.ok(!('unit' in salt));

  const { applied } = applyReorder(items, {});
  assert.equal(applied.find(a => a.id === 'flour').unit, 'busta');
  assert.ok(!('unit' in applied.find(a => a.id === 'salt')));
});

// ── The same-day unit check, asked BEFORE anything is sent ───────────────────

const TODAYS_RECORD = {
  id: '2026-09-30_sup', date: '2026-09-30', supplierId: 'sup',
  quantities: { flour: 2, salt: 1 }, units: { flour: 'cartone' },
};

test('unitConflicts lists a line whose unit differs from the one already recorded today', () => {
  const out = unitConflicts(TODAYS_RECORD, { flour: { qty: 3, unit: 'busta' } }, INGREDIENTS, 'sup');
  assert.deepEqual(out, [{ id: 'flour', name: 'Farina 2.5 kg', unit: 'cartone' }]);
});

test('unitConflicts is silent for the same unit (any capitals), no record, or nothing typed', () => {
  assert.deepEqual(unitConflicts(TODAYS_RECORD, { flour: { qty: 3, unit: 'Cartone' } }, INGREDIENTS, 'sup'), []);
  assert.deepEqual(unitConflicts(TODAYS_RECORD, { flour: { qty: 3 } }, INGREDIENTS, 'sup'), []);
  assert.deepEqual(unitConflicts(null, { flour: { qty: 3, unit: 'busta' } }, INGREDIENTS, 'sup'), []);
  assert.deepEqual(unitConflicts(TODAYS_RECORD, { flour: { qty: 0, unit: 'busta' } }, INGREDIENTS, 'sup'), []);
});

test('unitConflicts reads a record with no frozen unit as the card unit, and ignores lines not in it', () => {
  const old = { ...TODAYS_RECORD, units: undefined };
  assert.equal(unitConflicts(old, { flour: { qty: 1, unit: 'busta' } }, INGREDIENTS, 'sup').length, 1);
  assert.deepEqual(unitConflicts(old, { flour: { qty: 1 } }, INGREDIENTS, 'sup'), []);
  const other = { ...TODAYS_RECORD, quantities: { salt: 1 } };
  assert.deepEqual(unitConflicts(other, { flour: { qty: 1, unit: 'busta' } }, INGREDIENTS, 'sup'), []);
});

test('unitConflicts agrees with what mergeArchives refuses', () => {
  const entries = { flour: { qty: 3, unit: 'busta' } };
  const incoming = archive(entries);
  const flagged = unitConflicts(TODAYS_RECORD, entries, INGREDIENTS, 'sup').map(c => c.id);
  assert.throws(() => mergeArchives(TODAYS_RECORD, incoming, { cardUnitOf }), err => {
    assert.deepEqual(err.ids, flagged);
    return true;
  });
});

test('unitConflictList names each line with its unit, joined by commas', () => {
  assert.equal(unitConflictList([{ name: 'A', unit: 'cartone' }, { name: 'B 2kg', unit: 'busta' }]),
    'A — cartone, B 2kg — busta');
  assert.equal(unitConflictList([]), '');
});

test('the message exists in English and Italian with a {list} placeholder', () => {
  const i18n = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  assert.match(i18n, /'orders\.unitConflict': 'Already ordered from this supplier \{day\}: \{list\}\. To add more, order it in the same unit\.'/);
  assert.match(i18n, /'orders\.unitConflict': 'Già ordinato a questo fornitore \{day\}: \{list\}\. Per aggiungerne, ordinalo nella stessa unità\.'/);
  assert.match(i18n, /'orders\.unitConflictNothingRecorded': 'Nothing has been recorded yet\.'/);
  assert.match(i18n, /'orders\.unitConflictNothingRecorded': 'Non è stato registrato ancora niente\.'/);
});

test('the conflict text names the day with the app\'s own day phrase (today, yesterday, a date)', () => {
  const main = readFileSync(new URL('../js/orders/orders-main.js', import.meta.url), 'utf8');
  assert.match(main, /t\('orders\.unitConflict', \{ day: dayWhen\(found\[0\]\.date\), list \}\)/);
  assert.match(main, /t\('orders\.unitConflict', \{ day: dayWhen\(date\), list \}\)/);
  assert.doesNotMatch(main, /t\('orders\.unitConflict', \{ list/);
});

test('the multi-supplier refusal names each supplier and says nothing was recorded', () => {
  const main = readFileSync(new URL('../js/orders/orders-main.js', import.meta.url), 'utf8');
  assert.match(main, /`\$\{who\}: \$\{c\.name\} — \$\{c\.unit\}`/);
  assert.match(main, /several && recording \? `\$\{text\} \$\{t\('orders\.unitConflictNothingRecorded'\)\}` : text/);
  assert.match(main, /\{ recording: true \}/);
});

test('routeSendsToSupplier: WhatsApp and email reach the supplier, the manager road does not', () => {
  assert.equal(routeSendsToSupplier('whatsapp'), true);
  assert.equal(routeSendsToSupplier('whatsappSupplier'), true);
  assert.equal(routeSendsToSupplier('email'), true);
  assert.equal(routeSendsToSupplier('manager'), false);
  assert.equal(routeSendsToSupplier('nonsense'), false);
});

test('⚠️ the chooser runs the check once the road is known, only for supplier roads, and synchronously', () => {
  const chooser = readFileSync(new URL('../js/orders/send-chooser.js', import.meta.url), 'utf8');
  const take = chooser.slice(chooser.indexOf('function take('));
  assert.match(take, /beforeSend && routeSendsToSupplier\(offer\.route\)/);
  assert.ok(take.indexOf('beforeSend(rows)') < take.indexOf('window.open('), 'asked before any window opens');
  assert.doesNotMatch(take.slice(0, take.indexOf('window.open(')), /await /, 'no await before the window opens');
  const preview = readFileSync(new URL('../js/orders/preview.js', import.meta.url), 'utf8');
  assert.match(preview, /beforeSend: callbacks\.beforeSend/);
  assert.doesNotMatch(preview, /await callbacks\.beforeSend/);
  assert.doesNotMatch(preview.slice(preview.indexOf('onConfirm:')), /onConfirm: async/);
  const main = readFileSync(new URL('../js/orders/orders-main.js', import.meta.url), 'utf8');
  assert.match(main, /beforeSend: rows => refuseOnUnitConflict\(/);
  assert.doesNotMatch(main, /async function refuseOnUnitConflict/);
  assert.match(main, /console\.error\('Unit check failed, carrying on:'/);
});

test('⚠️ the confirmed units reach placeOrder from every caller', () => {
  const main = readFileSync(new URL('../js/orders/orders-main.js', import.meta.url), 'utf8');
  assert.match(main, /units: confirmed\.units\[supplier\.id\]/);
  assert.match(main, /confirmedUnits = answer\.units;/);
  assert.match(main, /entriesToRecord\(supplierId, ingredients, confirmed, confirmedUnits\)/);
});

test('«now in the list» carries no unit when the live quantity is 0', () => {
  const src = readFileSync(new URL('../js/orders/order-requests.js', import.meta.url), 'utf8');
  assert.match(src, /differsUnit && differsTo > 0 \? qtyWithUnit\(differsTo, differsUnit\) : differsTo/);
});

test('⚠️ the confirm screen asks BEFORE it opens', () => {
  const main = readFileSync(new URL('../js/orders/orders-main.js', import.meta.url), 'utf8');
  const confirm = main.slice(main.indexOf('async function openPlaceConfirm('));
  assert.ok(confirm.indexOf('refuseOnUnitConflict(') > -1
    && confirm.indexOf('refuseOnUnitConflict(') < confirm.indexOf('buildPlaceConfirm('),
  'the check comes before the screen is built');
  // The merge keeps throwing as the last safety net.
  assert.match(readFileSync(new URL('../js/orders/archive.js', import.meta.url), 'utf8'), /orders\/unit-conflict/);
});

// ── The confirmation freezes the unit it showed ──────────────────────────────

test('confirmedEntries records the unit the screen SHOWED, not the live one', () => {
  const live = { flour: { qty: 9, stock: 1, unit: 'busta' } };
  const out = confirmedEntries(live, [FLOUR], { flour: 2 }, { flour: 'cartone' });
  assert.equal(out.flour.unit, 'cartone');
  assert.equal(live.flour.unit, 'busta', 'the live draft is never touched');
  assert.equal(confirmedEntries(live, [FLOUR], { flour: 2 }).flour.unit, 'busta', 'no units given: as before');
});

test('a sent list and a record with no frozen unit both mean the card unit: no false «ordered»', () => {
  const src = readFileSync(new URL('../js/orders/order-requests.js', import.meta.url), 'utf8');
  assert.match(src, /orderedUnit: recordUnit\(\{ units: orderedUnits \}, item\.id, ingredientsById\[item\.id\]\)/);
  assert.match(src, /itemUnit: recordUnit\(request, item\.id, ingredientsById\[item\.id\]\)/);
  assert.match(src, /const otherUnit = !sameUnit\(orderedUnit, itemUnit\)/);
});

// ── A card saved as «Cartone» keeps the order row's cartone / busta choice working unchanged ──
import { formatPatch } from '../js/pack-format.js';
import { hasUnitChoice, unitChoices as orderUnitChoices } from '../js/order-unit.js';
import { qtyInCardUnit } from '../js/inventory/inventory-purchases.js';

test('what «Cartone» writes makes the order row offer the carton and the package', () => {
  const written = formatPatch(
    { kind: 'single', count: null, inner: '', unit: '', packUnit: '' },
    { kind: 'carton', count: 4, inner: 'busta', cartonWord: 'cartone' },
  );
  const card = { id: 'flour', name: 'Farina', supplierId: 'sup', weight: '2.5 kg', ...written };
  assert.equal(hasUnitChoice(card), true);
  assert.deepEqual(orderUnitChoices(card), ['cartone', 'busta']);
  // a line ordered in buste is counted in cartoni by the stocktake, from the card alone
  assert.equal(qtyInCardUnit(8, 'busta', card), 2);
});

test('a line placed in the package word of a carton card freezes that unit in the record', () => {
  const card = { id: 'flour', name: 'Farina', supplierId: 'sup', weight: '2.5 kg', unit: 'cartone', packUnit: 'busta', packCount: 4 };
  const out = buildSupplierArchive({
    supplier: SUPPLIER, ingredients: [card], entries: { flour: { qty: 2, stock: 0, unit: 'busta' } }, date: '2026-09-30', now: NOW,
  });
  assert.equal(out.units.flour, 'busta');
});
