import { describe, expect, test } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import { moneyLayoutOf } from '@mise/shared/market';
import {
  allergenDirty, allergenPayload, allergenStatus, allergenWorkingFrom, nutritionMissing, nutritionRefusal, proposeFromPack,
  proposedNote, tickByHand, withChecked, withNutrient, withPackText,
} from './allergenCardModel';
import type { AllergenWorking } from './allergenCardModel';

// The ingredient card's allergen sections, pure half (parity C98–C116). The rules that can put somebody in hospital are pinned
// here one by one: nothing stamps but a person; reading the pack only proposes; a box the app moves on a verified record voids
// the verification; and Mise 2's own rule — a save writes an allergen group only when that group changed.

const MONEY = moneyOf('€', null);
const ITALY = moneyOf('€', moneyLayoutOf({ country: 'IT' }));
const NOW = '2026-10-22T09:00:00.000Z';
const OLD = '2026-08-20T10:00:00.000Z';

const EMPTY_NUTRITION = { kj: null, kcal: null, fat: null, saturates: null, carbs: null, sugars: null, protein: null, salt: null };

const declared = (more: Record<string, unknown> = {}) => ({
  id: 'flour', name: 'Flour', allergens: ['gluten-wheat'], mayContain: ['soybeans'], allergensCheckedAt: OLD,
  nutrition: { ...EMPTY_NUTRITION, kcal: 340 }, packIngredients: 'Farina di grano tenero', ...more,
});
const unknownItem = (more: Record<string, unknown> = {}) => ({ id: 'cream', name: 'Cream', ...more });

// What the screen does after a pause in typing.
const type = (w: AllergenWorking, text: string) => proposeFromPack(withPackText(w, text));

describe('opening the card', () => {
  test('a declared item opens with «I have checked» ticked, its boxes, its pack text and its nutrition', () => {
    const w = allergenWorkingFrom(declared(), MONEY);
    expect(w.checked).toBe(true);
    expect(w.contains).toStrictEqual(['gluten-wheat']);
    expect(w.may).toStrictEqual(['soybeans']);
    expect(w.packText).toBe('Farina di grano tenero');
    expect(w.nutrition.kcal).toBe('340');
    expect(w.nutrition.fat).toBe('');
    expect(w.appOwned).toStrictEqual([]);
  });

  test('ticks without a stamp open UNticked: the item is «not checked yet» whatever its boxes say (C98)', () => {
    const w = allergenWorkingFrom(unknownItem({ allergens: ['milk'] }), MONEY);
    expect(w.checked).toBe(false);
    expect(w.contains).toStrictEqual(['milk']);
    expect(allergenStatus(w, unknownItem({ allergens: ['milk'] }), NOW).state).toBe('unknown');
  });

  test('0 is a real nutrient and shows as 0; a missing one shows empty (C113)', () => {
    const w = allergenWorkingFrom(unknownItem({ nutrition: { kcal: 0, salt: null } }), MONEY);
    expect(w.nutrition.kcal).toBe('0');
    expect(w.nutrition.salt).toBe('');
    expect(w.nutrition.protein).toBe('');
  });

  test('an Italian venue sees its figures with a comma, like the price boxes (T11)', () => {
    expect(allergenWorkingFrom(unknownItem({ nutrition: { salt: 1.25 } }), ITALY).nutrition.salt).toBe('1,25');
  });

  test('an unknown code and a duplicate never reach a box', () => {
    const w = allergenWorkingFrom(unknownItem({ allergens: ['gluten', 'milk', 'milk', 'eggs'] }), MONEY);
    expect(w.contains).toStrictEqual(['eggs', 'milk']);
  });
});

describe('⚠️⚠️ only a person stamps a verification (C102)', () => {
  test('opening an undeclared item and saving it writes NO declaration at all', () => {
    const item = unknownItem({ allergens: ['milk'] });
    expect(allergenPayload(allergenWorkingFrom(item, MONEY), item, 'ingredient', NOW)).toStrictEqual({});
  });

  test('opening a declared item and saving it writes nothing: the old date never moves', () => {
    const item = declared();
    expect(allergenPayload(allergenWorkingFrom(item, MONEY), item, 'ingredient', NOW)).toStrictEqual({});
  });

  test('ticking «I have checked» stamps NOW, with the boxes as shown', () => {
    const item = unknownItem({ allergens: ['milk'] });
    const w = withChecked(allergenWorkingFrom(item, MONEY), true);
    expect(allergenPayload(w, item, 'ingredient', NOW)).toStrictEqual({ allergens: ['milk'], mayContain: [], allergensCheckedAt: NOW });
    expect(allergenStatus(w, item, NOW)).toStrictEqual({ state: 'listed', date: '2026-10-22', codes: ['milk'] });
  });

  test('ticking it with no box ticked declares «contains none»', () => {
    const item = unknownItem();
    const w = withChecked(allergenWorkingFrom(item, MONEY), true);
    expect(allergenStatus(w, item, NOW).state).toBe('none');
    expect(allergenPayload(w, item, 'ingredient', NOW).allergensCheckedAt).toBe(NOW);
  });

  test('a person changing a box on a verified item keeps the old date (they are the one checking)', () => {
    const item = declared();
    const w = tickByHand(allergenWorkingFrom(item, MONEY), 'milk', 'contains', true);
    expect(allergenPayload(w, item, 'ingredient', NOW)).toStrictEqual({
      allergens: ['gluten-wheat', 'milk'], mayContain: ['soybeans'], allergensCheckedAt: OLD,
    });
  });

  test('un-ticking «I have checked» writes an empty stamp: the item goes back to «not checked yet»', () => {
    const item = declared();
    const w = withChecked(allergenWorkingFrom(item, MONEY), false);
    expect(allergenPayload(w, item, 'ingredient', NOW)).toStrictEqual({
      allergens: ['gluten-wheat'], mayContain: ['soybeans'], allergensCheckedAt: '',
    });
    expect(allergenStatus(w, item, NOW).state).toBe('unknown');
  });
});

describe('⚠️⚠️ the pack list proposes, never declares (C105–C109)', () => {
  test('typing «latte» ticks milk and stamps nothing', () => {
    const item = unknownItem();
    const w = type(allergenWorkingFrom(item, MONEY), 'latte');
    expect(w.contains).toContain('milk');
    expect(w.checked).toBe(false);
    expect(allergenPayload(w, item, 'ingredient', NOW).allergensCheckedAt).toBe('');
    expect(proposedNote(w)).toStrictEqual({ kind: 'proposed', n: 1 });
  });

  test('on a VERIFIED item a box the app moves voids the check, and the next confirmation is stamped TODAY', () => {
    const item = declared();
    const proposed = type(allergenWorkingFrom(item, MONEY), 'Farina di grano tenero, latte');
    expect(proposed.contains).toContain('milk');
    expect(proposed.checked).toBe(false);
    expect(proposed.stampVoided).toBe(true);
    expect(proposedNote(proposed)).toStrictEqual({ kind: 'proposedAfterCheck', n: 1 });
    // Saved like that, nothing is declared any more.
    expect(allergenPayload(proposed, item, 'ingredient', NOW).allergensCheckedAt).toBe('');
    // Confirmed again: today's date, never the date of a list that no longer exists.
    expect(allergenPayload(withChecked(proposed, true), item, 'ingredient', NOW).allergensCheckedAt).toBe(NOW);
  });

  test('the lapse keeps being said after the app takes its own tick back', () => {
    const item = declared();
    const proposed = type(allergenWorkingFrom(item, MONEY), 'Farina di grano tenero, latte');
    const back = type(proposed, 'Farina di grano tenero');
    expect(back.contains).not.toContain('milk');
    expect(back.checked).toBe(false);
    expect(proposedNote(back)).toStrictEqual({ kind: 'voided' });
  });

  test('clearing the text withdraws the app\'s ticks and leaves the person\'s', () => {
    const item = unknownItem({ allergens: ['eggs'] });
    const proposed = type(allergenWorkingFrom(item, MONEY), 'latte');
    expect(proposed.contains).toStrictEqual(['eggs', 'milk']);
    const cleared = type(proposed, '');
    expect(cleared.contains).toStrictEqual(['eggs']);
    expect(proposedNote(cleared)).toStrictEqual({ kind: 'none' });
  });

  test('a stored tick is the person\'s: text that no longer mentions it never takes it away', () => {
    const item = declared({ packIngredients: '' });
    const w = type(type(allergenWorkingFrom(item, MONEY), 'zucchero'), '');
    expect(w.contains).toStrictEqual(['gluten-wheat']);
    expect(w.checked).toBe(true);
    expect(w.stampVoided).toBe(false);
  });

  test('a box a person unticked is never ticked again by the text', () => {
    const item = unknownItem();
    const proposed = type(allergenWorkingFrom(item, MONEY), 'latte');
    const corrected = tickByHand(proposed, 'milk', 'contains', false);
    const retyped = type(corrected, 'latte intero');
    expect(retyped.contains).not.toContain('milk');
  });

  test('the text\'s change alone never touches the boxes: only proposeFromPack does (C107)', () => {
    const item = unknownItem({ packIngredients: 'latte' });
    const w = withPackText(allergenWorkingFrom(item, MONEY), 'latte, uova');
    expect(w.contains).toStrictEqual([]);
  });

  test('a code in «contains» is never also saved as a trace', () => {
    const item = unknownItem();
    const w = tickByHand(tickByHand(allergenWorkingFrom(item, MONEY), 'milk', 'may', true), 'milk', 'contains', true);
    const payload = allergenPayload(withChecked(w, true), item, 'ingredient', NOW);
    expect(payload.allergens).toStrictEqual(['milk']);
    expect(payload.mayContain).toStrictEqual([]);
  });
});

describe('⚠️ what a save writes (Mise 2: only the groups that changed)', () => {
  test('a NEW ingredient writes all five keys, «not checked yet» (C99)', () => {
    expect(allergenPayload(allergenWorkingFrom(null, MONEY), null, 'ingredient', NOW)).toStrictEqual({
      allergens: [], mayContain: [], allergensCheckedAt: '', nutrition: EMPTY_NUTRITION, packIngredients: '',
    });
  });

  test('packaging never writes an allergen key, new or old (C80)', () => {
    const w = withChecked(tickByHand(allergenWorkingFrom(null, MONEY), 'milk', 'contains', true), true);
    expect(allergenPayload(w, null, 'packaging', NOW)).toStrictEqual({});
    expect(allergenPayload(w, declared(), 'packaging', NOW)).toStrictEqual({});
  });

  test('only the pack text changed: only the pack text is written, never the declaration it sits beside', () => {
    const item = declared();
    const w = withPackText(allergenWorkingFrom(item, MONEY), 'Farina di grano tenero tipo 00');
    expect(allergenPayload(w, item, 'ingredient', NOW)).toStrictEqual({ packIngredients: 'Farina di grano tenero tipo 00' });
  });

  test('only a nutrient changed: only the nutrition is written', () => {
    const item = declared();
    const w = withNutrient(allergenWorkingFrom(item, MONEY), 'salt', '0,02');
    expect(allergenPayload(w, item, 'ingredient', NOW)).toStrictEqual({
      nutrition: { ...EMPTY_NUTRITION, kcal: 340, salt: 0.02 },
    });
  });

  test('a box ticked and then unticked again is no change', () => {
    const item = declared();
    const w = tickByHand(tickByHand(allergenWorkingFrom(item, MONEY), 'eggs', 'contains', true), 'eggs', 'contains', false);
    expect(allergenPayload(w, item, 'ingredient', NOW)).toStrictEqual({});
    expect(allergenDirty(w, allergenWorkingFrom(item, MONEY))).toBe(false);
  });

  test('a stored list in another order, with an unknown code, is not a change', () => {
    const item = declared({ allergens: ['milk', 'gluten', 'gluten-wheat'], mayContain: ['soybeans', 'milk'] });
    expect(allergenPayload(allergenWorkingFrom(item, MONEY), item, 'ingredient', NOW)).toStrictEqual({});
  });

  test('a stored figure above the cap is not «changed» by opening the card', () => {
    const item = declared({ nutrition: { ...EMPTY_NUTRITION, kj: 5000 } });
    expect(allergenPayload(allergenWorkingFrom(item, MONEY), item, 'ingredient', NOW)).toStrictEqual({});
  });
});

describe('nutrition (C112–C114, T11)', () => {
  const item = unknownItem();
  test('a comma reads like a dot, 0 stays 0, an empty box stays null', () => {
    let w = allergenWorkingFrom(item, MONEY);
    w = withNutrient(w, 'salt', '1,5');
    w = withNutrient(w, 'kcal', '0');
    const payload = allergenPayload(w, item, 'ingredient', NOW);
    expect(payload.nutrition).toStrictEqual({ ...EMPTY_NUTRITION, salt: 1.5, kcal: 0 });
  });

  test('the clamps stay: a figure above the cap is saved as the cap', () => {
    const w = withNutrient(allergenWorkingFrom(item, MONEY), 'kj', '5000');
    expect(allergenPayload(w, item, 'ingredient', NOW).nutrition?.kj).toBe(4000);
  });

  test('text that is not a number, or a negative figure, is refused — never dropped in silence', () => {
    const w = allergenWorkingFrom(item, MONEY);
    expect(nutritionRefusal(w)).toBeNull();
    expect(nutritionRefusal(withNutrient(w, 'fat', 'abc'))).toBe('fat');
    expect(nutritionRefusal(withNutrient(w, 'sugars', '-1'))).toBe('sugars');
    expect(nutritionRefusal(withNutrient(w, 'salt', '1.234,5'))).toBe('salt');
    // The FIRST in the card's order.
    expect(nutritionRefusal(withNutrient(withNutrient(w, 'salt', 'x'), 'kj', 'y'))).toBe('kj');
    expect(nutritionRefusal(withNutrient(w, 'protein', ' 12 '))).toBeNull();
  });

  test('the head counts the boxes still empty', () => {
    const w = allergenWorkingFrom(item, MONEY);
    expect(nutritionMissing(w)).toBe(8);
    expect(nutritionMissing(withNutrient(w, 'kcal', '0'))).toBe(7);
  });
});

describe('the dirty rule', () => {
  test('an app-made tick counts as a change; the untouched copy does not', () => {
    const base = allergenWorkingFrom(unknownItem(), MONEY);
    expect(allergenDirty(base, base)).toBe(false);
    expect(allergenDirty(type(base, 'latte'), base)).toBe(true);
    expect(allergenDirty(withNutrient(base, 'fat', '1'), base)).toBe(true);
    expect(allergenDirty(withChecked(base, true), base)).toBe(true);
  });
});
