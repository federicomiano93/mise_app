// Several orders to one supplier on one day (Federico, 3 Oct 2026).
//
// 1. Each order is kept apart, with its time, inside the day's record (`sends`), so a morning
//    order and an afternoon addition can be told apart when something goes wrong.
// 2. `quantities` stays the day's TOTAL — the map suggestions, deliveries and the stocktake read.
// 3. The same ingredient in cartoni this morning and buste this afternoon is added up IN BUSTE
//    when the card says how many buste a cartone holds («1 cartone da 4 buste + 2 buste = 6
//    buste, il prezzo non cambia»), and still refused when it does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSupplierArchive, mergeArchives, unitConflicts, recordSends, sendIdFor,
  sendSections, capSends, withCorrection, MAX_SENDS,
} from '../js/orders/archive.js';
import { inPackages, addableInPackages } from '../js/order-unit.js';

const SUPPLIER = { id: 'sup', name: 'Supplier' };
const YEAST = { id: 'yeast', name: 'Lievito', supplierId: 'sup', unit: 'cartone', packUnit: 'busta', packCount: 4 };
const FLOUR = { id: 'flour', name: 'Farina', supplierId: 'sup', unit: 'cartone', packUnit: 'busta' }; // no packCount
const SALT = { id: 'salt', name: 'Sale', supplierId: 'sup', unit: 'sacco' };
const INGREDIENTS = [YEAST, FLOUR, SALT];
const cardOf = id => INGREDIENTS.find(i => i.id === id);

const MORNING = new Date('2026-10-03T07:12:00.000Z');
const AFTERNOON = new Date('2026-10-03T13:40:00.000Z');
const archive = (entries, now) => buildSupplierArchive({
  supplier: SUPPLIER, ingredients: INGREDIENTS, entries, date: '2026-10-03', now,
});

// ── inPackages ───────────────────────────────────────────────────────────────

test('a cartone counts as its buste, a busta as one, only when the card says how many', () => {
  assert.equal(inPackages(1, 'cartone', YEAST), 4);
  assert.equal(inPackages(2, 'busta', YEAST), 2);
  assert.equal(inPackages(2, 'Busta ', YEAST), 2);
  assert.equal(inPackages(1, 'cartone', FLOUR), null, 'no packCount: nothing is guessed');
  assert.equal(inPackages(2, 'busta', FLOUR), 2);
  assert.equal(inPackages(1, 'sacco', SALT), null, 'no choice on the card');
  assert.equal(inPackages(1, 'pallet', YEAST), null, 'a unit that is neither');
  assert.equal(inPackages(1, 'cartone', { ...YEAST, packCount: 0 }), null);
  assert.equal(inPackages(1, 'cartone', { ...YEAST, packCount: 2.5 }), null);
  assert.equal(addableInPackages('cartone', 'busta', YEAST), true);
  assert.equal(addableInPackages('cartone', 'busta', FLOUR), false);
});

// ── sends ────────────────────────────────────────────────────────────────────

test('a first order carries one send: its time, quantities and units', () => {
  const rec = archive({ yeast: { qty: 1, stock: 0 }, salt: { qty: 2, stock: 1 } }, MORNING);
  const id = sendIdFor(MORNING.toISOString());
  assert.equal(id, 's20261003071200000');
  assert.deepEqual(rec.sends, {
    [id]: { at: '2026-10-03T07:12:00.000Z', quantities: { yeast: 1, salt: 2 }, units: { yeast: 'cartone' } },
  });
});

test('a second order the same day adds its own send and the totals add up', () => {
  const first = archive({ salt: { qty: 2, stock: 0 } }, MORNING);
  const second = archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON);
  const merged = mergeArchives(first, second, { cardOf });
  assert.equal(merged.quantities.salt, 3);
  const sends = recordSends(merged);
  assert.deepEqual(sends.map(s => s.at), ['2026-10-03T07:12:00.000Z', '2026-10-03T13:40:00.000Z']);
  assert.deepEqual(sends.map(s => s.quantities.salt), [2, 1]);
});

test('⚠️ 1 cartone this morning + 2 buste this afternoon = 6 buste for the day; each send keeps its own unit', () => {
  const first = archive({ yeast: { qty: 1, stock: 0 } }, MORNING);
  const second = archive({ yeast: { qty: 2, stock: 0, unit: 'busta' } }, AFTERNOON);
  const merged = mergeArchives(first, second, { cardOf });
  assert.equal(merged.quantities.yeast, 6);
  assert.equal(merged.units.yeast, 'busta');
  const [morning, afternoon] = recordSends(merged);
  assert.deepEqual([morning.quantities.yeast, morning.units.yeast], [1, 'cartone']);
  assert.deepEqual([afternoon.quantities.yeast, afternoon.units.yeast], [2, 'busta']);
});

test('the other way round too: 2 buste then 1 cartone = 6 buste', () => {
  const first = archive({ yeast: { qty: 2, stock: 0, unit: 'busta' } }, MORNING);
  const second = archive({ yeast: { qty: 1, stock: 0 } }, AFTERNOON);
  const merged = mergeArchives(first, second, { cardOf });
  assert.equal(merged.quantities.yeast, 6);
  assert.equal(merged.units.yeast, 'busta');
});

test('with no packCount on the card, two units are still refused and nothing is merged', () => {
  const first = archive({ flour: { qty: 1, stock: 0 } }, MORNING);
  const second = archive({ flour: { qty: 2, stock: 0, unit: 'busta' } }, AFTERNOON);
  assert.throws(() => mergeArchives(first, second, { cardOf }), err => {
    assert.equal(err.code, 'orders/unit-conflict');
    assert.deepEqual(err.ids, ['flour']);
    return true;
  });
});

test('the check before sending agrees: addable units are not flagged, the rest are', () => {
  const record = archive({ yeast: { qty: 1, stock: 0 }, flour: { qty: 1, stock: 0 } }, MORNING);
  const entries = { yeast: { qty: 2, unit: 'busta' }, flour: { qty: 2, unit: 'busta' } };
  assert.deepEqual(unitConflicts(record, entries, INGREDIENTS, 'sup').map(c => c.id), ['flour']);
});

const OLD = {
  date: '2026-10-03', supplierId: 'sup', supplierName: 'Supplier',
  quantities: { salt: 2 }, stock: {}, names: {},
  createdAt: '2026-10-03T06:00:00.000Z', updatedAt: '2026-10-03T06:00:00.000Z',
};

test('a record from before sends existed becomes one send of what it held, at its creation time', () => {
  const merged = mergeArchives(OLD, archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
  const sends = recordSends(merged);
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0], { at: '2026-10-03T06:00:00.000Z', kind: 'order', quantities: { salt: 2 }, units: {} });
  assert.equal(merged.quantities.salt, 3);
});

test('⚠️ …but with NO time when it was rewritten after it was created (an old phone added to it)', () => {
  const touched = { ...OLD, updatedAt: '2026-10-03T10:00:00.000Z' };
  const merged = mergeArchives(touched, archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
  const [earlier] = recordSends(merged);
  assert.equal(earlier.at, '', 'two orders under the time of the first would be a lie');
  assert.equal(sendSections(merged).sections[0].heading, 'earlier');
});

test('a third order keeps the first two sends', () => {
  const a = archive({ salt: { qty: 1, stock: 0 } }, MORNING);
  const b = mergeArchives(a, archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
  const c = mergeArchives(b, archive({ salt: { qty: 1, stock: 0 } }, new Date('2026-10-03T16:00:00.000Z')), { cardOf });
  assert.equal(recordSends(c).length, 3);
  assert.equal(c.quantities.salt, 3);
});

test('recordSends skips malformed entries and reads a record with no sends as none', () => {
  assert.deepEqual(recordSends({}), []);
  assert.deepEqual(recordSends(null), []);
  const rec = { sends: { a: null, b: 'x', c: { at: 5 }, d: { at: '2026-10-03T07:00:00.000Z', quantities: { salt: 1 } } } };
  assert.deepEqual(recordSends(rec), [{ at: '2026-10-03T07:00:00.000Z', kind: 'order', quantities: { salt: 1 }, units: {} }]);
});

// ── what History draws ───────────────────────────────────────────────────────

test('History: no sends → the card as it always was; one timed send → its heading only', () => {
  assert.deepEqual(sendSections(OLD), { sections: [], total: false });
  const one = archive({ salt: { qty: 2, stock: 0 } }, MORNING);
  assert.deepEqual(sendSections(one), {
    sections: [{ heading: 'first', time: MORNING.toISOString(), quantities: null, units: null }], total: false,
  });
  // One send whose time is unknown says nothing it cannot back up.
  assert.deepEqual(sendSections({ sends: { s0: { at: '', quantities: { salt: 1 } } } }), { sections: [], total: false });
});

test('History: two or more sends → one section each (first, later, correction), then the day total', () => {
  const merged = mergeArchives(archive({ salt: { qty: 2, stock: 0 } }, MORNING),
    archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
  const corrected = { ...merged, sends: withCorrection(merged, { salt: 2 }, {}, '2026-10-03T15:00:00.000Z') };
  const out = sendSections(corrected);
  assert.equal(out.total, true);
  assert.deepEqual(out.sections.map(s => s.heading), ['first', 'later', 'edit']);
  assert.deepEqual(out.sections.map(s => s.quantities.salt), [2, 1, 2]);
});

test('a correction is added only to a record that already keeps sends', () => {
  assert.equal(withCorrection(OLD, { salt: 1 }, {}, '2026-10-03T15:00:00.000Z'), null);
  const one = archive({ salt: { qty: 2, stock: 0 } }, MORNING);
  const sends = withCorrection(one, { salt: 1 }, {}, '2026-10-03T15:00:00.000Z');
  assert.equal(Object.keys(sends).length, 2);
  assert.equal(sends[sendIdFor('2026-10-03T15:00:00.000Z')].kind, 'edit');
});

test('no more sends than the rules allow: the first and the latest are kept', () => {
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`s${String(i).padStart(3, '0')}`, { at: String(i), quantities: {} }]));
  const kept = capSends(many);
  assert.equal(Object.keys(kept).length, MAX_SENDS);
  assert.ok('s000' in kept && 's059' in kept && !('s001' in kept));
  assert.equal(capSends({ a: 1 }).a, 1);
});

test('the refusal marks a line «fixable» only when writing the pack count would make it addable', () => {
  const record = archive({ flour: { qty: 1, stock: 0 }, salt: { qty: 1, stock: 0 } }, MORNING);
  const out = unitConflicts(record, { flour: { qty: 2, unit: 'busta' }, salt: { qty: 1, unit: 'kg' } }, INGREDIENTS, 'sup');
  assert.deepEqual(out.map(c => [c.id, c.fixable]), [['flour', true], ['salt', false]]);
});

test('a mixed-unit line whose card is gone is refused, not guessed', () => {
  const first = archive({ yeast: { qty: 1, stock: 0 } }, MORNING);
  const second = archive({ yeast: { qty: 2, stock: 0, unit: 'busta' } }, AFTERNOON);
  assert.throws(() => mergeArchives(first, second, { cardOf: () => undefined }), { code: 'orders/unit-conflict' });
});

// ── wiring ───────────────────────────────────────────────────────────────────

test('the real write hands the merge each ingredient card (so packCount reaches it)', () => {
  const draft = readFileSync(new URL('../js/orders/draft.js', import.meta.url), 'utf8');
  assert.match(draft, /mergeArchives\(existing, incoming, \{ cardOf: id => cardById\[id\] \}\)/);
});

test('History draws what sendSections decides: headings with the time, then the day total', () => {
  const src = readFileSync(new URL('../js/orders/history.js', import.meta.url), 'utf8');
  assert.match(src, /const \{ sections, total \} = sendSections\(record\);/);
  assert.match(src, /\.\.\.\(total \? \[el\('div', \{ class: 'history-supplier', text: t\('orders\.history\.dayTotal'\) \}\)\] : \[\]\)/);
  assert.match(src, /t\(SEND_HEADING\[section\.heading\] \|\| SEND_HEADING\.later, \{ time \}\)/);
});

test('a correction in History is saved with its own timed entry', () => {
  const src = readFileSync(new URL('../js/orders/history-edit.js', import.meta.url), 'utf8');
  assert.match(src, /const sends = withCorrection\(record, nextQuantities, nextUnits, now\);/);
  assert.match(src, /\.\.\.\(sends \? \{ sends \} : \{\}\),/);
});

test('the rules accept sends as a small map', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /'sends'\s*\n\s*\]\)/);
  assert.match(rules, /request\.resource\.data\.sends is map\s*\n\s*&& request\.resource\.data\.sends\.size\(\) <= 50/);
});
