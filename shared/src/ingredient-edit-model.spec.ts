// Unit tests for the pure decisions behind editing and deleting an existing ingredient (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/ingredient-edit-model.js, which the live app uses today.
// Ported from tests/ingredient-delete.test.mjs and tests/orders-edit-ingredient.test.mjs. The module is a FULL port,
// so parity.spec.ts also compares its exports (names, constants, frozen-ness, shapes).
//
// PORTED from tests/ingredient-delete.test.mjs: 'the batch deletes the ingredient and, only where prices may be
// written, its price document', 'the append-only price history is never in the batch' (its first half: the plan names
// no subcollection), 'the ingredient's quantity in the draft is one named field, nothing broader', 'a confirmed delete
// removes that ingredient, then closes the card', 'cancelling the question deletes nothing and locks nothing', 'a
// refused delete says so, leaves the card open, and never reports success', 'a card with no stored ingredient has
// nothing to delete'.
// PORTED from tests/orders-edit-ingredient.test.mjs: 'itemWithPrice merges the price document exactly as the live price
// map does' and 'the price is read only for somebody who may write prices, and only while the snapshot has not
// answered'.
//
// NOT PORTED — they read the source text of screens, rules or the dictionary, which Mise 2 does not have in that shape:
//   from tests/ingredient-delete.test.mjs: the second half of 'the append-only price history…' (the line in
//   firestore.rules), 'the two deletes the batch relies on are still granted by the roles the app mirrors' (rules),
//   'the bin is drawn only for an existing item…', 'the bin is alone in the action row…', 'the bin is quiet…',
//   'Fornitori hands the action in only to an owner or manager…', 'Orders hands the action in only to an owner or
//   manager…', 'one place writes the delete, as a single batch built from the plan', 'the words exist in English and
//   Italian'.
//   from tests/orders-edit-ingredient.test.mjs: everything that drives the Orders screen or reads its source, and the
//   two tests that need the WRITING half of price-model (pricePatch, priceChanged — step 3e-3): 'an ingredient opened
//   from Orders with its stored price saves untouched…' and 'the same ingredient opened WITHOUT its price would erase
//   it…'.

import { describe, expect, test } from 'vitest';
import * as ported from './ingredient-edit-model';
import * as legacyJs from '../../js/ingredient-edit-model.js';
import { withPrices } from './price-model';

const legacy = legacyJs as unknown as typeof ported;

const FLOUR = { id: 'flour', name: 'Strong flour', weight: '25kg', unit: 'sacco', supplierId: 's1' };
const STORED_PRICE = {
  bakery: 'main', priceUnit: 'kg', pricePerUnit: 0.72, unitWeightKg: null, vatRate: 4,
  priceUpdatedAt: '2026-09-01T10:00:00.000Z',
};

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── What the batch deletes ─────────────────────────────────────────────────

  test('the batch deletes the ingredient and, only where prices may be written, its price document', () => {
    expect(m.deletePlan({ id: 'flour', mayPrice: true })).toStrictEqual([
      { collection: 'ingredients', id: 'flour' },
      { collection: 'ingredient-prices', id: 'flour' },
    ]);
    expect(m.deletePlan({ id: 'flour', mayPrice: false }), 'a price delete the rules refuse would fail the whole batch, and the ingredient with it')
      .toStrictEqual([{ collection: 'ingredients', id: 'flour' }]);
    expect(m.deletePlan({ id: 'flour' }), 'forgetting to say defaults to the safe side').toStrictEqual([{ collection: 'ingredients', id: 'flour' }]);
  });

  test('only a real true lets the price document into the batch', () => {
    for (const mayPrice of [1, 'true', {}, [], null, undefined, 0, '']) {
      expect(m.deletePlan({ id: 'x', mayPrice }).map(d => d.collection), String(mayPrice)).toStrictEqual(['ingredients']);
    }
  });

  test('the append-only price history is never in the batch — the rules forbid deleting it', () => {
    for (const mayPrice of [true, false]) {
      const names = m.deletePlan({ id: 'x', mayPrice }).map(d => d.collection);
      expect(names.some(n => (n as string).includes('prices/') || (n as string) === 'prices'), 'no subcollection').toBe(false);
    }
  });

  test("the ingredient's quantity in the draft is one named field, nothing broader", () => {
    expect(m.draftEntryPath('flour')).toBe('entries.flour');
  });

  // ── The price the card opens with ──────────────────────────────────────────

  test('itemWithPrice merges the price document exactly as the live price map does', () => {
    const viaOpener = m.itemWithPrice(FLOUR, STORED_PRICE);
    const viaMap = withPrices([FLOUR], { flour: STORED_PRICE })[0];
    expect(viaOpener).toStrictEqual(viaMap);
    expect((viaOpener as { pricePerUnit?: unknown }).pricePerUnit).toBe(0.72);
    // A legacy price key still on the ingredient document is replaced, never left to disagree.
    const old = m.itemWithPrice({ ...FLOUR, pricePerUnit: 9 }, STORED_PRICE);
    expect((old as { pricePerUnit?: unknown }).pricePerUnit).toBe(0.72);
    expect(m.itemWithPrice(null, STORED_PRICE)).toBeNull();
  });

  test('an ingredient with no price document comes back with its price fields cleared, never kept', () => {
    const bare = m.itemWithPrice({ ...FLOUR, pricePerUnit: 9 }, null) as { pricePerUnit?: unknown; name?: string };
    expect(bare.pricePerUnit).toBeNull();
    expect(bare.name).toBe('Strong flour');
    expect(m.itemWithPrice(undefined, STORED_PRICE)).toBeUndefined();
  });

  test('the price is read only for somebody who may write prices, and only while the snapshot has not answered', () => {
    expect(m.needsPriceRead({ mayPrice: true, pricesLoaded: false })).toBe(true);
    expect(m.needsPriceRead({ mayPrice: true, pricesLoaded: true }), 'Orders already holds it').toBe(false);
    expect(m.needsPriceRead({ mayPrice: false, pricesLoaded: false }), 'no price block, nothing to erase, nothing to read').toBe(false);
    expect(m.needsPriceRead({})).toBe(false);
  });

  // ── The flow ───────────────────────────────────────────────────────────────

  function flow({ answer = true, fails = false } = {}) {
    const log: string[] = [];
    const run = () => m.confirmAndDelete({
      item: { id: 'flour' },
      ask: async () => { log.push('ask'); return answer; },
      remove: async (id) => { log.push(`remove:${id}`); if (fails) throw new Error('permission-denied'); },
      onStart: () => log.push('start'),
      onDone: () => log.push('done'),
      onFail: (err) => log.push(`fail:${(err as Error).message}`),
    });
    return { log, run };
  }

  test('a confirmed delete removes that ingredient, then closes the card', async () => {
    const { log, run } = flow();
    expect(await run()).toBe(true);
    expect(log).toStrictEqual(['ask', 'start', 'remove:flour', 'done']);
  });

  test('⚠️ cancelling the question deletes nothing and locks nothing', async () => {
    const { log, run } = flow({ answer: false });
    expect(await run()).toBe(false);
    expect(log).toStrictEqual(['ask']);
  });

  test('⚠️ a refused delete says so, leaves the card open, and never reports success', async () => {
    const { log, run } = flow({ fails: true });
    expect(await run()).toBe(false);
    expect(log).toStrictEqual(['ask', 'start', 'remove:flour', 'fail:permission-denied']);
    expect(log).not.toContain('done');
  });

  test('a card with no stored ingredient has nothing to delete', async () => {
    for (const item of [null, undefined, {}, { id: '' }]) {
      let asked = false;
      const ok = await m.confirmAndDelete({ item, ask: async () => { asked = true; return true; }, remove: async () => {} });
      expect(ok, JSON.stringify(item)).toBe(false);
      expect(asked).toBe(false);
    }
  });

  test('the hooks are optional: a delete with only ask and remove still works', async () => {
    const removed: string[] = [];
    expect(await m.confirmAndDelete({ item: { id: 'a' }, ask: async () => true, remove: async (id) => { removed.push(id); } })).toBe(true);
    expect(await m.confirmAndDelete({ item: { id: 'b' }, ask: async () => true, remove: async () => { throw new Error('x'); } })).toBe(false);
    expect(removed).toStrictEqual(['a']);
  });
});
