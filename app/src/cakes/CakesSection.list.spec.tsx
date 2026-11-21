import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { cakeDoc, incompleteCake, renderCakes } from '../testing/renderCakes';
import { LOAD } from '../testing/renderFoodcost';

// The Cakes list: the rows and their costs (complete and incomplete), the search, the empty state, and how the section moves — one level
// at a time at EVERY width (the split from 1280px is gone, his call of 21 Nov 2026). The maths is in shared/src/cake-model.spec.ts; fake data only.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const SACHER = cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2 });
const WEDDING = cakeDoc('c2', 'Compleanno a due piani', { diameterCm: 20, tiers: 2, discs: 2 });
const HALF = incompleteCake('c3', 'Cassata');

const open = async (cakes = [SACHER, WEDDING, HALF], options = {}) => {
  const view = renderCakes('/cakes', { cakes: fakeCakesSource({ cakes }), ...options });
  await screen.findByRole('button', { name: 'New cake' }, LOAD);
  return view;
};
const rowsOf = () => within(screen.getByRole('list')).getAllByRole('listitem');

describe('the list', () => {
  it('draws one row per cake by name, under «On the price list · N»', async () => {
    await open();
    expect(await screen.findByRole('heading', { level: 2, name: 'On the price list · 3' }, LOAD)).toBeInTheDocument();
    expect(rowsOf().map(row => within(row).getByText(/^(Cassata|Sacher|Compleanno a due piani)$/).textContent))
      .toEqual(['Cassata', 'Compleanno a due piani', 'Sacher']);
  });

  it('puts «tiers · Ø · discs» under the name, the tiers only from two up', async () => {
    await open();
    const sacher = (await screen.findByRole('button', { name: /^Sacher/ }, LOAD));
    expect(within(sacher).getByText('Ø 22 · 2 discs')).toBeInTheDocument();
    const wedding = screen.getByRole('button', { name: /^Compleanno/ });
    expect(within(wedding).getByText('2 tiers · Ø 20 · 2 discs')).toBeInTheDocument();
  });

  it('shows the food cost of a complete cake with the light and its word', async () => {
    await open();
    const sacher = await screen.findByRole('button', { name: /^Sacher/ }, LOAD);
    expect(within(sacher).getByText('20.00%')).toBeInTheDocument();
    expect(within(sacher).getByText('On target')).toBeInTheDocument();
    expect(within(sacher).getByText('On target').className).not.toMatch(/srOnly/);
  });

  it('shows «?» and «cost incomplete» for a cake with a card that has no price, never a percentage', async () => {
    await open();
    const half = await screen.findByRole('button', { name: /^Cassata/ }, LOAD);
    expect(within(half).getByText('?')).toBeInTheDocument();
    expect(within(half).getByText('Ø 20 · 2 discs · cost incomplete')).toBeInTheDocument();
    expect(within(half).getByText('Food cost not known yet')).toBeInTheDocument();
    expect(within(half).queryByText(/%/)).not.toBeInTheDocument();
  });

  it('says it in Italian: «2 piani · Ø 20 · 2 dischi», «A listino · 3», «Impostazioni»', async () => {
    renderCakes('/cakes', { lang: 'it', cakes: fakeCakesSource({ cakes: [SACHER, WEDDING, HALF] }) });
    expect(await screen.findByRole('heading', { level: 2, name: 'A listino · 3' }, LOAD)).toBeInTheDocument();
    expect(screen.getByText('2 piani · Ø 20 · 2 dischi')).toBeInTheDocument();
    expect(screen.getByText('Ø 20 · 2 dischi · costo incompleto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuova torta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Impostazioni' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Cerca una torta' })).toBeInTheDocument();
  });

  it('waits for the cakes: nothing is drawn as «no cakes» before they have arrived', async () => {
    const source = fakeCakesSource({ cakes: [SACHER] });
    source.hold();
    renderCakes('/cakes', { cakes: source });
    expect(await screen.findByText('Loading the cakes…', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('No cakes yet')).not.toBeInTheDocument();
  });
});

describe('the search', () => {
  it('narrows the rows by name, ignoring case and accents, and says so when nothing matches', async () => {
    const { user } = await open();
    await screen.findByRole('button', { name: /^Sacher/ }, LOAD);
    const box = screen.getByRole('searchbox', { name: 'Search a cake' });
    await user.type(box, 'SACH');
    expect(rowsOf()).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'On the price list · 1' })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText('No cake name contains “zzz”.')).toBeInTheDocument();
    await user.clear(box);
    expect(rowsOf()).toHaveLength(3);
  });
});

describe('with no cakes', () => {
  it('says only «No cakes yet»: ONE «New cake» button, no sub-line, no search box, no «Choose a cake» prompt', async () => {
    await open([]);
    expect(await screen.findByText('No cakes yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New cake' })).toHaveLength(1);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose a cake')).not.toBeInTheDocument();
    expect(screen.queryByText(/Create the first one|Pick a cake/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});

describe('moving about', () => {
  it('a cake opens one level down over the whole page: the list is not beside it, and Back returns to the list', async () => {
    const { user, router } = await open();
    expect(screen.queryByText('Choose a cake')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /^Sacher/ }, LOAD));
    expect(router.state.location.pathname).toBe('/cakes/c1');
    expect(router.state.historyAction).toBe('PUSH');
    expect(await screen.findByRole('heading', { level: 2, name: 'Sacher' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 3, name: /^Parts of the cake/ }, LOAD)).toBeInTheDocument();
    // The list is only behind it (hidden by the stylesheet): the layout is on its detail view, at any width.
    expect(document.querySelector('[data-view="detail"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/cakes');
    expect(screen.getByRole('button', { name: /^Sacher/ })).toHaveFocus();
  });

  it('a cake opens one level down (a PUSH), and Back steps up with the focus on the row that opened it', async () => {
    const { user, router } = await open();
    const row = await screen.findByRole('button', { name: /^Sacher/ }, LOAD);
    await user.click(row);
    expect(router.state.location.pathname).toBe('/cakes/c1');
    expect(router.state.historyAction).toBe('PUSH');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/cakes');
    expect(screen.getByRole('button', { name: /^Sacher/ })).toHaveFocus();
  });

  it('«New cake» opens a new cake, and Back hands the focus back to «New cake»', async () => {
    const { user, router } = await open();
    await user.click(screen.getByRole('button', { name: 'New cake' }));
    expect(router.state.location.pathname).toBe('/cakes/new');
    expect(await screen.findByRole('heading', { level: 2, name: 'New cake' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/cakes');
    expect(screen.getByRole('button', { name: 'New cake' })).toHaveFocus();
  });

  it('«Settings» at the foot of the list opens the reference screen', async () => {
    const { user, router } = await open();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(router.state.location.pathname).toBe('/cakes/reference');
  });

  it('an address that is not one of Cakes\' own reads as the list', async () => {
    renderCakes('/cakes/a/b/c', { cakes: fakeCakesSource({ cakes: [SACHER] }) });
    expect(await screen.findByRole('button', { name: /^Sacher/ }, LOAD)).toBeInTheDocument();
  });
});

describe('who sees it', () => {
  it('an employee of a venue that shows them Food cost sees the cakes and the Settings button', async () => {
    renderCakes('/cakes', {
      cakes: fakeCakesSource({ cakes: [SACHER] }),
      session: { canManage: false, isOwner: false, role: 'staff', location: { staffShownCards: { foodcost: true } } },
    });
    expect(await screen.findByRole('button', { name: /^Sacher/ }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});
