// The goods-arrived switch (decision F4). New in Mise 2, so there is no original to run these against.

import { describe, expect, test } from 'vitest';
import { askedAbout, deliveryCheckOf, deliveryCheckPatch, turningOnForgets } from './delivery-check';

describe('deliveryCheckOf', () => {
  test('absent, null or corrupt reads as ON, asking about every order', () => {
    expect(deliveryCheckOf(null)).toStrictEqual({ on: true, from: '', offOn: '' });
    expect(deliveryCheckOf(undefined)).toStrictEqual({ on: true, from: '', offOn: '' });
    expect(deliveryCheckOf({})).toStrictEqual({ on: true, from: '', offOn: '' });
    expect(deliveryCheckOf({ deliveryCheck: 'no' })).toStrictEqual({ on: true, from: '', offOn: '' });
    expect(deliveryCheckOf({ deliveryCheck: 0 })).toStrictEqual({ on: true, from: '', offOn: '' });
    expect(deliveryCheckOf('off')).toStrictEqual({ on: true, from: '', offOn: '' });
  });

  test('only an explicit false turns it off', () => {
    expect(deliveryCheckOf({ deliveryCheck: false }).on).toBe(false);
    expect(deliveryCheckOf({ deliveryCheck: true }).on).toBe(true);
  });

  test('the first day asked about is kept only when it is a plain YYYY-MM-DD', () => {
    expect(deliveryCheckOf({ deliveryCheckFrom: '2026-10-29' }).from).toBe('2026-10-29');
    expect(deliveryCheckOf({ deliveryCheckFrom: '29/10/2026' }).from).toBe('');
    expect(deliveryCheckOf({ deliveryCheckFrom: ['2026-10-29'] }).from).toBe('');
    expect(deliveryCheckOf({ deliveryCheckFrom: '2026-10-29T10:00:00Z' }).from).toBe('');
    expect(deliveryCheckOf({ deliveryCheckOffOn: '2026-10-28' }).offOn).toBe('2026-10-28');
    expect(deliveryCheckOf({ deliveryCheckOffOn: 28 }).offOn).toBe('');
  });
});

describe('deliveryCheckPatch', () => {
  const off = (offOn: string) => ({ on: false, from: '2026-10-01', offOn });

  test('OFF stamps the day it went off and leaves the day it counts from alone', () => {
    expect(deliveryCheckPatch(false, '2026-10-29', { on: true, from: '2026-10-01', offOn: '' }))
      .toStrictEqual({ deliveryCheck: false, deliveryCheckOffOn: '2026-10-29' });
  });

  test('ON on a later day counts from today', () => {
    expect(deliveryCheckPatch(true, '2026-10-29', off('2026-10-20'))).toStrictEqual({ deliveryCheck: true, deliveryCheckFrom: '2026-10-29' });
    expect(deliveryCheckPatch(true, '2026-10-29', off(''))).toStrictEqual({ deliveryCheck: true, deliveryCheckFrom: '2026-10-29' });
  });

  test('ON the same day it went off keeps the day it counted from: an off-and-on by mistake loses nothing', () => {
    expect(deliveryCheckPatch(true, '2026-10-29', off('2026-10-29'))).toStrictEqual({ deliveryCheck: true });
  });
});

describe('turningOnForgets', () => {
  test('only when it is off and was not turned off today', () => {
    expect(turningOnForgets({ on: false, from: '', offOn: '2026-10-20' }, '2026-10-29')).toBe(true);
    expect(turningOnForgets({ on: false, from: '', offOn: '' }, '2026-10-29')).toBe(true);
    expect(turningOnForgets({ on: false, from: '', offOn: '2026-10-29' }, '2026-10-29')).toBe(false);
    expect(turningOnForgets({ on: true, from: '', offOn: '' }, '2026-10-29')).toBe(false);
  });
});

describe('askedAbout', () => {
  const records = [
    { id: 'a', date: '2026-10-20', supplierId: 's' },
    { id: 'b', date: '2026-10-29', supplierId: 's' },
    { id: 'c', date: '2026-10-30', supplierId: 's' },
    { id: '2026-W28', weekStart: '2026-07-06' },
  ];

  test('off: nothing is asked about', () => {
    expect(askedAbout(records, { on: false, from: '', offOn: '' })).toStrictEqual([]);
    expect(askedAbout(records, { on: false, from: '2026-10-01', offOn: '' })).toStrictEqual([]);
  });

  test('on with no day: every record, untouched', () => {
    expect(askedAbout(records, { on: true, from: '', offOn: '' })).toStrictEqual(records);
  });

  test('on from a day: the records of that day and later (the legacy one by its week’s start)', () => {
    expect(askedAbout(records, { on: true, from: '2026-10-29', offOn: '' }).map(r => r.id)).toStrictEqual(['b', 'c']);
    expect(askedAbout(records, { on: true, from: '2026-07-01', offOn: '' }).map(r => r.id)).toStrictEqual(['a', 'b', 'c', '2026-W28']);
  });

  test('a missing list is an empty one', () => {
    expect(askedAbout(null, { on: true, from: '', offOn: '' })).toStrictEqual([]);
    expect(askedAbout(undefined, { on: true, from: '2026-10-29', offOn: '' })).toStrictEqual([]);
  });
});
