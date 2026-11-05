// pack-size.ts — how many kilos one pack holds, read from free text.
//
// TypeScript port of js/pack-size.js for Mise 2. Behaviour is identical, input for input:
// pack-size.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones the
// original paid for in bugs.
//
// PURE (P15). Moved out of js/inventory/inventory-value.js (29 Sep 2026):
// order-cost.ts needs the exact same reading — "4 sacks of 25kg" is 4
// ordered units of a 25kg pack — and a calculation shared by more than one
// feature belongs in the shared base, not inside one feature's folder. This file only ever
// answers the one question in its name.
//
// ⚠️⚠️ THE AWKWARD JOINT THIS FILE EXISTS FOR. The price on an ingredient is
// per KILO (or per litre, or per piece); what a person can actually read off
// a pack, or type into an order, is a COUNT of packs — sacks, cases, boxes.
// To turn one into the other you need the one number this app has never
// held as its own field: how much one pack weighs. What it holds instead is
// `weight`, a FREE TEXT field somebody typed — "25kg", "2.27kg", "6x1kg",
// "sacco".
//
// So: the text is read where it CAN be read, and where it cannot, THE ROW
// STILL COUNTS — it simply has no money beside it. No number is ever
// invented. A guessed pack weight would not look wrong on the screen; it
// would just make the cost wrong.

// Everything convertible to kilos, and the one deliberate equivalence:
// ⚠️ 1 LITRE IS TREATED AS 1 KG, exactly as price-model.ts already does for
// prices. It is wrong for oil and right for milk and water; it is the app's
// existing convention, and having a pack's weight disagree with its price
// would be worse than either.
const TO_KG: Readonly<Record<string, number>> = { kg: 1, g: 0.001, l: 1, lt: 1, ml: 0.001, cl: 0.01 };
const UNIT = '(kg|lt|ml|cl|g|l)';
const NUMBER = '([0-9]+(?:[.,][0-9]+)?)';

// "6 x 1kg" / "12x500g" — a case of several packs. The multiplier comes first.
const MULTIPLIED = new RegExp(`^${NUMBER}\\s*[x×*]\\s*${NUMBER}\\s*${UNIT}$`, 'i');
// "25kg" / "2,27 kg" / "500 g"
const PLAIN = new RegExp(`^${NUMBER}\\s*${UNIT}$`, 'i');
// "kg 5" — the unit first, which is how a lot of Italian invoices are written.
const UNIT_FIRST = new RegExp(`^${UNIT}\\s*${NUMBER}$`, 'i');

const num = (text: unknown): number => Number(String(text).replace(',', '.'));

// Every group of the three patterns above is mandatory, so a match always has them all; the
// compiler cannot know that, and `?? ''` / `?? NaN` are what the original's `undefined` would turn
// into (NaN is no kilo count: the callers answer null for it).
const group = (match: RegExpMatchArray, index: number): string => match[index] ?? '';
const kilosPer = (unit: string): number => TO_KG[unit] ?? NaN;

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

// How many kilos one pack holds, read from the text somebody typed.
//
// ⚠️ IT ANSWERS null FAR MORE OFTEN THAN IT GUESSES, and that is the design. A
// weight it cannot read is a row with no money beside it and a line on the
// screen saying so — which somebody can fix in one tap. A guess would be a
// wrong cost that looks exactly like a right one.
export function parsePackSize(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const clean = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!clean) return null;

  let m = clean.match(MULTIPLIED);
  if (m) {
    const total = num(group(m, 1)) * num(group(m, 2)) * kilosPer(group(m, 3));
    return Number.isFinite(total) && total > 0 ? round3(total) : null;
  }
  m = clean.match(PLAIN);
  if (m) {
    const total = num(group(m, 1)) * kilosPer(group(m, 2));
    return Number.isFinite(total) && total > 0 ? round3(total) : null;
  }
  m = clean.match(UNIT_FIRST);
  if (m) {
    const total = num(group(m, 2)) * kilosPer(group(m, 1));
    return Number.isFinite(total) && total > 0 ? round3(total) : null;
  }
  return null;
}

// ── The weight box: one number and one unit ──────────────────────────────────
//
// The ingredient card draws «Peso» as a number box beside a unit menu (29 Sep 2026), but
// the stored field is STILL the one free-text `weight`, "2.5 kg" — so parsePackSize()
// above keeps reading every old and new value, and no rules change was needed.
export type WeightUnit = 'g' | 'kg' | 'ml' | 'l';

const WEIGHT_UNITS: readonly WeightUnit[] = ['g', 'kg', 'ml', 'l'];
const WEIGHT_UNIT_ALIAS: Readonly<Record<string, string>> = { lt: 'l' };

function isWeightUnit(unit: unknown): unit is WeightUnit {
  return (WEIGHT_UNITS as readonly unknown[]).includes(unit);
}

// What the two boxes are opened with. `legacy` is there only for text the boxes cannot show.
export type SplitWeight = { amount: string; unit: WeightUnit; legacy?: string };

// Text -> { amount, unit } for the two boxes.
//  - readable ("25kg", "kg 5", "2,27 kg") -> the number as text and its unit;
//  - empty -> nothing typed, kilos offered first;
//  - anything else ("6x1kg", "sacco", "50 cl") -> { amount: '', legacy: text }: the card
//    shows it as «Attuale» and saves it untouched unless a number is typed.
// ⚠️ 'cl' IS UNREADABLE HERE ON PURPOSE: the menu has no centilitres, and converting would
// rewrite what somebody typed.
export function splitWeight(text: unknown): SplitWeight {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { amount: '', unit: 'kg' };
  const clean = raw.toLowerCase().replace(/\s+/g, ' ');
  let found: { amount: string; unit: string } | null = null;
  let m = clean.match(PLAIN);
  if (m) {
    found = { amount: group(m, 1), unit: group(m, 2) };
  } else {
    m = clean.match(UNIT_FIRST);
    if (m) found = { amount: group(m, 2), unit: group(m, 1) };
  }
  if (found !== null) {
    const unit = WEIGHT_UNIT_ALIAS[found.unit] || found.unit;
    const value = num(found.amount);
    if (isWeightUnit(unit) && Number.isFinite(value) && value > 0) {
      return { amount: String(value), unit };
    }
  }
  return { amount: '', unit: 'kg', legacy: raw };
}

// The two boxes -> the stored text. '' when there is no usable number, so an empty or
// broken box can never store a weight of zero. A comma decimal is accepted.
export function joinWeight(amount: unknown, unit: unknown): string {
  const value = num(String(amount ?? '').trim());
  if (!String(amount ?? '').trim() || !Number.isFinite(value) || value <= 0) return '';
  if (!isWeightUnit(unit)) return '';
  return `${value} ${unit}`;
}

export const WEIGHT_UNIT_CHOICES: readonly WeightUnit[] = Object.freeze([...WEIGHT_UNITS]);

// Something is typed in the number box that is NOT a usable positive number («2.27kg»,
// «abc», «0»). The card refuses to save it: joinWeight() answers '' for it, and writing ''
// would erase a weight that was readable before. An EMPTY box is a different answer —
// «no weight» — and is fine.
export function isUnusableWeight(amount: unknown, unit: unknown): boolean {
  return String(amount ?? '').trim() !== '' && joinWeight(amount, unit) === '';
}
