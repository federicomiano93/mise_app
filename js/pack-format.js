// pack-format.js — «Confezione: Singola | Cartone», the one question the ingredient card asks
// about how a product comes. PURE: no DOM, no Firestore, so every rule below is asserted under
// Node instead of being read back out of a screen (P15). It lives in js/ ROOT because Orders and
// the Catalogue both open the card (CLAUDE.md «Modular by feature»).
//
// ⚠️ NOTHING STORED MAY CHANGE UNLESS A PERSON CHANGES IT IN THE CARD. That is the rule this
// file is written around. Most products already in production were saved by the old card, with
// an order unit menu and a «by the case» price mode, and none of them carries the new field.
// So a format is READ from what is there (formatOf), shown, and WRITTEN BACK ONLY WHEN THE
// PERSON MOVED Confezione, the count or the inner word (formatPatch → {} otherwise: a merge
// write then leaves every stored key exactly where it was).
//
// How a format is stored, on `ingredients/{id}` (product data, so staff may set it):
//   Cartone  packCount = a whole number ≥ 1 · unit = a carton word · packUnit = the inner word
//   Singola  packCount = null/absent · unit and packUnit untouched
// With «Cartone» the existing order machinery keeps working unchanged: unit + packUnit make
// hasUnitChoice() true (js/order-unit.js), so the order row offers «cartone / busta».

import { cleanUnit, hasUnitChoice } from './order-unit.js';
import { storedCaseOf, packBaseOf, packWeightOf, roundTo } from './price-model.js';
import { packWordFor, looseUnitFor } from './record-choices.js';
import { t, localeTag } from './i18n.js';

// The order-unit words that mean «one whole carton». ⚠️ NOT scatola / box / confezione / pack:
// those name the PACKAGE of a single product just as often, and reading them as a carton would
// turn a box of 100 into a «Cartone» the moment somebody opened its card.
const CARTON_WORDS = new Set([
  'cartone', 'cartoni', 'cassa', 'casse', 'collo', 'colli',
  'case', 'cases', 'carton', 'cartons', 'crate', 'crates',
]);
export const CARTON_WORD_LIST = Object.freeze([...CARTON_WORDS]);

export function isCartonWord(word) {
  return CARTON_WORDS.has(cleanUnit(word).toLowerCase().replace(/\.$/, ''));
}

// The count the rules accept (firestore.rules ingredients.packCount): a whole number 1–10000.
export const PACK_COUNT_MAX = 10000;

// The box's text as a count: the whole number, or null for empty / not whole / out of range.
export function parseCount(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= PACK_COUNT_MAX ? n : null;
}

const wholeCount = (v) => (Number.isInteger(v) && v >= 1 && v <= PACK_COUNT_MAX ? v : null);

// What an ingredient comes in, as the card should OPEN it: { kind: 'single'|'carton', count, inner }.
// `price` is the price document merged onto the item (what withPrices builds) or null for
// somebody who may not see money. Four rules, in this order:
//   1. packCount is a whole number ≥ 1                      → carton, that count
//   2. a unit choice exists AND the order unit is a carton word → carton; the count is EMPTY for
//      an employee, and read from the stored case for a price reader
//   3. the stored price stands on a case of more than one      → carton, the case's count
//   4. everything else                                          → single
// ⚠️ A single is never a conclusion drawn from a MISSING field alone: 'unit kg, no packCount'
// opens as a single because nothing says otherwise, and an untouched save writes nothing.
export function formatOf(item, price = null) {
  const it = item || {};
  const inner = cleanUnit(it.packUnit);
  const stored = price ? storedCaseOf(price) : null;
  const count = wholeCount(it.packCount);
  if (count !== null) return { kind: 'carton', count, inner };
  if (hasUnitChoice(it) && isCartonWord(it.unit)) {
    return { kind: 'carton', count: stored ? wholeCount(stored.caseCount) : null, inner };
  }
  if (stored && stored.caseCount > 1) {
    return { kind: 'carton', count: wholeCount(stored.caseCount), inner };
  }
  return { kind: 'single', count: null, inner };
}

const sameCount = (a, b) => (a ?? null) === (b ?? null);

// Did the person move Confezione, the count or the inner word away from how the card OPENED?
// Compared with the opening state (not «did an event fire»): switching to Cartone and back
// again changes nothing, and so writes nothing. The inner word only counts for a carton — a
// single never shows it.
// before = formatOf(…) as the card opened (its inner word already as the menu showed it),
// form  = { kind, count, inner } as the card holds it now.
export function formatTouched(before, form) {
  if (before.kind !== form.kind) return true;
  if (form.kind !== 'carton') return false;
  return !sameCount(before.count, form.count) || cleanUnit(before.inner) !== cleanUnit(form.inner);
}

// What the format adds to the ingredient's payload: {} when it was not touched, so the merge
// write keeps every stored key. before = { ...formatOf(), unit: the stored order unit,
// packUnit: the stored package word }, form = { kind, count, inner, cartonWord }.
//   Cartone  → { packCount, packUnit?, unit }   unit keeps a carton word already stored
//   Singola after Cartone → { packCount: null, unit }   a carton word leaves, any other stays
// ⚠️ packUnit is written only when there is a word to say, or one is stored to clear — never
// a blank key on an item that never had one.
export function formatPatch(before, form) {
  if (!formatTouched(before, form)) return {};
  if (form.kind === 'carton') {
    const inner = cleanUnit(form.inner);
    return {
      packCount: parseCount(form.count),
      ...(inner || cleanUnit(before.packUnit) ? { packUnit: inner } : {}),
      unit: isCartonWord(before.unit) ? cleanUnit(before.unit) : form.cartonWord,
    };
  }
  return { packCount: null, unit: isCartonWord(before.unit) ? '' : cleanUnit(before.unit) };
}

// The order unit a NEW single item gets from its price, when it is loose (no readable weight):
// «al kg» → kg, «al litro» → l, «al pezzo» → pz / pcs (the venue's word). '' for anything else.
// ⚠️ ONLY EVER FOR A NEW ITEM — an existing one keeps the unit it has; the card decides that.
export function looseUnit({ kind, weightReadable, priceUnit, lang }) {
  if (kind !== 'single' || weightReadable) return '';
  return looseUnitFor(priceUnit, lang);
}

// ── The line under the format ────────────────────────────────────────────────
const numberText = (n) => Number(n).toLocaleString(localeTag(), { maximumFractionDigits: 3 });

// «Cartone da 4 buste da 2,5 kg (10 kg)» — and without a weight that can be read, «Cartone da 4
// buste». '' when there is no carton, no count or no word to say. `lang` is the OUTPUT language:
// the plural of «busta» is the venue's word. A word the table does not know is «4 × parola».
export function formatSummary(fmt, weight, lang) {
  const inner = cleanUnit(fmt && fmt.inner);
  const count = fmt && fmt.kind === 'carton' ? wholeCount(fmt.count) : null;
  if (count === null || !inner) return '';
  const plural = packWordFor(inner, count, lang);
  const items = plural ? `${count} ${plural}` : `${count} × ${inner}`;
  const w = packWeightOf(weight);
  if (!w) return t('orders.format.summaryNoWeight', { items });
  const small = w.unit === 'g' || w.unit === 'ml';
  let total = roundTo(count * w.size, 3);
  let totalUnit = w.unit;
  if (small && total >= 1000) { total = roundTo(total / 1000, 3); totalUnit = w.unit === 'g' ? 'kg' : 'l'; }
  return t('orders.format.summary', {
    items,
    size: `${numberText(w.size)} ${w.unit}`,
    total: `${numberText(total)} ${totalUnit}`,
  });
}

// ── «The format changed since the last price» ────────────────────────────────
// A price stands on a case; the card (or an employee, who cannot see the price) has since changed
// what the case holds or what one item weighs. Returns { old, new } — the two formats as short
// text, «4 × 2,5 kg» — or null when they agree, when there is no stored case, or when the weight
// cannot be read (nothing to compare, so nothing to nag about).
// A 'pack' case remembers the size it was priced at; a legacy explicit-size case (4 × 2.5 kg)
// is compared by the same size; a case of pieces has no size and only its count is compared.
export function formatChanged(price, fmt, weight) {
  const stored = price ? storedCaseOf(price) : null;
  if (!stored) return null;
  const count = fmt.kind === 'carton' ? fmt.count : 1;
  if (!count) return null;
  const base = packBaseOf(weight);

  const small = stored.caseItemUnit === 'g' || stored.caseItemUnit === 'ml';
  const storedSize = stored.caseItemUnit === 'pcs' ? null
    : roundTo(small ? stored.caseItemSize / 1000 : stored.caseItemSize, 6);
  const storedUnit = stored.caseItemUnit === 'pack' ? price.priceUnit
    : (stored.caseItemUnit === 'kg' || stored.caseItemUnit === 'g' ? 'kg' : (storedSize === null ? null : 'l'));

  const text = (n, size, unit) => (size === null ? numberText(n) : `${numberText(n)} × ${numberText(size)} ${unit}`);
  const old = text(stored.caseCount, storedSize, storedUnit);
  const fresh = text(count, base ? base.size : null, base ? base.priceUnit : null);

  if (stored.caseCount !== count) {
    return { old, new: base ? fresh : numberText(count) };
  }
  if (!base) return null;
  // A case of pieces whose ingredient now has a readable weight is priced per PIECE and would be
  // re-priced per kilo by the next price edit: said, never switched silently.
  if (storedSize === null) return fmt.kind === 'carton' ? { old, new: fresh } : null;
  const sameSize = Math.abs(base.size - storedSize) < 1e-9 && base.priceUnit === storedUnit;
  return sameSize ? null : { old, new: fresh };
}
