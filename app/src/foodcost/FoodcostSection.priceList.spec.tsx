import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { screenNameFor } from '../shell/sections';
import { EMPLOYEE, LOAD, bareProduct, product, renderFoodcost, sourceWith } from '../testing/renderFoodcost';
import { parseFoodcostPath, resolveFoodcostPath } from './foodcostPath';

// «Listino prenotazioni» (bookings step 2): the owner ticks the products the counter may book and publishes them — names and
// selling prices only. Nothing reaches the counter until «Publish»; a price changed since is marked; leaving unpublished asks.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const products = () => [
  product('Focaccia', { sellingMode: 'weight', sellingPrice: 12, vatRate: 10, foodCostTarget: 30 }),
  product('Panettone', { sellingPrice: 25 }),
  product('Grissini', { sellingMode: 'pack', packSize: 250, packUnit: 'g', sellingPrice: 3.5 }),
  // No selling price: cannot be on the list.
  bareProduct('Torta'),
];

const row = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) });
const question = (name: string) => screen.findByRole('alertdialog', { name }, LOAD);

async function open(fake = sourceWith(products()), options: { lang?: 'en' | 'it' } = {}) {
  const view = renderFoodcost('/food-cost/price-list', { source: fake, ...options });
  await screen.findByRole('heading', { level: 2, name: options.lang === 'it' ? 'Listino prenotazioni' : 'Bookings price list' }, LOAD);
  return { ...view, fake };
}

describe('the bookings price list in Food cost', () => {
  it('lists the priced products A→Z with what each price is for; none ticked before the first publish', async () => {
    await open();
    const names = screen.getAllByRole('checkbox').map(box => box.closest('label')?.textContent);
    expect(names).toEqual(['Focaccia£12.00 per kg', 'Grissini£3.50 per pack (250 g)', 'Panettone£25.00 each']);
    expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText('Never published: the counter has no price list yet.')).toBeInTheDocument();
    expect(screen.getByText('1 product has no selling price or no way of selling it, so it is not listed.')).toBeInTheDocument();
  });

  it('⚠️ publishes only the ticked products, names and prices — never a cost, a margin or a VAT rate', async () => {
    const { user, fake } = await open();
    await user.click(row('Focaccia'));
    await user.click(row('Grissini'));
    expect(screen.getByText('Not published yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const ask = await question('Publish the price list?');
    expect(ask).toHaveTextContent('The counter will see 2 products at these prices.');
    await user.click(within(ask).getByRole('button', { name: 'Publish' }));
    await waitFor(() => { expect(fake.publishPriceList).toHaveBeenCalledTimes(1); });
    // Published: nothing is unsaved any more, so leaving would ask nothing.
    expect(vi.mocked(fake.publishPriceList).mock.calls[0]?.[0]).toEqual([
      { productId: 'Focaccia', name: 'Focaccia', price: 12, per: 'kg' },
      { productId: 'Grissini', name: 'Grissini', price: 3.5, per: 'pack', packSize: 250, packUnit: 'g' },
    ]);
    expect(await screen.findByText('Price list published ✓')).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByText('Not published yet')).toBeNull(); });
    expect(screen.getByText(/^Published on .* · 2 products$/)).toBeInTheDocument();
  });

  it('starts from what is published, and marks a product whose price changed since', async () => {
    const fake = sourceWith(products(), { priceList: { items: [{ productId: 'Panettone', name: 'Panettone', price: 22, per: 'piece' }] } });
    await open(fake);
    expect(row('Panettone')).toBeChecked();
    expect(row('Focaccia')).not.toBeChecked();
    expect(screen.getByText('Changed since publishing (the counter still sees £22.00)')).toBeInTheDocument();
    // A changed price is something to publish.
    expect(screen.getByText('Not published yet')).toBeInTheDocument();
  });

  it('⚠️ waits for the server: a phone with no copy, offline, is never offered an empty list to publish over the real one', async () => {
    const fake = sourceWith(products(), { priceList: { items: [{ productId: 'Panettone', name: 'Panettone', price: 25, per: 'piece' }] } });
    fake.holdPriceList();
    renderFoodcost('/food-cost/price-list', { source: fake });
    expect(await screen.findByText('Waiting for the published list from the server — this needs a connection.', {}, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fake.releasePriceList();
    expect(await screen.findByRole('checkbox', { name: /^Panettone/ })).toBeChecked();
  });

  it('a price changed elsewhere is to publish, but leaving loses nothing, so it does not ask', async () => {
    const fake = sourceWith(products(), { priceList: { items: [{ productId: 'Panettone', name: 'Panettone', price: 22, per: 'piece' }] } });
    const { user, router } = await open(fake);
    expect(screen.getByText('Not published yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('refuses to publish two ticked products of the same name', async () => {
    const fake = sourceWith([...products(), product('Focaccia piece', { name: 'Focaccia', sellingPrice: 2.5 })]);
    const { user } = await open(fake);
    for (const box of screen.getAllByRole('checkbox', { name: /^Focaccia/ })) await user.click(box);
    expect(screen.getAllByText(/Two ticked products share the name «Focaccia»/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fake.publishPriceList).not.toHaveBeenCalled();
  });

  it('says when a published product no longer has a price', async () => {
    const fake = sourceWith(products(), { priceList: { items: [{ productId: 'Torta', name: 'Torta', price: 30, per: 'piece' }] } });
    await open(fake);
    expect(screen.getByText('1 product on the published list no longer has a selling price: the next publish leaves it out.')).toBeInTheDocument();
  });

  it('⚠️ leaving with ticks not published asks first', async () => {
    const { user, router } = await open();
    await user.click(row('Focaccia'));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await question('Discard changes?')).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/food-cost/price-list');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await question('Discard changes?')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); });
  });

  it('a refused publish is said', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = sourceWith(products());
    fake.refuse.publish = true;
    const { user } = await open(fake);
    await user.click(row('Panettone'));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(within(await question('Publish the price list?')).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('The price list was not published — check your connection.')).toBeInTheDocument();
  });

  it('is opened from the list by whoever runs the place, and the focus comes back to its button', async () => {
    const { user } = renderFoodcost('/food-cost', { source: sourceWith(products()) });
    await user.click(await screen.findByRole('button', { name: 'Bookings price list' }, LOAD));
    await screen.findByRole('heading', { level: 2, name: 'Bookings price list' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Bookings price list' })).toHaveFocus(); });
  });

  it('an employee shown Food cost has no door to it, and its address sends them to the list', async () => {
    const { router } = renderFoodcost('/food-cost/price-list', { source: sourceWith(products()), session: EMPLOYEE });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); }, LOAD);
    expect(screen.queryByRole('button', { name: 'Bookings price list' })).toBeNull();
  });

  it('in Italian', async () => {
    await open(undefined, { lang: 'it' });
    expect(screen.getByRole('heading', { level: 2, name: 'Listino prenotazioni' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pubblica' })).toBeInTheDocument();
    expect(screen.getByText(/Il banco vede solo il nome e il prezzo di vendita \(IVA inclusa\), mai costi o margini\./)).toBeInTheDocument();
  });

  it('has its own address and usage name', () => {
    expect(parseFoodcostPath('price-list')).toEqual({ kind: 'priceList' });
    expect(resolveFoodcostPath('price-list', '?recipe=r1')).toEqual({ view: { kind: 'priceList' }, origin: { recipe: null, using: null } });
    expect(screenNameFor('/food-cost/price-list')).toBe('foodcost-price-list');
  });
});
