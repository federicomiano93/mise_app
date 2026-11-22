import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';

// The settings door of a section is ONE gear on the title's own line (21 Nov 2026, as Orders has it): the old text buttons are gone.

const EMPLOYEE = { role: 'staff', canManage: false, canManageVenue: false, isOwner: false } as const;
const LOAD = { timeout: 10_000 };

describe.each([
  ['/bookings', 'Bookings'],
  ['/cakes', 'Cakes'],
  ['/food-cost', 'Food cost'],
  ['/suppliers', 'Ingredients & suppliers'],
  ['/recipes', 'Recipes'],
  ['/calculator', 'Calculator'],
])('%s', (path, title) => {
  it('has the Settings gear in the header with the title, and no other Settings button', async () => {
    renderApp(path);
    const gear = await screen.findByRole('button', { name: 'Settings' }, LOAD);
    const header = gear.closest('header') as HTMLElement;
    expect(within(header).getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(gear.textContent).toBe('');
    expect(screen.getAllByRole('button', { name: 'Settings' })).toEqual([gear]);
  });
});

describe('who sees the gear', () => {
  it.each([
    ['/recipes', 'Recipes'],
    ['/suppliers', 'Ingredients & suppliers'],
  ])('an employee has none on %s', async (path, title) => {
    renderApp(path, { session: EMPLOYEE });
    // The title of the screen that drew the page's own header (not the loading screen's).
    await waitFor(() => { expect(screen.getByRole('heading', { level: 1, name: title }).closest('header')?.nextElementSibling).toHaveAttribute('role', 'status'); }, LOAD);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});

// On a phone a detail fills the page and has its own Back: the gear is the LIST's. On the split it stays on every view.
describe('the gear on a phone (below the split)', () => {
  it.each([
    ['/recipes/settings', 'Recipes'],
    ['/suppliers/settings', 'Ingredients & suppliers'],
  ])('is not drawn on the Settings view %s', async (path, title) => {
    renderApp(path);
    await screen.findByRole('heading', { level: 1, name: title }, LOAD);
    await screen.findByRole('button', { name: 'Back' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
