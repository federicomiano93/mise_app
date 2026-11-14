import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { STAFF_CARDS } from '@mise/shared/home-cards';
import { visibleSectionIds } from '../session/visibility';
import { SECTIONS, arrangeSections, screenNameFor } from '../shell/sections';
import { renderApp } from '../testing/renderApp';

// WHO is shown «Labels» and WHERE it sits (the owner, 13 Nov 2026): exactly whoever is shown Recipes, right after Recipes,
// with no switch and no place of its own.

const rail = () => within(screen.getByRole('navigation', { name: 'All sections' }));
const linkNames = (scope: { getAllByRole: (role: string) => HTMLElement[] }) => scope.getAllByRole('link').map(link => link.textContent);

const EMPLOYEE = { canManage: false, isOwner: false, role: 'staff' as const };
const ROLES: ReadonlyArray<[string, boolean]> = [
  ['owner', true], ['manager', true], ['staff', false], ['owner-sales', true], ['owner-kitchen', true],
];
// Every venue a spec can think of: nothing said, Recipes hidden from staff, every everyday card hidden, Recipes not bought,
// money cards shown, a corrupt field, a saved Home order in every shape.
const VENUES: ReadonlyArray<Record<string, unknown> | null> = [
  null,
  {},
  { staffHiddenCards: { catalogue: true } },
  { staffHiddenCards: { catalogue: false } },
  { staffHiddenCards: { calculator: true, orders: true, suppliers: true, pastries: true } },
  { staffHiddenCards: { catalogue: 'yes' } },
  { sections: { catalogue: false } },
  { sections: { catalogue: false }, staffShownCards: { foodcost: true, inventory: true } },
  { homeCardOrder: ['pastries', 'foodcost', 'catalogue', 'calculator'] },
  { homeCardOrder: ['catalogue'] },
  { homeCardOrder: 'nonsense' },
];

describe('who is shown «Labels»', () => {
  it.each(ROLES)('a %s: exactly when Recipes is shown, in every venue', (role, canManage) => {
    for (const venue of VENUES) {
      const shown = visibleSectionIds(venue, canManage, role);
      expect(shown.has('labels')).toBe(shown.has('recipes'));
    }
  });

  it('an employee loses it when the venue hides Recipes from its employees, and the owner keeps it', () => {
    const venue = { staffHiddenCards: { catalogue: true } };
    expect(visibleSectionIds(venue, false, 'staff').has('labels')).toBe(false);
    expect(visibleSectionIds(venue, true, 'owner').has('labels')).toBe(true);
    expect(visibleSectionIds({}, false, 'staff').has('labels')).toBe(true);
  });

  it('a partial owner: the kitchen owner has it (Recipes is on that side), the sales owner does not', () => {
    expect(visibleSectionIds({}, true, 'owner-kitchen').has('labels')).toBe(true);
    expect(visibleSectionIds({}, true, 'owner-sales').has('labels')).toBe(false);
  });

  it('is not a card of its own: no new id in the shared list of staff cards, so no switch and no server change', () => {
    expect(STAFF_CARDS.map(card => card.id)).toEqual(['calculator', 'catalogue', 'orders', 'suppliers', 'pastries', 'foodcost', 'inventory']);
  });

  it('an employee of a venue that hides Recipes gets «not available» at its address', async () => {
    renderApp('/labels', { session: { ...EMPLOYEE, location: { staffHiddenCards: { catalogue: true } } } });
    expect(await screen.findByText('This section is not on for you at this venue.')).toBeInTheDocument();
    expect(linkNames(rail())).not.toContain('Labels');
    expect(linkNames(rail())).not.toContain('Recipes');
  });
});

describe('where «Labels» sits', () => {
  it('right after Recipes in the one list both navigations are built from', () => {
    const ids = SECTIONS.map(section => section.id);
    expect(ids.indexOf('labels')).toBe(ids.indexOf('recipes') + 1);
  });

  it.each(ROLES)('a %s: right after Recipes in the rail, whatever order the venue saved for the current app’s Home', (role, canManage) => {
    for (const venue of VENUES) {
      const { railTop } = arrangeSections(visibleSectionIds(venue, canManage, role));
      const ids = railTop.map(section => section.id);
      if (ids.includes('recipes')) expect(ids[ids.indexOf('recipes') + 1]).toBe('labels');
      else expect(ids).not.toContain('labels');
    }
  });

  it('in the rail of an employee, between Recipes and Calculator, with the same look as every other item', () => {
    renderApp('/home', { session: { ...EMPLOYEE, location: { homeCardOrder: ['pastries', 'catalogue'] } } });
    expect(linkNames(rail())).toEqual(['Home', 'Orders', 'Suppliers', 'Recipes', 'Labels', 'Calculator', 'Pastries', 'Settings']);
    const labels = rail().getByRole('link', { name: 'Labels' });
    expect(labels).toHaveAttribute('href', '/labels');
    expect(labels.className).toBe(rail().getByRole('link', { name: 'Recipes' }).className);
  });

  it('on a phone: under «More» (the five tabs are fixed), between Suppliers and Pastries as the list orders them', () => {
    const { more, tabs } = arrangeSections(visibleSectionIds({}, true, 'owner'));
    expect(tabs.map(section => section.id)).toEqual(['home', 'orders', 'recipes', 'calculator']);
    expect(more.map(section => section.id)).toEqual(['suppliers', 'labels', 'pastries', 'stocktake', 'foodcost', 'settings']);
  });

  it('is current in the rail on its own screens', async () => {
    renderApp('/labels/product');
    expect(await screen.findByRole('heading', { level: 1, name: 'Labels' })).toBeInTheDocument();
    expect(rail().getByRole('link', { name: 'Labels' })).toHaveAttribute('aria-current', 'page');
    expect(rail().getByRole('link', { name: 'Recipes' })).not.toHaveAttribute('aria-current');
  });

  it('counts its three screens in the owner’s statistics', () => {
    expect(screenNameFor('/labels')).toBe('labels');
    expect(screenNameFor('/labels/product')).toBe('labels-product');
    expect(screenNameFor('/labels/haccp')).toBe('labels-haccp');
    expect(screenNameFor('/labels/junk')).toBe('labels');
  });
});
