import { describe, expect, it } from 'vitest';
import { normalizeDays } from '@mise/shared/pastries-model';
import type { InvalidProblem } from '@mise/shared/pastries-model';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { blankRow, fieldOf, isUntouched, namesOnOtherDays, problemMessage, rowsFrom, workingItems } from './editorModel';

const counter = () => {
  let n = 0;
  return () => ++n;
};

const t = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);

describe('rowsFrom', () => {
  it('turns a stored list into rows, the quantity as text', () => {
    expect(rowsFrom([{ name: 'Cornetti', qty: 24 }, { name: 'Krapfen', qty: 0 }], counter())).toEqual([
      { id: 1, name: 'Cornetti', qty: '24' },
      { id: 2, name: 'Krapfen', qty: '0' },
    ]);
  });

  it('is never empty: an empty day is one empty row', () => {
    expect(rowsFrom([], counter())).toEqual([{ id: 1, name: '', qty: '' }]);
  });

  it('gives every row its own id', () => {
    const ids = rowsFrom([{ name: 'a', qty: 1 }, { name: 'b', qty: 1 }, { name: 'c', qty: 1 }], counter()).map(row => row.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('workingItems and isUntouched', () => {
  it('hands the rules name and quantity only', () => {
    expect(workingItems([{ id: 7, name: 'a', qty: '2' }])).toEqual([{ name: 'a', qty: '2' }]);
  });

  it.each([
    [{ name: '', qty: '' }, true],
    [{ name: '   ', qty: ' ' }, true],
    [{ name: 'a', qty: '' }, false],
    [{ name: '', qty: '0' }, false],
  ])('%j is untouched: %s', (row, expected) => {
    expect(isUntouched({ id: 1, ...row })).toBe(expected);
  });

  it('knows a blank row', () => {
    expect(isUntouched(blankRow(3))).toBe(true);
  });
});

describe('namesOnOtherDays', () => {
  const days = normalizeDays([
    { id: 'Monday', items: [{ name: 'Zeppole', qty: 1 }, { name: 'Brioche', qty: 1 }] },
    { id: 'Tuesday', items: [{ name: 'Mine', qty: 1 }] },
    { id: 'Friday', items: [{ name: 'Brioche', qty: 1 }, { name: 'Éclair', qty: 1 }, { name: 'apple', qty: 1 }] },
  ]);

  it('is the names on the other six days, each once', () => {
    expect(namesOnOtherDays(days, 'Tuesday')).toEqual(['apple', 'Brioche', 'Éclair', 'Zeppole']);
  });

  it('leaves out a name that is only on this day', () => {
    expect(namesOnOtherDays(days, 'Tuesday')).not.toContain('Mine');
    expect(namesOnOtherDays(days, 'Monday')).toContain('Mine');
  });

  it('is sorted for the language, not by code point (apple before Brioche, É with E)', () => {
    const names = namesOnOtherDays(days, 'Tuesday');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('is empty for an empty week', () => {
    expect(namesOnOtherDays(normalizeDays([]), 'Monday')).toEqual([]);
  });
});

describe('fieldOf', () => {
  it.each<[InvalidProblem, string | null]>([
    ['no-qty', 'qty'],
    ['qty-too-big', 'qty'],
    ['duplicate', 'name'],
    ['too-long', 'name'],
    ['too-many', null],
  ])('%s points at %s', (problem, field) => {
    expect(fieldOf(problem)).toBe(field);
  });

  it('points at the name for a problem it does not know', () => {
    expect(fieldOf('something-new' as InvalidProblem)).toBe('name');
  });
});

describe('problemMessage', () => {
  it.each<[InvalidProblem, string]>([
    ['duplicate', 'Cornetti is on this list twice.'],
    ['no-qty', 'How many Cornetti?'],
    ['too-long', 'That name is too long.'],
    ['qty-too-big', '9999 is the most this can hold.'],
    ['too-many', 'That is more pastries than one day can hold.'],
  ])('says the %s problem in a sentence', (problem, sentence) => {
    expect(problemMessage(t, { problem, index: 0, name: 'Cornetti' })).toBe(sentence);
  });

  it('says a problem it does not know as «cannot be saved yet», never as nothing', () => {
    expect(problemMessage(t, { problem: 'something-new' as InvalidProblem, index: 0, name: '' })).toBe('That cannot be saved yet.');
  });
});
