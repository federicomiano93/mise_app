import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { STAFF_CARDS, cardVisibleTo } from '@mise/shared/home-cards';
import { venueHasSection, visibleSectionIds } from '../session/visibility';
import { SECTIONS, arrangeSections, screenNameFor } from '../shell/sections';
import { renderApp } from '../testing/renderApp';
import { bookingsScreenName, parseBookingsPath } from './bookingsPath';
import slipCss from './booking-slip.css?raw';
import slipPageCss from './booking-slip-page.css?raw';

// WHO is shown «Bookings» and WHERE it sits (18 Nov 2026): every role, employees included, hideable from employees by the
// existing «Sections for employees» switch; the sales owner has it, the kitchen owner does not; a venue can switch it off.

const rail = () => within(screen.getByRole('navigation', { name: 'All sections' }));
const linkNames = (scope: { getAllByRole: (role: string) => HTMLElement[] }) => scope.getAllByRole('link').map(link => link.textContent);
const EMPLOYEE = { canManage: false, isOwner: false, role: 'staff' as const };

describe('who is shown «Bookings»', () => {
  it('every role but the kitchen\'s owner, in a venue that said nothing', () => {
    expect(visibleSectionIds({}, true, 'owner').has('bookings')).toBe(true);
    expect(visibleSectionIds({}, true, 'manager').has('bookings')).toBe(true);
    expect(visibleSectionIds({}, false, 'staff').has('bookings')).toBe(true);
    expect(visibleSectionIds({}, true, 'owner-sales').has('bookings')).toBe(true);
    expect(visibleSectionIds({}, true, 'owner-kitchen').has('bookings')).toBe(false);
    expect(visibleSectionIds(null, false, 'staff').has('bookings')).toBe(true);
  });

  it('hidden from employees only by a literal true, and never from whoever runs the place', () => {
    for (const value of [false, 'true', 1, null]) {
      expect(visibleSectionIds({ staffHiddenCards: { bookings: value } }, false, 'staff').has('bookings'), String(value)).toBe(true);
    }
    expect(visibleSectionIds({ staffHiddenCards: { bookings: true } }, false, 'staff').has('bookings')).toBe(false);
    expect(visibleSectionIds({ staffHiddenCards: { bookings: true } }, true, 'owner').has('bookings')).toBe(true);
    expect(visibleSectionIds({ staffHiddenCards: { bookings: true } }, true, 'manager').has('bookings')).toBe(true);
  });

  it('a venue switches it off only with an explicit false under sections.bookings, as the rules\' sectionOn() reads it', () => {
    expect(venueHasSection({ sections: { bookings: false } }, 'bookings')).toBe(false);
    for (const venue of [null, {}, { sections: {} }, { sections: { bookings: true } }, { sections: 'x' }, { sections: { bookings: 'no' } }]) {
      expect(venueHasSection(venue as Record<string, unknown> | null, 'bookings'), JSON.stringify(venue)).toBe(true);
    }
    expect(visibleSectionIds({ sections: { bookings: false } }, true, 'owner').has('bookings')).toBe(false);
    // The other sections are not touched by it.
    expect(visibleSectionIds({ sections: { bookings: false } }, true, 'owner').has('orders')).toBe(true);
  });

  it('is a card of its own, everyday (not a money card), dealt to the sales side', () => {
    const card = STAFF_CARDS.find(c => c.id === 'bookings');
    expect(card).toMatchObject({ section: 'bookings', optIn: false, employeePush: false });
    expect(cardVisibleTo({}, true, 'bookings', 'owner-sales')).toBe(true);
    expect(cardVisibleTo({}, true, 'bookings', 'owner-kitchen')).toBe(false);
  });

  it('an employee of a venue that hides it gets «not available» at its address, and no rail item', async () => {
    renderApp('/bookings', { session: { ...EMPLOYEE, location: { staffHiddenCards: { bookings: true } } } });
    expect(await screen.findByText('This section is not on for you at this venue.')).toBeInTheDocument();
    expect(linkNames(rail())).not.toContain('Bookings');
  });

  it('the owner can hide it from employees in «Sections for employees»', async () => {
    renderApp('/settings/sections');
    await waitFor(() => { expect(screen.getByRole('switch', { name: /^Bookings/ })).toBeInTheDocument(); }, { timeout: 5000 });
  });
});

describe('where «Bookings» sits', () => {
  it('right after the Home in the one list both navigations are built from, under «More» on a phone', () => {
    const ids = SECTIONS.map(section => section.id);
    expect(ids.indexOf('bookings')).toBe(ids.indexOf('home') + 1);
    const { railTop, tabs, more } = arrangeSections(visibleSectionIds({}, false, 'staff'));
    expect(railTop.map(s => s.id)[1]).toBe('bookings');
    expect(tabs.map(s => s.id)).not.toContain('bookings');
    expect(more.map(s => s.id)).toContain('bookings');
  });

  it('is current in the rail on its own screens', async () => {
    renderApp('/bookings');
    await waitFor(() => { expect(rail().getByRole('link', { name: 'Bookings' })).toHaveAttribute('aria-current', 'page'); }, { timeout: 5000 });
  });
});

describe('addresses and the usage names', () => {
  it('reads its addresses', () => {
    expect(parseBookingsPath(undefined)).toEqual({ kind: 'list' });
    expect(parseBookingsPath('new')).toEqual({ kind: 'new' });
    expect(parseBookingsPath('Abc123')).toEqual({ kind: 'booking', id: 'Abc123' });
    expect(parseBookingsPath('Abc123/edit')).toEqual({ kind: 'edit', id: 'Abc123' });
    for (const junk of ['new/edit', 'a/b', 'Abc123/edit/x', 'a-b', '%20']) expect(parseBookingsPath(junk), junk).toEqual({ kind: 'unknown' });
  });

  it('⚠️ names its screens m2:bookings…, never with an id (nothing personal reaches the usage record)', () => {
    expect(screenNameFor('/bookings')).toBe('bookings');
    expect(screenNameFor('/bookings/Abc123')).toBe('bookings-detail');
    expect(screenNameFor('/bookings/new')).toBe('bookings-editor');
    expect(screenNameFor('/bookings/Abc123/edit')).toBe('bookings-editor');
    expect(bookingsScreenName('/junk/x/y')).toBe('bookings');
  });
});

describe('the slips\' stylesheets', () => {
  const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('⚠️ hide everything but the slip only while a slip prints, by a class on <html> — never :has (Chrome 101)', () => {
    expect(code(slipCss)).toMatch(/@media print\s*\{[\s\S]*\.slip-printing body > \*:not\(#bookingSlip\)\s*\{\s*display:\s*none !important;/);
    expect(code(slipCss)).not.toMatch(/:has\(/);
    expect(code(slipCss)).toMatch(/#bookingSlip\s*\{\s*display:\s*none;\s*\}/);
  });

  it('lay the page out for 80 mm receipt paper, in a file switched on only while printing', () => {
    expect(code(slipPageCss)).toMatch(/@page\s*\{\s*size:\s*80mm 297mm;\s*margin:\s*4mm;\s*\}/);
    expect(code(slipCss)).not.toMatch(/@page/);
    expect(code(slipCss)).toMatch(/\.bk-slip\s*\{[^}]*width:\s*72mm;/);
  });

  it('are paper: black on white, no design token', () => {
    expect(code(slipCss)).not.toMatch(/var\(--/);
  });
});
