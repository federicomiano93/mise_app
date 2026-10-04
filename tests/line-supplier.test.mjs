// «Ordina da un altro fornitore» — one draft line ordered from ANOTHER supplier, for this order
// only (js/orders/line-supplier.js). The ingredient keeps its usual supplier; the line carries
// `entries.<id>.supplierId`. What must never break:
//   - the line is in ONE supplier's order, never two and never none;
//   - the override only exists while the line has a quantity, and every write that takes the
//     quantity away takes the key away in the same write;
//   - a supplier that is gone or switched off never makes the line vanish;
//   - the «to re-order» list does not bring the line back once it was resolved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanSupplierId, overrideOf, lineSupplierId, withLineSuppliers, overrideSignature,
} from '../js/orders/line-supplier.js';
import { resolveSuppliers, orderSuppliers, NO_SUPPLIER_ID } from '../js/orders/no-supplier.js';
import {
  ingredientsOf, supplierHasItems, buildSupplierArchive, mergeArchives, quantityPathsFor,
  changedEntries, historyDocId,
} from '../js/orders/archive.js';
import { orderedItems, buildOrderMessage } from '../js/orders/order-text.js';
import { stillToReorder, applyReorder } from '../js/orders/deliveries.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const ALDO = { id: 'aldo', name: 'Aldo Legacy Foods Ltd', shortName: 'Aldo' };
const BRUNO = { id: 'bruno', name: 'Bruno Wholesale Ltd', shortName: 'Bruno' };
const SUPPLIERS = [ALDO, BRUNO];
const FLOUR = { id: 'flour', name: 'Flour Invoice Name', weight: '25kg', supplierId: 'aldo' };
const YEAST = { id: 'yeast', name: 'Yeast', supplierId: 'aldo' };
const INGREDIENTS = [FLOUR, YEAST];
const NOW = new Date(2026, 9, 2, 9, 0);

// ── The helper ────────────────────────────────────────────────────────────────

test('a line goes to its override while it has a quantity, else to its usual supplier', () => {
  assert.equal(lineSupplierId(FLOUR, { qty: 3, supplierId: 'bruno' }), 'bruno');
  assert.equal(lineSupplierId(FLOUR, { qty: 3 }), 'aldo');
  assert.equal(lineSupplierId(FLOUR, undefined), 'aldo');
  assert.equal(lineSupplierId(FLOUR, { qty: 0, supplierId: 'bruno' }), 'aldo', 'no quantity, no override');
  assert.equal(lineSupplierId(FLOUR, { qty: '', supplierId: 'bruno' }), 'aldo');
  assert.equal(lineSupplierId(FLOUR, { qty: 0.4, supplierId: 'bruno' }), 'aldo', 'rounds to nothing, like the rows do');
});

test('an empty or blank override reads as «no override» — how a cleared key travels in a merge write', () => {
  assert.equal(lineSupplierId(FLOUR, { qty: 3, supplierId: '' }), 'aldo');
  assert.equal(lineSupplierId(FLOUR, { qty: 3, supplierId: '   ' }), 'aldo');
  assert.equal(lineSupplierId(FLOUR, { qty: 3, supplierId: null }), 'aldo');
  assert.equal(lineSupplierId(FLOUR, { qty: 3, supplierId: 7 }), 'aldo', 'only a string counts');
  assert.equal(cleanSupplierId(' bruno '), 'bruno');
  assert.equal(overrideOf({ qty: 2, supplierId: 'bruno' }), 'bruno');
  assert.equal(overrideOf({ qty: 0, supplierId: 'bruno' }), '');
});

test('overrideSignature changes when a line moves, never when only a number is typed', () => {
  const a = { flour: { qty: 3, supplierId: 'bruno' }, yeast: { qty: 1 } };
  assert.equal(overrideSignature(a), 'flour>bruno');
  assert.equal(overrideSignature({ ...a, flour: { qty: 9, supplierId: 'bruno' } }), 'flour>bruno');
  assert.equal(overrideSignature({ ...a, flour: { qty: 0, supplierId: 'bruno' } }), '');
  assert.equal(overrideSignature({}), '');
  assert.equal(overrideSignature(undefined), '');
});

// ── The lens: ONE place decides whose line a line is ──────────────────────────

const ENTRIES = { flour: { qty: 4, stock: 0, supplierId: 'bruno' } };

test('the lens files an overridden line under the other supplier and remembers the usual one', () => {
  const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, ENTRIES);
  const flour = lens.find(i => i.id === 'flour');
  assert.equal(flour.supplierId, 'bruno');
  assert.equal(flour.usualSupplierId, 'aldo');
  assert.equal(lens.find(i => i.id === 'yeast').supplierId, 'aldo');
  assert.equal(lens.find(i => i.id === 'yeast').usualSupplierId, undefined);
  assert.equal(FLOUR.supplierId, 'aldo', 'the ingredient itself is never changed');
});

test('without the draft the lens is exactly what it was: every ingredient with its usual supplier', () => {
  const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true);
  assert.deepEqual(lens.map(i => i.supplierId), ['aldo', 'aldo']);
  assert.equal(resolveSuppliers(INGREDIENTS, SUPPLIERS, false, ENTRIES), INGREDIENTS, 'untouched until suppliers load');
});

test('an override to a supplier that is gone, switched off or the pseudo one falls back — the line never vanishes', () => {
  const cases = {
    deleted: [ALDO],
    off: [ALDO, { ...BRUNO, active: false }],
  };
  for (const [label, suppliers] of Object.entries(cases)) {
    const lens = resolveSuppliers(INGREDIENTS, suppliers, true, ENTRIES);
    assert.equal(lens.find(i => i.id === 'flour').supplierId, 'aldo', `${label}: back with Aldo`);
    assert.equal(supplierHasItems('aldo', lens, ENTRIES), true, `${label}: still ordered from Aldo`);
  }
  const pseudo = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, { flour: { qty: 4, supplierId: NO_SUPPLIER_ID } });
  assert.equal(pseudo.find(i => i.id === 'flour').supplierId, 'aldo');
  assert.equal(withLineSuppliers(INGREDIENTS, ENTRIES, []).find(i => i.id === 'flour').supplierId, 'aldo');
});

test('an override that names the usual supplier changes nothing', () => {
  const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, { flour: { qty: 4, supplierId: 'aldo' } });
  assert.equal(lens.find(i => i.id === 'flour').usualSupplierId, undefined);
});

test('a line ordered elsewhere can come from an ingredient whose own supplier is gone («No supplier»)', () => {
  const orphan = { id: 'o', name: 'Orphan', supplierId: 'deleted' };
  const lens = resolveSuppliers([orphan], SUPPLIERS, true, { o: { qty: 1, supplierId: 'bruno' } });
  assert.equal(lens[0].supplierId, 'bruno');
  assert.equal(lens[0].usualSupplierId, NO_SUPPLIER_ID);
  const alone = resolveSuppliers([orphan], SUPPLIERS, true);
  assert.equal(orderSuppliers(SUPPLIERS, alone).at(-1).id, NO_SUPPLIER_ID);
  assert.equal(orderSuppliers(SUPPLIERS, lens).some(s => s.id === NO_SUPPLIER_ID), false, 'nothing is left under it');
});

// ── The archive: X's record has the line, the usual supplier's does not ───────

test('the other supplier\'s record holds the line with its frozen name; the usual one\'s does not', () => {
  const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, ENTRIES);
  const entries = { ...ENTRIES, yeast: { qty: 2, stock: 0 } };
  const forBruno = buildSupplierArchive({ supplier: BRUNO, ingredients: lens, entries, date: '2026-10-02', now: NOW });
  assert.deepEqual(forBruno.quantities, { flour: 4 });
  assert.equal(forBruno.names.flour, 'Flour Invoice Name 25kg');
  assert.equal(forBruno.supplierId, 'bruno');
  assert.equal(forBruno.supplierName, 'Bruno');

  const forAldo = buildSupplierArchive({ supplier: ALDO, ingredients: lens, entries, date: '2026-10-02', now: NOW });
  assert.deepEqual(forAldo.quantities, { yeast: 2 }, 'the flour is not in Aldo\'s order');

  assert.deepEqual(ingredientsOf('bruno', lens).map(i => i.id), ['flour']);
  assert.equal(supplierHasItems('aldo', lens, { flour: ENTRIES.flour }), false, 'nothing left to place with Aldo');
  assert.equal(supplierHasItems('bruno', lens, ENTRIES), true);
});

test('placing the other supplier\'s order the same day adds to it like any second order', () => {
  const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, ENTRIES);
  const first = buildSupplierArchive({ supplier: BRUNO, ingredients: lens, entries: ENTRIES, date: '2026-10-02', now: NOW });
  const again = buildSupplierArchive({ supplier: BRUNO, ingredients: lens, entries: ENTRIES, date: '2026-10-02', now: NOW });
  assert.equal(mergeArchives(first, again).quantities.flour, 8);
  assert.equal(historyDocId('2026-10-02', 'bruno'), '2026-10-02_bruno');
});

// ── What is cleared, and when ─────────────────────────────────────────────────

test('«start again» for the other supplier clears the line AND its override; the usual supplier\'s clear does not touch it', () => {
  const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, ENTRIES);
  const bruno = quantityPathsFor(['bruno'], lens);
  assert.ok(bruno.includes('entries.flour.qty'));
  assert.ok(bruno.includes('entries.flour.unit'));
  assert.ok(bruno.includes('entries.flour.supplierId'), 'the override goes with the quantity');
  assert.ok(bruno.includes('days.bruno'));

  const aldo = quantityPathsFor(['aldo'], lens);
  assert.ok(!aldo.some(p => p.startsWith('entries.flour.')), 'the line is not Aldo\'s to clear');
  assert.ok(aldo.includes('entries.yeast.supplierId'), 'every cleared row drops a stale override too');
});

// ── The delta writer: a key is sent, and sent again as '' when it goes ─────────

test('an overridden line is written with its supplier; going to zero or back writes \'\' (a merge cannot delete)', () => {
  assert.deepEqual(
    changedEntries({ flour: { qty: 4, stock: 0, supplierId: 'bruno' } }, {}),
    { flour: { qty: 4, stock: 0, supplierId: 'bruno' } });

  const known = { flour: { qty: 4, stock: 0, supplierId: 'bruno' } };
  assert.deepEqual(changedEntries(known, known), {}, 'unchanged -> nothing to say');
  assert.deepEqual(
    changedEntries({ flour: { qty: 9, stock: 0, supplierId: 'bruno' } }, known), { flour: { qty: 9, stock: 0, supplierId: 'bruno' } },
    'a number typed on the other supplier\'s row keeps the override');
  assert.deepEqual(
    changedEntries({ flour: { qty: 0, stock: 0, supplierId: 'bruno' } }, known),
    { flour: { qty: 0, stock: 0, supplierId: '' } }, 'zero takes the key away even if memory still holds it');
  assert.deepEqual(
    changedEntries({ flour: { qty: 4, stock: 0, supplierId: '' } }, known),
    { flour: { qty: 4, stock: 0, supplierId: '' } }, 'typing on the usual supplier\'s row moves it back');
  assert.deepEqual(
    changedEntries({ flour: { qty: 0, stock: 0 } }, known),
    { flour: { qty: 0, stock: 0, supplierId: '' } }, 'a cleared row that lost the key entirely');
});

test('an ordinary line keeps exactly {qty, stock} — the key appears only when somebody used it', () => {
  assert.deepEqual(changedEntries({ yeast: { qty: 2, stock: 1 } }, {}), { yeast: { qty: 2, stock: 1 } });
  assert.deepEqual(
    changedEntries({ yeast: { qty: 2, stock: 1, supplierId: '' } }, { yeast: { qty: 1, stock: 1 } }),
    { yeast: { qty: 2, stock: 1 } });
});

// ── «Da riordinare»: the line leaves when an order really names it ────────────

test('a stored leftover override with no quantity is cleared by the next write (stock only)', () => {
  const known = { L: { qty: undefined, stock: 2, supplierId: 'X' } };
  assert.deepEqual(changedEntries({ L: { qty: 5, stock: 2, supplierId: '' } }, known),
    { L: { qty: 5, stock: 2, supplierId: '' } });
});

test('«put back» over a stored {qty: 0, unit, supplierId} clears the override', () => {
  const known = { L: { qty: 0, stock: 0, unit: 'busta', supplierId: 'X' } };
  assert.deepEqual(changedEntries({ L: { qty: 5, stock: 0, unit: 'busta', supplierId: '' } }, known),
    { L: { qty: 5, stock: 0, unit: 'busta', supplierId: '' } });
  assert.deepEqual(changedEntries({ L: { qty: 0, stock: 0, unit: 'busta', supplierId: 'X' } }, known),
    { L: { qty: 0, stock: 0, unit: 'busta', supplierId: '' } }, 'even with nothing else changed');
});

test('a supplier whose rows are all ordered elsewhere draws a 0% bar, never NaN%', () => {
  assert.match(read('js/orders/ingredients.js'), /total \? Math\.round\(\(filled \/ total\) \* 100\) : 0/);
});

test('placing an order clears by the lens as it is NOW', () => {
  const main = read('js/orders/orders-main.js');
  assert.match(main, /await clearSupplier\(supplierId, orderIngredients\(\)\);\s*setStatus\(t\('orders\.orderSavedToHistory'/);
});

const MISSED = [{
  id: '2026-09-29_aldo', date: '2026-09-29', supplierId: 'aldo', quantities: { flour: 5 },
  deliveredAt: '2026-09-30T08:00:00Z', missing: { flour: true },
}];

test('moved to the other supplier: hidden while it sits in the draft', () => {
  assert.deepEqual(stillToReorder(MISSED, { flour: { qty: 5, supplierId: 'bruno' } }), []);
});

test('moved to the other supplier and that order never placed (draft cleared): back in the list', () => {
  assert.equal(stillToReorder(MISSED, {}).length, 1);
});

test('moved to the other supplier and that order PLACED: gone for good', () => {
  const placed = [...MISSED, { id: '2026-10-02_bruno', date: '2026-10-02', supplierId: 'bruno', quantities: { flour: 5 } }];
  assert.deepEqual(stillToReorder(placed, {}), []);
});

test('a later order from the usual supplier still clears it, and one from before the miss does not', () => {
  const later = [...MISSED, { id: '2026-10-01_aldo', date: '2026-10-01', supplierId: 'aldo', quantities: { flour: 2 } }];
  assert.deepEqual(stillToReorder(later, {}), []);
  const earlier = [...MISSED, { id: '2026-09-20_bruno', date: '2026-09-20', supplierId: 'bruno', quantities: { flour: 2 } }];
  assert.equal(stillToReorder(earlier, {}).length, 1);
});

test('«Risolto» still keeps the line gone, in the draft and after it', () => {
  const resolved = [{ ...MISSED[0], missingResolved: { flour: '2026-10-02T09:00:00Z' } }];
  assert.deepEqual(stillToReorder(resolved, { flour: { qty: 5, supplierId: 'bruno' } }), []);
  assert.deepEqual(stillToReorder(resolved, {}), []);
});

test('«put back» skips a line that is already in an order, wherever that order is', () => {
  const item = stillToReorder(MISSED, {})[0];
  const { applied, skipped } = applyReorder([item], { flour: { qty: 3, supplierId: 'bruno' } });
  assert.equal(applied.length, 0);
  assert.equal(skipped.length, 1);
});

// ── The text a supplier receives ──────────────────────────────────────────────

test('the message to the other supplier carries the line under the INVOICE name; the usual supplier\'s does not', () => {
  const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, ENTRIES);
  const entries = { ...ENTRIES, yeast: { qty: 2, stock: 0 } };
  const itemsFor = id => orderedItems(ingredientsOf(id, lens), entries);

  const toBruno = buildOrderMessage([{ supplierName: 'Bruno', items: itemsFor('bruno') }]);
  assert.match(toBruno, /Flour Invoice Name 25kg: 4/);
  assert.doesNotMatch(toBruno, /Yeast/);

  const toAldo = buildOrderMessage([{ supplierName: 'Aldo', items: itemsFor('aldo') }]);
  assert.match(toAldo, /Yeast: 2/);
  assert.doesNotMatch(toAldo, /Flour/);
});

// ── The wiring: every place that ties a line to a supplier goes through the lens ──

test('the order flow reads ingredients through the lens that knows the draft, and the rows claim the line', () => {
  const main = read('js/orders/orders-main.js');
  // (memoised since the render pass: the same call, also keyed on the override signature — tests/orders-memo.test.mjs)
  assert.match(main, /resolveLens\(state\.ingredients, state\.suppliers, state\.loaded\.suppliers, state\.entries,\s*overrideSignature\(state\.entries\)\)/);
  // What a supplier SELLS is the lens without the draft.
  assert.match(main, /function catalogueIngredients\(\) \{\s*return resolveCatalogue\(state\.ingredients, state\.suppliers, state\.loaded\.suppliers\);/);
  assert.match(main, /const ingredients = groupBy\(catalogueIngredients\(\)/, 'the read-only product list');
  assert.match(main, /ingredients: screenRowsFor\(supplier\.id\)/, 'a supplier\'s own screen');
  // A draft snapshot that moves a line repaints, the echo of this phone\'s own typing does not.
  assert.match(main, /const overridesBefore = overrideSignature\(state\.entries\);/);
  assert.match(main, /if \(overrideSignature\(state\.entries\) !== overridesBefore\) scheduleRender\('list'\);/);
  // «start again» also forgets the key in memory.
  assert.match(main, /delete entry\.supplierId;/);
  // «put back» never lands in an order an old override pointed at.
  assert.match(main, /supplierId: '',\s*\};/);

  const rows = read('js/orders/ingredients.js');
  assert.match(rows, /if \(ing\.usualSupplierId\) entry\.supplierId = qty > 0 \? supplier\.id : '';/);
  assert.match(rows, /else if \(entry\.supplierId\) entry\.supplierId = '';/);
  assert.match(rows, /class: 'ing-line-note'/);
  assert.match(rows, /t\('orders\.line\.thisTimeFrom'/);
  assert.match(rows, /t\('orders\.line\.usuallyFrom'/);
});

test('no file in the order flow compares an ingredient\'s supplierId to a supplier by hand', () => {
  // ingredientsOf() reads the lens it is given; the only raw reads left are the catalogue's
  // (the product list, the management screens) and the legacy History card.
  const files = ['orders-main.js', 'suppliers.js', 'reminders.js', 'preview.js', 'order-summary.js',
    'order-request-model.js', 'untold-changes.js', 'order-text.js'];
  files.forEach(f => {
    assert.doesNotMatch(read(`js/orders/${f}`), /\.supplierId === /, `${f} compares supplierId by hand`);
  });
});

test('the new texts exist in English and Italian', () => {
  const src = read('js/i18n.js');
  for (const key of ['orders.line.usuallyFrom', 'orders.line.thisTimeFrom']) {
    assert.equal(src.split(`'${key}'`).length - 1, 2, `${key} in both dictionaries`);
  }
});
