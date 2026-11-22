import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAMETERS, MAX_STANDARD_ROWS, STANDARD_COLUMNS, standardCell } from '@mise/shared/cake-standard';
import type { CakeStandard } from '@mise/shared/cake-standard';
import {
  COLUMN_WORDS, SHAPE_FIELDS, addDiameter, emptyText, firstProblem, isDirty, previewOf, readNumber, removeDiameter, setCell, standardFrom,
  textFrom,
} from './referenceModel';

// A table with its figures typed at 22 cm only, among the default diameters (what a legacy document reads as).
const STANDARD: CakeStandard = {
  discs: 3,
  discHeightCm: 3,
  rows: DEFAULT_DIAMETERS.map(diameterCm => ({
    diameterCm,
    baseG: diameterCm === 22 ? 300 : null,
    soakG: diameterCm === 22 ? 90 : null,
    fillingG: diameterCm === 22 ? 280 : null,
    coatingG: diameterCm === 22 ? 450 : null,
    decorationG: diameterCm === 22 ? 200 : null,
  })),
};

describe('the columns and the shape boxes', () => {
  it('list the five columns of a row, once each, in the order a cake is built', () => {
    expect(COLUMN_WORDS.map(w => w.column)).toEqual([...STANDARD_COLUMNS]);
  });

  it('use the bounds of the rules: discs whole 1 to 5, the height 0.1 to 20', () => {
    const by = Object.fromEntries(SHAPE_FIELDS.map(field => [field.key, field]));
    expect([by['discs']?.whole, by['discs']?.min, by['discs']?.max]).toEqual([true, 1, 5]);
    expect([by['discHeightCm']?.whole, by['discHeightCm']?.min, by['discHeightCm']?.max]).toEqual([false, 0.1, 20]);
  });
});

describe('readNumber', () => {
  it('reads a comma as a decimal point, empty as null, and anything else as NaN', () => {
    expect(readNumber('12,5')).toBe(12.5);
    expect(readNumber(' 3 ')).toBe(3);
    expect(readNumber('')).toBeNull();
    expect(readNumber('abc')).toBeNaN();
    expect(readNumber('-4')).toBeNaN();
  });
});

describe('textFrom', () => {
  it('a venue with no standard starts EMPTY: no discs, no height, the default diameters with every box empty', () => {
    const text = textFrom(null);
    expect(text).toEqual(emptyText());
    expect(text.discs).toBe('');
    expect(text.rows.map(row => row.diameterCm)).toEqual([...DEFAULT_DIAMETERS]);
    expect(text.rows.every(row => STANDARD_COLUMNS.every(column => row.cells[column] === ''))).toBe(true);
  });

  it('a stored table shows what was typed and leaves the other boxes empty', () => {
    const text = textFrom(STANDARD);
    expect(text.discs).toBe('3');
    expect(text.rows.find(row => row.diameterCm === 22)?.cells.baseG).toBe('300');
    expect(text.rows.find(row => row.diameterCm === 20)?.cells.baseG).toBe('');
  });
});

describe('previewOf and the grey figures', () => {
  it('only a typed, valid box counts as typed; the grey figure comes from the nearest typed diameter, live', () => {
    const text = setCell(textFrom(STANDARD), 22, 'baseG', '300');
    const cell = standardCell(previewOf(text), 'baseG', 20);
    expect(cell).toMatchObject({ typed: false, fromCm: 22 });
    expect(cell?.grams).toBe(250);
    // Typing at 20 cm turns that box into a typed one, and 18 cm now scales from it.
    const typed = setCell(text, 20, 'baseG', '260');
    expect(standardCell(previewOf(typed), 'baseG', 20)).toMatchObject({ typed: true, grams: 260 });
    expect(standardCell(previewOf(typed), 'baseG', 18)).toMatchObject({ typed: false, fromCm: 20 });
    // Junk is not typed.
    expect(standardCell(previewOf(setCell(text, 20, 'baseG', 'abc')), 'baseG', 20)?.typed).toBe(false);
  });

  it('works with an empty shape, using its own preview figures', () => {
    const preview = previewOf(emptyText());
    expect(preview.discs).toBeGreaterThanOrEqual(1);
    expect(preview.discHeightCm).toBeGreaterThan(0);
  });
});

describe('firstProblem', () => {
  it('is null for a full, valid table, and for one the store gave back', () => {
    expect(firstProblem(textFrom(STANDARD))).toBeNull();
  });

  it('names the discs, then the height, when they are empty or out of bounds', () => {
    expect(firstProblem(emptyText())).toMatchObject({ kind: 'empty', field: { key: 'discs' } });
    expect(firstProblem({ ...textFrom(STANDARD), discHeightCm: '' })).toMatchObject({ kind: 'empty', field: { key: 'discHeightCm' } });
    expect(firstProblem({ ...textFrom(STANDARD), discs: '6' })).toMatchObject({ kind: 'range', field: { key: 'discs' } });
    expect(firstProblem({ ...textFrom(STANDARD), discs: '2.5' })).toMatchObject({ kind: 'whole', field: { key: 'discs' } });
    expect(firstProblem({ ...textFrom(STANDARD), discHeightCm: '0' })).toMatchObject({ kind: 'range', field: { key: 'discHeightCm' } });
  });

  it('names a typed figure that is not a number or is above 100,000, with its diameter and column', () => {
    expect(firstProblem(setCell(textFrom(STANDARD), 18, 'soakG', 'abc'))).toEqual({ kind: 'cell', diameterCm: 18, column: 'soakG' });
    expect(firstProblem(setCell(textFrom(STANDARD), 24, 'baseG', '100001'))).toEqual({ kind: 'cell', diameterCm: 24, column: 'baseG' });
    expect(firstProblem(setCell(textFrom(STANDARD), 24, 'baseG', '100000'))).toBeNull();
  });

  it('wants at least one typed figure in every column, naming the column and the FIRST row', () => {
    const text = setCell(textFrom(STANDARD), 22, 'coatingG', '');
    expect(firstProblem(text)).toEqual({ kind: 'column', diameterCm: 16, column: 'coatingG' });
    // A figure typed in another row is enough.
    expect(firstProblem(setCell(text, 28, 'coatingG', '700'))).toBeNull();
  });
});

describe('standardFrom', () => {
  it('is the table the text stands for, ascending, with the typed figures only; null while there is a problem', () => {
    const standard = standardFrom(setCell(textFrom(STANDARD), 20, 'baseG', '250,5'));
    expect(standard?.rows.find(row => row.diameterCm === 20)?.baseG).toBe(250.5);
    expect(standard?.rows.find(row => row.diameterCm === 18)?.baseG).toBeNull();
    expect(standard?.rows.map(row => row.diameterCm)).toEqual([...DEFAULT_DIAMETERS]);
    expect(standardFrom(emptyText())).toBeNull();
  });
});

describe('isDirty', () => {
  it('is false for an untouched copy, true after a change, false when the change is undone', () => {
    const text = textFrom(STANDARD);
    expect(isDirty(text, STANDARD)).toBe(false);
    const changed = setCell(text, 22, 'baseG', '301');
    expect(isDirty(changed, STANDARD)).toBe(true);
    expect(isDirty(setCell(changed, 22, 'baseG', '300'), STANDARD)).toBe(false);
  });

  it('compares numbers, not text: «300,0»-style spellings of the same number are no change', () => {
    expect(isDirty(setCell(textFrom(STANDARD), 22, 'baseG', '300.0'), STANDARD)).toBe(false);
  });

  it('with nothing stored, anything typed, added or removed differs from the default empty table', () => {
    expect(isDirty(emptyText(), null)).toBe(false);
    expect(isDirty(setCell(emptyText(), 16, 'baseG', '1'), null)).toBe(true);
    expect(isDirty({ ...emptyText(), discs: '3' }, null)).toBe(true);
    const added = addDiameter(emptyText(), '30');
    expect(added.ok && isDirty(added.text, null)).toBe(true);
    expect(isDirty(removeDiameter(emptyText(), 16), null)).toBe(true);
  });
});

describe('adding and removing a diameter', () => {
  it('adds a whole diameter in its place, ascending', () => {
    const result = addDiameter(textFrom(STANDARD), '23');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.rows.map(row => row.diameterCm)).toEqual([16, 18, 20, 22, 23, 24, 26, 28]);
      expect(result.diameterCm).toBe(23);
    }
  });

  it('refuses a diameter outside 10 to 60, one that is not a number, and one that is already there', () => {
    const text = textFrom(STANDARD);
    expect(addDiameter(text, '9')).toMatchObject({ ok: false, error: 'range' });
    expect(addDiameter(text, '61')).toMatchObject({ ok: false, error: 'range' });
    expect(addDiameter(text, '')).toMatchObject({ ok: false, error: 'range' });
    expect(addDiameter(text, 'abc')).toMatchObject({ ok: false, error: 'range' });
    expect(addDiameter(text, '22')).toEqual({ ok: false, error: 'duplicate', diameterCm: 22 });
    expect(addDiameter(text, '10').ok).toBe(true);
    expect(addDiameter(text, '60').ok).toBe(true);
  });

  it('stops at the most rows the rules check', () => {
    let text = textFrom(STANDARD);
    for (let d = 30; text.rows.length < MAX_STANDARD_ROWS; d += 1) {
      const result = addDiameter(text, String(d));
      if (result.ok) text = result.text;
    }
    expect(text.rows).toHaveLength(MAX_STANDARD_ROWS);
    expect(addDiameter(text, '59')).toMatchObject({ ok: false, error: 'full' });
  });

  it('removes a row, but never the last one', () => {
    let text = textFrom(STANDARD);
    text = removeDiameter(text, 22);
    expect(text.rows.map(row => row.diameterCm)).not.toContain(22);
    for (const diameterCm of [16, 18, 20, 24, 26]) text = removeDiameter(text, diameterCm);
    expect(text.rows.map(row => row.diameterCm)).toEqual([28]);
    expect(removeDiameter(text, 28)).toBe(text);
  });
});
