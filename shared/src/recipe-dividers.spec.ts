// recipe-dividers.spec.ts — the lines the owner puts between groups of ingredients (5 Nov 2026): the data, the PDF
// geometry, moving and deleting rows, the Calculator's hand-over. Every test runs against the TypeScript ports AND
// the js/ originals (catalogue-model, recipe-export, calculator-recipe-source), so the two cannot drift.
//
// PORTED from tests/recipe-dividers.test.mjs: every test except `exportModelOf` (in Mise 2 that is the app's
// recipeExportModel, with its own spec) and `buildPdfBlob` (the app's recipeExport.ts, its own spec). Added: each
// pdfLayout and resolveRecipe answer compared with the original's, input for input.

import { describe, expect, test } from 'vitest';
import * as portedModel from './catalogue-model';
import * as portedExport from './recipe-export';
import * as portedSource from './calculator-recipe-source';
import * as legacyModelJs from '../../js/catalogue/catalogue-model.js';
import * as legacyExportJs from '../../js/recipe-export.js';
import * as legacySourceJs from '../../js/calculator-recipe-source.js';
import { jsPDF } from '../../js/vendor/jspdf.esm.js';

const legacyModel = legacyModelJs as unknown as typeof portedModel;
const legacyExport = legacyExportJs as unknown as typeof portedExport;
const legacySource = legacySourceJs as unknown as typeof portedSource;

type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Row = { label: string; dividerAfter?: boolean };
type LayoutRow = { name: string; text: string; dividerAfter?: boolean };

const doc = new (jsPDF as Loose)({ unit: 'pt', format: 'a4' });
const measure = portedExport.pdfMeasurer(doc);
const EPS = 1e-6;
const NAME_X = (portedExport.PAGE_W - 300) / 2;
const WEIGHT_RIGHT = NAME_X + 300;

const rowsOf = (n: number, lines: number[] = []): LayoutRow[] => Array.from({ length: n }, (_, i) => ({
  name: `Item ${i + 1}`, text: '100 g', ...(lines.includes(i) ? { dividerAfter: true } : {}),
}));
const mk = (spec: string): Row[] => spec.split(' ')
  .map(s => (s.endsWith('|') ? { label: s.slice(0, -1), dividerAfter: true } : { label: s }));
const show = (rows: Row[]): string => rows.map(r => r.label + (r.dividerAfter ? '|' : '')).join(' ');

describe.each([
  ['shared/ (TypeScript)', portedModel, portedExport, portedSource],
  ['js/ (current app)', legacyModel, legacyExport, legacySource],
] as const)('%s', (_name, m, x, src) => {
  const layout = (rows: LayoutRow[]) => x.pdfLayout({ title: 'Sample loaf', rows }, measure);
  const bolds = (l: portedExport.PdfLayout) => l.items.filter(i => i.bold).slice(1).map(i => i.y);

  // ── Data ──────────────────────────────────────────────────────────────────────

  test('normalize: dividerAfter true survives; no field stays no key; anything else is no line', () => {
    const out = m.normalizeCatalogueRecipe({
      id: 'a', name: 'Sample loaf',
      ingredients: [
        { label: 'Flour', grams: 1, dividerAfter: true },
        { label: 'Water', grams: 1 },
        { label: 'Salt', grams: 1, dividerAfter: 'true' },
        { label: 'Yeast', grams: 1, dividerAfter: 1 },
        { label: 'Oil', grams: 1, dividerAfter: false },
      ],
    });
    expect(out?.ingredients[0]?.dividerAfter).toBe(true);
    for (const i of [1, 2, 3, 4]) expect('dividerAfter' in (out?.ingredients[i] ?? {}), `row ${i}`).toBe(false);
  });

  test('toCalculatorRecipe leaves the lines behind', () => {
    const out = m.toCalculatorRecipe({
      id: 'x', name: 'Sample loaf',
      ingredients: [{ label: 'Flour', grams: 5, unit: 'g', dividerAfter: true }, { label: 'Water', grams: 3, unit: 'g' }],
    } as Loose);
    for (const r of out.ingredients) expect('dividerAfter' in (r as object)).toBe(false);
  });

  // ── PDF geometry ──────────────────────────────────────────────────────────────

  test('no divider: items, leading and font size equal the same rows with the field false, and lines is empty', () => {
    const plain = layout(rowsOf(6));
    const withFalse = layout(rowsOf(6).map(r => ({ ...r, dividerAfter: false })));
    expect(withFalse.items).toStrictEqual(plain.items);
    expect(withFalse.leading).toBe(plain.leading);
    expect(withFalse.fontSize).toBe(plain.fontSize);
    expect(plain.lines).toStrictEqual([]);
  });

  test('one divider on a short recipe: a thin line halfway between two rows, rows below move by 14, rows above stay', () => {
    const a = bolds(layout(rowsOf(6)));
    const cut = layout(rowsOf(6, [2]));
    const b = bolds(cut);
    expect(cut.lines.length).toBe(1);
    const line = cut.lines[0]!;
    expect(Math.abs(line.y - (a[2]! + (30 + 14 + 4.2 - 14.3) / 2))).toBeLessThan(EPS);
    expect(line.x1).toBe(NAME_X);
    expect(line.x2).toBe(WEIGHT_RIGHT);
    expect(line.width).toBe(0.75);
    [0, 1, 2].forEach(i => expect(Math.abs(b[i]! - a[i]!), `row ${i} does not move`).toBeLessThan(EPS));
    [3, 4, 5].forEach(i => expect(Math.abs(b[i]! - a[i]! - 14), `row ${i} moves by 14`).toBeLessThan(EPS));
  });

  test('a divider on the last row draws nothing and moves nothing', () => {
    const plain = layout(rowsOf(4));
    const last = layout(rowsOf(4, [3]));
    expect(last.lines).toStrictEqual([]);
    expect(last.items).toStrictEqual(plain.items);
  });

  test('two dividers push the last row down by 28', () => {
    const plain = bolds(layout(rowsOf(6)));
    const two = layout(rowsOf(6, [1, 3]));
    expect(two.lines.length).toBe(2);
    expect(Math.abs((bolds(two).pop() as number) - (plain.pop() as number) - 28)).toBeLessThan(EPS);
  });

  test('a long recipe with dividers still fits one page: the air is kept, the leading shrinks', () => {
    const l = layout(rowsOf(40, [4, 9, 14, 19, 24]));
    const ys = bolds(l);
    expect(l.lines.length).toBe(5);
    expect(ys[ys.length - 1]!).toBeLessThanOrEqual(portedExport.PAGE_H - 60 + EPS);
    expect(ys.every(Number.isFinite) && l.leading > 0).toBe(true);
    expect(Math.abs(ys[5]! - ys[4]! - (l.leading + 14)), 'the air is still 14').toBeLessThan(EPS);
    expect(l.leading, 'the leading is what gave way').toBeLessThan(30);
  });

  test('300 rows with a divider on every row: one page, no NaN, no negative leading', () => {
    const l = layout(rowsOf(300, Array.from({ length: 300 }, (_, i) => i)));
    const ys = bolds(l);
    expect(ys[ys.length - 1]!).toBeLessThanOrEqual(portedExport.PAGE_H - 60 + EPS);
    expect(ys.every(Number.isFinite)).toBe(true);
    expect(l.leading >= 0 && Number.isFinite(l.fontSize)).toBe(true);
    expect(l.lines.every(line => Number.isFinite(line.y))).toBe(true);
  });

  test('Excel ignores the lines: the sheet is identical with and without them', () => {
    const rows = [{ name: 'Flour', value: 100, unit: 'g', factor: 1 }, { name: 'Water', value: 70, unit: 'g', factor: 1 }];
    const args = { title: 'Sample loaf', name: 'Sample loaf', totalLabel: 'Total', totalG: 170 };
    expect(x.xlsxSheet({ ...args, rows: rows.map((r, i) => (i === 0 ? { ...r, dividerAfter: true } : r)) }))
      .toStrictEqual(x.xlsxSheet({ ...args, rows }));
  });

  // ── Moving, deleting, keeping rows ────────────────────────────────────────────

  test('moveRow: the line stays between the rows, the moved row leaves it behind', () => {
    expect(show(m.moveRow(mk('A B C| D'), 2, 3))).toBe('A B| D C');
    expect(show(m.moveRow(mk('A B| C D'), 2, 0))).toBe('C A B| D');
    expect(show(m.moveRow(mk('A B| C D'), 3, 0))).toBe('D A B| C');
  });

  test('moveRow: the first row carrying a line, moved, loses it', () => {
    expect(show(m.moveRow(mk('A| B C'), 0, 2))).toBe('B C A');
  });

  test('moveRow keeps the same row objects', () => {
    const rows = mk('A B C| D');
    const out = m.moveRow(rows, 2, 3);
    expect(rows.every(r => out.includes(r))).toBe(true);
  });

  test('removeRow: the line goes to the row above, or goes with the first row; input untouched', () => {
    const ab = mk('A B| C');
    expect(show(m.removeRow(ab, 1))).toBe('A| C');
    expect(show(ab), 'input not mutated').toBe('A B| C');
    expect(show(m.removeRow(mk('A| B'), 0))).toBe('B');
    expect(show(m.removeRow(mk('A B| C'), 2))).toBe('A B');
  });

  test('moveRow never leaves a hidden line under the last row', () => {
    expect(show(m.moveRow(mk('A B| C'), 2, 0))).toBe('C A B');
    const rows = mk('A B C');
    rows[2]!.dividerAfter = true; // a line already hidden under the last row
    expect(show(m.moveRow(rows, 0, 2)), 'C is no longer last, so its line shows').toBe('B C| A');
  });

  test('keepRows: a blank row carrying a line hands it to the row above', () => {
    const rows: Row[] = [{ label: 'A' }, { label: ' ', dividerAfter: true }, { label: 'B' }];
    const out = m.keepRows(rows, r => r.label.trim());
    expect(show(out)).toBe('A| B');
    expect('dividerAfter' in rows[0]!, 'the original row is a copy, never mutated').toBe(false);
    expect(show(m.keepRows(null as unknown as Row[], () => true))).toBe('');
  });

  test('withoutTrailingDivider takes the line off the last row only, without mutating', () => {
    const rows = mk('A| B|');
    expect(show(m.withoutTrailingDivider(rows))).toBe('A| B');
    expect(show(rows)).toBe('A| B|');
    const fine = mk('A| B');
    expect(m.withoutTrailingDivider(fine)).toBe(fine);
    expect(m.withoutTrailingDivider(undefined)).toStrictEqual([]);
  });

  test('hasDividerAfter: never under the last row', () => {
    const rows = mk('A| B|');
    expect(m.hasDividerAfter(rows, 0)).toBe(true);
    expect(m.hasDividerAfter(rows, 1)).toBe(false);
    expect(m.hasDividerAfter(null, 0)).toBe(false);
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
    const out = src.resolveRecipe({ id: 'r', catalogueId: 'c1' } as Loose, catalogue as Loose);
    expect(out.dividersAfter).toStrictEqual([1]);
    for (const ing of out.ingredients) expect('dividerAfter' in ing).toBe(false);
  });

  test('resolveRecipe: a blank row carrying a line hands it to the row above; unlinked has no key', () => {
    const catalogue = {
      c1: { name: 'Sample loaf', ingredients: [
        { label: 'Flour', grams: 100, unit: 'g' },
        { label: '', grams: 0, unit: 'g', dividerAfter: true },
        { label: 'Salt', grams: 2, unit: 'g' },
      ] },
    };
    expect(src.resolveRecipe({ id: 'r', catalogueId: 'c1' } as Loose, catalogue as Loose).dividersAfter).toStrictEqual([0]);
    const own = src.resolveRecipe({ id: 'r', name: 'Own', ingredients: [{ label: 'Flour', grams: 1 }] } as Loose, {} as Loose);
    expect('dividersAfter' in own).toBe(false);
  });
});

// ── The port answers what the original answers, input for input ─────────────────

describe('the port equals the original', () => {
  const cases: LayoutRow[][] = [
    rowsOf(1, [0]), rowsOf(6), rowsOf(6, [2]), rowsOf(6, [1, 3, 5]), rowsOf(40, [4, 9, 14, 19, 24]),
    rowsOf(300, Array.from({ length: 300 }, (_, i) => i)),
    [{ name: 'A very long ingredient name that will not fit at all on one line', text: '1.250 kg', dividerAfter: true },
      { name: 'Salt', text: '2 g' }],
  ];
  test.each(cases.map((rows, i) => [i, rows] as const))('pdfLayout case %i', (_i, rows) => {
    expect(portedExport.pdfLayout({ title: 'Sample loaf', rows }, measure))
      .toStrictEqual(legacyExport.pdfLayout({ title: 'Sample loaf', rows }, measure));
  });

  test('moveRow, removeRow, keepRows, withoutTrailingDivider on every small case', () => {
    const specs = ['A', 'A|', 'A| B', 'A B|', 'A| B| C|', 'A B| C D|', 'A| B C| D'];
    for (const spec of specs) {
      const n = spec.split(' ').length;
      for (let from = -1; from <= n; from += 1) {
        for (let to = -1; to <= n; to += 1) {
          expect(show(portedModel.moveRow(mk(spec), from, to)), `${spec} ${from}→${to}`)
            .toBe(show(legacyModel.moveRow(mk(spec), from, to)));
        }
        const p = mk(spec);
        const l = mk(spec);
        expect(show(portedModel.removeRow(p, from))).toBe(show(legacyModel.removeRow(l, from)));
      }
      expect(show(portedModel.keepRows(mk(spec), r => r.label !== 'B'))).toBe(show(legacyModel.keepRows(mk(spec), r => r.label !== 'B')));
      expect(show(portedModel.withoutTrailingDivider(mk(spec)))).toBe(show(legacyModel.withoutTrailingDivider(mk(spec))));
    }
  });
});
