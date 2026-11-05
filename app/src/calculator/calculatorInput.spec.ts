import { describe, expect, it } from 'vitest';
import { DROPDOWN_OPTIONS, clearsOnFocus, isBlank, knobRange, leaveningPct, numberOf } from './calculatorInput';

describe('numberOf', () => {
  it.each([
    ['5', 5], ['2.5', 2.5], ['0', 0], ['', 0], ['abc', 0], ['-3', 0], [null, 0], [undefined, 0], ['Infinity', 0],
  ])('%j → %s', (text, expected) => {
    expect(numberOf(text as string | null | undefined)).toBe(expected);
  });
});

describe('isBlank', () => {
  it.each([['', true], ['0', false], ['12', false], ['-', true], ['.', true], ['e', true]])('%j → %s', (text, expected) => {
    expect(isBlank(text)).toBe(expected);
  });
});

describe('clearsOnFocus', () => {
  it('empties a 0 and an empty box, and leaves any other number to be selected', () => {
    expect(clearsOnFocus('0')).toBe(true);
    expect(clearsOnFocus('')).toBe(true);
    expect(clearsOnFocus('7')).toBe(false);
    expect(clearsOnFocus('0.5')).toBe(false);
  });
});

describe('leaveningPct', () => {
  it('is the knob\'s number when it has one', () => {
    expect(leaveningPct('0.8', 0.5)).toBe(0.8);
  });

  it('is the recipe\'s default when the knob is empty, was never touched or is not a number', () => {
    expect(leaveningPct('', 0.5)).toBe(0.5);
    expect(leaveningPct(null, 0.5)).toBe(0.5);
    expect(leaveningPct('abc', 0.5)).toBe(0.5);
    expect(leaveningPct('0', 0.5)).toBe(0.5);
  });

  it('is never NaN', () => {
    expect(leaveningPct(null, Number.NaN)).toBe(0);
  });
});

describe('knobRange', () => {
  it.each([
    [18, { min: 5, max: 40, step: 1 }],
    [5, { min: 5, max: 40, step: 1 }],
    [4, { min: 0.1, max: 6, step: 0.1 }],
    [1, { min: 0.1, max: 6, step: 0.1 }],
    [0.65, { min: 0.1, max: 3, step: 0.05 }],
    [0, { min: 0.1, max: 3, step: 0.05 }],
    [Number.NaN, { min: 0.1, max: 3, step: 0.05 }],
  ])('default %s', (pct, range) => {
    expect(knobRange(pct)).toEqual(range);
  });
});

describe('DROPDOWN_OPTIONS', () => {
  it('is 0 to 100 in steps of 20', () => {
    expect(DROPDOWN_OPTIONS).toEqual([0, 20, 40, 60, 80, 100]);
  });
});
