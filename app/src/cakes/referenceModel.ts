import { MAX_DIAMETER_CM, MAX_DISCS, MAX_LINE_GRAMS, MIN_DISCS, MIN_TIER_CM } from '@mise/shared/cake-model';
import {
  DEFAULT_DIAMETERS, MAX_STANDARD_ROWS, STANDARD_COLUMNS, emptyRow, tidyRows,
} from '@mise/shared/cake-standard';
import type { CakeStandard, StandardColumn, StandardRow } from '@mise/shared/cake-standard';
import type { MessageKey } from '../i18n/en';

// The standard cake screen's form: the table of diameters as TEXT (what is typed), and the pure steps between the text and the numbers.

// The words of one column: its label (the part's name, as in the editor) and its unit note.
export interface ColumnWords {
  column: StandardColumn;
  label: MessageKey;
  sub: MessageKey;
}

// In the order a cake is built (the mockup's columns).
export const COLUMN_WORDS: readonly ColumnWords[] = [
  { column: 'baseG', label: 'cakes.part.base', sub: 'cakes.ref.baseSub' },
  { column: 'soakG', label: 'cakes.part.soak', sub: 'cakes.ref.soakSub' },
  { column: 'fillingG', label: 'cakes.part.filling', sub: 'cakes.ref.fillingSub' },
  { column: 'coatingG', label: 'cakes.part.coating', sub: 'cakes.ref.coatingSub' },
  { column: 'decorationG', label: 'cakes.part.decoration', sub: 'cakes.ref.decorationSub' },
];

// The two numbers above the table. ⚠️ `discHeightCm` is «more than 0» in the rules; the box asks for at least 0.1 cm, a thickness nobody has.
export type ShapeKey = 'discs' | 'discHeightCm';

export interface ShapeField {
  key: ShapeKey;
  label: MessageKey;
  unit: 'cm' | null;
  whole: boolean;
  min: number;
  max: number;
}

export const SHAPE_FIELDS: readonly ShapeField[] = [
  { key: 'discs', label: 'cakes.ref.discs', unit: null, whole: true, min: MIN_DISCS, max: MAX_DISCS },
  { key: 'discHeightCm', label: 'cakes.ref.discHeight', unit: 'cm', whole: false, min: 0.1, max: 20 },
];

export const GRAMS_MIN = 0;
export const GRAMS_MAX = MAX_LINE_GRAMS;
export const DIAMETER_MIN = MIN_TIER_CM;
export const DIAMETER_MAX = MAX_DIAMETER_CM;

// While the discs or the height are not typed (or not valid), the grey coating is worked out from these, so an empty form still shows
// figures. Only the preview uses them: Save wants both typed.
export const PREVIEW_DISCS = 3;
export const PREVIEW_HEIGHT_CM = 2;

export interface RowText {
  diameterCm: number;
  cells: Record<StandardColumn, string>;
}

export interface TableText {
  discs: string;
  discHeightCm: string;
  rows: RowText[];
}

const emptyCells = (): Record<StandardColumn, string> => ({ baseG: '', soakG: '', fillingG: '', coatingG: '', decorationG: '' });

export function emptyText(): TableText {
  return { discs: '', discHeightCm: '', rows: DEFAULT_DIAMETERS.map(diameterCm => ({ diameterCm, cells: emptyCells() })) };
}

export function textFrom(standard: CakeStandard | null): TableText {
  if (!standard) return emptyText();
  return {
    discs: String(standard.discs),
    discHeightCm: String(standard.discHeightCm),
    rows: standard.rows.map(row => {
      const cells = emptyCells();
      for (const column of STANDARD_COLUMNS) {
        const value = row[column];
        cells[column] = value === null ? '' : String(value);
      }
      return { diameterCm: row.diameterCm, cells };
    }),
  };
}

// What a box holds → its number: null for an empty box, NaN for something that is not a number.
// ⚠️ A COMMA TYPED IS A DECIMAL POINT (an Italian keyboard offers one; the box is plain text).
export function readNumber(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  return /^(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : Number.NaN;
}

const gramsIn = (raw: string): number | null => {
  const value = readNumber(raw);
  return value !== null && Number.isFinite(value) && value >= GRAMS_MIN && value <= GRAMS_MAX ? value : null;
};

// The table as it stands, for the grey figures: only what is typed AND valid counts as typed; the shape falls back to the preview values.
export function previewOf(text: TableText): CakeStandard {
  const discs = readNumber(text.discs);
  const height = readNumber(text.discHeightCm);
  return {
    discs: discs !== null && Number.isInteger(discs) && discs >= MIN_DISCS && discs <= MAX_DISCS ? discs : PREVIEW_DISCS,
    discHeightCm: height !== null && Number.isFinite(height) && height >= 0.1 && height <= 20 ? height : PREVIEW_HEIGHT_CM,
    rows: text.rows.map((row): StandardRow => {
      const out = emptyRow(row.diameterCm);
      for (const column of STANDARD_COLUMNS) out[column] = gramsIn(row.cells[column]);
      return out;
    }),
  };
}

export type Problem =
  // The discs or the height: empty, out of bounds, or not whole.
  | { kind: 'empty' | 'range' | 'whole'; field: ShapeField }
  // A typed figure that is not a number or is outside 0–100,000.
  | { kind: 'cell'; diameterCm: number; column: StandardColumn }
  // A column with nothing typed in any row: the box to focus is the first row's.
  | { kind: 'column'; diameterCm: number; column: StandardColumn }
  | null;

// The first problem, in the order of the screen: discs, height, a typed figure that cannot be read, then a column with nothing typed.
export function firstProblem(text: TableText): Problem {
  for (const field of SHAPE_FIELDS) {
    const value = readNumber(text[field.key]);
    if (value === null) return { kind: 'empty', field };
    if (!Number.isFinite(value) || value < field.min || value > field.max) return { kind: 'range', field };
    if (field.whole && !Number.isInteger(value)) return { kind: 'whole', field };
  }
  for (const row of text.rows) {
    for (const column of STANDARD_COLUMNS) {
      const value = readNumber(row.cells[column]);
      if (value !== null && (!Number.isFinite(value) || value < GRAMS_MIN || value > GRAMS_MAX)) {
        return { kind: 'cell', diameterCm: row.diameterCm, column };
      }
    }
  }
  const first = text.rows[0];
  if (!first) return null;
  for (const column of STANDARD_COLUMNS) {
    if (!text.rows.some(row => readNumber(row.cells[column]) !== null)) return { kind: 'column', diameterCm: first.diameterCm, column };
  }
  return null;
}

// The standard the text stands for, or null while anything above is a problem.
export function standardFrom(text: TableText): CakeStandard | null {
  if (firstProblem(text) !== null) return null;
  const preview = previewOf(text);
  return { discs: preview.discs, discHeightCm: preview.discHeightCm, rows: tidyRows(preview.rows) };
}

// «Unsaved changes»: the copy differs from the stored standard; with none stored, from the empty default table.
export function isDirty(text: TableText, stored: CakeStandard | null): boolean {
  return signature(text) !== signature(textFrom(stored));
}

function signature(text: TableText): string {
  const num = (raw: string) => String(readNumber(raw));
  return JSON.stringify([
    num(text.discs),
    num(text.discHeightCm),
    text.rows.map(row => [row.diameterCm, ...STANDARD_COLUMNS.map(column => num(row.cells[column]))]),
  ]);
}

export type AddResult =
  | { ok: true; text: TableText; diameterCm: number }
  | { ok: false; error: 'range' | 'duplicate' | 'full'; diameterCm: number | null };

// A new diameter from what was typed in the «New diameter» box: whole centimetres, in the rules' bounds, not there already, room left.
export function addDiameter(text: TableText, raw: string): AddResult {
  const value = readNumber(raw);
  if (value === null || !Number.isFinite(value)) return { ok: false, error: 'range', diameterCm: null };
  // ⚠️ A diameter that is not whole is refused, never rounded silently.
  if (!Number.isInteger(value)) return { ok: false, error: 'range', diameterCm: null };
  const diameterCm = value;
  if (diameterCm < DIAMETER_MIN || diameterCm > DIAMETER_MAX) return { ok: false, error: 'range', diameterCm };
  if (text.rows.some(row => row.diameterCm === diameterCm)) return { ok: false, error: 'duplicate', diameterCm };
  if (text.rows.length >= MAX_STANDARD_ROWS) return { ok: false, error: 'full', diameterCm };
  const rows = [...text.rows, { diameterCm, cells: emptyCells() }].sort((a, b) => a.diameterCm - b.diameterCm);
  return { ok: true, text: { ...text, rows }, diameterCm };
}

// One diameter less; the last one cannot be taken off.
export function removeDiameter(text: TableText, diameterCm: number): TableText {
  if (text.rows.length <= 1) return text;
  return { ...text, rows: text.rows.filter(row => row.diameterCm !== diameterCm) };
}

export function setCell(text: TableText, diameterCm: number, column: StandardColumn, value: string): TableText {
  return {
    ...text,
    rows: text.rows.map(row => (row.diameterCm === diameterCm ? { ...row, cells: { ...row.cells, [column]: value } } : row)),
  };
}
