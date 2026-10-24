// Unit tests for «where is this ingredient still used» (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/orders/ingredient-merge.js, which the live app uses today. Ported from tests/ingredient-merge.test.mjs.
// Every name, id and price below is INVENTED.
//
// ingredient-merge.ts is a PARTIAL port (`findUsage`, `monthKeyOf`, `previousMonthKeyOf`), so parity.spec.ts does not
// pair it; the last describe compares what it ports with the js/ file itself (names, arity).
//
// PORTED: 'a free ingredient is used nowhere', 'a product that holds it in its components OR its packaging blocks…',
// 'a recipe row linked to it blocks…', 'the current stocktake blocks on any count…', 'the order in progress blocks
// only on a quantity above zero', 'several places are all listed, in a stable order…', 'the month key is the LOCAL
// month…', 'an OPEN stocktake of LAST month that counts it blocks too…', 'an order list not yet done blocks while a
// line naming it is unticked…'.
//
// NOT PORTED (the merge itself comes in step 3e-7): the tests of mergeCandidates, mergedCodes, pointIdOnA, planMerge and
// deletionBatches, and every test that reads the source text of the data layer, the screen, the rules or the
// stylesheets ('the data layer reads from the SERVER…', 'the write works on FRESH data…', 'the failure words are
// honest…', 'the confirmation lists the price takeover…', 'while it writes…', 'the price rows wrap only when…', 'the
// screen uses the app's own dialogs…', 'no file of the merge imports another feature's folder', 'the button is drawn
// only for somebody who may merge…', 'a merge never writes priceBasis…').

import { describe, expect, test } from 'vitest';
import * as ported from './ingredient-merge';
import * as legacyJs from '../../js/orders/ingredient-merge.js';

const legacy = legacyJs as unknown as typeof ported;

const free = { products: [], recipes: [], inventory: null, month: '2026-10', draft: null };

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('a free ingredient is used nowhere', () => {
    expect(m.findUsage('b', free)).toStrictEqual([]);
    expect(m.findUsage('b', undefined)).toStrictEqual([]);
    expect(m.findUsage('', free)).toStrictEqual([]);
  });

  test("a product that holds it in its components OR its packaging blocks, by the product's name", () => {
    const products = [
      { name: 'Pane', components: [{ kind: 'ingredient', ingredientId: 'b', qty: 1, unit: 'kg' }], packaging: [] },
      { name: 'Torta', components: [{ recipeId: 'r1', qtyKg: 2 }], packaging: [{ ingredientId: 'b', qtyPcs: 1 }] },
      { name: 'Altro', components: [{ kind: 'ingredient', ingredientId: 'z' }], packaging: [] },
    ];
    expect(m.findUsage('b', { ...free, products })).toStrictEqual([{ kind: 'product', name: 'Pane' }, { kind: 'product', name: 'Torta' }]);
  });

  test('a recipe row linked to it blocks; a row linked to a RECIPE with the same id does not', () => {
    const recipes = [
      { name: 'Impasto', ingredients: [{ label: 'Lievito', refId: 'b', kind: 'ingredient' }] },
      { name: 'Base', ingredients: [{ label: 'Altro', refId: 'b', kind: 'recipe' }] },
      { name: 'Libera', ingredients: [{ label: 'Sale' }] },
    ];
    expect(m.findUsage('b', { ...free, recipes })).toStrictEqual([{ kind: 'recipe', name: 'Impasto' }]);
  });

  test('the current stocktake blocks on any count (opening, purchased, closing) unless the month is closed', () => {
    const open = (extra: object) => ({ ...free, inventory: { closedAt: '', opening: {}, purchased: {}, closing: {}, ...extra } });
    expect(m.findUsage('b', open({ opening: { b: 3 } }))).toStrictEqual([{ kind: 'inventory', month: '2026-10' }]);
    expect(m.findUsage('b', open({ purchased: { b: 0 } })).length, 'a zero is a count').toBe(1);
    expect(m.findUsage('b', open({ closing: { b: 2 } })).length).toBe(1);
    expect(m.findUsage('b', open({ opening: { x: 3 } })), 'a missing key is «not counted»').toStrictEqual([]);
    expect(m.findUsage('b', { ...free, inventory: { closedAt: '2026-10-31T10:00:00Z', opening: { b: 3 } } }), 'a closed month is history').toStrictEqual([]);
    expect(m.findUsage('b', { ...free, inventory: null })).toStrictEqual([]);
  });

  test('the order in progress blocks only on a quantity above zero', () => {
    expect(m.findUsage('b', { ...free, draft: { entries: { b: { qty: 2, stock: 0 } } } })).toStrictEqual([{ kind: 'draft' }]);
    expect(m.findUsage('b', { ...free, draft: { entries: { b: { qty: 0, stock: 5 } } } })).toStrictEqual([]);
    expect(m.findUsage('b', { ...free, draft: { entries: {} } })).toStrictEqual([]);
    expect(m.findUsage('b', { ...free, draft: null })).toStrictEqual([]);
  });

  test('several places are all listed, in a stable order: products, recipes, stocktake, order', () => {
    const where = m.findUsage('b', {
      products: [{ name: 'P', components: [{ ingredientId: 'b' }] }],
      recipes: [{ name: 'R', ingredients: [{ refId: 'b', kind: 'ingredient' }] }],
      inventory: { closedAt: '', opening: { b: 1 } }, month: '2026-10',
      draft: { entries: { b: { qty: 1 } } },
    });
    expect(where.map(w => w.kind)).toStrictEqual(['product', 'recipe', 'inventory', 'draft']);
  });

  test("the month key is the LOCAL month, like the stocktake's", () => {
    expect(m.monthKeyOf(new Date(2026, 9, 5, 12).getTime())).toBe('2026-10');
    expect(m.monthKeyOf(NaN)).toBeNull();
    expect(m.previousMonthKeyOf(new Date(2026, 9, 5, 12).getTime())).toBe('2026-09');
    expect(m.previousMonthKeyOf(new Date(2026, 0, 31, 12).getTime()), 'January looks back to December').toBe('2025-12');
    expect(m.previousMonthKeyOf(NaN)).toBeNull();
  });

  test('with no moment given, the month key is the current month', () => {
    const expected = new Date();
    const key = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}`;
    expect([key, m.monthKeyOf()]).toStrictEqual([key, key]);
  });

  test('⚠️ an OPEN stocktake of LAST month that counts it blocks too; a closed or empty one does not', () => {
    const inv = (month: string, data: unknown) => ({ month, data });
    const open = { closedAt: '', opening: { b: 3 } };
    const missing = { opening: { b: 3 } };
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', open)] })).toStrictEqual([{ kind: 'inventory', month: '2026-09' }]);
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', missing)] }).length, 'no closedAt at all is open').toBe(1);
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', { ...open, closedAt: '2026-09-30T20:00:00Z' })] })).toStrictEqual([]);
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', { closedAt: '', opening: { x: 1 } })] })).toStrictEqual([]);
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', open), inv('2026-09', open)] }).length, 'both months are named').toBe(2);
  });

  test('⚠️ an order list not yet done blocks while a line naming it is unticked; a done one does not', () => {
    const requests = (list: unknown[]) => ({ ...free, requests: list });
    expect(m.findUsage('b', requests([{ quantities: { b: 2, c: 1 }, done: {} }]))).toStrictEqual([{ kind: 'request' }]);
    expect(m.findUsage('b', requests([{ quantities: { b: 2, c: 1 }, done: { b: true } }])), 'its own line is ticked').toStrictEqual([]);
    expect(m.findUsage('b', requests([{ quantities: { b: 2 }, done: { b: true } }])), 'the whole list is done').toStrictEqual([]);
    expect(m.findUsage('b', requests([{ quantities: { c: 1 }, done: {} }])), 'it does not name B').toStrictEqual([]);
    expect(m.findUsage('b', requests([null, {}, { quantities: null }])), 'a broken document never throws').toStrictEqual([]);
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The functions this port leaves out: the merge itself. The original still exports them.
  const LEFT_OUT = ['mergeCandidates', 'pointIdOnA', 'mergedCodes', 'planMerge', 'deletionBatches'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = ['findUsage', 'monthKeyOf', 'previousMonthKeyOf'];

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(typeof original[name], name).toBe('function');
  });

  test('exports exactly the three functions it ports, and the original has them', () => {
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
