import { describe, expect, it } from 'vitest';
import { MAX_QTY } from '@mise/shared/pastries-model';
import { checkQuantity, proposedQuantity, rowKeys, typedKey } from './quantityEdit';

describe('typedKey', () => {
  it('is the same for the same pastry however it is cased or spaced', () => {
    expect(typedKey('Tuesday', 'Cornetti')).toBe(typedKey('Tuesday', '  cornetti '));
    expect(typedKey('Tuesday', 'CORNETTI')).toBe(typedKey('Tuesday', 'Cornetti'));
  });

  it('is different for another pastry or another day', () => {
    expect(typedKey('Tuesday', 'Cornetti')).not.toBe(typedKey('Tuesday', 'Krapfen'));
    expect(typedKey('Tuesday', 'Cornetti')).not.toBe(typedKey('Wednesday', 'Cornetti'));
  });
});

describe('rowKeys', () => {
  it('keys a row by its name, not by its place: an earlier row going does not rename the others', () => {
    const before = rowKeys('Tuesday', ['Cornetti', 'Krapfen', 'Sfogliatelle']);
    const after = rowKeys('Tuesday', ['Krapfen', 'Sfogliatelle']);
    expect(after).toEqual([before[1], before[2]]);
  });

  it('tells two rows with the same name apart by which occurrence they are', () => {
    const keys = rowKeys('Tuesday', ['Cornetti', 'Krapfen', ' cornetti ']);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).not.toBe(keys[2]);
  });

  it('is different on another day, so a day that is picked builds its rows afresh', () => {
    expect(rowKeys('Tuesday', ['Cornetti'])).not.toEqual(rowKeys('Wednesday', ['Cornetti']));
  });
});

describe('proposedQuantity', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['   ', null],
    ['abc', null],
    ['1e999', null],
    ['12', 12],
    [' 12 ', 12],
    ['12.4', 12],
    ['12.6', 13],
    ['0', 0],
    ['0.4', 0],
    ['-5', -5],
    ['10000', 10000],
  ])('%j → %j', (raw, expected) => {
    expect(proposedQuantity(raw)).toBe(expected);
  });
});

describe('checkQuantity', () => {
  it('asks for a number when there is none', () => {
    expect(checkQuantity(null, 24)).toEqual({ usable: false, hint: 'past.hint.typeANumber' });
  });

  it('says «same as now» for the number already there', () => {
    expect(checkQuantity(24, 24)).toEqual({ usable: false, hint: 'past.hint.sameAsNow' });
  });

  it('refuses 0 and below', () => {
    expect(checkQuantity(0, 24)).toEqual({ usable: false, hint: 'past.hint.atLeastOne' });
    expect(checkQuantity(-3, 24)).toEqual({ usable: false, hint: 'past.hint.atLeastOne' });
  });

  it('refuses more than the most a day can hold', () => {
    expect(checkQuantity(MAX_QTY + 1, 24)).toEqual({ usable: false, hint: 'past.hint.tooMany' });
  });

  it('accepts 1 up to the most, and says nothing', () => {
    expect(checkQuantity(1, 24)).toEqual({ usable: true, hint: null });
    expect(checkQuantity(MAX_QTY, 24)).toEqual({ usable: true, hint: null });
  });

  // The order of the original's checks: «same as now» comes before «at least 1».
  it('says «same as now» for 0 on a row that already holds 0', () => {
    expect(checkQuantity(0, 0)).toEqual({ usable: false, hint: 'past.hint.sameAsNow' });
  });
});
