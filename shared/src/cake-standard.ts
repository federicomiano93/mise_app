// cake-standard.ts — the venue's «standard cake» as a TABLE OF DIAMETERS (the cakes rework, step 4, 22 Nov 2026). PURE: no DOM, no
// Firestore.
//
// `cake-settings/reference` used to hold the grams of ONE reference cake (`grams`, the eight numbers of ReferenceGrams), scaled by area
// to every cake. Now it also holds `rows`: one row per diameter, each with the five figures the person typed for that size (null = not
// typed). An empty box is filled in by scaling from the NEAREST diameter whose box of that column was typed (the screen shows it grey):
//   - base and soak (per disc) and filling (per layer): by AREA, (d / from)²;
//   - coating (the whole cake): by the surface it covers, top + side, S(d) = π(d/2)² + π·d·H with H = discs × disc height;
//   - decoration (on top, along the edge): by EDGE LENGTH, d / from.
// A scaled figure is shown rounded to 10 g (a cake copies it to 1 g, so a small figure never collapses to 0); a typed one is kept as typed.
//
// ⚠️ A CAKE STILL CARRIES ONE ReferenceGrams (`cake.ref`), now taken AT ITS OWN DIAMETER (referenceFor): the cake document, its rules and
// ruleGrams do not change, and its upper tiers are scaled from that row by area as before.
//
// ⚠️ `grams` IS STILL WRITTEN, AND STILL REQUIRED BY THE RULES: a phone that has not updated reads only `grams`. The new app writes there the
// table's figures at 22 cm (LEGACY_DIAMETER_CM), so such a phone keeps starting cakes from sensible numbers. A document with no valid
// `rows` (every document written before this step) is read as a table holding its one reference row among the default diameters.

import { MAX_DIAMETER_CM, MAX_DISCS, MAX_LINE_GRAMS, MIN_DISCS, MIN_TIER_CM, normalizeReference, sameReference } from './cake-model';
import type { ReferenceGrams } from './cake-model';

// The five figures of a row, in the order a cake is built (the screen's columns).
export const STANDARD_COLUMNS = Object.freeze(['baseG', 'soakG', 'fillingG', 'coatingG', 'decorationG'] as const);
export type StandardColumn = (typeof STANDARD_COLUMNS)[number];

// The keys of one row: exactly what toStandardDocument writes. The rules judge `rows` by type and count only (see isStandardRows), so a
// stray key is not refused there; the list is pinned in cake-standard.spec.ts.
export const STANDARD_ROW_KEYS = Object.freeze(['diameterCm', ...STANDARD_COLUMNS] as const);

// The diameters a venue with no table yet starts from.
export const DEFAULT_DIAMETERS = Object.freeze([16, 18, 20, 22, 24, 26, 28]);
// The rules' ceiling on the number of rows (pinned in cake-standard.spec.ts).
export const MAX_STANDARD_ROWS = 20;
// The diameter whose figures are also written as the old single reference (`grams`), for phones not yet updated.
export const LEGACY_DIAMETER_CM = 22;
// A scaled figure SHOWN in the table is rounded to this; a cake copies the same figure to the whole gram (referenceFor).
export const SCALED_STEP_G = 10;

export interface StandardRow {
  // Whole centimetres, MIN_TIER_CM..MAX_DIAMETER_CM.
  diameterCm: number;
  baseG: number | null;
  soakG: number | null;
  fillingG: number | null;
  coatingG: number | null;
  decorationG: number | null;
}

export interface CakeStandard {
  discs: number;
  discHeightCm: number;
  // Ascending by diameter, no diameter twice, 1..MAX_STANDARD_ROWS rows, every column typed in at least one row.
  rows: StandardRow[];
}

type Loose = Record<string, unknown>;

function isObject(raw: unknown): raw is Loose {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

function gramsOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_LINE_GRAMS ? value : null;
}

export function isStandardDiameter(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_TIER_CM && value <= MAX_DIAMETER_CM;
}

export function emptyRow(diameterCm: number): StandardRow {
  return { diameterCm, baseG: null, soakG: null, fillingG: null, coatingG: null, decorationG: null };
}

function normalizeRow(raw: unknown): StandardRow | null {
  if (!isObject(raw) || !isStandardDiameter(raw.diameterCm)) return null;
  const row = emptyRow(raw.diameterCm);
  for (const column of STANDARD_COLUMNS) row[column] = gramsOrNull(raw[column]);
  return row;
}

// Ascending, the first of a diameter wins, at most MAX_STANDARD_ROWS.
export function tidyRows(rows: readonly StandardRow[]): StandardRow[] {
  const seen = new Set<number>();
  const out: StandardRow[] = [];
  for (const row of rows) {
    if (seen.has(row.diameterCm)) continue;
    seen.add(row.diameterCm);
    out.push({ ...row });
  }
  return out.sort((a, b) => a.diameterCm - b.diameterCm).slice(0, MAX_STANDARD_ROWS);
}

// Every column has at least one typed figure: without one, no box of that column could be filled in.
export function everyColumnTyped(rows: readonly StandardRow[]): boolean {
  return STANDARD_COLUMNS.every(column => rows.some(row => row[column] !== null));
}

// The table a document written before the table existed stands for: its one cake as a typed row, among the default diameters.
export function standardFromReference(ref: ReferenceGrams): CakeStandard {
  const diameterCm = Math.min(MAX_DIAMETER_CM, Math.max(MIN_TIER_CM, Math.round(ref.diameterCm)));
  const typed: StandardRow = {
    diameterCm, baseG: ref.baseG, soakG: ref.soakG, fillingG: ref.fillingG, coatingG: ref.coatingG, decorationG: ref.decorationG,
  };
  return {
    discs: ref.discs,
    discHeightCm: ref.discHeightCm,
    rows: tidyRows([typed, ...DEFAULT_DIAMETERS.map(emptyRow)]),
  };
}

// The venue's table from `cake-settings/reference` (any input; never throws). null when the document has no valid `grams` — the rules
// require them, so that is «no standard yet» (or junk). `rows` that are missing, empty or leave a column with nothing typed are ignored
// and the old single reference is read instead.
export function normalizeStandard(doc: unknown): CakeStandard | null {
  if (!isObject(doc)) return null;
  const ref = normalizeReference(doc.grams);
  if (!ref) return null;
  const rows = Array.isArray(doc.rows)
    ? tidyRows(doc.rows.map(normalizeRow).filter((row): row is StandardRow => row !== null))
    : [];
  if (rows.length === 0 || !everyColumnTyped(rows)) return standardFromReference(ref);
  return { discs: ref.discs, discHeightCm: ref.discHeightCm, rows };
}

// How much a figure typed at `fromCm` grows or shrinks at `toCm` (see the header).
export function scaleFactor(column: StandardColumn, fromCm: number, toCm: number, discs: number, discHeightCm: number): number {
  if (fromCm <= 0) return 0;
  if (column === 'decorationG') return toCm / fromCm;
  if (column === 'coatingG') {
    const side = discs * discHeightCm;
    const surface = (d: number) => Math.PI * (d / 2) ** 2 + Math.PI * d * side;
    return surface(toCm) / surface(fromCm);
  }
  return (toCm / fromCm) ** 2;
}

export interface StandardCell {
  grams: number;
  // Typed in this very row (shown black); otherwise scaled (shown grey).
  typed: boolean;
  // The diameter the figure comes from.
  fromCm: number;
}

// One box of the table, or the figure of any diameter (a cake's may be between two rows, or not whole). The nearest typed diameter of that
// column wins; on a tie the smaller one (the mockup's order). null when the column has nothing typed.
export function standardCell(
  standard: Pick<CakeStandard, 'discs' | 'discHeightCm'> & { rows: readonly StandardRow[] },
  column: StandardColumn,
  diameterCm: number,
): StandardCell | null {
  return cellRounded(standard, column, diameterCm, SCALED_STEP_G);
}

function cellRounded(
  standard: Pick<CakeStandard, 'discs' | 'discHeightCm'> & { rows: readonly StandardRow[] },
  column: StandardColumn,
  diameterCm: number,
  stepG: number,
): StandardCell | null {
  let best: StandardRow | null = null;
  for (const row of standard.rows) {
    if (row[column] === null) continue;
    if (row.diameterCm === diameterCm) return { grams: row[column] as number, typed: true, fromCm: diameterCm };
    if (best === null) { best = row; continue; }
    const distance = Math.abs(row.diameterCm - diameterCm);
    const bestDistance = Math.abs(best.diameterCm - diameterCm);
    if (distance < bestDistance || (distance === bestDistance && row.diameterCm < best.diameterCm)) best = row;
  }
  if (best === null) return null;
  const raw = (best[column] as number) * scaleFactor(column, best.diameterCm, diameterCm, standard.discs, standard.discHeightCm);
  const grams = Math.min(MAX_LINE_GRAMS, Math.max(0, Math.round(raw / stepG) * stepG));
  return { grams, typed: false, fromCm: best.diameterCm };
}

// The single reference a cake of this diameter takes (copied into `cake.ref`): the table's figures at that diameter, a scaled one rounded to
// the WHOLE gram (the screen shows 10 g; a small figure such as 20 g of soak at 10 cm must not become 0). null with no standard, or while a
// column has nothing typed.
export function referenceFor(standard: CakeStandard | null, diameterCm: number): ReferenceGrams | null {
  if (!standard) return null;
  const at = Math.min(MAX_DIAMETER_CM, Math.max(MIN_TIER_CM, diameterCm));
  const figures: Partial<Record<StandardColumn, number>> = {};
  for (const column of STANDARD_COLUMNS) {
    const cell = cellRounded(standard, column, at, 1);
    if (!cell) return null;
    figures[column] = cell.grams;
  }
  return normalizeReference({ diameterCm: at, discs: standard.discs, discHeightCm: standard.discHeightCm, ...figures });
}

// ⚠️ A cake's `ref` is «current» when it equals the table AT THE REF'S OWN DIAMETER: a cake saved before the table (one reference, at any
// diameter) is not «changed» just because its diameter is not the old 22 cm, and its grams stay as they were.
export function refIsCurrent(ref: ReferenceGrams | null, standard: CakeStandard | null): boolean {
  return ref !== null && standard !== null && sameReference(ref, referenceFor(standard, ref.diameterCm));
}

// What `cake-settings/reference` is written as: WHOLE, exactly the keys the rules list. null while the table cannot be a standard (Save
// checks that first and says which box is missing).
export function toStandardDocument(
  standard: CakeStandard,
  locationId: string,
  updatedAt: string,
): { bakery: string; grams: ReferenceGrams; rows: StandardRow[]; updatedAt: string } | null {
  if (!Number.isInteger(standard.discs) || standard.discs < MIN_DISCS || standard.discs > MAX_DISCS) return null;
  const rows = tidyRows(standard.rows).filter(row => isStandardDiameter(row.diameterCm));
  if (rows.length === 0 || !everyColumnTyped(rows)) return null;
  const tidy: CakeStandard = { discs: standard.discs, discHeightCm: standard.discHeightCm, rows };
  const grams = referenceFor(tidy, LEGACY_DIAMETER_CM);
  if (!grams) return null;
  return {
    bakery: locationId,
    grams,
    // Only the six keys, in a fixed order (a stray key would be a refused save).
    rows: rows.map(row => ({
      diameterCm: row.diameterCm,
      baseG: gramsOrNull(row.baseG),
      soakG: gramsOrNull(row.soakG),
      fillingG: gramsOrNull(row.fillingG),
      coatingG: gramsOrNull(row.coatingG),
      decorationG: gramsOrNull(row.decorationG),
    })),
    updatedAt,
  };
}

export function sameStandard(a: CakeStandard | null, b: CakeStandard | null): boolean {
  if (!a || !b) return !a && !b;
  if (a.discs !== b.discs || a.discHeightCm !== b.discHeightCm || a.rows.length !== b.rows.length) return false;
  return a.rows.every((row, i) => {
    const other = b.rows[i] as StandardRow;
    return STANDARD_ROW_KEYS.every(key => row[key] === other[key]);
  });
}
