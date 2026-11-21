import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { editorSource } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost, split } from '../testing/renderFoodcost';

// «Finished products | Semi-finished» (21 Nov 2026): two tabs under «New product» and «Categories», the list below showing the chosen kind
// only. Fake data only.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const gram = (qty: number) => ({ kind: 'ingredient', ingredientId: 'flour', qty, unit: 'g' });
const semi = (name: string) => product(name, { kind: 'semi', model: 4, components: [gram(1000)], sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null });
const finished = (name: string) => product(name, { kind: 'finished', model: 4, components: [gram(500)] });

const GANACHE = semi('Ganache');
const GRAIN = semi('Grain paste');
const BUN = finished('Bun');
const GANACHE_TART = finished('Ganache tart');
// A cake's card carries `cake-` in its id: it is a finished product wherever its `kind` says it sits.
const CAKE_CARD = product('cake-abc', { name: 'Birthday cake', kind: 'semi', model: 4, components: [gram(500)] });

async function listed(products: ReturnType<typeof product>[], path = '/food-cost') {
  const view = renderFoodcost(path, { source: editorSource(products, { categories: [], settings: { labourCostPerHour: 12 } }) });
  await screen.findByRole('button', { name: 'New product' }, LOAD);
  await screen.findAllByRole('tab', undefined, LOAD);
  return view;
}
const tab = (name: string) => screen.getByRole('tab', { name });
const rowOf = (name: RegExp) => screen.queryByRole('button', { name });

describe('the two tabs', () => {
  it('start on «Finished products», in a tablist of their own, and show only that kind', async () => {
    await listed([GANACHE, BUN, GRAIN, GANACHE_TART]);
    expect(screen.getByRole('tablist', { name: 'Kind of card' })).toBeInTheDocument();
    expect(tab('Finished products')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Semi-finished')).toHaveAttribute('aria-selected', 'false');
    expect(rowOf(/^Bun/)).toBeInTheDocument();
    expect(rowOf(/^Ganache tart/)).toBeInTheDocument();
    expect(rowOf(/^Ganache(?! tart)/)).not.toBeInTheDocument();
    expect(rowOf(/^Grain paste/)).not.toBeInTheDocument();
  });

  it('a tap on «Semi-finished» shows the semi-finished cards instead', async () => {
    const { user } = await listed([GANACHE, BUN, GRAIN]);
    await user.click(tab('Semi-finished'));
    expect(tab('Semi-finished')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(/^Ganache/)).toBeInTheDocument();
    expect(rowOf(/^Grain paste/)).toBeInTheDocument();
    expect(rowOf(/^Bun/)).not.toBeInTheDocument();
  });

  it('a cake\'s card is a finished product, whatever kind it carries', async () => {
    const { user } = await listed([CAKE_CARD, GANACHE]);
    expect(rowOf(/^Birthday cake/)).toBeInTheDocument();
    await user.click(tab('Semi-finished'));
    expect(rowOf(/^Birthday cake/)).not.toBeInTheDocument();
    expect(rowOf(/^Ganache/)).toBeInTheDocument();
  });

  it('arrows, Home and End move the choice and the focus, with a roving tab stop', async () => {
    const { user } = await listed([GANACHE, BUN]);
    expect(tab('Finished products')).toHaveAttribute('tabindex', '0');
    expect(tab('Semi-finished')).toHaveAttribute('tabindex', '-1');
    tab('Finished products').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Semi-finished')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Semi-finished')).toHaveFocus();
    expect(tab('Semi-finished')).toHaveAttribute('tabindex', '0');
    await user.keyboard('{Home}');
    expect(tab('Finished products')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Finished products')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Semi-finished')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Finished products')).toHaveAttribute('aria-selected', 'true');
  });

  it('the chosen tab controls a tabpanel named by it', async () => {
    await listed([GANACHE, BUN]);
    const panel = screen.getByRole('tabpanel', { name: 'Finished products' });
    expect(tab('Finished products')).toHaveAttribute('aria-controls', panel.id);
  });

  it('is in Italian in an Italian venue', async () => {
    renderFoodcost('/food-cost', { lang: 'it', source: editorSource([GANACHE, BUN], { categories: [], settings: {} }) });
    expect(await screen.findByRole('tab', { name: 'Prodotti finiti' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Semilavorati' })).toBeInTheDocument();
  });

  it('does not store the choice: a new visit starts on «Finished products» again', async () => {
    const first = await listed([GANACHE, BUN]);
    const before = JSON.stringify({ ...window.localStorage });
    await first.user.click(tab('Semi-finished'));
    expect(JSON.stringify({ ...window.localStorage })).toBe(before);
    cleanup();
    await listed([GANACHE, BUN]);
    expect(tab('Finished products')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the search', () => {
  it('is emptied when the tab changes', async () => {
    const { user } = await listed([GANACHE, BUN, GRAIN]);
    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'bu');
    expect(screen.getByRole('searchbox', { name: 'Search products' })).toHaveValue('bu');
    await user.click(tab('Semi-finished'));
    expect(screen.getByRole('searchbox', { name: 'Search products' })).toHaveValue('');
    expect(rowOf(/^Grain paste/)).toBeInTheDocument();
  });

  it('with no match here but matches in the other tab, says how many there', async () => {
    const { user } = await listed([GANACHE, GRAIN, BUN, semi('Ganache dark')]);
    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'gan');
    expect(await screen.findByText('No finished product with “gan” · 2 among the semi-finished')).toBeInTheDocument();
    await user.click(tab('Semi-finished'));
    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'bun');
    expect(await screen.findByText('No semi-finished card with “bun” · 1 among the finished products')).toBeInTheDocument();
  });

  it('with no match in either tab keeps the plain «no name contains» line', async () => {
    const { user } = await listed([GANACHE, BUN]);
    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'zzz');
    expect(await screen.findByText('No product name contains “zzz”.')).toBeInTheDocument();
  });

  it('says the other tab\'s count in Italian', async () => {
    const view = renderFoodcost('/food-cost', { lang: 'it', source: editorSource([GANACHE, GRAIN, BUN], { categories: [], settings: {} }) });
    await screen.findByRole('tab', { name: 'Prodotti finiti' }, LOAD);
    await view.user.type(screen.getByRole('searchbox'), 'gan');
    expect(await screen.findByText('Nessun prodotto finito con “gan” · 1 tra i semilavorati')).toBeInTheDocument();
  });
});

describe('an empty tab', () => {
  it('says so in one line when the venue has no semi-finished card', async () => {
    const { user } = await listed([BUN]);
    await user.click(tab('Semi-finished'));
    expect(screen.getByText('No semi-finished card yet')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('says so when the venue has only semi-finished cards', async () => {
    await listed([GANACHE]);
    expect(screen.getByText('No finished product yet')).toBeInTheDocument();
  });
});

describe('a card of the other kind opened', () => {
  it('moves the tab to its kind, so Back finds its row', async () => {
    split();
    await listed([GANACHE, BUN], '/food-cost/product/Ganache');
    expect(tab('Semi-finished')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: /^Ganache/ }, LOAD)).toBeInTheDocument();
  });

  it('a card of the same kind leaves the tab alone', async () => {
    split();
    await listed([GANACHE, BUN], '/food-cost/product/Bun');
    expect(tab('Finished products')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('«New product»', () => {
  it('from «Finished products» opens a new finished product', async () => {
    split();
    const { user } = await listed([GANACHE, BUN]);
    await user.click(screen.getByRole('button', { name: 'New product' }));
    const kind = await screen.findByRole('radio', { name: 'Finished product' }, LOAD);
    expect(kind).toBeChecked();
  });

  it('from «Semi-finished» opens a new card already set to semi-finished, still editable', async () => {
    split();
    const { user } = await listed([GANACHE, BUN]);
    await user.click(tab('Semi-finished'));
    await user.click(screen.getByRole('button', { name: 'New product' }));
    const region = await screen.findByRole('region', { name: 'Product' }, LOAD);
    expect(within(region).getByRole('radio', { name: 'Semi-finished' })).toBeChecked();
    await user.click(within(region).getByRole('radio', { name: 'Finished product' }));
    expect(within(region).getByRole('radio', { name: 'Finished product' })).toBeChecked();
  });
});

describe('the list narrowed to a recipe (?using=)', () => {
  const usingRecipe = (name: string, kind: 'finished' | 'semi') => product(name, {
    kind, model: 4, components: [{ kind: 'recipe', recipeId: 'dough', qtyKg: 1 }],
    ...(kind === 'semi' ? { sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null } : {}),
  });

  it('starts on «Finished products» when it has any', async () => {
    await listed([usingRecipe('Loaf', 'finished'), usingRecipe('Starter', 'semi')], '/food-cost?using=dough');
    expect(tab('Finished products')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(/^Loaf/)).toBeInTheDocument();
  });

  it('starts on «Semi-finished» when it has no finished product', async () => {
    await listed([usingRecipe('Starter', 'semi'), BUN], '/food-cost?using=dough');
    expect(tab('Semi-finished')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: /^Starter/ }, LOAD)).toBeInTheDocument();
  });
});

describe('the tabs on a venue with nothing yet', () => {
  it('are not drawn with no card at all: the «No products yet» box stands alone', async () => {
    renderFoodcost('/food-cost', { source: editorSource([], { categories: [], settings: {} }) });
    expect(await screen.findByText('No products yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});
