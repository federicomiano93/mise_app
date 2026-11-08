// line-cost.js — the words under every «Composto da» and packaging line: what the thing is
// priced at, and what the amount on the line costs.
//
// Federico, 7 Nov 2026: «il costo dell'ingrediente al kg e il costo della quantità
// selezionata». This REVERSES his 13 Sep 2026 rule «nella sezione "composto da" non mostrare
// il prezzo». The note under the line (the editor's lineNote) keeps saying what a person must
// DO; this says the money, in its own element above it.
//
// PURE of the DOM: the figures come from foodcost-model.js (componentLineCost,
// packagingLineCost — the very call the batch total is built from), only the words are chosen
// here, so the form and the read view say exactly the same thing.
//
// ⚠️ UNKNOWN IS «— No price», NEVER 0. A price that exists but cannot be used (a price per piece
// on a line counted in grams) shows the rate it has and nothing else; the note says what to do.
// ⚠️ fcMoney FOR BOTH THE RATE AND THE AMOUNT, like the «Costo per 1 kg» box (two decimals, Federico
// 8 Nov 2026): a 2 g pinch of salt costing less than a cent reads «< 0,01 €», never «0,00 €» (free).

import { t } from '../i18n.js';
import { fcMoney } from './fc-number.js';
import { componentLineCost, packagingLineCost } from './foodcost-model.js';

const positive = n => Number.isFinite(Number(n)) && Number(n) > 0;

function rateText(rate, rateUnit) {
  return rateUnit === 'pcs' ? t('fc.line.each', { rate: fcMoney(rate) }) : t('fc.line.perKg', { rate: fcMoney(rate) });
}

// { text, noPrice } for one line. `text` is '' when there is nothing to say (the line's
// recipe or ingredient no longer exists: the note says so). `noPrice` is true when `text`
// is «— No price», which already says what the note would — so the editor leaves that note out.
//   kind: 'recipe' | 'ingredient' | 'packaging'
//   ingredient: the packaging line's ingredient (the others are found in `tables`)
export function lineCostView(entry, kind, tables, { noWeightLoss = false } = {}) {
  const none = { text: '', noPrice: false };
  const noPrice = { text: t('fc.line.noPrice'), noPrice: true };
  let line;
  let qty;
  let partial = false;

  if (kind === 'packaging') {
    const ingredient = tables.ingredients && tables.ingredients[entry.ingredientId];
    if (!ingredient) return none;
    line = packagingLineCost(entry, ingredient);
    qty = entry.qtyPcs;
  } else {
    line = componentLineCost(kind === 'ingredient' ? { ...entry, kind: 'ingredient' } : entry, tables, { noWeightLoss });
    if (line.reason === 'missing-recipe' || line.reason === 'missing-ingredient') return none;
    qty = kind === 'recipe' ? entry.qtyKg : entry.qty;
    // «Not exact yet» is for a recipe priced only in part; an ingredient line is either costed or not.
    partial = kind === 'recipe' && line.partial === true;
  }

  if (line.rate === null) return line.reason === 'no-price' || line.reason === 'no-recipe-cost' || line.reason === 'no-ingredient-price'
    ? noPrice : none;

  const rate = rateText(line.rate, line.rateUnit);
  // The amount only where it can be known and there is an amount to price.
  let text = line.cost !== null && positive(qty)
    ? t('fc.line.withAmount', { rate, cost: fcMoney(line.cost) })
    : rate;
  if (partial) text = t('fc.line.notExact', { text });
  return { text, noPrice: false };
}
