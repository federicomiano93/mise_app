// The goods-arrived switch (decision F4). New in Mise 2, so there is no original to run these against.

import { describe, expect, test } from 'vitest';
import { askedAbout, deliveryCheckOf, deliveryCheckPatch } from './delivery-check';

describe('deliveryCheckOf', () => {
  test('absent, null or corrupt reads as ON, asking about every order', () => {
    expect(deliveryCheckOf(null)).toStrictEqual({ on: true, from: '' });
    expect(deliveryCheckOf(undefined)).toStrictEqual({ on: true, from: '' });
    expect(deliveryCheckOf({})).toStrictEqual({ on: true, from: '' });
    expect(deliveryCheckOf({ deliveryCheck: 'no' })).toStrictEqual({ on: true, from: '' });
    expect(deliveryCheckOf({ deliveryCheck: 0 })).toStrictEqual({ on: true, from: '' });
    expect(deliveryCheckOf('off')).toStrictEqual({ on: true, from: '' });
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
  });
});

describe('deliveryCheckPatch', () => {
  test('ON stamps today as the first day asked about; OFF leaves the day alone', () => {
    expect(deliveryCheckPatch(true, '2026-10-29')).toStrictEqual({ deliveryCheck: true, deliveryCheckFrom: '2026-10-29' });
    expect(deliveryCheckPatch(false, '2026-10-29')).toStrictEqual({ deliveryCheck: false });
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
    expect(askedAbout(records, { on: false, from: '' })).toStrictEqual([]);
    expect(askedAbout(records, { on: false, from: '2026-10-01' })).toStrictEqual([]);
  });

  test('on with no day: every record, untouched', () => {
    expect(askedAbout(records, { on: true, from: '' })).toStrictEqual(records);
  });

  test('on from a day: the records of that day and later (the legacy one by its week’s start)', () => {
    expect(askedAbout(records, { on: true, from: '2026-10-29' }).map(r => r.id)).toStrictEqual(['b', 'c']);
    expect(askedAbout(records, { on: true, from: '2026-07-01' }).map(r => r.id)).toStrictEqual(['a', 'b', 'c', '2026-W28']);
  });

  test('a missing list is an empty one', () => {
    expect(askedAbout(null, { on: true, from: '' })).toStrictEqual([]);
    expect(askedAbout(undefined, { on: true, from: '2026-10-29' })).toStrictEqual([]);
  });
});
