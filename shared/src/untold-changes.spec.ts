// Tests for «what counts is what the person who places the order confirms» (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/orders/untold-changes.js, which the live app uses
// today. Ported from tests/place-confirm.test.mjs and tests/orders-unit-choice-data.test.mjs.
//
// untold-changes.ts is a PARTIAL port, so parity.spec.ts does not pair it: it ports confirmedEntries and leaves out
// askedToday, orderedToday and untoldChanges (the reminders and the untold-changes banner). The last describe
// compares what IS ported with the js/ file itself (names, arity).
//
// PORTED: the 7 tests of «1. confirmedEntries» in tests/place-confirm.test.mjs (the eighth, entriesToRecord, reads
// the source of orders-main.js) and the 2 confirmedEntries tests of tests/orders-unit-choice-data.test.mjs; plus one
// added here (an ingredient with no id is skipped).
// NOT PORTED: the askedToday tests of tests/place-confirm.test.mjs and every wiring test that reads source text.

import { describe, expect, test } from 'vitest';
import * as ported from './untold-changes';
import { buildSupplierArchive } from './archive';
import * as legacyJs from '../../js/orders/untold-changes.js';

const legacy = legacyJs as unknown as typeof ported;

const ING = [
  { id: 'flour', name: 'Flour', supplierId: 's1' },
  { id: 'bacon', name: 'Bacon', supplierId: 's1' },
  { id: 'milk', name: 'Milk', supplierId: 's1' },
];
const SUPPLIER = { id: 's1', name: 'Cielo' };
const CARD = { id: 'flour', name: 'Farina', weight: '2.5 kg', supplierId: 'sup', unit: 'cartone', packUnit: 'busta' };

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { confirmedEntries } = m;

  test('the confirmed number is what comes back, not the live one', () => {
    const live = { flour: { qty: 6, stock: 2 } };
    const out = confirmedEntries(live, ING, { flour: 4 });
    expect(out.flour!.qty).toBe(4);
  });

  // ⚠️⚠️ THE ONE THAT MATTERS MOST. A row the confirmer zeroed is simply ABSENT from
  // what comes back from the screen. Leaving it alone would record the live quantity
  // they had just refused — the exact opposite of what they said, and silently.
  test('⚠️⚠️ a row set to 0 is recorded as 0, never left at the live quantity', () => {
    const live = { flour: { qty: 6 }, bacon: { qty: 3 } };
    const out = confirmedEntries(live, ING, { flour: 4 });   // bacon was zeroed
    expect(out.bacon!.qty, 'a refused row must not survive on the live value').toBe(0);

    const record = buildSupplierArchive({
      supplier: SUPPLIER, ingredients: ING, entries: out, date: '2026-08-24',
    })!;
    expect(record.quantities, 'and it must not reach History').toStrictEqual({ flour: 4 });
  });

  test('⚠️ the caller’s entries are never mutated — a draft save holds them by reference', () => {
    const live = { flour: { qty: 6, stock: 2 } };
    const before = JSON.stringify(live);
    confirmedEntries(live, ING, { flour: 4 });
    expect(JSON.stringify(live),
      'confirming an order must not rewrite the shared order everybody else is typing into').toBe(before);
  });

  test('⚠️ another supplier’s rows are untouched — one order, one supplier', () => {
    const live = { flour: { qty: 6 }, olives: { qty: 9 } };
    const out = confirmedEntries(live, ING, { flour: 4 });
    expect(out.olives!.qty).toBe(9);
  });

  test('the stock reading survives — counting the shelves is not what was confirmed', () => {
    const out = confirmedEntries({ flour: { qty: 6, stock: 3 } }, ING, { flour: 4 });
    expect(out.flour!.stock).toBe(3);
  });

  test('junk quantities become 0, never NaN — Firestore refuses a non-finite number', () => {
    const live = { flour: { qty: 6 }, bacon: { qty: 6 }, milk: { qty: 6 } };
    const out = confirmedEntries(live, ING, { flour: -4, bacon: 'x', milk: Infinity });
    expect([out.flour!.qty, out.bacon!.qty, out.milk!.qty]).toStrictEqual([0, 0, 0]);
  });

  test('no entries, no ingredients, no quantities — nothing throws', () => {
    expect(confirmedEntries(null, null, null)).toStrictEqual({});
    expect(confirmedEntries(undefined, ING, undefined))
      .toStrictEqual({ flour: { qty: 0 }, bacon: { qty: 0 }, milk: { qty: 0 } });
  });

  test('confirmedEntries keeps the unit of the row it confirms', () => {
    const out = confirmedEntries({ flour: { qty: 9, stock: 1, unit: 'busta' } }, [CARD], { flour: 2 });
    expect(out.flour).toStrictEqual({ qty: 2, stock: 1, unit: 'busta' });
  });

  test('confirmedEntries records the unit the screen SHOWED, not the live one', () => {
    const live = { flour: { qty: 9, stock: 1, unit: 'busta' } };
    const out = confirmedEntries(live, [CARD], { flour: 2 }, { flour: 'cartone' });
    expect(out.flour!.unit).toBe('cartone');
    expect(live.flour.unit, 'the live draft is never touched').toBe('busta');
    expect(confirmedEntries(live, [CARD], { flour: 2 }).flour!.unit, 'no units given: as before').toBe('busta');
  });

  test('an ingredient with no id is skipped', () => {
    expect(confirmedEntries({}, [null, { name: 'No id' }, { id: '' }], { x: 1 })).toStrictEqual({});
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The functions this port leaves out. The original still exports them.
  const LEFT_OUT = ['askedToday', 'orderedToday', 'untoldChanges'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = ['confirmedEntries'];

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
