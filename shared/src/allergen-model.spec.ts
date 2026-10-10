// The allergen and nutrition data an ingredient carries — run against BOTH implementations:
// the TypeScript port in shared/ and the js/ file the live app uses today. Ported from
// tests/allergen-model.test.mjs; the two must stay equal until the switch to Mise 2.
//
// ⚠️ THESE ARE THE HIGHEST-STAKES TESTS IN THE PROJECT. Everything else this app
// does gets money, doses or times wrong; this gets somebody hospitalised. Federico
// cannot read code, so these are the safety net (P15) — and the one that matters
// most is marked where it sits: an ingredient nobody has checked must NEVER read
// as allergen-free.

import { describe, expect, test } from 'vitest';
import * as ported from './allergen-model';
import * as legacyJs from '../../js/allergen-model.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── THE ONE THAT MATTERS MOST ────────────────────────────────────────────────

  test('AN INGREDIENT NOBODY HAS CHECKED IS NEVER "ALLERGEN-FREE"', () => {
    // The fatal ambiguity: an empty list looks identical whether it means "checked,
    // contains none" or "nobody has said anything". Only the stamp tells them apart,
    // and everything that builds a label asks isDeclared() before trusting a list.
    const untouched = { name: 'Flour' };
    expect(m.allergenState(untouched)).toBe('unknown');
    expect(m.isDeclared(untouched)).toBe(false);

    const emptyListNoStamp = { name: 'Flour', allergens: [] };
    expect(m.allergenState(emptyListNoStamp),
      'an empty list with no stamp must NOT read as "contains none"').toBe('unknown');
    expect(m.isDeclared(emptyListNoStamp)).toBe(false);

    const checkedContainsNone = { name: 'Water', allergens: [], allergensCheckedAt: '2026-08-11' };
    expect(m.allergenState(checkedContainsNone)).toBe('none');
    expect(m.isDeclared(checkedContainsNone)).toBe(true);
  });

  test('a checked ingredient that contains something reads as listed', () => {
    const flour = { allergens: ['gluten-wheat'], allergensCheckedAt: '2026-08-11' };
    expect(m.allergenState(flour)).toBe('listed');
    expect(m.isDeclared(flour)).toBe(true);
  });

  test('a blank or junk stamp is not a check', () => {
    for (const stamp of ['', '   ', null, undefined]) {
      expect(m.allergenState({ allergens: ['milk'], allergensCheckedAt: stamp }),
        `a stamp of ${JSON.stringify(stamp)} was accepted as a check`).toBe('unknown');
    }
    expect(m.allergenState(null)).toBe('unknown');
    expect(m.allergenState('nope')).toBe('unknown');
  });

  test('the three states are a closed list', () => {
    expect([...m.ALLERGEN_STATES]).toStrictEqual(['unknown', 'none', 'listed']);
  });

  // ── The 14, named as the law requires ────────────────────────────────────────

  test('the specific cereal and the specific nut are named, not the category', () => {
    // "Contains nuts" is not compliant, and is useless to somebody who can eat
    // almonds but not hazelnuts. There must be no bare 'gluten' or 'nuts' code.
    expect(m.isAllergenCode('gluten')).toBe(false);
    expect(m.isAllergenCode('nuts')).toBe(false);
    expect(m.isAllergenCode('gluten-wheat')).toBe(true);
    expect(m.isAllergenCode('nuts-hazelnut')).toBe(true);
    expect(m.allergenLabel('gluten-wheat')).toBe('Wheat');
    expect(m.allergenLabel('nuts-hazelnut')).toBe('Hazelnut');
  });

  test('all 14 regulated groups are present, none missing', () => {
    // The list a UK food business must declare. A group missing here is a group
    // that can never be ticked, and therefore never appears on a label.
    const expected = [
      'gluten', 'nuts', 'celery', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk',
      'molluscs', 'mustard', 'peanuts', 'sesame', 'soybeans', 'sulphites',
    ].sort();
    expect([...m.ALLERGEN_GROUPS].sort()).toStrictEqual(expected);
    expect(m.ALLERGEN_GROUPS.length).toBe(14);
  });

  test('peanuts are their own group, separate from tree nuts', () => {
    // A legal and a medical distinction: peanuts are a legume, and somebody
    // allergic to peanuts is not necessarily allergic to almonds. Filing them
    // under "nuts" would be wrong in both directions.
    const entries: readonly { code: string; group: string; label: string }[] = m.ALLERGENS;
    const peanut = entries.find(a => a.code === 'peanuts');
    expect(peanut?.group).toBe('peanuts');
    expect(entries.some(a => a.group === 'nuts' && a.code === 'peanuts')).toBe(false);
  });

  test('every entry has a code, a group and a printable label', () => {
    for (const a of m.ALLERGENS) {
      expect(a.code && a.group && a.label, `incomplete entry: ${JSON.stringify(a)}`).toBeTruthy();
    }
    expect(new Set(m.ALLERGEN_CODES).size, 'a code is duplicated').toBe(m.ALLERGEN_CODES.length);
  });

  // ── Normalising ──────────────────────────────────────────────────────────────

  test('an unknown code is DROPPED, never passed through', () => {
    // Anything reaching a label has to be printable. An unknown code would show as
    // a blank or as raw text on a legal declaration; dropping it cannot invent an
    // allergen, which is the only direction that matters.
    expect(m.normalizeAllergens(['milk', 'unicorn', 'gluten-wheat'])).toStrictEqual(['gluten-wheat', 'milk']);
    expect(m.normalizeAllergens(['nonsense'])).toStrictEqual([]);
  });

  test('the same allergen ticked twice is listed once', () => {
    expect(m.normalizeAllergens(['milk', 'milk', ' milk '])).toStrictEqual(['milk']);
  });

  test('the order is canonical, so two identical ingredients produce identical lists', () => {
    // Which is what lets a label be compared with the one printed last month.
    const a = m.normalizeAllergens(['milk', 'eggs', 'gluten-wheat']);
    const b = m.normalizeAllergens(['gluten-wheat', 'milk', 'eggs']);
    expect(a).toStrictEqual(b);
    expect(a).toStrictEqual(['gluten-wheat', 'eggs', 'milk']);
  });

  test('junk never throws and never invents an allergen', () => {
    for (const bad of [null, undefined, 'milk', 42, {}, [null], [{}]]) {
      expect(m.normalizeAllergens(bad), `${JSON.stringify(bad)} produced something`).toStrictEqual([]);
    }
  });

  // ── "May contain" stays a separate fact ──────────────────────────────────────

  test('"may contain" is never merged into "contains"', () => {
    // Two different statements with two different consequences. Merging them would
    // make every product near a nut declare nuts outright, which is how a label
    // stops being read at all.
    const fields = m.buildAllergenFields({
      allergens: ['milk'], mayContain: ['nuts-hazelnut'], checkedAt: '2026-08-11',
    });
    expect(fields.allergens).toStrictEqual(['milk']);
    expect(fields.mayContain).toStrictEqual(['nuts-hazelnut']);
  });

  test('"may contain X" is dropped when the thing already CONTAINS X', () => {
    // It is already declared, more strongly, one line above — printing both is
    // noise on a label that has very little room.
    const fields = m.buildAllergenFields({
      allergens: ['milk'], mayContain: ['milk', 'sesame'], checkedAt: '2026-08-11',
    });
    expect(fields.mayContain).toStrictEqual(['sesame']);
  });

  test('normalizeMayContain refuses unknown codes too', () => {
    expect(m.normalizeMayContain(['sesame', 'unicorn'])).toStrictEqual(['sesame']);
  });

  // ── Nutrition ────────────────────────────────────────────────────────────────

  test('ZERO IS A REAL VALUE AND null IS NOT', () => {
    // Water really is 0 kcal. Treating that as missing would make water block every
    // label it appears in; treating missing as 0 would under-declare everything.
    const n = m.normalizeNutrition({ kj: 0, kcal: 0, fat: 0, saturates: 0, carbs: 0, sugars: 0, protein: 0, salt: 0 });
    for (const key of m.NUTRIENT_KEYS) expect(n[key], `${key} was not kept as 0`).toBe(0);
    expect(m.hasFullNutrition({ nutrition: n }), 'an all-zero table is COMPLETE').toBe(true);
  });

  test('a missing or unreadable value stays null, never 0', () => {
    const n = m.normalizeNutrition({ kcal: 250, fat: '', carbs: null, sugars: 'abc', protein: -5 });
    expect(n.kcal).toBe(250);
    expect(n.fat).toBe(null);
    expect(n.carbs).toBe(null);
    expect(n.sugars, 'text must not become 0').toBe(null);
    expect(n.protein, 'a negative must not become 0').toBe(null);
    expect(n.kj).toBe(null);
  });

  test('a decimal point survives — 0.01 g of salt is a real declaration', () => {
    expect(m.normalizeNutrition({ salt: 0.01 }).salt).toBe(0.01);
    expect(m.normalizeNutrition({ salt: '1.2' }).salt).toBe(1.2);
  });

  test('an absurd value is capped rather than printed', () => {
    // Nothing can be more than 100 g per 100 g, and pure fat is about 900 kcal.
    expect(m.normalizeNutrition({ fat: 500 }).fat).toBe(100);
    expect(m.normalizeNutrition({ kcal: 99999 }).kcal).toBe(1000);
    expect(m.normalizeNutrition({ kj: 99999 }).kj).toBe(4000);
  });

  test('a table is complete only when ALL SEVEN are there', () => {
    // The declaration is defined as a whole; there is no "mostly filled in".
    const full = { kj: 1400, kcal: 330, fat: 1.2, saturates: 0.2, carbs: 70, sugars: 1.5, protein: 11, salt: 0.01 };
    expect(m.hasFullNutrition({ nutrition: full })).toBe(true);
    for (const key of m.NUTRIENT_KEYS) {
      const short = { ...full, [key]: null };
      expect(m.hasFullNutrition({ nutrition: short }), `missing ${key} still read as complete`).toBe(false);
      expect(m.missingNutrients({ nutrition: short })).toStrictEqual([key]);
    }
    expect(m.hasFullNutrition({})).toBe(false);
    expect(m.hasFullNutrition(null)).toBe(false);
  });

  test('the declaration carries SALT, not sodium, and BOTH energy units', () => {
    // Salt and sodium differ by a factor of 2.5 — printing one in the other's row
    // understates it badly. Both kJ and kcal are mandatory.
    const keys: string[] = m.NUTRIENTS.map(n => n.key);
    expect(keys.includes('salt')).toBeTruthy();
    expect(keys.includes('sodium')).toBe(false);
    expect(keys.includes('kj') && keys.includes('kcal')).toBeTruthy();
  });

  test('the nutrients are in the order a declaration must print them', () => {
    expect([...m.NUTRIENT_KEYS]).toStrictEqual(
      ['kj', 'kcal', 'fat', 'saturates', 'carbs', 'sugars', 'protein', 'salt']);
  });

  // ── The document the app writes ──────────────────────────────────────────────

  test('the fields written are exactly the ones the rules whitelist', () => {
    // ⚠️ A field invented here that the rules do not know makes every save of that
    // ingredient FAIL; a field the rules allow that this forgets is dropped in
    // silence on the next save. This pins the set in one place.
    const fields = m.buildAllergenFields({
      allergens: ['gluten-wheat'], mayContain: [], checkedAt: '2026-08-11', nutrition: { kcal: 330 },
    });
    expect(Object.keys(fields).sort()).toStrictEqual(
      ['allergens', 'allergensCheckedAt', 'mayContain', 'nutrition', 'packIngredients']);
    expect(Object.keys(fields.nutrition).sort()).toStrictEqual([...m.NUTRIENT_KEYS].sort());
  });

  // ── The pack's own ingredient list ───────────────────────────────────────────

  test('the pack text is carried through, and capped where the rules cap it', () => {
    const out = m.buildAllergenFields({
      allergens: [], mayContain: [], checkedAt: '', nutrition: {},
      packIngredients: 'Farina di GRANO tenero, acqua.',
    });
    expect(out.packIngredients).toBe('Farina di GRANO tenero, acqua.');
    // ⚠️ 4000, THE SAME NUMBER THE RULES USE. A longer string is refused by the
    // rules — and the rules refuse the WHOLE document, so a paste from a PDF would
    // make the ingredient unsaveable with nothing on screen explaining why.
    const long = m.buildAllergenFields({
      allergens: [], mayContain: [], checkedAt: '', nutrition: {},
      packIngredients: 'x'.repeat(5000),
    });
    expect(long.packIngredients.length).toBe(4000);
  });

  test('no pack text is an empty string, never undefined', () => {
    for (const nothing of [undefined, null, '']) {
      const out = m.buildAllergenFields({
        allergens: [], mayContain: [], checkedAt: '', nutrition: {}, packIngredients: nothing,
      });
      expect(out.packIngredients, String(nothing)).toBe('');
    }
  });

  // ⚠️⚠️ READING A PACK MUST NEVER STAMP. The suggestion is inert by construction:
  // ticks with no verification stamp still read 'unknown', so an ingredient the app
  // filled in and nobody confirmed still blocks every label it appears in.
  test('⚠️ pack text plus ticks, with no stamp, is still UNKNOWN', () => {
    const out = m.buildAllergenFields({
      allergens: ['milk', 'gluten-wheat'], mayContain: [], checkedAt: '', nutrition: {},
      packIngredients: 'Farina di GRANO, LATTE',
    });
    expect(out.allergens).toStrictEqual(['gluten-wheat', 'milk']);
    expect(out.allergensCheckedAt).toBe('');
    expect(m.allergenState(out), 'a machine guess must never read as a declaration').toBe('unknown');
  });

  test('building from nothing gives blanks, never undefined', () => {
    // Firestore refuses undefined, and a half-built object would be refused by the
    // rules rather than saved — loudly, but at the worst moment.
    const fields = m.buildAllergenFields({});
    expect(fields.allergens).toStrictEqual([]);
    expect(fields.mayContain).toStrictEqual([]);
    expect(fields.allergensCheckedAt).toBe('');
    for (const key of m.NUTRIENT_KEYS) expect(fields.nutrition[key]).toBe(null);
    // …and a document built from nothing is NOT declared.
    expect(m.isDeclared(fields)).toBe(false);
  });

  test('checkedAt is read back as trimmed text', () => {
    expect(m.checkedAt({ allergensCheckedAt: '  2026-08-11T09:00:00.000Z  ' })).toBe('2026-08-11T09:00:00.000Z');
    expect(m.checkedAt({})).toBe('');
    expect(m.checkedAt(null)).toBe('');
  });
});
