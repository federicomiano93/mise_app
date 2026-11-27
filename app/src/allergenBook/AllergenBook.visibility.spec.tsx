import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { STAFF_CARDS } from '@mise/shared/home-cards';
import { visibleSectionIds } from '../session/visibility';
import { SECTIONS, arrangeSections, screenNameFor } from '../shell/sections';
import { renderApp } from '../testing/renderApp';

// WHO is shown the «Allergen book» («Allergeni» in the navigation, 27 Nov 2026) and WHERE it sits: exactly whoever is shown Recipes,
// right after Labels, with no switch and no place of its own. Modelled on labels/LabelsSection.visibility.spec.tsx. The screen itself
// (and so a test that renders it) is Phase B.

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

describe('who is shown the allergen book', () => {
  it.each(ROLES)('a %s: exactly when Recipes is shown, in every venue', (role, canManage) => {
    for (const venue of VENUES) {
      const shown = visibleSectionIds(venue, canManage, role);
      expect(shown.has('allergenBook')).toBe(shown.has('recipes'));
    }
  });

  it('an employee loses it when the venue hides Recipes from its employees, and the owner keeps it', () => {
    const venue = { staffHiddenCards: { catalogue: true } };
    expect(visibleSectionIds(venue, false, 'staff').has('allergenBook')).toBe(false);
    expect(visibleSectionIds(venue, true, 'owner').has('allergenBook')).toBe(true);
    expect(visibleSectionIds({}, false, 'staff').has('allergenBook')).toBe(true);
  });

  it('a partial owner: the kitchen owner has it (Recipes is on that side), the sales owner does not', () => {
    expect(visibleSectionIds({}, true, 'owner-kitchen').has('allergenBook')).toBe(true);
    expect(visibleSectionIds({}, true, 'owner-sales').has('allergenBook')).toBe(false);
  });

  it('is not a card of its own: the shared list of staff cards is unchanged, so no switch and no server change', () => {
    expect(STAFF_CARDS.map(card => card.id)).toEqual(['calculator', 'catalogue', 'orders', 'suppliers', 'pastries', 'foodcost', 'inventory', 'bookings']);
  });

  it('an employee of a venue that hides Recipes gets «not available» at its address', async () => {
    renderApp('/allergen-book', { session: { ...EMPLOYEE, location: { staffHiddenCards: { catalogue: true } } } });
    expect(await screen.findByText('This section is not on for you at this venue.')).toBeInTheDocument();
    expect(linkNames(rail())).not.toContain('Allergens');
    expect(linkNames(rail())).not.toContain('Recipes');
  });
});

describe('where the allergen book sits', () => {
  it('right after Labels, which is right after Recipes, in the one list both navigations are built from', () => {
    const ids = SECTIONS.map(section => section.id);
    expect(ids.indexOf('allergenBook')).toBe(ids.indexOf('labels') + 1);
    expect(ids.indexOf('labels')).toBe(ids.indexOf('recipes') + 1);
  });

  it.each(ROLES)('a %s: right after Labels in the rail, whatever order the venue saved for the current app’s Home', (role, canManage) => {
    for (const venue of VENUES) {
      const { railTop } = arrangeSections(visibleSectionIds(venue, canManage, role));
      const ids = railTop.map(section => section.id);
      if (ids.includes('labels')) expect(ids[ids.indexOf('labels') + 1]).toBe('allergenBook');
      else expect(ids).not.toContain('allergenBook');
    }
  });

  it('in the rail of an employee, between Labels and Calculator, with the same look as every other item', () => {
    renderApp('/home', { session: { ...EMPLOYEE, location: { homeCardOrder: ['pastries', 'catalogue'] } } });
    expect(linkNames(rail())).toEqual(['Home', 'Bookings', 'Orders', 'Suppliers', 'Recipes', 'Labels', 'Allergens', 'Calculator', 'Pastries', 'Settings']);
    const book = rail().getByRole('link', { name: 'Allergens' });
    expect(book).toHaveAttribute('href', '/allergen-book');
    expect(book.className).toBe(rail().getByRole('link', { name: 'Recipes' }).className);
  });

  it('on a phone: under «More» (the five tabs are fixed), right after Labels', () => {
    const { more, tabs } = arrangeSections(visibleSectionIds({}, true, 'owner'));
    expect(tabs.map(section => section.id)).toEqual(['home', 'orders', 'recipes', 'calculator']);
    expect(more.map(section => section.id)).toEqual(['bookings', 'suppliers', 'labels', 'allergenBook', 'pastries', 'stocktake', 'foodcost', 'cakes', 'settings']);
  });

  it('counts its two screens in the owner’s statistics', () => {
    expect(screenNameFor('/allergen-book')).toBe('allergen-book');
    expect(screenNameFor('/allergen-book/choose')).toBe('allergen-book-choose');
    expect(screenNameFor('/allergen-book/junk')).toBe('allergen-book');
  });
});
