// recipe-dividers.test.mjs — the lines the owner puts between groups of ingredients, on the
// recipe screen and in the PDF. Data, geometry, moving and deleting rows, the Calculator's hand-over.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from '../js/vendor/jspdf.esm.js';
import {
  normalizeCatalogueRecipe, moveRow, removeRow, keepRows, withoutTrailingDivider, hasDividerAfter,
  exportModelOf, toCalculatorRecipe,
} from '../js/catalogue/catalogue-model.js';
import { pdfLayout, pdfMeasurer, xlsxSheet, buildPdfBlob, PAGE_W, PAGE_H } from '../js/recipe-export.js';
import { resolveRecipe } from '../js/calculator-recipe-source.js';


const doc = new jsPDF({ unit: 'pt', format: 'a4' });
const measure = pdfMeasurer(doc);
const EPS = 1e-6;
const NAME_X = (PAGE_W - 300) / 2;
const WEIGHT_RIGHT = NAME_X + 300;

const rowsOf = (n, lines = []) => Array.from({ length: n }, (_, i) => ({
  name: `Item ${i + 1}`, text: '100 g', ...(lines.includes(i) ? { dividerAfter: true } : {}),
}));
const layout = rows => pdfLayout({ title: 'Sample loaf', rows }, measure);

// ── Data ──────────────────────────────────────────────────────────────────────

test('normalize: dividerAfter true survives; no field stays no key; anything else is no line', () => {
  const out = normalizeCatalogueRecipe({
    id: 'a', name: 'Sample loaf',
    ingredients: [
      { label: 'Flour', grams: 1, dividerAfter: true },
      { label: 'Water', grams: 1 },
      { label: 'Salt', grams: 1, dividerAfter: 'true' },
      { label: 'Yeast', grams: 1, dividerAfter: 1 },
      { label: 'Oil', grams: 1, dividerAfter: false },
    ],
  });
  assert.equal(out.ingredients[0].dividerAfter, true);
  for (const i of [1, 2, 3, 4]) assert.equal('dividerAfter' in out.ingredients[i], false, `row ${i}`);
});

test('exportModelOf carries the flag, and no key when absent', () => {
  const recipe = { name: 'Sample loaf', ingredients: [{ label: 'Flour', grams: 5, unit: 'g', dividerAfter: true }, { label: 'Water', grams: 3, unit: 'g' }] };
  const m = exportModelOf(recipe, [5, 3], 8);
  assert.equal(m.rows[0].dividerAfter, true);
  assert.equal('dividerAfter' in m.rows[1], false);
});

test('toCalculatorRecipe leaves the lines behind (the import is grams-only, no lines)', () => {
  const out = toCalculatorRecipe({ id: 'x', name: 'Sample loaf', ingredients: [{ label: 'Flour', grams: 5, unit: 'g', dividerAfter: true }, { label: 'Water', grams: 3, unit: 'g' }] });
  for (const r of out.ingredients) assert.equal('dividerAfter' in r, false);
});

// ── PDF geometry ──────────────────────────────────────────────────────────────

test('no divider: items, leading and font size equal the same rows with the field absent, and lines is empty', () => {
  const plain = layout(rowsOf(6));
  const withFalse = layout(rowsOf(6).map(r => ({ ...r, dividerAfter: false })));
  assert.deepEqual(withFalse.items, plain.items);
  assert.equal(withFalse.leading, plain.leading);
  assert.equal(withFalse.fontSize, plain.fontSize);
  assert.deepEqual(plain.lines, []);
});

test('one divider on a short recipe: a thin line halfway between two rows, rows below move by 14, rows above stay', () => {
  const plain = layout(rowsOf(6));
  const cut = layout(rowsOf(6, [2]));
  const ys = r => r.items.filter(i => i.bold).slice(1).map(i => i.y);
  const a = ys(plain);
  const b = ys(cut);
  assert.equal(cut.lines.length, 1);
  const line = cut.lines[0];
  assert.ok(Math.abs(line.y - (a[2] + (30 + 14 + 4.2 - 14.3) / 2)) < EPS);
  assert.equal(line.x1, NAME_X);
  assert.equal(line.x2, WEIGHT_RIGHT);
  assert.equal(line.width, 0.75);
  [0, 1, 2].forEach(i => assert.ok(Math.abs(b[i] - a[i]) < EPS, `row ${i} does not move`));
  [3, 4, 5].forEach(i => assert.ok(Math.abs(b[i] - a[i] - 14) < EPS, `row ${i} moves by 14`));
});

test('a divider on the last row draws nothing and moves nothing', () => {
  const plain = layout(rowsOf(4));
  const last = layout(rowsOf(4, [3]));
  assert.deepEqual(last.lines, []);
  assert.deepEqual(last.items, plain.items);
});

test('two dividers push the last row down by 28', () => {
  const plain = layout(rowsOf(6));
  const two = layout(rowsOf(6, [1, 3]));
  const lastY = r => r.items.filter(i => i.bold).slice(1).pop().y;
  assert.equal(two.lines.length, 2);
  assert.ok(Math.abs(lastY(two) - lastY(plain) - 28) < EPS);
});

test('a long recipe with dividers still fits one page: the air is kept, the leading shrinks', () => {
  const l = layout(rowsOf(40, [4, 9, 14, 19, 24]));
  const ys = l.items.filter(i => i.bold).slice(1).map(i => i.y);
  assert.equal(l.lines.length, 5);
  assert.ok(ys[ys.length - 1] <= PAGE_H - 60 + EPS);
  assert.ok(ys.every(Number.isFinite) && l.leading > 0);
  const step = ys[5] - ys[4]; // across the first line: leading + air
  assert.ok(Math.abs(step - (l.leading + 14)) < EPS, 'the air is still 14');
  assert.ok(l.leading < 30, 'the leading is what gave way');
});

test('300 rows with a divider on every row: one page, no NaN, no negative leading', () => {
  const l = layout(rowsOf(300, Array.from({ length: 300 }, (_, i) => i)));
  const ys = l.items.filter(i => i.bold).slice(1).map(i => i.y);
  assert.ok(ys[ys.length - 1] <= PAGE_H - 60 + EPS);
  assert.ok(ys.every(Number.isFinite));
  assert.ok(l.leading >= 0 && Number.isFinite(l.fontSize));
  assert.ok(l.lines.every(x => Number.isFinite(x.y)));
});

test('buildPdfBlob draws a line operator with a divider and none without', async () => {
  const text = async m => Buffer.from(await (await buildPdfBlob(m)).arrayBuffer()).toString('latin1');
  const rows = [{ name: 'Flour', grams: 100 }, { name: 'Water', grams: 70 }, { name: 'Salt', grams: 2 }];
  const without = await text({ name: 'Sample loaf', trays: 0, totalG: 172, rows });
  const withLine = await text({ name: 'Sample loaf', trays: 0, totalG: 172, rows: rows.map((r, i) => (i === 0 ? { ...r, dividerAfter: true } : r)) });
  assert.doesNotMatch(without, /\sl\s+S/);
  assert.match(withLine, /\sl\s+S/);
});

test('Excel ignores the lines: the sheet is identical with and without them', () => {
  const rows = [{ name: 'Flour', value: 100, unit: 'g', factor: 1 }, { name: 'Water', value: 70, unit: 'g', factor: 1 }];
  const args = { title: 'Sample loaf', name: 'Sample loaf', totalLabel: 'Total', totalG: 170 };
  assert.deepEqual(
    xlsxSheet({ ...args, rows: rows.map((r, i) => (i === 0 ? { ...r, dividerAfter: true } : r)) }),
    xlsxSheet({ ...args, rows }),
  );
});

// ── Moving, deleting, keeping rows ────────────────────────────────────────────

const mk = (spec) => spec.split(' ').map(s => (s.endsWith('|') ? { label: s.slice(0, -1), dividerAfter: true } : { label: s }));
const show = rows => rows.map(r => r.label + (r.dividerAfter ? '|' : '')).join(' ');

test('moveRow: the line stays between the rows, the moved row leaves it behind', () => {
  assert.equal(show(moveRow(mk('A B C| D'), 2, 3)), 'A B| D C');
  assert.equal(show(moveRow(mk('A B| C D'), 2, 0)), 'C A B| D');
  assert.equal(show(moveRow(mk('A B| C D'), 3, 0)), 'D A B| C');
});

test('moveRow: the first row carrying a line, moved, loses it', () => {
  assert.equal(show(moveRow(mk('A| B C'), 0, 2)), 'B C A');
});

test('moveRow keeps the same row objects', () => {
  const rows = mk('A B C| D');
  const out = moveRow(rows, 2, 3);
  assert.ok(rows.every(r => out.includes(r)));
});

test('removeRow: the line goes to the row above, or goes with the first row; input untouched', () => {
  const ab = mk('A B| C');
  assert.equal(show(removeRow(ab, 1)), 'A| C');
  assert.equal(show(ab), 'A B| C', 'input not mutated');
  assert.equal(show(removeRow(mk('A| B'), 0)), 'B');
  // The line would be under the new last row: hidden there, it would come back with the next row added.
  assert.equal(show(removeRow(mk('A B| C'), 2)), 'A B');
});

test('moveRow never leaves a hidden line under the last row', () => {
  assert.equal(show(moveRow(mk('A B| C'), 2, 0)), 'C A B');
  const rows = mk('A B C');
  rows[2].dividerAfter = true;            // a line already hidden under the last row
  assert.equal(show(moveRow(rows, 0, 2)), 'B C| A', 'C is no longer last, so its line shows');
});

test('keepRows: a blank row carrying a line hands it to the row above', () => {
  const rows = [{ label: 'A' }, { label: ' ', dividerAfter: true }, { label: 'B' }];
  const out = keepRows(rows, r => r.label.trim());
  assert.equal(show(out), 'A| B');
  assert.equal('dividerAfter' in rows[0], false, 'the original row is a copy, never mutated');
  assert.equal(show(keepRows(null, () => true)), '');
});

test('withoutTrailingDivider takes the line off the last row only, without mutating', () => {
  const rows = mk('A| B|');
  const out = withoutTrailingDivider(rows);
  assert.equal(show(out), 'A| B');
  assert.equal(show(rows), 'A| B|');
  const fine = mk('A| B');
  assert.equal(withoutTrailingDivider(fine), fine);
  assert.deepEqual(withoutTrailingDivider(undefined), []);
});

test('hasDividerAfter: never under the last row', () => {
  const rows = mk('A| B|');
  assert.equal(hasDividerAfter(rows, 0), true);
  assert.equal(hasDividerAfter(rows, 1), false);
  assert.equal(hasDividerAfter(null, 0), false);
});

// ── The Calculator ────────────────────────────────────────────────────────────

test('resolveRecipe hands the lines over as a separate list, never on the ingredients', () => {
  const catalogue = {
    c1: { name: 'Sample loaf', ingredients: [
      { label: 'Flour', grams: 100, unit: 'g' },
      { label: 'Water', grams: 70, unit: 'g', dividerAfter: true },
      { label: 'Salt', grams: 2, unit: 'g' },
    ] },
  };
  const out = resolveRecipe({ id: 'r', catalogueId: 'c1' }, catalogue);
  assert.deepEqual(out.dividersAfter, [1]);
  for (const ing of out.ingredients) assert.equal('dividerAfter' in ing, false);
});

test('resolveRecipe: a blank row carrying a line hands it to the row above; unlinked has no key', () => {
  const catalogue = {
    c1: { name: 'Sample loaf', ingredients: [
      { label: 'Flour', grams: 100, unit: 'g' },
      { label: '', grams: 0, unit: 'g', dividerAfter: true },
      { label: 'Salt', grams: 2, unit: 'g' },
    ] },
  };
  assert.deepEqual(resolveRecipe({ id: 'r', catalogueId: 'c1' }, catalogue).dividersAfter, [0]);
  const own = resolveRecipe({ id: 'r', name: 'Own', ingredients: [{ label: 'Flour', grams: 1 }] }, {});
  assert.equal('dividersAfter' in own, false);
});
