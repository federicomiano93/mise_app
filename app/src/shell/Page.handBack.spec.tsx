import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { renderOrders, LOAD as ORDERS_LOAD } from '../testing/renderOrders';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// THE SINGLE BAR (22 Nov 2026): from 700px the settings gear is in the top bar, not the page. Back from a section's settings must still hand the
// focus to it (SETTINGS_OPENER), wherever it is drawn. The window is stubbed as 700px wide and under 1000px: the bar, with no split.
beforeAll(async () => { await import('../orders/OrdersSection'); await import('../recipes/RecipesSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

function wideWindow(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 700px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('Back from the settings, with the gear in the top bar', () => {
  it('Orders: the gear is in the bar, and Back from the settings puts the focus on it', async () => {
    wideWindow();
    const { user } = renderOrders('/orders');
    const gear = await screen.findByRole('button', { name: 'Orders settings' }, ORDERS_LOAD);
    expect(gear.closest('header')).toContainElement(screen.getByRole('heading', { level: 1, name: 'Orders' }));
    await user.click(gear);
    const region = await screen.findByRole('region', { name: 'Settings' });
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Orders settings' })).toHaveFocus(); });
    expect(screen.getByRole('button', { name: 'Orders settings' }).closest('header')).not.toBeNull();
  });

  it('Recipes: the same', async () => {
    wideWindow();
    const { user } = renderRecipes('/recipes', { source: fakeRecipesSource({ recipes: [recipe('r1')] }), session: { location: { country: 'GB' } } });
    const gear = await screen.findByRole('button', { name: 'Settings' }, LOAD);
    expect(gear.closest('header')).toContainElement(screen.getByRole('heading', { level: 1, name: 'Recipes' }));
    await user.click(gear);
    const region = await screen.findByRole('region', { name: 'Settings' });
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus(); });
    expect(screen.getByRole('button', { name: 'Settings' }).closest('header')).not.toBeNull();
  });
});
