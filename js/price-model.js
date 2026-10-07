// price-model.js — what an ingredient costs, and how a purchase form becomes a
// rate. PURE: no DOM, no Firestore, so every rule below is asserted in a unit test
// instead of being read back out of rendered markup (P15) — the same reason
// archive.js, reminders.js and day.js exist.
//
// ⚠️ IT LIVES IN js/ ROOT, NOT IN js/orders/, AND THAT IS DELIBERATE. Orders owns
// ingredients and enters their prices; the Recipe catalogue reads those prices to
// cost a recipe. A feature folder must never import from another feature folder
// (CLAUDE.md, "Modular by feature") — that rule is what keeps each feature liftable
// into its own app — so the alternative was a second copy of this maths, kept in
// step by a sentinel test. A copy of a CALCULATION is worse than a copy of a
// dialog: two files that quietly disagree about what a kilo costs produce two
// different food-cost percentages and nothing on screen says which is right.
// So it sits in the shared base instead, beside location.js and sections.js, which
// both features already import for exactly the same reason.
//
// WHY A PRICE LIVES ON THE INGREDIENT. A price is not a property of a thing, it is
// a property of the RELATIONSHIP between a thing and the supplier who sells it —
// and in Orders an ingredient document already IS that relationship (it carries a
// supplierId). So the price belongs here, on the document that already knows who
// it is bought from, and no second address book has to exist.
//
// ⚠️ THE COST THIS PRODUCES IS NOMINAL, NOT ACTUAL. It is the price of the usual
// supplier's article, not of the batch that happened to be in the kitchen that
// morning. A one-off substitution (bought elsewhere because the van did not come)
// is deliberately invisible here. That is a known, accepted limitation: the
// alternative is asking someone to record every substitution, which nobody does.
//
// ── HOW A PRICE IS ENTERED ───────────────────────────────────────────────────
// One number and a unit, never a sentence:
//
//     priceUnit 'kg'  ·  pricePerUnit 7.20   →   £7.20 / kg
//
// The RATE is typed. It used to be derived, from a pack price divided by a pack
// size — two boxes whose only job was one division, and whose second box asked
// again for the pack weight the ingredient already carries in its own `weight`
// field a few lines higher in the same form ("2.27kg"). Two places holding one
// fact drift, and the one nobody updates is the one every recipe cost is built
// from.
//
// ⚠️ SO THE DIVISION MOVED TO THE PERSON, DELIBERATELY. An invoice reading
// "£180 for a 25kg sack" is entered as 7.20, not as 180. One box that always
// means the same thing, instead of two and a rule about which one the invoice
// total goes in. Whoever enters prices has to know that — the form says it on
// the field, which is the only place it can be said, because a number cannot be
// inspected for what it is a price OF.
//
// ⚠️ SINCE 30 SEP 2026 THERE IS ALSO A SECOND WAY IN, because the owner asked for
// exactly the division the old form was retired for: «il cartone costa 20 euro e
// ho 4 buste da 2.5kg, lui deve calcolare il prezzo al kg». What keeps the old drift
// problem away is WHERE the division happens: caseRate() runs once, at SAVE time,
// and the case (price, count, size, unit) is stored BESIDE the rate it produced.
// The rate every recipe cost is built from is therefore still ONE stored number,
// never re-derived from a pack text that somebody might edit later; and the case is
// kept so the form reopens as typed and an order can cost «one case» (order-cost.js).
//
// ⚠️ PRICES ARE NET OF VAT. The business reclaims input VAT, so what an
// ingredient really costs is the ex-VAT figure. Entering the gross one inflates
// every recipe cost and every food-cost percentage by the VAT rate, and nothing
// on any screen would look wrong. Same class of silent error, same remedy: it is
// written on the label.
//
// `packPrice` and `packSize` are RETIRED rather than renamed — see PRICE_FIELDS.
// `pricePerUnit` already held exactly this rate, so every price entered before
// the change opens showing the right number and nothing had to be migrated.

import { t } from './i18n.js';
// ⚠️⚠️ THE CURRENCY IS NO LONGER A CONSTANT IN THIS FILE, AND THAT IS THE POINT.
// It used to be `export const CURRENCY = '£'`, written when every venue was in the
// UK — and it printed pounds on an Italian bakery whose ten prices were typed in
// euros. It now follows the venue's COUNTRY (js/market.js currencyOf), and the
// session sets it when a location opens.
//
// ⚠️ SO IT IS READ INSIDE EACH FUNCTION BELOW, NEVER ONCE UP HERE. A module is
// evaluated at first import, before any venue is open; a value captured at this level
// would freeze the fallback into every price on the page. It is the v1.57.0 defect,
// and money is the one place where being quietly wrong looks exactly like being right.
//
// ⚠️ NOTHING HERE CONVERTS. Only the symbol changes; every stored number is used as
// typed. See js/currency.js.
import { moneyText } from './currency.js';
// The weight box's reader — used when a 'pack' case is SAVED, to store the size of one
// package; caseRate itself works from that stored size, never from the weight.
import { splitWeight } from './pack-size.js';

// What a price can be quoted PER. Deliberately three, and deliberately not the
// same list as the recipe units (catalogue-model.js): this is how something is
// BOUGHT — by weight, by volume, or by the piece — not how it is measured into a
// bowl. A tighter list is also a smaller thing to keep in step with the rules.
export const PRICE_UNITS = Object.freeze(['kg', 'l', 'pcs']);

// Human wording for each, for labels and for the "not costable" explanations.
// ⚠️ KEYS, NOT PHRASES — see the note in js/calculator-render.js. A module constant is
// built once, before any venue is open, so a t() here is frozen in the language the
// app started in. Resolve with priceUnitLabel() at the moment of drawing.
export const PRICE_UNIT_LABELS = Object.freeze({
  kg: 'price.byWeight',
  l: 'price.byVolume',
  pcs: 'price.byPiece',
});

export function priceUnitLabel(unit) {
  return t(PRICE_UNIT_LABELS[unit] || PRICE_UNIT_LABELS.kg);
}

// Every field this module owns on an ingredient document. Exported because the
// form, the data layer and the rules test all need the SAME list, and three
// hand-written copies of it would drift the first time one is extended.
//
// ⚠️ `packPrice` and `packSize` ARE RETIRED AND ARE STILL LISTED ON PURPOSE.
// Prices entered before the rate became a typed field carry both, and an
// ingredient is saved with a MERGE — a field left out of the payload keeps
// whatever it had. So the patch sets them to null EXPLICITLY, which is the only
// way to remove them, and they drain out of production as prices get edited.
// Drop them from this list and an old document keeps a pack price for ever that
// contradicts its own rate: 180 and 25 sitting under a rate somebody has since
// corrected to 7.50.
// ⚠️ `vatRate` JOINED THIS LIST 28 Sep 2026 — the PURCHASE VAT stored beside the
// price, firestore.rules ingredient-prices (closed to [0, 4, 5, 10, 20, 22] or
// null). It lives there only: not on the `ingredients` document and not in the
// price HISTORY subcollection — see INGREDIENT_DRAINED_FIELDS below, pricePatch()
// and priceRecord().
// ⚠️ THE FOUR `case…` KEYS JOINED 30 Sep 2026 (a price quoted per case: what the case
// costs, how many it holds, how big each is). Like `vatRate` they live on
// ingredient-prices ONLY — see the two lists below.
const CASE_FIELDS = Object.freeze(['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']);

// ⚠️ `priceBasis` JOINED THIS LIST 7 Oct 2026: what the number typed in the ingredient card's price box
// REFERS to ('pack' | 'case' | 'rate'; null = the form's default). It is a memory of the person's
// choice and nothing else — the stored price shape is the same whatever it says. Like `vatRate` it
// lives on ingredient-prices ONLY (PRICE_ONLY_FIELDS below).
export const PRICE_FIELDS = Object.freeze([
  'priceUnit', 'pricePerUnit', 'packPrice', 'packSize', 'unitWeightKg', 'priceUpdatedAt', 'vatRate',
  ...CASE_FIELDS, 'priceBasis',
]);

// The price keys an INGREDIENT document may still carry from before prices moved
// out, and so the ones every ingredient save sets to null to drain them.
// ⚠️⚠️ NOT THE SAME LIST AS PRICE_FIELDS, AND THE DIFFERENCE IS A LOCKOUT. The
// `ingredients` rule whitelists its keys; `vatRate` and the four case keys were never
// on the ingredient and are not in that whitelist, so writing them there — even as
// null — makes the rules refuse EVERY ingredient save, for every role (review of 28
// Sep 2026, caught before it shipped). tests/price-fields-whitelist.test.mjs pins both
// lists against firestore.rules.
const PRICE_ONLY_FIELDS = Object.freeze(['vatRate', ...CASE_FIELDS, 'priceBasis']);
export const INGREDIENT_DRAINED_FIELDS = Object.freeze(
  PRICE_FIELDS.filter(key => !PRICE_ONLY_FIELDS.includes(key)),
);

// Money is rounded to the penny; a RATE is not. A rate can legitimately be tiny —
// a gelatine leaf is fractions of a penny — and rounding £0.0035 to £0.00 would
// turn a real cost into a free ingredient. Four decimals is far below anything a
// kitchen can weigh and still keeps the stored number short and comparable.
const MONEY_DECIMALS = 2;
const RATE_DECIMALS = 4;
// A rate DERIVED from a case keeps two more decimals than a typed one: 2000 straws at
// £3.49 is £0.001745 each, which four decimals would store as 0.0017 (2.6% out), and
// 10,000 pieces at £0.49 must not round to nothing. The case itself is the exact figure.
const CASE_RATE_DECIMALS = 6;

// Round without the floating-point surprise: 180/25 is exactly 7.2, but plenty of
// ordinary divisions land on 7.199999999999999, and that number would be shown,
// stored, and compared against a later 7.2 as if it were different.
export function roundTo(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  // The +Number.EPSILON nudge fixes the classic 1.005 → 1.00 case, where the
  // stored double is a hair BELOW the value that was typed.
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

// A number that can be a price or a quantity: finite and strictly positive.
// Zero is refused rather than accepted as "free" — in every real case it means the
// box was left empty or half-typed, and a zero cost is worse than no cost at all
// because nothing on screen would look wrong.
export function positiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isPriceUnit(unit) {
  return PRICE_UNITS.includes(unit);
}

// ── Reading what was typed into the price boxes ──────────────────────────────
// Returns { ok, pricePerUnit, reason }. `reason` names the FIRST thing missing, so
// the screen can say which box to fill rather than a blanket "invalid".
//
// It never throws and never guesses: a form that is not complete simply produces
// ok:false, and an ingredient with no usable price is shown as "no price yet"
// rather than blocking anything (the design's rule throughout — flag, never block).
export function normalizePrice({ priceUnit, pricePerUnit } = {}) {
  if (!isPriceUnit(priceUnit)) return { ok: false, pricePerUnit: null, reason: 'unit' };

  const rate = positiveNumber(pricePerUnit);
  if (rate === null) return { ok: false, pricePerUnit: null, reason: 'price' };

  // Rounded even though it was typed: a rate pasted from a spreadsheet arrives as
  // 7.199999999999999 often enough, and that number would be stored, shown, and
  // then compared against a later 7.2 as if the price had moved.
  return { ok: true, pricePerUnit: roundTo(rate, RATE_DECIMALS), reason: null };
}

// ── A price quoted per CASE ──────────────────────────────────────────────────
// What the case may hold, as stored. 'pcs' is the same word PRICE_UNITS uses for a
// count; the others are how a bag or a bottle inside the case is measured.
// ⚠️ 'pack' (30 Sep 2026) means «each one is a package as big as the ingredient's WEIGHT was
// when the price was saved» (busta da 2,5 kg). The size of ONE package is STORED with the case,
// in the rate's own base (kilos or litres): a weight edited later, from a screen that has no
// price section, must not move a price nobody re-saved. The card copies the weight into it
// at save time (pricePatch); caseRate only reads what is stored.
export const PACK_ITEM = 'pack';
export const CASE_ITEM_UNITS = Object.freeze(['pcs', 'kg', 'g', 'l', 'ml', PACK_ITEM]);

// {size, unit} of an ingredient's weight text when the card would read it as g/kg/ml/l, else null.
export function packWeightOf(weightText) {
  const w = splitWeight(weightText);
  return w.amount !== '' && ['g', 'kg', 'ml', 'l'].includes(w.unit)
    ? { size: Number(w.amount), unit: w.unit }
    : null;
}

// The same weight as one package in the rate's base: { size, priceUnit } — 500 g is 0.5 of 'kg',
// 750 ml is 0.75 of 'l' — or null when the weight cannot be read.
export function packBaseOf(weightText) {
  const w = packWeightOf(weightText);
  if (!w) return null;
  const small = w.unit === 'g' || w.unit === 'ml';
  return {
    size: roundTo(small ? w.size / 1000 : w.size, CASE_RATE_DECIMALS),
    priceUnit: w.unit === 'kg' || w.unit === 'g' ? 'kg' : 'l',
  };
}

// The rate a case works out to, or null when anything is missing, zero or not a
// number. Never a guess: an incomplete case is «no price», exactly like an empty
// rate box. `pcs` ignores the size (a case of 50 is 50 pieces, whatever they weigh).
//   20 / 50 pcs          → 0.4 per piece
//   20 / (4 × 2.5 kg)    → 2 per kg
//   20 / (4 × 500 g)     → 10 per kg      (grams are read as thousandths of a kilo)
//   20 / (4 × «pack» of 2.5, basis 'kg') → 2 per kg. A pack case needs its stored size AND the
//   basis ('kg' or 'l' — the stored price unit); without either it is null.
export function caseRate({ casePrice, caseCount, caseItemSize, caseItemUnit } = {}, packBasis = null) {
  const price = positiveNumber(casePrice);
  const count = positiveNumber(caseCount);
  if (price === null || count === null || !CASE_ITEM_UNITS.includes(caseItemUnit)) return null;

  let priceUnit = 'pcs';
  let each = count;
  if (caseItemUnit !== 'pcs') {
    let sizeUnit = caseItemUnit;
    let size = positiveNumber(caseItemSize);
    if (caseItemUnit === PACK_ITEM) {
      if (packBasis !== 'kg' && packBasis !== 'l') return null;
      sizeUnit = packBasis;
    }
    if (size === null) return null;
    const perBase = sizeUnit === 'g' || sizeUnit === 'ml' ? size / 1000 : size;
    priceUnit = sizeUnit === 'kg' || sizeUnit === 'g' ? 'kg' : 'l';
    each = count * perBase;
  }
  const rate = roundTo(price / each, CASE_RATE_DECIMALS);
  // A case so cheap for what it holds that even six decimals round it away is not free.
  return rate > 0 ? { priceUnit, pricePerUnit: rate } : null;
}

// The four case fields as they may be STORED, or null when they do not make a whole
// case. Used by the patch (what to write), by the form (what to reopen) and by the two
// places that cost «one case» (orders, stocktake), so all agree on what a case is.
export function caseOf(source) {
  const s = source || {};
  const price = positiveNumber(s.casePrice);
  const count = positiveNumber(s.caseCount);
  const unit = CASE_ITEM_UNITS.includes(s.caseItemUnit) ? s.caseItemUnit : null;
  if (price === null || count === null || unit === null) return null;
  // ⚠️ A 'pack' case WITHOUT a stored size is not a case (an earlier draft of this feature stored
  // none): the typed rate wins, exactly like a stale case.
  const size = unit === 'pcs' ? null : positiveNumber(s.caseItemSize);
  if (unit !== 'pcs' && size === null) return null;
  return {
    casePrice: roundTo(price, RATE_DECIMALS),
    caseCount: count,
    caseItemSize: size,
    caseItemUnit: unit,
  };
}

// The case a price document really STANDS ON, or null. ⚠️ THE ONE READER OF A STORED CASE:
// orders, the stocktake and the card's reopening mode all ask this, never caseOf() directly.
//
// Why caseOf() alone is not enough: a phone still running the old code saves a new RATE with
// a merge that leaves the case keys of the last case save where they were. Read as they
// stand, the new code would prefer that stale case — orders and the stocktake would show the
// old case price, and the card would reopen in case mode and the next save would recompute
// the OLD rate (even bringing back a price somebody had deleted). So a case counts only when
// it is complete AND the rate it works out to is exactly the stored priceUnit and
// pricePerUnit. Anything else is a rate typed since: the typed rate wins and the case is
// ignored (the next save from the card writes all four case keys as null).
// A 'pack' case stands on its own stored size and the stored price unit — never on the weight.
export function storedCaseOf(price) {
  const stored = caseOf(price);
  if (!stored) return null;
  const derived = caseRate(stored, price.priceUnit);
  if (!derived) return null;
  return price.priceUnit === derived.priceUnit && Number(price.pricePerUnit) === derived.pricePerUnit
    ? stored
    : null;
}

// ── What one kilogram of this ingredient costs ───────────────────────────────
// The single number every recipe cost is built from. null when it cannot be known,
// which is a normal state and not an error.
//
// ⚠️ VOLUME IS CONVERTED TO WEIGHT 1:1, i.e. one litre is treated as one kilogram.
// True for water, near enough for milk (1.03) and most stocks; wrong for oil
// (0.92) and syrups. It is the standard bakery approximation and the whole app
// already uses it (catalogue-model.js converts recipe rows the same way), so the
// two agree by construction. Declared out loud here because it is the one place a
// cost can be a couple of percent out for a reason that is not a mistake.
export function pricePerKg(ingredient) {
  const ing = ingredient || {};
  const rate = positiveNumber(ing.pricePerUnit);
  if (rate === null) return null;

  if (ing.priceUnit === 'kg' || ing.priceUnit === 'l') return rate;

  if (ing.priceUnit === 'pcs') {
    // Bought by the piece — eggs, vanilla pods, gelatine leaves. It can only enter
    // a recipe written in grams if somebody has said what one piece weighs, and
    // that is a fact nobody can derive: 12 eggs is not a weight.
    const pieceKg = positiveNumber(ing.unitWeightKg);
    return pieceKg === null ? null : roundTo(rate / pieceKg, RATE_DECIMALS);
  }

  return null;
}

// Can this ingredient contribute a cost to a recipe written in weight?
// Returns { costable, reason } — the reason is what the screen shows next to the
// name, so the list of ingredients doubles as the to-do list for filling prices in.
export function costState(ingredient) {
  const ing = ingredient || {};
  if (!isPriceUnit(ing.priceUnit) || positiveNumber(ing.pricePerUnit) === null) {
    return { costable: false, reason: 'no-price' };
  }
  if (ing.priceUnit === 'pcs' && positiveNumber(ing.unitWeightKg) === null) {
    return { costable: false, reason: 'no-piece-weight' };
  }
  return { costable: true, reason: null };
}

export function isCostable(ingredient) {
  return costState(ingredient).costable;
}

// The wording shown when an ingredient cannot be costed. One sentence, saying what
// to do rather than what is wrong.
export const COST_REASON_TEXT = Object.freeze({
  'no-price': 'price.none',
  'no-piece-weight': 'price.needPieceWeight',
});

export function costReasonText(ingredient) {
  const { costable, reason } = costState(ingredient);
  return costable ? '' : t(COST_REASON_TEXT[reason] || COST_REASON_TEXT['no-price']);
}

// ── Formatting ───────────────────────────────────────────────────────────────

// An amount of money: always two decimals.
// How it is WRITTEN (separators, symbol before or after) follows the venue's country —
// js/currency.js moneyText; this only rounds.
export function formatMoney(value) {
  const n = Number(value);
  return moneyText((Number.isFinite(n) ? n : 0).toFixed(MONEY_DECIMALS));
}

// A RATE (price per unit). Always at least the two decimals money is read in, and
// up to six when the number needs them (a rate derived from a case can be that small) — so
// £7.20 stays £7.20 while a gelatine leaf at 3.5p shows as £0.035 rather than being rounded up
// to £0.04 (a 14% error on the only screen anybody checks) or down to £0.00, which reads as free.
//
// Written as "pad to six, then drop the zeros the number does not need" rather
// than as a threshold: a threshold has to be chosen, and any choice is wrong just
// past it.
export function formatRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const padded = n.toFixed(CASE_RATE_DECIMALS);
  const trimmed = padded.replace(/0+$/, '');
  const decimals = Math.max(MONEY_DECIMALS, trimmed.split('.')[1].length);
  return moneyText(n.toFixed(decimals));
}

// "£7.20 / kg" — the headline number on the ingredient row. Empty when unknown, so
// a caller can put the "no price yet" note in its place.
export function formatPricePerUnit(ingredient) {
  const ing = ingredient || {};
  const rate = positiveNumber(ing.pricePerUnit);
  if (rate === null || !isPriceUnit(ing.priceUnit)) return '';
  // ⚠️ «each» IS AN INTERFACE WORD (t(), «al pezzo» in Italian), not a literal: it now appears in notes and history.
  // One phrase with a hole, not glued halves: Italian has no «/ al pezzo».
  if (ing.priceUnit === 'pcs') return t('price.perEach', { rate: formatRate(rate) });
  return `${formatRate(rate)} / ${ing.priceUnit}`;
}

// ── Writing a price ──────────────────────────────────────────────────────────

// The patch written onto the ingredient document. Every field is always present,
// as a number or as null, because these documents are saved with a MERGE: a field
// left out of the payload keeps whatever it had, so clearing a price by omission
// would silently leave the old one in place.
//
// `unitWeightKg` survives an incomplete price — what one piece weighs is a fact
// about the ARTICLE, not about the money, so it is not lost just because the price
// boxes are still half filled. It IS cleared when the unit stops being 'pcs',
// because a leftover piece weight nothing displays is the kind of stale number
// that later gets divided by.
// The PURCHASE VAT rates this app may ever store (29 Sep 2026) — the union of
// what firestore.rules accepts on ingredient-prices.vatRate: the UK's (0, 5,
// 20) and Italy's (4, 10, 22). Kept here rather than imported from
// js/vat-rates.js (the CHOICES a venue is OFFERED, which vary by country):
// this is the wider, closed set of what may ever be WRITTEN, whatever venue
// is saving.
const VALID_VAT_RATES = Object.freeze([0, 4, 5, 10, 20, 22]);

// '' / null / undefined = "not stated"; anything not in the closed list above
// is also treated as not stated, rather than trusting a form's own input —
// the same defence firestore.rules applies server-side.
function normalizedVatRate(vatRate) {
  if (vatRate === '' || vatRate === null || vatRate === undefined) return null;
  const n = Number(vatRate);
  return VALID_VAT_RATES.includes(n) ? n : null;
}

// `priceUnit: 'case'` is the FORM's mode for «priced per case», never a stored unit:
// the rate and its unit are then derived here by caseRate() and the case is written
// beside them. In every other mode the four case keys go out as null — a MERGE keeps
// a key that is left out, so switching back to «per kg» would otherwise leave the old
// case behind to contradict the new rate.
// ⚠️ AN INCOMPLETE CASE IS «NO PRICE», ALL FOUR KEYS NULL — a half-typed case is not
// kept (unlike VAT, it is one fact in four boxes, useless in part).
export const CASE_MODE = 'case';

// `weightText` is the ingredient's weight as the card holds it right now: only a 'pack' case
// reads it, and only to COPY the size of one package into the case being saved.
// ⚠️ `packBasis` ('kg' | 'l') MARKS A 'pack' CASE WHOSE SIZE IS ALREADY KNOWN: caseItemSize is then
// authoritative and the weight text is not read at all. It is how an UNTOUCHED save writes a stored
// case back verbatim (storedPriceInput) — copying the weight into it would re-price a case that
// somebody without the price section had only re-weighed.
export function pricePatch(input, nowIso, weightText = '') {
  const { priceUnit, pricePerUnit, unitWeightKg, vatRate, casePrice, caseCount, caseItemSize, caseItemUnit, packBasis, keepRate, priceBasis } = input;
  const inCase = priceUnit === CASE_MODE;
  const knownBasis = inCase && caseItemUnit === PACK_ITEM && (packBasis === 'kg' || packBasis === 'l') ? packBasis : null;
  const base = inCase && caseItemUnit === PACK_ITEM && !knownBasis ? packBaseOf(weightText) : null;
  const caseFields = inCase
    ? caseOf({ casePrice, caseCount, caseItemSize: base ? base.size : caseItemSize, caseItemUnit })
    : null;
  const derived = caseFields ? caseRate(caseFields, base ? base.priceUnit : knownBasis) : null;

  const unit = inCase ? (derived ? derived.priceUnit : null) : (isPriceUnit(priceUnit) ? priceUnit : null);
  // The piece weight is a fact about the article and survives an incomplete case whose
  // items are pieces, like it survives an incomplete rate.
  const keepsPieceWeight = unit === 'pcs' || (inCase && caseItemUnit === 'pcs');
  const pieceKg = keepsPieceWeight && positiveNumber(unitWeightKg) !== null
    ? roundTo(unitWeightKg, 6)
    : null;

  const result = normalizePrice({
    priceUnit: unit,
    pricePerUnit: inCase ? (derived ? derived.pricePerUnit : null) : pricePerUnit,
  });
  // ⚠️ A DERIVED RATE IS STORED AS caseRate() MADE IT (six decimals): normalizePrice rounds
  // to four, and storedCaseOf() could then never recognise its own case.
  // ⚠️ `keepRate`: a rate worked out from a stored case (singleFromCaseInput) keeps its six decimals, so
  // moving a price from «a case of 3 at 10» to «3.333333 each» does not move the money by rounding.
  const storedRate = inCase && derived ? derived.pricePerUnit
    : (keepRate && result.ok ? roundTo(pricePerUnit, CASE_RATE_DECIMALS) : result.pricePerUnit);
  return {
    priceUnit: unit,
    pricePerUnit: result.ok ? storedRate : null,
    casePrice: caseFields && result.ok ? caseFields.casePrice : null,
    caseCount: caseFields && result.ok ? caseFields.caseCount : null,
    caseItemSize: caseFields && result.ok ? caseFields.caseItemSize : null,
    caseItemUnit: caseFields && result.ok ? caseFields.caseItemUnit : null,
    // Retired, and cleared on every save so an old document stops carrying a pack
    // price that disagrees with its own rate. See PRICE_FIELDS.
    packPrice: null,
    packSize: null,
    unitWeightKg: pieceKg,
    priceUpdatedAt: result.ok ? nowIso : null,
    // ⚠️ SURVIVES AN INCOMPLETE PRICE, same reasoning as unitWeightKg above: the
    // rate an accountant quoted is a fact worth keeping even mid-edit of the
    // price itself.
    vatRate: normalizedVatRate(vatRate),
    // ⚠️ ONLY WHEN THE CALLER SAYS SO: the ingredient card passes its choice (null = the default, which clears
    // an older one); the invoice import, the ingredient merge and every other writer pass none, so the key is
    // ABSENT and a merge write leaves the stored basis alone. A memory only: no price, no basis.
    ...('priceBasis' in input ? { priceBasis: result.ok && PRICE_BASES.includes(priceBasis) ? priceBasis : null } : {}),
  };
}

// ── How the card turns «Confezione» and its boxes into what pricePatch reads ──
// (1 Oct 2026.) The card has ONE price box whose meaning follows the format and the weight:
//   Cartone, weight readable    → «Prezzo cartone»: a case of PIECES, one item = the weight (stored per item)
//   Cartone, weight unreadable  → «Prezzo cartone»: a case of PIECES, the piece weight asked separately
//   Singola, weight readable    → «Prezzo confezione»: the price of ONE item, a rate per piece + its weight
//   Singola, weight unreadable  → «Come si acquista» + the typed rate, as it always was
// The old «A cartone» choice of «Come si acquista» is gone from the screen; CASE_MODE stays as the
// internal input pricePatch reads, so nothing about how a case is STORED changed.
export const PRICE_FORMS = Object.freeze({
  cartonPack: 'carton-pack', cartonPieces: 'carton-pieces', singlePack: 'single-pack', typed: 'typed',
});

// ⚠️ A PER-PIECE PRICE WITH ITS OWN PIECE WEIGHT (3rd review, 1 Oct 2026). «Prezzo confezione» says «one item =
// the weight», and the weight → piece-weight sync follows it — but an old per-piece price keeps `weight` as the
// PACK (eggs: 360 g, 0.25 a piece, 0.06 kg a piece) and `unitWeightKg` as ONE PIECE. Reading the pack weight as
// the piece weight made a retyped price write 0.36 kg for a 60 g egg: Food cost per kilo 6 times too low (500
// times for gelatine), with the piece-weight box hidden so nobody could see it. So the new meaning applies ONLY
// when the stored piece weight is what the new card itself writes — equal to the readable weight. An item priced
// per piece whose piece weight is absent, or differs from the weight, is «per piece with its own piece weight»:
// the form of today (a price per piece and a visible «Peso di un pezzo»), and the weight never touches it.
// The weight it is compared with is the one the card OPENED with when that reads (a weight edited later must
// not turn a tracking price into an own-weight one), else the one on screen.
export function ownPieceWeight(item, weightText, initialText = weightText) {
  if (!item || item.priceUnit !== 'pcs') return false;
  const kg = positiveNumber(item.unitWeightKg);
  const reference = packBaseOf(initialText) || packBaseOf(weightText);
  return !(kg !== null && reference && Math.abs(reference.size - kg) < 1e-9);
}

export function priceFormOf(fmt, weightText, ownPiece = false) {
  const readable = packBaseOf(weightText) !== null && !ownPiece;
  if (fmt && fmt.kind === 'carton') return readable ? PRICE_FORMS.cartonPack : PRICE_FORMS.cartonPieces;
  return readable ? PRICE_FORMS.singlePack : PRICE_FORMS.typed;
}

// ── What the number in the price box REFERS to (7 Oct 2026) ─────────────────────────────────────────────
// The owner chooses it per ingredient: the price of a pack, of a carton, or per kilo / litre. It is a way of
// TYPING and SHOWING one number — the stored price keeps its shape (a pack price per piece, or a case), so
// food cost, stocktake, orders and the invoice import never learn the basis exists.
//   single-pack   'pack' (default) | 'rate'
//   carton-pack   'case' (default) | 'pack' | 'rate'
//   carton-pieces 'case' (default) | 'pack'
// Any other form (the typed rate, a legacy card) has no basis: the box means what it always meant.
export const PRICE_BASES = Object.freeze(['pack', 'case', 'rate']);

export function basisOptions(form) {
  if (form === PRICE_FORMS.singlePack) return ['pack', 'rate'];
  if (form === PRICE_FORMS.cartonPack) return ['case', 'pack', 'rate'];
  if (form === PRICE_FORMS.cartonPieces) return ['case', 'pack'];
  return [];
}

export function defaultBasis(form) {
  return basisOptions(form)[0] || null;
}

// The basis a form shows: the stored one when this form offers it, else the default. null for a form with none.
export function basisOf(form, stored) {
  const options = basisOptions(form);
  return options.includes(stored) ? stored : (options[0] || null);
}

// What goes into the stored `priceBasis`: null for the default (absent = default) and for a form with none.
export function basisToStore(form, basis) {
  const chosen = basisOf(form, basis);
  return chosen === null || chosen === defaultBasis(form) ? null : chosen;
}

// 'kg' | 'l' — what «per rate» means for this weight; null when the weight does not read.
export function rateBaseOf(weightText) {
  return packBaseOf(weightText)?.priceUnit ?? null;
}

// How many of the form's own money one unit of `basis` is worth: a price per kilo × this = the pack price,
// a price per pack × this = the case price. null when something it needs is missing (an empty count, a weight
// that does not read) — never a guess.
function basisFactor(form, basis, fmt, weightText) {
  const options = basisOptions(form);
  if (!options.includes(basis)) return null;
  if (basis === options[0]) return 1;
  const size = packBaseOf(weightText)?.size ?? null;
  const count = form === PRICE_FORMS.singlePack ? 1 : positiveNumber(fmt && fmt.count);
  if (basis === 'pack') return count;
  if (basis === 'rate') return size === null || count === null ? null : size * count;
  return null;
}

// The number as typed in `basis` → the form's own price (pack for a Singola, case for a Cartone), or null
// when it cannot be worked out. The default basis passes the number through untouched; a derived one is
// rounded to four decimals, as every stored price is.
export function basisToStoredPrice(form, basis, value, fmt, weightText) {
  const chosen = basisOf(form, basis);
  if (chosen === null || chosen === defaultBasis(form)) return value;
  const n = positiveNumber(value);
  if (n === null) return value;
  const factor = basisFactor(form, chosen, fmt, weightText);
  return factor === null ? null : roundTo(n * factor, RATE_DECIMALS);
}

// The form's own price → the number to SHOW in `basis` (six decimals, so a stored price reads back as typed).
export function storedPriceToBasis(form, basis, price, fmt, weightText) {
  const chosen = basisOf(form, basis);
  const n = positiveNumber(price);
  if (chosen === null || chosen === defaultBasis(form) || n === null) return price;
  const factor = basisFactor(form, chosen, fmt, weightText);
  return factor === null ? null : roundTo(n / factor, CASE_RATE_DECIMALS);
}

// A number typed under one basis, re-expressed under another (the segment was tapped): the SAME money.
// null when it cannot be worked out (no count, no readable weight): the caller then does NOTHING — the box and
// the chosen segment stay as they were, so a typed number is never wiped. `decimals` is six for what is SHOWN;
// the card asks for twelve when it needs the figure itself, so no rounding of a shown number ever feeds a price.
export function convertBasisPrice(form, from, to, value, fmt, weightText, decimals = CASE_RATE_DECIMALS) {
  const a = basisOf(form, from);
  const b = basisOf(form, to);
  if (a === b) return value;
  const n = positiveNumber(value);
  if (n === null || a === null || b === null) return value;
  const fa = basisFactor(form, a, fmt, weightText);
  const fb = basisFactor(form, b, fmt, weightText);
  return fa === null || fb === null ? null : roundTo((n * fa) / fb, decimals);
}

// What the price box SHOWS: two decimals, the way money is read (Federico, 7 Oct 2026 — «4.405286» per kg
// read as noise). Only for the eye: the card keeps the exact figure behind the box (its anchor / boxCanon),
// so this rounding never feeds a saved price, and «per kg» → «per pack» still gives back exactly what was
// typed. A positive price too small for two decimals keeps six instead of reading as a free 0.
export function shownPrice(value) {
  const n = positiveNumber(value);
  if (n === null) return value;
  const two = roundTo(n, MONEY_DECIMALS);
  return two > 0 ? two : roundTo(n, CASE_RATE_DECIMALS);
}

// The boxes → pricePatch's input, for a price a person TYPED (or re-typed).
// boxes = { price, rate, unit, pieceKg, vat }.
export function formatPriceInput(fmt, weightText, { price: typedPrice, rate, unit, pieceKg, vat, ownPiece = false, basis = null } = {}) {
  const form = priceFormOf(fmt, weightText, ownPiece);
  // The number typed is in the person's chosen basis; everything below is in the form's own (pack or case).
  const price = basisToStoredPrice(form, basis, typedPrice, fmt, weightText);
  // ⚠️ A PRICE TYPED FOR FORMATTED GOODS IS STORED PER ITEM (1 Oct 2026, review): priceUnit 'pcs', the
  // rate is the price of ONE item, and `unitWeightKg` is one item's weight in kilos when the weight
  // reads (litres read 1:1 as kilos, the app's standing approximation). The old way — a case of ONE
  // package priced per kilo — made an egg priced 0.25 a piece become 4.03 a kilo with no piece weight,
  // and Food cost's «in pieces» lines and packaging (priceUnit 'pcs') lost their cost. Per-kilo
  // consumers keep working through pricePerKg (pcs rate ÷ unitWeightKg).
  const itemKg = ownPiece ? null : (packBaseOf(weightText)?.size ?? null);
  if (form === PRICE_FORMS.cartonPack || form === PRICE_FORMS.cartonPieces) {
    // A carton is a case of that many items: caseRate(pcs) = casePrice ÷ count is the per-item rate.
    return {
      priceUnit: CASE_MODE, casePrice: price, caseCount: fmt.count, caseItemUnit: 'pcs',
      unitWeightKg: itemKg ?? pieceKg, vatRate: vat,
    };
  }
  if (form === PRICE_FORMS.singlePack) {
    // keepRate: a per-item price carried from a case (10 / 3) keeps its six decimals, like the converter's
    return { priceUnit: 'pcs', pricePerUnit: price, unitWeightKg: itemKg, vatRate: vat, keepRate: true };
  }
  return { priceUnit: unit || null, pricePerUnit: rate, unitWeightKg: pieceKg, vatRate: vat };
}

// ⚠️ UNTOUCHED MEANS UNCHANGED: the STORED price in pricePatch's input shape — a stored case as
// the case (a 'pack' one with its own stored size, never the weight as it reads today; a legacy
// explicit-size one kg/g/l/ml as it is), otherwise the typed rate. Fed to pricePatch it gives back
// the same rate, the same unit and the same case, so priceChanged() is false and no history entry
// is written. Only the VAT is the person's to change on its own, so it is passed in.
export function storedPriceInput(item, vat) {
  const it = item || {};
  const stored = storedCaseOf(it);
  if (stored) {
    return {
      priceUnit: CASE_MODE,
      casePrice: stored.casePrice, caseCount: stored.caseCount,
      caseItemSize: stored.caseItemSize, caseItemUnit: stored.caseItemUnit,
      packBasis: stored.caseItemUnit === PACK_ITEM ? it.priceUnit : undefined,
      unitWeightKg: it.unitWeightKg, vatRate: vat,
    };
  }
  return { priceUnit: it.priceUnit || null, pricePerUnit: it.pricePerUnit, unitWeightKg: it.unitWeightKg, vatRate: vat };
}

// A Cartone turned into a Singola, with no price typed: the SAME money in the per-item shape — the rate is
// casePrice ÷ caseCount, the item weight is the one the price already remembers (or, for a case priced by
// weight, that case's size in kilos), and the case keys go out null. Fed to pricePatch it gives a price the
// readers carry exactly as before (cost per item is unchanged), so the caller writes NO history entry.
export function singleFromCaseInput(item, vat) {
  const it = item || {};
  const stored = storedCaseOf(it);
  if (!stored) return storedPriceInput(item, vat);
  const byWeight = stored.caseItemUnit !== 'pcs';
  const small = stored.caseItemUnit === 'g' || stored.caseItemUnit === 'ml';
  const sizeKg = byWeight ? roundTo(small ? stored.caseItemSize / 1000 : stored.caseItemSize, CASE_RATE_DECIMALS) : null;
  return {
    priceUnit: 'pcs',
    pricePerUnit: roundTo(stored.casePrice / stored.caseCount, CASE_RATE_DECIMALS),
    unitWeightKg: positiveNumber(it.unitWeightKg) !== null ? it.unitWeightKg : sizeKg,
    vatRate: vat,
    keepRate: true,
  };
}

// What the price box shows while nobody has typed in it — { value, suggestion }, each a number or null.
// ⚠️ EDITING THE FORMAT OR THE WEIGHT NEVER REWRITES A STORED PRICE (1 Oct 2026, review): only typing in
// this box, or «Ricalcola», makes the price dirty. So the box shows the stored figure only while it
// STILL MEANS THE SAME THING (`changed` is false — pack-format.js formatChanged); once the format or
// weight differs from what the price was saved under it is EMPTY, and `suggestion` — the same price
// per item carried to the new format — is what the card offers as its placeholder and what
// «Ricalcola» fills in.
//   suggestion  per-item price × the items now asked for: a rate per piece × count, or a per-kilo rate ×
//               one item's weight × count (null when the weight does not read, or the count is empty)
//   value       Cartone with a stored case → its price; Singola with a stored case of one → its price;
//               no stored case (a typed rate) → the suggestion, which is that rate carried over
// Ten decimals: the figure must divide back to the same rate.
export function priceBoxStart(item, fmt, weightText, changed = false) {
  const it = item || {};
  const base = packBaseOf(weightText);
  const stored = storedCaseOf(it);
  const carton = Boolean(fmt) && fmt.kind === 'carton';
  const count = carton ? positiveNumber(fmt.count) : 1;
  const rate = positiveNumber(it.pricePerUnit);
  let suggestion = null;
  if (count !== null && rate !== null) {
    if (it.priceUnit === 'pcs') suggestion = roundTo(rate * count, 10);
    else if (base) suggestion = roundTo(rate * base.size * count, 10);
  }
  if (stored) {
    if (changed) return { value: null, suggestion };
    return { value: carton ? stored.casePrice : roundTo(stored.casePrice / stored.caseCount, 10), suggestion };
  }
  return { value: suggestion, suggestion };
}

// ⚠️ A CASE PRICED BY WEIGHT CANNOT BE RE-PRICED WITHOUT ONE: the person typed a price on a
// carton whose stored case is by kilo or litre (a 'pack' or a legacy explicit size), and the
// weight no longer reads. Pricing it as pieces would silently turn «€ per kg» into «€ per
// piece», so the save is refused on the weight box instead. An emptied price box is no price
// and needs nothing.
export function weightNeededForPrice({ item, fmt, weightText, dirty, priceBox }) {
  if (!dirty || !fmt || fmt.kind !== 'carton') return false;
  if (priceBox === '' || priceBox === null || priceBox === undefined) return false;
  const stored = storedCaseOf(item || {});
  return Boolean(stored) && stored.caseItemUnit !== 'pcs' && packBaseOf(weightText) === null;
}

// Has the price actually changed? Asked before appending to the history, so that
// re-saving an ingredient to fix a typo in its NAME does not plant a second price
// record identical to the first — a history full of non-events is a history nobody
// can read, and it is what makes "when did this go up?" unanswerable.
//
// The piece weight counts as part of the price: it is a divisor of the £/kg, so
// changing it changes what a recipe costs even though no money moved.
//
// ⚠️ THE RETIRED PACK FIELDS ARE DELIBERATELY NOT COMPARED. Every save now clears
// them, so an ingredient priced under the old form differs on them the first time
// it is opened and saved — and comparing them would read that as a price change
// and plant a history entry recording a rate that never moved.
export function priceChangedByRepresentation(before, after) {
  const a = before || {};
  const b = after || {};
  return ['priceUnit', 'pricePerUnit', 'unitWeightKg']
    .some(key => (a[key] ?? null) !== (b[key] ?? null));
}

// ⚠️ THE MONEY, NOT THE REPRESENTATION (3rd review, 1 Oct 2026). A price is the same price when what an item
// costs and what a kilo costs are the same, however they are stored: «2 a kilo» turned into «5 a bag of 2.5
// kg», the same 20 retyped on a live pack carton, a Cartone turned into a Singola — none of those is «when did
// this go up?» news. And a change of the remembered piece weight IS one: it is the divisor of the price per
// kilo that every recipe cost is built from, so it moves a cost even when no money moved.
// So: per-kilo cost and per-piece cost are compared, each when both sides have it, within rounding; a price
// that cannot be expressed per kilo on one side and can on the other (a piece weight appeared or went) is a
// change; when there is nothing to compare, the stored representation decides, as it always did.
const closeTo = (x, y) => Math.abs(x - y) <= Math.max(1e-6, Math.abs(x) * 1e-4);
function moneyOf(p) {
  const rate = positiveNumber(p.pricePerUnit);
  return {
    rate,
    perKg: rate === null ? null : pricePerKg(p),
    perPiece: rate !== null && p.priceUnit === 'pcs' ? rate : null,
  };
}
export function priceChanged(before, after) {
  const a = moneyOf(before || {});
  const b = moneyOf(after || {});
  if (a.rate !== null && b.rate !== null) {
    if (a.perKg !== null && b.perKg !== null) {
      if (!closeTo(a.perKg, b.perKg)) return true;
      return a.perPiece !== null && b.perPiece !== null && !closeTo(a.perPiece, b.perPiece);
    }
    if (a.perKg !== null || b.perKg !== null) return true;
    if (a.perPiece !== null && b.perPiece !== null) return !closeTo(a.perPiece, b.perPiece);
  }
  return priceChangedByRepresentation(before, after);
}

// One entry in the append-only history. It carries the SUPPLIER as well as the
// price, because the whole point of keeping it is to answer "what did we pay, to
// whom, when" long after the ingredient's current supplier has changed.
//
// `recordedAt` is a FIELD and not just the document id. Firestore refuses to order
// a query descending by document id ("does not support descending key scans"), so
// a history that only had its id could never be read newest-first — a trap this
// project has already fallen into twice, in Orders history and in the pastry
// records. Order by the field.
// ⚠️ `vatRate` IS DELIBERATELY NOT HERE. The history is the append-only record of
// what a KILO/LITRE/PIECE cost, over time; the purchase VAT is a live fact about
// the ingredient's price today, not a thing whose past values this app tracks.
// Named fields, not `...patch` — this is also what keeps it out by construction:
// a future field added to pricePatch()'s return does not silently start being
// recorded here too.
export function priceRecord(ingredient, patch, nowIso, source = 'manual') {
  return {
    recordedAt: nowIso,
    priceUnit: patch.priceUnit,
    pricePerUnit: patch.pricePerUnit,
    unitWeightKg: patch.unitWeightKg,
    supplierId: (ingredient && ingredient.supplierId) || '',
    source,
  };
}

// ── Where a price LIVES, which is not where an ingredient lives ──────────────
//
// ⚠️ THE PRICE MOVED OUT OF THE INGREDIENT DOCUMENT, and the reason is not tidiness.
// Orders must read every ingredient to work at all — that is the order screen —
// so a rate written on the ingredient is a rate every person in the building can
// read. Hiding the Food Cost screen hid the MARGIN and left "what a sack of flour
// costs" in plain view, which is half an answer pretending to be a whole one.
//
// It is a PARALLEL collection keyed by the ingredient's own id, not a
// subcollection: Food Cost and the recipe costing want them ALL, and one
// collection read costs far less than one read per ingredient (P14).
//
// ⚠️ AND THE FIELDS STAY IN THE ingredients WHITELIST IN firestore.rules, written
// null on every save so they drain out. Removing a field from a whitelist while
// production still carries it makes those documents permanently unwritable — the
// notifyHoursBefore / weekId trap, twice learnt.

// Split a saved form into the part that belongs to the ingredient and the part
// that belongs beside it. Both objects are always returned; the caller decides
// whether it is allowed to write the second.
export function splitPriceFields(data) {
  const ingredient = {};
  const price = {};
  Object.keys(data || {}).forEach(key => {
    if (PRICE_FIELDS.includes(key)) price[key] = data[key];
    else ingredient[key] = data[key];
  });
  // ⚠️ The ingredient KEEPS the keys, set to null. That is what drains the old
  // values out of documents written before this change; omitting them would
  // leave a stale rate on the ingredient for ever, readable by everybody, which
  // is the exact thing this change exists to stop.
  INGREDIENT_DRAINED_FIELDS.forEach(key => { ingredient[key] = null; });
  return { ingredient, price };
}

// Put an ingredient back together with its price, for the screens that may see
// one. `prices` is a map of ingredient id → the price document.
//
// ⚠️ A MISSING PRICE IS NOT AN ERROR AND MUST NOT BE. An employee cannot read
// that collection at all, so for them this returns the ingredient untouched —
// and every consumer already knows what to do with an unpriced ingredient,
// because most ingredients have never had a price. The screens say "not priced
// yet" and carry on, which is exactly the right thing for somebody who is not
// allowed to know. No new failure mode, no error to handle.
//
// ⚠️⚠️ A PRICE SITTING ON THE INGREDIENT ITSELF IS NEVER USED (security audit, 23 Sep
// 2026). Those keys are writable by any employee who may edit ingredients, so when an
// ingredient had no price document the old value on it — or a made-up one — became
// the price a manager's Food cost worked from. The rules now accept only null there;
// this makes the app ignore them as well, so neither half depends on the other.
export function withPrices(ingredients, prices) {
  const map = prices || {};
  return (ingredients || []).map(ing => {
    if (!ing) return ing;
    const price = map[ing.id];
    const clean = { ...ing };
    PRICE_FIELDS.forEach(key => { if (key in clean) clean[key] = null; });
    return price ? { ...clean, ...price } : clean;
  });
}
