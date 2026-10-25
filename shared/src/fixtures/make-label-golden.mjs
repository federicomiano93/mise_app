// make-label-golden.mjs — writes label-golden.json: what the CURRENT app's label chain (the js/ files) answers
// for every recipe of label-corpus.ts. Run with plain node, from anywhere:
//
//     node shared/src/fixtures/make-label-golden.mjs
//
// WHY IT EXISTS (parity doc item 110b). label-corpus.spec.ts runs the corpus through the js/ files and the
// TypeScript ports and demands strict equality, and that holds only while js/ exists. At the switch js/ is
// deleted; this file is what keeps the ports pinned after that: label-corpus.spec.ts also compares the ports'
// output with the committed JSON, byte for byte.
//
// WHEN TO RUN IT: (1) when a step adds a field to `runLabelChain` in label-corpus.ts (the label template was
// added in step 3d-3; the ZPL and the print queue add theirs); the new field is generated here from js/, the old fields do not move. (2) NEVER to
// make a red spec green: if a port and the golden file disagree, one of them is wrong — fix the port, or, if
// the CURRENT app was deliberately fixed (Findings C was: PR #354, regenerated 13 Oct 2026), fix js/ and the port together and then
// regenerate, saying so in the commit.
//
// Deterministic: keys sorted, two-space indent, a final newline. Reads the js/ files and writes one file, the
// JSON next to this script; it touches nothing else.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LABEL_CORPUS, UNKNOWN_INGREDIENT, runCorpus, stableStringify } from './label-corpus.ts';
import * as market from '../../../js/market.js';
import * as allergen from '../../../js/catalogue/recipe-allergen-model.js';
import * as label from '../../../js/catalogue/recipe-label-model.js';
import * as template from '../../../js/catalogue/label-template-model.js';

const api = {
  outputLanguage: market.outputLanguage,
  canPrintLabel: market.canPrintLabel,
  recipeAllergens: allergen.recipeAllergens,
  canLabel: allergen.canLabel,
  rowState: allergen.rowState,
  rowIsBlocked: allergen.rowIsBlocked,
  flattenIngredients: label.flattenIngredients,
  nutritionPer100g: label.nutritionPer100g,
  buildLabel: label.buildLabel,
  ingredientLine: label.ingredientLine,
  containsLine: label.containsLine,
  mayContainLine: label.mayContainLine,
  declarationText: label.declarationText,
  // The original reads the word for an unknown ingredient from the dictionary (English here, as in the specs).
  blockingIngredients: (recipes, tables) => allergen.blockingIngredients(recipes, tables),
  unlinkedRowNames: allergen.unlinkedRowNames,
  resolveLabel: template.resolveLabel,
  blockText: template.blockText,
  useByDate: template.useByDate,
  dateText: template.dateText,
};

const golden = {
  // The corpus is the input; the answers are the output. The ids are listed so a removed recipe is noticed.
  corpus: LABEL_CORPUS.map(entry => entry.id),
  unknownIngredientWord: UNKNOWN_INGREDIENT,
  recipes: runCorpus(api),
};

const target = fileURLToPath(new URL('./label-golden.json', import.meta.url));
writeFileSync(target, stableStringify(golden, 1) + '\n');
console.log(`wrote ${target} (${LABEL_CORPUS.length} recipes)`);
