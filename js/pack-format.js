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
// ⚠️⚠️ THE PREVIOUS APP VERSION IGNORES packCount (6, 3rd review, 1 Oct 2026). On an old phone a Cartone built on
// an existing per-item or per-kilo price WITHOUT a typed price — the card's «untouched means unchanged» keeps the
// stored rate — is read as ONE item per carton: its weight is one item's, its rate is one item's, and the old
// readers know nothing of the count. Closing a stocktake month on an old phone would FREEZE that price. And
// this release is not undone by a plain revert: the field stays on the documents. So the go-live must get the
// manager phones onto the new version (a reload) BEFORE the stocktake is opened or closed.
//
// How a format is stored, on `ingredients/{id}` (product data, so staff may set it):
//   Cartone  packCount = a whole number ≥ 1 · unit = a carton word · packUnit = the inner word
//   Singola  packCount = null/absent · unit and packUnit untouched
// With «Cartone» the existing order machinery keeps working unchanged: unit + packUnit make
// hasUnitChoice() true (js/order-unit.js), so the order row offers «cartone / busta».

import { cleanUnit, sameUnit, hasUnitChoice } from './order-unit.js';
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

// ── Which card opens: the new one, or the one of before (reduced scope, 2 Oct 2026) ──
// ⚠️ FOUR DEEP REVIEWS EACH FOUND ANOTHER OLD PRICE SHAPE THAT THE NEW CARD MISREAD INTO WRONG MONEY. A
// read-only count of production (2 Oct 2026) found that only a few shapes exist: no price, a plain rate
// per kg / l / piece, and one 'pack' case ordered by the whole case. So the new card is for those (and
// for what it writes itself); EVERY OTHER STORED PRICE OPENS THE CARD OF BEFORE — «Unità d'ordine» and
// «A cartone», exactly as on main, which the regression grid proves the readers still read as they did.
// `item` is the ingredient with its price merged in (withPrices), read by somebody who may see money; an
// employee never sees a price, so the caller never asks for them (their card has no price to misread).
// true = the card of before. In order:
//   packCount present                                   → new card (only the new card writes it)
//   a stored case by an explicit size (kg, g, l, ml)     → before
//   a stored case of packages or pieces ordered by its own package word → new card (an employee's Singola)
//   a stored case of pieces                              → before (the new card writes these only WITH packCount)
//   a stored case of packages, ordered by anything but the whole case ('' or a carton word) → before
//   a rate on a weight text that does not read («6x1kg», «sacco») → before
//   anything else                                        → new card
export function usesLegacyCard(item) {
  const it = item || {};
  if (wholeCount(it.packCount) !== null) return false;
  const stored = storedCaseOf(it);
  if (stored) {
    const unit = cleanUnit(it.unit);
    // ⚠️ A CASE ORDERED BY ITS OWN PACKAGE WORD is what the NEW card leaves behind when an employee turns its
    // Cartone into a Singola (5th review, 2 Oct 2026): it stays on the new card, which reopens it as a
    // Singola with «Ricalcola». The card of before has no way back for it.
    if ((stored.caseItemUnit === 'pack' || stored.caseItemUnit === 'pcs') && unit !== '' && sameUnit(unit, it.packUnit)) return false;
    if (stored.caseItemUnit !== 'pack') return true;
    return !(unit === '' || isCartonWord(unit));
  }
  const priced = Number(it.pricePerUnit) > 0;
  const weight = typeof it.weight === 'string' ? it.weight.trim() : '';
  return priced && weight !== '' && packBaseOf(weight) === null;
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
  // ⚠️ A PACKAGE WORD AS THE ORDER UNIT, WITH NO packCount, IS A SINGOLA, whatever the stored case says
  // (2nd review, 1 Oct 2026): it is what an employee leaves behind when a Cartone is turned into a Singola
  // (the unit becomes «busta», the case of 4 stays in the price document until a manager touches it). The
  // readers price that line as ONE item; reading it back as a carton would undo the employee's change.
  const packWordIsUnit = inner !== '' && sameUnit(it.unit, it.packUnit) && !isCartonWord(it.unit);
  if (stored && stored.caseCount > 1 && !packWordIsUnit) {
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
//   Singola after Cartone → { packCount: null, unit }   a carton word becomes the PACKAGE word, any other stays
// ⚠️ packUnit is written only when there is a word to say, or one is stored to clear — never
// a blank key on an item that never had one.
// ⚠️ `force` is for a price typed (or «Ricalcola») under Cartone: the case is then written PER ITEM with
// the count, so the product data must say the same thing — packCount and the inner word — exactly as if
// the format had been touched (2nd review: a bare price retyped on a live 'pack' carton converted the
// case but never wrote packCount, and the bag lines lost their price).
// ⚠️⚠️ BUT A PRICE NEVER MOVES THE ORDER UNIT (4th review, 2 Oct 2026): a price-only edit wrote the carton
// word over `kg` / `pz`, and the month's counted kilos were re-read as cartons. With the format untouched
// `unit` stays exactly as stored: '' or a carton word already read «the whole case», and a weight or piece
// word keeps its own reading (order-cost.js unitCost).
export function formatPatch(before, form, { force = false } = {}) {
  const touched = formatTouched(before, form);
  if (!touched && !(force && form.kind === 'carton')) return {};
  if (!touched) {
    const inner = cleanUnit(form.inner);
    return {
      packCount: parseCount(form.count),
      ...(inner || cleanUnit(before.packUnit) ? { packUnit: inner } : {}),
    };
  }
  if (form.kind === 'carton') {
    const inner = cleanUnit(form.inner);
    return {
      packCount: parseCount(form.count),
      ...(inner || cleanUnit(before.packUnit) ? { packUnit: inner } : {}),
      unit: isCartonWord(before.unit) ? cleanUnit(before.unit) : form.cartonWord,
    };
  }
  // ⚠️ THE CARTON WORD BECOMES THE PACKAGE WORD, NOT '' (review of 1 Oct 2026): a stored case of 4 that
  // an employee (no price section) turns into a Singola is read with the ORDER UNIT only — empty, it
  // reads «the whole case» and a single bag was priced 20 instead of 5; «busta» reads «one item of the
  // case». With no package word there is nothing better than ''.
  return {
    packCount: null,
    unit: isCartonWord(before.unit) ? cleanUnit(before.packUnit) : cleanUnit(before.unit),
  };
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

  // ⚠️ A CASE OF PIECES IS THE NORMAL SHAPE NOW (every price typed for formatted goods is stored per
  // item): it agrees with the card while the count is the same. ITS WEIGHT IS NOT COMPARED (3rd review): an old
  // per-piece price keeps `weight` as the PACK and `unitWeightKg` as ONE PIECE, so a difference between them says
  // nothing — and a weight changed by an employee cannot be told from that, so it is not flagged.
  if (stored.caseItemUnit === 'pcs') {
    return stored.caseCount !== count ? { old: numberText(stored.caseCount), new: numberText(count) } : null;
  }
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
  const sameSize = Math.abs(base.size - storedSize) < 1e-9 && base.priceUnit === storedUnit;
  return sameSize ? null : { old, new: fresh };
}
