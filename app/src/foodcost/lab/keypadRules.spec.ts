import { describe, expect, it } from 'vitest';
import { KEYPAD_KEYS, MAX_DIGITS, padKeyOf, parseTyped, pressKey, typedText } from './keypadRules';

describe('the keypad types a number', () => {
  const type = (keys: string, allowComma = true) => [...keys].reduce((text, key) => pressKey(text, key === '<' ? 'back' : key, allowComma), '');

  it('appends digits and stops at six', () => {
    expect(type('1234')).toBe('1234');
    expect(type('1234567890')).toBe('123456');
    expect(MAX_DIGITS).toBe(6);
  });

  it('takes one comma only, and «0,» for a comma first', () => {
    expect(type('12,5,5')).toBe('12,55');
    expect(type(',5')).toBe('0,5');
  });

  it('counts the digits after the comma too: six digits in all', () => {
    expect(type('1234,56')).toBe('1234,56');
    expect(type('1234,567')).toBe('1234,56');
  });

  it('has no room for a comma once six digits are typed', () => {
    expect(type('123456,')).toBe('123456');
  });

  it('does not keep a leading zero', () => {
    expect(type('05')).toBe('5');
    expect(type('0')).toBe('0');
    expect(type('00')).toBe('0');
  });

  it('removes one character at a time and does nothing on an empty box', () => {
    expect(type('12,5<')).toBe('12,');
    expect(type('12,5<<')).toBe('12');
    expect(type('<<')).toBe('');
  });

  it('ignores the comma in a whole-number box', () => {
    expect(type('1,5', false)).toBe('15');
  });

  it('ignores anything that is not a key of the pad', () => {
    expect(pressKey('12', 'x')).toBe('12');
    expect(pressKey('12', '')).toBe('12');
  });

  it('has the keys the design draws: 7 8 9 / 4 5 6 / 1 2 3 / , 0 back', () => {
    expect(KEYPAD_KEYS.join(' ')).toBe('7 8 9 4 5 6 1 2 3 , 0 back');
  });
});

describe('a physical keyboard', () => {
  it('types digits, both decimal signs and Backspace', () => {
    expect(padKeyOf({ key: '7' })).toBe('7');
    expect(padKeyOf({ key: ',' })).toBe(',');
    expect(padKeyOf({ key: '.' })).toBe(',');
    expect(padKeyOf({ key: 'Backspace' })).toBe('back');
  });

  it('leaves everything else — letters, Tab, a shortcut — alone', () => {
    expect(padKeyOf({ key: 'a' })).toBeNull();
    expect(padKeyOf({ key: 'Tab' })).toBeNull();
    expect(padKeyOf({ key: '1', ctrlKey: true })).toBeNull();
    expect(padKeyOf({ key: '1', metaKey: true })).toBeNull();
  });
});

describe('what the text stands for', () => {
  it('reads a comma as a decimal point and nothing as null', () => {
    expect(parseTyped('12,5')).toBe(12.5);
    expect(parseTyped('0,')).toBe(0);
    expect(parseTyped('')).toBeNull();
    expect(parseTyped(null)).toBeNull();
    expect(parseTyped('abc')).toBeNull();
  });

  it('writes a number with a comma and at most four decimals, never NaN', () => {
    expect(typedText(600)).toBe('600');
    expect(typedText(12.5)).toBe('12,5');
    expect(typedText(1 / 3)).toBe('0,3333');
    expect(typedText(Number.NaN)).toBe('');
    expect(typedText(-1)).toBe('');
  });
});
