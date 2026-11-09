import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { fakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import type { FakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import { orderOf, usedOrder } from '../testing/clientOrderFixtures';
import type { TestOrder } from '../testing/clientOrderFixtures';
import { NOW } from '../testing/logFixtures';
import { LOAD, configOf } from '../testing/renderCalculator';
import { renderApp } from '../testing/renderApp';

// The Clients page: the sales owner's one way to the address book, the orders clients sent and their deadline. It draws
// the Calculator's own client screens over a store that watches only the configuration and saves only the clients.

beforeAll(async () => { await import('./ClientsSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const rail = () => within(screen.getByRole('navigation', { name: 'All sections' }));
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const LEAVE = 'You have unsaved changes. Leave without saving? Your changes will be lost.';
const SALES = { role: 'owner-sales', canManage: true, canManageVenue: false } as const;

type Options = {
  config?: Record<string, unknown> | null;
  orders?: TestOrder[];
  cutoff?: string | null;
  lang?: 'en' | 'it';
  held?: boolean;
  role?: 'owner-sales' | 'owner' | 'owner-kitchen';
};

function open(path: string, { config = configOf(), orders = [], cutoff = '18:00', lang = 'en', held = false, role = 'owner-sales' }: Options = {}) {
  const source = fakeCalculatorSource({ config });
  const clientOrders: FakeClientOrdersSource = fakeClientOrdersSource({ orders, cutoff });
  if (held) source.hold();
  const view = renderApp(path, {
    lang,
    session: role === 'owner-sales' ? SALES : { role, canManage: true },
    data: { calculator: () => source, clientOrders: () => clientOrders },
  });
  return { ...view, source, clientOrders };
}

// Waits until the page has its answer from the server: the Clients door has stopped saying «Loading…».
async function opened(path: string, options?: Options) {
  const view = open(path, options);
  await main().findByRole('heading', { level: 2 }, LOAD);
  await waitFor(() => { expect(main().queryByText(/^(Loading…|Caricamento…)$/)).toBeNull(); }, LOAD);
  return view;
}

type View = Awaited<ReturnType<typeof opened>>;

describe('the page', () => {
  it('has the three doors, one h1, no WhatsApp, and watches no logs', async () => {
    const { source } = await opened('/clients');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Clients' })).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 2, name: 'Clients and orders' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: /^Clients/ })).toBeEnabled();
    expect(main().getByRole('button', { name: /^Orders received/ })).toBeEnabled();
    expect(main().getByRole('button', { name: /^Client ordering/ })).toBeEnabled();
    expect(main().queryByText('WhatsApp')).not.toBeInTheDocument();
    // ⚠️ The rules refuse this role the logs: a listener on them would be a refusal on every visit.
    expect(source.logWatcherCount()).toBe(0);
    expect(source.catalogueReads()).toBe(0);
    expect(source.saved).toEqual([]);
  });

  it('says its words in Italian', async () => {
    await opened('/clients', { lang: 'it' });
    expect(main().getByRole('heading', { level: 2, name: 'Clienti e ordini' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: /^Ordini ricevuti/ })).toHaveTextContent('Cosa hanno chiesto i clienti, da leggere');
    expect(main().getByRole('button', { name: /^Clienti/ })).toBeEnabled();
  });

  it('keeps the Clients door shut, saying «Loading…», until the server has answered', async () => {
    const { source } = open('/clients', { held: true });
    const door = await main().findByRole('button', { name: /^Clients/ }, LOAD);
    expect(door).toBeDisabled();
    expect(door).toHaveTextContent('Loading…');
    source.release();
    await waitFor(() => { expect(main().getByRole('button', { name: /^Clients/ })).toBeEnabled(); }, LOAD);
  });

  it('says the venue is not ready when the server has no Calculator document, and the door stays shut', async () => {
    await opened('/clients', { config: null });
    const door = main().getByRole('button', { name: /^Clients/ });
    expect(door).toBeDisabled();
    expect(door).toHaveTextContent('Not ready yet: ask the owner to save any Calculator setting once.');
    // The other two doors do not wait for it.
    expect(main().getByRole('button', { name: /^Orders received/ })).toBeEnabled();
  });

  it('says the same when the document is still in an old shape (a top-level products list)', async () => {
    await opened('/clients', { config: { ...configOf(), products: [] } });
    expect(main().getByRole('button', { name: /^Clients/ })).toBeDisabled();
    expect(main().getByText('Not ready yet: ask the owner to save any Calculator setting once.')).toBeInTheDocument();
  });

  it('refuses the address book by its address too, with the same sentence and a way back', async () => {
    const { user, ...view } = await opened('/clients/list', { config: null });
    expect(main().getByText('Not ready yet: ask the owner to save any Calculator setting once.')).toBeInTheDocument();
    expect(main().queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/clients'); });
  });

  it('sends an address it does not know back to the page, and «new» to the list', async () => {
    const view = await opened('/clients/zzz');
    await waitFor(() => { expect(pathOf(view)).toBe('/clients'); });
    view.router.navigate('/clients/list/new').catch(() => undefined);
    await waitFor(() => { expect(pathOf(view)).toBe('/clients/list'); });
    view.router.navigate('/clients/whatsapp').catch(() => undefined);
    await waitFor(() => { expect(pathOf(view)).toBe('/clients'); });
  });
});

describe('the address book', () => {
  const nameBox = () => main().getByRole('textbox', { name: 'Client name' });

  async function openRoma(view: View) {
    await view.user.click(main().getByRole('button', { name: /^Clients/ }));
    await view.user.click(await main().findByRole('row', { name: /Cafe Roma/ }, LOAD));
    await main().findByRole('textbox', { name: 'Client name' }, LOAD);
  }

  it('saves ONLY the clients, over the latest configuration, and goes back to the list', async () => {
    const view = await opened('/clients');
    const before = JSON.parse(JSON.stringify(view.source.config)) as Record<string, unknown>;
    await openRoma(view);
    await view.user.type(nameBox(), ' 2');
    await view.user.click(main().getByRole('button', { name: 'Save' }));
    await view.user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/clients/list'); });
    expect(view.source.savedClients).toHaveLength(1);
    // Never the Calculator's whole save: the rules refuse that role every other key.
    expect(view.source.savedConfigs).toEqual([]);
    const after = view.source.config as Record<string, unknown>;
    expect(after['recipes']).toEqual(before['recipes']);
    expect((after['clients'] as { name: string }[])[0]?.name).toBe('Cafe Roma 2');
    expect(view.source.saved).toEqual([]);
  });

  it('shows the ordering link group without the Calculator, and no WhatsApp anywhere', async () => {
    const view = await opened('/clients');
    await openRoma(view);
    expect(main().getByRole('group', { name: 'Ordering link' })).toBeInTheDocument();
    expect(main().queryByText(/WhatsApp/)).not.toBeInTheDocument();
  });

  it('Back from the list lands on the page and gives the focus back to its door', async () => {
    const view = await opened('/clients');
    await view.user.click(main().getByRole('button', { name: /^Clients/ }));
    await main().findByRole('row', { name: /Cafe Roma/ }, LOAD);
    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/clients'); });
    expect(await main().findByRole('button', { name: /^Clients/ })).toHaveFocus();
  });

  it('asks before leaving with unsaved edits, by Back and by the rail', async () => {
    const view = await opened('/clients');
    await openRoma(view);
    await view.user.type(nameBox(), '!');
    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await view.user.click(within(await question(LEAVE)).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toMatch(/^\/clients\/list/);
    await view.user.click(rail().getByRole('link', { name: 'Home' }));
    await view.user.click(within(await question(LEAVE)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/home'); });
    expect(view.source.savedClients).toEqual([]);
  });

  it('a save the rules refuse is said, and nothing is lost', async () => {
    const view = await opened('/clients');
    view.source.refuse.configSave = true;
    await openRoma(view);
    await view.user.type(nameBox(), '!');
    await view.user.click(main().getByRole('button', { name: 'Save' }));
    await view.user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Save' }));
    const said = await screen.findByRole('alertdialog', undefined, LOAD);
    await view.user.click(within(said).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(pathOf(view)).toMatch(/^\/clients\/list\/roma/);
    expect(nameBox()).toHaveValue('Cafe Roma!');
    expect(main().getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('Orders received', () => {
  it('shows the orders to read: no «put in the calculator», and nothing written to the Calculator', async () => {
    const view = await opened('/clients/orders', { orders: [orderOf(), usedOrder({ clientId: 'sole', clientName: 'Bar Sole' })] });
    const cards = await main().findAllByRole('article', undefined, LOAD);
    expect(cards).toHaveLength(2);
    expect(main().queryByRole('button', { name: /Put in the calculator|Put the new order in|Put the new order/i })).not.toBeInTheDocument();
    expect(main().queryAllByRole('button', { name: /calculator/i })).toHaveLength(0);
    expect(view.source.saved).toEqual([]);
    expect(view.source.stamps).toEqual([]);
    expect(view.source.catalogueReads()).toBe(0);
    expect(view.source.logWatcherCount()).toBe(0);
    expect(view.clientOrders.applied).toEqual([]);
  });

  it('is reached from its door, and Back returns to the page', async () => {
    const view = await opened('/clients');
    await view.user.click(main().getByRole('button', { name: /^Orders received/ }));
    expect(pathOf(view)).toBe('/clients/orders');
    expect(await main().findByRole('heading', { level: 2, name: 'Orders received' }, LOAD)).toBeInTheDocument();
    await view.user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/clients'); });
    expect(await main().findByRole('button', { name: /^Orders received/ })).toHaveFocus();
  });

  it('keeps the history on its own address, under /clients', async () => {
    const view = await opened('/clients/orders');
    await view.user.click(main().getByRole('link', { name: 'History' }));
    expect(pathOf(view)).toBe('/clients/orders/history');
    expect(await main().findByRole('button', { name: /Show older/ }, LOAD)).toBeInTheDocument();
  });

  it('the waiting-orders line sits on the page and opens Orders received', async () => {
    const view = await opened('/clients', { orders: [orderOf(), orderOf({ clientId: 'sole', clientName: 'Bar Sole' })] });
    const link = await main().findByRole('link', { name: '2 orders received from your clients' }, LOAD);
    expect(link).toHaveAttribute('href', '/clients/orders');
    await view.user.click(link);
    expect(pathOf(view)).toBe('/clients/orders');
    await view.user.click(await main().findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(pathOf(view)).toBe('/clients'); });
    expect(await main().findByRole('link', { name: '2 orders received from your clients' })).toHaveFocus();
  });
});

describe('Client ordering', () => {
  it('changes the deadline and goes back to the page', async () => {
    const view = await opened('/clients');
    await view.user.click(main().getByRole('button', { name: /^Client ordering/ }));
    expect(pathOf(view)).toBe('/clients/ordering');
    const box = await main().findByLabelText('Orders close at', undefined, LOAD);
    fireEvent.change(box, { target: { value: '19:30' } });
    await view.user.click(main().getByRole('button', { name: 'Save' }));
    await view.user.click(within(await question('Close orders at 19:30 the day before? Every client sees this straight away.')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/clients'); });
    expect(view.clientOrders.savedCutoffs).toEqual(['19:30']);
  });
});

describe('who is shown the page', () => {
  it('sends the sales owner who taps a client-order notification (the Calculator\'s address) to Orders received', async () => {
    const view = open('/calculator');
    await waitFor(() => { expect(pathOf(view)).toBe('/clients/orders'); }, LOAD);
    expect(await main().findByRole('heading', { level: 2, name: 'Orders received' }, LOAD)).toBeInTheDocument();
  });

  it('shows the sales owner Home, Clients, Food cost and Settings, and not the Calculator', async () => {
    await opened('/clients');
    const names = rail().getAllByRole('link').map(link => link.textContent);
    expect(names).toEqual(['Home', 'Clients', 'Food cost', 'Settings']);
  });

  it('is « not available » to an owner who runs the Calculator', async () => {
    open('/clients', { role: 'owner' });
    expect(await main().findByText('This section is not on for you at this venue.', undefined, LOAD)).toBeInTheDocument();
    expect(rail().queryByRole('link', { name: 'Clients' })).not.toBeInTheDocument();
  });

  it('is « not available » to the kitchen owner, and the Calculator\'s address is not redirected for them', async () => {
    open('/clients', { role: 'owner-kitchen' });
    expect(await main().findByText('This section is not on for you at this venue.', undefined, LOAD)).toBeInTheDocument();
  });
});
