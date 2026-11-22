import { describe, expect, it } from 'vitest';
import { CAKE_MODEL, MAX_CARDS_PER_PART, MAX_PACKAGING, cakeProductId } from '@mise/shared/cake-model';
import type { Cake, ReferenceGrams } from '@mise/shared/cake-model';
import { normalizeStandard, referenceFor } from '@mise/shared/cake-standard';
import type { CakeStandard } from '@mise/shared/cake-standard';
import {
  addCard, addPack, canAddCard, cardsIn, clearDiscHeight, firstEmptyPack, followStandard, isDirty, referenceChanged, removeCard, removePack, resetGrams,
  setGrams, setMeasure, setName, setPackQty, setPrice, setTarget, setVat, takeReference, vatFromSelect, withoutMissingRecipeCards, workingFrom,
} from './cakeEditorModel';

const REF: ReferenceGrams = { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };

const CAKE: Cake = {
  id: 'c1', name: 'Sacher', diameterCm: 24, tiers: 2, discs: 3, slices: 12,
  lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: null }, { tier: 1, part: 'base', productId: 'SPONGE', grams: 400 }],
  packaging: [{ ingredientId: 'box', qtyPcs: 1 }], assemblyMinutes: 20, sellingPrice: 60, vatRate: 10, foodCostTarget: 30,
  categoryId: 'cat', discHeightCm: null, ref: REF, model: CAKE_MODEL,
};

describe('workingFrom', () => {
  it('a new cake is a plain one-tier cake with the venue’s reference grams copied in', () => {
    const fresh = workingFrom(null, REF, 'n1');
    expect(fresh).toMatchObject({ id: 'n1', name: '', tiers: 1, lines: [], packaging: [], sellingPrice: null, vatRate: null, ref: REF });
    expect(fresh.ref).not.toBe(REF);
  });

  it('a new cake has no reference while the venue has none', () => {
    expect(workingFrom(null, null).ref).toBeNull();
  });

  it('copies a stored cake so editing the copy never touches it', () => {
    const copy = workingFrom(CAKE, REF);
    expect(copy).toEqual(CAKE);
    expect(copy.lines).not.toBe(CAKE.lines);
    expect(copy.lines[0]).not.toBe(CAKE.lines[0]);
    expect(copy.ref).not.toBe(CAKE.ref);
  });
});

describe('isDirty', () => {
  it('is false for an untouched copy, true after a change, false when the change is undone', () => {
    const initial = workingFrom(CAKE, REF);
    expect(isDirty(workingFrom(CAKE, REF), initial)).toBe(false);
    const changed = setName(initial, 'Sacher 2');
    expect(isDirty(changed, initial)).toBe(true);
    expect(isDirty(setName(changed, 'Sacher'), initial)).toBe(false);
  });

  it('a tier taken away and brought back is not a change (its lines were kept)', () => {
    const initial = workingFrom(CAKE, REF);
    const back = setMeasure(setMeasure(initial, 'tiers', 1), 'tiers', 2);
    expect(back.lines).toHaveLength(2);
    expect(isDirty(back, initial)).toBe(false);
  });

  it('a line of a tier the cake no longer has is not written, so it is not a change either', () => {
    const initial = workingFrom(CAKE, REF);
    expect(isDirty(removeCard(setMeasure(initial, 'tiers', 1), 1, 'base', 'SPONGE'), setMeasure(initial, 'tiers', 1))).toBe(false);
  });
});

describe('setMeasure', () => {
  it('moves the diameter inside [what the tiers need, 40]', () => {
    expect(setMeasure(CAKE, 'diameterCm', 26).diameterCm).toBe(26);
    expect(setMeasure(CAKE, 'diameterCm', 12).diameterCm).toBe(16);
    expect(setMeasure(CAKE, 'diameterCm', 99).diameterCm).toBe(40);
    expect(setMeasure(workingFrom(null, null), 'diameterCm', 3).diameterCm).toBe(10);
  });

  it('clamps the tiers to what the diameter carries, never below 1', () => {
    expect(setMeasure({ ...CAKE, diameterCm: 20 }, 'tiers', 3).tiers).toBe(2);
    expect(setMeasure({ ...CAKE, diameterCm: 22 }, 'tiers', 3).tiers).toBe(3);
    expect(setMeasure(CAKE, 'tiers', 0).tiers).toBe(1);
  });

  it('clamps the discs to 1–5 and the slices to 1–200, in whole numbers', () => {
    expect(setMeasure(CAKE, 'discs', 9).discs).toBe(5);
    expect(setMeasure(CAKE, 'discs', 0).discs).toBe(1);
    expect(setMeasure(CAKE, 'slices', 500).slices).toBe(200);
    expect(setMeasure(CAKE, 'slices', 0).slices).toBe(1);
    expect(setMeasure(CAKE, 'slices', 7.6).slices).toBe(8);
  });

  it('the disc height takes one decimal inside 0.5–20, ignores junk and returns the same cake when nothing moves', () => {
    expect(setMeasure(CAKE, 'discHeightCm', 4.46).discHeightCm).toBe(4.5);
    expect(setMeasure(CAKE, 'discHeightCm', 0.1).discHeightCm).toBe(0.5);
    expect(setMeasure(CAKE, 'discHeightCm', 99).discHeightCm).toBe(20);
    const own = { ...CAKE, discHeightCm: 4.5 };
    expect(setMeasure(own, 'discHeightCm', 0)).toBe(own);
    expect(setMeasure(own, 'discHeightCm', -3)).toBe(own);
    expect(setMeasure(own, 'discHeightCm', Number.NaN)).toBe(own);
    expect(setMeasure(own, 'discHeightCm', 4.5)).toBe(own);
  });

  it('clearing the disc height makes the cake follow its reference again, and does nothing when it already does', () => {
    const own = { ...CAKE, discHeightCm: 4.5 };
    expect(clearDiscHeight(own).discHeightCm).toBeNull();
    expect(clearDiscHeight(CAKE)).toBe(CAKE);
    expect(isDirty(clearDiscHeight(own), own)).toBe(true);
  });

  it('assembly minutes above 0, or none', () => {
    expect(setMeasure(CAKE, 'assemblyMinutes', 25).assemblyMinutes).toBe(25);
    expect(setMeasure(CAKE, 'assemblyMinutes', 0).assemblyMinutes).toBeNull();
    expect(setMeasure(CAKE, 'assemblyMinutes', -5).assemblyMinutes).toBeNull();
  });

  it('ignores a value that is not a number and returns the same cake when nothing moves', () => {
    expect(setMeasure(CAKE, 'discs', Number.NaN)).toBe(CAKE);
    expect(setMeasure(CAKE, 'discs', 3)).toBe(CAKE);
  });
});

describe('the name, the price, the target and the VAT', () => {
  it('sets each, and reads «» as none', () => {
    expect(setName(CAKE, 'x').name).toBe('x');
    expect(setPrice(CAKE, '12,5').sellingPrice).toBe(12.5);
    expect(setPrice(CAKE, '').sellingPrice).toBeNull();
    expect(setTarget(CAKE, '28').foodCostTarget).toBe(28);
    expect(setVat(CAKE, 0).vatRate).toBe(0);
  });

  it('keeps junk as NaN so Save can name the box', () => {
    expect(Number.isNaN(setPrice(CAKE, 'abc').sellingPrice)).toBe(true);
    expect(Number.isNaN(setTarget(CAKE, '1.2.3').foodCostTarget)).toBe(true);
  });

  it('reads the VAT menu: nothing chosen is none, a rate is a number, «other» reads its own box', () => {
    expect(vatFromSelect('', '')).toBeNull();
    expect(vatFromSelect('10', '')).toBe(10);
    expect(vatFromSelect('0', '')).toBe(0);
    expect(vatFromSelect('other', '7,5')).toBe(7.5);
    expect(vatFromSelect('other', '')).toBeNull();
  });
});

describe('cards', () => {
  it('adds a card to a part, at the end, with its grams from the rule', () => {
    const next = addCard(CAKE, 0, 'filling', 'CREAM');
    expect(cardsIn(next, 0, 'filling')).toEqual([{ tier: 0, part: 'filling', productId: 'CREAM', grams: null }]);
    expect(next.lines.at(-1)?.productId).toBe('CREAM');
    expect(CAKE.lines).toHaveLength(2);
  });

  it('never twice in the same part, but the same card may sit in another part or tier', () => {
    expect(addCard(CAKE, 0, 'base', 'SPONGE')).toBe(CAKE);
    expect(canAddCard(CAKE, 0, 'soak', 'SPONGE')).toBe(true);
    expect(canAddCard(CAKE, 1, 'base', 'SPONGE')).toBe(false);
    expect(canAddCard({ ...CAKE, tiers: 3 }, 2, 'base', 'SPONGE')).toBe(true);
  });

  it('never more than MAX_CARDS_PER_PART in a part', () => {
    let cake = workingFrom(null, REF, 'n');
    for (let i = 0; i < MAX_CARDS_PER_PART + 2; i += 1) cake = addCard(cake, 0, 'filling', `CARD${i}`);
    expect(cardsIn(cake, 0, 'filling')).toHaveLength(MAX_CARDS_PER_PART);
    expect(canAddCard(cake, 0, 'filling', 'ANOTHER')).toBe(false);
    expect(canAddCard(cake, 0, 'coating', 'ANOTHER')).toBe(true);
  });

  it('never offers a whole cake as a card — its own, nor another’s', () => {
    expect(canAddCard(CAKE, 0, 'base', cakeProductId('c1'))).toBe(false);
    expect(addCard(CAKE, 0, 'base', cakeProductId('c9'))).toBe(CAKE);
    expect(addCard(CAKE, 0, 'base', '')).toBe(CAKE);
  });

  it('removes only that card of that part of that tier', () => {
    const both = addCard(CAKE, 0, 'soak', 'SPONGE');
    const next = removeCard(both, 0, 'base', 'SPONGE');
    expect(next.lines.map(line => `${line.tier}.${line.part}`)).toEqual(['1.base', '0.soak']);
    expect(removeCard(next, 0, 'base', 'SPONGE')).toBe(next);
  });
});

describe('withoutMissingRecipeCards', () => {
  const held = { ...CAKE, lines: [
    { tier: 0, part: 'base' as const, productId: 'recipe-gone', grams: 100 },
    { tier: 0, part: 'soak' as const, productId: 'recipe-here', grams: null },
    { tier: 0, part: 'filling' as const, productId: 'ghost-card', grams: null },
  ] };
  const exists = (id: string) => id === 'recipe-here';

  it('drops only a line whose recipe- card is not among the cards', () => {
    expect(withoutMissingRecipeCards(held, exists).lines.map(line => line.productId)).toEqual(['recipe-here', 'ghost-card']);
  });

  it('leaves every other line alone, a card that is missing included, and returns the same cake when nothing goes', () => {
    expect(withoutMissingRecipeCards(CAKE, () => false)).toBe(CAKE);
    expect(withoutMissingRecipeCards(held, () => true)).toBe(held);
  });
});

describe('grams', () => {
  it('a typed figure wins, a cleared box goes back to the rule', () => {
    const typed = setGrams(CAKE, 0, 'base', 'SPONGE', '650');
    expect(typed.lines[0]?.grams).toBe(650);
    expect(setGrams(typed, 0, 'base', 'SPONGE', '').lines[0]?.grams).toBeNull();
    expect(resetGrams(typed, 0, 'base', 'SPONGE').lines[0]?.grams).toBeNull();
  });

  it('0 is a real answer, whole grams, never above what the rules accept', () => {
    expect(setGrams(CAKE, 0, 'base', 'SPONGE', '0').lines[0]?.grams).toBe(0);
    expect(setGrams(CAKE, 0, 'base', 'SPONGE', '12,6').lines[0]?.grams).toBe(13);
    expect(setGrams(CAKE, 0, 'base', 'SPONGE', '999999').lines[0]?.grams).toBe(100000);
  });

  it('a box that is not a number leaves the card as it was; an unknown card changes nothing', () => {
    expect(setGrams(CAKE, 0, 'base', 'SPONGE', 'abc')).toBe(CAKE);
    expect(setGrams(CAKE, 0, 'base', 'GHOST', '5')).toBe(CAKE);
  });
});

describe('packaging', () => {
  it('adds a line of one piece, once per ingredient, and removes it', () => {
    const next = addPack(CAKE, 'ribbon');
    expect(next.packaging).toEqual([{ ingredientId: 'box', qtyPcs: 1 }, { ingredientId: 'ribbon', qtyPcs: 1 }]);
    expect(addPack(next, 'ribbon')).toBe(next);
    expect(addPack(CAKE, '')).toBe(CAKE);
    expect(removePack(next, 'ribbon').packaging).toEqual(CAKE.packaging);
    expect(removePack(CAKE, 'ghost')).toBe(CAKE);
  });

  it('never more than MAX_PACKAGING lines', () => {
    let cake = workingFrom(null, null, 'n');
    for (let i = 0; i < MAX_PACKAGING + 3; i += 1) cake = addPack(cake, `p${i}`);
    expect(cake.packaging).toHaveLength(MAX_PACKAGING);
  });

  it('pieces typed are whole; an empty box is 0, which Save refuses and names', () => {
    expect(setPackQty(CAKE, 'box', '3').packaging[0]?.qtyPcs).toBe(3);
    const emptied = setPackQty(CAKE, 'box', '');
    expect(emptied.packaging[0]?.qtyPcs).toBe(0);
    expect(firstEmptyPack(emptied)).toBe('box');
    expect(firstEmptyPack(CAKE)).toBeNull();
    expect(setPackQty(CAKE, 'box', 'x')).toBe(CAKE);
  });
});

describe('the reference grams', () => {
  const NEWER: ReferenceGrams = { ...REF, baseG: 320 };

  it('says when the venue’s grams are not the ones the cake took, and takes them in', () => {
    expect(referenceChanged(CAKE, REF)).toBe(false);
    expect(referenceChanged(CAKE, NEWER)).toBe(true);
    expect(referenceChanged({ ...CAKE, ref: null }, NEWER)).toBe(true);
    expect(referenceChanged(CAKE, null)).toBe(false);
    const taken = takeReference(CAKE, NEWER);
    expect(taken.ref).toEqual(NEWER);
    expect(taken.ref).not.toBe(NEWER);
    expect(takeReference(CAKE, REF)).toBe(CAKE);
  });

  it('hand-typed grams stay when the reference is taken', () => {
    const typed = setGrams(CAKE, 1, 'base', 'SPONGE', '400');
    expect(takeReference(typed, NEWER).lines[1]?.grams).toBe(400);
  });
});

describe('followStandard', () => {
  // Two typed rows: 20 cm and 28 cm; the other diameters are scaled from them.
  const STANDARD: CakeStandard = {
    discs: 3, discHeightCm: 3,
    rows: [
      { diameterCm: 20, baseG: 250, soakG: 80, fillingG: 240, coatingG: 400, decorationG: 180 },
      { diameterCm: 28, baseG: 490, soakG: 160, fillingG: 470, coatingG: 700, decorationG: 250 },
    ],
  };
  const following = (): Cake => ({ ...CAKE, diameterCm: 20, tiers: 1, ref: referenceFor(STANDARD, 20) });
  const widened = (cake: Cake): Cake => ({ ...cake, diameterCm: 28 });

  it('a cake that follows the table takes the table’s figures at its new diameter', () => {
    const before = following();
    const after = followStandard(before, widened(before), STANDARD);
    expect(after.ref).toEqual(referenceFor(STANDARD, 28));
    expect(after.ref?.baseG).toBe(490);
    expect(after.diameterCm).toBe(28);
  });

  it('a cake saved with the old single 22 cm reference follows a legacy table when its diameter changes', () => {
    const legacy = normalizeStandard({ bakery: 'x', grams: { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 }, updatedAt: '' });
    const before: Cake = { ...CAKE, diameterCm: 20, tiers: 1, ref: referenceFor(legacy, 22) };
    const after = followStandard(before, { ...before, diameterCm: 24 }, legacy);
    expect(after.ref).toEqual(referenceFor(legacy, 24));
    expect(after.ref?.diameterCm).toBe(24);
  });

  it('does not follow a cake made from scratch', () => {
    const before = { ...following(), ref: null };
    expect(followStandard(before, widened(before), STANDARD).ref).toBeNull();
  });

  it('does not follow a cake whose reference is from an older table', () => {
    const before = { ...following(), ref: { ...(referenceFor(STANDARD, 20) as ReferenceGrams), baseG: 999 } };
    const after = followStandard(before, widened(before), STANDARD);
    expect(after.ref).toEqual(before.ref);
  });

  it('changes nothing when the diameter is the same', () => {
    const before = following();
    const after = { ...before, name: 'Other' };
    expect(followStandard(before, after, STANDARD)).toBe(after);
  });

  it('changes nothing when the venue has no standard', () => {
    const before = following();
    const after = widened(before);
    expect(followStandard(before, after, null)).toBe(after);
  });
});
