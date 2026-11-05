// recipe-export.ts — the PURE half of a scaled recipe as a one-page PDF or an .xlsx. No DOM, no storage, no
// library: the two files themselves are built in the app (it loads jsPDF and write-excel-file), from the
// model, the page geometry and the sheet description that are made here.
//
// TypeScript PARTIAL port of js/recipe-export.js for Mise 2. Behaviour is identical, input for input, for
// everything ported: recipe-export.spec.ts runs every test against BOTH files and compares each ported export
// with the js/ file itself. It is NOT paired in parity.spec.ts, because of what is left out.
//
// LEFT OUT: `buildPdfBlob` and `buildXlsxBlob` (they `import()` the vendored libraries, which belong to the
// app: shared/ has no runtime dependency) and the private loader that wraps a failed `import()`. What the
// app's loader needs from here to make the SAME error the two functions below recognise is `LIBRARY_ERROR`
// and `libraryError(cause)` (new in the port: in the original they are private to the loader).
//
// The model: { name, trays, totalG, rows }. A row is EITHER the Calculator's { name, grams } (the
// UNROUNDED grams it holds: the PDF shows them as the card does, Math.round + « g», the spreadsheet
// keeps them exact so a formula over them is right) OR the Recipe catalogue's
// { name, value, unit, factor }: `value` in the row's OWN unit (null = «to taste»), `unit` the text
// the screen prints after the number, `factor` the grams in one unit (0 = not weighable: pieces,
// spoons, a pinch). exportRow() turns both into the second shape, so every builder reads one.
//
// ⚠️ THE TWO LIBRARIES ARE LOADED ONLY WHEN A FILE IS BUILT, WITH import(), in the app. jsPDF is ~400 KB and
// write-excel-file ~70 KB; nobody opening the Calculator should pay for them.
//
// ⚠️ NO t() AND NO DOM HERE. Words arrive from the caller (the title is the recipe's own
// name; the Excel total label is passed in), so this file is plain functions a test can run.

// ── Types ─────────────────────────────────────────────────────────────────────────────────

// A row as a screen hands it over: either shape, any field possibly missing (it is read, never trusted).
export interface ExportRowInput {
  name?: unknown;
  grams?: unknown;
  value?: unknown;
  unit?: unknown;
  factor?: unknown;
  decimals?: unknown;
  text?: unknown;
}

// The one shape every builder reads.
export interface ExportRow {
  name: unknown;
  value: number | null;
  unit: string;
  factor: number;
  decimals: number;
  text: string | null;
}

export interface ExportModel {
  name?: unknown;
  trays?: unknown;
  totalG?: unknown;
  rows: ExportRowInput[];
}

// What `pdfLayout` is handed: the page title and, per row, the name and the weight text.
export interface PdfLayoutInput {
  title: string;
  rows: { name: string; text: string }[];
}

// The width in points of `text` in Helvetica at `size`, bold or not.
export type Measure = (text: string, size: number, bold: boolean) => number;

export interface PdfItem {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
}

export interface PdfLayout {
  items: PdfItem[];
  titleSize: number;
  fontSize: number;
  leading: number;
}

// The least of jsPDF that `pdfMeasurer` uses, so a test or the app can hand over the real document.
export interface TextMeasuringDoc {
  setFont(fontName: string, fontStyle?: string): unknown;
  setFontSize(size: number): unknown;
  getTextWidth(text: string): number;
}

// One cell of write-excel-file's data, as far as this file writes it.
export interface SheetCell {
  value?: unknown;
  type?: StringConstructor | NumberConstructor | 'Formula';
  fontWeight?: 'bold';
  format?: string;
  columnSpan?: number;
}

export interface XlsxSheetInput {
  title: string;
  name?: unknown;
  rows: ExportRowInput[];
  totalLabel: unknown;
  sheetFallback?: string;
  totalG?: unknown;
}

export interface XlsxSheet {
  data: (SheetCell | null)[][];
  options: {
    columns: { width: number }[];
    orientation: 'portrait';
    sheet: string;
  };
}

// ── Rows ──────────────────────────────────────────────────────────────────────────────────

// One row in the general shape { name, value, unit, factor }. The Calculator's { name, grams } is
// a row in grams: factor 1, unit «g».
export function exportRow(r: ExportRowInput | null | undefined): ExportRow {
  if (r && (r.unit !== undefined || r.value !== undefined)) {
    return {
      name: r.name,
      value: r.value === null || r.value === undefined ? null : (Number(r.value) || 0),
      unit: String(r.unit ?? ''),
      factor: Number(r.factor) > 0 ? Number(r.factor) : 0,
      decimals: Math.max(0, Math.min(3, Math.trunc(Number(r.decimals)) || 0)),
      text: typeof r.text === 'string' && r.text ? r.text : null,
    };
  }
  return { name: r && r.name, value: Number(r && r.grams) || 0, unit: 'g', factor: 1, decimals: 0, text: null };
}

// ── Names ─────────────────────────────────────────────────────────────────────────────────

// What the page and the spreadsheet are titled: «Pizza x 3» for trays, «Pizza — 24000 g» else.
export function exportTitle(m: ExportModel): string {
  const name = String(m.name ?? '');
  const trays = Number(m.trays) || 0;
  if (trays > 0) return `${name} x ${trays}`;
  // A recipe of only pieces or «to taste» has no weight to put in the title.
  return Number(m.totalG) > 0 ? `${name} — ${String(m.totalG)} g` : name;
}

// «Pizza_x3.pdf», «Focaccia_24000g.xlsx»: safe on Windows, Android and iOS file systems.
// `fallback` is the word for a recipe with no usable name; the caller reads it from t() when it asks.
export function exportFileName(m: ExportModel, ext: string, fallback: string = 'recipe'): string {
  const base = String(m.name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80) || fallback;
  const trays = Number(m.trays) || 0;
  const suffix = trays > 0 ? `_x${trays}` : (Number(m.totalG) > 0 ? `_${String(m.totalG)}g` : '');
  return `${base}${suffix}.${ext}`;
}

// The weight as the result card prints it (js/calc.js renderIngredients).
export const rowText = (grams: unknown): string => `${Math.round(grams as number)} g`;

// A row as the PDF prints it: «14400 g», «500 ml», «3 pz», or just the unit word for «to taste».
export function rowTextOf(row: ExportRowInput | null | undefined): string {
  const r = exportRow(row);
  if (r.value === null) return r.unit;
  // The screen's own number when the caller has it («1,846» in Italian): kg and l keep decimals.
  return `${r.text ?? Math.round(r.value)} ${r.unit}`;
}

// ── The PDF page ──────────────────────────────────────────────────────────────────────────

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
const TITLE_SIZE = 27;
const TITLE_MIN = 14;
const TITLE_MAX_W = 483;
const TITLE_Y = 110;
const NAME_X = 147;
const WEIGHT_RIGHT = 449;
const ROW_SIZE = 19;
const ROW_LEADING = 36;
const FIRST_ROW_GAP = 60;      // title baseline → first row baseline
const BOTTOM_MARGIN = 60;
const LEADING_RATIO = 1.25;    // never tighter than this × the font size, until the font itself shrinks
const VERTICAL_MIN_SIZE = 6;
const HORIZONTAL_MIN_SIZE = 9;
const MIN_DOTS = 3;
const ELLIPSIS = '…';

// Helvetica is drawn with WinAnsi (Windows-1252): the 0x80–0x9F block holds these.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

// Characters the built-in font cannot draw become «?» instead of an empty box or a wrong glyph.
export function pdfSafe(text: unknown): string {
  let out = '';
  for (const ch of String(text ?? '').replace(/\s+/g, ' ')) {
    const c = ch.codePointAt(0) as number;
    const ok = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.includes(ch);
    out += ok ? ch : '?';
  }
  return out;
}

// The longest start of `text` that, followed by «…», is no wider than maxW.
function truncated(text: string, maxW: number, size: number, bold: boolean, measure: Measure): string {
  if (measure(text, size, bold) <= maxW) return text;
  let s = text;
  while (s.length > 0 && measure(s.trimEnd() + ELLIPSIS, size, bold) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + ELLIPSIS;
}

// pdfLayout({ title, rows: [{ name, text }] }, measure) -> { items, titleSize, fontSize, leading }
// `measure(text, sizePt, bold)` is the width in points. Pure: the caller decides how to measure
// (jsPDF's getTextWidth in the app and in the tests), so the geometry can be checked without a PDF.
export function pdfLayout({ title, rows }: PdfLayoutInput, measure: Measure): PdfLayout {
  const items: PdfItem[] = [];

  // Title: centred, bold, as large as fits the column, then cut.
  let titleSize = TITLE_SIZE;
  while (titleSize > TITLE_MIN && measure(title, titleSize, true) > TITLE_MAX_W) titleSize -= 1;
  const titleText = truncated(title, TITLE_MAX_W, titleSize, true, measure);
  items.push({
    text: titleText,
    x: (PAGE_W - measure(titleText, titleSize, true)) / 2,
    y: TITLE_Y, size: titleSize, bold: true,
  });

  // Vertical size: the whole list on ONE page. Leading shrinks first, then the font.
  const firstY = TITLE_Y + FIRST_ROW_GAP;
  const n = rows.length;
  const room = PAGE_H - BOTTOM_MARGIN - firstY;
  const perRow = n > 1 ? room / (n - 1) : ROW_LEADING;
  const leading = Math.min(ROW_LEADING, perRow);
  const fontSize = leading < LEADING_RATIO * ROW_SIZE
    ? Math.max(VERTICAL_MIN_SIZE, Math.floor((leading / LEADING_RATIO) * 2) / 2)
    : ROW_SIZE;

  // Horizontal size: one size for ALL rows, the largest where each row still holds its name,
  // three dots and its weight between NAME_X and WEIGHT_RIGHT.
  const span = WEIGHT_RIGHT - NAME_X;
  const fits = (size: number): boolean => rows.every((r) => {
    const gap = measure(' ', size, false);
    const dot = measure('.', size, false);
    return measure(r.name, size, false) + gap + MIN_DOTS * dot + gap + measure(r.text, size, true) <= span;
  });
  const floor = Math.min(fontSize, HORIZONTAL_MIN_SIZE);
  let size = fontSize;
  while (size > floor && !fits(size)) size = Math.max(floor, size - 0.5);

  const gap = measure(' ', size, false);
  const dot = measure('.', size, false);
  rows.forEach((r, i) => {
    const y = firstY + i * leading;
    const weightW = measure(r.text, size, true);
    const weightX = WEIGHT_RIGHT - weightW;
    // A name that still does not fit at the smallest size is cut, never allowed to push the weight.
    const nameRoom = span - weightW - 2 * gap - MIN_DOTS * dot;
    const name = truncated(r.name, nameRoom, size, false, measure);
    const nameEnd = NAME_X + measure(name, size, false);
    const dots = Math.floor((weightX - gap - (nameEnd + gap)) / dot);
    items.push({ text: name, x: NAME_X, y, size, bold: false });
    if (dots > 0) {
      const dotText = '.'.repeat(dots);
      items.push({ text: dotText, x: weightX - gap - measure(dotText, size, false), y, size, bold: false });
    }
    items.push({ text: r.text, x: weightX, y, size, bold: true });
  });

  return { items, titleSize, fontSize: size, leading };
}

// ── The spreadsheet ───────────────────────────────────────────────────────────────────────

const QUOTE = String.fromCharCode(34);
const GRAMS_FORMAT = `0 ${QUOTE}g${QUOTE}`;
// The number format that shows a value with its unit; a quote in the unit text would end the format.
// ⚠️ A UNIT WITH DECIMALS (kg, l) IS «General», NEVER «0»: «0» would print 1.846 kg as «2 kg», the
// very rounding the screen stopped doing, and «0.###» leaves a bare dot after a whole number.
const unitFormat = (unit: string, decimals: number = 0): string => {
  const clean = String(unit).replace(/"/g, '').trim();
  const num = decimals > 0 ? 'General' : '0';
  return clean ? `${num} ${QUOTE}${clean}${QUOTE}` : num;
};
// ⚠️ A formula is written WITHOUT its leading «=»: the library puts the text into <f> as it is,
// and the file format has no «=» there.

// A worksheet's name: no `[]:*?/\`, 31 characters at most, never starting or ending with an
// apostrophe and never «History» (Excel keeps both for itself); otherwise the caller's fallback.
export function sheetNameOf(name: unknown, fallback: string = 'Recipe'): string {
  const clean = String(name ?? '').replace(/[\[\]:*?/\\]/g, '').trim().slice(0, 31)
    .replace(/^['’\s]+|['’\s]+$/g, '');
  return !clean || clean.toLowerCase() === 'history' ? fallback : clean;
}

// The total row's value cell, always shown as grams.
// Only weighable rows count, each converted to grams (pieces, spoons, «to taste» are left out, as
// the screen's Total leaves them out). Gram-only rows keep the plain SUM.
// ⚠️ THE TOTAL MUST EQUAL THE SCREEN'S TOTAL. With mixed units each row is rounded in its OWN unit
// on screen, so the formula's value can differ by a gram from the total printed there. When it
// would not round to `totalG`, the cell is the screen's number as a plain value instead.
// ⚠️ THE CHECK COVERS THE PLAIN SUM TOO: grams and ml rows both count 1:1, but a catalogue recipe
// that mixes them rounds each row on its own (no exact-sum step), so even a SUM can miss by a gram.
function totalCell(list: ExportRow[], last: number, totalG: unknown): SheetCell {
  const cell: SheetCell = { fontWeight: 'bold', format: GRAMS_FORMAT };
  const terms: string[] = [];
  let computed = 0;
  list.forEach((r, i) => {
    if (r.factor > 0 && r.value !== null) {
      terms.push(r.factor === 1 ? `B${i + 3}` : `B${i + 3}*${r.factor}`);
      computed += r.value * r.factor;
    }
  });
  if (terms.length === 0) return { ...cell, value: 0, type: Number };
  if (Number.isFinite(Number(totalG)) && Math.round(computed) !== Number(totalG)) {
    return { ...cell, value: Number(totalG), type: Number };
  }
  const formula = list.every(r => r.factor === 1 && r.value !== null) ? `SUM(B3:B${last})` : terms.join('+');
  return { ...cell, value: formula, type: 'Formula' };
}

// xlsxSheet({ title, name, rows, totalLabel, totalG }) -> { data, options } for write-excel-file.
// The sheet's tab is called after the recipe (`name`, else the title). Weights are real numbers (exact),
// each shown with its own unit; «to taste» is text. The total is a formula the spreadsheet computes itself.
export function xlsxSheet({ title, name, rows, totalLabel, sheetFallback = 'Recipe', totalG }: XlsxSheetInput): XlsxSheet {
  const data: (SheetCell | null)[][] = [
    [{ value: title, fontWeight: 'bold', columnSpan: 2 }, null],
    [],
  ];
  const list = rows.map(exportRow);
  for (const r of list) {
    data.push([
      { value: String(r.name ?? ''), type: String },
      r.value === null
        ? { value: r.unit, type: String }
        : { value: r.value, type: Number, format: unitFormat(r.unit, r.decimals) },
    ]);
  }
  const last = list.length + 2;
  data.push([
    { value: totalLabel, type: String, fontWeight: 'bold' },
    totalCell(list, last, totalG),
  ]);
  const longest = list.reduce((w, r) => Math.max(w, String(r.name ?? '').length), String(totalLabel ?? '').length);
  const sheet = sheetNameOf(name ?? title, sheetFallback);
  return {
    data,
    options: {
      columns: [{ width: Math.min(60, Math.max(18, longest + 4)) }, { width: 12 }],
      orientation: 'portrait',
      sheet,
    },
  };
}

// ── Library failures (the loader itself lives in the app) ─────────────────────────────────

// A library that cannot be fetched (offline before the precache finished, a dropped network)
// is told apart from a bug in the build: the first is solved by connecting, the second by retrying.
// The app's loader wraps a failed import() with `libraryError`, so the two functions below know it.
export const LIBRARY_ERROR = 'export/library';

export interface LibraryError extends Error {
  code: typeof LIBRARY_ERROR;
  cause: unknown;
}

export function libraryError(cause: unknown): LibraryError {
  const err = new Error(LIBRARY_ERROR) as LibraryError;
  err.code = LIBRARY_ERROR;
  err.cause = cause;
  return err;
}

// A library that did not load while the phone is ONLINE is not a connection problem, so only an
// offline phone is told to connect. `online` is navigator.onLine.
export const exportErrorKey = (err: unknown, online: boolean = true): 'export.needsConnection' | 'export.failed' => (
  err && (err as { code?: unknown }).code === LIBRARY_ERROR && online === false ? 'export.needsConnection' : 'export.failed');

// The fixed code that goes into the error report: what failed, never the recipe or its words.
export const exportErrorCode = (err: unknown): 'library' | 'build' => (
  err && (err as { code?: unknown }).code === LIBRARY_ERROR ? 'library' : 'build');

// ⚠️ WIDTHS WITHOUT KERNING. jsPDF's getTextWidth(string) applies kerning pairs, but a Tj draws the
// string without them, so a name like «Yogurt AVVolto» is drawn up to ~4.6 pt wider than measured
// and the gap before the dots shrinks. Summing the width of each character measures what is drawn.
export function pdfMeasurer(doc: TextMeasuringDoc): Measure {
  const cache = new Map<string, number>();
  return (text, size, bold) => {
    let width = 0;
    for (const ch of String(text)) {
      const key = `${bold ? 1 : 0}|${size}|${ch}`;
      let w = cache.get(key);
      if (w === undefined) {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        w = doc.getTextWidth(ch);
        cache.set(key, w);
      }
      width += w;
    }
    return width;
  };
}

// The file names its font. Without this the library writes a default font with no <sz> and no
// name, and each spreadsheet app picks its own — while column widths are counted in characters
// of that font, so the page width the two columns take would change from app to app. Calibri 11
// is Excel's own default: 94.5 + 63 pt of columns, well inside an A4 page's 494 pt (checked in
// Excel, 14 Oct 2026).
export const XLSX_FONT = Object.freeze({ fontFamily: 'Calibri', fontSize: 11 });
