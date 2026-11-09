import { describe, expect, it } from 'vitest';
import { readsPurchasePrices, visibleSectionIds } from './visibility';

const ALL = ['home', 'orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'stocktake', 'foodcost', 'settings'];
const ids = (location: Record<string, unknown> | null, canManage: boolean, role: string = canManage ? 'owner' : 'staff') =>
  [...visibleSectionIds(location, canManage, role)].sort();
const sorted = (list: string[]) => [...list].sort();

describe('visibleSectionIds', () => {
  it('shows everything to a manager or owner of a venue with no document yet', () => {
    expect(ids(null, true)).toEqual(sorted(ALL));
  });

  it('shows an employee the everyday sections, not the money ones, when the venue has said nothing', () => {
    expect(ids(null, false)).toEqual(sorted(['home', 'orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'settings']));
    expect(ids({ name: 'A place' }, false)).toEqual(
      sorted(['home', 'orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'settings']),
    );
  });

  it('keeps Food cost and Stocktake from an employee until the venue shows each one', () => {
    const seen = visibleSectionIds({}, false, 'staff');
    expect(seen.has('foodcost')).toBe(false);
    expect(seen.has('stocktake')).toBe(false);
  });

  it('shows Food cost, but not Stocktake, when the venue shows only Food cost to staff', () => {
    const seen = visibleSectionIds({ staffShownCards: { foodcost: true } }, false, 'staff');
    expect(seen.has('foodcost')).toBe(true);
    expect(seen.has('stocktake')).toBe(false);
  });

  it('shows Stocktake, but not Food cost, when the venue shows only Stocktake to staff', () => {
    const seen = visibleSectionIds({ staffShownCards: { inventory: true } }, false, 'staff');
    expect(seen.has('stocktake')).toBe(true);
    expect(seen.has('foodcost')).toBe(false);
  });

  it('hides a card the venue hid from its employees, and still shows it to a manager', () => {
    const location = { staffHiddenCards: { pastries: true } };
    expect(visibleSectionIds(location, false, 'staff').has('pastries')).toBe(false);
    expect(visibleSectionIds(location, true, 'owner').has('pastries')).toBe(true);
  });

  // Suppliers and Orders are two cards in ONE section: hiding one must not hide the other.
  it('judges Suppliers and Orders as separate cards', () => {
    const seen = visibleSectionIds({ staffHiddenCards: { suppliers: true } }, false, 'staff');
    expect(seen.has('suppliers')).toBe(false);
    expect(seen.has('orders')).toBe(true);
  });

  it('hides Food cost AND Stocktake when the venue did not buy the section, even from an owner', () => {
    const seen = visibleSectionIds({ sections: { foodcost: false } }, true, 'owner');
    expect(seen.has('foodcost')).toBe(false);
    expect(seen.has('stocktake')).toBe(false);
    expect(seen.has('orders')).toBe(true);
  });

  it('hides Suppliers when the venue did not buy Orders', () => {
    const seen = visibleSectionIds({ sections: { orders: false } }, true, 'owner');
    expect(seen.has('orders')).toBe(false);
    expect(seen.has('suppliers')).toBe(false);
  });

  it('hides Recipes when the venue did not buy the catalogue', () => {
    expect(visibleSectionIds({ sections: { catalogue: false } }, true, 'owner').has('recipes')).toBe(false);
  });

  it('shows a restaurant that bought only Orders: Home, Orders, Suppliers and Settings', () => {
    const restaurant = { sections: { calculator: false, catalogue: false, pastries: false, foodcost: false } };
    expect(ids(restaurant, true)).toEqual(sorted(['home', 'orders', 'suppliers', 'settings']));
    expect(ids(restaurant, false)).toEqual(sorted(['home', 'orders', 'suppliers', 'settings']));
  });

  // Straight from production (30 July 2026): the field names were saved with a stray space.
  it('honours a sections field typed with a stray space', () => {
    const restaurant = {
      'sections ': { orders: true, 'calculator ': false, catalogue: false, 'pastries ': false, foodcost: false },
    };
    expect(ids(restaurant, true)).toEqual(sorted(['home', 'orders', 'suppliers', 'settings']));
  });

  it('shows Home to everybody: an employee, a manager and a venue that bought nothing', () => {
    const nothing = { sections: { orders: false, calculator: false, catalogue: false, pastries: false, foodcost: false } };
    expect(visibleSectionIds(null, false, 'staff').has('home')).toBe(true);
    expect(visibleSectionIds({}, true, 'owner').has('home')).toBe(true);
    expect(visibleSectionIds(nothing, false, 'staff').has('home')).toBe(true);
  });

  it('never hides Home or Settings', () => {
    const nothing = { sections: { orders: false, calculator: false, catalogue: false, pastries: false, foodcost: false } };
    expect(ids(nothing, true)).toEqual(['home', 'settings']);
    expect(ids(nothing, false)).toEqual(['home', 'settings']);
  });

  it('treats a corrupt sections field as "everything on", like the current app', () => {
    expect(ids({ sections: 'nonsense' }, true)).toEqual(sorted(ALL));
  });
});

// ⚠️ THE TWO PARTIAL OWNERS (Federico, 1 Nov 2026). They canManage, so the role is the only thing that tells them apart from
// an owner: a call without it would show the sales owner the kitchen and the kitchen owner the prices.
describe('visibleSectionIds for the partial owners', () => {
  it('shows the sales owner Home, Clients, Food cost and Settings, and nothing of the kitchen', () => {
    expect(ids({}, true, 'owner-sales')).toEqual(sorted(['home', 'clients', 'foodcost', 'settings']));
    expect(ids(null, true, 'owner-sales')).toEqual(sorted(['home', 'clients', 'foodcost', 'settings']));
  });

  it('shows the kitchen owner everything but Food cost, Stocktake kept', () => {
    expect(ids({}, true, 'owner-kitchen')).toEqual(
      sorted(['home', 'orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'stocktake', 'settings']));
  });

  it('never shows a partial owner what the venue switched off', () => {
    expect(ids({ sections: { foodcost: false } }, true, 'owner-sales')).toEqual(['clients', 'home', 'settings']);
    expect(ids({ sections: { orders: false } }, true, 'owner-kitchen')).not.toContain('orders');
  });

  // The Clients page is the sales owner's ONLY (ROLE_ONLY_CARDS): the card is behind the Calculator's SECTION, so a venue that
  // did not buy the Calculator has no clients to run either.
  it('shows Clients to the sales owner and to nobody else, whatever the venue hides', () => {
    for (const role of ['owner', 'manager', 'owner-kitchen']) expect(ids({}, true, role)).not.toContain('clients');
    expect(ids({}, false, 'staff')).not.toContain('clients');
    expect(ids({ staffShownCards: { clients: true } }, false, 'staff')).not.toContain('clients');
    expect(ids({ sections: { calculator: false } }, true, 'owner-sales')).not.toContain('clients');
  });

  it('is not narrowed for an owner and a manager, and a hidden card still hides from staff only', () => {
    expect(ids({}, true, 'owner')).toEqual(sorted(ALL));
    expect(ids({}, true, 'manager')).toEqual(sorted(ALL));
    expect(ids({ staffHiddenCards: { suppliers: true } }, true, 'owner-kitchen')).toContain('suppliers');
  });
});

describe('readsPurchasePrices (the rules: cardAccess(lid, foodcost, prices))', () => {
  it('is true for whoever runs a side, the kitchen owner included, where the venue has Food cost', () => {
    expect(readsPurchasePrices({}, true)).toBe(true);
    expect(readsPurchasePrices(null, true)).toBe(true);
  });

  it('is true for an employee only where the venue shows them Food cost', () => {
    expect(readsPurchasePrices({}, false)).toBe(false);
    expect(readsPurchasePrices({ staffShownCards: { foodcost: true } }, false)).toBe(true);
    expect(readsPurchasePrices({ staffShownCards: { inventory: true } }, false)).toBe(false);
  });

  it('is false for everybody in a venue that did not buy Food cost', () => {
    const off = { sections: { foodcost: false }, staffShownCards: { foodcost: true } };
    expect(readsPurchasePrices(off, true)).toBe(false);
    expect(readsPurchasePrices(off, false)).toBe(false);
  });

  it('does not depend on the role card: the kitchen owner has no Food cost screen and still reads the prices', () => {
    expect(visibleSectionIds({}, true, 'owner-kitchen').has('foodcost')).toBe(false);
    expect(readsPurchasePrices({}, true)).toBe(true);
  });
});
