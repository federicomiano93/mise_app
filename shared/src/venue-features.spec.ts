// Which optional panels a venue uses — run against BOTH implementations: the TypeScript port in
// shared/ and the js/ file the live app uses today. Ported from tests/venue-features.test.mjs (all four
// tests); the two must stay equal until the switch to Mise 2. Two tests are added: feedbackOn (the
// opposite direction, which the original's test file does not cover) and the key list.
//
// ⚠️⚠️ THE DIRECTION IS THE SAFETY ARGUMENT, AND THIS IS WHERE IT IS PINNED.
// allergensOn / nutritionOn read both switches as `!== false`, so a location document
// that has never heard of these keys, one that failed to load, and one carrying a
// corrupt value ALL ANSWER ON. Only the literal boolean `false` turns a panel off.
//
// Written the other way round — `=== true` — a venue would lose its allergen panels
// the moment its document was incomplete, unread or malformed, and nothing on any
// screen would say why: the section would simply not be drawn. Allergens are the one
// part of this app that can send somebody to hospital, so an accident must fail
// towards showing them. `showStock` runs the same direction; `recipePhoto` runs the
// OPPOSITE one, deliberately, because it spends money.

import { describe, expect, test } from 'vitest';
import * as ported from './venue-features';
import * as legacyJs from '../../js/venue-features.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('allergensOn: an empty document, null, and a corrupt value all answer true', () => {
    for (const doc of [{}, null, undefined, 'nonsense', 42, [], { showAllergens: 'false' },
      { showAllergens: 0 }, { showAllergens: '' }, { showAllergens: null }]) {
      expect(m.allergensOn(doc), `${JSON.stringify(doc)} must not hide allergens`).toBe(true);
    }
  });

  test('allergensOn: only an explicit false turns it off', () => {
    expect(m.allergensOn({ showAllergens: false })).toBe(false);
  });

  test('nutritionOn: an empty document, null, and a corrupt value all answer true', () => {
    for (const doc of [{}, null, undefined, 'nonsense', 42, [], { showNutrition: 'false' },
      { showNutrition: 0 }, { showNutrition: '' }, { showNutrition: null }]) {
      expect(m.nutritionOn(doc), `${JSON.stringify(doc)} must not hide nutrition`).toBe(true);
    }
  });

  test('nutritionOn: only an explicit false turns it off', () => {
    expect(m.nutritionOn({ showNutrition: false })).toBe(false);
  });

  // Added (not in tests/venue-features.test.mjs): the two switches are independent.
  test('the two switches do not move each other', () => {
    expect(m.allergensOn({ showNutrition: false })).toBe(true);
    expect(m.nutritionOn({ showAllergens: false })).toBe(true);
  });

  // Added: the opposite direction. This switch opens a WRITE path, so only a literal true counts.
  test('feedbackOn: only a literal true turns it on', () => {
    expect(m.feedbackOn({ feedbackToClaude: true })).toBe(true);
    for (const doc of [{}, null, undefined, 'nonsense', 42, [], true, { feedbackToClaude: 'true' }, { feedbackToClaude: 'yes' },
      { feedbackToClaude: 1 }, { feedbackToClaude: false }, { feedbackToClaude: null }, { feedbackToClaude: [true] }]) {
      expect(m.feedbackOn(doc), JSON.stringify(doc)).toBe(false);
    }
  });

  test('the keys the callable and the app share', () => {
    expect([...m.FEATURE_KEYS]).toStrictEqual(['showAllergens', 'showNutrition']);
    expect(Object.isFrozen(m.FEATURE_KEYS)).toBe(true);
  });
});
