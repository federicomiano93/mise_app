import { describe, expect, it } from 'vitest';
import { SCREEN_RE } from '@mise/shared/usage-model';
import { routes } from '../routes';
import { en } from '../i18n/en';
import { hasScreen } from './sectionScreens';
import {
  MORE,
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
      'orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'stocktake', 'foodcost', 'settings',
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
      'orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'stocktake', 'foodcost',
    ]);
    expect(arranged.railBottom.map(section => section.id)).toEqual(['settings']);
    expect(arranged.tabs.map(section => section.id)).toEqual(['orders', 'recipes', 'calculator', 'stocktake']);
    expect(arranged.more.map(section => section.id)).toEqual(['suppliers', 'pastries', 'foodcost', 'settings']);
    expect(arranged.first.id).toBe('orders');
  });

  it('finds a section by id', () => {
    expect(sectionById('foodcost').path).toBe('/food-cost');
  });

  it('has a route for every section, for «More», and a catch-all', () => {
    const root = routes[0];
    const paths = (root?.children ?? []).map(route => route.path);
    // A built section owns every address under its path, so its route ends in /*.
    for (const section of SECTIONS) {
      expect(paths).toContain(hasScreen(section.id) ? `${section.path}/*` : section.path);
    }
    expect(paths).toContain(MORE.path);
    expect(paths[paths.length - 1]).toBe('*');
  });
});

const everything = arrangeSections(new Set(SECTIONS.map(section => section.id)));
const ids = (list: readonly { id: SectionId }[]) => list.map(section => section.id);

describe('arrangeSections', () => {
  it('leaves out what the person is not shown, keeping the order', () => {
    const employee = arrangeSections(new Set<SectionId>(['orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'settings']));
    expect(ids(employee.railTop)).toEqual(['orders', 'suppliers', 'recipes', 'calculator', 'pastries']);
    expect(ids(employee.railBottom)).toEqual(['settings']);
    expect(ids(employee.tabs)).toEqual(['orders', 'recipes', 'calculator']);
    expect(ids(employee.more)).toEqual(['suppliers', 'pastries', 'settings']);
  });

  it('gives a restaurant with only Orders a rail of Orders, Suppliers and Settings, and one tab', () => {
    const restaurant = arrangeSections(new Set<SectionId>(['orders', 'suppliers', 'settings']));
    expect(ids(restaurant.railTop)).toEqual(['orders', 'suppliers']);
    expect(ids(restaurant.railBottom)).toEqual(['settings']);
    expect(ids(restaurant.tabs)).toEqual(['orders']);
    expect(ids(restaurant.more)).toEqual(['suppliers', 'settings']);
  });

  it('starts on the first section shown, not always on Orders', () => {
    expect(arrangeSections(new Set<SectionId>(['recipes', 'settings'])).first.id).toBe('recipes');
    expect(arrangeSections(new Set<SectionId>(['settings'])).first.id).toBe('settings');
  });

  it('falls back to Settings even for an empty set, so there is always somewhere to land', () => {
    expect(arrangeSections(new Set<SectionId>()).first.id).toBe('settings');
  });
});

describe('moreIsCurrent', () => {
  it.each([
    ['/more', true],
    ['/suppliers', true],
    ['/pastries', true],
    ['/food-cost', true],
    ['/settings', true],
    ['/settings/language', true],
    ['/orders', false],
    ['/recipes', false],
    ['/calculator', false],
    ['/stocktake', false],
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
});

describe('screenNameFor', () => {
  it.each([
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

  it('names every section by its id', () => {
    for (const section of SECTIONS) expect(screenNameFor(section.path)).toBe(section.id);
  });

  // The Recipe catalogue is two screens in one section: the list and one recipe.
  it.each([
    ['/recipes', 'recipes'],
    ['/recipes/', 'recipes'],
    ['/recipes/allergens', 'recipes-allergens'],
    ['/recipes/abc123', 'recipes-detail'],
    ['/recipes/abc123/label', 'recipes-label'],
    ['/recipes/allergens/label', 'recipes'],
    ['/recipes/a%2Fb', 'recipes-detail'],
    // A reserved word or junk is sent back to the list: never a recipe screen in the statistics.
    ['/recipes/new', 'recipes'],
    ['/recipes/settings', 'recipes'],
    ['/recipes/%', 'recipes'],
    ['/recipes/abc/edit', 'recipes'],
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
      ...SECTIONS.map(section => section.id), 'pastries-records', 'pastries-editor', 'more', 'not-found',
      'stocktake-product', 'stocktake-cost', STOCKTAKE_UNAVAILABLE_SCREEN,
      'foodcost-product', 'foodcost-history', 'foodcost-settings', 'client-orders',
    ];
    for (const name of names) expect(`m2:${name}`).toMatch(SCREEN_RE);
  });
});

describe('titleKeyFor', () => {
  it.each([
    ['/orders', 'section.orders'],
    ['/food-cost', 'section.foodcost'],
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
