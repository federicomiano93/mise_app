import { describe, expect, it } from 'vitest';
import { REFERENCE_KEYS } from '@mise/shared/cake-model';
import type { ReferenceGrams } from '@mise/shared/cake-model';
import { CAKE_FIELDS, EMPTY_TEXT, GRAM_FIELDS, exampleGrams, firstProblem, isDirty, readNumber, referenceFrom, textFrom } from './referenceModel';

const REF: ReferenceGrams = { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };

describe('the boxes', () => {
  it('cover exactly the eight keys of a reference, each once', () => {
    const keys = [...CAKE_FIELDS, ...GRAM_FIELDS].map(field => field.key).sort();
    expect(keys).toEqual([...REFERENCE_KEYS].sort());
  });

  it('use the bounds of the rules (the discs whole, the diameter 10 to 60, the grams up to 100000)', () => {
    const by = Object.fromEntries([...CAKE_FIELDS, ...GRAM_FIELDS].map(field => [field.key, field]));
    expect([by['diameterCm']?.min, by['diameterCm']?.max]).toEqual([10, 60]);
    expect([by['discs']?.whole, by['discs']?.min, by['discs']?.max]).toEqual([true, 1, 5]);
    expect(by['discHeightCm']?.max).toBe(20);
    for (const { key, min, max } of GRAM_FIELDS) { expect([key, min, max]).toEqual([key, 0, 100000]); }
  });
});

describe('readNumber', () => {
  it('reads a comma as a decimal point, empty as null, and anything else as NaN', () => {
    expect(readNumber('12,5')).toBe(12.5);
    expect(readNumber(' 3 ')).toBe(3);
    expect(readNumber('.5')).toBe(0.5);
    expect(readNumber('')).toBeNull();
    expect(readNumber('  ')).toBeNull();
    expect(readNumber('abc')).toBeNaN();
    expect(readNumber('1,2,3')).toBeNaN();
    expect(readNumber('-4')).toBeNaN();
  });
});

describe('firstProblem', () => {
  it('is null for a full, valid reference, and for one the store gave back', () => {
    expect(firstProblem(textFrom(REF))).toBeNull();
  });

  it('names the first empty box, top to bottom', () => {
    expect(firstProblem(EMPTY_TEXT)?.key).toBe('diameterCm');
    expect(firstProblem({ ...textFrom(REF), coatingG: '', baseG: '' })).toMatchObject({ key: 'baseG', kind: 'empty' });
  });

  it('names a number out of bounds, a half-typed one and a fractional count of discs', () => {
    expect(firstProblem({ ...textFrom(REF), diameterCm: '9' })).toMatchObject({ key: 'diameterCm', kind: 'range' });
    expect(firstProblem({ ...textFrom(REF), discs: '6' })).toMatchObject({ key: 'discs', kind: 'range' });
    expect(firstProblem({ ...textFrom(REF), discs: '2.5' })).toMatchObject({ key: 'discs', kind: 'whole' });
    expect(firstProblem({ ...textFrom(REF), baseG: '100001' })).toMatchObject({ key: 'baseG', kind: 'range' });
    expect(firstProblem({ ...textFrom(REF), soakG: 'x' })).toMatchObject({ key: 'soakG', kind: 'range' });
    expect(firstProblem({ ...textFrom(REF), discHeightCm: '0' })).toMatchObject({ key: 'discHeightCm', kind: 'range' });
  });

  it('accepts zero grams (a cake with no decoration is a real answer)', () => {
    expect(firstProblem({ ...textFrom(REF), decorationG: '0' })).toBeNull();
  });
});

describe('referenceFrom', () => {
  it('turns a valid text into the numbers, and an incomplete one into null', () => {
    expect(referenceFrom({ ...textFrom(REF), baseG: '310,5' })).toEqual({ ...REF, baseG: 310.5 });
    expect(referenceFrom({ ...textFrom(REF), baseG: '' })).toBeNull();
  });
});

describe('isDirty', () => {
  it('is false for the stored figures, true for any box that differs', () => {
    expect(isDirty(textFrom(REF), REF)).toBe(false);
    expect(isDirty({ ...textFrom(REF), baseG: '301' }, REF)).toBe(true);
    // «300,0» is the same number as 300.
    expect(isDirty({ ...textFrom(REF), baseG: '300,0' }, REF)).toBe(false);
  });

  it('with nothing stored, empty is clean and any typed text is a change', () => {
    expect(isDirty(EMPTY_TEXT, null)).toBe(false);
    expect(isDirty({ ...EMPTY_TEXT, discs: '2' }, null)).toBe(true);
  });
});

describe('exampleGrams', () => {
  it('is the rule at 26 cm and 3 discs for each part, in the screen\'s order', () => {
    const rows = exampleGrams(textFrom(REF)) ?? [];
    expect(rows.map(row => row.part)).toEqual(['base', 'soak', 'filling', 'coating', 'decoration']);
    expect(rows.map(row => Math.round(row.grams))).toEqual([1257, 377, 782, 568, 279]);
  });

  it('is null while the form is not a full reference', () => {
    expect(exampleGrams({ ...textFrom(REF), baseG: '' })).toBeNull();
  });
});
