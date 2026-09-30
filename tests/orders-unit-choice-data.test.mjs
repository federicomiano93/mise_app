// The order-unit choice in the DATA layer: the draft carries a unit, the history freezes
// it, and two orders in different units are refused instead of added up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedEntries, quantityPathsFor, buildSupplierArchive, mergeArchives,
} from '../js/orders/archive.js';
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
