// price-model.ts — what an ingredient costs, and how a stored case becomes a rate. PURE: no DOM, no
// Firestore, so every rule below is asserted in a unit test instead of being read back out of
// rendered markup (P15).
//
// TypeScript port of js/price-model.js for Mise 2, the READING half. Behaviour is identical, input
// for input: price-model.spec.ts runs the current app's tests (price-model, case-price and pack-case
// ones) against BOTH files, and odd-inputs.spec.ts feeds both the same strange values. The comments
// below are the ones the original paid for in bugs.
//
// ⚠️ A PARTIAL PORT, SO parity.spec.ts DOES NOT PAIR IT. NOT PORTED:
//   * priceUnitLabel, costReasonText and formatPricePerUnit. They look a word up in the interface
//     dictionary (js/i18n.js), which in Mise 2 belongs to the app (app/src/i18n/), and shared/ is pure
//     logic that must run on the server too. PRICE_UNIT_LABELS and COST_REASON_TEXT stay, as the
//     current app's dictionary KEYS (the original keeps them as keys too, never as phrases): the app
//     decides which of its own messages each key stands for.
//   * the whole WRITING half: CASE_MODE, pricePatch, PRICE_FORMS, ownPieceWeight, priceFormOf,
//     PRICE_BASES, basisOptions, defaultBasis, basisOf, basisToStore, rateBaseOf, basisToStoredPrice,
//     storedPriceToBasis, convertBasisPrice, shownPrice, formatPriceInput, storedPriceInput,
//     singleFromCaseInput, priceBoxStart, weightNeededForPrice, priceChangedByRepresentation,
//     priceChanged, priceRecord and splitPriceFields (and the private VALID_VAT_RATES and
//     normalizedVatRate). That is the ingredient card's, step 3e; its comments come with it.
//
// ADAPTED: formatMoney and formatRate take the venue's `Money` (currency.ts) as a second argument.
// The original reads the symbol and the layout from a module variable that the session sets
// (js/currency.js); Mise 2 keeps no venue fact in a module variable, so the money is handed in.
// The text is the same as the original's under the same currency (price-model.spec.ts pins it),
// which is also why the arity check in the spec leaves these two out: they take one more argument
// by design.
//
// ⚠️ IT LIVES IN shared/, NOT IN A FEATURE, AND THAT IS DELIBERATE. Orders owns ingredients and
// enters their prices; the Recipe catalogue reads those prices to cost a recipe. A feature must
// never import from another feature — that rule is what keeps each feature liftable into its own
// app — so the alternative was a second copy of this maths, kept in step by a sentinel test. A copy
// of a CALCULATION is worse than a copy of a dialog: two files that quietly disagree about what a
// kilo costs produce two different food-cost percentages and nothing on screen says which is right.
//
// WHY A PRICE LIVES ON THE INGREDIENT. A price is not a property of a thing, it is a property of the
// RELATIONSHIP between a thing and the supplier who sells it — and in Orders an ingredient document
// already IS that relationship (it carries a supplierId). So the price belongs here, on the document
// that already knows who it is bought from, and no second address book has to exist.
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
// kept so the form reopens as typed and an order can cost «one case» (order-cost.ts).
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

// ⚠️⚠️ THE CURRENCY IS NO LONGER A CONSTANT IN THIS FILE, AND THAT IS THE POINT.
// It used to be `export const CURRENCY = '£'`, written when every venue was in the
// UK — and it printed pounds on an Italian bakery whose ten prices were typed in
// euros. It now follows the venue's COUNTRY (market.ts currencyOf), and the money is HANDED to the
// two formatters below, so it cannot be read too early (see currency.ts).
//
// ⚠️ NOTHING HERE CONVERTS. Only the symbol changes; every stored number is used as
// typed. See currency.ts.
import { moneyText } from './currency';
import type { Money } from './currency';
// The weight box's reader — used when a 'pack' case is SAVED, to store the size of one
// package; caseRate itself works from that stored size, never from the weight.
import { splitWeight } from './pack-size';
import type { WeightUnit } from './pack-size';

// What a price can be quoted PER. Deliberately three, and deliberately not the
// same list as the recipe units (catalogue-model.js): this is how something is
// BOUGHT — by weight, by volume, or by the piece — not how it is measured into a
// bowl. A tighter list is also a smaller thing to keep in step with the rules.
export const PRICE_UNITS = Object.freeze(['kg', 'l', 'pcs'] as const);

export type PriceUnit = (typeof PRICE_UNITS)[number];

// Human wording for each, for labels and for the "not costable" explanations.
// ⚠️ KEYS, NOT PHRASES. A module constant is built once, before any venue is open, so a t() here
// would be frozen in the language the app started in. The app resolves the key at the moment of
// drawing.
export const PRICE_UNIT_LABELS = Object.freeze({
  kg: 'price.byWeight',
  l: 'price.byVolume',
  pcs: 'price.byPiece',
} as const);

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
// price HISTORY subcollection — see INGREDIENT_DRAINED_FIELDS below.
// ⚠️ THE FOUR `case…` KEYS JOINED 30 Sep 2026 (a price quoted per case: what the case
// costs, how many it holds, how big each is). Like `vatRate` they live on
// ingredient-prices ONLY — see the two lists below.
const CASE_FIELDS = Object.freeze(['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit'] as const);

// ⚠️ `priceBasis` JOINED THIS LIST 7 Oct 2026: what the number typed in the ingredient card's price box
// REFERS to ('pack' | 'case' | 'rate'; null = the form's default). It is a memory of the person's
// choice and nothing else — the stored price shape is the same whatever it says. Like `vatRate` it
// lives on ingredient-prices ONLY (PRICE_ONLY_FIELDS below).
export const PRICE_FIELDS = Object.freeze([
  'priceUnit', 'pricePerUnit', 'packPrice', 'packSize', 'unitWeightKg', 'priceUpdatedAt', 'vatRate',
  ...CASE_FIELDS, 'priceBasis',
] as const);

export type PriceField = (typeof PRICE_FIELDS)[number];

// The price keys an INGREDIENT document may still carry from before prices moved
// out, and so the ones every ingredient save sets to null to drain them.
// ⚠️⚠️ NOT THE SAME LIST AS PRICE_FIELDS, AND THE DIFFERENCE IS A LOCKOUT. The
// `ingredients` rule whitelists its keys; `vatRate` and the four case keys were never
// on the ingredient and are not in that whitelist, so writing them there — even as
// null — makes the rules refuse EVERY ingredient save, for every role (review of 28
// Sep 2026, caught before it shipped). The current app's tests/price-fields-whitelist.test.mjs
// pins both lists against firestore.rules.
const PRICE_ONLY_FIELDS = Object.freeze(['vatRate', ...CASE_FIELDS, 'priceBasis'] as const);
export const INGREDIENT_DRAINED_FIELDS: readonly PriceField[] = Object.freeze(
  PRICE_FIELDS.filter(key => !(PRICE_ONLY_FIELDS as readonly string[]).includes(key)),
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
export function roundTo(value: unknown, decimals: number): number {
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
export function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isPriceUnit(unit: unknown): unit is PriceUnit {
  return (PRICE_UNITS as readonly unknown[]).includes(unit);
}

// ── Reading what was typed into the price boxes ──────────────────────────────
// Returns { ok, pricePerUnit, reason }. `reason` names the FIRST thing missing, so
// the screen can say which box to fill rather than a blanket "invalid".
//
// It never throws and never guesses: a form that is not complete simply produces
// ok:false, and an ingredient with no usable price is shown as "no price yet"
// rather than blocking anything (the design's rule throughout — flag, never block).
export type NormalizedPrice =
  | { ok: false; pricePerUnit: null; reason: 'unit' | 'price' }
  | { ok: true; pricePerUnit: number; reason: null };

export function normalizePrice({ priceUnit, pricePerUnit }: { priceUnit?: unknown; pricePerUnit?: unknown } = {}): NormalizedPrice {
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
export const CASE_ITEM_UNITS = Object.freeze(['pcs', 'kg', 'g', 'l', 'ml', PACK_ITEM] as const);

export type CaseItemUnit = (typeof CASE_ITEM_UNITS)[number];

function isCaseItemUnit(unit: unknown): unit is CaseItemUnit {
  return (CASE_ITEM_UNITS as readonly unknown[]).includes(unit);
}

// {size, unit} of an ingredient's weight text when the card would read it as g/kg/ml/l, else null.
export function packWeightOf(weightText: unknown): { size: number; unit: WeightUnit } | null {
  const w = splitWeight(weightText);
  return w.amount !== '' && ['g', 'kg', 'ml', 'l'].includes(w.unit)
    ? { size: Number(w.amount), unit: w.unit }
    : null;
}

// The same weight as one package in the rate's base: { size, priceUnit } — 500 g is 0.5 of 'kg',
// 750 ml is 0.75 of 'l' — or null when the weight cannot be read.
export function packBaseOf(weightText: unknown): { size: number; priceUnit: 'kg' | 'l' } | null {
  const w = packWeightOf(weightText);
  if (!w) return null;
  const small = w.unit === 'g' || w.unit === 'ml';
  return {
    size: roundTo(small ? w.size / 1000 : w.size, CASE_RATE_DECIMALS),
    priceUnit: w.unit === 'kg' || w.unit === 'g' ? 'kg' : 'l',
  };
}

// The four case boxes as they may arrive: anything at all.
export interface CaseInput {
  casePrice?: unknown;
  caseCount?: unknown;
  caseItemSize?: unknown;
  caseItemUnit?: unknown;
}

// The rate a case works out to, or null when anything is missing, zero or not a
// number. Never a guess: an incomplete case is «no price», exactly like an empty
// rate box. `pcs` ignores the size (a case of 50 is 50 pieces, whatever they weigh).
//   20 / 50 pcs          → 0.4 per piece
//   20 / (4 × 2.5 kg)    → 2 per kg
//   20 / (4 × 500 g)     → 10 per kg      (grams are read as thousandths of a kilo)
//   20 / (4 × «pack» of 2.5, basis 'kg') → 2 per kg. A pack case needs its stored size AND the
//   basis ('kg' or 'l' — the stored price unit); without either it is null.
export function caseRate(
  { casePrice, caseCount, caseItemSize, caseItemUnit }: CaseInput = {}, packBasis: unknown = null,
): { priceUnit: PriceUnit; pricePerUnit: number } | null {
  const price = positiveNumber(casePrice);
  const count = positiveNumber(caseCount);
  if (price === null || count === null || !isCaseItemUnit(caseItemUnit)) return null;

  let priceUnit: PriceUnit = 'pcs';
  let each = count;
  if (caseItemUnit !== 'pcs') {
    let sizeUnit: string = caseItemUnit;
    const size = positiveNumber(caseItemSize);
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

// A case as it is stored: whole, with numbers for numbers.
export interface StoredCase {
  casePrice: number;
  caseCount: number;
  caseItemSize: number | null;
  caseItemUnit: CaseItemUnit;
}

// The four case fields as they may be STORED, or null when they do not make a whole
// case. Used by the patch (what to write), by the form (what to reopen) and by the two
// places that cost «one case» (orders, stocktake), so all agree on what a case is.
export function caseOf(source: unknown): StoredCase | null {
  const s = (source || {}) as CaseInput;
  const price = positiveNumber(s.casePrice);
  const count = positiveNumber(s.caseCount);
  const unit = isCaseItemUnit(s.caseItemUnit) ? s.caseItemUnit : null;
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
export function storedCaseOf(price: unknown): StoredCase | null {
  const stored = caseOf(price);
  if (!stored) return null;
  // caseOf found a case on `price`, so it is an object.
  const doc = price as { priceUnit?: unknown; pricePerUnit?: unknown };
  const derived = caseRate(stored, doc.priceUnit);
  if (!derived) return null;
  return doc.priceUnit === derived.priceUnit && Number(doc.pricePerUnit) === derived.pricePerUnit
    ? stored
    : null;
}

// What a stored price document, or an ingredient merged with one, may carry of the rate itself.
export interface RateSource {
  priceUnit?: unknown;
  pricePerUnit?: unknown;
  unitWeightKg?: unknown;
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
export function pricePerKg(ingredient: unknown): number | null {
  const ing = (ingredient || {}) as RateSource;
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

export type CostState =
  | { costable: true; reason: null }
  | { costable: false; reason: 'no-price' | 'no-piece-weight' };

// Can this ingredient contribute a cost to a recipe written in weight?
// Returns { costable, reason } — the reason is what the screen shows next to the
// name, so the list of ingredients doubles as the to-do list for filling prices in.
export function costState(ingredient: unknown): CostState {
  const ing = (ingredient || {}) as RateSource;
  if (!isPriceUnit(ing.priceUnit) || positiveNumber(ing.pricePerUnit) === null) {
    return { costable: false, reason: 'no-price' };
  }
  if (ing.priceUnit === 'pcs' && positiveNumber(ing.unitWeightKg) === null) {
    return { costable: false, reason: 'no-piece-weight' };
  }
  return { costable: true, reason: null };
}

export function isCostable(ingredient: unknown): boolean {
  return costState(ingredient).costable;
}

// The wording shown when an ingredient cannot be costed. One sentence, saying what
// to do rather than what is wrong. As above: the current app's dictionary KEYS.
export const COST_REASON_TEXT = Object.freeze({
  'no-price': 'price.none',
  'no-piece-weight': 'price.needPieceWeight',
} as const);

// ── Formatting ───────────────────────────────────────────────────────────────

// An amount of money: always two decimals.
// How it is WRITTEN (separators, symbol before or after) follows the venue's country —
// currency.ts moneyText; this only rounds.
export function formatMoney(value: unknown, money: Money): string {
  const n = Number(value);
  return moneyText((Number.isFinite(n) ? n : 0).toFixed(MONEY_DECIMALS), money);
}

// A RATE (price per unit). Always at least the two decimals money is read in, and
// up to six when the number needs them (a rate derived from a case can be that small) — so
// £7.20 stays £7.20 while a gelatine leaf at 3.5p shows as £0.035 rather than being rounded up
// to £0.04 (a 14% error on the only screen anybody checks) or down to £0.00, which reads as free.
//
// Written as "pad to six, then drop the zeros the number does not need" rather
// than as a threshold: a threshold has to be chosen, and any choice is wrong just
// past it.
//
// ⚠️ A QUIRK OF THE ORIGINAL, KEPT ON PURPOSE (found while porting it, 11 Oct 2026). A rate of
// 1e21 or more is written by toFixed() in exponent form, which has no «.», so split('.')[1] is
// undefined and the original throws a TypeError instead of answering. No price reaches that, and
// this port throws the same, so the two apps cannot disagree; the fix belongs in BOTH files at
// once (odd-inputs.spec.ts feeds both such a rate and fails until they agree).
export function formatRate(value: unknown, money: Money): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const padded = n.toFixed(CASE_RATE_DECIMALS);
  const trimmed = padded.replace(/0+$/, '');
  const decimals = Math.max(MONEY_DECIMALS, (trimmed.split('.')[1] as string).length);
  return moneyText(n.toFixed(decimals), money);
}

// ── Reading a price ──────────────────────────────────────────────────────────

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
//
// The price fields of the answer are whatever the price document holds (or null).
export type PriceFieldValues = { [K in PriceField]?: unknown };

export function withPrices<T extends object>(
  ingredients: readonly T[] | null | undefined,
  prices: Readonly<Record<string, object | null | undefined>> | null | undefined,
): Array<Omit<T, PriceField> & PriceFieldValues> {
  const map: Readonly<Record<string, object | null | undefined>> = prices || {};
  // An entry that is not an object (the original lets a falsy one through untouched) is returned
  // as it came; the type says what a list of ingredients holds.
  return ((ingredients || []) as readonly (T & { id?: string })[]).map(ing => {
    if (!ing) return ing;
    const price = map[ing.id as string];
    const clean: Record<string, unknown> = { ...ing };
    PRICE_FIELDS.forEach(key => { if (key in clean) clean[key] = null; });
    return price ? { ...clean, ...price } : clean;
  }) as Array<Omit<T, PriceField> & PriceFieldValues>;
}
