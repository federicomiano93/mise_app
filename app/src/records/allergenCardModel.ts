import { RECENT_APP_TICK_MS, keepsAppTick, readPackIngredients, reconcileTicks, tickKey } from '@mise/shared/allergen-match';
import {
  NUTRIENT_KEYS, allergenState, buildAllergenFields, checkedAt, isDeclared, missingNutrients, normalizeAllergens,
} from '@mise/shared/allergen-model';
import type { AllergenCode, AllergenFields, AllergenState, NutrientKey } from '@mise/shared/allergen-model';
import { localNumber, typedDecimal } from '@mise/shared/currency';
import type { Money } from '@mise/shared/currency';
import type { CardKind, ItemLike } from './ingredientCardModel';

// The ingredient card's allergens, nutrition and the pack's own ingredient list (parity C98–C116): the pure half of the three
// sections IngredientCard.tsx draws. A port of the judgement inside js/ingredient-record-form.js `allergenBlock`, with the
// matcher and the tick ownership in @mise/shared/allergen-match and every field built by @mise/shared/allergen-model.
//
// ⚠️⚠️ THE ONLY THING THAT WRITES THE VERIFICATION STAMP IS A PERSON TICKING «I HAVE CHECKED» (C102). Opening the card and
// pressing Save never stamps an ingredient; reading the pack never stamps one (C105); and when the APP moves a box on a record
// somebody had verified, the verification lapses and the next confirmation is stamped TODAY (C109, `stampVoided`). ⚠️ DIFFERENCE
// FROM THE CURRENT APP, ON PURPOSE: on a record that OPENED verified, once the app has moved a box the old date is gone for good
// — even if the person un-ticks «I have checked» and ticks it again afterwards, the save stamps NOW, never the old date
// (`openedStamp`). The current app keeps the old date in that sequence.
//
// ⚠️⚠️ DIFFERENCE FROM THE CURRENT APP, ON PURPOSE: the current app writes all five allergen keys on every save of an
// ingredient. Mise 2 writes them in three groups, each only when something in it changed from the copy the card opened on:
//   - the DECLARATION, `allergens` + `mayContain` + `allergensCheckedAt`, always together (the stamp certifies that list);
//   - `packIngredients` (the audit trail, not a declaration);
//   - `nutrition`.
// Otherwise a card left open on a tablet and saved for a rename would write the declaration it opened on over a newer one made
// on another phone meanwhile — an old «contains none», stamped, over a new «contains milk». A NEW ingredient writes all five
// (parity C99), and packaging none (C80). A panel the venue hides writes nothing for an existing item, even typing made before
// it was hidden (`allergenPayload`): hiding stays a display switch, never a data switch (C12, C115).

export type Column = 'contains' | 'may';

export interface AllergenWorking {
  // The ticked codes, in the canonical order (normalizeAllergens).
  readonly contains: readonly AllergenCode[];
  readonly may: readonly AllergenCode[];
  // «I have checked the supplier's specification».
  readonly checked: boolean;
  // The pack's ingredient list as typed.
  readonly packText: string;
  // The eight nutrition boxes as typed ('' = not filled in).
  readonly nutrition: Readonly<Record<NutrientKey, string>>;
  // The tickKey()s the APP put there and may take back. ⚠️ STARTS EMPTY even on a declared item: everything stored belongs to
  // whoever stored it, so opening a saved product and typing can never lose a declaration (C108).
  readonly appOwned: readonly string[];
  // WHEN (a performance.now() value — a steady clock: setting the device clock back cannot make an old tick look recent) the app added each of its own ticks, by tickKey: what `tickByHand` needs to tell «a person undoing
  // the app» from «a tap that landed as the app ticked the same box». Cleared for a key the app removes. Never compared by
  // `allergenDirty`, never saved.
  readonly appTickedAt: Readonly<Record<string, number>>;
  // The tickKey()s a PERSON moved, either way: never proposed or withdrawn again.
  readonly humanTouched: readonly string[];
  // The app moved a box on a verified record: the old date no longer belongs to this list (C109).
  readonly stampVoided: boolean;
  // The verification stamp the item opened with ('' for none, and for a new item). Never changes after the card opens.
  readonly openedStamp: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// The copy the sections are made from: the stored item, or an empty one. Made ONCE, when the card opens.
// ⚠️ A nutrient shows 0 as «0»: null is «not filled in», 0 is a real value (C113). The figure is written in the venue's
// layout (12,5 in Italy) like the price boxes, and read back with typedDecimal, so a comma and a dot both read (T11).
export function allergenWorkingFrom(item: ItemLike | null, money: Money): AllergenWorking {
  const stored = (item?.nutrition && typeof item.nutrition === 'object' ? item.nutrition : {}) as Readonly<Record<string, unknown>>;
  const nutrition = {} as Record<NutrientKey, string>;
  for (const key of NUTRIENT_KEYS) {
    const value = stored[key];
    nutrition[key] = value == null ? '' : localNumber(String(value), money, false);
  }
  return {
    contains: normalizeAllergens(item?.allergens),
    may: normalizeAllergens(item?.mayContain),
    // Pre-ticked when the item is already declared (C102).
    checked: isDeclared(item),
    packText: text(item?.packIngredients),
    nutrition,
    appOwned: [],
    appTickedAt: {},
    humanTouched: [],
    stampVoided: false,
    openedStamp: checkedAt(item),
  };
}

// A person ticked or unticked a box: it becomes theirs, and the app never touches it again (C108). Dropping it from `appOwned`
// at the same time stops the app later «taking back» a box that is no longer its to take.
//
// ⚠️⚠️ THE SAME RULE AS THE CURRENT APP (it took it from here, PR #388; shared allergen-match keepsAppTick): a person's change that would UNTICK a box the app
// ticked LESS THAN `RECENT_APP_TICK_MS` ago leaves the box TICKED — and it becomes the person's, so the app never takes it back
// and a later tap unticks it. Why: someone types «latte» and reaches for Milk «has»; the pause ends just before the finger lands,
// the app ticks Milk, and the tap, which meant «tick it», flips it OFF — and an unticked box a person touched is theirs for good,
// so Milk would be missing. Any other change (a tick on; an untick of a box the app ticked longer ago, or never ticked) is
// exactly what the person asked for.
export { RECENT_APP_TICK_MS };

export function tickByHand(
  working: AllergenWorking, code: AllergenCode, column: Column, on: boolean, now: number,
): AllergenWorking {
  const key = tickKey(code, column);
  const justTickedByApp = keepsAppTick({
    key, on, now, appOwned: new Set(working.appOwned), tickedAt: new Map(Object.entries(working.appTickedAt)),
  });
  const list = new Set<AllergenCode>(working[column]);
  if (on || justTickedByApp) list.add(code);
  else list.delete(code);
  const { [key]: _gone, ...stillApp } = working.appTickedAt;
  return {
    ...working,
    [column]: normalizeAllergens([...list]),
    humanTouched: working.humanTouched.includes(key) ? working.humanTouched : [...working.humanTouched, key],
    appOwned: working.appOwned.filter(owned => owned !== key),
    appTickedAt: stillApp,
  };
}

export const withChecked = (working: AllergenWorking, checked: boolean): AllergenWorking => ({ ...working, checked });

// The pack text as typed. ⚠️ NOTHING IS PROPOSED HERE: the boxes move on a pause in typing (`proposeFromPack`), never per
// keystroke, never on leaving the box and never on the first draw (C106, C107).
export const withPackText = (working: AllergenWorking, packText: string): AllergenWorking => ({ ...working, packText });

export function withNutrient(working: AllergenWorking, key: NutrientKey, typed: string): AllergenWorking {
  return { ...working, nutrition: { ...working.nutrition, [key]: typed } };
}

// What the pack text proposes, moved onto the boxes by reconcileTicks (the rules live there, C108). An empty text withdraws the
// app's own ticks and nothing else. ⚠️⚠️ IF THE APP MOVED ANY BOX (either way) ON A VERIFIED RECORD, «I have checked» is
// un-ticked and the old date is dropped (C109): a box nobody looked at must never be saved under somebody's verification.
export function proposeFromPack(working: AllergenWorking, now: number): AllergenWorking {
  const read = readPackIngredients(working.packText);
  const proposal = read.hasText ? read : { allergens: [], mayContain: [] };
  const next = reconcileTicks({
    proposal,
    current: { contains: [...working.contains], may: [...working.may] },
    appOwned: new Set(working.appOwned),
    humanTouched: new Set(working.humanTouched),
  });
  const moved = next.added > 0 || next.removed > 0;
  // A record that opened verified loses its date when the app moves a box, whether or not the person has un-ticked «I have checked»
  // meanwhile: ticking it again must stamp NOW.
  const voids = moved && (working.checked || working.openedStamp !== '');
  // When the app ADDED each tick: kept for a tick it already owned, stamped `now` for a new one, gone for one it no longer owns.
  const before = new Set(working.appOwned);
  const appTickedAt: Record<string, number> = {};
  for (const key of next.appOwned) appTickedAt[key] = before.has(key) ? (working.appTickedAt[key] ?? now) : now;
  return {
    ...working,
    contains: normalizeAllergens(next.contains),
    may: normalizeAllergens(next.may),
    appOwned: [...next.appOwned],
    appTickedAt,
    checked: voids ? false : working.checked,
    stampVoided: working.stampVoided || voids,
  };
}

// How many boxes the app is proposing right now (the note outside the fold, C109).
export const proposedCount = (working: AllergenWorking): number => working.appOwned.length;

// The note outside the allergen fold: the app ticked N boxes; it did so after a check; or the check has lapsed. ⚠️ It keeps
// speaking after the app withdraws its own ticks: a lapsed verification does not come back (C109).
export type ProposedNote =
  | { readonly kind: 'none' }
  | { readonly kind: 'proposed' | 'proposedAfterCheck'; readonly n: number }
  | { readonly kind: 'voided' };

export function proposedNote(working: AllergenWorking): ProposedNote {
  const n = proposedCount(working);
  if (n > 0) return { kind: working.stampVoided ? 'proposedAfterCheck' : 'proposed', n };
  return working.stampVoided ? { kind: 'voided' } : { kind: 'none' };
}

// The stamp a save would write. Kept when it exists, so re-saving never moves an old verification date; dropped when the app
// moved a box since (a fresh confirmation is stamped `now`); '' when «I have checked» is not ticked.
function stampOf(working: AllergenWorking, item: ItemLike | null, now: string): string {
  if (!working.checked) return '';
  const previous = working.stampVoided ? '' : checkedAt(item);
  return previous || now;
}

// The nutrition boxes as values: '' → null, otherwise the typed figure with a comma read as a dot. normalizeNutrition does the
// rest (a figure above the cap is saved AS the cap — the clamps stay, T11).
function nutritionOf(working: AllergenWorking): Record<NutrientKey, string | null> {
  const out = {} as Record<NutrientKey, string | null>;
  for (const key of NUTRIENT_KEYS) {
    const typed = typedDecimal(working.nutrition[key]);
    out[key] = typed === '' ? null : typed;
  }
  return out;
}

// Every field as the card holds it now, built by the ONE function that builds them (the rules' closed whitelist).
export function allergenDraft(working: AllergenWorking, item: ItemLike | null, now: string): AllergenFields {
  return buildAllergenFields({
    allergens: working.contains,
    mayContain: working.may,
    checkedAt: stampOf(working, item, now),
    nutrition: nutritionOf(working),
    packIngredients: working.packText,
  });
}

// The first nutrition box Save must refuse, and why: 'invalid' = text that is not a plain number, or a negative one; 'thousands' =
// a kJ or kcal figure written with a thousands separator («1,550», «1.550»), which would be read as 1.55 — a wrong energy value
// on a label. ⚠️ A NEW RULE OF MISE 2 (the current app's number boxes drop such text in silence and save the nutrient as empty):
// a figure typed and then lost is a declaration changed without anybody being told. ⚠️ ONLY THE BOXES SOMEBODY CHANGED are
// checked (the text differs from `baseline`): a stored value the card opened with never blocks a save of something else.
export interface NutritionRefusal {
  readonly key: NutrientKey;
  readonly reason: 'invalid' | 'thousands';
}

const PLAIN_NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;
// A leading zero is never a thousands group: «0,125» is 0.125.
const THOUSANDS = /^[1-9]\d{0,2}[.,]\d{3}$/;

export function nutritionRefusal(working: AllergenWorking, baseline: AllergenWorking): NutritionRefusal | null {
  for (const key of NUTRIENT_KEYS) {
    if (working.nutrition[key] === baseline.nutrition[key]) continue;
    const raw = working.nutrition[key].trim();
    if ((key === 'kj' || key === 'kcal') && THOUSANDS.test(raw)) return { key, reason: 'thousands' };
    const typed = typedDecimal(working.nutrition[key]);
    if (typed === '') continue;
    // Number() would accept «0x10», «1e3» and «Infinity»: only digits with one decimal mark are a figure. A «-3» fails here too.
    if (!PLAIN_NUMBER.test(typed)) return { key, reason: 'invalid' };
  }
  return null;
}

// What the status line outside the fold says (C103): the state, and for a declared one the date (YYYY-MM-DD, '' when the stamp
// has none) and the codes it contains.
export interface AllergenStatus {
  readonly state: AllergenState;
  readonly date: string;
  readonly codes: readonly AllergenCode[];
}

export function allergenStatus(working: AllergenWorking, item: ItemLike | null, now: string): AllergenStatus {
  const draft = allergenDraft(working, item, now);
  return { state: allergenState(draft), date: checkedAt(draft).slice(0, 10), codes: draft.allergens };
}

// The nutrition fold's head: how many of the eight are still empty (C112; a box with unreadable text counts as empty).
export const nutritionMissing = (working: AllergenWorking): number => missingNutrients({ nutrition: nutritionOf(working) }).length;

// Is anything in these sections different from the copy taken at open? An app-made tick counts: the boxes changed.
export function allergenDirty(working: AllergenWorking, baseline: AllergenWorking): boolean {
  const comparable = (w: AllergenWorking) => [w.contains, w.may, w.checked, w.packText, NUTRIENT_KEYS.map(key => w.nutrition[key])];
  return JSON.stringify(comparable(working)) !== JSON.stringify(comparable(baseline));
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// What Save adds to the ingredient's payload (see the header): all five keys for a new ingredient, nothing for packaging, and
// for an existing ingredient only the groups whose values differ from what is stored. Both sides go through
// buildAllergenFields, so a stored list in another order or with an unknown code is not «a change».
//
// ⚠️ A PANEL THE VENUE HIDES WRITES NOTHING FOR AN EXISTING ITEM, even typing made before it was hidden (another phone may have
// hidden it while this card was open; the leave-without-saving question still protects that typing). `shown` is REQUIRED — a
// caller that forgot it would write a panel nobody can see — and the card reads it at the moment of the save. A NEW ingredient
// still writes all five (C99).
export interface PanelsShown {
  readonly allergens: boolean;
  readonly nutrition: boolean;
}

export function allergenPayload(
  working: AllergenWorking, item: ItemLike | null, kind: CardKind, now: string,
  shown: PanelsShown,
): Partial<AllergenFields> {
  if (kind === 'packaging') return {};
  const draft = allergenDraft(working, item, now);
  if (!item) return draft;
  const stored = buildAllergenFields({
    allergens: item.allergens,
    mayContain: item.mayContain,
    checkedAt: checkedAt(item),
    nutrition: item.nutrition,
    packIngredients: item.packIngredients,
  });
  const out: Partial<AllergenFields> = {};
  if (shown.allergens && (!same(draft.allergens, stored.allergens) || !same(draft.mayContain, stored.mayContain)
    || draft.allergensCheckedAt !== stored.allergensCheckedAt)) {
    out.allergens = draft.allergens;
    out.mayContain = draft.mayContain;
    out.allergensCheckedAt = draft.allergensCheckedAt;
  }
  if (shown.allergens && draft.packIngredients !== stored.packIngredients) out.packIngredients = draft.packIngredients;
  if (shown.nutrition && !same(draft.nutrition, stored.nutrition)) out.nutrition = draft.nutrition;
  return out;
}
