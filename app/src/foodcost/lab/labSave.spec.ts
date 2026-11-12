import { describe, expect, it } from 'vitest';
import type { CostTables, Product } from '@mise/shared/foodcost-model';
import { lineField, newDraft, startDraft, typeInto } from './labModel';
import { planLabSave } from './labSave';

// What «Salva nella scheda» is about to write.

const TABLES: CostTables = {
  ingredients: {
    FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
    SALT: { id: 'SALT', name: 'Salt', priceUnit: 'kg', pricePerUnit: 1.5 },
  },
  recipes: {},
  labourCostPerHour: 12,
};

const bread: Product = {
  id: 'bread',
  name: 'Bread',
  components: [
    { kind: 'ingredient', ingredientId: 'FLOUR', qty: 1, unit: 'kg' },
    { kind: 'ingredient', ingredientId: 'SALT', qty: 10, unit: 'g' },
  ],
  packaging: [],
  sellingMode: 'piece',
  piecesPerBatch: 10,
  packSize: null,
  packUnit: null,
  sellingPrice: 1.2,
  vatRate: 20,
  foodCostTarget: 25,
  labourMinutes: 30,
  labourPeople: 1,
  noWeightLoss: false,
  rawGrams: null,
  cookedGrams: null,
  model: 3,
};

const NOW = 1_700_000_000_000;
const ISO = new Date(NOW).toISOString();
const P = { raw: '', pieces: '', minutes: '' };
const typed = (draft: ReturnType<typeof newDraft>, field: Parameters<typeof typeInto>[1], keys: string) =>
  [...keys].reduce((current, key) => typeInto(current, field, key, P), draft);

describe('planning the save', () => {
  const started = startDraft(newDraft(bread), NOW);

  it('applies the lab onto the product as it is saved now', () => {
    const plan = planLabSave(bread, TABLES, typed(started, 'cooked', '900'), NOW + 60_000, ISO);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.product.cookedGrams).toBe(900);
    expect(plan.product.labourMinutes).toBe(1);
    expect(plan.changedLines).toBe(0);
  });

  it('records a margin point when the composition changes, as the card save does, and none when only the work changes', () => {
    // The cooked weight is part of the composition (it decides what a kilo costs).
    const withCooked = planLabSave(bread, TABLES, typed(started, 'cooked', '900'), NOW, ISO);
    expect(withCooked.ok && withCooked.snapshot).toBeTruthy();
    if (withCooked.ok && withCooked.snapshot) expect(withCooked.snapshot.recordedAt).toBe(ISO);
    // Only the work changes: no point (a history of non-events cannot answer «when did this change?»).
    const labourOnly = planLabSave(bread, TABLES, typed(started, 'minutes', '45'), NOW, ISO);
    expect(labourOnly.ok && labourOnly.snapshot).toBeNull();
  });

  it('says «gone» when the product was deleted meanwhile, and writes nothing', () => {
    expect(planLabSave(null, TABLES, started, NOW, ISO)).toEqual({ ok: false, reason: 'gone' });
    expect(planLabSave(undefined, TABLES, started, NOW, ISO)).toEqual({ ok: false, reason: 'gone' });
  });

  it('accepts the biggest weight the keypad can type (under the rules\' ten tonnes)', () => {
    const huge = typed(started, 'cooked', '999999');
    expect(planLabSave(bread, TABLES, huge, NOW, ISO).ok).toBe(true);
  });

  it('refuses a weight the rules would refuse, while the work is still on screen', () => {
    // The keypad cannot type this; a draft forged in storage could.
    const forged = { ...started, cooked: '99999999' };
    expect(planLabSave(bread, TABLES, forged, NOW, ISO)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('keeps a kilo line in kilos and a gram line in grams in what it will write', () => {
    const draft = typed(typed(started, lineField('l0'), '1050'), lineField('l1'), '11');
    const plan = planLabSave(bread, TABLES, draft, NOW, ISO);
    expect(plan.ok && plan.product.components).toEqual([
      { kind: 'ingredient', ingredientId: 'FLOUR', qty: 1.05, unit: 'kg' },
      { kind: 'ingredient', ingredientId: 'SALT', qty: 11, unit: 'g' },
    ]);
    expect(plan.ok && plan.changedLines).toBe(2);
  });
});
