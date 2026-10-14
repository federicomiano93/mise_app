// The recipe export (js/recipe-export.js): names, the PDF geometry, a real PDF and a real .xlsx
// built in Node. The owner cannot read a PDF's internals, so these pin what he would see:
// one page, every row, dots that never touch the words, numbers that stay exact.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from '../js/vendor/jspdf.esm.js';
import { unzipSync, strFromU8 } from '../js/vendor/fflate.esm.js';
import {
  exportTitle, exportFileName, rowText, pdfLayout, rowTextOf, exportRow, pdfSafe, pdfMeasurer, sheetNameOf, xlsxSheet, buildPdfBlob, buildXlsxBlob,
  PAGE_W, PAGE_H,
} from '../js/recipe-export.js';
import { SIX, TRAYS, LONG_ROW, SIXTY, AWKWARD_NAME, MIXED, MIXED_DRIFT, ONLY_PIECES } from './fixtures/recipe-export-fixtures.mjs';

const doc = new jsPDF({ unit: 'pt', format: 'a4' });
// The width of what a Tj really draws: no kerning (see pdfMeasurer).
const measure = pdfMeasurer(doc);
// Written out here too, so the test does not trust the code it checks.
const drawnWidth = (text, size, bold) => {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  return [...text].reduce((w, ch) => w + doc.getTextWidth(ch), 0);
};
const layoutOf = m => pdfLayout({ title: exportTitle(m), rows: m.rows.map(r => ({ name: r.name, text: rowText(r.grams) })) }, measure);
const EPS = 1e-6;

test('title: trays say «x N», otherwise the total in grams with an em dash', () => {
  assert.equal(exportTitle(TRAYS), 'Pizza di prova x 3');
  assert.equal(exportTitle(SIX), 'Impasto di prova — 24000 g');
});

test('file name: trays or grams, unsafe characters gone, spaces become underscores', () => {
  assert.equal(exportFileName(TRAYS, 'pdf'), 'Pizza_di_prova_x3.pdf');
  assert.equal(exportFileName({ name: 'Focaccia', trays: 0, totalG: 24000 }, 'xlsx'), 'Focaccia_24000g.xlsx');
  assert.equal(exportFileName(AWKWARD_NAME, 'pdf'), 'Focaccia_piùmeno_prova_1000g.pdf');
  assert.equal(exportFileName({ name: ' \\/:*?"<>| ', trays: 2, totalG: 5 }, 'pdf'), 'recipe_x2.pdf');
  assert.equal(exportFileName({ name: 'a\u0007b\n c', trays: 0, totalG: 5 }, 'pdf'), 'ab_c_5g.pdf');
});

test('row text is what the result card shows: rounded grams, recipe order kept', () => {
  assert.equal(rowText(14400.4), '14400 g');
  assert.equal(rowText(8640.5), '8641 g');
  assert.equal(rowText(0), '0 g');
  const { items } = layoutOf(SIX);
  const weights = items.filter(i => i.bold && i !== items[0]).map(i => i.text);
  assert.deepEqual(weights, SIX.rows.map(r => rowText(r.grams)));
  const names = items.filter(i => !i.bold && !/^\.+$/.test(i.text)).map(i => i.text);
  assert.deepEqual(names, SIX.rows.map(r => r.name));
});

test('pdfSafe keeps Italian accents and typographic quotes, replaces what Helvetica cannot draw', () => {
  assert.equal(pdfSafe('Più è ’buono’ — “sì” €'), 'Più è ’buono’ — “sì” €');
  assert.equal(pdfSafe('Farina 全 ✓'), 'Farina ? ?');
});

function checkGeometry(m) {
  const lay = layoutOf(m);
  const [title, ...rest] = lay.items;
  assert.ok(title.x >= -EPS && title.x + measure(title.text, title.size, true) <= PAGE_W + EPS, 'title inside the page');
  assert.ok(lay.titleSize >= 14 && lay.fontSize >= 6);
  const gap = measure(' ', lay.fontSize, false);
  for (let i = 0; i < m.rows.length; i++) {
    const row = rest.filter(it => Math.abs(it.y - (rest[0].y + i * lay.leading)) < EPS);
    const name = row.find(it => it.x === 147);
    const weight = row.find(it => it.bold);
    const dots = row.find(it => /^\.+$/.test(it.text));
    assert.ok(name && weight && dots, `row ${i} has name, dots and weight`);
    assert.ok(dots.text.length >= 3, `row ${i} keeps at least three dots`);
    const nameEnd = name.x + measure(name.text, name.size, false);
    const dotsEnd = dots.x + measure(dots.text, dots.size, false);
    const weightEnd = weight.x + measure(weight.text, weight.size, true);
    assert.ok(name.x >= 147 - EPS && weightEnd <= 449 + EPS, `row ${i} inside 147-449`);
    assert.ok(nameEnd + gap <= dots.x + EPS, `row ${i}: name then a gap then dots`);
    assert.ok(dotsEnd + gap <= weight.x + EPS, `row ${i}: dots then a gap then the weight`);
    assert.ok(Math.abs(weightEnd - 449) < 1e-6, `row ${i}: weight right-aligned at 449`);
  }
  return lay;
}

test('layout of a normal recipe: 19 pt rows, 36 pt apart, title at 110, first row at 170', () => {
  const lay = checkGeometry(SIX);
  assert.equal(lay.items[0].y, 110);
  assert.equal(lay.items[1].y, 170);
  assert.ok(lay.fontSize <= 19 && lay.fontSize >= 9);
  assert.equal(lay.leading, 36);
});

test('layout with a long name: the whole list shrinks to one size and every row keeps its dots', () => {
  const lay = checkGeometry(LONG_ROW);
  assert.ok(lay.fontSize >= 9 && lay.fontSize < 19);
  assert.ok(!lay.items.some(i => i.text.endsWith('…')), 'nothing is cut while it fits at 9 pt');
});

test('a name too long even at 9 pt is cut with «…», never pushed into the weight', () => {
  const huge = { ...SIX, rows: [...SIX.rows, { name: 'Confettura di ciliegie della prova lunghissima '.repeat(4), grams: 1500 }] };
  const lay = checkGeometry(huge);
  assert.equal(lay.fontSize, 9);
  assert.equal(lay.items.filter(i => i.text.endsWith('…')).length, 1);
});

test('names that kern badly are measured as drawn, so the gap before the dots survives (also truncated at 9 pt)', () => {
  const names = ['Torta Tyrolese di prova', 'Yogurt AVVolto', 'Torta Tyrolese di prova '.repeat(6), 'Yogurt AVVolto To Ty '.repeat(6)];
  // The two measures really differ for these names, or the test would prove nothing.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(19);
  assert.ok(doc.getTextWidth('Yogurt AVVolto') !== drawnWidth('Yogurt AVVolto', 19, false), 'kerning is present in getTextWidth');
  const kerned = { ...SIX, rows: names.map((name, i) => ({ name, grams: 1000 + i })) };
  const lay = layoutOf(kerned);
  assert.equal(lay.fontSize, 9);
  const rows = lay.items.slice(1);
  for (let i = 0; i < names.length; i++) {
    const y = rows[0].y + i * lay.leading;
    const row = rows.filter(it => Math.abs(it.y - y) < EPS);
    const name = row.find(it => it.x === 147);
    const dots = row.find(it => /^\.+$/.test(it.text));
    const gap = drawnWidth(' ', 9, false);
    assert.ok(name.x + drawnWidth(name.text, 9, false) + gap <= dots.x + EPS, `row ${i}: drawn name + gap reaches the dots`);
    assert.ok(dots.text.length >= 3);
  }
});

test('file and sheet names: the fallback words come from the caller; unusable sheet names fall back', () => {
  assert.equal(exportFileName({ name: '///', trays: 0, totalG: 5 }, 'pdf', 'ricetta'), 'ricetta_5g.pdf');
  assert.equal(sheetNameOf('', 'Ricetta'), 'Ricetta');
  assert.equal(sheetNameOf("'Torta'", 'R'), 'Torta');
  assert.equal(sheetNameOf('’Torta’', 'R'), 'Torta');
  assert.equal(sheetNameOf("'", 'R'), 'R');
  assert.equal(sheetNameOf('History', 'R'), 'R');
  assert.equal(sheetNameOf(' hIsToRy ', 'R'), 'R');
  assert.equal(sheetNameOf('History of bread', 'R'), 'History of bread');
  assert.equal(sheetNameOf("Torta di mele e cannella della nonna'", 'R'), 'Torta di mele e cannella della');
});

test('layout of 60 rows fits one page with the bottom margin, one size for all rows', () => {
  const lay = checkGeometry(SIXTY);
  const lastY = Math.max(...lay.items.map(i => i.y));
  assert.ok(lastY <= PAGE_H - 60 + EPS, `last baseline ${lastY}`);
  assert.ok(lay.fontSize >= 6 && lay.fontSize < 19);
  assert.ok(lay.leading >= 1.25 * lay.fontSize - EPS);
  assert.equal(new Set(lay.items.slice(1).map(i => i.size)).size, 1);
});

test('a long title shrinks to fit, then is cut, and stays centred inside the page', () => {
  const long = { ...SIX, name: 'Impasto di prova '.repeat(12) };
  const lay = layoutOf(long);
  const title = lay.items[0];
  assert.ok(measure(title.text, title.size, true) <= 483 + EPS);
  assert.ok(title.text.endsWith('…') && lay.titleSize === 14);
});

async function pdfText(m) {
  const blob = await buildPdfBlob(m);
  assert.equal(blob.type, 'application/pdf');
  return Buffer.from(await blob.arrayBuffer()).toString('latin1');
}

test('a real PDF: exactly one page, the title and every row are in it', async () => {
  const pdf = await pdfText(TRAYS);
  assert.ok(pdf.startsWith('%PDF-'));
  assert.equal((pdf.match(/\/Type \/Page(?!s)/g) || []).length, 1);
  assert.ok(pdf.includes('(Pizza di prova x 3)'));
  for (const r of TRAYS.rows) {
    assert.ok(pdf.includes(`(${r.name})`), r.name);
    assert.ok(pdf.includes(`(${rowText(r.grams)})`), rowText(r.grams));
  }
  assert.match(pdf, /\/Title \(Pizza di prova x 3\)/);
});

test('a real PDF of 60 rows is still one page', async () => {
  const pdf = await pdfText(SIXTY);
  assert.equal((pdf.match(/\/Type \/Page(?!s)/g) || []).length, 1);
  assert.ok(pdf.includes(`(${rowText(SIXTY.rows[59].grams)})`));
});

test('xlsxSheet: merged bold title, exact numbers, a SUM formula on the last row', () => {
  const { data, options } = xlsxSheet({ title: 'T', name: 'A/B:[x]', rows: SIX.rows, totalLabel: 'Total' });
  assert.equal(data[0][0].columnSpan, 2);
  assert.equal(data[0][0].fontWeight, 'bold');
  assert.equal(data[0][1], null);
  assert.deepEqual(data[1], []);
  assert.equal(data[2][1].value, 14400.4);
  assert.equal(data.length, 2 + SIX.rows.length + 1);
  assert.equal(data.at(-1)[1].value, `SUM(B3:B${SIX.rows.length + 2})`);
  assert.equal(options.sheet, 'ABx');
  assert.equal(options.orientation, 'portrait');
  assert.equal(xlsxSheet({ title: '', rows: [], totalLabel: 'x' }).options.sheet, 'Recipe');
  assert.equal(xlsxSheet({ title: 'x'.repeat(50), rows: [], totalLabel: 'x' }).options.sheet.length, 31);
});

test('a real .xlsx: merge A1:B1, bold title, exact numbers with the «g» format, formula total', async () => {
  const blob = await buildXlsxBlob(SIX, 'Impasto totale');
  assert.match(blob.type, /spreadsheetml/);
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  const styles = strFromU8(files['xl/styles.xml']);
  const strings = strFromU8(files['xl/sharedStrings.xml']);
  assert.match(sheet, /<mergeCell ref="A1:B1"/);
  assert.match(sheet, /<f>SUM\(B3:B8\)<\/f>/);
  assert.match(sheet, /orientation="portrait"/);
  assert.ok(strings.includes('Impasto di prova — 24000 g'));
  assert.ok(strings.includes('Impasto totale'));
  assert.match(styles, /formatCode="0 &quot;g&quot;"/);
  assert.match(styles, /<b\s*\/>|<b>/);
  // Every font names its size, so the column widths (counted in characters) mean the same everywhere.
  const fonts = [...styles.matchAll(/<font>(.*?)<\/font>/g)].map(m => m[1]);
  assert.ok(fonts.length >= 2);
  for (const f of fonts) assert.match(f, /<sz val="11"\/>/);
  const values = [...sheet.matchAll(/<c r="B([3-8])"[^>]*><v>([^<]+)<\/v>/g)].map(m => Number(m[2]));
  assert.deepEqual(values, SIX.rows.map(r => r.grams));
  assert.equal(Math.round(SIX.rows.reduce((s, r) => s + r.grams, 0)), SIX.totalG);
  assert.match(strFromU8(files['xl/workbook.xml']), /<sheet [^>]*name="Impasto di prova"/);
});

// ── Rows in their own unit (the Recipe catalogue) ─────────────────────────────────────────

test('exportRow: a Calculator row is grams with factor 1; a catalogue row keeps its unit', () => {
  assert.deepEqual(exportRow({ name: 'A', grams: 12.5 }), { name: 'A', value: 12.5, unit: 'g', factor: 1 });
  assert.deepEqual(exportRow({ name: 'B', value: null, unit: 'q.b.', factor: 0 }), { name: 'B', value: null, unit: 'q.b.', factor: 0 });
  assert.deepEqual(exportRow({ name: 'C', value: 2, unit: 'kg', factor: 1000 }), { name: 'C', value: 2, unit: 'kg', factor: 1000 });
});

test('PDF row text: the number and its own unit, «to taste» is the unit word alone', () => {
  assert.deepEqual(MIXED.rows.map(rowTextOf), ['500 ml', '2 kg', '3 pz', '250 g', 'q.b.']);
  assert.equal(rowTextOf({ name: 'x', grams: 14400.4 }), '14400 g');
});

test('title and file name: a recipe with no weight is just its name', () => {
  assert.equal(exportTitle(ONLY_PIECES), 'Decori di prova');
  assert.equal(exportFileName(ONLY_PIECES, 'pdf'), 'Decori_di_prova.pdf');
  assert.equal(exportFileName(ONLY_PIECES, 'xlsx'), 'Decori_di_prova.xlsx');
  assert.equal(exportTitle(MIXED), 'Crema di prova — 2750 g');
  assert.equal(exportFileName(MIXED, 'pdf'), 'Crema_di_prova_2750g.pdf');
});

test('xlsxSheet with units: each number keeps its unit format, «to taste» is text', () => {
  const { data } = xlsxSheet({ title: 'T', rows: MIXED.rows, totalLabel: 'Total', totalG: MIXED.totalG });
  assert.equal(data[2][1].format, '0 "ml"');
  assert.equal(data[3][1].format, '0 "kg"');
  assert.equal(data[4][1].format, '0 "pz"');
  assert.equal(data[5][1].format, '0 "g"');
  assert.deepEqual([data[6][1].value, data[6][1].type], ['q.b.', String]);
  assert.equal(data[6][1].format, undefined);
  const odd = xlsxSheet({ title: 'T', rows: [{ name: 'x', value: 1, unit: 'a"b', factor: 0 }], totalLabel: 'T' });
  assert.equal(odd.data[2][1].format, '0 "ab"');
});

test('xlsx total: weighable rows only, converted to grams, as a formula', () => {
  const total = xlsxSheet({ title: 'T', rows: MIXED.rows, totalLabel: 'Total', totalG: MIXED.totalG }).data.at(-1)[1];
  assert.equal(total.value, 'B3+B4*1000+B6');
  assert.equal(total.type, 'Formula');
  assert.equal(total.format, '0 "g"');
  assert.equal(total.fontWeight, 'bold');
  const milli = [{ name: 'a', value: 500, unit: 'mg', factor: 0.001 }, { name: 'b', value: 10, unit: 'g', factor: 1 }];
  assert.equal(xlsxSheet({ title: 'T', rows: milli, totalLabel: 'T', totalG: 11 }).data.at(-1)[1].value, 'B3*0.001+B4');
});

test('⚠️ xlsx total equals the screen total: a formula that would not round to it becomes the plain number', () => {
  const total = xlsxSheet({ title: 'T', rows: MIXED_DRIFT.rows, totalLabel: 'Total', totalG: MIXED_DRIFT.totalG }).data.at(-1)[1];
  assert.deepEqual([total.value, total.type, total.format, total.fontWeight], [802, Number, '0 "g"', 'bold']);
});

test('xlsx total: no weighable row is a plain 0; gram-only rows keep SUM exactly', () => {
  const none = xlsxSheet({ title: 'T', rows: ONLY_PIECES.rows, totalLabel: 'Total', totalG: 0 }).data.at(-1)[1];
  assert.deepEqual([none.value, none.type, none.format], [0, Number, '0 "g"']);
  const grams = [{ name: 'a', value: 5, unit: 'g', factor: 1 }, { name: 'b', value: 7, unit: 'g', factor: 1 }];
  assert.equal(xlsxSheet({ title: 'T', rows: grams, totalLabel: 'T', totalG: 12 }).data.at(-1)[1].value, 'SUM(B3:B4)');
});

test('a real PDF from mixed units: one page, each row with its own unit, the title without a weight', async () => {
  const pdf = await pdfText(MIXED);
  assert.equal((pdf.match(/\/Type \/Page(?!s)/g) || []).length, 1);
  for (const text of ['500 ml', '2 kg', '3 pz', '250 g', 'q.b.']) assert.ok(pdf.includes(`(${text})`), text);
  const pieces = await pdfText(ONLY_PIECES);
  assert.ok(pieces.includes('(Decori di prova)'));
  assert.match(pieces, /\/Title \(Decori di prova\)/);
});

test('a real .xlsx from mixed units: unit formats, q.b. as text, the converted-total formula', async () => {
  const blob = await buildXlsxBlob(MIXED, 'Totale');
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  const styles = strFromU8(files['xl/styles.xml']);
  const strings = strFromU8(files['xl/sharedStrings.xml']);
  assert.match(sheet, /<f>B3\+B4\*1000\+B6<\/f>/);
  for (const unit of ['ml', 'kg', 'pz', 'g']) assert.match(styles, new RegExp(`formatCode="0 &quot;${unit}&quot;"`));
  assert.ok(strings.includes('q.b.'));
  const values = [...sheet.matchAll(/<c r="B([3-5])"[^>]*><v>([^<]+)<\/v>/g)].map(m => Number(m[2]));
  assert.deepEqual(values, [500, 2, 3]);
  const drift = await buildXlsxBlob(MIXED_DRIFT, 'Totale');
  const driftSheet = strFromU8(unzipSync(new Uint8Array(await drift.arrayBuffer()))['xl/worksheets/sheet1.xml']);
  assert.doesNotMatch(driftSheet, /<f>/);
  assert.match(driftSheet, /<c r="B6"[^>]*><v>802<\/v>/);
});
