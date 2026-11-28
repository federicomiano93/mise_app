import { describe, expect, it } from 'vitest';
import { productionCost } from '@mise/shared/foodcost-model';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recipeCardDocument } from './recipeCard';

const rules = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');

describe('the card made with a new recipe', () => {
  it('is only the name, empty everywhere else, finished by default', () => {
    expect(recipeCardDocument('finished', 'Focaccia')).toEqual({
      name: 'Focaccia', components: [], packaging: [], sellingMode: null, piecesPerBatch: null, packSize: null, packUnit: null,
      sellingPrice: null, vatRate: null, foodCostTarget: null, labourMinutes: null, labourPeople: null,
      model: 4, kind: 'finished', categoryId: null,
    });
  });

  it('is semi-finished when asked', () => {
    expect(recipeCardDocument('semi', 'Ganache')).toMatchObject({ name: 'Ganache', kind: 'semi', components: [] });
  });

  it('is nothing for «No card», and nothing for a name that is empty', () => {
    expect(recipeCardDocument('none', 'Focaccia')).toBeNull();
    expect(recipeCardDocument('finished', '   ')).toBeNull();
  });

  it('trims the name and keeps it within the rules’ 200 characters', () => {
    expect(recipeCardDocument('finished', '  Pane  ')).toMatchObject({ name: 'Pane' });
    expect((recipeCardDocument('finished', 'x'.repeat(300))?.['name'] as string).length).toBe(200);
  });

  it('has only keys the products rule accepts', () => {
    const block = /match \/products\/\{id\} \{[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/.exec(rules);
    expect(block, 'the products block is in firestore.rules').not.toBeNull();
    const allowed = new Set([...(block as RegExpExecArray)[1]!.matchAll(/'([A-Za-z]+)'/g)].map(found => found[1]));
    const refused = Object.keys(recipeCardDocument('finished', 'Focaccia') ?? {}).filter(key => !allowed.has(key));
    expect(refused).toEqual([]);
  });

  it('reads as «not costed» in Food cost: no percentage, never a cost of nothing', () => {
    const document = recipeCardDocument('finished', 'Focaccia') as Record<string, unknown>;
    const cost = productionCost({ id: 'p', ...document, noWeightLoss: false, rawGrams: null, cookedGrams: null });
    expect(cost.unitCost).toBeNull();
    expect(cost.totalUnitCost).toBeNull();
  });
});
