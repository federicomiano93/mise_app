import { describe, expect, it } from 'vitest';
import { productCooking, productionCost } from '@mise/shared/foodcost-model';
import type { CostTables, Product } from '@mise/shared/foodcost-model';
import { costable, workingFrom } from '../productEditorModel';
import { summaryExtras } from '../summaryExtras';
import {
  addLine, applyLab, changedLineCount, clampPeople, goToStep, labNumbers, lineField, minutesOf, newDraft, nextUnticked, peopleShown, rawShown,
  resolveStep, soldByPieces, startDraft, stepPeople, stepsFor, toggleTick, typeInto,
} from './labModel';
import type { LabDraft, Presets } from './labModel';

// The lab's pure heart: the steps, the ticks, the typing, and the product the weights make.

const TABLES: CostTables = {
  ingredients: {
    FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
    SALT: { id: 'SALT', name: 'Salt', priceUnit: 'kg', pricePerUnit: 1.5 },
    EGG: { id: 'EGG', name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.2, unitWeightKg: 0.06 },
    SUGAR: { id: 'SUGAR', name: 'Sugar', priceUnit: 'kg', pricePerUnit: 1 },
    UNPRICED: { id: 'UNPRICED', name: 'Mystery' },
    BOX: { id: 'BOX', name: 'Box', priceUnit: 'pcs', pricePerUnit: 0.1 },
  },
  recipes: {
    DOUGH: { id: 'DOUGH', name: 'Dough', lossPct: 0, ingredients: [{ label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'FLOUR' }] },
  },
  labourCostPerHour: 12,
};

function product(fields: Partial<Product> = {}): Product {
  return {
    id: 'bread',
    name: 'Bread',
    components: [
      { recipeId: 'DOUGH', qtyKg: 0.6 },
      { kind: 'ingredient', ingredientId: 'FLOUR', qty: 0.5, unit: 'kg' },
      { kind: 'ingredient', ingredientId: 'SALT', qty: 10, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'EGG', qty: 2, unit: 'pcs' },
    ],
    packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }],
    sellingMode: 'piece',
    piecesPerBatch: 24,
    packSize: null,
    packUnit: null,
    sellingPrice: 3,
    vatRate: 0,
    foodCostTarget: 30,
    labourMinutes: 40,
    labourPeople: 2,
    noWeightLoss: false,
    rawGrams: null,
    cookedGrams: null,
    model: 3,
    ...fields,
  };
}

const NOW = 1_000_000_000_000;
const PRESETS: Presets = { raw: '1230', pieces: '24', minutes: '12' };

// Types a number into a field, key by key.
function typed(draft: LabDraft, field: Parameters<typeof typeInto>[1], keys: string): LabDraft {
  return [...keys].reduce((current, key) => typeInto(current, field, key === '<' ? 'back' : key, PRESETS), draft);
}

describe('the steps of a product', () => {
  it('has «Pezzi ottenuti» only when it is sold by the piece or in a pack counted in pieces', () => {
    const names = (fields: Partial<Product>) => stepsFor(product(fields)).join(' ');
    const all = 'start ingredients raw oven cooked pieces time result';
    const none = 'start ingredients raw oven cooked time result';
    expect(names({ sellingMode: 'piece' })).toBe(all);
    expect(names({ sellingMode: 'pack', packUnit: 'pcs', packSize: 6 })).toBe(all);
    expect(names({ sellingMode: 'pack', packUnit: 'g', packSize: 500 })).toBe(none);
    expect(names({ sellingMode: 'weight' })).toBe(none);
    expect(names({ sellingMode: null })).toBe(none);
  });

  it('reads «sold by pieces» the same way', () => {
    expect(soldByPieces(product({ sellingMode: 'pack', packUnit: 'pcs' }))).toBe(true);
    expect(soldByPieces(product({ sellingMode: 'pack', packUnit: 'kg' }))).toBe(false);
  });
});

describe('a new draft', () => {
  it('copies the lines with their planned amounts in grams, or pieces for a piece line', () => {
    const draft = newDraft(product());
    expect(draft.lines.map(line => line.planned)).toEqual([600, 500, 10, 2]);
    expect(draft.startedAt).toBeNull();
    expect(draft.step).toBe('start');
    expect(peopleShown(draft, 2)).toBe(2);
  });

  it('starts from one person when the card says none, and clamps a silly number of people', () => {
    expect(peopleShown(newDraft(product({ labourPeople: null })), null)).toBe(1);
    expect(clampPeople(0)).toBe(1);
    expect(clampPeople(99)).toBe(20);
    expect(clampPeople(Number.NaN)).toBe(1);
    expect(clampPeople(2.6)).toBe(3);
    // The stepper: from the card's number, by one, within 1 to 20.
    expect(stepPeople(newDraft(product({ labourPeople: 20 })), 20, 1).people).toBe(20);
    expect(stepPeople(newDraft(product()), 2, -1).people).toBe(1);
  });

  it('«Inizia» stores the start instant and goes to «Ingredienti»', () => {
    const started = startDraft(newDraft(product()), NOW);
    expect(started.startedAt).toBe(NOW);
    expect(started.step).toBe('ingredients');
  });
});

describe('ticking a line', () => {
  const draft = startDraft(newDraft(product()), NOW);

  it('without typing puts the planned weight', () => {
    const next = toggleTick(draft, 'l2');
    expect(next.ticked.l2).toBe(true);
    expect(next.weighed.l2).toBe('10');
    // A kilo line is weighed in grams.
    expect(toggleTick(draft, 'l1').weighed.l1).toBe('500');
    expect(toggleTick(draft, 'l3').weighed.l3).toBe('2');
  });

  it('after typing keeps what was typed', () => {
    const next = toggleTick(typed(draft, lineField('l2'), '12,5'), 'l2');
    expect(next.weighed.l2).toBe('12,5');
    expect(next.ticked.l2).toBe(true);
  });

  it('unticking keeps the weight', () => {
    const next = toggleTick(toggleTick(draft, 'l2'), 'l2');
    expect(next.ticked.l2).toBe(false);
    expect(next.weighed.l2).toBe('10');
  });

  it('does nothing on a line added in the lab until something is weighed (there is no planned weight to put)', () => {
    const { draft: withNew, key } = addLine(draft, { kind: 'ingredient', ingredientId: 'SUGAR', unit: 'g' });
    expect(toggleTick(withNew, key)).toBe(withNew);
    expect(toggleTick(typed(withNew, lineField(key), '20'), key).ticked[key]).toBe(true);
  });

  it('ignores a line that is not there', () => {
    expect(toggleTick(draft, 'nope')).toBe(draft);
  });

  it('moves on to the next line still to do, wrapping round, and null when all are done', () => {
    let current = draft;
    expect(nextUnticked(current, 'l0')).toBe('l1');
    current = toggleTick(toggleTick(current, 'l1'), 'l2');
    expect(nextUnticked(current, 'l0')).toBe('l3');
    expect(nextUnticked(current, 'l3')).toBe('l0');
    for (const key of ['l0', 'l3']) current = toggleTick(current, key);
    expect(nextUnticked(current, 'l0')).toBeNull();
  });
});

describe('typing into a box', () => {
  const draft = startDraft(newDraft(product()), NOW);

  it('replaces an untouched preset with the first digit, and «back» eats from it', () => {
    expect(typed(draft, 'raw', '9').raw).toBe('9');
    expect(typed(draft, 'raw', '<').raw).toBe('123');
    expect(typed(draft, 'pieces', '3').pieces).toBe('3');
  });

  it('keeps the comma out of a whole-number box and a piece line', () => {
    expect(typed(draft, 'minutes', '3,5').minutes).toBe('35');
    expect(typed(draft, lineField('l3'), '3,5').weighed.l3).toBe('35');
    expect(typed(draft, lineField('l2'), '3,5').weighed.l2).toBe('3,5');
  });

  it('returns the same draft when a key changes nothing', () => {
    expect(typeInto(draft, 'cooked', 'back', PRESETS)).toBe(draft);
    expect(typeInto(typed(draft, 'cooked', '123456'), 'cooked', '7', PRESETS).cooked).toBe('123456');
  });
});

describe('the product with today\'s weights', () => {
  const base = product();
  const started = startDraft(newDraft(base), NOW);

  it('gives each line its own unit: kilo lines get kilos, gram lines grams, piece lines pieces, recipe lines kilos', () => {
    let draft = started;
    draft = typed(draft, lineField('l0'), '650');
    draft = typed(draft, lineField('l1'), '480');
    draft = typed(draft, lineField('l2'), '12,5');
    draft = typed(draft, lineField('l3'), '3');
    const out = applyLab(base, draft, TABLES, NOW);
    expect(out.components).toEqual([
      { recipeId: 'DOUGH', qtyKg: 0.65 },
      { kind: 'ingredient', ingredientId: 'FLOUR', qty: 0.48, unit: 'kg' },
      { kind: 'ingredient', ingredientId: 'SALT', qty: 12.5, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'EGG', qty: 3, unit: 'pcs' },
    ]);
  });

  it('leaves a line nobody weighed exactly as it is saved', () => {
    const draft = typed(started, lineField('l2'), '11');
    const out = applyLab(base, draft, TABLES, NOW);
    expect(out.components[0]).toEqual(base.components[0]);
    expect(out.components[1]).toEqual(base.components[1]);
    expect(out.components[3]).toEqual(base.components[3]);
  });

  it('stores the raw weight only when it differs from the lines\' total', () => {
    // The lines add up to 600 + 500 + 10 + 2 eggs of 60 g = 1230 g.
    expect(productCooking(base, TABLES).rawTotalKg * 1000).toBeCloseTo(1230, 6);
    expect(applyLab(base, started, TABLES, NOW).rawGrams).toBeNull();
    expect(applyLab(base, typed(started, 'raw', '1230'), TABLES, NOW).rawGrams).toBeNull();
    expect(applyLab(base, typed(started, 'raw', '1230,03'), TABLES, NOW).rawGrams).toBeNull();
    expect(applyLab(base, typed(started, 'raw', '1300'), TABLES, NOW).rawGrams).toBe(1300);
  });

  it('keeps a raw weight typed and then emptied as «follows the total», and a zero as nothing', () => {
    expect(applyLab(base, typed(started, 'raw', '9<'), TABLES, NOW).rawGrams).toBeNull();
    expect(applyLab(base, typed(started, 'raw', '0'), TABLES, NOW).rawGrams).toBeNull();
  });

  it('shows the total in the raw box until a number is typed — and again if the box is emptied', () => {
    expect(rawShown(started, 1230)).toBe('1230');
    expect(rawShown(started, 1234.56)).toBe('1234,6');
    expect(rawShown(typed(started, 'raw', '99'), 1230)).toBe('99');
    expect(rawShown(typed(started, 'raw', '9<'), 1230)).toBe('1230');
    expect(rawShown(started, 0)).toBe('');
  });

  it('stores the cooked weight typed', () => {
    expect(applyLab(base, typed(started, 'cooked', '1080'), TABLES, NOW).cookedGrams).toBe(1080);
  });

  it('with no cooked weight typed, KEEPS the oven loss of the card: its cooked weight scaled to the new raw total', () => {
    // 1230 g raw down to 1107 g cooked on the card: a 10% loss.
    const withLoss = product({ cookedGrams: 1107 });
    const draft = startDraft(newDraft(withLoss), NOW);
    // The raw weight did not move: the number of the card, untouched.
    expect(applyLab(withLoss, draft, TABLES, NOW).cookedGrams).toBe(1107);
    // Salt 10 g to 130 g: the raw total moves to 1350 g, the cooked weight follows, the loss stays 10%.
    const heavier = typed(draft, lineField('l2'), '<<130');
    const out = applyLab(withLoss, heavier, TABLES, NOW);
    expect(productCooking(out, TABLES).lossPct).toBe(10);
    expect(out.cookedGrams).toBeCloseTo(1215, 3);
    expect(labNumbers(withLoss, heavier, TABLES, NOW).cookedKept).toBe(true);
    // A cooked weight typed wins and is not "kept".
    expect(labNumbers(withLoss, typed(draft, 'cooked', '1000'), TABLES, NOW).cookedKept).toBe(false);
  });

  it('keeps the loss percent of a product with a loss when one line changes', () => {
    const lossy = product({ cookedGrams: 984 });
    const out = applyLab(lossy, typed(startDraft(newDraft(lossy), NOW), lineField('l1'), '<<<600'), TABLES, NOW);
    expect(productCooking(out, TABLES).lossPct).toBe(productCooking(lossy, TABLES).lossPct);
  });

  it('a product with no cooked weight stays without one', () => {
    expect(applyLab(base, started, TABLES, NOW).cookedGrams).toBeNull();
    expect(labNumbers(base, started, TABLES, NOW).cookedKept).toBe(false);
  });

  it('keeps the people of the card untouched: 1.5 stays 1.5, 25 stays 25, none stays none', () => {
    const saved = (people: number | null) => {
      const card = product({ labourPeople: people });
      return applyLab(card, startDraft(newDraft(card), NOW), TABLES, NOW).labourPeople;
    };
    expect(saved(1.5)).toBe(1.5);
    expect(saved(25)).toBe(25);
    expect(saved(null)).toBeNull();
    // A press moves it, from the rounded value.
    expect(stepPeople(newDraft(product()), 1.5, 1).people).toBe(3);
    expect(stepPeople(newDraft(product()), 25, -1).people).toBe(19);
  });

  it('writes back EXACTLY the stored quantity of a line ticked without typing', () => {
    const awkward = product({
      components: [
        { recipeId: 'DOUGH', qtyKg: 0.1234567 },
        { kind: 'ingredient', ingredientId: 'FLOUR', qty: 0.7654321, unit: 'kg' },
        { kind: 'ingredient', ingredientId: 'SALT', qty: 10.123456, unit: 'g' },
      ],
    });
    const ticked = ['l0', 'l1', 'l2'].reduce(toggleTick, startDraft(newDraft(awkward), NOW));
    const out = applyLab(awkward, ticked, TABLES, NOW);
    expect(out.components).toEqual(awkward.components);
    expect(changedLineCount(awkward, out)).toBe(0);
  });

  it('stores the pieces only when entered, and only for a product sold by pieces', () => {
    expect(applyLab(base, started, TABLES, NOW).piecesPerBatch).toBe(24);
    expect(applyLab(base, typed(started, 'pieces', '22'), TABLES, NOW).piecesPerBatch).toBe(22);
    expect(applyLab(base, typed(started, 'pieces', '0'), TABLES, NOW).piecesPerBatch).toBe(24);
    const byWeight = product({ sellingMode: 'weight', piecesPerBatch: null });
    expect(applyLab(byWeight, typed(startDraft(newDraft(byWeight), NOW), 'pieces', '22'), TABLES, NOW).piecesPerBatch).toBeNull();
  });

  it('stores the minutes and the people', () => {
    const draft = stepPeople(typed(started, 'minutes', '35'), 2, 1);
    const out = applyLab(base, draft, TABLES, NOW);
    expect(out.labourMinutes).toBe(35);
    expect(out.labourPeople).toBe(3);
  });

  it('adds a line weighed in the lab at the end, and drops one with nothing weighed', () => {
    const one = addLine(started, { kind: 'ingredient', ingredientId: 'SUGAR', unit: 'g' });
    const two = addLine(one.draft, { kind: 'ingredient', ingredientId: 'EGG', unit: 'pcs' });
    const out = applyLab(base, typed(two.draft, lineField(one.key), '40'), TABLES, NOW);
    expect(out.components).toHaveLength(5);
    expect(out.components[4]).toEqual({ kind: 'ingredient', ingredientId: 'SUGAR', qty: 40, unit: 'g' });
    expect(two.key).not.toBe(one.key);
  });

  it('does not bring back a line deleted elsewhere meanwhile, and keeps one added elsewhere', () => {
    const draft = typed(typed(started, lineField('l2'), '11'), lineField('l1'), '480');
    const elsewhere = product({
      components: [
        { recipeId: 'DOUGH', qtyKg: 0.6 },
        // The flour line is gone; a sugar line is new.
        { kind: 'ingredient', ingredientId: 'SALT', qty: 10, unit: 'g' },
        { kind: 'ingredient', ingredientId: 'SUGAR', qty: 30, unit: 'g' },
      ],
    });
    const out = applyLab(elsewhere, draft, TABLES, NOW);
    expect(out.components).toEqual([
      { recipeId: 'DOUGH', qtyKg: 0.6 },
      { kind: 'ingredient', ingredientId: 'SALT', qty: 11, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'SUGAR', qty: 30, unit: 'g' },
    ]);
  });

  it('matches the nth line of a kind to the nth: two salt lines keep their own weights', () => {
    const twice = product({
      components: [
        { kind: 'ingredient', ingredientId: 'SALT', qty: 10, unit: 'g' },
        { kind: 'ingredient', ingredientId: 'SALT', qty: 20, unit: 'g' },
      ],
    });
    const draft = typed(startDraft(newDraft(twice), NOW), lineField('l1'), '25');
    expect(applyLab(twice, draft, TABLES, NOW).components.map(line => (line.kind === 'ingredient' ? line.qty : 0))).toEqual([10, 25]);
  });

  it('keeps everything it does not own: the price, the packaging, the way of selling, the name', () => {
    const out = applyLab(base, typed(started, 'cooked', '1000'), TABLES, NOW);
    expect(out).toMatchObject({
      id: 'bread', name: 'Bread', packaging: base.packaging, sellingPrice: 3, sellingMode: 'piece', model: 3, vatRate: 0, foodCostTarget: 30,
    });
  });
});

describe('the lab\'s figures are the card\'s', () => {
  const base = product();
  const started = startDraft(newDraft(base), NOW);
  const weighed = stepPeople(
    typed(typed(typed(typed(typed(typed(started, lineField('l1'), '480'), lineField('l2'), '12'), 'raw', '1300'), 'cooked', '1100'), 'pieces', '22'), 'minutes', '35'),
    2,
    1,
  );

  it('equal the shared model on the same weights typed into the card\'s own working copy', () => {
    const lab = labNumbers(base, weighed, TABLES, NOW);

    // The same weights, typed the way the card's boxes hold them.
    const working = workingFrom(base, 'GB');
    working.components = working.components.map((line, index) => {
      if (index === 1 && line.kind === 'ingredient') return { ...line, qty: '0.48' };
      if (index === 2 && line.kind === 'ingredient') return { ...line, qty: '12' };
      return line;
    });
    working.rawText = '1300';
    working.cookedText = '1100';
    working.piecesPerBatch = '22';
    working.labourMinutes = '35';
    working.labourPeople = '3';
    const card = costable(working, 'bread');

    expect(lab.product.components).toEqual(card.components);
    expect(lab.product.rawGrams).toBe(card.rawGrams);
    expect(lab.product.cookedGrams).toBe(card.cookedGrams);
    expect(lab.product.piecesPerBatch).toBe(card.piecesPerBatch);

    const cooking = productCooking(card, TABLES);
    expect(lab.lossPct).toBe(cooking.lossPct);
    expect(lab.totalGrams).toBeCloseTo(cooking.rawTotalKg * 1000, 9);
    const cost = productionCost(card, TABLES);
    expect(lab.unit).toBe(cost.unit);
    expect(lab.unitCost).toBe(cost.unitCost);
    expect(lab.totalUnitCost).toBe(cost.totalUnitCost);
    expect(lab.partial).toBe(cost.partial);
    const extras = summaryExtras(card, TABLES);
    expect(lab.perKg).toBe(extras?.perKg);
    expect(lab.perKgPartial).toBe(extras?.perKgPartial);
    expect(lab.minutes).toBe(35);
    expect(lab.people).toBe(3);
  });

  it('say «a price is missing» through the model\'s own partial flag', () => {
    const withUnpriced = product({ components: [...base.components, { kind: 'ingredient', ingredientId: 'UNPRICED', qty: 5, unit: 'g' }] });
    const numbers = labNumbers(withUnpriced, startDraft(newDraft(withUnpriced), NOW), TABLES, NOW);
    expect(numbers.partial).toBe(true);
    expect(numbers.perKgPartial).toBe(true);
  });

  it('reports a cooked weight heavier than the raw one and no loss', () => {
    const heavy = labNumbers(base, typed(started, 'cooked', '1500'), TABLES, NOW);
    expect(heavy.heavier).toBe(true);
    expect(heavy.lossPct).toBeNull();
  });
});

describe('what the save changes', () => {
  const base = product();
  const started = startDraft(newDraft(base), NOW);

  it('counts the lines whose amount changes, and the lines added', () => {
    expect(changedLineCount(base, applyLab(base, started, TABLES, NOW))).toBe(0);
    // Ticking every line without typing puts the planned weights: nothing changes.
    const ticked = ['l0', 'l1', 'l2', 'l3'].reduce(toggleTick, started);
    expect(changedLineCount(base, applyLab(base, ticked, TABLES, NOW))).toBe(0);
    const changed = typed(ticked, lineField('l2'), '<<11');
    expect(changedLineCount(base, applyLab(base, changed, TABLES, NOW))).toBe(1);
    const added = addLine(started, { kind: 'ingredient', ingredientId: 'SUGAR', unit: 'g' });
    expect(changedLineCount(base, applyLab(base, typed(added.draft, lineField(added.key), '40'), TABLES, NOW))).toBe(1);
  });
});

describe('the labour minutes', () => {
  const base = product();
  const started = startDraft(newDraft(base), NOW);

  it('follow the timer until a number is typed', () => {
    expect(minutesOf(started, NOW + 35 * 60_000)).toBe(35);
    expect(minutesOf(started, NOW + 10_000)).toBe(1);
    expect(minutesOf(typed(started, 'minutes', '50'), NOW + 35 * 60_000)).toBe(50);
  });

  it('are frozen at the timer\'s reading when the person leaves «Tempo e persone», and run again on coming back', () => {
    const atTime = goToStep(started, 'time', NOW + 20 * 60_000);
    expect(atTime.minutesFrozen).toBeNull();
    const left = goToStep(atTime, 'result', NOW + 21 * 60_000);
    expect(left.minutesFrozen).toBe(21);
    expect(minutesOf(left, NOW + 90 * 60_000)).toBe(21);
    expect(goToStep(left, 'time', NOW + 91 * 60_000).minutesFrozen).toBeNull();
  });

  it('do not follow the timer when the production is older than a day: the card minutes stand, and typing still works', () => {
    const later = NOW + 25 * 3_600_000;
    expect(minutesOf(started, later, 40)).toBe(40);
    expect(applyLab(base, started, TABLES, later).labourMinutes).toBe(40);
    expect(minutesOf(started, later, null)).toBe(1);
    expect(minutesOf(typed(started, 'minutes', '50'), later, 40)).toBe(50);
    // Leaving the time step freezes nothing then.
    expect(goToStep(goToStep(started, 'time', later), 'result', later).minutesFrozen).toBeNull();
    // Just under a day still follows.
    expect(minutesOf(started, NOW + 23 * 3_600_000, 40)).toBe(23 * 60);
  });

  it('typed minutes are not frozen over, and a typed zero falls back to the timer', () => {
    const typedOnes = typed(goToStep(started, 'time', NOW), 'minutes', '50');
    expect(goToStep(typedOnes, 'result', NOW + 60 * 60_000).minutesFrozen).toBeNull();
    expect(minutesOf(typed(started, 'minutes', '0'), NOW + 7 * 60_000)).toBe(7);
  });

  it('are at most the rules\' ceiling', () => {
    expect(minutesOf(typed(started, 'minutes', '999999'), NOW)).toBe(100000);
  });
});

describe('a resumed step that no longer exists', () => {
  it('is mapped to the next one that does, and leaving it freezes the minutes as the time step would', () => {
    const noPieces = stepsFor(product({ sellingMode: 'weight' }));
    expect(resolveStep(noPieces, 'pieces')).toBe('time');
    expect(resolveStep(noPieces, 'raw')).toBe('raw');
    expect(resolveStep(['start', 'result'], 'oven')).toBe('result');
    const started = startDraft(newDraft(product()), NOW);
    // The lab calls goToStep with the RESOLVED step: from 'time' (mapped from 'pieces') the reading is frozen.
    const stored = { ...started, step: 'pieces' as const };
    expect(goToStep({ ...stored, step: resolveStep(noPieces, stored.step) }, 'result', NOW + 5 * 60_000).minutesFrozen).toBe(5);
  });
});
