// Unit tests for the pure half of turning a draft into history records (P15), run against BOTH implementations:
// the TypeScript port in shared/ and js/orders/archive.js, which the live app uses today. Ported from
// tests/orders-archive.test.mjs.
//
// archive.ts is a PARTIAL port, so parity.spec.ts does not pair it: it ports wholeNumber, historyDocId,
// ingredientsOf, supplierHasItems, ingredientLabel, ingredientDisplayLabel, compareByLabel, sortByLabel,
// quantityPathsFor, changedEntries and changedDays, and leaves out buildSupplierArchive, mergeArchives,
// recordedName, the sends, unitConflicts and the history grouping (slices 3f-2 and 3f-4). The last describe
// compares what IS ported with the js/ file itself (names, arity), the way ingredient-search used to.
//
// PORTED: 23 of 52 tests of tests/orders-archive.test.mjs — the wholeNumber ones (2), the changedEntries ones
// (8), changedDays, historyDocId, ingredientsOf, supplierHasItems, ingredientLabel and the quantityPathsFor ones
// (7).
//
// NOT PORTED (29): the tests of the functions left out — buildSupplierArchive (7), mergeArchives and the
// «did not arrive» marks (6), isLegacyRecord / recordDate / history grouping (4), splitHistoryByAge /
// countRecords (8), recordedName and the frozen names (4). They come with the slices that port those functions.
// tests/draft-override.test.mjs (7) is not ported either: every one of its tests drives draft.js through a
// recording stub of the data layer, which is not shared logic. The per-line override cases that do call only
// archive and line-supplier functions are ported in line-supplier.spec.ts.

import { describe, expect, test } from 'vitest';
import * as ported from './archive';
import * as legacyJs from '../../js/orders/archive.js';

const legacy = legacyJs as unknown as typeof ported;

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
    ingredientDisplayLabel, compareByLabel, sortByLabel, quantityPathsFor,
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
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The functions this port leaves out. The original still exports them.
  const LEFT_OUT = ['isLegacyRecord', 'recordDate', 'buildSupplierArchive', 'recordedName', 'mergeArchives', 'sendIdFor',
    'MAX_SENDS', 'capSends', 'withCorrection', 'recordSends', 'sendSections', 'unitConflicts', 'unitConflictList',
    'splitHistoryByAge', 'countRecords', 'groupHistoryByDay'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = ['wholeNumber', 'historyDocId', 'ingredientsOf', 'supplierHasItems', 'ingredientLabel', 'ingredientDisplayLabel',
    'compareByLabel', 'sortByLabel', 'quantityPathsFor', 'changedEntries', 'changedDays'];

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(name in original, name).toBe(true);
  });

  test('the port and the original together export exactly the ported names and the left-out ones', () => {
    expect(Object.keys(original).sort()).toStrictEqual([...shared, ...LEFT_OUT].sort());
  });

  test('exports exactly the functions it ports, and the original has them', () => {
    expect(Object.keys(port).sort()).toStrictEqual([...shared].sort());
    for (const name of shared) expect(typeof original[name], name).toBe('function');
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name] as (...args: unknown[]) => unknown;
      const theirs = original[name] as (...args: unknown[]) => unknown;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
