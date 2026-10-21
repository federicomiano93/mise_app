import { describe, expect, it } from 'vitest';
import { hasName, payloadOf, toggleDay, workingFrom } from './supplierModel';
import type { Working } from './supplierModel';

const EMPTY: Working = workingFrom(null);

describe('workingFrom', () => {
  it('starts a new supplier empty', () => {
    expect(EMPTY).toEqual({
      name: '', shortName: '', category: '', phone: '', email: '', vatNumber: '', deliveryDays: [], orderDays: [],
    });
  });

  it('copies what is stored, and takes anything that is not text or a weekday as nothing', () => {
    const working = workingFrom({
      id: 's1', name: 'Alpine Mills', shortName: 'Alpine', category: 5, phone: '0770', email: 'a@b.test', vatNumber: 'IT1',
      deliveryDays: ['Monday', 'Someday', 7, 'Thursday'], orderDays: 'Sunday',
    });
    expect(working).toEqual({
      name: 'Alpine Mills', shortName: 'Alpine', category: '', phone: '0770', email: 'a@b.test', vatNumber: 'IT1',
      deliveryDays: ['Monday', 'Thursday'], orderDays: [],
    });
  });
});

describe('toggleDay', () => {
  it('keeps the days in the order of the week, however they were ticked', () => {
    let days = toggleDay([], 'Friday', true);
    days = toggleDay(days, 'Monday', true);
    days = toggleDay(days, 'Sunday', true);
    expect(days).toEqual(['Monday', 'Friday', 'Sunday']);
    expect(toggleDay(days, 'Friday', false)).toEqual(['Monday', 'Sunday']);
  });
});

describe('hasName', () => {
  it('wants a name that is not blank', () => {
    expect(hasName(EMPTY)).toBe(false);
    expect(hasName({ ...EMPTY, name: '   ' })).toBe(false);
    expect(hasName({ ...EMPTY, name: ' A ' })).toBe(true);
  });
});

describe('payloadOf', () => {
  it('sends every field, trimmed, with the short name as an empty string when blank', () => {
    const payload = payloadOf({
      name: ' Rossi ', shortName: '  ', category: ' Flour ', phone: ' 1 ', email: ' a@b.test ', vatNumber: '01234567890',
      deliveryDays: ['Friday', 'Monday'], orderDays: ['Sunday'],
    }, null);
    expect(payload).toStrictEqual({
      name: 'Rossi', shortName: '', category: 'Flour', phone: '1', email: 'a@b.test',
      deliveryDays: ['Monday', 'Friday'], orderDays: ['Sunday'], active: true, vatNumber: 'IT01234567890',
    });
  });

  it('⚠️ an edit never switches a supplier back on: active is what it had', () => {
    const working = { ...EMPTY, name: 'Old Baker' };
    expect(payloadOf(working, { id: 's', active: false }).active).toBe(false);
    expect(payloadOf(working, { id: 's', active: true }).active).toBe(true);
    // «absent» means on, everywhere.
    expect(payloadOf(working, { id: 's' }).active).toBe(true);
  });

  it('clears the VAT number with an empty string, and keeps a foreign one as typed in capitals', () => {
    expect(payloadOf({ ...EMPTY, name: 'A' }, null).vatNumber).toBe('');
    expect(payloadOf({ ...EMPTY, name: 'A', vatNumber: 'fr 12.345' }, null).vatNumber).toBe('FR12345');
  });
});
