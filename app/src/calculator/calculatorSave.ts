// What Confirm saves: the version of a dough log, built from what the screen shows. Pure.
//
// A port of `commitLog` in js/log.js, the part before the write. The store (calculatorStore.ts) decides
// create or update and does the writing.
//
// ⚠️ THE DOUGH IS SAVED FROM THE RECIPE THE SCREEN SHOWS (a linked tab's catalogue rows, `sheetRecipe`), never
// from the tab's leftover copy, and the sheet is built by the same maths as the screen: what is saved is what
// the baker read.
//
// ⚠️ THE STORED TEXT IS THE CURRENT APP'S, byte for byte: the two apps read each other's logs until the switch.
// `logTimestamp` writes «Monday 09 June» and «2:05 PM» in English whatever the language, but the two WORDS of
// the text («Extra dough: », «Occasional client») follow the interface language at the moment of saving — the
// current app's js/log-model.js builds them with t(), so an Italian venue stores «Impasto extra: ». The caller
// reads them with t() AT SAVE TIME and hands them in as `words`.

import { doughExtraGrams, getDivisorIncluded, normalizeTrays } from '@mise/shared/calculator-config';
import type { CalculatorConfig, Recipe, TabProduct } from '@mise/shared/calculator-config';
import { buildLogText, buildSheet, recipeSnapshot } from '@mise/shared/log-model';
import type { LogLine, LogTextWords, LogVersion } from '@mise/shared/log-model';
import { logTimestamp } from '@mise/shared/log-time';

export interface DoughInputs {
  config: CalculatorConfig;
  // The recipe the screen calculates from (calculatorResult.sourceRecipe).
  recipe: Recipe;
  products: readonly TabProduct[];
  qty: (qtyId: string) => number;
  // The extra dough's box; ignored (zero) when the recipe has none or switched it off.
  extra: { enabled: boolean; text: string; unit: string };
  totalG: number;
  trays: unknown;
  leaveningPct: number;
  // The divisor's chosen number of crates (0 when none).
  divisorN: number;
  // The two words the text carries, in the interface language of the moment.
  words: LogTextWords;
  nowMs: number;
}

// A LogVersion without its `kind`: whether it creates or edits is the store's decision.
export function buildDoughVersion(input: DoughInputs): LogVersion {
  const { config, recipe, products, qty, extra, totalG, trays, leaveningPct, divisorN, words, nowMs } = input;
  // One line per client x product, zeros included: the saved log keeps what each client was NOT given too.
  const items: LogLine[] = products.map(product => ({
    id: product.id,
    name: product.name,
    clientName: product.clientName,
    qty: qty(product.qtyId),
    weightG: product.weight,
    kind: product.kind,
    crate: product.crate || { show: false, perBox: 20 },
  }));
  const extraDough = extra.enabled
    ? { grams: doughExtraGrams(extra.text, extra.unit), value: Number(extra.text) || 0, unit: extra.unit }
    : { grams: 0, value: 0, unit: 'g' };
  const divisor = { includedIds: getDivisorIncluded(config, recipe.id), n: divisorN };
  const sheet = buildSheet({
    recipe, items, extraGrams: extraDough.grams, totalInput: totalG, trays: normalizeTrays(trays), leaveningPct, divisor,
  });
  return {
    calculatedBy: '',
    at: logTimestamp(new Date(nowMs)),
    items,
    occasional: [],
    sheet,
    text: buildLogText(items, [], extraDough, words),
    recipe: recipeSnapshot(recipe),
  };
}
