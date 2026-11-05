import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { kindOf } from '@mise/shared/ingredient-kind';
import { cleanUnit, sameUnit } from '@mise/shared/order-unit';
import { formatOf, formatPatch, formatTouched, isCartonWord, parseCount } from '@mise/shared/pack-format';
import type { FormatBefore, FormatForm } from '@mise/shared/pack-format';
import { isUnusableWeight, joinWeight, splitWeight } from '@mise/shared/pack-size';
import type { WeightUnit } from '@mise/shared/pack-size';
import {
  cartonWordFor, categoryValue, defaultPackFor, isBlankNewChoice, supplierToSave,
} from '@mise/shared/record-choices';

// The ingredient card's working copy, the rules of its Save and the exact payload it sends (parity C36–C57, C80–C81,
// C84–C87): the pure half of IngredientCard.tsx. Product data only (step 3e-2): the price, the allergens and the nutrition
// come with 3e-3 and 3e-4, and until then NONE of their keys is ever in a payload, so a merge write leaves them exactly as
// they are stored.
//
// ⚠️ THE FOOD WORDS HERE (the carton word, the package words, the categories) FOLLOW THE VENUE'S COUNTRY: every function that
// writes or offers one takes `lang`, the venue's OUTPUT language (shared/market.ts outputLanguage), never the screen's.

// What a document may hold: it is data, so anything can arrive.
export type ItemLike = Readonly<Record<string, unknown>>;

export type CardKind = 'ingredient' | 'packaging';

// js/records.js NO_SUPPLIER_ID: what is STORED as `supplierId` for «no supplier» (the supermarket, the cash & carry).
export const NO_SUPPLIER_ID = 'no-supplier';

// js/ingredient-record-form.js NEW_CHOICE: the «+ New …» option of a menu. Not a word anybody files under.
export const NEW_CHOICE = '__mise_new__';

// The limits firestore.rules put on the ingredients whitelist (parity C19, decision T12 for the name).
export const NAME_MAX = 200;
export const SHORT_NAME_MAX = 60;
export const BRAND_MAX = 200;
export const CATEGORY_MAX = 200;
export const PACK_WORD_MAX = 40;

// A menu with «+ New …»: the option chosen (a word, '' for none, or NEW_CHOICE) and the text typed for the new one.
export interface ChoiceState {
  readonly choice: string;
  readonly typed: string;
}

// The weight box and its unit menu; `legacy` is the stored text they cannot show («6x1kg», «sacco»), kept until a usable
// number is typed or «Remove» is pressed.
export interface WeightState {
  readonly amount: string;
  readonly unit: WeightUnit;
  readonly legacy: string;
}

export interface Working {
  readonly name: string;
  readonly shortName: string;
  readonly supplierId: string;
  readonly brand: string;
  readonly category: ChoiceState;
  readonly weight: WeightState;
  readonly format: 'single' | 'carton';
  // The count box as typed.
  readonly count: string;
  readonly inner: ChoiceState;
  // The package word «Case» picked for itself, taken back when the person returns to «Single» having chosen nothing (C51).
  readonly innerAutoSet: boolean;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const readChoice = (state: ChoiceState): string => (state.choice === NEW_CHOICE ? state.typed.trim() : state.choice);

// «+ New …» was picked and its box is empty: saving would silently clear the category or leave the case with no word.
export const choiceIsBlankNew = (state: ChoiceState): boolean => isBlankNewChoice(state.choice === NEW_CHOICE, state.typed);

export interface OpenContext {
  // The ids of the suppliers the menu offers: a stored id that matches none falls to «No supplier» (C39).
  readonly supplierIds: readonly string[];
  // A supplier to start a NEW item on (opened from that supplier's screen). ⚠️ NEVER APPLIED TO AN EXISTING ITEM: it would
  // silently re-file somebody else's product the moment its card was opened from the wrong place.
  readonly preset: string | null;
}

// The format as the card OPENS it. No price is read in this step, so a carton with no packCount shows an empty count.
export function openedFormat(item: ItemLike | null) {
  return formatOf(item, null);
}

// What formatPatch compares the card with: the format as it opened, plus the stored order unit and package word.
export function formatBeforeOf(item: ItemLike | null): FormatBefore {
  return { ...openedFormat(item), unit: item?.unit || '', packUnit: item?.packUnit || '' };
}

// The copy a card is made from: the stored item, or an empty one (a new item starts empty, with placeholders).
// ⚠️ MADE ONCE, when the card opens: an item changed on another phone afterwards never replaces it.
export function workingFrom(item: ItemLike | null, { supplierIds, preset }: OpenContext): Working {
  const wanted = item ? text(item.supplierId) : (preset ?? '');
  const opened = openedFormat(item);
  const weight = splitWeight(item?.weight);
  return {
    name: text(item?.name),
    shortName: text(item?.shortName),
    supplierId: supplierIds.includes(wanted) ? wanted : NO_SUPPLIER_ID,
    brand: text(item?.brand),
    // The stored string is matched EXACTLY, so an unrelated save never changes a spelling (C42).
    category: { choice: categoryValue(item?.category), typed: '' },
    weight: { amount: weight.amount, unit: weight.unit, legacy: weight.legacy ?? '' },
    format: opened.kind,
    count: opened.count === null ? '' : String(opened.count),
    inner: { choice: opened.inner, typed: '' },
    innerAutoSet: false,
  };
}

// «Single» or «Case» pressed. Picking «Case» with no inner word picks the venue's default one, so the normal path is never
// refused; returning to «Single» un-picks it only when the person chose nothing (C51).
export function withFormat(working: Working, next: 'single' | 'carton', lang: unknown): Working {
  if (next === working.format) return working;
  if (next === 'carton' && readChoice(working.inner) === '') {
    return { ...working, format: next, inner: { choice: defaultPackFor(lang), typed: '' }, innerAutoSet: true };
  }
  if (next === 'single' && working.innerAutoSet) {
    return { ...working, format: next, inner: { choice: '', typed: '' }, innerAutoSet: false };
  }
  return { ...working, format: next };
}

// Anything the person does to the inner-word menu makes its value theirs.
export function withInner(working: Working, inner: ChoiceState): Working {
  return { ...working, inner, innerAutoSet: false };
}

// The weight as it would be STORED: the joined text, or the kept legacy text when no usable number is typed.
export const weightText = (working: Working): string => joinWeight(working.weight.amount, working.weight.unit) || working.weight.legacy;

// The format as the card holds it NOW. ⚠️ A typed count that is not a whole number is NaN, not «empty»: it must count as
// touched and be refused, never be ignored (C56).
export function formState(working: Working): FormatForm {
  const raw = working.count.trim();
  return { kind: working.format, count: raw === '' ? null : (parseCount(raw) ?? NaN), inner: readChoice(working.inner) };
}

// Is anything different from the copy taken at open? The rule of js/form-dirty.js: what the boxes hold, compared with what
// they held when the card was built. A «+ New …» box counts only while it is the option chosen.
export function isDirty(working: Working, baseline: Working): boolean {
  return JSON.stringify(comparable(working)) !== JSON.stringify(comparable(baseline));
}

function comparable(working: Working) {
  const choice = (state: ChoiceState) => (state.choice === NEW_CHOICE ? [state.choice, state.typed] : [state.choice]);
  return [
    working.name, working.shortName, working.supplierId, working.brand, choice(working.category),
    working.weight.amount, working.weight.unit, working.weight.legacy,
    working.format, working.count, choice(working.inner),
  ];
}

// Where Save was refused, and so where the sentence goes and the focus.
export type RefusedField = 'name' | 'weight' | 'category' | 'inner' | 'count' | 'innerEmpty';

// The first reason Save cannot go on, in the card's order (parity C84):
//  - an empty name;
//  - the first of weight / category / the inner word's «+ New …» box (only while «Case» is showing) that is unusable;
//  - a Case being WRITTEN (the format moved) with a count that is not a whole 1..10000 — checked before the inner word;
//  - the same with no inner word.
// ⚠️ A CASE NOTHING MOVED IS NEVER REFUSED (C85): an old product that opens as a carton with no count saves untouched.
export function firstRefusal(working: Working, item: ItemLike | null): RefusedField | null {
  if (working.name.trim() === '') return 'name';
  if (isUnusableWeight(working.weight.amount, working.weight.unit)) return 'weight';
  if (choiceIsBlankNew(working.category)) return 'category';
  if (working.format === 'carton' && choiceIsBlankNew(working.inner)) return 'inner';
  const state = formState(working);
  if (state.kind === 'carton' && formatTouched(formatOf(item, null), state)) {
    if (parseCount(working.count) === null) return 'count';
    if (readChoice(working.inner) === '') return 'innerEmpty';
  }
  return null;
}

export interface SaveInput {
  readonly working: Working;
  // The item as the card opened (null = new) and the kind it is filed under, which is fixed while the card is open.
  readonly item: ItemLike | null;
  readonly kind: CardKind;
  // The venue's output language.
  readonly lang: unknown;
  // The supplier the card opened on: the fallback if the menu's marker were ever still showing (supplierToSave).
  readonly startSupplierId: string;
}

export interface SaveBuilt {
  readonly payload: Readonly<Record<string, unknown>> & { readonly name: string };
  // The order unit the format has just replaced, to freeze in the open order line ('' = nothing to freeze).
  readonly unitChangedFrom: string;
}

// What Save sends, EXACTLY (parity C87). No price key, no allergen key, no nutrition key, never `invoiceName` or the supplier
// codes: the write is a merge, so everything not named here stays as stored.
export function buildSave({ working, item, kind, lang, startSupplierId }: SaveInput): SaveBuilt {
  const state = formState(working);
  const cartonWord = cartonWordFor(lang);
  const formatKeys = formatPatch(formatBeforeOf(item), { ...state, cartonWord });
  // ⚠️ THE RULES CAP THE PACKAGE WORD AT 40: cut it here rather than have the whole save refused.
  if (formatKeys.packUnit) formatKeys.packUnit = formatKeys.packUnit.slice(0, PACK_WORD_MAX);
  const payload = {
    name: working.name.trim(),
    // '' when blank, never omitted: a merge write must be able to CLEAR a display name.
    shortName: working.shortName.trim(),
    supplierId: supplierToSave(working.supplierId, startSupplierId),
    brand: working.brand.trim(),
    weight: weightText(working),
    // A blank category is saved as the stored «no category» word, which reads back as blank.
    category: readChoice(working.category) || 'Other',
    // A NEW item gets an empty order unit (a price, later, may give it a loose one).
    ...(item ? {} : { unit: '' }),
    ...formatKeys,
    active: item ? item.active !== false : true,
    kind,
  };
  return { payload, unitChangedFrom: replacedUnit(item, payload, state, cartonWord) };
}

// The order unit a format change REPLACED, told to the store, which freezes the open order line in it (parity C35, the
// current app's «replacedUnit»). A line typed as «8» in the old unit must not start reading 8 of the new one.
//  - An empty unit on a card that opened as a Case already meant «the whole case»: turned into a Single, the line is frozen
//    in the carton word it always meant.
//  - Otherwise, when the unit written differs from the stored one, the stored unit — or, for an item stored with none, its
//    package word (an item with no unit meant ONE item per untouched line, which is one package).
//  - EXCEPT the same empty unit turned into a Case: the carton word now written means what '' meant, so nothing is frozen.
function replacedUnit(
  item: ItemLike | null,
  payload: Readonly<Record<string, unknown>>,
  state: FormatForm,
  cartonWord: string,
): string {
  if (!item) return '';
  const emptyMeantCase = cleanUnit(item.unit) === '' && openedFormat(item).kind === 'carton';
  if (emptyMeantCase && state.kind === 'single' && 'unit' in payload) return cartonWord;
  if ('unit' in payload && !sameUnit(payload.unit, item.unit)) {
    const wasWholeCase = emptyMeantCase && isCartonWord(payload.unit);
    if (wasWholeCase) return '';
    return cleanUnit(item.unit) || cleanUnit('packUnit' in payload ? payload.packUnit : item.packUnit);
  }
  return '';
}

// What the card calls the item in sentences («Save “Flour”?»): the name it shows in lists.
export const labelOf = (payload: Readonly<Record<string, unknown>>): string => ingredientDisplayName(payload);

// The kind an existing item is filed under, or the one the address asked for.
export const kindFor = (item: ItemLike | null, packaging: boolean): CardKind => (item ? kindOf(item) : (packaging ? 'packaging' : 'ingredient'));
