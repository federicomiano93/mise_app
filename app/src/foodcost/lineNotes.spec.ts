import { describe, expect, it } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import type { CostTables } from '@mise/shared/foodcost-model';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { MessageParams } from '../i18n/i18n';
import { lineNote } from './lineNotes';
import type { WorkingComponent } from './productEditorModel';

// The «too much of a recipe» note under a recipe line. Model 3: the line is RAW kilos, so it is measured against the RAW whole recipe.

const BRITAIN = moneyOf('£', { decimal: '.', group: '', symbolAfter: false });
const say = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const LOADED = { recipes: true, ingredients: true };

// One kilo of flour that loses HALF in the oven: 1 kg raw, 0.5 kg once made. Twenty whole batches: 20 kg raw, but only 10 kg finished.
const TABLES: CostTables = {
  ingredients: { FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 } },
  recipes: {
    DOUGH: { id: 'DOUGH', name: 'Dough', lossPct: 50, ingredients: [{ label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'FLOUR' }] },
  },
};

const line = (kilos: number): WorkingComponent => ({ key: 'k', kind: 'recipe', recipeId: 'DOUGH', qty: String(kilos), unit: 'kg' });
const note = (kilos: number) => lineNote(say, BRITAIN, line(kilos), TABLES, LOADED);

describe('the note under a recipe line asking for too much', () => {
  it('measures the RAW line against the RAW whole recipe: 15 kg is between 20 × finished and 20 × raw, so no note', () => {
    // 15 kg > 20 × 0.5 kg (the finished whole) but ≤ 20 × 1 kg (the raw whole).
    expect(note(15)).toBe('');
  });

  it('warns past 20 raw whole batches, naming the RAW whole recipe', () => {
    expect(note(25)).toBe('25.00 kg, but the recipe makes 1.00 kg: did you mean 25.00 g?');
  });
});
