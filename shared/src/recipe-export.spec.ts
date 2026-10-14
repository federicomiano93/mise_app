// Unit tests for the pure half of the recipe export (P15 — the owner cannot read a PDF's internals, so these pin
// what he would see: one page, every row, dots that never touch the words, numbers that stay exact), run against
// BOTH implementations: the TypeScript port in shared/ and js/recipe-export.js, which the live app uses today.
// Ported from tests/recipe-export.test.mjs, tests/catalogue-export-model.test.mjs and the export-error tests of
// tests/recipe-export-wiring.test.mjs; the two must stay equal until the switch to Mise 2.
//
// recipe-export.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also exports
// `buildPdfBlob` and `buildXlsxBlob` (they load the vendored libraries, which belong to the app), and the port
// adds `LIBRARY_ERROR` and `libraryError` (private to the original's loader). The last block of this file stands
// in for what pairing would have checked: the same names, constants, frozen-ness and function shapes.
//
// PORTED from tests/recipe-export.test.mjs: every test that does not build a real file (the layout, the names,
// the sheet description, the rows). NOT PORTED: 'a real PDF…' and 'a real .xlsx…' (they run `buildPdfBlob` /
// `buildXlsxBlob`; the app's own spec builds the files through the libraries it loads).
// PORTED from tests/catalogue-export-model.test.mjs: the kg / litre decimal tests, with the rows written out by
// hand where the original builds them with `exportModelOf` / `scaleCatalogue` (catalogue-model, not ported yet).
// From tests/recipe-export-wiring.test.mjs: the two export-error tests.
//
// Fake recipe names only — the repo is public (tests/fixtures/recipe-export-fixtures.mjs).

import { describe, expect, test } from 'vitest';
import * as ported from './recipe-export';
import * as legacyJs from '../../js/recipe-export.js';
import { jsPDF } from '../../js/vendor/jspdf.esm.js';
import { SIX, TRAYS, LONG_ROW, SIXTY, AWKWARD_NAME, MIXED, MIXED_DRIFT, ONLY_PIECES } from '../../tests/fixtures/recipe-export-fixtures.mjs';

const legacy = legacyJs as unknown as typeof ported;

// The fixtures are plain data in two row shapes: they are handed to functions that read ANY value.
type Loose = any;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const {
    exportTitle, exportFileName, rowText, pdfLayout, rowTextOf, exportRow, pdfSafe, pdfMeasurer, sheetNameOf, xlsxSheet,
    exportErrorKey, exportErrorCode, PAGE_W, PAGE_H,
  } = m;

  const doc = new (jsPDF as Loose)({ unit: 'pt', format: 'a4' });
  // The width of what a Tj really draws: no kerning (see pdfMeasurer).
  const measure = pdfMeasurer(doc);
  // Written out here too, so the test does not trust the code it checks.
  const drawnWidth = (text: string, size: number, bold: boolean): number => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    return [...text].reduce((w, ch) => w + (doc.getTextWidth(ch) as number), 0);
  };
  const layoutOf = (model: Loose): ported.PdfLayout => pdfLayout({
    title: exportTitle(model),
    rows: model.rows.map((r: Loose) => ({ name: r.name, text: rowText(r.grams) })),
  }, measure);
  const EPS = 1e-6;

  test('title: trays say «x N», otherwise the total in grams with an em dash', () => {
    expect(exportTitle(TRAYS)).toBe('Pizza di prova x 3');
    expect(exportTitle(SIX)).toBe('Impasto di prova — 24000 g');
  });

  test('file name: trays or grams, unsafe characters gone, spaces become underscores', () => {
    expect(exportFileName(TRAYS, 'pdf')).toBe('Pizza_di_prova_x3.pdf');
    expect(exportFileName({ name: 'Focaccia', trays: 0, totalG: 24000, rows: [] }, 'xlsx')).toBe('Focaccia_24000g.xlsx');
    expect(exportFileName(AWKWARD_NAME, 'pdf')).toBe('Focaccia_piùmeno_prova_1000g.pdf');
    expect(exportFileName({ name: ' \\/:*?"<>| ', trays: 2, totalG: 5, rows: [] }, 'pdf')).toBe('recipe_x2.pdf');
    expect(exportFileName({ name: 'a\u0007b\n c', trays: 0, totalG: 5, rows: [] }, 'pdf')).toBe('ab_c_5g.pdf');
  });

  test('row text is what the result card shows: rounded grams, recipe order kept', () => {
    expect(rowText(14400.4)).toBe('14400 g');
    expect(rowText(8640.5)).toBe('8641 g');
    expect(rowText(0)).toBe('0 g');
    const { items } = layoutOf(SIX);
    const first = items[0];
    const weights = items.filter(i => i.bold && i !== first).map(i => i.text);
    expect(weights).toStrictEqual(SIX.rows.map((r: Loose) => rowText(r.grams)));
    const names = items.filter(i => !i.bold && !/^\.+$/.test(i.text)).map(i => i.text);
    expect(names).toStrictEqual(SIX.rows.map((r: Loose) => r.name));
  });

  test('pdfSafe keeps Italian accents and typographic quotes, replaces what Helvetica cannot draw', () => {
    expect(pdfSafe('Più è ’buono’ — “sì” €')).toBe('Più è ’buono’ — “sì” €');
    expect(pdfSafe('Farina 全 ✓')).toBe('Farina ? ?');
  });

  function checkGeometry(model: Loose): ported.PdfLayout {
    const lay = layoutOf(model);
    const [title, ...rest] = lay.items as [ported.PdfItem, ...ported.PdfItem[]];
    const firstRest = rest[0] as ported.PdfItem;
    expect(title.x >= -EPS && title.x + measure(title.text, title.size, true) <= PAGE_W + EPS, 'title inside the page').toBe(true);
    expect(lay.titleSize >= 14 && lay.fontSize >= 6).toBe(true);
    const gap = measure(' ', lay.fontSize, false);
    for (let i = 0; i < model.rows.length; i++) {
      const row = rest.filter(it => Math.abs(it.y - (firstRest.y + i * lay.leading)) < EPS);
      const name = row.find(it => it.x === 147);
      const weight = row.find(it => it.bold);
      const dots = row.find(it => /^\.+$/.test(it.text));
      if (!name || !weight || !dots) throw new Error(`row ${i} has no name, dots or weight`);
      expect(dots.text.length >= 3, `row ${i} keeps at least three dots`).toBe(true);
      const nameEnd = name.x + measure(name.text, name.size, false);
      const dotsEnd = dots.x + measure(dots.text, dots.size, false);
      const weightEnd = weight.x + measure(weight.text, weight.size, true);
      expect(name.x >= 147 - EPS && weightEnd <= 449 + EPS, `row ${i} inside 147-449`).toBe(true);
      expect(nameEnd + gap <= dots.x + EPS, `row ${i}: name then a gap then dots`).toBe(true);
      expect(dotsEnd + gap <= weight.x + EPS, `row ${i}: dots then a gap then the weight`).toBe(true);
      expect(Math.abs(weightEnd - 449) < 1e-6, `row ${i}: weight right-aligned at 449`).toBe(true);
    }
    return lay;
  }

  test('layout of a normal recipe: 19 pt rows, 36 pt apart, title at 110, first row at 170', () => {
    const lay = checkGeometry(SIX);
    expect((lay.items[0] as ported.PdfItem).y).toBe(110);
    expect((lay.items[1] as ported.PdfItem).y).toBe(170);
    expect(lay.fontSize <= 19 && lay.fontSize >= 9).toBe(true);
    expect(lay.leading).toBe(36);
  });

  test('layout with a long name: the whole list shrinks to one size and every row keeps its dots', () => {
    const lay = checkGeometry(LONG_ROW);
    expect(lay.fontSize >= 9 && lay.fontSize < 19).toBe(true);
    expect(lay.items.some(i => i.text.endsWith('…')), 'nothing is cut while it fits at 9 pt').toBe(false);
  });

  test('a name too long even at 9 pt is cut with «…», never pushed into the weight', () => {
    const huge = { ...SIX, rows: [...SIX.rows, { name: 'Confettura di ciliegie della prova lunghissima '.repeat(4), grams: 1500 }] };
    const lay = checkGeometry(huge);
    expect(lay.fontSize).toBe(9);
    expect(lay.items.filter(i => i.text.endsWith('…')).length).toBe(1);
  });

  test('names that kern badly are measured as drawn, so the gap before the dots survives (also truncated at 9 pt)', () => {
    const names = ['Torta Tyrolese di prova', 'Yogurt AVVolto', 'Torta Tyrolese di prova '.repeat(6), 'Yogurt AVVolto To Ty '.repeat(6)];
    // The two measures really differ for these names, or the test would prove nothing.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(19);
    expect(doc.getTextWidth('Yogurt AVVolto') !== drawnWidth('Yogurt AVVolto', 19, false), 'kerning is present in getTextWidth').toBe(true);
    const kerned = { ...SIX, rows: names.map((name, i) => ({ name, grams: 1000 + i })) };
    const lay = layoutOf(kerned);
    expect(lay.fontSize).toBe(9);
    const rows = lay.items.slice(1);
    const firstY = (rows[0] as ported.PdfItem).y;
    for (let i = 0; i < names.length; i++) {
      const y = firstY + i * lay.leading;
      const row = rows.filter(it => Math.abs(it.y - y) < EPS);
      const name = row.find(it => it.x === 147);
      const dots = row.find(it => /^\.+$/.test(it.text));
      if (!name || !dots) throw new Error(`row ${i} has no name or dots`);
      const gap = drawnWidth(' ', 9, false);
      expect(name.x + drawnWidth(name.text, 9, false) + gap <= dots.x + EPS, `row ${i}: drawn name + gap reaches the dots`).toBe(true);
      expect(dots.text.length >= 3).toBe(true);
    }
  });

  test('file and sheet names: the fallback words come from the caller; unusable sheet names fall back', () => {
    expect(exportFileName({ name: '///', trays: 0, totalG: 5, rows: [] }, 'pdf', 'ricetta')).toBe('ricetta_5g.pdf');
    expect(sheetNameOf('', 'Ricetta')).toBe('Ricetta');
    expect(sheetNameOf("'Torta'", 'R')).toBe('Torta');
    expect(sheetNameOf('’Torta’', 'R')).toBe('Torta');
    expect(sheetNameOf("'", 'R')).toBe('R');
    expect(sheetNameOf('History', 'R')).toBe('R');
    expect(sheetNameOf(' hIsToRy ', 'R')).toBe('R');
    expect(sheetNameOf('History of bread', 'R')).toBe('History of bread');
    expect(sheetNameOf("Torta di mele e cannella della nonna'", 'R')).toBe('Torta di mele e cannella della');
  });

  test('layout of 60 rows fits one page with the bottom margin, one size for all rows', () => {
    const lay = checkGeometry(SIXTY);
    const lastY = Math.max(...lay.items.map(i => i.y));
    expect(lastY <= PAGE_H - 60 + EPS, `last baseline ${lastY}`).toBe(true);
    expect(lay.fontSize >= 6 && lay.fontSize < 19).toBe(true);
    expect(lay.leading >= 1.25 * lay.fontSize - EPS).toBe(true);
    expect(new Set(lay.items.slice(1).map(i => i.size)).size).toBe(1);
  });

  test('a long title shrinks to fit, then is cut, and stays centred inside the page', () => {
    const long = { ...SIX, name: 'Impasto di prova '.repeat(12) };
    const lay = layoutOf(long);
    const title = lay.items[0] as ported.PdfItem;
    expect(measure(title.text, title.size, true) <= 483 + EPS).toBe(true);
    expect(title.text.endsWith('…') && lay.titleSize === 14).toBe(true);
  });

  test('xlsxSheet: merged bold title, exact numbers, a SUM formula on the last row', () => {
    const { data, options } = xlsxSheet({ title: 'T', name: 'A/B:[x]', rows: SIX.rows, totalLabel: 'Total' });
    const cell = (r: number, c: number): Loose => (data[r] as Loose)[c];
    expect(cell(0, 0).columnSpan).toBe(2);
    expect(cell(0, 0).fontWeight).toBe('bold');
    expect(cell(0, 1)).toBeNull();
    expect(data[1]).toStrictEqual([]);
    expect(cell(2, 1).value).toBe(14400.4);
    expect(data.length).toBe(2 + SIX.rows.length + 1);
    expect(cell(data.length - 1, 1).value).toBe(`SUM(B3:B${SIX.rows.length + 2})`);
    expect(options.sheet).toBe('ABx');
    expect(options.orientation).toBe('portrait');
    expect(xlsxSheet({ title: '', rows: [], totalLabel: 'x' }).options.sheet).toBe('Recipe');
    expect(xlsxSheet({ title: 'x'.repeat(50), rows: [], totalLabel: 'x' }).options.sheet.length).toBe(31);
  });

  test('xlsxSheet: the column widths follow the longest name, between 18 and 60, and the second is 12', () => {
    expect(xlsxSheet({ title: 'T', rows: [{ name: 'A', grams: 1 }], totalLabel: 'Tot' }).options.columns).toStrictEqual([{ width: 18 }, { width: 12 }]);
    expect(xlsxSheet({ title: 'T', rows: [{ name: 'x'.repeat(30), grams: 1 }], totalLabel: 'Tot' }).options.columns[0]).toStrictEqual({ width: 34 });
    expect(xlsxSheet({ title: 'T', rows: [{ name: 'x'.repeat(200), grams: 1 }], totalLabel: 'Tot' }).options.columns[0]).toStrictEqual({ width: 60 });
  });

  // ── Rows in their own unit (the Recipe catalogue) ───────────────────────────────────────

  test('exportRow: a Calculator row is grams with factor 1; a catalogue row keeps its unit', () => {
    const none = { decimals: 0, text: null };
    expect(exportRow({ name: 'A', grams: 12.5 })).toStrictEqual({ name: 'A', value: 12.5, unit: 'g', factor: 1, ...none });
    expect(exportRow({ name: 'B', value: null, unit: 'q.b.', factor: 0 })).toStrictEqual({ name: 'B', value: null, unit: 'q.b.', factor: 0, ...none });
    expect(exportRow({ name: 'C', value: 2, unit: 'kg', factor: 1000 })).toStrictEqual({ name: 'C', value: 2, unit: 'kg', factor: 1000, ...none });
    expect(exportRow({ name: 'D', value: 1.846, unit: 'kg', factor: 1000, decimals: 3, text: '1,846' }))
      .toStrictEqual({ name: 'D', value: 1.846, unit: 'kg', factor: 1000, decimals: 3, text: '1,846' });
  });

  test('exportRow: odd inputs fall back to safe values, never NaN', () => {
    expect(exportRow(null)).toStrictEqual({ name: null, value: 0, unit: 'g', factor: 1, decimals: 0, text: null });
    expect(exportRow(undefined)).toStrictEqual({ name: undefined, value: 0, unit: 'g', factor: 1, decimals: 0, text: null });
    expect(exportRow({ name: 'x', value: 'abc', unit: 'kg', factor: -3, decimals: 9, text: '' }))
      .toStrictEqual({ name: 'x', value: 0, unit: 'kg', factor: 0, decimals: 3, text: null });
    expect(exportRow({ name: 'x', value: 1, decimals: -2, text: 5 }).decimals).toBe(0);
    expect(exportRow({ name: 'x', value: 1 }).unit).toBe('');
  });

  test('PDF row text: the number and its own unit, «to taste» is the unit word alone', () => {
    expect((MIXED.rows as Loose[]).map(rowTextOf)).toStrictEqual(['500 ml', '2 kg', '3 pz', '250 g', 'q.b.']);
    expect(rowTextOf({ name: 'x', grams: 14400.4 })).toBe('14400 g');
  });

  test('title and file name: a recipe with no weight is just its name', () => {
    expect(exportTitle(ONLY_PIECES)).toBe('Decori di prova');
    expect(exportFileName(ONLY_PIECES, 'pdf')).toBe('Decori_di_prova.pdf');
    expect(exportFileName(ONLY_PIECES, 'xlsx')).toBe('Decori_di_prova.xlsx');
    expect(exportTitle(MIXED)).toBe('Crema di prova — 2750 g');
    expect(exportFileName(MIXED, 'pdf')).toBe('Crema_di_prova_2750g.pdf');
  });

  test('xlsxSheet with units: each number keeps its unit format, «to taste» is text', () => {
    const { data } = xlsxSheet({ title: 'T', rows: MIXED.rows, totalLabel: 'Total', totalG: MIXED.totalG });
    const cell = (r: number): Loose => (data[r] as Loose)[1];
    expect(cell(2).format).toBe('0 "ml"');
    expect(cell(3).format).toBe('0 "kg"');
    expect(cell(4).format).toBe('0 "pz"');
    expect(cell(5).format).toBe('0 "g"');
    expect([cell(6).value, cell(6).type]).toStrictEqual(['q.b.', String]);
    expect(cell(6).format).toBeUndefined();
    const odd = xlsxSheet({ title: 'T', rows: [{ name: 'x', value: 1, unit: 'a"b', factor: 0 }], totalLabel: 'T' });
    expect(((odd.data[2] as Loose)[1]).format).toBe('0 "ab"');
  });

  test('xlsx total: weighable rows only, converted to grams, as a formula', () => {
    const last = (rows: Loose[], totalG: number): Loose => {
      const { data } = xlsxSheet({ title: 'T', rows, totalLabel: 'Total', totalG });
      return (data[data.length - 1] as Loose)[1];
    };
    const total = last(MIXED.rows, MIXED.totalG);
    expect(total.value).toBe('B3+B4*1000+B6');
    expect(total.type).toBe('Formula');
    expect(total.format).toBe('0 "g"');
    expect(total.fontWeight).toBe('bold');
    const milli = [{ name: 'a', value: 500, unit: 'mg', factor: 0.001 }, { name: 'b', value: 10, unit: 'g', factor: 1 }];
    expect(last(milli, 11).value).toBe('B3*0.001+B4');
  });

  test('⚠️ xlsx total equals the screen total: a formula that would not round to it becomes the plain number', () => {
    const { data } = xlsxSheet({ title: 'T', rows: MIXED_DRIFT.rows, totalLabel: 'Total', totalG: MIXED_DRIFT.totalG });
    const total = (data[data.length - 1] as Loose)[1];
    expect([total.value, total.type, total.format, total.fontWeight]).toStrictEqual([1841, Number, '0 "g"', 'bold']);
  });

  test('xlsx total: no weighable row is a plain 0; gram-only rows keep SUM exactly', () => {
    const lastOf = (rows: Loose[], totalG: number): Loose => {
      const { data } = xlsxSheet({ title: 'T', rows, totalLabel: 'Total', totalG });
      return (data[data.length - 1] as Loose)[1];
    };
    const none = lastOf(ONLY_PIECES.rows, 0);
    expect([none.value, none.type, none.format]).toStrictEqual([0, Number, '0 "g"']);
    const grams = [{ name: 'a', value: 5, unit: 'g', factor: 1 }, { name: 'b', value: 7, unit: 'g', factor: 1 }];
    expect(lastOf(grams, 12).value).toBe('SUM(B3:B4)');
  });

  test('⚠️ grams and ml rows (all 1:1) that the screen totals differently are not a SUM either', () => {
    // On screen a g + ml recipe rounds each row on its own: 333 + 333 + 333, while the Total says 1000.
    const rows = [
      { name: 'a', value: 333, unit: 'g', factor: 1 },
      { name: 'b', value: 333, unit: 'ml', factor: 1 },
      { name: 'c', value: 333, unit: 'g', factor: 1 },
    ];
    const lastOf = (totalG: number): Loose => {
      const { data } = xlsxSheet({ title: 'T', rows, totalLabel: 'T', totalG });
      return (data[data.length - 1] as Loose)[1];
    };
    expect([lastOf(1000).value, lastOf(1000).type]).toStrictEqual([1000, Number]);
    expect(lastOf(999).value).toBe('SUM(B3:B5)');
  });

  // ── kg and litres keep their decimals in the files too (fix/catalogue-kg-litre-decimals) ──

  // What exportModelOf makes of a 3000 g batch of a 0.4 kg + 1.25 l + 2 pcs recipe in Italian: the amounts
  // 0.727 kg and 2.273 l (3 decimals, the screen's own text) and 4 pieces.
  const DECIMAL_ROWS = [
    { name: 'Farina di prova', value: 0.727, unit: 'kg', factor: 1000, decimals: 3, text: '0,727' },
    { name: 'Latte di prova', value: 2.273, unit: 'l', factor: 1000, decimals: 3, text: '2,273' },
    { name: 'Uova di prova', value: 4, unit: 'pz', factor: 0, decimals: 0, text: null },
  ];

  test('⚠️ a 1.846 kg row is «1,846 kg» in the PDF (as on the Italian screen), never «2 kg»', () => {
    expect(DECIMAL_ROWS.map(rowTextOf)).toStrictEqual(['0,727 kg', '2,273 l', '4 pz']);
    expect(rowTextOf({ name: 'D', value: 1.846, unit: 'kg', factor: 1000, decimals: 3, text: '1,846' })).toBe('1,846 kg');
  });

  test('⚠️ in Excel a kg / l cell holds the decimals and its format does not round them away', () => {
    const { data } = xlsxSheet({ title: 'T', rows: DECIMAL_ROWS, totalLabel: 'Totale', totalG: 3000 });
    const cell = (r: number): Loose => (data[r] as Loose)[1];
    expect([cell(2).value, cell(2).format]).toStrictEqual([0.727, 'General "kg"']);
    expect([cell(3).value, cell(3).format]).toStrictEqual([2.273, 'General "l"']);
    expect(cell(4).format).toBe('0 "pz"');
    // 0.727 kg + 2.273 l = 3000 g, the screen's total: the spreadsheet computes it itself.
    expect([cell(data.length - 1).value, cell(data.length - 1).type]).toStrictEqual(['B3*1000+B4*1000', 'Formula']);
  });

  test('the Calculator rows are untouched: whole grams, «0 "g"»', () => {
    expect(rowTextOf({ name: 'a', grams: 14400.4 })).toBe('14400 g');
    const { data } = xlsxSheet({ title: 'T', rows: [{ name: 'a', grams: 14400.4 }], totalLabel: 'T', totalG: 14400 });
    expect(((data[2] as Loose)[1]).format).toBe('0 "g"');
  });

  // ── Library failures ─────────────────────────────────────────────────────────────────────

  test('only a library that would not load WHILE OFFLINE asks for a connection', () => {
    const lib = { code: 'export/library' };
    expect(exportErrorKey(lib, false)).toBe('export.needsConnection');
    expect(exportErrorKey(lib, true)).toBe('export.failed');
    expect(exportErrorKey(lib)).toBe('export.failed');
    expect(exportErrorKey(new Error('boom'), false)).toBe('export.failed');
    expect(exportErrorKey(null, false)).toBe('export.failed');
  });

  test('the code that goes into the error report is one of two fixed words', () => {
    expect(exportErrorCode({ code: 'export/library' })).toBe('library');
    expect(exportErrorCode(new Error('Torta di prova secret'))).toBe('build');
    expect(exportErrorCode(undefined)).toBe('build');
  });
});

// ── What the port adds ───────────────────────────────────────────────────────────────────

describe('the error the app\'s loader makes', () => {
  test('libraryError is what both error functions recognise, and keeps the cause', () => {
    const cause = new Error('network');
    const err = ported.libraryError(cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(ported.LIBRARY_ERROR);
    expect(err.code).toBe('export/library');
    expect(err.cause).toBe(cause);
    expect(ported.exportErrorKey(err, false)).toBe('export.needsConnection');
    expect(ported.exportErrorKey(err, true)).toBe('export.failed');
    expect(ported.exportErrorCode(err)).toBe('library');
    // The original's functions recognise it too, so the two apps agree on one error.
    expect(legacy.exportErrorKey(err, false)).toBe('export.needsConnection');
    expect(legacy.exportErrorCode(err)).toBe('library');
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The two builders that load the libraries.
  const LEFT_OUT = ['buildPdfBlob', 'buildXlsxBlob'];
  const ADDED = ['LIBRARY_ERROR', 'libraryError'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(original[name] !== undefined, name).toBe(true);
  });

  test('exports exactly the same names, except those', () => {
    expect(Object.keys(port).sort()).toStrictEqual([...shared, ...ADDED].sort());
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
    expect(Object.isFrozen(ported.XLSX_FONT)).toBe(true);
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
