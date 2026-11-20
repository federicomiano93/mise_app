import { describe, expect, it } from 'vitest';
import { cakeProduct } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toProductDocument } from '../foodcost/foodcostStore';

// A cake is saved as an ordinary Food cost product, through the same `toProductDocument` as every card, and the products rule lists the
// keys it accepts: a key it did not list would make the cake's whole batch (the cake AND its card) be refused, and the rollback would
// throw both away. (The slice-1 report owed this check to the editor.)

const CAKE: Cake = {
  id: 'c1', name: 'Sacher', diameterCm: 24, tiers: 2, discs: 3, slices: 12,
  lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 600 }, { tier: 1, part: 'filling', productId: 'CREAM', grams: null }],
  packaging: [{ ingredientId: 'box', qtyPcs: 2 }], assemblyMinutes: 20, sellingPrice: 60, vatRate: 10, foodCostTarget: 30,
  categoryId: 'cat', ref: { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 }, model: 1,
};

const rules = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');

describe('the product a cake is saved as', () => {
  it('has only keys the products rule accepts', () => {
    const block = /match \/products\/\{id\} \{[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/.exec(rules);
    expect(block, 'the products block is in firestore.rules').not.toBeNull();
    const allowed = new Set([...(block as RegExpExecArray)[1]!.matchAll(/'([A-Za-z]+)'/g)].map(found => found[1]));
    const document = toProductDocument(cakeProduct(CAKE));
    const refused = Object.keys(document).filter(key => !allowed.has(key));
    expect(refused).toEqual([]);
    // …and it says what the rules need of a card: stamped by the data layer, a name, the model, and a sold piece.
    expect(document).toMatchObject({ name: 'Sacher', sellingMode: 'piece', piecesPerBatch: 1, kind: 'finished', categoryId: 'cat' });
  });
});
