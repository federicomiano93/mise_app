import { localNumber, typedDecimal } from '@mise/shared/currency';
import type { Money } from '@mise/shared/currency';
import { unitCost } from '@mise/shared/order-cost';
import {
  CASE_ITEM_UNITS, CASE_MODE, PACK_ITEM, PRICE_UNITS,
  costReasonText, formatMoney, formatPricePerUnit, formatRate, isPriceUnit, packBaseOf, packWeightOf, pricePatch, pricePerKg,
  priceUnitLabel, storedCaseOf,
} from '@mise/shared/price-model';
import type { PriceInput, PricePatch } from '@mise/shared/price-model';
import { isUnusableWeight } from '@mise/shared/pack-size';
import { supplierToSave } from '@mise/shared/record-choices';
import { vatRatesFor } from '@mise/shared/vat-rates';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { NEW_CHOICE, PACK_WORD_MAX, activePatch, choiceIsBlankNew, readChoice, weightText } from './ingredientCardModel';
import type { CardKind, ChoiceState, ItemLike, Working } from './ingredientCardModel';
import { sharedTranslate } from './priceCardModel';

// The CARD OF BEFORE (step 3e-5, decision T4 — parity C82, C83, C11): the price block, and the two product-data menus, that an
// ingredient whose stored price has an OLD SHAPE opens with (shared/pack-format.ts usesLegacyCard). The port of
// legacyPriceBlock() and saveLegacyCard() of js/ingredient-record-form.js, as a pure model: the working copy, what the section
// draws, the refusals in the original's order and the exact payload.
//
// ⚠️ WHY IT EXISTS AT ALL: four deep reviews of the current app each found another old price shape that the new «Single | Case»
// card misread into WRONG MONEY. So those shapes keep the card that reads them as it always did — «How it is bought» with its
// «By the case» mode (count × size × unit + the case price), «bag of 2.5 kg» that follows the live weight, and an «Order unit»
// menu. The money this block writes is the money that block always wrote: pricePatch fed the same boxes.
//
// ⚠️ DIFFERENCE FROM THE CURRENT APP, ON PURPOSE — UNTOUCHED MEANS UNCHANGED AT THE DATABASE. The current app's card of before
// writes the whole price document on every save (its boxes read back as the stored price). Mise 2 saves local-first, so a tablet
// whose copy is a little old would put that old price back over a newer one (an invoice import on the PC). Here the price is
// handed to the save only when a price box or menu moved, or the weight moved (a «bag of …» case is priced by it): `legacySends`.
// Even then the store's priceWriteOf writes only the keys that differ, and a history entry only when the money moved.

type LegacyT = (key: MessageKey, params?: MessageParams) => string;

// The rules' cap on the order unit (firestore.rules, ingredients `unit` ≤ 100): a longer one would take the whole save down.
export const UNIT_MAX = 100;

// The box sizes «Contains [4] × [2.5] [kg ▾]» offers for one item of the case, «bag of …» apart (it is inserted live).
const CASE_ITEM_CHOICES = CASE_ITEM_UNITS.filter(unit => unit !== PACK_ITEM);

export interface LegacyPriceState {
  // «How it is bought»: '' = None, 'kg' | 'l' | 'pcs', or CASE_MODE («By the case»).
  readonly unit: string;
  // The boxes as they stand, in the venue's layout («7,2» in Italy).
  readonly rate: string;
  readonly pieceKg: string;
  readonly casePrice: string;
  readonly caseCount: string;
  readonly caseSize: string;
  // One item of the case: 'pcs' | 'kg' | 'g' | 'l' | 'ml' | 'pack'.
  readonly caseItemUnit: string;
  // The VAT menu: '' = not stated, else the rate as text.
  readonly vat: string;
}

// The two product-data menus of the card of before: «Package» (what ONE package of the weight is called — optional) and «Order
// unit» (how the order is counted: case, box — not a unit of measure). Both «+ New …» menus.
export interface LegacyProduct {
  readonly pack: ChoiceState;
  readonly unit: ChoiceState;
}

// What the block reads of the card, rebuilt by the card at each draw: the item as it opened (its price laid on), and the weight,
// package word and order unit as the card holds them NOW — so the VAT line and a «bag of 2.5 kg» case follow an unsaved edit.
export interface LegacyCtx {
  readonly item: ItemLike | null;
  readonly weight: string;
  readonly packUnit: string;
  readonly orderUnit: string;
  readonly locale: string;
  readonly money: Money;
  readonly country: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// A stored number as the box shows it: the venue's decimal mark, NEVER rounded (localNumber writes every digit it is given), so
// an untouched box reads back as the very figure stored.
const boxText = (value: unknown, money: Money): string =>
  (value === null || value === undefined || value === '' ? '' : localNumber(value, money, false));

// ── Opening ──────────────────────────────────────────────────────────────────

// The block as the card opens it. ⚠️ storedCaseOf, not caseOf: a case whose rate no longer matches the stored rate is a stale one
// (an old phone saved a new rate over it) and the card opens in the typed-rate mode, so a save writes the rate that is really
// there — never the old case's. A whole stored case reopens in case mode with the values as typed (never re-derived from the
// rate: that is what the case is kept for). `defaultUnit` is 'pcs' for a new packaging item (the card of before never opens for
// a new item, so it is there only for the port's shape).
export function legacyStateFrom(item: ItemLike | null, defaultUnit: 'pcs' | null, money: Money): LegacyPriceState {
  const stored = item ? storedCaseOf(item) : null;
  const storedVat = item && item.vatRate != null ? Number(item.vatRate) : null;
  return {
    unit: stored ? CASE_MODE : (item ? (isPriceUnit(item.priceUnit) ? item.priceUnit : '') : (defaultUnit ?? '')),
    rate: boxText(item?.pricePerUnit, money),
    pieceKg: boxText(item?.unitWeightKg, money),
    casePrice: boxText(stored?.casePrice, money),
    caseCount: boxText(stored?.caseCount, money),
    caseSize: boxText(stored?.caseItemSize, money),
    caseItemUnit: stored ? stored.caseItemUnit : 'pcs',
    vat: storedVat !== null && Number.isFinite(storedVat) ? String(storedVat) : '',
  };
}

// The two menus as they open. ⚠️ THE STORED WORD IS MATCHED EXACTLY, never ignoring case (the menu adds it if the list lacks it):
// an unrelated save must write the very string that is stored.
export function legacyProductFrom(item: ItemLike | null): LegacyProduct {
  return {
    pack: { choice: text(item?.packUnit).trim(), typed: '' },
    unit: { choice: text(item?.unit).trim(), typed: '' },
  };
}

// ── The flags ────────────────────────────────────────────────────────────────

const comparable = (state: LegacyPriceState): readonly string[] => [
  state.unit, state.rate, state.pieceKg, state.casePrice, state.caseCount, state.caseSize, state.caseItemUnit, state.vat,
];

// Did a person move anything of the price block? (What the leave question counts, with the product data.)
export function isLegacyEdited(state: LegacyPriceState, opened: LegacyPriceState): boolean {
  return JSON.stringify(comparable(state)) !== JSON.stringify(comparable(opened));
}

const choiceKey = (state: ChoiceState): readonly string[] => (state.choice === NEW_CHOICE ? [state.choice, state.typed] : [state.choice]);

// Did a person move either product-data menu of the card of before?
export function isLegacyProductEdited(product: LegacyProduct, opened: LegacyProduct): boolean {
  return JSON.stringify([choiceKey(product.pack), choiceKey(product.unit)])
    !== JSON.stringify([choiceKey(opened.pack), choiceKey(opened.unit)]);
}

// A «bag of …» case whose stored size is not what the weight says NOW: the card says «the price updates when you save», and the
// save must then really re-price it — also when the weight was changed BEFORE this card opened (an employee's card has no price
// and leaves the case at the old size; review of 24 Oct 2026). Read in the card's live context.
export function packRepriced(state: LegacyPriceState, ctx: LegacyCtx): boolean {
  if (!inCase(state) || state.caseItemUnit !== PACK_ITEM) return false;
  const stored = ctx.item ? storedCaseOf(ctx.item) : null;
  const current = packBaseOf(ctx.weight);
  return Boolean(stored && stored.caseItemUnit === PACK_ITEM && current
    && (current.size !== stored.caseItemSize || current.priceUnit !== ctx.item?.priceUnit));
}

// Does this save hand a price to the store at all? (The header's difference.) Only when a price box or menu moved, or the weight
// did, or a «bag of …» case's size no longer matches the weight (packRepriced) — a «bag of …» case copies its size from the weight
// at save time, which is how the original re-prices it.
export function legacySends(state: LegacyPriceState, opened: LegacyPriceState, weightNow: string, weightOpened: string, ctx: LegacyCtx): boolean {
  return isLegacyEdited(state, opened) || weightNow !== weightOpened || packRepriced(state, ctx);
}

// ── Reading ──────────────────────────────────────────────────────────────────

// The input pricePatch reads — the original's read(), box for box. The four case boxes are only read as a case when the menu says
// so: pricePatch writes them all as null otherwise, which is what clears an old case.
// ⚠️ DIFFERENCE FROM THE CURRENT APP, ON PURPOSE — A RATE BOX NOBODY TYPED IN KEEPS ITS DECIMALS (`opened`, the state the card
// opened with): pricePatch rounds a typed rate to four decimals, so the original re-saved a stored 1.666667 as 1.6667 on any save,
// and a straw at 0.001745 switched from «By the case» to «each» as 0.0017. Here the rate is the stored figure (to the six decimals
// the case rates are kept in) until a person types in its box (`keepRate`), whatever the unit menu says; a typed rate is rounded
// as always.
export function readLegacy(state: LegacyPriceState, opened?: LegacyPriceState): PriceInput {
  return {
    ...(opened && state.rate === opened.rate ? { keepRate: true } : {}),
    priceUnit: state.unit || null,
    pricePerUnit: typedDecimal(state.rate),
    unitWeightKg: typedDecimal(state.pieceKg),
    vatRate: state.vat,
    casePrice: typedDecimal(state.casePrice),
    caseCount: typedDecimal(state.caseCount),
    caseItemSize: typedDecimal(state.caseSize),
    caseItemUnit: state.caseItemUnit,
  };
}

// The price patch a save would send (`opened`: the state the card opened with): every price key, as a value or null, `priceBasis` absent (a merge then leaves the stored
// basis alone, as the original's card of before does).
export const legacyPatch = (state: LegacyPriceState, opened: LegacyPriceState, ctx: LegacyCtx, nowIso: string): PricePatch =>
  pricePatch(readLegacy(state, opened), nowIso, ctx.weight);

// ── What is shown ────────────────────────────────────────────────────────────

const inCase = (state: LegacyPriceState): boolean => state.unit === CASE_MODE;

// The boxes the screen shows now (a hidden box is never refused: the original skips it).
export function shownBoxes(state: LegacyPriceState): ReadonlySet<LegacyBox> {
  const shown = new Set<LegacyBox>();
  const caseMode = inCase(state);
  if (!caseMode) shown.add('rate');
  if (state.unit === 'pcs' || (caseMode && state.caseItemUnit === 'pcs')) shown.add('pieceKg');
  if (caseMode) {
    shown.add('casePrice');
    shown.add('caseCount');
    if (state.caseItemUnit !== 'pcs' && state.caseItemUnit !== PACK_ITEM) shown.add('caseSize');
  }
  return shown;
}

export type LegacyBox = 'rate' | 'pieceKg' | 'casePrice' | 'caseCount' | 'caseSize';
export type LegacyRefusal = 'packWeight' | LegacyBox;

// A case of packages whose weight cannot be read has no size to price by: Save is refused on the weight box, in the card of
// before's own words, instead of quietly storing «no price».
export const needsPackWeight = (state: LegacyPriceState, ctx: LegacyCtx): boolean =>
  inCase(state) && state.caseItemUnit === PACK_ITEM && packBaseOf(ctx.weight) === null;

// The price's refusals, after the product data's (legacyProductRefusal): the pack weight, then the first SHOWN box whose text is
// not a positive number (empty is not refused — it is «no price»).
export function legacyRefusal(state: LegacyPriceState, ctx: LegacyCtx): LegacyRefusal | null {
  if (needsPackWeight(state, ctx)) return 'packWeight';
  const shown = shownBoxes(state);
  const order: readonly LegacyBox[] = ['rate', 'pieceKg', 'casePrice', 'caseCount', 'caseSize'];
  for (const box of order) {
    if (!shown.has(box)) continue;
    const raw = typedDecimal(state[box]);
    if (raw === '') continue;
    const n = Number(raw);
    if (!(Number.isFinite(n) && n > 0)) return box;
  }
  return null;
}

export interface LegacyOption { readonly value: string; readonly label: string }

export interface LegacyView {
  readonly unit: { readonly value: string; readonly label: string; readonly options: readonly LegacyOption[] };
  // The rate box (every mode but the case) — the right cell of the pair.
  readonly rate: { readonly shown: boolean; readonly value: string; readonly label: string; readonly placeholder: string };
  // The case price — the same right cell, in case mode.
  readonly casePrice: { readonly shown: boolean; readonly value: string; readonly label: string };
  // «Contains [count] × [size] [unit ▾]»: the size box and the × go for pieces; the size box goes for «bag of …».
  readonly caseRow: {
    readonly shown: boolean;
    readonly label: string;
    readonly count: { readonly value: string; readonly label: string };
    readonly size: { readonly shown: boolean; readonly value: string; readonly label: string };
    readonly times: boolean;
    readonly item: { readonly value: string; readonly label: string; readonly options: readonly LegacyOption[] };
  };
  // A «bag of …» case saved at another size than the weight says now: the price follows on save.
  readonly packChangedNote: string | null;
  readonly exVatNote: string;
  readonly pieceWeight: { readonly shown: boolean; readonly value: string; readonly label: string; readonly hint: string; readonly placeholder: string };
  readonly vat: { readonly value: string; readonly label: string; readonly options: readonly LegacyOption[] };
  readonly summary: { readonly main: string; readonly note: string; readonly muted: boolean };
  readonly vatLine: string;
}

const RATE_LABEL: Readonly<Record<string, MessageKey>> = {
  kg: 'sup.price.perKg', l: 'sup.price.perLitre', pcs: 'sup.price.perPiece',
};
const RATE_HINT: Readonly<Record<string, MessageKey>> = {
  kg: 'sup.price.eg.perKg', l: 'sup.price.eg.perLitre', pcs: 'sup.price.eg.perPiece',
};

// «bag of 2.5 kg»: one package of the size in the WEIGHT box. Offered while that weight reads as g / kg / ml / l, and ⚠️ KEPT
// WHILE CHOSEN even if the weight stopped reading (dropping it would move the menu to «pcs» and change what the case means; Save
// is then refused on the weight box until it reads again). Its words follow the weight and the package menu live.
function itemOptions(state: LegacyPriceState, ctx: LegacyCtx, t: LegacyT): LegacyOption[] {
  const options: LegacyOption[] = CASE_ITEM_CHOICES.map(unit => ({ value: unit, label: unit === 'pcs' ? t('sup.legacy.case.pcs') : unit }));
  const weight = packWeightOf(ctx.weight);
  const word = ctx.packUnit.trim() || t('sup.legacy.case.packWord');
  if (weight || state.caseItemUnit === PACK_ITEM) {
    const label = weight
      ? t('sup.legacy.case.packOf', { pack: word, size: `${weight.size.toLocaleString(ctx.locale)} ${weight.unit}` })
      : word;
    options.splice(1, 0, { value: PACK_ITEM, label });
  }
  return options;
}

// `opened`: the state the card opened with, so the live line reads the rate exactly as Save will (keepRate).
export function legacyView(state: LegacyPriceState, ctx: LegacyCtx, t: LegacyT, opened?: LegacyPriceState): LegacyView {
  const { item, money } = ctx;
  const sharedT = sharedTranslate(t);
  const currency = money.symbol;
  const shown = shownBoxes(state);
  const caseMode = inCase(state);

  // A saved «bag of …» case whose size the weight no longer says: the size it was priced at is not in the price yet — and Save
  // re-prices it (legacySends counts the same test).
  const packChanged = packRepriced(state, ctx);

  // The VAT menu: «— not stated», the country's rates, and a stored rate the list lacks (never changed by opening the card).
  const vatChoices = vatRatesFor(ctx.country);
  const storedVat = item && item.vatRate != null ? Number(item.vatRate) : null;
  const vatOptions: LegacyOption[] = [
    { value: '', label: t('sup.price.vat.notStated') },
    ...vatChoices.map(({ rate, key }) => ({ value: String(rate), label: t(key as MessageKey, { rate }) })),
  ];
  if (storedVat !== null && Number.isFinite(storedVat) && !vatChoices.some(choice => choice.rate === storedVat)) {
    vatOptions.push({ value: String(storedVat), label: `${storedVat}%` });
  }

  // The live line: what a kilo of this costs while the boxes are being typed into, so a misplaced decimal point shows before Save.
  const draft = pricePatch(readLegacy(state, opened), '', ctx.weight);
  let summary: LegacyView['summary'];
  let vatLine = '';
  if (draft.pricePerUnit === null) {
    // ⚠️ THE VAT LINE GOES WITH THE PRICE.
    summary = { main: costReasonText(draft, sharedT), note: '', muted: true };
  } else {
    const perKg = pricePerKg(draft);
    const parts = [caseMode ? caseSummary(draft, money, t) : formatPricePerUnit(draft, money, sharedT)];
    if (draft.priceUnit === 'pcs' && perKg !== null) parts.push(`${formatRate(perKg, money)} / kg`);
    summary = { main: parts.filter(Boolean).join('  ·  '), note: costReasonText(draft, sharedT), muted: false };
    // ⚠️ THE SAME unitCost() ORDERS ITSELF CALLS, fed the order unit, the weight and the package word as they stand in the open
    // card, not the stored ones.
    const cost = unitCost({ ...(item || {}), unit: ctx.orderUnit, weight: ctx.weight, packUnit: ctx.packUnit }, draft);
    const vat = draft.vatRate;
    if (cost !== null && vat !== null) {
      vatLine = t('sup.price.vat.summaryLine', { net: formatMoney(cost, money), gross: formatMoney(cost + (cost * vat) / 100, money), rate: vat });
    }
  }

  const rateKey = RATE_LABEL[state.unit];
  const hintKey = RATE_HINT[state.unit];
  return {
    unit: {
      value: state.unit,
      label: t('sup.price.howBought'),
      options: [
        { value: '', label: t('sup.price.none') },
        ...PRICE_UNITS.map(unit => ({ value: unit, label: priceUnitLabel(unit, sharedT) })),
        { value: CASE_MODE, label: t('sup.legacy.byCase') },
      ],
    },
    rate: {
      shown: shown.has('rate'),
      value: state.rate,
      label: rateKey ? t(rateKey, { currency }) : t('sup.price.generic', { currency }),
      // The example follows the UNIT, and an unknown unit gets none.
      placeholder: hintKey ? t(hintKey) : '',
    },
    casePrice: { shown: caseMode, value: state.casePrice, label: t('sup.price.case.price', { currency }) },
    caseRow: {
      shown: caseMode,
      label: t('sup.ing.contains'),
      count: { value: state.caseCount, label: t('sup.legacy.case.count') },
      size: { shown: shown.has('caseSize'), value: state.caseSize, label: t('sup.legacy.case.size') },
      times: state.caseItemUnit !== 'pcs',
      item: { value: state.caseItemUnit, label: t('sup.legacy.case.unit'), options: itemOptions(state, ctx, t) },
    },
    packChangedNote: packChanged ? t('sup.legacy.packChanged') : null,
    exVatNote: t('sup.price.exVatNote'),
    pieceWeight: {
      shown: shown.has('pieceKg'),
      value: state.pieceKg,
      label: t('sup.price.weightOfOnePiece'),
      hint: t('sup.price.neededOnlyToUse'),
      placeholder: t('sup.price.eg.pieceWeight'),
    },
    vat: { value: state.vat, label: t('sup.price.vat.label'), options: vatOptions },
    summary,
    vatLine,
  };
}

// «= 2.00 / kg · 20.00 per case» — the rate the case works out to, and the case it came from.
function caseSummary(draft: PricePatch, money: Money, t: LegacyT): string {
  const price = formatMoney(draft.casePrice, money);
  return draft.priceUnit === 'pcs'
    ? t('sup.legacy.summaryPiece', { rate: formatRate(draft.pricePerUnit, money), price })
    : t('sup.legacy.summaryUnit', { rate: formatRate(draft.pricePerUnit, money), unit: String(draft.priceUnit), price });
}

// ── Save ─────────────────────────────────────────────────────────────────────

export type LegacyProductRefusal = 'name' | 'weight' | 'category' | 'legacyPack' | 'legacyUnit';

// The card of before's own refusals, in its order (C83): an empty name; then the first of weight / category / package / order
// unit that is unusable (an unusable weight would erase the stored one, an empty «+ New …» would clear the word). The price's
// follow (legacyRefusal).
export function legacyProductRefusal(working: Working, product: LegacyProduct): LegacyProductRefusal | null {
  if (working.name.trim() === '') return 'name';
  if (isUnusableWeight(working.weight.amount, working.weight.unit)) return 'weight';
  if (choiceIsBlankNew(working.category)) return 'category';
  if (choiceIsBlankNew(product.pack)) return 'legacyPack';
  if (choiceIsBlankNew(product.unit)) return 'legacyUnit';
  return null;
}

export interface LegacySaveInput {
  readonly working: Working;
  readonly product: LegacyProduct;
  // The item as the card opened (the card of before opens only for an existing item).
  readonly item: ItemLike;
  readonly kind: CardKind;
  readonly startSupplierId: string;
}

// What the card of before's Save sends, EXACTLY (C83): the product data with `unit` from «Order unit» and `packUnit` from
// «Package» — ⚠️ `packUnit` ONLY WHEN THERE IS SOMETHING TO SAY (a word, or one stored) — and NO format key: no packCount, none of
// the new card's machinery. Never a price key (the store writes the money apart), an allergen key (the card adds the groups that
// changed) or `invoiceName`. It never reports a unit change: the order unit is a menu a person chose.
export function buildLegacySave({ working, product, item, kind, startSupplierId }: LegacySaveInput): Readonly<Record<string, unknown>> & { readonly name: string } {
  const packUnit = readChoice(product.pack).slice(0, PACK_WORD_MAX);
  const storedPack = text(item.packUnit);
  return {
    name: working.name.trim(),
    shortName: working.shortName.trim(),
    supplierId: supplierToSave(working.supplierId, startSupplierId),
    brand: working.brand.trim(),
    weight: weightText(working),
    category: readChoice(working.category) || 'Other',
    unit: readChoice(product.unit).slice(0, UNIT_MAX),
    ...(packUnit || storedPack ? { packUnit } : {}),
    ...activePatch(working, item),
    kind,
  };
}
