import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, configure, screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// The app runs under React's StrictMode in development: every component is mounted, unmounted and mounted again, and every
// effect runs twice. The store is started, stopped and started again by its provider — none of that may double a watcher,
// leave the list empty, say a sentence twice or step back twice.

beforeAll(async () => {
  configure({ reactStrictMode: true });
  await import('./SuppliersSection');
}, 60_000);

afterAll(() => {
  configure({ reactStrictMode: false });
});

const source = () => fakeSuppliersSource({
  suppliers: [supplier('a', { name: 'Aaa' }), supplier('b', { name: 'Bbb' })],
  ingredients: [item('1', { name: 'Anise', supplierId: 'a' })],
});

describe('under StrictMode: Ingredients & suppliers', () => {
  it('draws the lists, opens a supplier and steps back to its row', async () => {
    const { router, user } = renderSuppliers('/suppliers', { source: source() });
    expect(await screen.findByText('Anise', undefined, LOAD)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Suppliers' }));
    await user.click(await screen.findByRole('button', { name: /^Aaa/ }, LOAD));
    expect(await screen.findByRole('heading', { level: 2, name: 'Aaa' }, LOAD)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Aaa' })).getByText('Anise')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/suppliers/suppliers');
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Aaa/ })).toHaveFocus(); });
  });

  it('says a supplier deleted elsewhere once, and steps back once', async () => {
    const fake = source();
    const { router, user } = renderSuppliers('/suppliers/suppliers', { source: fake });
    await user.click(await screen.findByRole('button', { name: /^Bbb/ }, LOAD));
    await screen.findByRole('region', { name: 'Bbb' }, LOAD);
    fake.suppliers.delete('b');
    act(() => { fake.push(); });
    expect(await screen.findByText('This supplier no longer exists.')).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(screen.getAllByText('This supplier no longer exists.')).toHaveLength(1);
    // One step back, not two: the list is the entry behind, and nothing before it was left.
    expect(router.state.location.pathname).toBe('/suppliers/suppliers');
    expect(screen.getByRole('button', { name: /^Aaa/ })).toBeInTheDocument();
  });

  it('stars once', async () => {
    const fake = source();
    const { user } = renderSuppliers('/suppliers/supplier/a', { source: fake });
    const star = await screen.findByRole('button', { name: 'Favourite' }, LOAD);
    await user.click(star);
    expect(fake.writes).toEqual([{ op: 'favourite', id: 'a', on: true }]);
  });

  it('writes a new supplier once, and puts the focus on «New supplier»', async () => {
    const fake = source();
    const { router, user } = renderSuppliers('/suppliers/suppliers', { source: fake });
    await user.click(await screen.findByRole('button', { name: 'New supplier' }, LOAD));
    const card = within(await screen.findByRole('region', { name: 'New supplier' }, LOAD));
    await user.type(card.getByRole('textbox', { name: 'Name on invoices' }), 'Rossi');
    await user.click(card.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save supplier?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(fake.writes).toHaveLength(1);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'New supplier' })).toHaveFocus(); });
  });

  it('opens the card from «Edit», and brings the focus back to «Edit» from Back', async () => {
    const { router, user } = renderSuppliers('/suppliers/suppliers', { source: source() });
    await user.click(await screen.findByRole('button', { name: /^Aaa/ }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Edit' }, LOAD));
    const card = within(await screen.findByRole('region', { name: 'Edit supplier' }, LOAD));
    await user.click(card.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/supplier/a'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus(); });
  });

  it('deletes once, says it once and steps back once', async () => {
    const fake = source();
    const { router, user } = renderSuppliers('/suppliers/suppliers', { source: fake });
    await user.click(await screen.findByRole('button', { name: /^Bbb/ }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Delete “Bbb”' }, LOAD));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Delete this supplier?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    expect(fake.writes).toEqual([{ op: 'delete', id: 'b' }]);
    expect(screen.getAllByText('Supplier deleted.')).toHaveLength(1);
    expect(screen.queryByText('This supplier no longer exists.')).not.toBeInTheDocument();
  });

  it('calls a panel switch once', async () => {
    const fake = source();
    const { user } = renderSuppliers('/suppliers/settings', { source: fake });
    const region = within(await screen.findByRole('region', { name: 'Settings' }, LOAD));
    await user.click(region.getByRole('switch', { name: 'Track nutrition' }));
    await waitFor(() => { expect(fake.panelCalls).toEqual([{ key: 'showNutrition', on: false }]); });
  });
});
