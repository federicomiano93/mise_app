// The whole label chain over a corpus of recipes (parity doc items 110a and 110b).
//
// For every recipe of fixtures/label-corpus.ts, every venue (GB, IT, an unsupported country, none) and every
// value of the label's switch (allergens, nutrition, both, junk), the chain
//
//   recipeAllergens → canLabel → rowState → flattenIngredients → nutritionPer100g → buildLabel →
//   ingredientLine / containsLine / mayContainLine → declarationText (with and without the nutrition table)
//
// is run through the js/ originals AND the TypeScript ports, and the answers must be STRICTLY equal: the same
// object, key for key, the same text, character for character. Then (b) the ports' answers are compared with the
// committed golden file (fixtures/label-golden.json, written once from js/ by fixtures/make-label-golden.mjs), so
// the ports stay pinned after js/ is deleted at the switch.
//
// A behaviour spec picks the cases a person thought of; the corpus is the net under all of them at once, and the
// place a later step (labels, ZPL, print queue) adds its own field.

import { describe, expect, test } from 'vitest';
import * as market from './market';
import * as allergenPort from './recipe-allergen-model';
import * as labelPort from './recipe-label-model';
import * as templatePort from './label-template-model';
import { sheetBlockText, sheetModel } from './label-sheet';
import * as legacyMarket from '../../js/market.js';
import * as legacyAllergen from '../../js/catalogue/recipe-allergen-model.js';
import * as legacyLabel from '../../js/catalogue/recipe-label-model.js';
import * as legacyTemplate from '../../js/catalogue/label-template-model.js';
import goldenText from './fixtures/label-golden.json?raw';
import {
  LABEL_CORPUS, LOCATIONS, MADE_ON_PARTS, REQUIRED_TAGS, SHOWS_UNDER_TEST, TEMPLATE_PROFILES, UNKNOWN_INGREDIENT, runCorpus, runLabelChain,
  runTemplates, stableStringify,
} from './fixtures/label-corpus';
import type { ChainOutput, CorpusEntry, LabelChainApi } from './fixtures/label-corpus';

const portApi: LabelChainApi = {
  outputLanguage: market.outputLanguage,
  canPrintLabel: market.canPrintLabel,
  recipeAllergens: allergenPort.recipeAllergens,
  canLabel: allergenPort.canLabel,
  rowState: allergenPort.rowState,
  rowIsBlocked: allergenPort.rowIsBlocked,
  flattenIngredients: labelPort.flattenIngredients,
  nutritionPer100g: labelPort.nutritionPer100g,
  buildLabel: labelPort.buildLabel,
  ingredientLine: labelPort.ingredientLine,
  containsLine: labelPort.containsLine,
  mayContainLine: labelPort.mayContainLine,
  declarationText: labelPort.declarationText,
  // The port takes the word for an ingredient that no longer exists; the original reads the dictionary.
  blockingIngredients: (recipes: unknown, tables: allergenPort.RecipeAllergenTables) =>
    allergenPort.blockingIngredients(recipes, tables, UNKNOWN_INGREDIENT),
  unlinkedRowNames: allergenPort.unlinkedRowNames,
  resolveLabel: templatePort.resolveLabel,
  blockText: templatePort.blockText,
  useByDate: templatePort.useByDate,
  dateText: templatePort.dateText,
};

const legacyApi: LabelChainApi = {
  outputLanguage: legacyMarket.outputLanguage,
  canPrintLabel: legacyMarket.canPrintLabel,
  recipeAllergens: legacyAllergen.recipeAllergens,
  canLabel: legacyAllergen.canLabel,
  rowState: legacyAllergen.rowState,
  rowIsBlocked: legacyAllergen.rowIsBlocked,
  flattenIngredients: legacyLabel.flattenIngredients,
  nutritionPer100g: legacyLabel.nutritionPer100g,
  buildLabel: legacyLabel.buildLabel,
  ingredientLine: legacyLabel.ingredientLine,
  containsLine: legacyLabel.containsLine,
  mayContainLine: legacyLabel.mayContainLine,
  declarationText: legacyLabel.declarationText,
  blockingIngredients: (recipes: unknown, tables: unknown) =>
    (legacyAllergen.blockingIngredients as (recipes: unknown, tables: unknown) => unknown)(recipes, tables),
  unlinkedRowNames: legacyAllergen.unlinkedRowNames,
  resolveLabel: legacyTemplate.resolveLabel,
  blockText: legacyTemplate.blockText,
  useByDate: legacyTemplate.useByDate,
  dateText: legacyTemplate.dateText,
};

interface Golden {
  corpus: string[];
  unknownIngredientWord: string;
  recipes: Record<string, unknown>;
}
const golden: Golden = JSON.parse(goldenText) as Golden;

const byId = (id: string): CorpusEntry => {
  const found = LABEL_CORPUS.find(entry => entry.id === id);
  if (!found) throw new Error('no recipe called ' + id + ' in the corpus');
  return found;
};

type Venue = ChainOutput['shows'][string]['venues'][string];
const venueOf = (out: ChainOutput, shows: string, venue: string): Venue => (out.shows[shows] as ChainOutput['shows'][string]).venues[venue] as Venue;
const labelOf = (out: ChainOutput, shows: string): Record<string, any> => (out.shows[shows] as ChainOutput['shows'][string]).label as Record<string, any>;

// ── The corpus itself ────────────────────────────────────────────────────────

describe('the corpus', () => {
  test('holds at least twelve recipes, each with its own name', () => {
    expect(LABEL_CORPUS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(LABEL_CORPUS.map(entry => entry.id)).size).toBe(LABEL_CORPUS.length);
    for (const entry of LABEL_CORPUS) expect(entry.note.length, entry.id).toBeGreaterThan(20);
  });

  test('covers every scenario the parity document asks for', () => {
    const covered = new Set(LABEL_CORPUS.flatMap(entry => entry.covers));
    const missing = REQUIRED_TAGS.filter(tag => !covered.has(tag));
    expect(missing, 'a scenario nobody exercises any more').toStrictEqual([]);
  });

  test('is run for GB, IT, an unsupported country and no country, and for four values of the switch', () => {
    expect(Object.keys(LOCATIONS)).toStrictEqual(['GB', 'IT', 'FR', 'none']);
    expect([...SHOWS_UNDER_TEST]).toStrictEqual(['allergens', 'nutrition', 'both', 'nonsense']);
  });

  test('is frozen all the way down, so no function can change what the next combination reads', () => {
    for (const entry of LABEL_CORPUS) {
      expect(Object.isFrozen(entry), entry.id).toBe(true);
      expect(Object.isFrozen(entry.recipe), entry.id).toBe(true);
    }
  });
});

// ── (a) The ports against the originals ──────────────────────────────────────

describe.each(LABEL_CORPUS.map(entry => [entry.id, entry] as const))('the ports against the originals: %s', (_id, entry) => {
  const mine = runLabelChain(portApi, entry);
  const theirs = runLabelChain(legacyApi, entry);

  test('every step answers strictly the same', () => {
    expect(mine).toStrictEqual(theirs);
  });

  test('and every text, for every venue and every switch, is the same character for character', () => {
    for (const wants of SHOWS_UNDER_TEST) {
      for (const venue of Object.keys(LOCATIONS)) {
        const a = venueOf(mine, wants, venue);
        const b = venueOf(theirs, wants, venue);
        for (const field of ['lang', 'canPrint', 'containsLine', 'mayContainLine', 'declaration', 'declarationWithoutNutrition'] as const) {
          expect(a[field], `${wants} / ${venue} / ${field}`).toBe(b[field]);
        }
      }
      expect((mine.shows[wants] as { ingredientLine: unknown }).ingredientLine, wants)
        .toBe((theirs.shows[wants] as { ingredientLine: unknown }).ingredientLine);
    }
  });
});

// ── (b) The ports against the golden file ────────────────────────────────────

describe('the golden file', () => {
  test('lists exactly the recipes of the corpus, in order', () => {
    expect(golden.corpus).toStrictEqual(LABEL_CORPUS.map(entry => entry.id));
    expect(Object.keys(golden.recipes).sort()).toStrictEqual([...golden.corpus].sort());
    expect(golden.unknownIngredientWord).toBe(UNKNOWN_INGREDIENT);
  });

  const ported = runCorpus(portApi);
  const original = runCorpus(legacyApi);

  describe.each(LABEL_CORPUS.map(entry => [entry.id] as const))('%s', id => {
    test('the ports’ answer is the golden answer, byte for byte', () => {
      expect(stableStringify(ported[id])).toBe(stableStringify(golden.recipes[id]));
    });

    // ⚠️ DELETE THIS TEST AT THE SWITCH, with js/. Until then it is what stops the golden file going stale: if
    // the current app’s label chain changes, run fixtures/make-label-golden.mjs and fix the port to match.
    test('the current app’s answer is the golden answer too (so the file is not stale)', () => {
      expect(stableStringify(original[id])).toBe(stableStringify(golden.recipes[id]));
    });
  });
});

// ── The label template over the corpus (step 3d-3) ───────────────────────────

// For every recipe × the three label profiles × the four venues, at a fixed «made on» day: resolveLabel's whole
// answer and the measured text of every block. Part (a) above already demands the ports equal the originals
// on it, and part (b) the golden file; what follows pins the RULES that hold over all of it, through both.
type Template = ChainOutput['template'][string][string];
const templateOf = (out: ChainOutput, profile: string, venue: string): Template => (out.template[profile] as Record<string, Template>)[venue] as Template;
const resolvedOf = (t: Template): Record<string, any> => t.resolved as Record<string, any>;

describe.each([
  ['shared/ (TypeScript)', portApi],
  ['js/ (current app)', legacyApi],
] as const)('the label template over the corpus, through %s', (_name, api) => {
  const results = LABEL_CORPUS.map(entry => [entry, runLabelChain(api, entry)] as const);

  test('is laid out for three profiles and four venues, on a fixed day', () => {
    expect(Object.keys(TEMPLATE_PROFILES)).toStrictEqual(['default', 'zpl-57x32', 'full-102x76']);
    expect([...MADE_ON_PARTS]).toStrictEqual([2026, 8, 3, 12]);
    for (const [entry, out] of results) {
      expect(Object.keys(out.template), entry.id).toStrictEqual(Object.keys(TEMPLATE_PROFILES));
      for (const profile of Object.keys(TEMPLATE_PROFILES)) expect(Object.keys(out.template[profile] as object), entry.id).toStrictEqual(Object.keys(LOCATIONS));
    }
  });

  // ⚠️ HEALTH-CRITICAL. A recipe that cannot be labelled has no layout either, whatever the paper and the venue.
  test('a label that was refused is never laid out: nothing to draw, nothing to measure', () => {
    for (const [entry, out] of results) {
      if (labelOf(out, 'both')['ok']) continue;
      for (const profile of Object.keys(TEMPLATE_PROFILES)) {
        for (const venue of Object.keys(LOCATIONS)) {
          const t = templateOf(out, profile, venue);
          expect(t.resolved, `${entry.id} / ${profile} / ${venue}`).toStrictEqual({ ok: false, reason: 'not-ok' });
          expect(t.blockTexts, `${entry.id} / ${profile} / ${venue}`).toStrictEqual([]);
        }
      }
    }
  });

  test('⚠️⚠️ nothing is ever shortened: every ingredient of the label is in the layout, on every paper, in every venue', () => {
    for (const [entry, out] of results) {
      const built = labelOf(out, 'both');
      if (!built['ok']) continue;
      const names = built['ingredients'].map((item: { name: string }) => item.name);
      for (const profile of Object.keys(TEMPLATE_PROFILES)) {
        for (const venue of Object.keys(LOCATIONS)) {
          const resolved = resolvedOf(templateOf(out, profile, venue));
          expect(resolved['ok'], `${entry.id} / ${profile} / ${venue}`).toBe(true);
          const list = resolved['blocks'].find((block: { role: string }) => block.role === 'ingredients');
          expect(list.parts.map((part: { text: string }) => part.text), `${entry.id} / ${profile} / ${venue}`).toStrictEqual(names);
          expect(list.parts.map((part: { emphasise: boolean }) => part.emphasise), `${entry.id} / ${profile} / ${venue}`)
            .toStrictEqual(built['ingredients'].map((item: { emphasise: boolean }) => item.emphasise));
        }
      }
    }
  });

  test('⚠️ the text is never set below the legal floor, and a label that does not fit says so', () => {
    let sawNotFitting = false;
    for (const [entry, out] of results) {
      for (const profile of Object.keys(TEMPLATE_PROFILES)) {
        for (const venue of Object.keys(LOCATIONS)) {
          const resolved = resolvedOf(templateOf(out, profile, venue));
          if (!resolved['ok']) continue;
          expect(resolved['fontMm'], `${entry.id} / ${profile} / ${venue}`).toBeGreaterThanOrEqual(resolved['minFontMm']);
          if (!resolved['fits']) sawNotFitting = true;
        }
      }
    }
    expect(sawNotFitting, 'the corpus should hold at least one label that does not fit the small ZPL paper').toBe(true);
  });

  test('the emphasis follows the printer: capitals for ZPL, bold for the rest', () => {
    for (const [entry, out] of results) {
      for (const venue of Object.keys(LOCATIONS)) {
        const zpl = resolvedOf(templateOf(out, 'zpl-57x32', venue));
        const plain = resolvedOf(templateOf(out, 'default', venue));
        if (zpl['ok']) { expect(zpl['emphasis'], entry.id).toBe('caps'); expect(zpl['dpi'], entry.id).toBe(300); }
        if (plain['ok']) { expect(plain['emphasis'], entry.id).toBe('bold'); expect(plain['dpi'], entry.id).toBe(203); }
      }
    }
  });

  test('⚠️ the words on the label follow the venue’s COUNTRY: Italian for IT, English for GB, for an unsupported country and for none', () => {
    const bread = results.find(([entry]) => entry.id === 'flat-bread')?.[1] as ChainOutput;
    const prefix = (venue: string): string => resolvedOf(templateOf(bread, 'default', venue))['blocks'].find((block: { role: string }) => block.role === 'ingredients').prefix;
    expect(prefix('GB')).toBe('Ingredients: ');
    expect(prefix('IT')).toBe('Ingredienti: ');
    expect(prefix('FR')).toBe('Ingredients: ');
    expect(prefix('none')).toBe('Ingredients: ');
  });

  test('a full label: the weight and the date of the batch, in the country’s own writing, in the reading order', () => {
    const bread = results.find(([entry]) => entry.id === 'flat-bread')?.[1] as ChainOutput;
    const roles = (venue: string): string[] => resolvedOf(templateOf(bread, 'full-102x76', venue))['blocks'].map((block: { role: string }) => block.role);
    expect(roles('GB')).toStrictEqual(['name', 'ingredients', 'contains', 'netWeight', 'date', 'storage', 'business']);
    const line = (venue: string, role: string): string => resolvedOf(templateOf(bread, 'full-102x76', venue))['blocks'].find((block: { role: string }) => block.role === role).text;
    // 3 Sep 2026 + 3 days; 1200 g.
    expect(line('GB', 'date')).toBe('Best before 06/09/2026');
    expect(line('IT', 'date')).toBe('Da consumarsi preferibilmente entro il 06/09/2026');
    expect(line('GB', 'netWeight')).toBe('Net weight: 1.2 kg');
    expect(line('IT', 'netWeight')).toMatch(/: 1,2 kg$/);
    // The brioche carries its own weight and shelf life: 250 g, three days.
    const brioche = results.find(([entry]) => entry.id === 'net-weight-and-shelf-life')?.[1] as ChainOutput;
    expect(resolvedOf(templateOf(brioche, 'full-102x76', 'GB'))['blocks'].find((block: { role: string }) => block.role === 'netWeight').text).toBe('Net weight: 250 g');
  });

  test('a batch with nothing to say about its weight or date prints neither, and the default profile never prints them', () => {
    for (const id of ['map-tables']) {
      const out = results.find(([entry]) => entry.id === id)?.[1] as ChainOutput;
      const roles = resolvedOf(templateOf(out, 'full-102x76', 'GB'))['blocks'].map((block: { role: string }) => block.role);
      expect(roles, id).not.toContain('netWeight');
      expect(roles, id).not.toContain('date');
    }
    for (const [entry, out] of results) {
      const resolved = resolvedOf(templateOf(out, 'default', 'GB'));
      if (resolved['ok']) expect(resolved['blocks'].map((block: { role: string }) => block.role), entry.id).not.toEqual(expect.arrayContaining(['netWeight']));
    }
  });

  test('the layout does not depend on the nutrition switch: any value of it lays out the same', () => {
    for (const entry of LABEL_CORPUS) {
      const both = runTemplates(api, entry, 'both');
      for (const wants of ['allergens', 'nutrition', 'nonsense']) expect(runTemplates(api, entry, wants), `${entry.id} / ${wants}`).toStrictEqual(both);
    }
  });
});

// The sheet the screen draws is built from the template's answer, so it is pinned against the golden file: for
// every laid-out label, the words each sheet block draws are the words the ORIGINAL measured for that block.
describe('the sheet over the golden file', () => {
  test('every sheet block draws exactly the text the original measured, in the emphasis the printer uses', () => {
    let compared = 0;
    for (const entry of LABEL_CORPUS) {
      const recipeGolden = golden.recipes[entry.id] as ChainOutput;
      for (const profile of Object.keys(TEMPLATE_PROFILES)) {
        for (const venue of Object.keys(LOCATIONS)) {
          const t = templateOf(recipeGolden, profile, venue);
          const resolved = resolvedOf(t);
          if (!resolved['ok']) continue;
          const sheet = sheetModel(resolved as never);
          expect(sheet.blocks.map(block => sheetBlockText(block)), `${entry.id} / ${profile} / ${venue}`).toStrictEqual(t.blockTexts);
          expect(sheet.blocks.map(block => block.role)).toStrictEqual(resolved['blocks'].map((block: { role: string }) => block.role));
          expect(sheet.widthMm).toBe(resolved['widthMm']);
          expect(sheet.heightMm).toBe(resolved['heightMm']);
          expect(sheet.paddingMm).toBe(resolved['marginMm']);
          expect(sheet.fontMm).toBe(resolved['fontMm']);
          expect(sheet.blocks.at(-1)?.gapEm).toBe(0);
          compared++;
        }
      }
    }
    expect(compared, 'the corpus lays out at least a few hundred labels').toBeGreaterThan(200);
  });
});

// ── What the corpus pins about the rules ─────────────────────────────────────

describe.each([
  ['shared/ (TypeScript)', portApi],
  ['js/ (current app)', legacyApi],
] as const)('the rules the corpus pins, through %s', (_name, api) => {
  const out = (id: string): ChainOutput => runLabelChain(api, byId(id));

  // ⚠️ HEALTH-CRITICAL, over every recipe at once.
  test('complete === false ⇒ canLabel false ⇒ no label, no list, no text, whatever the venue and the switch', () => {
    for (const entry of LABEL_CORPUS) {
      const result = runLabelChain(api, entry);
      const gate = result.gate as { complete: boolean };
      expect(result.canLabel, entry.id).toBe(gate.complete === true);
      if (gate.complete) continue;
      for (const wants of SHOWS_UNDER_TEST) {
        const label = labelOf(result, wants);
        expect(label['ok'], `${entry.id} / ${wants}`).toBe(false);
        expect(label['reason'], `${entry.id} / ${wants}`).toBe('not-declared');
        expect(label['ingredients'], `${entry.id} / ${wants}: no list may be handed out`).toBeUndefined();
        expect(result.rowState, entry.id).not.toMatch(/^declared/);
        for (const venue of Object.keys(LOCATIONS)) {
          expect(venueOf(result, wants, venue).declaration, `${entry.id} / ${wants} / ${venue}`).toBe('');
          expect(venueOf(result, wants, venue).containsLine, `${entry.id} / ${wants} / ${venue}`).toBe('');
        }
      }
    }
  });

  test('an ingredient nobody checked is a gap, never «contains none» — in the shape of a missing stamp and of an empty list', () => {
    for (const id of ['unknown-ingredient', 'unknown-empty-list']) {
      const result = out(id);
      expect((result.gate as { complete: boolean }).complete, id).toBe(false);
      expect((result.gate as { gaps: { reason: string }[] }).gaps.map(gap => gap.reason), id).toStrictEqual(['not-declared']);
      expect(result.rowState, id).toBe('not-declared');
    }
  });

  test('an incomplete sub-recipe contributes NOTHING: its milk does not leak up', () => {
    const result = out('poisoned-by-sub');
    const gate = result.gate as { allergens: string[]; gaps: { reason: string }[] };
    expect(gate.gaps.map(gap => gap.reason)).toStrictEqual(['sub-incomplete']);
    expect(gate.allergens).toStrictEqual(['gluten-wheat']);
  });

  test('a cycle, a recipe nested five deep, an unlinked row, a deleted link and an empty recipe are all refused', () => {
    expect((out('cycle-self').gate as { gaps: { reason: string }[] }).gaps.map(gap => gap.reason)).toStrictEqual(['cycle']);
    expect((out('cycle-pair').gate as { complete: boolean }).complete).toBe(false);
    expect((out('depth-5').gate as { complete: boolean }).complete).toBe(false);
    expect((out('depth-4-ok').gate as { complete: boolean }).complete, 'four levels are still read').toBe(true);
    expect((out('unlinked-row').gate as { gaps: { reason: string }[] }).gaps.map(gap => gap.reason)).toStrictEqual(['not-linked']);
    expect((out('deleted-link').gate as { gaps: { reason: string }[] }).gaps.map(gap => gap.reason)).toStrictEqual(['missing-ingredient']);
    expect(out('empty-recipe').rowState, 'nothing in it is not «contains none»').toBe('nothing-yet');
  });

  // ⚠️ FINDINGS C, FIXED IN BOTH APPS (PR #354, 13 Oct 2026). A row with no weight — a pinch, «to taste» — used
  // to be missing from the ingredient list while its allergen reached «Contains». It is now listed at 0 g after
  // every weighed ingredient, by name (Reg. 1169/2011 Annex VII: under 2% in any order after the rest), and the
  // golden file was regenerated from the fixed js/ in the same commit.
  test('a weightless allergen row is IN the ingredient list, after the weighed ones, and in Contains', () => {
    const pinch = out('pinch-of-mustard');
    expect((pinch.gate as { complete: boolean }).complete).toBe(true);
    expect(labelOf(pinch, 'both')['ingredients'].map((item: { name: string }) => item.name)).toStrictEqual(['Wheat flour', 'Mustard']);
    expect(labelOf(pinch, 'both')['allergens']).toStrictEqual(['gluten-wheat', 'mustard']);
    expect((pinch.shows['both'] as { ingredientLine: string }).ingredientLine).toBe('WHEAT FLOUR, MUSTARD');
    expect(venueOf(pinch, 'both', 'GB').containsLine).toBe('Contains: Wheat, Mustard');
    expect(venueOf(pinch, 'both', 'IT').containsLine).toBe('Contiene: Grano, Senape');
    expect(venueOf(pinch, 'both', 'GB').declaration).toMatch(/^Mustard loaf\nIngredients: WHEAT FLOUR, MUSTARD\.\nContains: Wheat, Mustard\n/);

    const taste = out('to-taste-sesame');
    expect(labelOf(taste, 'both')['ingredients'].map((item: { name: string }) => item.name), 'both «to taste» rows listed, by name').toStrictEqual(['Wheat flour', 'Salt', 'Sesame seeds']);
    expect((taste.shows['both'] as { ingredientLine: string }).ingredientLine, 'the sesame emphasised in the list').toBe('WHEAT FLOUR, Salt, SESAME SEEDS');
    expect(labelOf(taste, 'both')['allergens']).toStrictEqual(['gluten-wheat', 'sesame']);

    const spice = out('sub-with-no-weight');
    expect(labelOf(spice, 'both')['allergens']).toStrictEqual(['gluten-wheat', 'mustard']);
    expect(labelOf(spice, 'both')['ingredients'].map((item: { name: string }) => item.name), 'the sub-recipe is flattened, never named').toStrictEqual(['Wheat flour', 'Mustard']);
  });

  test('the same ingredient used twice is one summed line, and it is ordered by the sum', () => {
    const twice = labelOf(out('same-ingredient-twice'), 'both')['ingredients'] as { name: string; grams: number }[];
    expect(twice.map(item => [item.name, Math.round(item.grams)])).toStrictEqual([['Butter', 800], ['Wheat flour', 700]]);
    const rows = labelOf(out('same-ingredient-two-rows'), 'both')['ingredients'] as { name: string; grams: number }[];
    expect(rows.map(item => [item.name, item.grams])).toStrictEqual([['Butter', 250], ['Wheat flour', 200]]);
  });

  test('«may contain» keeps the traces that are not already contained', () => {
    const traces = labelOf(out('may-contain'), 'both');
    expect(traces['allergens']).toStrictEqual(['milk']);
    expect(traces['mayContain']).toStrictEqual(['nuts-hazelnut']);
    expect(venueOf(out('may-contain'), 'both', 'GB').declaration).toMatch(/Contains: Milk\nMay contain: Hazelnut/);
    expect(venueOf(out('may-contain'), 'both', 'IT').declaration).toMatch(/Contiene: Latte\nPuò contenere: Nocciole/);
  });

  test('the loss of the oven raises every value per 100 g of the finished food', () => {
    const baked = out('loss-20').nutrition as { kcal: number; lossPct: number; yieldGrams: number };
    expect(baked.lossPct).toBe(20);
    expect(baked.yieldGrams).toBe(Math.round((1000 + 600 + 20) * 0.8));
    const driedYield = (out('loss-99').nutrition as { yieldGrams: number }).yieldGrams;
    expect(driedYield).toBe(20);
  });

  test('nutrition: all seven or none; zeros are values; the switch decides what is worked out', () => {
    expect(out('missing-nutrition').nutrition).toBe(null);
    expect(out('half-nutrition').nutrition).toBe(null);
    expect(labelOf(out('missing-nutrition'), 'both')['nutritionMissing']).toBe(true);
    expect(labelOf(out('missing-nutrition'), 'allergens')['nutritionMissing'], 'asked only for allergens').toBe(false);
    expect(labelOf(out('missing-nutrition'), 'allergens')['ok'], 'and the allergens are still known').toBe(true);
    const water = out('zero-nutrition-only').nutrition as Record<string, number>;
    for (const key of ['kj', 'kcal', 'fat', 'saturates', 'carbs', 'sugars', 'protein', 'salt']) expect(water[key], key).toBe(0);
    expect(labelOf(out('flat-bread'), 'allergens')['nutrition']).toBe(null);
    expect(labelOf(out('flat-bread'), 'nutrition')['nutrition']).not.toBe(null);
    expect(labelOf(out('flat-bread'), 'nonsense')['shows'], 'junk falls back to «both»').toBe('both');
    expect(labelOf(out('flat-bread'), 'nonsense')['nutrition']).toStrictEqual(labelOf(out('flat-bread'), 'both')['nutrition']);
  });

  test('a recipe with nothing weighable is complete and has nothing to print', () => {
    const result = out('only-unweighable');
    expect(result.canLabel).toBe(true);
    expect(labelOf(result, 'both')['reason']).toBe('no-ingredients');
    expect(venueOf(result, 'both', 'GB').declaration).toBe('');
  });

  test('the names are the venue’s own, whatever the language of the label', () => {
    const italianIngredients = labelOf(out('italian-venue'), 'both')['ingredients'].map((item: { name: string }) => item.name);
    expect(italianIngredients).toContain('Farina di grano tenero tipo 00');
    expect(venueOf(out('italian-venue'), 'both', 'IT').declaration).toMatch(/^Pizza bianca\nIngredienti: FARINA DI GRANO TENERO TIPO 00, Water, /);
    expect(venueOf(out('italian-venue'), 'both', 'GB').declaration).toMatch(/^Pizza bianca\nIngredients: FARINA DI GRANO TENERO TIPO 00, Water, /);
    expect(labelOf(out('unnamed-ingredient'), 'both')['ingredients'].map((item: { name: string }) => item.name)).toContain('Unnamed ingredient');
    expect(labelOf(out('short-name'), 'both')['ingredients'].map((item: { name: string }) => item.name), 'a label never prints the short name')
      .toContain('Fresh yeast 500 g block');
  });

  test('the venue decides the language of the food words: GB English, IT Italian, anything else English with no permission to print', () => {
    const bread = out('flat-bread');
    const gb = venueOf(bread, 'both', 'GB');
    const it = venueOf(bread, 'both', 'IT');
    expect([gb.lang, gb.canPrint]).toStrictEqual(['en', true]);
    expect([it.lang, it.canPrint]).toStrictEqual(['it', true]);
    expect(gb.containsLine).toBe('Contains: Wheat, Milk');
    expect(it.containsLine).toBe('Contiene: Grano, Latte');
    for (const venue of ['FR', 'none']) {
      const other = venueOf(bread, 'both', venue);
      expect([other.lang, other.canPrint], venue).toStrictEqual([null, false]);
      // Handed no language, the builders print what the app has always printed — never a blank. Mise 2's
      // declaration card and law card refuse before they get here (canPrint is false: one line, no Copy, no
      // Send). The on-screen allergen card and the sheet's rows still show names in English with no country,
      // as the current app does on purpose (the on-screen reading at the counter, nothing copied or sent).
      expect(other.containsLine, venue).toBe(gb.containsLine);
      expect(other.declaration, venue).toBe(gb.declaration);
    }
    expect(it.declaration).toMatch(/^Test bread\nIngredienti: /);
    expect(it.declaration).toMatch(/\nValori medi per 100 g:\n {2}Energia: /);
    expect(it.declaration).not.toMatch(/Contains|Ingredients|Typical values/);
  });

  test('the text without the nutrition table is the text with it, cut before «Typical values»', () => {
    for (const entry of LABEL_CORPUS) {
      const result = runLabelChain(api, entry);
      for (const wants of SHOWS_UNDER_TEST) {
        for (const venue of Object.keys(LOCATIONS)) {
          const v = venueOf(result, wants, venue);
          const full = v.declaration as string;
          const short = v.declarationWithoutNutrition as string;
          const cut = full.search(/\n(Typical values|Valori medi) /);
          expect(short, `${entry.id} / ${wants} / ${venue}`).toBe(cut === -1 ? full : full.slice(0, cut));
        }
      }
    }
  });
});
