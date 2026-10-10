import { describe, expect, it } from 'vitest';
import { routes } from '../routes';
import { en } from '../i18n/en';
import {
  MORE,
  MORE_SECTIONS,
  RAIL_BOTTOM,
  RAIL_TOP,
  SECTIONS,
  TAB_SECTIONS,
  moreIsCurrent,
  sectionById,
} from './sections';

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
    expect(RAIL_TOP.map(section => section.id)).toEqual([
      'orders', 'suppliers', 'recipes', 'calculator', 'pastries', 'stocktake', 'foodcost',
    ]);
    expect(RAIL_BOTTOM.map(section => section.id)).toEqual(['settings']);
    expect(TAB_SECTIONS.map(section => section.id)).toEqual(['orders', 'recipes', 'calculator', 'stocktake']);
    expect(MORE_SECTIONS.map(section => section.id)).toEqual(['suppliers', 'pastries', 'foodcost', 'settings']);
  });

  it('finds a section by id', () => {
    expect(sectionById('foodcost').path).toBe('/food-cost');
  });

  it('has a route for every section, for «More», and a catch-all', () => {
    const root = routes[0];
    const paths = (root?.children ?? []).map(route => route.path);
    for (const section of SECTIONS) expect(paths).toContain(section.path);
    expect(paths).toContain(MORE.path);
    expect(paths[paths.length - 1]).toBe('*');
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
    expect(moreIsCurrent(pathname)).toBe(expected);
  });
});
