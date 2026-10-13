import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { fakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import type { FakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import { ago, orderOf, usedOrder } from '../testing/clientOrderFixtures';
import type { TestOrder } from '../testing/clientOrderFixtures';
import { NOW } from '../testing/logFixtures';
import { BRIOCHE, CLIENTS, FOCACCIA, LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// Putting a client's order into the Calculator: look first, say what changes, then write — never silently.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const stored = (key: string) => window.localStorage.getItem(key);
const LOCKED = JSON.stringify({ locked: true, logId: null });

type Options = {
  orders?: TestOrder[];
  config?: Record<string, unknown>;
  orderSource?: FakeClientOrdersSource;
  lang?: 'en' | 'it';
};

// Opens Orders received by its address, with the order(s) on it.
async function open({ orders = [orderOf()], config = configOf(), orderSource, lang = 'en' }: Options = {}) {
  const clientOrders = orderSource ?? fakeClientOrdersSource({ orders });
  const view = renderCalculator('/calculator/orders', {
    source: fakeCalculatorSource({ config }),
    data: { clientOrders: () => clientOrders },
    lang,
  });
  await main().findAllByRole('article', undefined, LOAD);
  return { ...view, clientOrders };
}

const press = (user: { click: (element: Element) => Promise<void> }, name = 'Put in the calculator') =>
  user.click(main().getAllByRole('button', { name })[0]!);

const question = (name: string) => within(screen.getByRole('alertdialog', { name }));

describe('putting an order in', () => {
  it('asks first, then writes every product of the client — the ones the order leaves out as ZERO — and lands on the tab', async () => {
    const view = await open();
    await press(view.user);
    const ask = await screen.findByRole('alertdialog', { name: 'Put Cafe Roma’s order in the calculator?' });
    // Nothing moved before the answer.
    expect(stored('qty-roma::tray')).toBeNull();
    expect(view.clientOrders.applied).toEqual([]);
    expect(within(ask).queryByRole('list')).not.toBeInTheDocument();

    await view.user.click(within(ask).getByRole('button', { name: 'Put it in' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/focaccia'); });
    expect(stored('qty-roma::tray')).toBe('5');
    expect(stored('qty-roma::slab')).toBe('0');
    expect(stored('qty-roma::roll')).toBe('0');
    // A paused product has no box, so nothing is written for it; another client is not touched.
    expect(stored('qty-roma::paused')).toBeNull();
    expect(stored('qty-sole::tray')).toBeNull();
    // The tabs are stamped as used, or the new-work-day sweep would clear the numbers.
    expect(stored('touched-focaccia')).not.toBeNull();
    expect(stored('touched-brioche')).not.toBeNull();
    // The tab shows the number, and the entry of Orders received was REPLACED by the work view.
    expect((await main().findAllByLabelText('Focaccia tray (500g)', undefined, LOAD))[0]).toHaveValue(5);
    expect(view.router.state.historyAction).toBe('REPLACE');
  });

  it('records that the order was used, once the numbers are in, for THIS version of it', async () => {
    const order = orderOf();
    const view = await open({ orders: [order] });
    await press(view.user);
    await view.user.click(await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Put it in' }));
    await waitFor(() => { expect(view.clientOrders.applied).toEqual([{ id: '2026-10-13_roma', appliedFor: order['updatedAt'] }]); });
    // The banner has gone: nothing still needs attention.
    await waitFor(() => { expect(main().queryByRole('link', { name: /received from your clients/ })).not.toBeInTheDocument(); });
  });

  it('lands on the first TAB (in tab order) that received a number', async () => {
    // The order is only for a product on the Brioche tab.
    const config = configOf({ clients: [{
      id: 'roma', name: 'Cafe Roma',
      products: [{ id: 'roll', name: 'Brioche roll', recipeId: 'brioche', weight: 60, kind: 'number', active: true }],
    }] });
    const view = await open({ orders: [orderOf({ quantities: { roll: 12 }, names: { roll: 'Brioche roll' } })], config });
    await press(view.user);
    await view.user.click(await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Put it in' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/brioche'); });
    expect(stored('qty-roma::roll')).toBe('12');
  });

  it('puts the order in the Italian words too', async () => {
    const view = await open({ lang: 'it' });
    await view.user.click(main().getAllByRole('button', { name: 'Metti nel calcolatore' })[0]!);
    const ask = await screen.findByRole('alertdialog', { name: 'Inserire l’ordine di Cafe Roma nel calcolatore?' });
    expect(within(ask).getByRole('button', { name: 'Mettilo dentro' })).toBeInTheDocument();
  });

  describe('a box that already holds a different number', () => {
    it('is listed «product: old → new» in a danger question that names what is at stake', async () => {
      window.localStorage.setItem('qty-roma::tray', '3');
      window.localStorage.setItem('qty-roma::slab', '40');
      const view = await open();
      await press(view.user);
      const ask = question('This will replace what is typed');
      await screen.findByRole('alertdialog', { name: 'This will replace what is typed' });
      expect(ask.getByText('These already have a different number typed in:')).toBeInTheDocument();
      // A list a screen reader can walk through, one row per clash; the box that will be zeroed is among them.
      const rows = ask.getAllByRole('listitem').map(row => row.textContent);
      expect(rows).toEqual(['Focaccia tray:3 → 5', 'Focaccia slab:40 → 0']);
      expect(ask.getByText('Put Cafe Roma’s order in the calculator?')).toBeInTheDocument();
      expect(ask.getByRole('button', { name: 'Put it in' }).className).toContain('danger');
    });

    it('Cancel changes nothing at all', async () => {
      window.localStorage.setItem('qty-roma::tray', '3');
      const view = await open();
      await press(view.user);
      await view.user.click(question('This will replace what is typed').getByRole('button', { name: 'Cancel' }));
      expect(stored('qty-roma::tray')).toBe('3');
      expect(stored('qty-roma::slab')).toBeNull();
      expect(view.clientOrders.applied).toEqual([]);
      expect(pathOf(view)).toBe('/calculator/orders');
    });

    it('OK replaces it', async () => {
      window.localStorage.setItem('qty-roma::tray', '3');
      const view = await open();
      await press(view.user);
      await view.user.click(question('This will replace what is typed').getByRole('button', { name: 'Put it in' }));
      await waitFor(() => { expect(stored('qty-roma::tray')).toBe('5'); });
    });

    it('a box that already holds the SAME number, or nothing, is no clash', async () => {
      window.localStorage.setItem('qty-roma::tray', '5');
      window.localStorage.setItem('qty-roma::slab', '0');
      const view = await open();
      await press(view.user);
      const ask = await screen.findByRole('alertdialog', { name: 'Put Cafe Roma’s order in the calculator?' });
      expect(within(ask).getByRole('button', { name: 'Put it in' }).className).not.toContain('danger');
    });
  });

  describe('a confirmed tab', () => {
    it('is left alone and the question says so, while the other tabs still get their numbers', async () => {
      window.localStorage.setItem('lock-brioche', LOCKED);
      window.localStorage.setItem('qty-roma::roll', '9');
      const view = await open({ orders: [orderOf({ quantities: { tray: 5, roll: 12 }, names: {} })] });
      await press(view.user);
      const ask = question('Put Cafe Roma’s order in the calculator?');
      await screen.findByRole('alertdialog', { name: 'Put Cafe Roma’s order in the calculator?' });
      expect(ask.getByText('Brioche is confirmed and will be left alone.')).toBeInTheDocument();
      await view.user.click(ask.getByRole('button', { name: 'Put it in' }));
      await waitFor(() => { expect(stored('qty-roma::tray')).toBe('5'); });
      // The locked tab holds what it held, and a locked box is no «clash» either.
      expect(stored('qty-roma::roll')).toBe('9');
      expect(stored('touched-brioche')).toBeNull();
      expect(pathOf(view)).toBe('/calculator/focaccia');
    });

    it('says so in the clash question too', async () => {
      window.localStorage.setItem('lock-brioche', LOCKED);
      window.localStorage.setItem('qty-roma::tray', '2');
      const view = await open({ orders: [orderOf({ quantities: { tray: 5, roll: 12 }, names: {} })] });
      await press(view.user);
      const ask = question('This will replace what is typed');
      await screen.findByRole('alertdialog', { name: 'This will replace what is typed' });
      expect(ask.getAllByRole('listitem').map(row => row.textContent)).toEqual(['Focaccia tray:2 → 5']);
      expect(ask.getByText('Brioche is confirmed and will be left alone.')).toBeInTheDocument();
    });

    it('when EVERY tab is confirmed there is only a notice, and nothing is written or recorded', async () => {
      window.localStorage.setItem('lock-focaccia', LOCKED);
      window.localStorage.setItem('lock-brioche', LOCKED);
      const view = await open();
      await press(view.user);
      const notice = await screen.findByRole('alertdialog');
      expect(within(notice).getByText('Focaccia and Brioche have already been confirmed, so the quantities are locked. Tap Edit on the tab first, then put the order in.')).toBeInTheDocument();
      expect(within(notice).queryByRole('button', { name: 'Put it in' })).not.toBeInTheDocument();
      await view.user.click(within(notice).getByRole('button', { name: 'OK' }));
      expect(stored('qty-roma::tray')).toBeNull();
      expect(view.clientOrders.applied).toEqual([]);
      expect(pathOf(view)).toBe('/calculator/orders');
    });

    it('a single confirmed tab is named in the singular', async () => {
      window.localStorage.setItem('lock-focaccia', LOCKED);
      const view = await open({ config: configOf({ clients: [{
        id: 'roma', name: 'Cafe Roma',
        products: [{ id: 'tray', name: 'Focaccia tray', recipeId: 'focaccia', weight: 500, kind: 'number', active: true }],
      }] }) });
      await press(view.user);
      expect(await screen.findByText('Focaccia has already been confirmed, so the quantities are locked. Tap Edit on the tab first, then put the order in.')).toBeInTheDocument();
    });
  });

  describe('nothing to put it in', () => {
    it('a client who is no longer in the address book gets a notice', async () => {
      const view = await open({ orders: [orderOf({ clientId: 'ghost', clientName: 'Ghost Cafe' })] });
      await press(view.user);
      expect(await screen.findByText('Ghost Cafe is no longer in your address book, so there are no fields to fill in.')).toBeInTheDocument();
      expect(view.clientOrders.applied).toEqual([]);
    });

    it('a client whose products are on no visible tab gets a notice', async () => {
      const config = configOf({
        recipes: [FOCACCIA, { ...BRIOCHE, visible: false }],
        clients: [...CLIENTS, { id: 'only', name: 'Only Roll', products: [
          { id: 'roll', name: 'Brioche roll', recipeId: 'brioche', weight: 60, kind: 'number', active: true },
        ] }],
      });
      const view = await open({ orders: [orderOf({ clientId: 'only', quantities: { roll: 3 }, names: {} })], config });
      await press(view.user);
      expect(await screen.findByText('None of this client’s products are on a calculator tab at the moment, so there is nothing to fill in.')).toBeInTheDocument();
      expect(view.clientOrders.applied).toEqual([]);
    });
  });

  describe('when the app cannot record it', () => {
    it('the numbers are in, and the refusal is SAID in an alert that stays until it is dismissed', async () => {
      const orderSource = fakeClientOrdersSource({ orders: [orderOf()] });
      orderSource.refuse.applied = true;
      const view = await open({ orderSource });
      await press(view.user);
      await view.user.click(await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Put it in' }));
      await waitFor(() => { expect(stored('qty-roma::tray')).toBe('5'); });
      const warning = await screen.findByRole('alertdialog');
      expect(within(warning).getByText(/could not record that you used this order/)).toBeInTheDocument();
      expect(within(warning).getByText(/NOT warn you if the client changes it/)).toBeInTheDocument();
      // Not the status line that goes by itself.
      for (const region of document.querySelectorAll('[role="status"]')) expect(region.textContent).not.toMatch(/NOT warn you/);
      await view.user.click(within(warning).getByRole('button', { name: 'OK' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  it('an order used before can be put in again, and still asks first', async () => {
    const view = await open({ orders: [usedOrder({ updatedAt: ago(20) })] });
    await press(view.user, 'Put in the calculator again');
    expect(await screen.findByRole('alertdialog', { name: 'Put Cafe Roma’s order in the calculator?' })).toBeInTheDocument();
  });
});
