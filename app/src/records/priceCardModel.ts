import { localNumber, typedDecimal } from '@mise/shared/currency';
import type { Money } from '@mise/shared/currency';
import { unitCost } from '@mise/shared/order-cost';
import { formatChanged } from '@mise/shared/pack-format';
import type { FormatForm, PackFormat } from '@mise/shared/pack-format';
import {
  PRICE_BASES, PRICE_FORMS, PRICE_UNITS,
  basisOf, basisOptions, basisToStore, convertBasisPrice, costReasonText, formatMoney, formatPriceInput,
  formatPricePerUnit, formatRate, isPriceUnit, ownPieceWeight, packBaseOf, positiveNumber, priceBoxStart, priceFormOf,
  pricePatch, pricePerKg, priceUnitLabel, rateBaseOf, shownPrice, singleFromCaseInput, storedCaseOf, storedPriceInput,
  storedPriceToBasis, weightNeededForPrice,
} from '@mise/shared/price-model';
import type { PriceBasis, PriceForm, PriceInput, PriceTranslate } from '@mise/shared/price-model';
import { vatRatesFor } from '@mise/shared/vat-rates';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { formState, orderNow, weightText } from './ingredientCardModel';
import type { ItemLike, Working } from './ingredientCardModel';

// The price on the ingredient card, with no screen in the way (parity C58–C79, C84–C86): the working copy of the price, the
// events that change it, the exact input the save reads, the refusals and everything the section draws, as data. The port of
// priceBlock() of js/ingredient-record-form.js.
//
// ⚠️ THE STATE MIRRORS THE ORIGINAL'S BOXES, NOT ITS MONEY. The original keeps the figures in text boxes and a handful of flags;
// here the text of each box and the same flags are one plain object, and `refresh()` — the part of the original's refresh()
// that WRITES into a box — runs after every event and after every change of the format or the weight (`followFormat`), so a box
// that was only filled, a box a tap wrote and a box a person typed in keep behaving exactly as they did.
//
// ⚠️ UNTOUCHED MEANS UNCHANGED (C67): the price is dirty only for a new item, a person typing in a price box, or «Recalculate» —
// never for a moved format or weight. Until then `readPrice` hands the stored price back verbatim.
//
// ⚠️ NO DRIFT FROM A ROUNDED FIGURE: the box shows a number rounded for the eye, so the money is never read back from its text
// unless the person typed that text (`boxTyped` / `anchor` / `boxCanon` / `written`; see the original's long note).

export type { PriceBasis, PriceForm };

type PriceT = (key: MessageKey, params?: MessageParams) => string;

// The money the card can read a price from: the unrounded figure a person typed and the basis it was typed under.
interface Anchor { readonly value: unknown; readonly basis: PriceBasis | null }

// What a segment tap WROTE in the box: its text, the exact figure behind it and its basis.
interface Written { readonly text: string; readonly value: unknown; readonly basis: PriceBasis | null }

export interface PriceState {
  // The unit menu: '' = «None».
  readonly unit: string;
  // The boxes as they stand, in the venue's layout («7,2» in Italy).
  readonly rate: string;
  readonly pieceKg: string;
  readonly box: string;
  // The price box's placeholder: the carried price, frozen at the moment the person starts typing (as the original's).
  readonly boxHint: string;
  // The VAT menu: '' = not stated, else the rate as text.
  readonly vat: string;
  // The stored choice until a segment is tapped.
  readonly basis: PriceBasis | null;
  readonly priceTyped: boolean;
  readonly recomputed: boolean;
  readonly boxTyped: boolean;
  readonly anchor: Anchor | null;
  // While the box was only FILLED: the figure behind it in the form's own terms (the pack or case price), unrounded.
  readonly boxCanon: number | null;
  readonly written: Written | null;
  // What the leave question compares (the values the original's js/form-dirty.js sees): taken once, when the card opens.
  readonly openedSnapshot: readonly string[];
}

// What the price block asks the card, as plain data — rebuilt by the card each time it draws.
export interface PriceCtx {
  // The item as opened, with its price laid on; null = a new item.
  readonly item: ItemLike | null;
  // The format and the weight text as the card holds them NOW.
  readonly fmt: FormatForm;
  readonly weight: string;
  // 'single' | 'carton' as the card OPENED, and the weight text as it opened.
  readonly openedKind: 'single' | 'carton';
  readonly initialWeight: string;
  // The ingredient as the card would SAVE it: the order unit, package word, count and weight of the VAT line (C78).
  readonly order: { readonly unit: unknown; readonly packUnit: unknown; readonly packCount: unknown; readonly weight: unknown };
  // The interface language's locale tag (numbers inside sentences), the venue's money and its country (the VAT menu).
  readonly locale: string;
  readonly money: Money;
  readonly country: unknown;
}

const RATE_LABEL: Readonly<Record<string, MessageKey>> = {
  kg: 'sup.price.perKg', l: 'sup.price.perLitre', pcs: 'sup.price.perPiece',
};
const RATE_HINT: Readonly<Record<string, MessageKey>> = {
  kg: 'sup.price.eg.perKg', l: 'sup.price.eg.perLitre', pcs: 'sup.price.eg.perPiece',
};

// The words shared/price-model.ts asks for by the current app's dictionary keys, in Mise 2's own keys.
const SHARED_KEYS: Readonly<Record<string, MessageKey>> = {
  'price.byWeight': 'sup.price.byWeight',
  'price.byVolume': 'sup.price.byVolume',
  'price.byPiece': 'sup.price.byPiece',
  'price.none': 'sup.price.noPriceYet',
  'price.needPieceWeight': 'sup.price.needPieceWeight',
  'price.perEach': 'sup.perEach',
};

export function sharedTranslate(t: PriceT): PriceTranslate {
  return (key, params) => {
    const own = SHARED_KEYS[key];
    if (!own) throw new Error(`price-model asked for an unknown phrase: ${key}`);
    return t(own, params);
  };
}

const num = (value: unknown): number => Number(value);
const isBasis = (value: unknown): value is PriceBasis => (PRICE_BASES as readonly unknown[]).includes(value);

// The stored case when it was priced by an EXPLICIT size (kg, g, l, ml), else null.
function explicitSizeCase(item: ItemLike | null) {
  const stored = item ? storedCaseOf(item) : null;
  return stored && ['kg', 'g', 'l', 'ml'].includes(stored.caseItemUnit) ? stored : null;
}

// C46: the size a stored case was priced at, for the weight box to show as a PLACEHOLDER (never a value) with its unit menu
// moved, while the weight no longer reads. null in every other case.
export function weightHintOf(item: ItemLike | null, weight: string): { size: number; unit: string } | null {
  const sized = explicitSizeCase(item);
  if (!sized || packBaseOf(weight) !== null) return null;
  return { size: sized.caseItemSize as number, unit: sized.caseItemUnit };
}

const formOf = (ctx: PriceCtx): PriceForm => priceFormOf(ctx.fmt, ctx.weight, ownPieceWeight(ctx.item, ctx.weight, ctx.initialWeight));

// ── The flags ────────────────────────────────────────────────────────────────

// C67: dirty for a new item, a typed price box or «Recalculate» — NEVER for a moved format or weight.
export const isPriceDirty = (state: PriceState, item: ItemLike | null): boolean => !item || state.priceTyped || state.recomputed;

// A Cartone the person has turned into a Singola, on a price that stands on a case: the same money in the per-item shape.
export const convertsCase = (state: PriceState, ctx: PriceCtx): boolean =>
  !isPriceDirty(state, ctx.item) && Boolean(ctx.item) && ctx.openedKind === 'carton' && ctx.fmt.kind === 'single'
  && Boolean(storedCaseOf(ctx.item));

// A corrected weight on a per-item price whose piece weight was TRACKING the old weight: the new weight in kilos, or null.
export function syncedWeightKg(state: PriceState, ctx: PriceCtx): number | null {
  const item = ctx.item;
  if (isPriceDirty(state, item) || !item || item.priceUnit !== 'pcs') return null;
  const base = packBaseOf(ctx.weight);
  const was = packBaseOf(ctx.initialWeight);
  if (!base || !was || Math.abs(base.size - was.size) < 1e-9) return null;
  const kg = positiveNumber(item.unitWeightKg);
  return kg !== null && Math.abs(kg - was.size) < 1e-9 ? base.size : null;
}

// Two things move the price's SHAPE without moving its MONEY, and neither plants a history entry.
export const keepsMoney = (state: PriceState, ctx: PriceCtx): boolean => convertsCase(state, ctx) || syncedWeightKg(state, ctx) !== null;

const usableAnchor = (state: PriceState, ctx: PriceCtx): Anchor | null => {
  const a = state.anchor;
  return state.boxTyped && a && basisOptions(formOf(ctx)).includes(a.basis as PriceBasis) && positiveNumber(a.value) !== null ? a : null;
};

// The exact figure behind a TYPED box, with its basis — the one source for a tap and for the save, so the two can never part:
// the anchor while its basis is still offered; else what a tap wrote, while the box still shows it; else the box's own figure
// under the basis it is shown in. null for a box nobody typed in.
function typedFigure(state: PriceState, ctx: PriceCtx): { value: unknown; basis: PriceBasis | null } | null {
  const a = usableAnchor(state, ctx);
  if (a) return a;
  if (!state.boxTyped) return null;
  const form = formOf(ctx);
  const w = state.written;
  if (w && state.box === w.text && basisOptions(form).includes(w.basis as PriceBasis)) return { value: w.value, basis: w.basis };
  const shownFigure = positiveNumber(typedDecimal(state.box));
  const shownBasis = basisOf(form, state.basis);
  return shownFigure !== null && shownBasis !== null ? { value: shownFigure, basis: shownBasis } : null;
}

// What the format and the weight now make of the price: shared by refresh() and the view.
function derive(state: PriceState, ctx: PriceCtx) {
  const { fmt, weight, item } = ctx;
  const form = formOf(ctx);
  // A change that keeps the money (a Cartone → Singola, a corrected weight) is not «a format that no longer matches the price».
  const changed = keepsMoney(state, ctx) ? null : formatChanged(item, fmt as PackFormat, weight, ctx.locale);
  const start = priceBoxStart(item, fmt, weight, Boolean(changed));
  const sized = explicitSizeCase(item);
  // A case priced by weight whose weight no longer reads is NOT a case of pieces: the note says what the price was for.
  const needsSize = Boolean(sized) && fmt.kind === 'carton' && packBaseOf(weight) === null;
  return { form, typedForm: form === PRICE_FORMS.typed, changed, start, basisNow: basisOf(form, state.basis), sized, needsSize };
}

const sameState = (a: PriceState, b: PriceState): boolean =>
  (Object.keys(a) as Array<keyof PriceState>).every(key => a[key] === b[key]);
const settled = (previous: PriceState, next: PriceState): PriceState => (sameState(previous, next) ? previous : next);

function writeBox(state: PriceState, ctx: PriceCtx, exact: unknown, basisWritten: PriceBasis | null): PriceState {
  const text = localNumber(shownPrice(exact), ctx.money, false);
  return { ...state, box: text, written: { text, value: exact, basis: basisWritten } };
}

// The part of the original's refresh() that WRITES: a figure a tap wrote follows the weight and the count, and a box nobody
// typed in is filled from the stored price (or empty, with the carried price as its placeholder). Called after every event
// below and by `followFormat`.
function refresh(state: PriceState, ctx: PriceCtx): PriceState {
  const { fmt, weight } = ctx;
  const { form, start, basisNow } = derive(state, ctx);
  const inBasis = (figure: number | null): unknown =>
    (figure === null ? null : shownPrice(storedPriceToBasis(form, basisNow, figure, fmt, weight)));
  let next = state;
  // A figure a tap wrote follows the weight and the count: re-derived from what was typed, in the basis shown.
  const a = usableAnchor(state, ctx);
  if (state.priceTyped && state.written && a && state.box === state.written.text) {
    const exact = convertBasisPrice(form, a.basis, basisNow, a.value, fmt, weight, 12);
    if (exact !== null) next = writeBox(next, ctx, exact, basisNow);
  }
  if (!state.priceTyped) {
    const figure = state.recomputed ? start.suggestion : start.value;
    const shown = inBasis(figure);
    const suggested = inBasis(start.suggestion);
    next = {
      ...next,
      written: null,
      boxCanon: figure,
      box: shown === null ? '' : localNumber(shown, ctx.money, false),
      boxHint: shown === null && suggested !== null ? localNumber(suggested, ctx.money, false) : '',
    };
  }
  return settled(state, next);
}

// What the leave question compares: the unit, the boxes, the VAT and the basis the segments show (a tap is a change, C65).
function snapshotOf(state: PriceState, ctx: PriceCtx): readonly string[] {
  return [state.unit, state.rate, state.pieceKg, state.box, state.vat, basisOf(formOf(ctx), state.basis) ?? ''];
}

// Has the person changed anything in the price since the card opened? (C65, C91)
export function isPriceEdited(state: PriceState, ctx: PriceCtx): boolean {
  return JSON.stringify(snapshotOf(state, ctx)) !== JSON.stringify(state.openedSnapshot);
}

// ── Opening ──────────────────────────────────────────────────────────────────

const boxText = (value: unknown, money: Money): string =>
  (value === null || value === undefined || value === '' ? '' : localNumber(value, money, false));

// The price as the card opens it. `defaultUnit` is how a NEW item starts: 'pcs' for packaging (C59), else null. `ctx` is the
// card as it opens (its weight and format are the opened ones).
export function priceStateFrom(item: ItemLike | null, defaultUnit: 'pcs' | null, ctx: PriceCtx): PriceState {
  const unit = item ? (isPriceUnit(item.priceUnit) ? item.priceUnit : '') : (defaultUnit ?? '');
  const storedVat = item && item.vatRate != null ? Number(item.vatRate) : null;
  const first: PriceState = {
    unit,
    rate: boxText(item?.pricePerUnit, ctx.money),
    pieceKg: boxText(item?.unitWeightKg, ctx.money),
    box: '',
    boxHint: '',
    vat: storedVat !== null && Number.isFinite(storedVat) ? String(storedVat) : '',
    basis: item && isBasis(item.priceBasis) ? item.priceBasis : null,
    priceTyped: false,
    recomputed: false,
    boxTyped: false,
    anchor: null,
    boxCanon: null,
    written: null,
    openedSnapshot: [],
  };
  const filled = refresh(first, ctx);
  return { ...filled, openedSnapshot: snapshotOf(filled, ctx) };
}

// ── The events: each returns the next state (the SAME state when nothing happened) ─────────────────────────────

// ⚠️ THE FLAG IS SET BEFORE refresh() RUNS, so the box a person is typing in is never refilled under their fingers.
export function typeBox(state: PriceState, ctx: PriceCtx, text: string): PriceState {
  // What the person typed, unrounded, under the basis it was typed in.
  return refresh({
    ...state, box: text, priceTyped: true, boxTyped: true, written: null,
    anchor: { value: typedDecimal(text), basis: basisOf(formOf(ctx), state.basis) },
  }, ctx);
}

export const typeRate = (state: PriceState, ctx: PriceCtx, text: string): PriceState => refresh({ ...state, rate: text, priceTyped: true }, ctx);
export const typeUnit = (state: PriceState, ctx: PriceCtx, unit: string): PriceState => refresh({ ...state, unit, priceTyped: true }, ctx);
export const typePieceKg = (state: PriceState, ctx: PriceCtx, text: string): PriceState => refresh({ ...state, pieceKg: text, priceTyped: true }, ctx);
// The VAT is independent of the price: moving it never makes the price dirty.
export const chooseVat = (state: PriceState, ctx: PriceCtx, vat: string): PriceState => refresh({ ...state, vat }, ctx);

// «Recalculate» says «recompute it from the format now on screen»: it only sets the flag and lets the box speak.
export const recompute = (state: PriceState, ctx: PriceCtx): PriceState => refresh({ ...state, recomputed: true }, ctx);

// A segment was tapped. A number already typed is CONVERTED, not kept: the same money in the new basis, from the unrounded
// figure. ⚠️ When the conversion is impossible (an empty carton count) the tap does NOTHING: the SAME state comes back, the
// typed number and the segment stay (C65). A price nobody touched is re-shown by refresh() from the stored one.
export function tapBasis(state: PriceState, ctx: PriceCtx, next: PriceBasis): PriceState {
  const form = formOf(ctx);
  const from = basisOf(form, state.basis);
  if (from === next || !basisOptions(form).includes(next)) return state;
  let working = state;
  const a = typedFigure(state, ctx);
  if (a) {
    const converted = convertBasisPrice(form, a.basis, next, a.value, ctx.fmt, ctx.weight, 12);
    if (converted === null) return state;
    working = writeBox(working, ctx, converted, next);
  }
  return refresh({ ...working, basis: next }, ctx);
}

// The format or the weight changed: a figure a tap wrote follows them, and a box nobody typed in is filled again. Call it
// with the context built from the NEW values, whenever the weight, the count, the format or the inner word change.
export const followFormat = (state: PriceState, ctx: PriceCtx): PriceState => refresh(state, ctx);

// ── What the save reads ──────────────────────────────────────────────────────

// EXACTLY the original's read(): an untouched price hands pricePatch the STORED price (storedPriceInput, or
// singleFromCaseInput for a Cartone turned into a Singola, with the piece weight that followed a corrected weight); a dirty one
// is worked out from the exact figure behind the box (formatPriceInput). `priceBasis` always rides along.
export function readPrice(state: PriceState, ctx: PriceCtx): PriceInput {
  const { item, fmt, weight } = ctx;
  const form = formOf(ctx);
  const priceBasis = basisToStore(form, state.basis);
  if (!isPriceDirty(state, item)) {
    const input = convertsCase(state, ctx) ? singleFromCaseInput(item, state.vat) : storedPriceInput(item, state.vat);
    const synced = syncedWeightKg(state, ctx);
    return { ...input, ...(synced === null ? {} : { unitWeightKg: synced }), priceBasis };
  }
  // The price box's figure, unrounded: a filled-only box hands over the figure behind it in the form's own terms (no basis to
  // apply), a typed one is converted from what was typed.
  let price: unknown = typedDecimal(state.box);
  let priceFor: PriceBasis | null = state.basis;
  const a = typedFigure(state, ctx);
  if (!state.boxTyped && state.boxCanon !== null) {
    price = state.boxCanon;
    priceFor = null;
  } else if (a) {
    const exact = convertBasisPrice(form, a.basis, basisOf(form, state.basis), a.value, fmt, weight, 12);
    if (exact !== null) price = exact;
  }
  return {
    ...formatPriceInput(fmt, weight, {
      ownPiece: ownPieceWeight(item, weight, ctx.initialWeight),
      price,
      basis: priceFor,
      rate: typedDecimal(state.rate),
      unit: state.unit || null,
      pieceKg: typedDecimal(state.pieceKg),
      vat: state.vat,
    }),
    priceBasis,
  };
}

// ── Refusals (C62, C70) ──────────────────────────────────────────────────────

export type PriceRefusal = 'weight' | 'rate' | 'box' | 'pieceKg';

const showsPieceWeight = (state: PriceState, ctx: PriceCtx): boolean => {
  const { form, typedForm, needsSize } = derive(state, ctx);
  return !(needsSize || !((typedForm && state.unit === 'pcs') || form === PRICE_FORMS.cartonPieces));
};

// ⚠️ A case priced by weight, typed over with a weight that no longer reads, has no size to price by: refused ON THE WEIGHT BOX
// ('weight', the sentence «the weight of one item is needed»), never stored as pieces (C70). Otherwise the first price box that
// SHOWS text which is not a number above zero ('1.234,5', 'abc', '0'): refused on that box. An empty box is not refused (that is
// how a price is removed). Called after the format refusals of the card (C84).
export function priceRefusal(state: PriceState, ctx: PriceCtx): PriceRefusal | null {
  if (weightNeededForPrice({
    item: ctx.item, fmt: ctx.fmt, weightText: ctx.weight, dirty: isPriceDirty(state, ctx.item), priceBox: typedDecimal(state.box),
  })) return 'weight';
  const { typedForm } = derive(state, ctx);
  const boxes: Array<[PriceRefusal, string, boolean]> = [
    ['rate', state.rate, typedForm],
    ['box', state.box, !typedForm],
    ['pieceKg', state.pieceKg, showsPieceWeight(state, ctx)],
  ];
  for (const [name, value, shown] of boxes) {
    if (!shown) continue;
    const typed = typedDecimal(value);
    if (typed === '') continue;
    const n = Number(typed);
    if (!(Number.isFinite(n) && n > 0)) return name;
  }
  return null;
}

// ── What the section draws ───────────────────────────────────────────────────

export interface SegmentView { readonly value: PriceBasis; readonly label: string; readonly pressed: boolean }

export interface PriceView {
  readonly form: PriceForm;
  // The unit menu + rate box (a loose item) or the single price box.
  readonly typedForm: boolean;
  readonly unit: { readonly value: string; readonly label: string; readonly options: ReadonlyArray<{ value: string; label: string }> };
  readonly rate: { readonly value: string; readonly label: string; readonly placeholder: string };
  readonly box: { readonly value: string; readonly label: string; readonly placeholder: string };
  // The segments (nothing for a form with no basis), labelled by the box's label; `pressed` is the one in force.
  readonly segments: readonly SegmentView[];
  // The format-changed note and whether «Recalculate» shows with it; null when nothing changed.
  readonly changedNote: { readonly text: string; readonly showRecompute: boolean } | null;
  readonly keepsNote: string | null;
  readonly priceAgainNote: string | null;
  readonly exVatNote: string;
  readonly pieceWeight: { readonly shown: boolean; readonly value: string; readonly label: string; readonly hint: string; readonly placeholder: string };
  readonly vat: { readonly value: string; readonly label: string; readonly options: ReadonlyArray<{ value: string; label: string }> };
  // The live line: the numbers on top, what is still missing underneath; muted while there is no price.
  readonly summary: { readonly main: string; readonly note: string; readonly muted: boolean };
  // «{net} without VAT, {gross} with VAT at {rate}%», empty until both a cost and a rate are known.
  readonly vatLine: string;
}

export function priceView(state: PriceState, ctx: PriceCtx, t: PriceT): PriceView {
  const { fmt, weight, item, money } = ctx;
  const sharedT = sharedTranslate(t);
  const { form, typedForm, changed, start, basisNow, sized, needsSize } = derive(state, ctx);
  const currency = money.symbol;
  const dirty = isPriceDirty(state, item);
  const rateBase = rateBaseOf(weight);
  const options = basisOptions(form);

  const segments: SegmentView[] = (['case', 'pack', 'rate'] as const)
    .filter(value => options.includes(value))
    .map(value => ({
      value,
      pressed: value === basisNow,
      label: value === 'pack' ? t('sup.price.basis.pack')
        : value === 'case' ? t('sup.price.basis.case')
          : (rateBase === 'l' ? t('sup.price.basis.perLitre') : t('sup.price.basis.perKg')),
    }));

  const boxLabel = basisNow === 'rate'
    ? (rateBase === 'l' ? t('sup.price.perLitre', { currency }) : t('sup.price.perKg', { currency }))
    : (basisNow === 'pack' ? t('sup.price.case.packPrice', { currency })
      : basisNow === 'case' ? t('sup.price.case.price', { currency })
        : (fmt.kind === 'carton' ? t('sup.price.case.price', { currency }) : t('sup.price.case.packPrice', { currency })));

  const rateKey = RATE_LABEL[state.unit];
  const hintKey = RATE_HINT[state.unit];

  // The note under the pair: a size the price was for, or a format that moved since the last price.
  const recomputeShown = !(dirty || needsSize || start.suggestion === null);
  const changedNote = needsSize && sized
    ? {
      text: t('sup.price.case.sizeNeeded', {
        count: sized.caseCount, size: `${(sized.caseItemSize as number).toLocaleString(ctx.locale)} ${sized.caseItemUnit}`,
      }),
      showRecompute: recomputeShown,
    }
    : (changed ? { text: t('sup.price.case.packChanged', { old: changed.old, new: changed.new }), showRecompute: recomputeShown } : null);

  // The saved price is still what Save writes: said when the box has nothing of its own to show.
  const boxEmpty = typedDecimal(state.box) === '';
  const hasPrice = positiveNumber(item?.pricePerUnit) !== null;
  const keeps = !dirty && !typedForm && hasPrice && boxEmpty && !needsSize;
  const keepsNote = keeps
    ? t(!changedNote || !changedNote.showRecompute ? 'sup.price.case.keepsPriceTyped' : 'sup.price.case.keepsPrice', {
      price: formatPricePerUnit(item, money, sharedT),
    })
    : null;
  // A price that existed and has no number under the new format: said, because saving it empty would remove the price.
  const priceAgainNote = dirty && !typedForm && boxEmpty && hasPrice ? t('sup.price.priceAgain') : null;

  // ── the VAT menu: «— not stated», the country's rates, and a stored rate the list lacks (C75)
  const vatChoices = vatRatesFor(ctx.country);
  const storedVat = item && item.vatRate != null ? Number(item.vatRate) : null;
  const vatOptions = [
    { value: '', label: t('sup.price.vat.notStated') },
    // The Food cost key already carries the number («{rate}% — standard»): filled in rather than prefixed again.
    ...vatChoices.map(({ rate, key }) => ({ value: String(rate), label: t(key as MessageKey, { rate }) })),
  ];
  if (storedVat !== null && Number.isFinite(storedVat) && !vatChoices.some(choice => choice.rate === storedVat)) {
    vatOptions.push({ value: String(storedVat), label: `${storedVat}%` });
  }

  // ── the live line
  const draft = pricePatch(readPrice(state, ctx), '', weight);
  let summary: PriceView['summary'];
  let vatLine = '';
  if (draft.pricePerUnit === null) {
    summary = { main: costReasonText(draft, sharedT), note: '', muted: true };
  } else {
    const perKg = pricePerKg(draft);
    const equals: string[] = [];
    // ⚠️ TYPED PER KILO OR LITRE, the line says the OTHER figures instead — what a pack and a carton cost.
    if (basisNow === 'rate') {
      const size = packBaseOf(weight)?.size ?? null;
      const casePrice = draft.casePrice ?? 0;
      const caseCount = draft.caseCount ?? 0;
      const packPrice = form === PRICE_FORMS.cartonPack
        ? (casePrice > 0 && caseCount > 0 ? casePrice / caseCount : null)
        : (draft.priceUnit === 'pcs' ? draft.pricePerUnit : (size === null ? null : draft.pricePerUnit * size));
      if (form === PRICE_FORMS.cartonPack && casePrice > 0) equals.push(t('sup.price.basis.caseEquals', { price: formatMoney(casePrice, money) }));
      if (packPrice !== null) equals.push(t('sup.price.basis.packEquals', { price: formatMoney(packPrice, money) }));
    }
    const parts = equals.length ? equals : [typedForm ? formatPricePerUnit(draft, money, sharedT) : caseSummary(draft, fmt, form, money, t)];
    if (!equals.length && draft.priceUnit === 'pcs' && perKg !== null) parts.push(`${formatRate(perKg, money)} / kg`);
    summary = { main: parts.filter(Boolean).join('  ·  '), note: costReasonText(draft, sharedT), muted: false };

    // ⚠️ THE SAME unitCost() ORDERS ITSELF CALLS, fed the order unit, the package word, the count and the weight as they stand
    // in the open card, not the stored ones (C78).
    const cost = unitCost({ ...(item || {}), ...ctx.order }, draft);
    const vat = draft.vatRate;
    if (cost !== null && vat !== null) {
      vatLine = t('sup.price.vat.summaryLine', { net: formatMoney(cost, money), gross: formatMoney(cost + (cost * vat) / 100, money), rate: vat });
    }
  }

  return {
    form,
    typedForm,
    unit: {
      value: state.unit,
      label: t('sup.price.howBought'),
      options: [
        { value: '', label: t('sup.price.none') },
        ...PRICE_UNITS.map(unit => ({ value: unit, label: priceUnitLabel(unit, sharedT) })),
      ],
    },
    rate: {
      value: state.rate,
      label: rateKey ? t(rateKey, { currency }) : t('sup.price.generic', { currency }),
      // ⚠️ The example follows the UNIT, and an unknown unit gets none: «(un chilo)» left showing while somebody is pricing by
      // the piece is worse than no example (C60).
      placeholder: hintKey ? t(hintKey) : '',
    },
    box: { value: state.box, label: boxLabel, placeholder: state.boxHint },
    segments,
    changedNote,
    keepsNote,
    priceAgainNote,
    exVatNote: t('sup.price.exVatNote'),
    pieceWeight: {
      shown: showsPieceWeight(state, ctx),
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

// «= 2.00 / kg · 5.00 per bag» — the rate the case works out to, and what ONE item costs.
function caseSummary(
  draft: { priceUnit: unknown; pricePerUnit: number | null; casePrice: number | null; caseCount: number | null },
  fmt: FormatForm, form: PriceForm, money: Money, t: PriceT,
): string {
  const parts = [draft.priceUnit === 'pcs'
    ? t('sup.price.case.summaryPiece', { rate: formatRate(draft.pricePerUnit, money) })
    : t('sup.price.case.summaryUnit', { rate: formatRate(draft.pricePerUnit, money), unit: String(draft.priceUnit) })];
  const inner = String(fmt.inner || '').trim();
  if (form === PRICE_FORMS.cartonPack && inner && num(draft.caseCount) > 0) {
    parts.push(t('sup.price.case.perItem', { price: formatMoney(num(draft.casePrice) / num(draft.caseCount), money), item: inner }));
  }
  return parts.join('  ·  ');
}

// ── Building the context from the card ───────────────────────────────────────

// What the card knows that the price block needs and that never changes while it is open.
export interface PriceFacts {
  readonly item: ItemLike | null;
  readonly lang: unknown;
  readonly money: Money;
  readonly locale: string;
  readonly country: unknown;
  readonly openedKind: 'single' | 'carton';
  readonly initialWeight: string;
}

// The context for a working copy of the card: the format and the weight as it holds them NOW, and the ingredient as it would be
// saved (the order unit the format writes, for the VAT line). `priceDirty` is the price's own flag (false while it is built).
export function priceCtxOf(working: Working, facts: PriceFacts, priceDirty: boolean): PriceCtx {
  return {
    item: facts.item,
    fmt: formState(working),
    weight: weightText(working),
    openedKind: facts.openedKind,
    initialWeight: facts.initialWeight,
    order: orderNow(working, facts.item, { mayPrice: true, lang: facts.lang, priceDirty }),
    locale: facts.locale,
    money: facts.money,
    country: facts.country,
  };
}
