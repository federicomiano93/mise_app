import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { fakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import type { FakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import { orderOf, usedOrder } from '../testing/clientOrderFixtures';
import type { TestOrder } from '../testing/clientOrderFixtures';
import { NOW } from '../testing/logFixtures';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The history of the clients' orders: the days before today, read on demand, a record with nothing to press.

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
const full = (y: number, m: number, d: number, locale = 'en-GB') =>
  new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

function open(orders: TestOrder[], { orderSource, lang = 'en' }: { orderSource?: FakeClientOrdersSource; lang?: 'en' | 'it' } = {}) {
  const clientOrders = orderSource ?? fakeClientOrdersSource({ orders });
  const view = renderCalculator('/calculator/orders/history', {
    source: fakeCalculatorSource({ config: configOf() }),
    data: { clientOrders: () => clientOrders },
    lang,
  });
  return { ...view, clientOrders };
}

const past = (date: string, over: Record<string, unknown> = {}) => orderOf({ date, ...over });

describe('the history of the clients\' orders', () => {
  it('reads the last 15 days before today once, when the address opens — never today or later', async () => {
    const view = open([past('2026-10-08'), orderOf({ date: '2026-10-12' }), orderOf({ date: '2026-10-13' })]);
    expect(await main().findByRole('heading', { level: 3, name: full(2026, 10, 8) }, LOAD)).toBeInTheDocument();
    expect(view.clientOrders.pastReads).toEqual([{ before: '2026-10-12', since: '2026-09-27' }]);
    expect(main().getAllByRole('article')).toHaveLength(1);
  });

  it('groups by day, newest day first, a heading for each', async () => {
    open([past('2026-10-05'), past('2026-10-09'), past('2026-10-09', { clientId: 'sole', clientName: 'Bar Sole' })]);
    await main().findAllByRole('article', undefined, LOAD);
    const headings = main().getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
    expect(headings).toEqual([full(2026, 10, 9), full(2026, 10, 5)]);
    const first = main().getByRole('region', { name: full(2026, 10, 9) });
    expect(within(first).getAllByRole('article')).toHaveLength(2);
  });

  it('shows each order as a record: the live client name, how many lines, and whether it went into the Calculator', async () => {
    open([
      usedOrder({ date: '2026-10-09' }),
      past('2026-10-08', { clientId: 'sole', clientName: 'Somebody Else', quantities: { tray: 2, cheese: 1 }, names: { tray: 'Focaccia tray', cheese: 'Cheese by the kilo' } }),
      past('2026-10-07', { quantities: {}, names: {} }),
    ]);
    const cards = await main().findAllByRole('article', undefined, LOAD);
    expect(cards).toHaveLength(3);
    // 9th: Cafe Roma, used.
    expect(within(cards[0]!).getByRole('heading', { name: 'Cafe Roma' })).toBeInTheDocument();
    expect(within(cards[0]!).getByText('1 line')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Went into the calculator')).toBeInTheDocument();
    // 8th: the address book's name for the client, not the one the order says; never used.
    expect(within(cards[1]!).getByRole('heading', { name: 'Bar Sole' })).toBeInTheDocument();
    expect(within(cards[1]!).getByText('2 lines')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Never put into the calculator')).toBeInTheDocument();
    // 7th: an empty order is a fact about that day, kept and said.
    expect(within(cards[2]!).getByText('nothing ordered')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('The client sent this day empty — they asked for nothing.')).toBeInTheDocument();
  });

  it('has NO button to put an order in the Calculator — a record is not a thing to do', async () => {
    open([past('2026-10-09'), usedOrder({ date: '2026-10-08' })]);
    await main().findAllByRole('article', undefined, LOAD);
    expect(main().queryByRole('button', { name: /Put (in|the NEW)/ })).not.toBeInTheDocument();
    for (const card of main().getAllByRole('article')) expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not strike through a line whose product was deleted since: the client DID ask for it', async () => {
    open([past('2026-10-09', { quantities: { tray: 5, gone: 2 }, names: { tray: 'Focaccia tray', gone: 'Old loaf' } })]);
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    const gone = within(card).getByText('Old loaf').closest('li')!;
    expect(gone).not.toHaveAttribute('data-missing');
    expect(within(card).queryByText(/A line above is for a product this client no longer has/)).not.toBeInTheDocument();
  });

  it('shows the client\'s note, and the quantities in the interface number format', async () => {
    open([past('2026-10-09', { note: 'Left at the back door', quantities: { tray: 1200 } })]);
    const card = (await main().findAllByRole('article', undefined, LOAD))[0]!;
    expect(within(card).getByText('Left at the back door').closest('p')).toHaveTextContent('Note: Left at the back door');
    expect(within(card).getByText('1,200')).toBeInTheDocument();
  });

  it('writes the day in the interface language', async () => {
    open([past('2026-10-09')], { lang: 'it' });
    expect(await main().findByRole('heading', { level: 3, name: full(2026, 10, 9, 'it-IT') }, LOAD)).toBeInTheDocument();
    expect(main().getByText('Mai messo nel calcolatore')).toBeInTheDocument();
  });
});

describe('«Show older»', () => {
  it('is always offered, says how far back the screen looks, and widens by one window', async () => {
    const view = open([past('2026-10-08'), past('2026-09-20', { clientId: 'sole', clientName: 'Bar Sole' })]);
    await main().findAllByRole('article', undefined, LOAD);
    expect(main().getAllByRole('article')).toHaveLength(1);

    await view.user.click(main().getByRole('button', { name: 'Show older orders (before the last 15 days)' }));
    await waitFor(() => { expect(main().getAllByRole('article')).toHaveLength(2); });
    expect(view.clientOrders.pastReads).toEqual([
      { before: '2026-10-12', since: '2026-09-27' },
      { before: '2026-10-12', since: '2026-09-12' },
    ]);
    // The button now says the new distance, and is still there.
    expect(main().getByRole('button', { name: 'Show older orders (before the last 30 days)' })).toBeInTheDocument();
  });

  it('is offered on an empty window too', async () => {
    open([]);
    await main().findByText(/No client has sent an order yet/, undefined, LOAD);
    expect(main().getByRole('button', { name: 'Show older orders (before the last 15 days)' })).toBeInTheDocument();
  });

  it('starts at the last 15 days again after the screen was left', async () => {
    const view = open([past('2026-10-08')]);
    await main().findAllByRole('article', undefined, LOAD);
    await view.user.click(main().getByRole('button', { name: 'Show older orders (before the last 15 days)' }));
    await main().findByRole('button', { name: 'Show older orders (before the last 30 days)' });

    await view.user.click(main().getByRole('link', { name: 'Still coming' }));
    await main().findByText(/Nothing for today or the days ahead/);
    await view.user.click(main().getByRole('link', { name: 'History' }));
    await main().findByRole('button', { name: 'Show older orders (before the last 15 days)' }, LOAD);
    expect(view.clientOrders.pastReads.at(-1)).toEqual({ before: '2026-10-12', since: '2026-09-27' });
  });
});

describe('the sentences of the history', () => {
  it('says no client has ever sent an order when there is none at all', async () => {
    open([]);
    expect(await main().findByText('No client has sent an order yet. When one does, it will be here afterwards.', undefined, LOAD)).toBeInTheDocument();
  });

  it('says there were none in the window — and that nothing is ever deleted — when older ones exist', async () => {
    open([past('2026-08-01')]);
    expect(await main().findByText('No orders in the last 15 days. Older ones are still kept — nothing is ever deleted.', undefined, LOAD)).toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    open([past('2026-08-01')], { lang: 'it' });
    expect(await main().findByText('Nessun ordine negli ultimi 15 giorni. I più vecchi sono comunque conservati — non si cancella mai niente.', undefined, LOAD)).toBeInTheDocument();
  });

  it('says the past orders could not be loaded, rather than showing an empty list', async () => {
    const orderSource = fakeClientOrdersSource({ orders: [past('2026-10-08')] });
    orderSource.refuse.past = true;
    open([], { orderSource });
    expect(await main().findByText('Could not load the past orders. Check your connection and try again.', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('article')).not.toBeInTheDocument();
  });
});
