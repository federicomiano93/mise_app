import { describe, expect, it } from 'vitest';
import { FROM_DAY, copyOf } from './pastriesNav';

describe('copyOf: the «Copy day» request carried in the navigation state', () => {
  it('reads a source day with the date the edit was agreed on, or null', () => {
    expect(copyOf({ ...FROM_DAY, copy: { from: 'Tuesday', editAgreedOn: '2026-10-14' } })).toEqual({ from: 'Tuesday', editAgreedOn: '2026-10-14' });
    expect(copyOf({ copy: { from: 'Sunday', editAgreedOn: null } })).toEqual({ from: 'Sunday', editAgreedOn: null });
  });

  it.each([
    ['no state', null],
    ['a string', 'copy'],
    ['a state without a copy', FROM_DAY],
    ['a copy that is not an object', { copy: 'Tuesday' }],
    ['a copy that is null', { copy: null }],
    ['a source that is not a weekday', { copy: { from: 'Funday', editAgreedOn: null } }],
    ['a source in lower case', { copy: { from: 'tuesday', editAgreedOn: null } }],
    ['no source', { copy: { editAgreedOn: null } }],
    ['an agreed date that is a number', { copy: { from: 'Tuesday', editAgreedOn: 20261014 } }],
    ['no agreed date at all', { copy: { from: 'Tuesday' } }],
  ])('is no copy for %s', (_name, state) => {
    expect(copyOf(state)).toBeNull();
  });
});
