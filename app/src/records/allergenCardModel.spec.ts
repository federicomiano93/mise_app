import { describe, expect, test } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import { moneyLayoutOf } from '@mise/shared/market';
import {
  allergenDirty, allergenPayload, allergenStatus, allergenWorkingFrom, nutritionMissing, nutritionRefusal, proposeFromPack,
  proposedNote, RECENT_APP_TICK_MS, tickByHand, withChecked, withNutrient, withPackText,
} from './allergenCardModel';
import type { AllergenWorking } from './allergenCardModel';

// The ingredient card's allergen sections, pure half (parity C98–C116). The rules that can put somebody in hospital are pinned
// here one by one: nothing stamps but a person; reading the pack only proposes; a box the app moves on a verified record voids
// the verification; and Mise 2's own rule — a save writes an allergen group only when that group changed.

const MONEY = moneyOf('€', null);
const ITALY = moneyOf('€', moneyLayoutOf({ country: 'IT' }));
const NOW = '2026-10-22T09:00:00.000Z';
const OLD = '2026-08-20T10:00:00.000Z';
const BOTH = { allergens: true, nutrition: true };

const EMPTY_NUTRITION = { kj: null, kcal: null, fat: null, saturates: null, carbs: null, sugars: null, protein: null, salt: null };

const declared = (more: Record<string, unknown> = {}) => ({
  id: 'flour', name: 'Flour', allergens: ['gluten-wheat'], mayContain: ['soybeans'], allergensCheckedAt: OLD,
  nutrition: { ...EMPTY_NUTRITION, kcal: 340 }, packIngredients: 'Farina di grano tenero', ...more,
});
const unknownItem = (more: Record<string, unknown> = {}) => ({ id: 'cream', name: 'Cream', ...more });

// What the screen does after a pause in typing.
const type = (w: AllergenWorking, text: string) => proposeFromPack(withPackText(w, text), 0);

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
    expect(allergenPayload(allergenWorkingFrom(item, MONEY), item, 'ingredient', NOW, BOTH)).toStrictEqual({});
  });

  test('opening a declared item and saving it writes nothing: the old date never moves', () => {
    const item = declared();
    expect(allergenPayload(allergenWorkingFrom(item, MONEY), item, 'ingredient', NOW, BOTH)).toStrictEqual({});
  });

  test('ticking «I have checked» stamps NOW, with the boxes as shown', () => {
    const item = unknownItem({ allergens: ['milk'] });
    const w = withChecked(allergenWorkingFrom(item, MONEY), true);
    expect(allergenPayload(w, item, 'ingredient', NOW, BOTH)).toStrictEqual({ allergens: ['milk'], mayContain: [], allergensCheckedAt: NOW });
    expect(allergenStatus(w, item, NOW)).toStrictEqual({ state: 'listed', date: '2026-10-22', codes: ['milk'] });
  });

  test('ticking it with no box ticked declares «contains none»', () => {
    const item = unknownItem();
    const w = withChecked(allergenWorkingFrom(item, MONEY), true);
    expect(allergenStatus(w, item, NOW).state).toBe('none');
    expect(allergenPayload(w, item, 'ingredient', NOW, BOTH).allergensCheckedAt).toBe(NOW);
  });

  test('a person changing a box on a verified item keeps the old date (they are the one checking)', () => {
    const item = declared();
    const w = tickByHand(allergenWorkingFrom(item, MONEY), 'milk', 'contains', true, 0);
    expect(allergenPayload(w, item, 'ingredient', NOW, BOTH)).toStrictEqual({
      allergens: ['gluten-wheat', 'milk'], mayContain: ['soybeans'], allergensCheckedAt: OLD,
    });
  });

  test('un-ticking «I have checked» writes an empty stamp: the item goes back to «not checked yet»', () => {
    const item = declared();
    const w = withChecked(allergenWorkingFrom(item, MONEY), false);
    expect(allergenPayload(w, item, 'ingredient', NOW, BOTH)).toStrictEqual({
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
    expect(allergenPayload(w, item, 'ingredient', NOW, BOTH).allergensCheckedAt).toBe('');
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
    expect(allergenPayload(proposed, item, 'ingredient', NOW, BOTH).allergensCheckedAt).toBe('');
    // Confirmed again: today's date, never the date of a list that no longer exists.
    expect(allergenPayload(withChecked(proposed, true), item, 'ingredient', NOW, BOTH).allergensCheckedAt).toBe(NOW);
  });

  test('⚠️ un-tick «I have checked», let the app move a box, tick it again: the save stamps NOW, not the old date', () => {
    const item = declared();
    const opened = allergenWorkingFrom(item, MONEY);
    expect(opened.openedStamp).toBe(OLD);
    const unticked = withChecked(opened, false);
    const moved = type(unticked, 'Farina di grano tenero, latte');
    expect(moved.stampVoided).toBe(true);
    expect(allergenPayload(withChecked(moved, true), item, 'ingredient', NOW, BOTH).allergensCheckedAt).toBe(NOW);
    // Without the app moving anything, un-ticking and re-ticking keeps the date (the person alone is checking).
    expect(allergenStatus(withChecked(unticked, true), item, NOW).date).toBe(OLD.slice(0, 10));
    // A new or never-stamped item has no date to void.
    expect(allergenWorkingFrom(null, MONEY).openedStamp).toBe('');
    expect(type(allergenWorkingFrom(unknownItem(), MONEY), 'latte').stampVoided).toBe(false);
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
    const corrected = tickByHand(proposed, 'milk', 'contains', false, RECENT_APP_TICK_MS);
    const retyped = type(corrected, 'latte intero');
    expect(retyped.contains).not.toContain('milk');
  });

  describe('a tap that lands just as the app ticks the same box (R1, the safe direction only)', () => {
    const T = 1000;
    const proposedAt = (text: string) => proposeFromPack(withPackText(allergenWorkingFrom(unknownItem(), MONEY), text), T);

    test('an untick 799 ms after the app ticked keeps the box ticked and makes it the person\'s', () => {
      const w = tickByHand(proposedAt('latte'), 'milk', 'contains', false, T + RECENT_APP_TICK_MS - 1);
      expect(w.contains).toContain('milk');
      expect(w.appOwned).not.toContain('contains:milk');
      expect(w.humanTouched).toHaveLength(1);
      expect(proposedNote(w).kind).toBe('none');
      // Theirs now: a later tap unticks it at once, and the text never ticks it back.
      const later = tickByHand(w, 'milk', 'contains', false, T + 5000);
      expect(later.contains).not.toContain('milk');
      expect(proposeFromPack(withPackText(later, 'latte e latte'), T + 6000).contains).not.toContain('milk');
    });

    test('a tick the app already owned keeps its first time when the text is read again; a withdrawn one starts afresh', () => {
      const first = proposedAt('latte');
      // Read again 5 s later (more typing): milk is still the app's, still stamped at T — so an untick now is the person's at once.
      const again = proposeFromPack(withPackText(first, 'latte e uova'), T + 5000);
      expect(again.appTickedAt['contains:milk']).toBe(T);
      expect(again.appTickedAt['contains:eggs']).toBe(T + 5000);
      expect(tickByHand(again, 'milk', 'contains', false, T + 5100).contains).not.toContain('milk');
      // Withdrawn (text emptied) then proposed again: a fresh stamp.
      const gone = proposeFromPack(withPackText(again, ''), T + 6000);
      expect(gone.appTickedAt['contains:milk']).toBeUndefined();
      expect(proposeFromPack(withPackText(gone, 'latte'), T + 7000).appTickedAt['contains:milk']).toBe(T + 7000);
    });

    test('an untick 800 ms after the app ticked unticks it', () => {
      const w = tickByHand(proposedAt('latte'), 'milk', 'contains', false, T + RECENT_APP_TICK_MS);
      expect(w.contains).not.toContain('milk');
      expect(w.humanTouched).toHaveLength(1);
    });

    test('a tick ON is unaffected, whenever it lands', () => {
      const w = tickByHand(proposedAt('latte'), 'eggs', 'contains', true, T + 1);
      expect(w.contains).toStrictEqual(['eggs', 'milk']);
    });

    test('a box the person ticked themselves unticks at once', () => {
      const ticked = tickByHand(allergenWorkingFrom(unknownItem(), MONEY), 'milk', 'contains', true, T);
      expect(tickByHand(ticked, 'milk', 'contains', false, T + 1).contains).not.toContain('milk');
    });

    test('the traces column follows the same rule', () => {
      const w = proposedAt('può contenere tracce di latte');
      expect(w.may).toContain('milk');
      expect(tickByHand(w, 'milk', 'may', false, T + 799).may).toContain('milk');
      expect(tickByHand(w, 'milk', 'may', false, T + 800).may).not.toContain('milk');
    });

    test('the time the app ticked is not a change: allergenDirty ignores it', () => {
      const base = allergenWorkingFrom(unknownItem(), MONEY);
      expect(allergenDirty({ ...base, appTickedAt: { 'contains:milk': 5 } }, base)).toBe(false);
    });
  });

  test('the text\'s change alone never touches the boxes: only proposeFromPack does (C107)', () => {
    const item = unknownItem({ packIngredients: 'latte' });
    const w = withPackText(allergenWorkingFrom(item, MONEY), 'latte, uova');
    expect(w.contains).toStrictEqual([]);
  });

  test('a code in «contains» is never also saved as a trace', () => {
    const item = unknownItem();
    const w = tickByHand(tickByHand(allergenWorkingFrom(item, MONEY), 'milk', 'may', true, 0), 'milk', 'contains', true, 0);
    const payload = allergenPayload(withChecked(w, true), item, 'ingredient', NOW, BOTH);
    expect(payload.allergens).toStrictEqual(['milk']);
    expect(payload.mayContain).toStrictEqual([]);
  });
});

describe('⚠️ what a save writes (Mise 2: only the groups that changed)', () => {
  test('a NEW ingredient writes all five keys, «not checked yet» (C99)', () => {
    expect(allergenPayload(allergenWorkingFrom(null, MONEY), null, 'ingredient', NOW, BOTH)).toStrictEqual({
      allergens: [], mayContain: [], allergensCheckedAt: '', nutrition: EMPTY_NUTRITION, packIngredients: '',
    });
  });

  test('packaging never writes an allergen key, new or old (C80)', () => {
    const w = withChecked(tickByHand(allergenWorkingFrom(null, MONEY), 'milk', 'contains', true, 0), true);
    expect(allergenPayload(w, null, 'packaging', NOW, BOTH)).toStrictEqual({});
    expect(allergenPayload(w, declared(), 'packaging', NOW, BOTH)).toStrictEqual({});
  });

  test('only the pack text changed: only the pack text is written, never the declaration it sits beside', () => {
    const item = declared();
    const w = withPackText(allergenWorkingFrom(item, MONEY), 'Farina di grano tenero tipo 00');
    expect(allergenPayload(w, item, 'ingredient', NOW, BOTH)).toStrictEqual({ packIngredients: 'Farina di grano tenero tipo 00' });
  });

  test('only a nutrient changed: only the nutrition is written', () => {
    const item = declared();
    const w = withNutrient(allergenWorkingFrom(item, MONEY), 'salt', '0,02');
    expect(allergenPayload(w, item, 'ingredient', NOW, BOTH)).toStrictEqual({
      nutrition: { ...EMPTY_NUTRITION, kcal: 340, salt: 0.02 },
    });
  });

  test('a box ticked and then unticked again is no change', () => {
    const item = declared();
    const w = tickByHand(tickByHand(allergenWorkingFrom(item, MONEY), 'eggs', 'contains', true, 0), 'eggs', 'contains', false, 0);
    expect(allergenPayload(w, item, 'ingredient', NOW, BOTH)).toStrictEqual({});
    expect(allergenDirty(w, allergenWorkingFrom(item, MONEY))).toBe(false);
  });

  test('⚠️ a hidden panel is never written for an existing item, however much its copy differs; a shown one still is', () => {
    const item = declared();
    let w = allergenWorkingFrom(item, MONEY);
    w = withNutrient(w, 'salt', '0,02');
    w = withPackText(tickByHand(w, 'eggs', 'contains', true, 0), 'Farina e uova');
    expect(Object.keys(allergenPayload(w, item, 'ingredient', NOW, BOTH)).sort())
      .toStrictEqual(['allergens', 'allergensCheckedAt', 'mayContain', 'nutrition', 'packIngredients']);
    expect(Object.keys(allergenPayload(w, item, 'ingredient', NOW, { allergens: false, nutrition: true })).sort())
      .toStrictEqual(['nutrition']);
    expect(Object.keys(allergenPayload(w, item, 'ingredient', NOW, { allergens: true, nutrition: false })).sort())
      .toStrictEqual(['allergens', 'allergensCheckedAt', 'mayContain', 'packIngredients']);
    expect(allergenPayload(w, item, 'ingredient', NOW, { allergens: false, nutrition: false })).toStrictEqual({});
  });

  test('a NEW ingredient writes all five even when both panels are hidden (C99)', () => {
    expect(allergenPayload(allergenWorkingFrom(null, MONEY), null, 'ingredient', NOW, { allergens: false, nutrition: false }))
      .toStrictEqual({ allergens: [], mayContain: [], allergensCheckedAt: '', nutrition: EMPTY_NUTRITION, packIngredients: '' });
  });

  test('a stored list in another order, with an unknown code, is not a change', () => {
    const item = declared({ allergens: ['milk', 'gluten', 'gluten-wheat'], mayContain: ['soybeans', 'milk'] });
    expect(allergenPayload(allergenWorkingFrom(item, MONEY), item, 'ingredient', NOW, BOTH)).toStrictEqual({});
  });

  test('a stored figure above the cap is not «changed» by opening the card', () => {
    const item = declared({ nutrition: { ...EMPTY_NUTRITION, kj: 5000 } });
    expect(allergenPayload(allergenWorkingFrom(item, MONEY), item, 'ingredient', NOW, BOTH)).toStrictEqual({});
  });
});

describe('nutrition (C112–C114, T11)', () => {
  const item = unknownItem();
  test('a comma reads like a dot, 0 stays 0, an empty box stays null', () => {
    let w = allergenWorkingFrom(item, MONEY);
    w = withNutrient(w, 'salt', '1,5');
    w = withNutrient(w, 'kcal', '0');
    const payload = allergenPayload(w, item, 'ingredient', NOW, BOTH);
    expect(payload.nutrition).toStrictEqual({ ...EMPTY_NUTRITION, salt: 1.5, kcal: 0 });
  });

  test('the clamps stay: a figure above the cap is saved as the cap', () => {
    const w = withNutrient(allergenWorkingFrom(item, MONEY), 'kj', '5000');
    expect(allergenPayload(w, item, 'ingredient', NOW, BOTH).nutrition?.kj).toBe(4000);
  });

  test('text that is not a number, or a negative figure, is refused — never dropped in silence', () => {
    const w = allergenWorkingFrom(item, MONEY);
    const refusal = (next: AllergenWorking) => nutritionRefusal(next, w);
    expect(refusal(w)).toBeNull();
    expect(refusal(withNutrient(w, 'fat', 'abc'))).toStrictEqual({ key: 'fat', reason: 'invalid' });
    expect(refusal(withNutrient(w, 'sugars', '-1'))).toStrictEqual({ key: 'sugars', reason: 'invalid' });
    expect(refusal(withNutrient(w, 'salt', '1.234,5'))).toStrictEqual({ key: 'salt', reason: 'invalid' });
    // The FIRST in the card's order.
    expect(refusal(withNutrient(withNutrient(w, 'salt', 'x'), 'kj', 'y'))).toStrictEqual({ key: 'kj', reason: 'invalid' });
    expect(refusal(withNutrient(w, 'protein', ' 12 '))).toBeNull();
  });

  test('⚠️ Number() would read «0x10», «1e3» and «Infinity» as figures: only digits with one decimal mark are', () => {
    const w = allergenWorkingFrom(item, MONEY);
    for (const bad of ['0x10', '1e3', 'Infinity', '12abc', '1.2.3', '+5']) {
      expect(nutritionRefusal(withNutrient(w, 'fat', bad), w), bad).toStrictEqual({ key: 'fat', reason: 'invalid' });
    }
    for (const good of ['0', '0,0', '12,5', ' 12.5 ', '.5', '7']) {
      expect(nutritionRefusal(withNutrient(w, 'fat', good), w), good).toBeNull();
    }
  });

  test('⚠️ a thousands separator in kJ or kcal is refused with its own reason; other readings pass', () => {
    const w = allergenWorkingFrom(item, MONEY);
    for (const key of ['kj', 'kcal'] as const) {
      expect(nutritionRefusal(withNutrient(w, key, '1,550'), w)).toStrictEqual({ key, reason: 'thousands' });
      expect(nutritionRefusal(withNutrient(w, key, ' 1.550 '), w)).toStrictEqual({ key, reason: 'thousands' });
      for (const fine of ['1550', '1,5', '12,25', '340', '0,125', '0.125']) expect(nutritionRefusal(withNutrient(w, key, fine), w), fine).toBeNull();
    }
    // The other six boxes have no such rule: «1,550 g of fat» is 1.55.
    expect(nutritionRefusal(withNutrient(w, 'fat', '1,550'), w)).toBeNull();
  });

  test('⚠️ only the boxes somebody changed are checked: a stored value the card opened with never blocks Save', () => {
    const stored = unknownItem({ nutrition: { fat: -3 } });
    const opened = allergenWorkingFrom(stored, MONEY);
    expect(opened.nutrition.fat).toBe('-3');
    expect(nutritionRefusal(opened, opened)).toBeNull();
    expect(nutritionRefusal(withNutrient(opened, 'salt', '1'), opened)).toBeNull();
    // Touching that very box brings the check back.
    expect(nutritionRefusal(withNutrient(opened, 'fat', '-4'), opened)).toStrictEqual({ key: 'fat', reason: 'invalid' });
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
