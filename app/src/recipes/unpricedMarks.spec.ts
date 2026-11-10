import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// The isolation guard behind the crossed-out euro, mirroring tests/catalogue-no-money.test.mjs of the current app.
//
// Federico, 13 Sep 2026: the recipe catalogue shows no cost (it would not be the real one). 28 Oct 2026, partly reversing that: the
// editor marks a row Food cost cannot price with a crossed-out euro — no words, no amount; prices read only while the editor is open,
// only for somebody who may read Food cost, never stored. A price creeping back onto a catalogue screen would look like a working
// feature, so it is the ABSENCE that is pinned here. shared/src/unpriced-rows.ts is the one place the catalogue meets the cost model.

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, file), 'utf8');

// Comments stripped first, so a guard never fires on its own warning comment.
function codeOf(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => { const at = line.indexOf('//'); return at === -1 ? line : line.slice(0, at); })
    .join('\n');
}

const SOURCES = readdirSync(HERE).filter(name => /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name));

describe('the recipe catalogue touches no money', () => {
  test('there are recipe sources to check', () => {
    expect(SOURCES.length).toBeGreaterThan(30);
  });

  test('⚠️ no recipes file computes or formats money, or imports a cost model (unpriced-rows is the only door)', () => {
    for (const file of SOURCES) {
      const code = codeOf(read(file));
      expect(code, `${file} works with money again`)
        .not.toMatch(/\b(formatMoney|formatRate|pricePerKg|costRecipe|partialCostText|currentCurrency)\b/);
      expect(code, `${file} imports a price or cost model`)
        .not.toMatch(/@mise\/shared\/(recipe-cost-model|foodcost-model|per-kg-model|price-changes-model)/);
    }
  });

  test('⚠️ the one price-model import is the source stripping price fields, and only that', () => {
    const importers = SOURCES.filter(file => /@mise\/shared\/price-model/.test(codeOf(read(file))));
    expect(importers).toEqual(['recipesSource.ts']);
    expect(codeOf(read('recipesSource.ts'))).toMatch(/import \{ PRICE_FIELDS \} from '@mise\/shared\/price-model';/);
  });

  test('⚠️ the editor reaches the cost model only through unpriced-rows', () => {
    const editor = codeOf(read('RecipeEditor.tsx'));
    expect(editor).toMatch(/from '@mise\/shared\/unpriced-rows'/);
    expect(editor).not.toMatch(/withPrices|costRecipe/);
  });
});

describe('the recipes store keeps no prices', () => {
  test('⚠️ readIngredientPrices passes straight through: the answer is never assigned, stored or written', () => {
    const store = codeOf(read('recipesStore.ts'));
    expect(store).toMatch(/readIngredientPrices:\s*\(\)\s*=>\s*source\.readIngredientPrices\(\)/);
    const uses = store.match(/readIngredientPrices/g) ?? [];
    expect(uses.length, 'the type line and the pass-through (two names on each), nothing else').toBe(4);
    expect(store).not.toMatch(/ingredient-prices|INGREDIENT_PRICES|withPrices|unpriced-rows/);
  });

  test('⚠️ the source reads the prices once and keeps nothing: no listener, no local copy', () => {
    const source = codeOf(read('recipesSource.ts'));
    const body = source.slice(source.indexOf('readIngredientPrices: async'));
    expect(body).toMatch(/\bgetDocs\b/);
    expect(body.slice(0, body.indexOf('\n    },\n') + 1)).not.toMatch(/onSnapshot|localStorage|sessionStorage|indexedDB/);
    expect(body).toMatch(/return null;/);
  });
});
