import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { FLOUR, FLOUR_PRICES, LOAD } from '../testing/renderFoodcost';
import { SPONGE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';

// «New cake» asks «How do you want to start?»: a standard cake takes the venue's reference grams, one from scratch takes none, so every
// line needs its grams typed. Only a NEW cake asks. Cancel and Escape stay on the list.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const foodcost = () => fakeFoodcostSource({ products: [SPONGE], ingredients: [FLOUR], prices: FLOUR_PRICES });

const openList = async (options: { reference?: boolean; lang?: 'en' | 'it' } = {}) => {
  const { reference = true, lang } = options;
  const view = renderCakes('/cakes', {
    cakes: fakeCakesSource({ cakes: [cakeDoc('c1', 'Sacher', { discs: 2 })], reference: reference ? storedReference() : null }),
    foodcost: foodcost(),
    ...(lang ? { lang } : {}),
  });
  await screen.findByRole('button', { name: lang === 'it' ? 'Nuova torta' : 'New cake' }, LOAD);
  return view;
};
const ask = async (user: Awaited<ReturnType<typeof openList>>['user']) => {
  await user.click(screen.getByRole('button', { name: 'New cake' }));
  return within(await screen.findByRole('dialog'));
};

describe('the start dialog', () => {
  it('asks «How do you want to start?» with two choices, each a title and one short line', async () => {
    const { user } = await openList();
    const dialog = await ask(user);
    expect(dialog.getByRole('heading', { name: 'How do you want to start?' })).toBeInTheDocument();
    const standard = dialog.getByRole('button', { name: /^Standard cake/ });
    expect(standard).toHaveTextContent('ready-made grams, change them whenever you like');
    const zero = dialog.getByRole('button', { name: /^From scratch/ });
    expect(zero).toHaveTextContent('you write the grams of every part');
  });

  it('is in Italian in an Italian venue', async () => {
    const { user } = await openList({ lang: 'it' });
    await user.click(screen.getByRole('button', { name: 'Nuova torta' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('heading', { name: 'Come vuoi partire?' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /^Torta standard/ })).toHaveTextContent('grammi già pronti, li cambi quando vuoi');
    expect(dialog.getByRole('button', { name: /^Da zero/ })).toHaveTextContent('scrivi tu i grammi di ogni parte');
    expect(dialog.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
  });

  it('Cancel stays on the list and opens nothing', async () => {
    const { user, router } = await openList();
    const dialog = await ask(user);
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/cakes');
  });

  it('Escape does the same', async () => {
    const { user, router } = await openList();
    await ask(user);
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/cakes');
    expect(screen.getByRole('button', { name: 'New cake' })).toBeInTheDocument();
  });

  it('a saved cake never shows it', async () => {
    const { user, router } = await openList();
    await user.click(screen.getByRole('button', { name: /^Sacher/ }));
    expect(router.state.location.pathname).toBe('/cakes/c1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('a standard cake', () => {
  it('takes the venue’s reference grams: its lines follow the rule, shown as the placeholder', async () => {
    const { user } = await openList();
    await user.click((await ask(user)).getByRole('button', { name: /^Standard cake/ }));
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    await user.click(screen.getByRole('combobox', { name: 'Search a recipe for Base' }));
    await user.click(await screen.findByRole('option', { name: /Sponge/ }, LOAD));
    const grams = await screen.findByRole('textbox', { name: 'Sponge: grams' });
    // A new cake is 20 cm with 3 discs, on the venue's reference: the rule gives a figure.
    expect(Number(grams.getAttribute('placeholder'))).toBeGreaterThan(0);
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.queryByText('There is no standard cake yet, so every line needs its grams typed by hand.')).not.toBeInTheDocument();
  });

  it('with no reference grams anywhere still works as before: the band says to fill in the standard cake', async () => {
    const { user } = await openList({ reference: false });
    await user.click((await ask(user)).getByRole('button', { name: /^Standard cake/ }));
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    expect(screen.getByText('There is no standard cake yet, so every line needs its grams typed by hand.')).toBeInTheDocument();
  });
});

describe('a cake from scratch', () => {
  const start = async () => {
    const view = await openList();
    await view.user.click((await ask(view.user)).getByRole('button', { name: /^From scratch/ }));
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    return view;
  };

  it('starts with no reference grams, so a line has no rule to follow: its grams are to be typed', async () => {
    const { user } = await start();
    await user.click(screen.getByRole('combobox', { name: 'Search a recipe for Base' }));
    await user.click(await screen.findByRole('option', { name: /Sponge/ }, LOAD));
    const grams = await screen.findByRole('textbox', { name: 'Sponge: grams' });
    expect(grams).toHaveAttribute('placeholder', '0');
    expect(screen.getByText('type the grams')).toBeInTheDocument();
    expect(screen.getByText('type the grams by hand')).toBeInTheDocument();
    expect(screen.getByText('you type the grams of every part')).toBeInTheDocument();
    // The cost step says the cost is incomplete until they are.
    await user.click(screen.getByRole('button', { name: /^Cost and price/ }));
    expect(screen.getByText('1 line without grams: type the grams or fill in the standard cake in Settings.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Base/ }));
    await user.type(await screen.findByRole('textbox', { name: 'Sponge: grams' }), '500');
    await user.click(screen.getByRole('button', { name: /^Cost and price/ }));
    expect(screen.queryByText(/1 line without grams/)).not.toBeInTheDocument();
  });

  it('keeps quiet about the venue’s reference grams: the person chose to ignore them', async () => {
    await start();
    expect(screen.queryByText('The standard cake has changed since this cake was made.')).not.toBeInTheDocument();
    expect(screen.queryByText('There is no standard cake yet, so every line needs its grams typed by hand.')).not.toBeInTheDocument();
  });

  it('saves with no reference grams of its own', async () => {
    const { user, foodcost: written } = await start();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Da zero');
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(written.saved).toHaveLength(1); });
    const data = (written.saved[0]?.companion as { data: Record<string, unknown> }).data;
    expect(data.ref).toBeNull();
  });
});
