import { describe, expect, it } from 'vitest';
import { visibleSectionIds } from './visibility';

const ALL = ['orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'stocktake', 'foodcost', 'settings'];
const ids = (location: Record<string, unknown> | null, canManage: boolean) =>
  [...visibleSectionIds(location, canManage)].sort();
const sorted = (list: string[]) => [...list].sort();

describe('visibleSectionIds', () => {
  it('shows everything to a manager or owner of a venue with no document yet', () => {
    expect(ids(null, true)).toEqual(sorted(ALL));
  });

  it('shows an employee the everyday sections, not the money ones, when the venue has said nothing', () => {
    expect(ids(null, false)).toEqual(sorted(['orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'settings']));
    expect(ids({ name: 'A place' }, false)).toEqual(
      sorted(['orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'settings']),
    );
  });

  it('keeps Food cost and Stocktake from an employee until the venue shows each one', () => {
    const seen = visibleSectionIds({}, false);
    expect(seen.has('foodcost')).toBe(false);
    expect(seen.has('stocktake')).toBe(false);
  });

  it('shows Food cost, but not Stocktake, when the venue shows only Food cost to staff', () => {
    const seen = visibleSectionIds({ staffShownCards: { foodcost: true } }, false);
    expect(seen.has('foodcost')).toBe(true);
    expect(seen.has('stocktake')).toBe(false);
  });

  it('shows Stocktake, but not Food cost, when the venue shows only Stocktake to staff', () => {
    const seen = visibleSectionIds({ staffShownCards: { inventory: true } }, false);
    expect(seen.has('stocktake')).toBe(true);
    expect(seen.has('foodcost')).toBe(false);
  });

  it('hides a card the venue hid from its employees, and still shows it to a manager', () => {
    const location = { staffHiddenCards: { pastries: true } };
    expect(visibleSectionIds(location, false).has('pastries')).toBe(false);
    expect(visibleSectionIds(location, true).has('pastries')).toBe(true);
  });

  // Suppliers and Orders are two cards in ONE section: hiding one must not hide the other.
  it('judges Suppliers and Orders as separate cards', () => {
    const seen = visibleSectionIds({ staffHiddenCards: { suppliers: true } }, false);
    expect(seen.has('suppliers')).toBe(false);
    expect(seen.has('orders')).toBe(true);
  });

  it('hides Food cost AND Stocktake when the venue did not buy the section, even from an owner', () => {
    const seen = visibleSectionIds({ sections: { foodcost: false } }, true);
    expect(seen.has('foodcost')).toBe(false);
    expect(seen.has('stocktake')).toBe(false);
    expect(seen.has('orders')).toBe(true);
  });

  it('hides Suppliers when the venue did not buy Orders', () => {
    const seen = visibleSectionIds({ sections: { orders: false } }, true);
    expect(seen.has('orders')).toBe(false);
    expect(seen.has('suppliers')).toBe(false);
  });

  it('hides Recipes when the venue did not buy the catalogue', () => {
    expect(visibleSectionIds({ sections: { catalogue: false } }, true).has('recipes')).toBe(false);
  });

  it('shows a restaurant that bought only Orders: Orders, Suppliers and Settings', () => {
    const restaurant = { sections: { calculator: false, catalogue: false, pastries: false, foodcost: false } };
    expect(ids(restaurant, true)).toEqual(sorted(['orders', 'suppliers', 'settings']));
    expect(ids(restaurant, false)).toEqual(sorted(['orders', 'suppliers', 'settings']));
  });

  // Straight from production (30 July 2026): the field names were saved with a stray space.
  it('honours a sections field typed with a stray space', () => {
    const restaurant = {
      'sections ': { orders: true, 'calculator ': false, catalogue: false, 'pastries ': false, foodcost: false },
    };
    expect(ids(restaurant, true)).toEqual(sorted(['orders', 'suppliers', 'settings']));
  });

  it('never hides Settings', () => {
    const nothing = { sections: { orders: false, calculator: false, catalogue: false, pastries: false, foodcost: false } };
    expect(ids(nothing, true)).toEqual(['settings']);
    expect(ids(nothing, false)).toEqual(['settings']);
  });

  it('treats a corrupt sections field as "everything on", like the current app', () => {
    expect(ids({ sections: 'nonsense' }, true)).toEqual(sorted(ALL));
  });
});
