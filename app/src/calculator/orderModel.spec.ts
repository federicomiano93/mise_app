import { describe, expect, it } from 'vitest';
import { changedByHand, directEntries, listEntries, quantityKey, startingQuantities, zeroQuantities } from './orderModel';

const CONFIG = {
  clients: [
    { id: 'a', name: 'Cafe A', products: [{ id: 'p1', name: 'Buns', weight: 100, kind: 'number', active: true }] },
    { id: 'b', name: 'Bar B', products: [{ id: 'p1', name: 'Buns', weight: 100, kind: 'number', active: true }] },
  ],
  recipes: [],
};

const LIST = {
  id: 'l1', title: 'Morning',
  clients: [
    { clientId: 'a', products: ['p1'], extras: [{ id: 'wx-napkins', name: 'Napkins' }] },
    { clientId: 'gone', products: [], extras: [] },
    { clientId: 'b', products: ['p1'], extras: [] },
  ],
};

describe('listEntries', () => {
  it('has one entry per client still in the address book, products first and free lines last', () => {
    const entries = listEntries(CONFIG, LIST);
    expect(entries.map(entry => entry.client.name)).toEqual(['Cafe A', 'Bar B']);
    expect(entries[0]?.products.map(product => product.name)).toEqual(['Buns', 'Napkins']);
  });

  it('is empty when every client of the list is gone', () => {
    expect(listEntries(CONFIG, { id: 'l2', title: 'Old', clients: [{ clientId: 'gone', products: [], extras: [] }] })).toEqual([]);
  });
});

describe('directEntries', () => {
  it('is one entry named as typed', () => {
    const entries = directEntries(CONFIG, { id: 'd1', name: 'Corner shop', products: ['p1'], extras: [] });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.client.name).toBe('Corner shop');
    expect(entries[0]?.products.map(product => product.name)).toEqual(['Buns']);
  });
});

describe('the boxes', () => {
  const entries = listEntries(CONFIG, LIST);

  it('are keyed by the client entry and the product, so one product ordered by two clients is two numbers', () => {
    expect(quantityKey(0, 'p1')).toBe('0|p1');
    expect(quantityKey(1, 'p1')).toBe('1|p1');
  });

  it('start from the prefill, else 0; a free line starts at 0', () => {
    expect(startingQuantities(entries, { '0|p1': 12 })).toEqual({ '0|p1': '12', '0|wx-napkins': '0', '1|p1': '0' });
  });

  it('are all zeroed by Clear all, and only the form’s own keys', () => {
    expect(zeroQuantities({ '0|p1': '12', '1|p1': '3' })).toEqual({ '0|p1': '0', '1|p1': '0' });
  });

  it('count as changed by hand only when a NUMBER differs from the start', () => {
    const start = { '0|p1': '12', '1|p1': '0' };
    expect(changedByHand(start, { ...start })).toBe(false);
    // Tapping a 0 empties the box and leaving it puts the 0 back; typing a number away again is no change either.
    expect(changedByHand(start, { '0|p1': '12', '1|p1': '' })).toBe(false);
    expect(changedByHand(start, { '0|p1': '12.0', '1|p1': '0' })).toBe(false);
    expect(changedByHand(start, { '0|p1': '13', '1|p1': '0' })).toBe(true);
    expect(changedByHand(start, { '0|p1': '12', '1|p1': '4' })).toBe(true);
    expect(changedByHand(start, { '0|p1': '0', '1|p1': '0' })).toBe(true);
  });
});
