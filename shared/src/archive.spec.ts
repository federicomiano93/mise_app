// Unit tests for the pure half of turning a draft into history records (P15), run against BOTH implementations:
// the TypeScript port in shared/ and js/orders/archive.js, which the live app uses today. Ported from
// tests/orders-archive.test.mjs and tests/same-day-sends.test.mjs.
//
// archive.ts is ADAPTED, so parity.spec.ts does not pair it: everything is ported, and recordedName takes the word for
// a deleted ingredient as a fourth argument (the original reads the dictionary). The last describe compares the two
// files' names and arity itself, and runs recordedName against the original with the original's English word.
//
// PORTED: 39 of 52 tests of tests/orders-archive.test.mjs (an earlier version of this header said 23: it
// counted one too many) — the wholeNumber ones (2), the changedEntries ones (8), changedDays, historyDocId,
// ingredientsOf, supplierHasItems, ingredientLabel, the quantityPathsFor ones (7), buildSupplierArchive and
// the frozen names (7), mergeArchives with the «did not arrive» / «Risolto» marks and the merged names (9),
// and isLegacyRecord / recordDate (1).
// PORTED: 12 of 21 tests of tests/same-day-sends.test.mjs — the ones about buildSupplierArchive, mergeArchives,
// unitConflicts, sendIdFor, capSends and MAX_SENDS. Where they read the sends through recordSends, the spec
// sorts the record's `sends` by key instead (the ids sort by time).
//
// PORTED with slice 3f-4 (History): groupHistoryByDay (2), splitHistoryByAge / countRecords (9) and recordedName (1)
// of tests/orders-archive.test.mjs; recordSends (2), sendSections (2) and withCorrection (1) of
// tests/same-day-sends.test.mjs.
// NOT PORTED from tests/orders-archive.test.mjs (1): the legacy id ordering (a bare string comparison).
// NOT PORTED from tests/same-day-sends.test.mjs (5): inPackages (order-unit.spec.ts covers it), and the four that only
// read source text.
// tests/draft-override.test.mjs (7) is not ported either: every one of its tests drives draft.js through a
// recording stub of the data layer, which is not shared logic. The per-line override cases that do call only
// archive and line-supplier functions are ported in line-supplier.spec.ts.

import { describe, expect, test } from 'vitest';
import * as ported from './archive';
import * as legacyJs from '../../js/orders/archive.js';

const legacy = legacyJs as unknown as typeof ported;

const ALBA = { id: 'alba', name: 'Alba' };
const NOW = new Date(2026, 6, 13, 9, 0);

const INGREDIENTS = [
  { id: 'flour', name: 'Flour uniqua blue', supplierId: 'alba' },
  { id: 'semola', name: 'Semola', supplierId: 'alba' },
  { id: 'oldbag', name: 'Discontinued bag', supplierId: 'alba', active: false },
  { id: 'nutella', name: 'Nutella 3kg', supplierId: 'etna' },
];

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const {
    wholeNumber, changedEntries, changedDays, historyDocId, ingredientsOf, supplierHasItems, ingredientLabel,
    ingredientDisplayLabel, compareByLabel, sortByLabel, quantityPathsFor, isLegacyRecord, recordDate, buildSupplierArchive,
    mergeArchives, sendIdFor, capSends, MAX_SENDS, unitConflicts, unitConflictList, withCorrection, recordSends,
    sendSections, splitHistoryByAge, countRecords, groupHistoryByDay,
  } = m;

  test('a typed quantity is whole, never negative, never NaN', () => {
    expect(wholeNumber('7')).toBe(7);
    expect(wholeNumber(2.6)).toBe(3);
    expect(wholeNumber('-4')).toBe(0);
    expect(wholeNumber('abc')).toBe(0);
    expect(wholeNumber('')).toBe(0);
    expect(wholeNumber(null)).toBe(0);
    expect(wholeNumber(undefined)).toBe(0);
  });

  // A number field accepts `1e999`, which is Infinity. Firestore refuses to store a
  // non-finite number, so letting one reach the draft broke every save that followed
  // while the row on screen still looked normal.
  test('Infinity never reaches the draft — Firestore would refuse the write', () => {
    expect(wholeNumber('1e999')).toBe(0);
    expect(wholeNumber(Infinity)).toBe(0);
    expect(wholeNumber(-Infinity)).toBe(0);
    expect(wholeNumber(NaN)).toBe(0);
  });

  // ── What an autosave is allowed to send ────────────────────────────────────
  // The whole point: an autosave must mention ONLY what this phone changed, or
  // Firestore's key-by-key merge re-asserts every other row at this phone's value.

  test('only the rows this phone changed are sent', () => {
    const known = { flour: { qty: 3, stock: 1 }, semola: { qty: 2, stock: 0 } };
    const next = { flour: { qty: 5, stock: 1 }, semola: { qty: 2, stock: 0 } };
    expect(changedEntries(next, known)).toStrictEqual({ flour: { qty: 5, stock: 1 } });
  });

  test('nothing changed means nothing is sent', () => {
    const known = { flour: { qty: 3, stock: 1 } };
    expect(changedEntries({ flour: { qty: 3, stock: 1 } }, known)).toStrictEqual({});
  });

  // Opening a supplier builds a blank row in memory for every ingredient it sells.
  // Those are not edits, and storing them would fill the draft with zeroes.
  test('just looking at a supplier stores nothing', () => {
    expect(changedEntries({ flour: { qty: 0, stock: 0 }, semola: { qty: '', stock: '' } }, {})).toStrictEqual({});
  });

  test('but a row taken DOWN to zero is a real change', () => {
    expect(changedEntries({ flour: { qty: 0, stock: 0 } }, { flour: { qty: 6, stock: 0 } }))
      .toStrictEqual({ flour: { qty: 0, stock: 0 } });
  });

  test('a brand-new row counts as changed, and an empty baseline sends everything', () => {
    expect(changedEntries({ flour: { qty: 1, stock: 0 } }, {})).toStrictEqual({ flour: { qty: 1, stock: 0 } });
    expect(changedEntries({ flour: { qty: 4, stock: 2 } }, { semola: { qty: 1, stock: 0 } }))
      .toStrictEqual({ flour: { qty: 4, stock: 2 } });
  });

  test('a stock reading on its own is a change', () => {
    const known = { flour: { qty: 3, stock: 0 } };
    expect(changedEntries({ flour: { qty: 3, stock: 6 } }, known)).toStrictEqual({ flour: { qty: 3, stock: 6 } });
  });

  // "" and 0 and undefined are the same number, and a repaint hands back whichever
  // the field happened to hold. Treating that as a change would send a write per
  // keystroke and, worse, re-assert other rows for no reason.
  test('an empty field is not a change from zero', () => {
    const known = { flour: { qty: 0, stock: 0 } };
    expect(changedEntries({ flour: { qty: '', stock: undefined } }, known)).toStrictEqual({});
  });

  // THE DEFECT THIS EXISTS FOR: two phones ordering at once. Phone A holds a stale
  // copy of a row phone B has just changed; A's save must not carry that row at all.
  test('a colleague\'s newer quantity is never re-asserted at this phone\'s stale value', () => {
    const asKnownHere = { flour: { qty: 3, stock: 0 }, nutella: { qty: 1, stock: 0 } };
    // This phone typed semola; its copy of nutella is simply what it last heard.
    const typedHere = { flour: { qty: 3, stock: 0 }, nutella: { qty: 1, stock: 0 }, semola: { qty: 9, stock: 0 } };
    const sent = changedEntries(typedHere, asKnownHere);
    expect(sent).toStrictEqual({ semola: { qty: 9, stock: 0 } });
    expect('nutella' in sent, 'the row the other phone owns is not mentioned').toBe(false);
  });

  test('only the day stamps that moved are sent', () => {
    expect(changedDays({ alba: '2026-08-05', etna: '2026-07-20' }, { etna: '2026-07-20' })).toStrictEqual({ alba: '2026-08-05' });
    expect(changedDays({ etna: '2026-07-20' }, { etna: '2026-07-20' })).toStrictEqual({});
  });

  test('historyDocId is the day and the supplier', () => {
    expect(historyDocId('2026-07-13', 'alba')).toBe('2026-07-13_alba');
  });

  test('ingredientsOf hides deactivated products by default, but can list them all', () => {
    expect(ingredientsOf('alba', INGREDIENTS).map(i => i.id)).toStrictEqual(['flour', 'semola']);
    expect(ingredientsOf('alba', INGREDIENTS, { activeOnly: false }).map(i => i.id)).toStrictEqual(['flour', 'semola', 'oldbag']);
  });

  test('supplierHasItems is about ORDERED quantities, not stock readings', () => {
    expect(supplierHasItems('alba', INGREDIENTS, { flour: { qty: 3, stock: 0 } })).toBe(true);
    expect(supplierHasItems('alba', INGREDIENTS, { flour: { qty: 0, stock: 9 } })).toBe(false);
    expect(supplierHasItems('alba', INGREDIENTS, {})).toBe(false);
  });

  test('ingredientLabel joins name and weight, and copes with either missing', () => {
    expect(ingredientLabel({ name: 'Bacon', weight: '2.27kg' })).toBe('Bacon 2.27kg');
    expect(ingredientLabel({ name: 'Loose apples' })).toBe('Loose apples');
    expect(ingredientLabel(undefined)).toBe('');
  });

  // ── Clearing what has been typed, without recording an order ───────────────
  //
  // Two promises are made to the operator on the confirmation, and both live or die
  // here:
  //   * the STOCK readings stay — counting the shelves is work already done;
  //   * nothing recorded is touched — this builds draft paths only, and there is a
  //     test below that says so in as many words.

  test('clearing takes the quantity and leaves the stock reading', () => {
    const paths = quantityPathsFor(['alba'], INGREDIENTS);
    expect(paths.includes('entries.flour.qty')).toBe(true);
    expect(paths.includes('entries.flour'), 'the whole row must not be removed').toBe(false);
    expect(paths.some(p => p.endsWith('.stock')), 'no stock reading may be cleared').toBe(false);
  });

  test('the day stamp goes with the quantities', () => {
    // With nothing left to order, "these rows were typed on Monday" describes nothing.
    expect(quantityPathsFor(['alba'], INGREDIENTS).includes('days.alba')).toBe(true);
  });

  test('a deactivated product is cleared too', () => {
    // Invisible on screen but still in the document: skipping it would leave a
    // quantity nobody can see or remove.
    expect(quantityPathsFor(['alba'], INGREDIENTS).includes('entries.oldbag.qty')).toBe(true);
  });

  test('only the chosen suppliers are touched', () => {
    const paths = quantityPathsFor(['alba'], INGREDIENTS);
    expect(paths.some(p => p.includes('nutella')), "Etna's row must survive").toBe(false);
    expect(paths.includes('days.etna')).toBe(false);
  });

  test('several suppliers come back as ONE list, for one write', () => {
    const paths = quantityPathsFor(['alba', 'etna'], INGREDIENTS);
    for (const p of ['entries.flour.qty', 'entries.nutella.qty', 'days.alba', 'days.etna']) expect(paths.includes(p), p).toBe(true);
  });

  test('NOTHING in the list can reach the order history', () => {
    // The guarantee Federico asked for, pinned: every path is inside the draft.
    quantityPathsFor(['alba', 'etna'], INGREDIENTS).forEach(p => {
      expect(/^(entries|days)\./.test(p), `unexpected path: ${p}`).toBe(true);
    });
  });

  test('nothing to clear produces nothing', () => {
    expect(quantityPathsFor([], INGREDIENTS)).toStrictEqual([]);
    expect(quantityPathsFor(null, INGREDIENTS)).toStrictEqual([]);
    expect(quantityPathsFor(['alba'], [])).toStrictEqual(['days.alba']);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('the screen label uses the name to show, the sent label keeps the invoice name', () => {
    const ing = { name: 'Flour Invoice Name', shortName: 'Flour', weight: '25kg' };
    expect(ingredientLabel(ing)).toBe('Flour Invoice Name 25kg');
    expect(ingredientDisplayLabel(ing)).toBe('Flour 25kg');
    expect(ingredientDisplayLabel({ ...ing, shortName: '  ' })).toBe('Flour Invoice Name 25kg');
  });

  test('products are read numerically by label, then by id, and the caller\'s list is never reordered', () => {
    const list = [{ id: 'b', name: 'Flour', weight: '25kg' }, { id: 'a', name: 'Flour', weight: '5kg' }, null, { id: 'c', name: 'Flour', weight: '5kg' }];
    const sorted = sortByLabel(list);
    expect(sorted.map(i => i && i.id)).toStrictEqual(['a', 'c', 'b']);
    expect(list.map(i => i && i.id)).toStrictEqual(['b', 'a', null, 'c']);
    expect(compareByLabel({ id: 'x', name: 'A' }, { id: 'x', name: 'A' })).toBe(0);
  });

  // ── The record a draft becomes ─────────────────────────────────────────────

  test('the archive holds ONLY that supplier\'s products', () => {
    const entries = {
      flour: { qty: 4, stock: 1 },
      nutella: { qty: 7, stock: 2 }, // another supplier — must not leak in
    };
    const record = buildSupplierArchive({ supplier: ALBA, ingredients: INGREDIENTS, entries, date: '2026-07-13', now: NOW })!;

    expect(record.quantities).toStrictEqual({ flour: 4 });
    expect(record.stock).toStrictEqual({ flour: 1 });
    expect(record.supplierId).toBe('alba');
    expect(record.supplierName, 'frozen: survives a rename or a delete').toBe('Alba');
    expect(record.date).toBe('2026-07-13');
    expect(record.createdAt).toBe(NOW.toISOString());
  });

  test('the archive uses the day it is GIVEN, so a forgotten order files under its own day', () => {
    const record = buildSupplierArchive({
      supplier: ALBA, ingredients: INGREDIENTS,
      entries: { flour: { qty: 4, stock: 0 } },
      date: '2026-07-12', // yesterday — the day the operator actually typed it
      now: NOW,           // ...even though it is being saved today
    })!;
    expect(record.date).toBe('2026-07-12');
  });

  test('a row with stock but nothing ordered is NOT an order (it would ratchet par upward)', () => {
    const record = buildSupplierArchive({
      supplier: ALBA, ingredients: INGREDIENTS,
      entries: { flour: { qty: 4, stock: 1 }, semola: { qty: 0, stock: 9 } },
      date: '2026-07-13', now: NOW,
    })!;
    // The stock reading is kept, but semola is absent from quantities, so the
    // suggestion engine (which filters on quantities) never counts it as an order.
    expect(record.quantities).toStrictEqual({ flour: 4 });
    expect(record.stock).toStrictEqual({ flour: 1, semola: 9 });
  });

  test('an empty order is no order at all', () => {
    expect(buildSupplierArchive({
      supplier: ALBA, ingredients: INGREDIENTS, entries: {}, date: '2026-07-13', now: NOW,
    })).toBeNull();
    expect(buildSupplierArchive({
      supplier: ALBA, ingredients: INGREDIENTS,
      entries: { flour: { qty: 0, stock: 5 } }, date: '2026-07-13', now: NOW,
    })).toBeNull();
  });

  test('junk quantities are clamped, never NaN or negative', () => {
    const record = buildSupplierArchive({
      supplier: ALBA, ingredients: INGREDIENTS,
      entries: { flour: { qty: '4.6', stock: -3 }, semola: { qty: 'abc', stock: 'x' } },
      date: '2026-07-13', now: NOW,
    })!;
    expect(record.quantities).toStrictEqual({ flour: 5 });
    expect(record.stock).toStrictEqual({ flour: 0 });
  });

  test('an order records what each item was called that day', () => {
    const ingredients = [{ id: 'flour', name: 'Flour uniqua blue', weight: '25kg', supplierId: 'alba' }];
    const record = buildSupplierArchive({
      supplier: ALBA, ingredients,
      entries: { flour: { qty: 4, stock: 1 } },
      date: '2026-07-13', now: NOW,
    })!;
    expect(record.names).toStrictEqual({ flour: 'Flour uniqua blue 25kg' });
  });

  test('only ORDERED items are named — the same rows quantities holds', () => {
    const record = buildSupplierArchive({
      supplier: ALBA, ingredients: INGREDIENTS,
      entries: { flour: { qty: 4, stock: 1 }, semola: { qty: 0, stock: 9 } },
      date: '2026-07-13', now: NOW,
    })!;
    expect(Object.keys(record.names)).toStrictEqual(Object.keys(record.quantities));
  });

  // ── Two orders, one day ────────────────────────────────────────────────────

  test('a second order the same day ADDS to the first — nothing is ever lost', () => {
    const first = buildSupplierArchive({
      supplier: ALBA, ingredients: INGREDIENTS,
      entries: { flour: { qty: 4, stock: 1 } }, date: '2026-07-13', now: NOW,
    })!;
    // "I forgot the semola" — and one more bag of flour.
    const second = buildSupplierArchive({
      supplier: ALBA, ingredients: INGREDIENTS,
      entries: { flour: { qty: 1, stock: 0 }, semola: { qty: 2, stock: 0 } },
      date: '2026-07-13', now: new Date(2026, 6, 13, 15, 0),
    })!;

    const merged = mergeArchives(first, second);
    expect(merged.quantities).toStrictEqual({ flour: 5, semola: 2 }); // 4 + 1
    expect(merged.stock.semola).toBe(0);
    expect(merged.createdAt, 'when the order started').toBe(first.createdAt);
    expect(merged.updatedAt, 'when it was last touched').toBe(second.updatedAt);
  });

  test('merging into nothing is just the new order', () => {
    const incoming = buildSupplierArchive({
      supplier: ALBA, ingredients: INGREDIENTS,
      entries: { flour: { qty: 4, stock: 1 } }, date: '2026-07-13', now: NOW,
    })!;
    expect(mergeArchives(null, incoming)).toStrictEqual(incoming);
  });

  test('the newer stock reading wins — a measurement is not a total', () => {
    const existing = { quantities: { flour: 4 }, stock: { flour: 1 } };
    const incoming = { quantities: { flour: 1 }, stock: { flour: 6 } };
    expect(mergeArchives(existing, incoming).stock).toStrictEqual({ flour: 6 });
  });

  // The record is written WHOLE (transactDoc → tx.set): what the merge leaves out is deleted.
  test('a second order the same day keeps the «did not arrive» marks', () => {
    const existing = {
      quantities: { flour: 4, butter: 2 }, stock: {},
      deliveredAt: '2026-07-13T09:00:00.000Z', missing: { butter: true },
    };
    const incoming = { quantities: { semola: 2 }, stock: {} };
    const merged = mergeArchives(existing, incoming);
    expect(merged.missing).toStrictEqual({ butter: true });
    // The semola has not arrived: the order goes back to «still to answer».
    expect('deliveredAt' in merged).toBe(false);
  });

  test('a missing line ordered again the same day loses its mark — it has just been re-ordered', () => {
    const existing = { quantities: { flour: 4, butter: 2 }, missing: { butter: true, flour: true } };
    const merged = mergeArchives(existing, { quantities: { butter: 2 } });
    expect(merged.missing).toStrictEqual({ flour: true });
  });

  test('no marks left means no `missing` key at all, never an empty map', () => {
    expect('missing' in mergeArchives({ quantities: { flour: 4 } }, { quantities: { flour: 1 } })).toBe(false);
    const reordered = mergeArchives({ quantities: { flour: 4 }, missing: { flour: true } }, { quantities: { flour: 1 } });
    expect('missing' in reordered).toBe(false);
    // Anything but a literal true was never a mark.
    const odd = mergeArchives({ quantities: { flour: 4 }, missing: { flour: 'yes' as unknown as boolean } }, { quantities: { semola: 1 } });
    expect('missing' in odd).toBe(false);
  });

  test('«Risolto» marks travel with the marks they answer, and only with them', () => {
    const existing = {
      quantities: { flour: 4, butter: 2 },
      missing: { flour: true, butter: true },
      missingResolved: { flour: '2026-10-01T09:00:00.000Z', butter: '2026-10-01T09:00:00.000Z' },
    };
    // Butter is ordered again the same day: its mark goes, and its «Risolto» with it.
    const merged = mergeArchives(existing, { quantities: { butter: 1 } });
    expect(merged.missing).toStrictEqual({ flour: true });
    expect(merged.missingResolved).toStrictEqual({ flour: '2026-10-01T09:00:00.000Z' });
    expect('missingResolved' in mergeArchives({ quantities: { flour: 1 } }, { quantities: { flour: 1 } })).toBe(false);
  });

  test('a second order the same day ADDS names instead of replacing them', () => {
    // The forgotten-items write only names what IT adds; replacing would strip the
    // names off the rows placed earlier in the day.
    const existing = { quantities: { flour: 4 }, stock: {}, names: { flour: 'Flour 25kg' } };
    const incoming = { quantities: { semola: 2 }, stock: {}, names: { semola: 'Semola 5kg' } };
    expect(mergeArchives(existing, incoming).names).toStrictEqual({ flour: 'Flour 25kg', semola: 'Semola 5kg' });
  });

  test('a phone on the old version sending no names cannot erase the stored ones', () => {
    const existing = { quantities: { flour: 4 }, stock: {}, names: { flour: 'Flour 25kg' } };
    const incoming = { quantities: { flour: 1 }, stock: {} };   // pre-update phone
    expect(mergeArchives(existing, incoming).names).toStrictEqual({ flour: 'Flour 25kg' });
  });

  // ── legacy weekly records ──────────────────────────────────────────────────

  test('the old weekly record is recognised and still has a date', () => {
    const legacyRecord = { id: '2026-W28', weekStart: '2026-07-06', quantities: { flour: 6, nutella: 1 }, stock: { flour: 4, nutella: 1 } };
    expect(isLegacyRecord(legacyRecord)).toBe(true);
    expect(recordDate(legacyRecord)).toBe('2026-07-06');
    expect(isLegacyRecord({ supplierId: 'alba', date: '2026-07-13' })).toBe(false);
    expect(recordDate({ supplierId: 'alba', date: '2026-07-13' })).toBe('2026-07-13');
  });

  // ── Several orders to one supplier on one day (tests/same-day-sends.test.mjs) ─
  // Each order is kept apart with its time inside the day's record (`sends`); `quantities` stays the
  // day's TOTAL; the same ingredient in two units is added up in packages when the card says how many
  // one case holds, and refused when it does not.

  const SD_SUPPLIER = { id: 'sup', name: 'Supplier' };
  const YEAST = { id: 'yeast', name: 'Lievito', supplierId: 'sup', unit: 'cartone', packUnit: 'busta', packCount: 4 };
  const SD_FLOUR = { id: 'flour', name: 'Farina', supplierId: 'sup', unit: 'cartone', packUnit: 'busta' }; // no packCount
  const SALT = { id: 'salt', name: 'Sale', supplierId: 'sup', unit: 'sacco' };
  const SD_INGREDIENTS = [YEAST, SD_FLOUR, SALT];
  const cardOf = (id: string) => SD_INGREDIENTS.find(i => i.id === id);

  const MORNING = new Date('2026-10-03T07:12:00.000Z');
  const AFTERNOON = new Date('2026-10-03T13:40:00.000Z');
  const archive = (entries: unknown, now: Date) => buildSupplierArchive({
    supplier: SD_SUPPLIER, ingredients: SD_INGREDIENTS, entries, date: '2026-10-03', now,
  })!;
  // The sends of a record as stored, oldest first (the ids sort by time); recordSends is tested on its own below.
  const sendList = (record: { sends: Record<string, { at: string; quantities: Record<string, number>; units?: Record<string, string> }> }) =>
    Object.keys(record.sends).sort().map(k => record.sends[k]!);

  test('a first order carries one send: its time, quantities and units', () => {
    const rec = archive({ yeast: { qty: 1, stock: 0 }, salt: { qty: 2, stock: 1 } }, MORNING);
    const id = sendIdFor(MORNING.toISOString());
    expect(id).toBe('s20261003071200000');
    expect(rec.sends).toStrictEqual({
      [id]: { at: '2026-10-03T07:12:00.000Z', quantities: { yeast: 1, salt: 2 }, units: { yeast: 'cartone' } },
    });
  });

  test('a second order the same day adds its own send and the totals add up', () => {
    const first = archive({ salt: { qty: 2, stock: 0 } }, MORNING);
    const second = archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON);
    const merged = mergeArchives(first, second, { cardOf });
    expect(merged.quantities.salt).toBe(3);
    const sends = sendList(merged);
    expect(sends.map(s => s.at)).toStrictEqual(['2026-10-03T07:12:00.000Z', '2026-10-03T13:40:00.000Z']);
    expect(sends.map(s => s.quantities.salt)).toStrictEqual([2, 1]);
  });

  test('⚠️ 1 cartone this morning + 2 buste this afternoon = 6 buste for the day; each send keeps its own unit', () => {
    const first = archive({ yeast: { qty: 1, stock: 0 } }, MORNING);
    const second = archive({ yeast: { qty: 2, stock: 0, unit: 'busta' } }, AFTERNOON);
    const merged = mergeArchives(first, second, { cardOf });
    expect(merged.quantities.yeast).toBe(6);
    expect(merged.units!.yeast).toBe('busta');
    const [morning, afternoon] = sendList(merged);
    expect([morning!.quantities.yeast, morning!.units!.yeast]).toStrictEqual([1, 'cartone']);
    expect([afternoon!.quantities.yeast, afternoon!.units!.yeast]).toStrictEqual([2, 'busta']);
  });

  test('the other way round too: 2 buste then 1 cartone = 6 buste', () => {
    const first = archive({ yeast: { qty: 2, stock: 0, unit: 'busta' } }, MORNING);
    const second = archive({ yeast: { qty: 1, stock: 0 } }, AFTERNOON);
    const merged = mergeArchives(first, second, { cardOf });
    expect(merged.quantities.yeast).toBe(6);
    expect(merged.units!.yeast).toBe('busta');
  });

  test('with no packCount on the card, two units are still refused and nothing is merged', () => {
    const first = archive({ flour: { qty: 1, stock: 0 } }, MORNING);
    const second = archive({ flour: { qty: 2, stock: 0, unit: 'busta' } }, AFTERNOON);
    let thrown: unknown;
    try { mergeArchives(first, second, { cardOf }); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code: string }).code).toBe('orders/unit-conflict');
    expect((thrown as { ids: string[] }).ids).toStrictEqual(['flour']);
  });

  test('a mixed-unit line whose card is gone is refused, not guessed', () => {
    const first = archive({ yeast: { qty: 1, stock: 0 } }, MORNING);
    const second = archive({ yeast: { qty: 2, stock: 0, unit: 'busta' } }, AFTERNOON);
    expect(() => mergeArchives(first, second, { cardOf: () => undefined })).toThrow(expect.objectContaining({ code: 'orders/unit-conflict' }));
  });

  test('the check before sending agrees: addable units are not flagged, the rest are', () => {
    const record = archive({ yeast: { qty: 1, stock: 0 }, flour: { qty: 1, stock: 0 } }, MORNING);
    const entries = { yeast: { qty: 2, unit: 'busta' }, flour: { qty: 2, unit: 'busta' } };
    expect(unitConflicts(record, entries, SD_INGREDIENTS, 'sup').map(c => c.id)).toStrictEqual(['flour']);
  });

  test('the refusal marks a line «fixable» only when writing the pack count would make it addable', () => {
    const record = archive({ flour: { qty: 1, stock: 0 }, salt: { qty: 1, stock: 0 } }, MORNING);
    const out = unitConflicts(record, { flour: { qty: 2, unit: 'busta' }, salt: { qty: 1, unit: 'kg' } }, SD_INGREDIENTS, 'sup');
    expect(out.map(c => [c.id, c.fixable])).toStrictEqual([['flour', true], ['salt', false]]);
  });

  test('nothing recorded yet means nothing to conflict with, and the list reads «name — unit»', () => {
    expect(unitConflicts(null, { flour: { qty: 2 } }, SD_INGREDIENTS, 'sup')).toStrictEqual([]);
    expect(unitConflictList([{ name: 'Flour 25kg', unit: 'cartone' }, { name: 'Yeast', unit: 'busta' }])).toBe('Flour 25kg — cartone, Yeast — busta');
    expect(unitConflictList(null)).toBe('');
  });

  const OLD = {
    date: '2026-10-03', supplierId: 'sup', supplierName: 'Supplier',
    quantities: { salt: 2 }, stock: {}, names: {},
    createdAt: '2026-10-03T06:00:00.000Z', updatedAt: '2026-10-03T06:00:00.000Z',
  };

  test('a record from before sends existed becomes one send of what it held, at its creation time', () => {
    const merged = mergeArchives(OLD, archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
    const sends = sendList(merged);
    expect(sends.length).toBe(2);
    expect(sends[0]).toStrictEqual({ at: '2026-10-03T06:00:00.000Z', quantities: { salt: 2 } });
    expect(merged.quantities.salt).toBe(3);
  });

  test('⚠️ …but with NO time when it was rewritten after it was created (an old phone added to it)', () => {
    const touched = { ...OLD, updatedAt: '2026-10-03T10:00:00.000Z' };
    const merged = mergeArchives(touched, archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
    const [earlier] = sendList(merged);
    expect(earlier!.at, 'two orders under the time of the first would be a lie').toBe('');
    expect(Object.keys(merged.sends)).toContain('s0');
  });

  test('a third order keeps the first two sends', () => {
    const a = archive({ salt: { qty: 1, stock: 0 } }, MORNING);
    const b = mergeArchives(a, archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
    const c = mergeArchives(b, archive({ salt: { qty: 1, stock: 0 } }, new Date('2026-10-03T16:00:00.000Z')), { cardOf });
    expect(sendList(c).length).toBe(3);
    expect(c.quantities.salt).toBe(3);
  });

  test('no more sends than the rules allow: the first and the latest are kept', () => {
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`s${String(i).padStart(3, '0')}`, { at: String(i), quantities: {} }]));
    const kept = capSends(many);
    expect(Object.keys(kept).length).toBe(MAX_SENDS);
    expect(MAX_SENDS).toBe(50);
    expect('s000' in kept && 's059' in kept && !('s001' in kept)).toBe(true);
    expect(capSends({ a: 1 }).a).toBe(1);
  });

  // ── What History draws (tests/same-day-sends.test.mjs) ──

  test('recordSends: the sends oldest first, a record from before sends is one send at its creation time', () => {
    const merged = mergeArchives(OLD, archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
    const sends = recordSends(merged);
    expect(sends.length).toBe(2);
    expect(sends[0]).toStrictEqual({ at: '2026-10-03T06:00:00.000Z', kind: 'order', quantities: { salt: 2 }, units: {} });
  });

  test('…but with NO time when it was rewritten after it was created, and History says «earlier»', () => {
    const touched = { ...OLD, updatedAt: '2026-10-03T10:00:00.000Z' };
    const merged = mergeArchives(touched, archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
    expect(recordSends(merged)[0]!.at).toBe('');
    expect(sendSections(merged).sections[0]!.heading).toBe('earlier');
  });

  test('recordSends skips malformed entries and reads a record with no sends as none', () => {
    expect(recordSends({})).toStrictEqual([]);
    expect(recordSends(null)).toStrictEqual([]);
    const rec = { sends: { a: null, b: 'x', c: { at: 5 }, d: { at: '2026-10-03T07:00:00.000Z', quantities: { salt: 1 } } } };
    expect(recordSends(rec)).toStrictEqual([{ at: '2026-10-03T07:00:00.000Z', kind: 'order', quantities: { salt: 1 }, units: {} }]);
  });

  test('History: no sends → the card as it always was; one timed send → its heading only', () => {
    expect(sendSections(OLD)).toStrictEqual({ sections: [], total: false });
    const one = archive({ salt: { qty: 2, stock: 0 } }, MORNING);
    expect(sendSections(one)).toStrictEqual({
      sections: [{ heading: 'first', time: MORNING.toISOString(), quantities: null, units: null }], total: false,
    });
    expect(sendSections({ sends: { s0: { at: '', quantities: { salt: 1 } } } })).toStrictEqual({ sections: [], total: false });
  });

  test('History: two or more sends → one section each (first, later, correction), then the day total', () => {
    const merged = mergeArchives(archive({ salt: { qty: 2, stock: 0 } }, MORNING),
      archive({ salt: { qty: 1, stock: 0 } }, AFTERNOON), { cardOf });
    const corrected = { ...merged, sends: withCorrection(merged, { salt: 2 }, {}, '2026-10-03T15:00:00.000Z') };
    const out = sendSections(corrected);
    expect(out.total).toBe(true);
    expect(out.sections.map(s => s.heading)).toStrictEqual(['first', 'later', 'edit']);
    expect(out.sections.map(s => s.quantities!.salt)).toStrictEqual([2, 1, 2]);
  });

  test('a correction is added only to a record that already keeps sends', () => {
    expect(withCorrection(OLD, { salt: 1 }, {}, '2026-10-03T15:00:00.000Z')).toBe(null);
    const one = archive({ salt: { qty: 2, stock: 0 } }, MORNING);
    const sends = withCorrection(one, { salt: 1 }, { salt: 'kg' }, '2026-10-03T15:00:00.000Z')!;
    expect(Object.keys(sends).length).toBe(2);
    expect(sends[sendIdFor('2026-10-03T15:00:00.000Z')]).toStrictEqual(
      { at: '2026-10-03T15:00:00.000Z', kind: 'edit', quantities: { salt: 1 }, units: { salt: 'kg' } });
  });

  // ── The History window (tests/orders-archive.test.mjs) ──

  const LEGACY_REC = { id: '2026-W28', weekStart: '2026-07-06', quantities: { flour: 2 } };

  test('history groups by day, newest day first, suppliers by name inside a day', () => {
    const groups = groupHistoryByDay([
      { id: '2026-07-13_etna', date: '2026-07-13', supplierId: 'etna', supplierName: 'Etna', quantities: { nutella: 1 } },
      LEGACY_REC,
      { id: '2026-07-13_alba', date: '2026-07-13', supplierId: 'alba', supplierName: 'Alba', quantities: { flour: 1 } },
    ]);
    expect(groups.map(g => g.date)).toStrictEqual(['2026-07-13', '2026-07-06']);
    expect(groups[0]!.records.map(r => (r as { supplierName?: string }).supplierName)).toStrictEqual(['Alba', 'Etna']);
    expect(isLegacyRecord(groups[1]!.records[0])).toBe(true);
  });

  test('a record with no date at all is dropped rather than grouped under ""', () => {
    expect(groupHistoryByDay([{ id: 'junk', quantities: { flour: 1 } }])).toStrictEqual([]);
    expect(groupHistoryByDay(null)).toStrictEqual([]);
  });

  const WINDOW_DAYS = [
    { date: '2026-07-31', records: [{ supplierId: 'alba' }] },
    { date: '2026-07-17', records: [{ supplierId: 'etna' }] },
    { date: '2026-07-16', records: [{ supplierId: 'alba' }, { supplierId: 'etna' }] },
    { date: '2026-07-09', records: [{ weekStart: '2026-07-09' }] },
  ];
  const WINDOW_NOW = new Date('2026-07-31T09:00:00');

  test('a 15-day window keeps today and the 14 days before it; the boundary day is inside', () => {
    const { recent, older } = splitHistoryByAge(WINDOW_DAYS, 15, WINDOW_NOW);
    expect(recent.map(d => d.date)).toStrictEqual(['2026-07-31', '2026-07-17']);
    expect(older.map(d => d.date)).toStrictEqual(['2026-07-16', '2026-07-09']);
  });

  test('a one-day window is today only', () => {
    const { recent, older } = splitHistoryByAge(WINDOW_DAYS, 1, WINDOW_NOW);
    expect(recent.map(d => d.date)).toStrictEqual(['2026-07-31']);
    expect(older.length).toBe(3);
  });

  test('an unusable window hides NOTHING', () => {
    [0, -5, NaN, undefined, null, 'abc'].forEach(bad => {
      const { recent, older } = splitHistoryByAge(WINDOW_DAYS, bad, WINDOW_NOW);
      expect(recent.length, `window ${String(bad)}`).toBe(WINDOW_DAYS.length);
      expect(older.length).toBe(0);
    });
  });

  test('nothing recent: everything is older, and nothing is lost', () => {
    const { recent, older } = splitHistoryByAge(WINDOW_DAYS, 15, new Date('2026-09-01T09:00:00'));
    expect(recent.length).toBe(0);
    expect(older.length).toBe(WINDOW_DAYS.length);
  });

  test('the window is counted in calendar days, not 24-hour blocks (DST)', () => {
    const days = [{ date: '2026-10-26', records: [1] }, { date: '2026-10-25', records: [1] }];
    const { recent, older } = splitHistoryByAge(days, 7, new Date('2026-11-01T12:00:00'));
    expect(recent.map(d => d.date)).toStrictEqual(['2026-10-26']);
    expect(older.map(d => d.date)).toStrictEqual(['2026-10-25']);
  });

  test('empty input is handled without throwing', () => {
    expect(splitHistoryByAge(null, 15, WINDOW_NOW)).toStrictEqual({ recent: [], older: [] });
    expect(splitHistoryByAge([], 15, WINDOW_NOW)).toStrictEqual({ recent: [], older: [] });
  });

  test('the button counts ORDERS, not days', () => {
    const { older } = splitHistoryByAge(WINDOW_DAYS, 15, WINDOW_NOW);
    expect(countRecords(older)).toBe(3);
    expect(countRecords([])).toBe(0);
    expect(countRecords(null)).toBe(0);
    expect(countRecords([{ date: '2026-07-01' } as { records?: unknown[] }])).toBe(0);
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The one function whose arguments differ: the deleted-ingredient word is handed in.
  const ADAPTED = ['recordedName'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = ['wholeNumber', 'historyDocId', 'isLegacyRecord', 'recordDate', 'ingredientsOf', 'supplierHasItems',
    'buildSupplierArchive', 'ingredientLabel', 'ingredientDisplayLabel', 'compareByLabel', 'sortByLabel', 'quantityPathsFor',
    'changedEntries', 'changedDays', 'mergeArchives', 'sendIdFor', 'MAX_SENDS', 'capSends', 'unitConflicts', 'unitConflictList',
    'withCorrection', 'recordSends', 'sendSections', 'splitHistoryByAge', 'countRecords', 'groupHistoryByDay'];
  // What the port adds: the type guard for the error mergeArchives throws.
  const ADDED = ['isUnitConflict'];

  test('the original exports exactly the ported names and the adapted one', () => {
    expect(Object.keys(original).sort()).toStrictEqual([...shared, ...ADAPTED].sort());
  });

  test('exports exactly the functions it ports, and the original has them', () => {
    expect(Object.keys(port).sort()).toStrictEqual([...shared, ...ADAPTED, ...ADDED].sort());
    for (const name of shared) expect(typeof original[name], name).toBe(typeof port[name]);
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      if (typeof original[name] !== 'function') { expect(port[name], name).toStrictEqual(original[name]); continue; }
      const mine = port[name] as (...args: unknown[]) => unknown;
      const theirs = original[name] as (...args: unknown[]) => unknown;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });

  test('recordedName: the live ingredient wins, then the frozen name, then the word handed in — as the original', () => {
    const byId = { flour: { id: 'flour', name: 'Flour uniqua blue', weight: '25kg' } };
    const theirs = original.recordedName as (id: string, byId: unknown, names: unknown) => string;
    const cases: [string, unknown][] = [
      ['flour', { flour: 'Old label' }], ['gone', { gone: 'Ricotta 1.5kg' }], ['gone', {}], ['gone', undefined],
      ['gone', { gone: '   ' }], ['gone', { gone: 42 }],
    ];
    for (const [id, names] of cases) {
      expect(ported.recordedName(id, byId, names, 'Deleted ingredient')).toBe(theirs(id, byId, names));
    }
    expect(ported.recordedName('gone', byId, {}, 'Ingrediente eliminato')).toBe('Ingrediente eliminato');
    expect(ported.recordedName('flour', byId, {}, 'x')).toBe('Flour uniqua blue 25kg');
  });

  test('isUnitConflict recognises the error mergeArchives throws, and nothing else', () => {
    const first = { quantities: { flour: 1 }, units: { flour: 'cartone' } };
    const second = { quantities: { flour: 1 }, units: { flour: 'busta' } };
    let thrown: unknown;
    try { ported.mergeArchives(first, second); } catch (err) { thrown = err; }
    expect(ported.isUnitConflict(thrown)).toBe(true);
    expect(ported.isUnitConflict(new Error('orders/unit-conflict'))).toBe(false);
    expect(ported.isUnitConflict(null)).toBe(false);
  });
});
