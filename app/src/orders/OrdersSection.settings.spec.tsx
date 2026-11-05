import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», step 3f-8a: Settings in full (lists, the Stock box, the supplier order, the week, the roads, alerts, History) and the
// supplier order screen.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;
const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', active: true }),
  supplier('s-bee', { name: 'Bee Farm', active: true }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', active: true }),
  supplier('s-off', { name: 'Closed Co', active: false }),
];
const path = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const writes = (source: FakeOrdersSource) => source.deliveryWrites.filter(write => write.kind === 'config').map(write => write.patch);
const LISTS = 'Use order lists';
const ROAD_MANAGER = 'To whoever runs the place, in the app';
const ROAD_WHATSAPP = 'WhatsApp — I choose the chat';
const ROAD_EMAIL = 'Email to the supplier';

async function opened(config: Record<string, unknown> | null = null, options: Parameters<typeof renderOrders>[1] = {}) {
  const source = fakeOrdersSource({ suppliers: SUPPLIERS, ordersConfig: config });
  const view = renderOrders('/orders/settings', { source, ...options });
  await screen.findByRole('switch', { name: 'Show the Stock box on order rows' }, LOAD);
  return { ...view, source };
}

// Reads the notice and closes it (an open dialog hides the page behind it from the queries).
async function alertText(view: { user: { click: (element: Element) => Promise<void> } }): Promise<string | null> {
  const notice = await screen.findByRole('alertdialog', undefined, LOAD);
  const text = notice.textContent;
  await view.user.click(within(notice).getByRole('button', { name: 'OK' }));
  await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
  return text;
}

describe('who sees what', () => {
  it('shows a manager every section, in the current app’s order', async () => {
    await opened();
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Settings']);
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(headings).toEqual(['Order lists', 'The order screen', 'The working week', 'How orders may be sent', 'Alerts', 'History']);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('switch', { name: LISTS })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Supplier order/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Starts on' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Check deliveries' })).toBeEnabled();
    expect(screen.getByRole('spinbutton', { name: 'Days of past orders shown in History' })).toBeEnabled();
    expect(screen.getByText('Email opens your mail app with the order ready — it does not send it by itself.')).toBeInTheDocument();
  });

  it('shows an employee the Stock box and the days of History locked, and no lists, week, roads or door', async () => {
    await opened(null, STAFF);
    const stock = screen.getByRole('switch', { name: 'Show the Stock box on order rows' });
    expect(stock).toBeDisabled();
    expect(stock).toHaveAccessibleDescription(/Only an owner or a manager can change this\./);
    const days = screen.getByRole('spinbutton', { name: 'Days of past orders shown in History' });
    expect(days).toBeDisabled();
    expect(days).toHaveAccessibleDescription(/Only an owner or a manager can change this\./);
    expect(screen.getByRole('switch', { name: 'Check deliveries' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Alerts' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: LISTS })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Order lists' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Supplier order/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Starts on' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'How orders may be sent' })).not.toBeInTheDocument();
  });

  it('keeps every control off until the config has arrived, and writes nothing on a tap', async () => {
    const source = fakeOrdersSource({ suppliers: SUPPLIERS });
    source.watchOrdersConfig = () => () => {};
    const view = renderOrders('/orders/settings', { source });
    const stock = await screen.findByRole('switch', { name: 'Show the Stock box on order rows' }, LOAD);
    expect(stock).toBeDisabled();
    expect(screen.getByRole('switch', { name: LISTS })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Starts on' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Days of past orders shown in History' })).toBeDisabled();
    await view.user.click(stock);
    expect(source.deliveryWrites).toEqual([]);
  });
});

describe('the switches', () => {
  it('writes the Stock box and says «Saved ✓» beside it', async () => {
    const view = await opened();
    await view.user.click(screen.getByRole('switch', { name: 'Show the Stock box on order rows' }));
    await waitFor(() => { expect(writes(view.source)).toEqual([{ showStock: false }]); });
    await waitFor(() => { expect(screen.getByRole('switch', { name: 'Show the Stock box on order rows' })).not.toBeChecked(); });
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
  });

  it('turns order lists off and on, the sub line following the data', async () => {
    const view = await opened();
    expect(screen.getByText('On: the “Order lists” button is at the top of Orders.')).toBeInTheDocument();
    await view.user.click(screen.getByRole('switch', { name: LISTS }));
    await waitFor(() => { expect(writes(view.source)).toEqual([{ orderLists: false }]); });
    expect(await screen.findByText(/^Off: no button/)).toBeInTheDocument();
    await view.user.click(screen.getByRole('switch', { name: LISTS }));
    await waitFor(() => { expect(writes(view.source)).toEqual([{ orderLists: false }, { orderLists: true }]); });
  });

  it('refuses to turn order lists off when they are the only road, says why and writes nothing', async () => {
    const view = await opened({ sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false }, preferredRoute: 'manager' });
    await view.user.click(screen.getByRole('switch', { name: LISTS }));
    expect(await alertText(view)).toMatch(/Right now staff can only send an order as a list\./);
    expect(view.source.deliveryWrites).toEqual([]);
    expect(screen.getByRole('switch', { name: LISTS })).toBeChecked();
  });

  it('writes a road, in the roads’ order, with the manager road first', async () => {
    const view = await opened();
    expect(screen.getAllByRole('switch').map(s => s.getAttribute('aria-labelledby') && document.getElementById(s.getAttribute('aria-labelledby') ?? '')?.textContent))
      .toEqual(expect.arrayContaining([ROAD_MANAGER, ROAD_WHATSAPP, 'WhatsApp straight to the supplier', ROAD_EMAIL]));
    await view.user.click(screen.getByRole('switch', { name: ROAD_EMAIL }));
    await waitFor(() => { expect(writes(view.source)).toHaveLength(1); });
    expect(writes(view.source)[0]).toMatchObject({ sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: false, email: true } });
  });

  it('refuses to close the last road, says why and writes nothing', async () => {
    const view = await opened({ sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: false }, preferredRoute: 'whatsapp' });
    await view.user.click(screen.getByRole('switch', { name: ROAD_WHATSAPP }));
    expect(await alertText(view)).toMatch(/At least one way of sending has to stay on/);
    expect(view.source.deliveryWrites).toEqual([]);
    expect(screen.getByRole('switch', { name: ROAD_WHATSAPP })).toBeChecked();
  });

  it('draws the manager road only while order lists are on', async () => {
    const view = await opened();
    expect(screen.getByRole('switch', { name: ROAD_MANAGER })).toBeInTheDocument();
    await view.user.click(screen.getByRole('switch', { name: LISTS }));
    await waitFor(() => { expect(screen.queryByRole('switch', { name: ROAD_MANAGER })).not.toBeInTheDocument(); });
    expect(screen.queryByRole('switch', { name: /Do not buzz this phone/ })).not.toBeInTheDocument();
  });

  it('says the sentence and puts the switch back when the rules refuse', async () => {
    const view = await opened();
    view.source.failDelivery.config = true;
    await view.user.click(screen.getByRole('switch', { name: 'Show the Stock box on order rows' }));
    expect(await screen.findByText('Only an owner or a manager can change this.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('switch', { name: 'Show the Stock box on order rows' })).toBeChecked(); });
  });
});

describe('the week', () => {
  it('lists the short day names, Sunday first, and writes the day chosen', async () => {
    const view = await opened();
    const select = screen.getByRole('combobox', { name: 'Starts on' });
    expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    await view.user.selectOptions(select, 'Monday');
    await waitFor(() => { expect(writes(view.source)).toEqual([{ weekStartsOn: 'Monday' }]); });
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
    expect(select).toHaveValue('Monday');
  });
});

describe('the days of History', () => {
  const box = () => screen.getByRole('spinbutton', { name: 'Days of past orders shown in History' }) as HTMLInputElement;

  it('saves when the box is left, never per keystroke', async () => {
    const view = await opened();
    expect(box()).toHaveValue(15);
    await view.user.clear(box());
    await view.user.type(box(), '45');
    expect(view.source.deliveryWrites).toEqual([]);
    await view.user.tab();
    await waitFor(() => { expect(writes(view.source)).toEqual([{ historyDays: 45 }]); });
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
  });

  it('saves on Enter, once, even though the box is left afterwards', async () => {
    const view = await opened();
    await view.user.clear(box());
    await view.user.type(box(), '60{Enter}');
    await waitFor(() => { expect(writes(view.source)).toEqual([{ historyDays: 60 }]); });
    await view.user.tab();
    expect(writes(view.source)).toEqual([{ historyDays: 60 }]);
  });

  it.each(['500', '0', ''])('says why and puts the stored number back for «%s»', async text => {
    const view = await opened();
    await view.user.clear(box());
    if (text !== '') await view.user.type(box(), text);
    await view.user.tab();
    expect(await screen.findByText('Choose a number of days from 1 to 365.', undefined, LOAD)).toBeInTheDocument();
    expect(view.source.deliveryWrites).toEqual([]);
    expect(box()).toHaveValue(15);
  });

  it('puts the stored number back when the rules refuse the write', async () => {
    const view = await opened();
    view.source.failDelivery.config = true;
    await view.user.clear(box());
    await view.user.type(box(), '45');
    await view.user.tab();
    expect(await screen.findByText('Only an owner or a manager can change this.', { selector: '[role=status] *, [role=status]' }, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(box()).toHaveValue(15); });
  });

  it('says nothing and writes nothing when the number is the stored one', async () => {
    const view = await opened();
    await view.user.click(box());
    await view.user.tab();
    expect(view.source.deliveryWrites).toEqual([]);
    expect(screen.queryByText('Choose a number of days from 1 to 365.')).not.toBeInTheDocument();
  });

  it('says the months that older orders are kept', async () => {
    await opened();
    expect(screen.getByText(/Older orders are never deleted/)).toHaveTextContent('the last 2 months of orders');
  });
});

describe('in Italian', () => {
  it('speaks the venue’s words', async () => {
    const source = fakeOrdersSource({ suppliers: SUPPLIERS });
    renderOrders('/orders/settings', { source, lang: 'it' });
    await screen.findByRole('switch', { name: /Mostra la casella Giacenza/ }, LOAD);
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent))
      .toEqual(['Liste d’ordine', 'La schermata dell’ordine', 'La settimana lavorativa', 'Come si possono mandare gli ordini', 'Avvisi', 'Storico']);
    expect(screen.getByRole('combobox', { name: 'Inizia il' })).toBeInTheDocument();
  });
});

describe('the supplier order', () => {
  const grip = (name: string) => screen.getByRole('button', { name: `Move ${name}` });
  const names = () => screen.getAllByRole('row').map(row => row.textContent);

  async function atOrder(config: Record<string, unknown> | null = null, options: Parameters<typeof renderOrders>[1] = {}) {
    const source = fakeOrdersSource({ suppliers: SUPPLIERS, ordersConfig: config });
    const view = renderOrders('/orders/settings/supplier-order', { source, ...options });
    await screen.findByRole('button', { name: 'Move Alpine Mills' }, LOAD);
    return { ...view, source };
  }

  it('opens from the door and Back gives the door the focus again', async () => {
    const view = await opened();
    await view.user.click(screen.getByRole('button', { name: /Supplier order/ }));
    await screen.findByRole('region', { name: 'Supplier order' }, LOAD);
    expect(path(view)).toBe('/orders/settings/supplier-order');
    await view.user.click(within(screen.getByRole('region', { name: 'Supplier order' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(path(view)).toBe('/orders/settings'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: /Supplier order/ })).toHaveFocus(); });
  });

  it('lists the active suppliers in the venue’s order, none of the stopped ones', async () => {
    await atOrder({ supplierOrder: ['s-zed', 's-alp'] });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(names()).toEqual(['Zed Dairy Ltd', 'Alpine Mills', 'Bee Farm'].map(n => n));
    expect(screen.queryByText('Closed Co')).not.toBeInTheDocument();
  });

  it('moves a row one place with ArrowDown, writes the ids at once and keeps the focus on the grip', async () => {
    const view = await atOrder();
    act(() => { grip('Alpine Mills').focus(); });
    await view.user.keyboard('{ArrowDown}');
    await waitFor(() => { expect(writes(view.source)).toEqual([{ supplierOrder: ['s-bee', 's-alp', 's-zed'] }]); });
    await waitFor(() => { expect(names()).toEqual(['Bee Farm', 'Alpine Mills', 'Zed Dairy Ltd']); });
    await waitFor(() => { expect(grip('Alpine Mills')).toHaveFocus(); });
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
    await view.user.keyboard('{ArrowUp}{ArrowUp}');
    await waitFor(() => { expect(writes(view.source).at(-1)).toEqual({ supplierOrder: ['s-alp', 's-bee', 's-zed'] }); });
  });

  it('does nothing at the ends', async () => {
    const view = await atOrder();
    act(() => { grip('Alpine Mills').focus(); });
    await view.user.keyboard('{ArrowUp}');
    expect(view.source.deliveryWrites).toEqual([]);
  });

  it('says it could not save and shows the stored order again when the write fails', async () => {
    const view = await atOrder();
    view.source.failDelivery.config = true;
    act(() => { grip('Alpine Mills').focus(); });
    await view.user.keyboard('{ArrowDown}');
    expect(await alertText(view)).toMatch(/Could not save the order\./);
    await waitFor(() => { expect(names()).toEqual(['Alpine Mills', 'Bee Farm', 'Zed Dairy Ltd']); });
  });

  it('says there are no suppliers when none is active', async () => {
    const source = fakeOrdersSource({ suppliers: [supplier('s-off', { name: 'Closed Co', active: false })] });
    renderOrders('/orders/settings/supplier-order', { source });
    expect(await screen.findByText('No active suppliers.', undefined, LOAD)).toBeInTheDocument();
  });

  it('sends an employee who opens the address back to the settings', async () => {
    const source = fakeOrdersSource({ suppliers: SUPPLIERS });
    const view = renderOrders('/orders/settings/supplier-order', { source, ...STAFF });
    await screen.findByRole('region', { name: 'Settings' }, LOAD);
    expect(path(view)).toBe('/orders/settings');
    expect(screen.queryByRole('button', { name: /Move / })).not.toBeInTheDocument();
  });
});
