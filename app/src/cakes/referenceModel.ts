import { normalizeReference, ruleGrams } from '@mise/shared/cake-model';
import type { CakePart, ReferenceGrams } from '@mise/shared/cake-model';
import type { MessageKey } from '../i18n/en';

// The reference grams screen's form: the eight boxes as TEXT (what is typed), and the pure steps between the text and the numbers.

export type ReferenceKey = keyof ReferenceGrams;

// One box: which number it holds, the words of its label and note, its unit, and the bounds the rules enforce (isCakeReference in
// firestore.rules — the same numbers, so a refusal is told before «Save?» and not after).
export interface ReferenceField {
  key: ReferenceKey;
  label: MessageKey;
  sub: MessageKey;
  unit: 'cm' | 'g' | null;
  whole: boolean;
  min: number;
  max: number;
}

// ⚠️ `discHeightCm` is «more than 0» in the rules; the box asks for at least 0.1 cm, a thickness nobody has.
export const CAKE_FIELDS: readonly ReferenceField[] = [
  { key: 'diameterCm', label: 'cakes.ref.diameter', sub: 'cakes.ref.diameterSub', unit: 'cm', whole: false, min: 10, max: 60 },
  { key: 'discs', label: 'cakes.ref.discs', sub: 'cakes.ref.discsSub', unit: null, whole: true, min: 1, max: 5 },
  { key: 'discHeightCm', label: 'cakes.ref.discHeight', sub: 'cakes.ref.discHeightSub', unit: 'cm', whole: false, min: 0.1, max: 20 },
];

// The grams, in the order of the mockup (the editor's own order is top to bottom; this one is how a cake is built).
export const GRAM_FIELDS: readonly (ReferenceField & { part: CakePart })[] = [
  { part: 'base', key: 'baseG', label: 'cakes.part.base', sub: 'cakes.ref.baseSub', unit: 'g', whole: false, min: 0, max: 100000 },
  { part: 'soak', key: 'soakG', label: 'cakes.part.soak', sub: 'cakes.ref.soakSub', unit: 'g', whole: false, min: 0, max: 100000 },
  { part: 'filling', key: 'fillingG', label: 'cakes.part.filling', sub: 'cakes.ref.fillingSub', unit: 'g', whole: false, min: 0, max: 100000 },
  { part: 'coating', key: 'coatingG', label: 'cakes.part.coating', sub: 'cakes.ref.coatingSub', unit: 'g', whole: false, min: 0, max: 100000 },
  { part: 'decoration', key: 'decorationG', label: 'cakes.part.decoration', sub: 'cakes.ref.decorationSub', unit: 'g', whole: false, min: 0, max: 100000 },
];

const ALL_FIELDS: readonly ReferenceField[] = [...CAKE_FIELDS, ...GRAM_FIELDS];

export type ReferenceText = Record<ReferenceKey, string>;

export const EMPTY_TEXT: ReferenceText = {
  diameterCm: '', discs: '', discHeightCm: '', baseG: '', soakG: '', fillingG: '', coatingG: '', decorationG: '',
};

export function textFrom(reference: ReferenceGrams | null): ReferenceText {
  if (!reference) return { ...EMPTY_TEXT };
  const out = { ...EMPTY_TEXT };
  for (const { key } of ALL_FIELDS) out[key] = String(reference[key]);
  return out;
}

// What a box holds → its number: null for an empty box, NaN for something that is not a number.
// ⚠️ A COMMA TYPED IS A DECIMAL POINT (an Italian keyboard offers one; the box is plain text).
export function readNumber(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  return /^(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : Number.NaN;
}

export type Problem =
  | { key: ReferenceKey; kind: 'empty' | 'range' | 'whole'; field: ReferenceField }
  | null;

// The first box (top to bottom) that is empty or outside the rules' bounds; null when the form is a full, valid reference.
export function firstProblem(text: ReferenceText): Problem {
  for (const field of ALL_FIELDS) {
    const value = readNumber(text[field.key]);
    if (value === null) return { key: field.key, kind: 'empty', field };
    if (!Number.isFinite(value) || value < field.min || value > field.max) return { key: field.key, kind: 'range', field };
    if (field.whole && !Number.isInteger(value)) return { key: field.key, kind: 'whole', field };
  }
  return null;
}

// The reference the text stands for, or null while any box is empty or invalid.
export function referenceFrom(text: ReferenceText): ReferenceGrams | null {
  if (firstProblem(text) !== null) return null;
  const raw: Record<string, number> = {};
  for (const { key } of ALL_FIELDS) raw[key] = readNumber(text[key]) ?? 0;
  return normalizeReference(raw);
}

// «Unsaved changes»: a box that differs from the stored figure. With nothing stored, any typed text is a change.
export function isDirty(text: ReferenceText, stored: ReferenceGrams | null): boolean {
  const base = textFrom(stored);
  return ALL_FIELDS.some(({ key }) => readNumber(text[key]) !== readNumber(base[key]));
}

// The example of the screen: a 26 cm cake with 3 discs, scaled from the reference as typed. null while the form is not complete.
export const EXAMPLE_DIAMETER_CM = 26;
export const EXAMPLE_DISCS = 3;

export function exampleGrams(text: ReferenceText): { part: CakePart; label: MessageKey; grams: number }[] | null {
  const reference = referenceFrom(text);
  if (!reference) return null;
  const out: { part: CakePart; label: MessageKey; grams: number }[] = [];
  for (const { part, label } of GRAM_FIELDS) {
    const grams = ruleGrams(reference, part, EXAMPLE_DIAMETER_CM, EXAMPLE_DISCS);
    if (grams === null) return null;
    out.push({ part, label, grams });
  }
  return out;
}
