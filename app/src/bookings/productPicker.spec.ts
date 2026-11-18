import { describe, expect, it } from 'vitest';
import { priceListOf } from '../testing/fakeBookingsSource';
import { lineQtyText } from './bookingWords';
import {
  NO_CHANGES, asksChanges, asksWeight, changesNote, favouritesOf, freeNameOf, removableOf, searchItems, toggleExtra, toggleMark,
} from './productPicker';

// The product window's pure half (bookings rebuild step 2).

const items = priceListOf([
  { productId: 'pS', name: 'Scacciata broccoli', price: 16, per: 'kg', favourite: true, weights: [1, 1.5], removable: ['cipolla', 'salsiccia'] },
  { productId: 'pP', name: 'Panettone', price: 25, per: 'piece', favourite: true },
  { productId: 'pG', name: 'Grissini', price: 3.5, per: 'pack', packSize: 250, packUnit: 'g' },
  { productId: 'pT', name: 'Scacciata tuma', price: 15, per: 'kg' },
]).items;
const words = { without: (name: string) => `senza ${name}`, extra: (name: string) => `+ ${name}` };

describe('step 1: the product', () => {
  it('the favourites only, in the list\'s order', () => {
    expect(favouritesOf(items).map(item => item.name)).toEqual(['Panettone', 'Scacciata broccoli']);
    expect(favouritesOf([])).toEqual([]);
  });

  it('the search finds every word typed, case and spaces aside; nothing typed is every product', () => {
    expect(searchItems(items, 'scacc').map(item => item.name)).toEqual(['Scacciata broccoli', 'Scacciata tuma']);
    expect(searchItems(items, '  BROCCOLI  scacc ').map(item => item.name)).toEqual(['Scacciata broccoli']);
    expect(searchItems(items, 'pizza')).toEqual([]);
    expect(searchItems(items, '')).toHaveLength(4);
  });

  it('a name typed freely is offered only when it is not exactly one on the list', () => {
    expect(freeNameOf('Torta  su misura ', items)).toBe('Torta su misura');
    expect(freeNameOf(' panettone ', items)).toBeNull();
    expect(freeNameOf('   ', items)).toBeNull();
    expect(freeNameOf('Scacc', items)).toBe('Scacc');
  });
});

describe('which steps are asked', () => {
  it('the weight for a kilo product and for a name typed freely, never for a piece or a pack', () => {
    expect(asksWeight(items.find(item => item.per === 'kg') ?? null)).toBe(true);
    expect(asksWeight(null)).toBe(true);
    expect(asksWeight(items.find(item => item.per === 'piece') ?? null)).toBe(false);
    expect(asksWeight(items.find(item => item.per === 'pack') ?? null)).toBe(false);
  });

  it('the changes only when the product has ingredients to change or the venue offers extras', () => {
    const scacciata = items.find(item => item.productId === 'pS') ?? null;
    const panettone = items.find(item => item.productId === 'pP') ?? null;
    expect(removableOf(scacciata)).toEqual(['cipolla', 'salsiccia']);
    // Never chosen (null) is none: the form does not read the recipes.
    expect(removableOf(panettone)).toEqual([]);
    expect(removableOf(null)).toEqual([]);
    expect(asksChanges(scacciata, [])).toBe(true);
    expect(asksChanges(panettone, [])).toBe(false);
    expect(asksChanges(panettone, ['provola'])).toBe(true);
    expect(asksChanges(null, [])).toBe(false);
  });
});

describe('step 3: the changes', () => {
  it('«−» and «+» exclude each other; pressing the one that is on clears it', () => {
    let changes = toggleMark(NO_CHANGES, 'cipolla', 'without');
    expect(changes.marks).toEqual({ cipolla: 'without' });
    changes = toggleMark(changes, 'cipolla', 'extra');
    expect(changes.marks).toEqual({ cipolla: 'extra' });
    changes = toggleMark(changes, 'cipolla', 'extra');
    expect(changes.marks).toEqual({});
    expect(NO_CHANGES.marks).toEqual({});
  });

  it('an extra is on, then off again', () => {
    const on = toggleExtra(NO_CHANGES, 'provola');
    expect(on.extras).toEqual(['provola']);
    expect(toggleExtra(on, 'provola').extras).toEqual([]);
  });

  it('the note says the recipe\'s changes, then the extras, in the window\'s order; nothing changed is empty', () => {
    let changes = toggleMark(NO_CHANGES, 'salsiccia', 'extra');
    changes = toggleMark(changes, 'cipolla', 'without');
    changes = toggleExtra(changes, 'provola');
    expect(changesNote(['cipolla', 'salsiccia'], ['provola', 'olive'], changes, words)).toBe('senza cipolla, + salsiccia, + provola');
    expect(changesNote(['cipolla'], ['provola'], NO_CHANGES, words)).toBe('');
    // A name made extra in the recipe AND chosen as an extra is said once.
    const twice = toggleExtra(toggleMark(NO_CHANGES, 'provola', 'extra'), 'provola');
    expect(changesNote(['provola'], ['provola'], twice, words)).toBe('+ provola');
  });
});

describe('a weighted line in words', () => {
  it('«3 pz (1,5 kg)»: the pieces, then the weight of one', () => {
    const unit = { unit: (u: 'pcs' | 'kg') => (u === 'kg' ? 'kg' : 'pz'), packs: (n: number) => (n === 1 ? 'confezione' : 'confezioni') };
    expect(lineQtyText({ qty: 3, unit: 'pcs', packSize: null, packUnit: null, weightKg: 1.5 }, 'it-IT', unit)).toBe('3 pz (1,5 kg)');
    expect(lineQtyText({ qty: 1, unit: 'pcs', packSize: null, packUnit: null, weightKg: 0.8 }, 'it-IT', unit)).toBe('1 pz (800 g)');
    expect(lineQtyText({ qty: 2, unit: 'pcs', packSize: null, packUnit: null, weightKg: null }, 'it-IT', unit)).toBe('2 pz');
  });
});
