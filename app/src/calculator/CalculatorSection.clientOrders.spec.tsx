import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { fakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import type { FakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import { ago, changedOrder, orderOf, usedOrder } from '../testing/clientOrderFixtures';
import type { TestOrder } from '../testing/clientOrderFixtures';
import { NOW } from '../testing/logFixtures';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The clients' own orders, the bakery's side: the Client orders door beside the others, the banner above the tabs, and the
// Orders received screen with its cards. Putting an order into the Calculator is in ...clientOrdersApply.spec.tsx and the
// history in ...clientOrdersHistory.spec.tsx.

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
// A date as the screen writes it in English (the same Intl call, so the test does not guess at the punctuation).
const full = (y: number, m: number, d: number, locale = 'en-GB') =>
  new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

type Options = {
  orders?: TestOrder[];
  config?: Record<string, unknown> | null;
  orderSource?: FakeClientOrdersSource;
  lang?: 'en' | 'it';
  cutoff?: string | null;
};

function open(path: string, { orders = [], config = configOf(), orderSource, lang = 'en', cutoff }: Options = {}) {
  const clientOrders = orderSource ?? fakeClientOrdersSource({ orders, ...(cutoff === undefined ? {} : { cutoff }) });
  const view = renderCalculator(path, {
    source: fakeCalculatorSource({ config }),
    lang,
    data: { clientOrders: () => clientOrders },
  });
  return { ...view, clientOrders };
}

const banner = () => main().queryByRole('link', { name: /orders? (received|have CHANGED)|ordin[ei] (ricevut|sono CAMBIATI|è CAMBIATO)/ });

describe('the Client orders door', () => {
  it('sits beside the other doors, and opens Orders received one level down; Back gives the focus back to it', async () => {
    const view = open('/calculator');
    await view.user.click(await main().findByRole('button', { name: 'Client orders' }, LOAD));
    expect(pathOf(view)).toBe('/calculator/orders');
    expect(await main().findByRole('heading', { level: 2, name: 'Orders received' }, LOAD)).toBeInTheDocument();
    // One h1 for the whole screen: the section's name.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator'); });
    expect(await main().findByRole('button', { name: 'Client orders' })).toHaveFocus();
  });

  it('is there with the tabs of any recipe, and in the empty states that show doors', async () => {
    open('/calculator/brioche');
    expect(await main().findByRole('button', { name: 'Client orders' }, LOAD)).toBeInTheDocument();
  });

  it('is on the «No recipes yet» state too', async () => {
    open('/calculator', { config: configOf({ recipes: [] }) });
    expect(await screen.findByText('No recipes yet', undefined, LOAD)).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Client orders' })).toBeInTheDocument();
  });

  it('is hidden when the venue switched the button off, and only then', async () => {
    open('/calculator', { config: configOf({ showClientOrdersButton: false }) });
    expect(await main().findByRole('button', { name: 'Settings' }, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Client orders' })).not.toBeInTheDocument();
  });

  it('is shown when the field is missing or anything but a literal false', async () => {
    open('/calculator', { config: configOf({ showClientOrdersButton: undefined }) });
    expect(await main().findByRole('button', { name: 'Client orders' }, LOAD)).toBeInTheDocument();
  });

  it('has no door while the Calculator is still «Loading…»', async () => {
    const source = fakeCalculatorSource({ config: configOf() });
    source.hold();
    renderCalculator('/calculator', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Client orders' })).not.toBeInTheDocument();
  });

  it('says its name in Italian', async () => {
    open('/calculator', { lang: 'it' });
    expect(await main().findByRole('button', { name: 'Ordini dei clienti' }, LOAD)).toBeInTheDocument();
  });
});

describe('the banner above the tabs', () => {
  it('counts the orders never put into the Calculator, and is a link to Orders received', async () => {
    const view = open('/calculator', { orders: [orderOf(), orderOf({ clientId: 'sole', clientName: 'Bar Sole' })] });
    const link = await main().findByRole('link', { name: '2 orders received from your clients' }, LOAD);
    expect(link).toHaveAttribute('href', '/calculator/orders');
    expect(link).toHaveAttribute('data-tone', 'info');
    await view.user.click(link);
    expect(pathOf(view)).toBe('/calculator/orders');
    expect(await main().findByRole('heading', { level: 2, name: 'Orders received' }, LOAD)).toBeInTheDocument();

    // Back: the banner that opened the screen takes the focus again.
    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator'); });
    expect(await main().findByRole('link', { name: '2 orders received from your clients' })).toHaveFocus();
  });

  it('says «1 order» in the singular', async () => {
    open('/calculator', { orders: [orderOf()] });
    expect(await main().findByRole('link', { name: '1 order received from your clients' }, LOAD)).toBeInTheDocument();
  });

  it('is LOUDER when an order changed after it was used, and counts only the changed ones', async () => {
    open('/calculator', {
      orders: [changedOrder(), orderOf({ clientId: 'sole', clientName: 'Bar Sole' }), usedOrder({ date: '2026-10-14' })],
    });
    const link = await main().findByRole('link', { name: '1 order has CHANGED since you used it' }, LOAD);
    expect(link).toHaveAttribute('data-tone', 'danger');
  });

  it('goes away when every order is used and untouched since', async () => {
    open('/calculator', { orders: [usedOrder(), usedOrder({ clientId: 'sole', clientName: 'Bar Sole' })] });
    await main().findByRole('button', { name: 'Settings' }, LOAD);
    expect(banner()).not.toBeInTheDocument();
  });

  it('goes away on its own when the last order is put in (the stream says so)', async () => {
    const view = open('/calculator', { orders: [orderOf()] });
    await main().findByRole('link', { name: '1 order received from your clients' }, LOAD);
    act(() => {
      view.clientOrders.orders.set('2026-10-13_roma', usedOrder());
      view.clientOrders.push();
    });
    await waitFor(() => { expect(banner()).not.toBeInTheDocument(); });
  });

  it('is not on the empty states, and says nothing when the stream died', async () => {
    open('/calculator', { orders: [orderOf()], config: configOf({ recipes: [] }) });
    await screen.findByText('No recipes yet', undefined, LOAD);
    expect(banner()).not.toBeInTheDocument();
  });

  it('says nothing when the orders could not be loaded', async () => {
    const orderSource = fakeClientOrdersSource({ orders: [orderOf()] });
    orderSource.refuse.orders = true;
    open('/calculator', { orderSource });
    await main().findByRole('button', { name: 'Settings' }, LOAD);
    expect(banner()).not.toBeInTheDocument();
  });

  it('does NOT follow the switch that hides the Orders door', async () => {
    open('/calculator', { orders: [orderOf()], config: configOf({ showClientOrdersButton: false }) });
    expect(await main().findByRole('link', { name: '1 order received from your clients' }, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Client orders' })).not.toBeInTheDocument();
  });

  it('says the counts in Italian', async () => {
    open('/calculator', { orders: [orderOf(), orderOf({ clientId: 'sole' })], lang: 'it' });
    expect(await main().findByRole('link', { name: '2 ordini ricevuti dai tuoi clienti' }, LOAD)).toBeInTheDocument();
  });
});

describe('Orders received: the addresses and the view switch', () => {
  it.each(['/calculator/orders/nonsense', '/calculator/orders/history/x'])('%s goes to the orders still coming', async path => {
    const view = open(path);
    expect(await main().findByRole('heading', { level: 2, name: 'Orders received' }, LOAD)).toBeInTheDocument();
    expect(pathOf(view)).toBe('/calculator/orders');
  });

  it('offers «Still coming» and «History» as two links, the current one marked', async () => {
    const view = open('/calculator/orders');
    const coming = await main().findByRole('link', { name: 'Still coming' }, LOAD);
    const history = main().getByRole('link', { name: 'History' });
    expect(coming).toHaveAttribute('aria-current', 'page');
    expect(history).not.toHaveAttribute('aria-current');
    expect(history).toHaveAttribute('href', '/calculator/orders/history');

    await view.user.click(history);
    expect(pathOf(view)).toBe('/calculator/orders/history');
    expect(main().getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page');
    expect(main().getByRole('link', { name: 'Still coming' })).not.toHaveAttribute('aria-current');
    // A lateral move: it REPLACES the entry, so Back still leaves Orders received.
    expect(view.router.state.historyAction).toBe('REPLACE');
  });

  it('Back from the history steps up to the work view, and replaces when the screen was opened by its address', async () => {
    const inApp = open('/calculator');
    await inApp.user.click(await main().findByRole('button', { name: 'Client orders' }, LOAD));
    await inApp.user.click(await main().findByRole('link', { name: 'History' }, LOAD));
    await inApp.user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(inApp)).toBe('/calculator'); });
  });

  it('Back from a typed address replaces it with the work view', async () => {
    const view = open('/calculator/orders/history');
    await view.user.click(await main().findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator'); });
    expect(view.router.state.historyAction).toBe('REPLACE');
  });
});

describe('Orders received: still coming — the four states of the list', () => {
  it('says «Loading…» before any answer', async () => {
    const orderSource = fakeClientOrdersSource({ orders: [orderOf()] });
    orderSource.hold();
    open('/calculator/orders', { orderSource });
    expect(await main().findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('article')).not.toBeInTheDocument();
  });

  it('says the orders could not be loaded when the stream died', async () => {
    const orderSource = fakeClientOrdersSource({ orders: [orderOf()] });
    orderSource.refuse.orders = true;
    open('/calculator/orders', { orderSource });
    expect(await main().findByText('The orders could not be loaded. Check your connection.', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('article')).not.toBeInTheDocument();
  });

  it('says the orders have not arrived yet when an EMPTY answer came from this phone\'s own copy only', async () => {
    const orderSource = fakeClientOrdersSource();
    orderSource.hold();
    open('/calculator/orders', { orderSource });
    await main().findByText('Loading…', undefined, LOAD);
    act(() => { orderSource.push({ fromServer: false }); });
    expect(await main().findByText('The orders have not arrived yet.')).toBeInTheDocument();
    // Then the server answers: now nothing really is waiting.
    act(() => { orderSource.push({ fromServer: true }); });
    expect(await main().findByText(/Nothing for today or the days ahead/)).toBeInTheDocument();
    expect(main().queryByText('The orders have not arrived yet.')).not.toBeInTheDocument();
  });

  it('says nothing is coming when the server answered with nothing', async () => {
    open('/calculator/orders');
    expect(await main().findByText(/Nothing for today or the days ahead/, undefined, LOAD)).toBeInTheDocument();
  });

  it('says the words in Italian', async () => {
    const orderSource = fakeClientOrdersSource();
    orderSource.refuse.orders = true;
    open('/calculator/orders', { orderSource, lang: 'it' });
    expect(await main().findByText('Non è stato possibile caricare gli ordini. Controlla la connessione.', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('Orders received: the cards', () => {
  const cards = () => main().getAllByRole('article');

  it('are sorted by the soonest day, then by the client who has waited longest, and only the days still coming', async () => {
    open('/calculator/orders', {
      orders: [
        orderOf({ date: '2026-10-15', clientId: 'roma' }),
        orderOf({ clientId: 'sole', clientName: 'Bar Sole', updatedAt: ago(5) }),
        orderOf({ clientId: 'roma', updatedAt: ago(50) }),
        orderOf({ date: '2026-10-11', clientId: 'roma' }),
      ],
    });
    await main().findAllByRole('article', undefined, LOAD);
    expect(cards()).toHaveLength(3);
    expect(cards().map(card => within(card).getByRole('heading').textContent)).toEqual(['Cafe Roma', 'Bar Sole', 'Cafe Roma']);
    expect(within(cards()[0]!).getByText(/Tomorrow/)).toBeInTheDocument();
    expect(within(cards()[2]!).getByText(full(2026, 10, 15))).toBeInTheDocument();
  });

  it('names the day «Tomorrow · Tuesday 13 October», and how long ago it was sent', async () => {
    open('/calculator/orders', { orders: [orderOf()] });
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    expect(within(card).getByText(`Tomorrow · ${full(2026, 10, 13)}`)).toBeInTheDocument();
    expect(within(card).getByText('Sent 20 min ago')).toBeInTheDocument();
  });

  it('says «Today ·» for an order dated today, and hours and «just now» in the right words', async () => {
    open('/calculator/orders', {
      orders: [
        orderOf({ date: '2026-10-12', updatedAt: ago(0) }),
        orderOf({ date: '2026-10-12', clientId: 'sole', clientName: 'Bar Sole', updatedAt: ago(60 * 3) }),
      ],
    });
    const found = await main().findAllByRole('article', undefined, LOAD);
    expect(within(found[0]!).getByText(`Today · ${full(2026, 10, 12)}`)).toBeInTheDocument();
    const texts = found.map(card => card.textContent ?? '');
    expect(texts.some(text => text.includes('Sent 3 hours ago'))).toBe(true);
    expect(texts.some(text => text.includes('Sent just now'))).toBe(true);
  });

  it('writes the day in the interface language', async () => {
    open('/calculator/orders', { orders: [orderOf()], lang: 'it' });
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    expect(within(card).getByText(`Domani · ${full(2026, 10, 13, 'it-IT')}`)).toBeInTheDocument();
    expect(within(card).getByText('Inviato 20 min fa')).toBeInTheDocument();
  });

  it('wears three different button labels: new, used, and changed after it was used', async () => {
    open('/calculator/orders', {
      orders: [
        orderOf({ updatedAt: ago(30) }),
        changedOrder({ clientId: 'sole', clientName: 'Bar Sole', updatedAt: ago(10) }),
        usedOrder({ date: '2026-10-15' }),
      ],
    });
    const found = await main().findAllByRole('article', undefined, LOAD);
    expect(found).toHaveLength(3);
    expect(within(found[0]!).getByRole('button', { name: 'Put in the calculator' })).toBeInTheDocument();
    expect(within(found[1]!).getByRole('button', { name: 'Put the NEW order in' })).toBeInTheDocument();
    expect(within(found[2]!).getByRole('button', { name: 'Put in the calculator again' })).toBeInTheDocument();
    // The used one says so in words, not only by its button.
    expect(within(found[2]!).getByText(/already in the calculator/)).toBeInTheDocument();
  });

  it('says in words, loudly, that an order CHANGED after it was used', async () => {
    open('/calculator/orders', { orders: [changedOrder()] });
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    const alert = within(card).getByText('This client changed their order AFTER you put it in the calculator. The numbers below are the new ones.');
    expect(alert.closest('[data-tone]')).toHaveAttribute('data-tone', 'danger');
    expect(card).toHaveAttribute('data-state', 'changed');
  });

  it('uses the address book\'s name for the client, not the one the order says', async () => {
    open('/calculator/orders', { orders: [orderOf({ clientName: 'Somebody Else' })] });
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    expect(within(card).getByRole('heading', { name: 'Cafe Roma' })).toBeInTheDocument();
    expect(within(card).queryByText('Somebody Else')).not.toBeInTheDocument();
  });

  it('falls back to the name in the order for a client the address book no longer has, then to «Client»', async () => {
    open('/calculator/orders', {
      orders: [
        orderOf({ clientId: 'ghost', clientName: 'Ghost Cafe' }),
        orderOf({ clientId: 'nobody', clientName: '' }),
      ],
    });
    const found = await main().findAllByRole('article', undefined, LOAD);
    const names = found.map(card => within(card).getByRole('heading').textContent);
    expect(names.sort()).toEqual(['Client', 'Ghost Cafe']);
  });

  it('lists the lines by name with the live product name first, the quantity in the interface number format', async () => {
    open('/calculator/orders', {
      orders: [orderOf({
        quantities: { tray: 1200, slab: 3 },
        names: { tray: 'Old tray name', slab: 'Slab as it was called' },
      })],
    });
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    const lines = within(card).getAllByRole('listitem').map(line => line.textContent);
    // Sorted by name; «Focaccia slab» is the live name of `slab`, «Focaccia tray» of `tray`.
    expect(lines).toEqual(['Focaccia slab3', 'Focaccia tray1,200']);
  });

  it('strikes a line for a product the client no longer has, and says why below', async () => {
    open('/calculator/orders', { orders: [orderOf({ quantities: { tray: 5, gone: 2 }, names: { tray: 'Focaccia tray', gone: 'Old loaf' } })] });
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    const gone = within(card).getByText('Old loaf').closest('li')!;
    expect(gone).toHaveAttribute('data-missing');
    expect(within(card).getByText('Focaccia tray').closest('li')).not.toHaveAttribute('data-missing');
    expect(within(card).getByText(/A line above is for a product this client no longer has/)).toBeInTheDocument();
  });

  it('names a product with no name anywhere «Deleted product»', async () => {
    open('/calculator/orders', { orders: [orderOf({ quantities: { zzz: 1 }, names: {} })] });
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    expect(within(card).getByText('Deleted product')).toBeInTheDocument();
  });

  it('says an empty order is empty', async () => {
    open('/calculator/orders', { orders: [orderOf({ quantities: {}, names: {} })] });
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    expect(within(card).getByText('Nothing this day — the client sent an empty order.')).toBeInTheDocument();
    expect(within(card).queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows the client\'s note under the lines', async () => {
    open('/calculator/orders', { orders: [orderOf({ note: 'Please deliver before seven' })] });
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    expect(within(card).getByText('Please deliver before seven').closest('p')).toHaveTextContent('Note: Please deliver before seven');
  });

  it('marks an order that arrived after the deadline of its day, and only that one', async () => {
    // The door for tomorrow shuts today at 16:00. One order arrived at 17:00 today, the other at 09:40.
    const late = new Date(2026, 9, 12, 17, 0).toISOString();
    open('/calculator/orders', {
      orders: [orderOf({ updatedAt: late }), orderOf({ clientId: 'sole', clientName: 'Bar Sole' })],
      cutoff: '16:00',
    });
    const found = await main().findAllByRole('article', undefined, LOAD);
    const note = 'This arrived after 16:00, the deadline for that day. You can still use it — but it came in late.';
    expect(found.filter(card => within(card).queryByText(note) !== null)).toHaveLength(1);
    const lateCard = found.find(card => within(card).queryByText(note) !== null)!;
    expect(within(lateCard).getByRole('heading')).toHaveTextContent('Cafe Roma');
    expect(within(lateCard).getByText(note).closest('[data-tone]')).toHaveAttribute('data-tone', 'warn');
  });

  it('marks nothing late when the venue has no deadline', async () => {
    open('/calculator/orders', { orders: [orderOf({ updatedAt: new Date(2026, 9, 12, 23, 0).toISOString() })], cutoff: '' });
    await main().findAllByRole('article', undefined, LOAD);
    expect(main().queryByText(/the deadline for that day/)).not.toBeInTheDocument();
  });

  it('one bad order never takes the screen down', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A `names` that is not an object cannot be drawn by every reader; the other order must still be there.
    open('/calculator/orders', {
      orders: [orderOf(), orderOf({ clientId: 'sole', clientName: 'Bar Sole', quantities: 'broken' })],
    });
    const found = await main().findAllByRole('article', undefined, LOAD);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(main().getByRole('heading', { level: 2, name: 'Orders received' })).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
