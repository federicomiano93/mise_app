import { describe, expect, it } from 'vitest';
import { SCREEN_RE } from '@mise/shared/usage-model';
import { routes } from '../routes';
import { en } from '../i18n/en';
import { hasScreen } from './sectionScreens';
import {
  MORE,
  RAIL_PLACES_SHORT,
  SECTIONS,
  STOCKTAKE_UNAVAILABLE_SCREEN,
  arrangeSections,
  moreIsCurrent,
  screenNameFor,
  sectionById,
  titleKeyFor,
} from './sections';
import type { SectionId } from './sections';

describe('the section list', () => {
  it('is in the order the rail shows it', () => {
    expect(SECTIONS.map(section => section.id)).toEqual([
      'home', 'bookings', 'orders', 'suppliers', 'recipes', 'labels', 'allergenBook', 'calculator', 'clients', 'pastries', 'stocktake', 'foodcost', 'cakes', 'settings',
    ]);
  });

  it('gives every section its own id and its own path', () => {
    expect(new Set(SECTIONS.map(section => section.id)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map(section => section.path)).size).toBe(SECTIONS.length);
    for (const section of SECTIONS) expect(section.path).toMatch(/^\/[a-z-]+$/);
  });

  it('labels every section with a message that exists', () => {
    for (const section of [...SECTIONS, MORE]) expect(Object.keys(en)).toContain(section.label);
  });

  it('splits the sections between the rail, the tabs and «More»', () => {
    const arranged = arrangeSections(new Set(SECTIONS.map(section => section.id)));
    expect(arranged.railTop.map(section => section.id)).toEqual([
      'home', 'bookings', 'orders', 'suppliers', 'recipes', 'labels', 'allergenBook', 'calculator', 'clients', 'pastries', 'stocktake', 'foodcost', 'cakes',
    ]);
    expect(arranged.railBottom.map(section => section.id)).toEqual(['settings']);
    // Nobody is shown both the Calculator and Clients (session/visibility.ts), so no real tab bar holds five.
    expect(arranged.tabs.map(section => section.id)).toEqual(['home', 'orders', 'recipes', 'calculator', 'clients']);
    expect(arranged.more.map(section => section.id)).toEqual(['bookings', 'suppliers', 'labels', 'allergenBook', 'pastries', 'stocktake', 'foodcost', 'cakes', 'settings']);
    expect(arranged.first.id).toBe('home');
  });

  // The rail holds RAIL_PLACES_SHORT places on the shortest windows: the last sections before the bottom group spill under «More».
  // ⚠️ The allergen book (27 Nov 2026) made the fullest rail 13 places, so ITS spill is three sections (Stocktake, Food cost, Cakes):
  // the mechanism is unchanged, only the arithmetic moved. A rail of 12 places (a venue without Bookings, say) still spills two.
  it('spills the last three sections of the fullest rail, two from a rail of 12, and nothing from a rail of 11 or fewer', () => {
    expect(RAIL_PLACES_SHORT).toBe(11);
    expect(fullest.railTop.length + fullest.railBottom.length).toBe(13);
    expect(ids(fullest.railSpill)).toEqual(['stocktake', 'foodcost', 'cakes']);
    // Every section but Clients and Bookings: 12 places, as the fullest rail was before the allergen book.
    const noBookings = arrangeSections(new Set(SECTIONS.map(section => section.id).filter(id => id !== 'clients' && id !== 'bookings')));
    expect(noBookings.railTop.length + noBookings.railBottom.length).toBe(12);
    expect(ids(noBookings.railSpill)).toEqual(['foodcost', 'cakes']);
    // Without Cakes and Bookings (or without Food cost) the rail has 11 places and nothing spills.
    const noCakes = arrangeSections(new Set(SECTIONS.map(section => section.id).filter(id => id !== 'clients' && id !== 'bookings' && id !== 'cakes')));
    expect(noCakes.railTop.length + noCakes.railBottom.length).toBe(11);
    expect(noCakes.railSpill).toEqual([]);
    const employee = arrangeSections(new Set<SectionId>(['home', 'orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'settings']));
    expect(employee.railSpill).toEqual([]);
  });

  it('keeps the spill inside the main stack, whatever the bottom group holds', () => {
    for (const spilled of fullest.railSpill) expect(spilled.inRail).toBe('top');
  });

  // D1 (the roles plan): Clients is a phone tab. The sales owner's tab bar is Home, Clients and «More» (Food cost, Settings), the rail
  // Home, Clients, Food cost, Settings.
  it('gives the sales owner Home and Clients as tabs, and Clients on the rail after Home', () => {
    const sales = arrangeSections(new Set<SectionId>(['home', 'clients', 'foodcost', 'settings']));
    expect(ids(sales.railTop)).toEqual(['home', 'clients', 'foodcost']);
    expect(ids(sales.tabs)).toEqual(['home', 'clients']);
    expect(ids(sales.more)).toEqual(['foodcost', 'settings']);
    expect(sectionById('clients').path).toBe('/clients');
    expect(moreIsCurrent('/clients/orders', sales.more)).toBe(false);
    expect(moreIsCurrent('/food-cost', sales.more)).toBe(true);
  });

  it('finds a section by id', () => {
    expect(sectionById('foodcost').path).toBe('/food-cost');
  });

  it('has a route for every section, for «More», and a catch-all', () => {
    const root = routes[0];
    const paths = (root?.children ?? []).map(route => route.path);
    // A built section owns every address under its path, so its route ends in /*. Settings owns its own (/settings/language, step 3g-2).
    for (const section of SECTIONS) {
      expect(paths).toContain(hasScreen(section.id) || section.id === 'settings' ? `${section.path}/*` : section.path);
    }
    expect(paths).toContain(MORE.path);
    expect(paths[paths.length - 1]).toBe('*');
  });
});

const everything = arrangeSections(new Set(SECTIONS.map(section => section.id)));
const ids = (list: readonly { id: SectionId }[]) => list.map(section => section.id);
// Nobody is shown Clients with the Calculator, so the fullest rail is every section but Clients: 13 places.
const fullest = arrangeSections(new Set(SECTIONS.map(section => section.id).filter(id => id !== 'clients')));

describe('arrangeSections', () => {
  it('leaves out what the person is not shown, keeping the order', () => {
    const employee = arrangeSections(new Set<SectionId>(['home', 'orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'settings']));
    expect(ids(employee.railTop)).toEqual(['home', 'orders', 'suppliers', 'recipes', 'calculator', 'pastries']);
    expect(ids(employee.railBottom)).toEqual(['settings']);
    expect(ids(employee.tabs)).toEqual(['home', 'orders', 'recipes', 'calculator']);
    expect(ids(employee.more)).toEqual(['suppliers', 'pastries', 'settings']);
  });

  it('gives a restaurant with only Orders a rail of Home, Orders, Suppliers and Settings, and two tabs', () => {
    const restaurant = arrangeSections(new Set<SectionId>(['home', 'orders', 'suppliers', 'settings']));
    expect(ids(restaurant.railTop)).toEqual(['home', 'orders', 'suppliers']);
    expect(ids(restaurant.railBottom)).toEqual(['settings']);
    expect(ids(restaurant.tabs)).toEqual(['home', 'orders']);
    expect(ids(restaurant.more)).toEqual(['suppliers', 'settings']);
  });

  it('starts on the first section shown: Home, whatever else is shown', () => {
    expect(arrangeSections(new Set<SectionId>(['home', 'recipes', 'settings'])).first.id).toBe('home');
    expect(arrangeSections(new Set<SectionId>(['recipes', 'settings'])).first.id).toBe('recipes');
    expect(arrangeSections(new Set<SectionId>(['settings'])).first.id).toBe('settings');
  });

  it('falls back to Home even for an empty set, so there is always somewhere to land', () => {
    expect(arrangeSections(new Set<SectionId>()).first.id).toBe('home');
  });
});

describe('moreIsCurrent', () => {
  it.each([
    ['/more', true],
    ['/suppliers', true],
    ['/pastries', true],
    ['/stocktake', true],
    ['/food-cost', true],
    ['/cakes', true],
    ['/cakes/reference', true],
    ['/allergen-book', true],
    ['/settings', true],
    ['/settings/language', true],
    ['/orders', false],
    ['/recipes', false],
    ['/calculator', false],
    ['/clients', false],
    ['/home', false],
    ['/cakesX', false],
    ['/', false],
    ['/no-such-section', false],
    ['/suppliers-archive', false],
  ])('%s → %s', (pathname, expected) => {
    expect(moreIsCurrent(pathname, everything.more)).toBe(expected);
  });

  // «More» stands only for what THIS person's «More» holds.
  it('does not stand for a section that is not shown to the person', () => {
    const restaurant = arrangeSections(new Set<SectionId>(['orders', 'suppliers', 'settings']));
    expect(moreIsCurrent('/suppliers', restaurant.more)).toBe(true);
    expect(moreIsCurrent('/pastries', restaurant.more)).toBe(false);
    expect(moreIsCurrent('/more', restaurant.more)).toBe(true);
  });

  // The rail's «More» item stands for the sections that spilled, and for the More page itself.
  it('stands, on the rail, for the spilled sections and /more only', () => {
    expect(moreIsCurrent('/cakes', fullest.railSpill)).toBe(true);
    expect(moreIsCurrent('/food-cost/product/p1', fullest.railSpill)).toBe(true);
    expect(moreIsCurrent('/more', fullest.railSpill)).toBe(true);
    // Stocktake spills now (13 places: three sections go under «More»); the allergen book, Labels and Pastries stay on the rail.
    expect(moreIsCurrent('/stocktake', fullest.railSpill)).toBe(true);
    expect(moreIsCurrent('/pastries', fullest.railSpill)).toBe(false);
    expect(moreIsCurrent('/allergen-book', fullest.railSpill)).toBe(false);
    expect(moreIsCurrent('/settings', fullest.railSpill)).toBe(false);
  });
});

describe('screenNameFor', () => {
  it.each([
    ['/cakes', 'cakes'],
    ['/cakes/', 'cakes'],
    ['/cakes/new', 'cakes-editor'],
    ['/cakes/c-1', 'cakes-editor'],
    ['/cakes/reference', 'cakes-reference'],
    ['/cakes/c-1/extra', 'cakes'],
    ['/cakesX', 'not-found'],
  ])('%s → %s', (pathname, expected) => {
    expect(screenNameFor(pathname)).toBe(expected);
  });

  it.each([
    ['/home', 'home'],
    ['/home/', 'home'],
    ['/orders', 'orders'],
    ['/food-cost', 'foodcost'],
    ['/suppliers/42', 'suppliers'],
    ['/settings', 'settings'],
    ['/more', 'more'],
    ['/no-such-section', 'not-found'],
    ['/suppliers-archive', 'not-found'],
    ['/orders/', 'orders'],
  ])('%s → %s', (pathname, expected) => {
    expect(screenNameFor(pathname)).toBe(expected);
  });

  it('says nothing for the address with no section in it, which redirects at once', () => {
    expect(screenNameFor('/')).toBeNull();
  });

  // The allergen book is the one section whose usage name is its address, not its id (`allergenBook` has a capital, which the
  // usage record refuses): `allergen-book`.
  it('names every section by its id, the allergen book by its address', () => {
    for (const section of SECTIONS) expect(screenNameFor(section.path)).toBe(section.id === 'allergenBook' ? 'allergen-book' : section.id);
  });

  // The allergen book is two screens in one section: the book and the pencil screen; junk is sent back to the book.
  it.each([
    ['/allergen-book', 'allergen-book'],
    ['/allergen-book/', 'allergen-book'],
    ['/allergen-book/choose', 'allergen-book-choose'],
    ['/allergen-book/choose/', 'allergen-book-choose'],
    ['/allergen-book/junk', 'allergen-book'],
    ['/allergen-book/choose/more', 'allergen-book'],
    ['/allergen-bookX', 'not-found'],
  ])('%s → %s', (pathname, expected) => {
    expect(screenNameFor(pathname)).toBe(expected);
  });

  // The Recipe catalogue is two screens in one section: the list and one recipe.
  it.each([
    ['/recipes', 'recipes'],
    ['/recipes/', 'recipes'],
    ['/recipes/allergens', 'recipes-allergens'],
    ['/recipes/settings', 'recipes-settings'],
    ['/recipes/abc123', 'recipes-detail'],
    ['/recipes/abc123/label', 'recipes-label'],
    ['/recipes/allergens/label', 'recipes'],
    ['/recipes/a%2Fb', 'recipes-detail'],
    // A reserved word or junk is sent back to the list: never a recipe screen in the statistics.
    ['/recipes/new', 'recipes-editor'],
    ['/recipes/%', 'recipes'],
    ['/recipes/abc/edit', 'recipes-editor'],
    ['/recipes/new/edit', 'recipes'],
    ['/recipes/abc/steps', 'recipes-steps'],
    ['/recipes/abc/mix', 'recipes-run'],
    ['/recipes/photo', 'recipes-photo'],
    ['/recipes/photo/x', 'recipes'],
    ['/recipes/haccp', 'recipes-haccp'],
    ['/recipes/abc/haccp', 'recipes-haccp-label'],
    ['/recipes/haccp/haccp', 'recipes'],
    ['/recipes/haccp/x', 'recipes'],
    ['/recipes/ingredients', 'recipes-ingredients'],
    ['/recipes/ingredients/x', 'recipes'],
    ['/recipes/new/mix', 'recipes'],
    ['/recipes/settings/steps', 'recipes'],
  ])('%s → %s', (pathname, expected) => {
    expect(screenNameFor(pathname)).toBe(expected);
  });

  // Pastries is three screens in one section; picking another day is not a new screen.
  it.each([
    ['/pastries', 'pastries'],
    ['/pastries/', 'pastries'],
    ['/pastries/Tuesday', 'pastries'],
    ['/pastries/Sunday', 'pastries'],
    ['/pastries/records', 'pastries-records'],
    ['/pastries/records/', 'pastries-records'],
    ['/pastries/Tuesday/edit', 'pastries-editor'],
    ['/pastries/Sunday/edit/', 'pastries-editor'],
    ['/pastries/Funday/edit', 'pastries'],
    ['/pastries/Tuesday/edit/more', 'pastries'],
    ['/pastries/records/edit', 'pastries'],
    ['/pastries-archive', 'not-found'],
  ])('%s → %s', (pathname, expected) => {
    expect(screenNameFor(pathname)).toBe(expected);
  });

  // The Stocktake is three screens in one section: the month's list (whichever month), one product,
  // and «What it cost». Changing month is not a new screen.
  it.each([
    ['/stocktake', 'stocktake'],
    ['/stocktake/', 'stocktake'],
    ['/stocktake/2026-10', 'stocktake'],
    ['/stocktake/2019-02/', 'stocktake'],
    ['/stocktake/2026-10/product/flour', 'stocktake-product'],
    ['/stocktake/2026-10/product/flour/', 'stocktake-product'],
    ['/stocktake/2026-10/product/a%2Fb%20c', 'stocktake-product'],
    ['/stocktake/2026-10/cost', 'stocktake-cost'],
    ['/stocktake/2026-10/cost/', 'stocktake-cost'],
    ['/stocktake/2026-13/cost', 'stocktake'],
    ['/stocktake/nonsense/product/flour', 'stocktake'],
    ['/stocktake/2026-10/product', 'stocktake'],
    ['/stocktake/2026-10/product/a/b', 'stocktake'],
    ['/stocktake/2026-10/cost/more', 'stocktake'],
    ['/stocktake-archive', 'not-found'],
  ])('%s → %s', (pathname, expected) => {
    expect(screenNameFor(pathname)).toBe(expected);
  });

  // Food cost is four screens in one section: the list, a product (new or existing), its margin
  // history and Settings.
  it.each([
    ['/food-cost', 'foodcost'],
    ['/food-cost/', 'foodcost'],
    ['/food-cost/new', 'foodcost-product'],
    ['/food-cost/product/abc', 'foodcost-product'],
    ['/food-cost/product/a%2Fb%20c/', 'foodcost-product'],
    ['/food-cost/product/abc/history', 'foodcost-history'],
    ['/food-cost/settings', 'foodcost-settings'],
    ['/food-cost/product', 'foodcost'],
    ['/food-cost/product/a/b', 'foodcost'],
    ['/food-cost/product/a/history/more', 'foodcost'],
    ['/food-cost/settings/more', 'foodcost'],
    ['/food-cost/nonsense', 'foodcost'],
    ['/food-cost-archive', 'not-found'],
  ])('%s → %s', (pathname, expected) => {
    expect(screenNameFor(pathname)).toBe(expected);
  });
  // The Calculator's work view is one screen, whichever recipe's tab is open: changing tab is not a
  // new screen (the Log, Orders and Settings get their names with their own steps).
  it.each([
    ['/calculator', 'calculator'],
    ['/calculator/brioche', 'calculator'],
    ['/calculator/a%2Fb%20c', 'calculator'],
    ['/calculator/brioche/more', 'calculator'],
    ['/calculator-archive', 'not-found'],
    // Every address under Settings is the one screen the current app calls `settings`.
    ['/calculator/settings', 'settings'],
    ['/calculator/settings/', 'settings'],
    ['/calculator/settings/extra', 'settings'],
    ['/calculator/settings/ordering', 'settings'],
    ['/calculator/settings/divisor/brioche', 'settings'],
    ['/calculator/settings/log', 'settings'],
    ['/calculator/settings/clients/new', 'settings'],
    ['/calculator/settings/nonsense', 'settings'],
    ['/calculator/settingsX', 'calculator'],
    // The Dough history: the current app's `log` and `log-history`.
    ['/calculator/log', 'log'],
    ['/calculator/log/new', 'log'],
    ['/calculator/log/l-1', 'log'],
    ['/calculator/log/l-1/edit', 'log'],
    ['/calculator/log/l-1/history', 'log-history'],
    ['/calculator/log/l-1/history/2', 'log-history'],
    ['/calculator/logX', 'calculator'],
    // Orders received (both views): one screen, as the current app's overlay is.
    ['/calculator/orders', 'client-orders'],
    ['/calculator/orders/history', 'client-orders'],
    ['/calculator/orders/nonsense', 'client-orders'],
    ['/calculator/ordersX', 'calculator'],
  ])('%s → %s', (pathname, expected) => {
    expect(screenNameFor(pathname)).toBe(expected);
  });

  // The usage record silently drops a name it does not accept: a new section whose id broke the
  // rule would simply never be counted.
  it('only ever gives a name the usage record accepts, «m2:» included', () => {
    const names = [
      // The names the sections really get (the allergen book's is its address: its id has a capital).
      ...SECTIONS.map(section => screenNameFor(section.path)), 'pastries-records', 'pastries-editor', 'more', 'not-found',
      'stocktake-product', 'stocktake-cost', STOCKTAKE_UNAVAILABLE_SCREEN,
      'foodcost-product', 'foodcost-history', 'foodcost-settings', 'client-orders',
      'clients-editor', 'clients-orders', 'clients-ordering',
      'cakes-editor', 'cakes-reference', 'allergen-book', 'allergen-book-choose',
    ];
    for (const name of names) expect(`m2:${name}`).toMatch(SCREEN_RE);
  });
});

describe('titleKeyFor', () => {
  it.each([
    ['/home', 'section.home'],
    ['/orders', 'section.orders'],
    ['/food-cost', 'section.foodcost'],
    ['/cakes/reference', 'section.cakes'],
    ['/allergen-book', 'section.allergenBook'],
    ['/allergen-book/choose', 'section.allergenBook'],
    ['/settings/language', 'section.settings'],
    ['/more', 'section.more'],
    ['/', 'notFound.title'],
    ['/no-such-section', 'notFound.title'],
    ['/suppliers-archive', 'notFound.title'],
  ])('%s → %s', (pathname, expected) => {
    expect(titleKeyFor(pathname)).toBe(expected);
  });

  it('names every section by its own label', () => {
    for (const section of SECTIONS) expect(titleKeyFor(section.path)).toBe(section.label);
  });
});
