import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// There is no canvas in jsdom: the order picture is a stand-in file.
vi.mock('./orderImage', async importOriginal => ({
  ...await importOriginal<typeof import('./orderImage')>(),
  renderOrderImage: vi.fn((text: string) => Promise.resolve(new File([text], 'order.png', { type: 'image/png' }))),
}));

// «Orders», step 3f-3: the send arrow, the send screen, the road chooser, the photo path and «Send it now».

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

const TODAY = todayISO();
// An employee on a venue that has not touched its send settings: «to the manager» and WhatsApp.
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;
// The venue lets staff send only straight to the supplier.
const DIRECT_ONLY = { sendRoutes: { manager: false, whatsapp: false, whatsappSupplier: true, email: false } };

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', phone: '+44 7700 900123', email: 'orders@zed.test' }),
  supplier('s-caf', { name: 'Café Bar Srl', phone: '+39 02 1234567' }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-box', { name: 'Cake box', supplierId: 's-alp', unit: 'carton', packUnit: 'bag' }),
  ingredient('i-milk', { name: 'Whole milk', shortName: 'Milk', supplierId: 's-zed', unit: 'l' }),
  ingredient('i-cafe', { name: 'Caffè in grani', supplierId: 's-caf' }),
];
const DRAFT = {
  entries: { 'i-flour': { qty: 2 }, 'i-rye': { qty: 3 }, 'i-milk': { qty: 4 }, 'i-cafe': { qty: 1 } },
  days: { 's-alp': TODAY, 's-zed': TODAY, 's-caf': TODAY },
};

function seeded(options: { draft?: Record<string, unknown> | null; ordersConfig?: Record<string, unknown> | null } = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, draft: DRAFT, ...options });
}

async function atList(source: FakeOrdersSource, options: Parameters<typeof renderOrders>[1] = {}) {
  const view = renderOrders('/orders', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

type View = Awaited<ReturnType<typeof atList>>;

const arrow = () => screen.getByRole('button', { name: 'Send' });
const sendScreen = () => within(screen.getByRole('region', { name: 'Send order' }));
const sendButton = () => sendScreen().getByRole('button', { name: 'Send' });
const tick = (view: View, name: string | RegExp) => view.user.click(sendScreen().getByRole('checkbox', { name }));

// From the list to the send screen, with the named suppliers ticked.
async function toSend(view: View, ...names: string[]) {
  await view.user.click(arrow());
  await screen.findByRole('region', { name: 'Send order' });
  for (const name of names) await tick(view, new RegExp(`^${name}`));
}

// The confirm screen that follows a send, once its working copy is on screen.
async function orderSent() {
  await screen.findByText('This is what will be recorded:', undefined, LOAD);
  return within(screen.getByRole('region', { name: 'Order sent' }));
}

const pressed = (open: ReturnType<typeof spyOpen>) => open.mock.calls.map(call => String(call[0]));
const textOf = (url: string) => decodeURIComponent(url.slice(url.indexOf('?text=') + '?text='.length));

function spyOpen(result: unknown = { opener: null }) {
  return vi.spyOn(window, 'open').mockImplementation(() => result as Window | null);
}

function allowShare() {
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
  const share = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  return share;
}

describe('the send arrow and the send screen', () => {
  it('opens the screen from the arrow beside the search box and gives the focus back to the arrow on Back', async () => {
    const view = await atList(seeded(), STAFF);
    await view.user.click(arrow());
    expect(await screen.findByRole('region', { name: 'Send order' })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/send');
    await view.user.click(sendScreen().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    await waitFor(() => { expect(arrow()).toHaveFocus(); });
  });

  it('has no arrow while there is no supplier to send to', async () => {
    renderOrders('/orders', { source: fakeOrdersSource() });
    await screen.findByText('No suppliers yet', { exact: false }, LOAD);
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('ticks NOTHING when it opens; «Select all» ticks every supplier and enables the button', async () => {
    const view = await atList(seeded(), STAFF);
    await toSend(view);
    const box = sendScreen();
    expect(box.getAllByRole('checkbox').every(check => !(check as HTMLInputElement).checked)).toBe(true);
    expect(sendButton()).toBeDisabled();
    await view.user.click(box.getByRole('checkbox', { name: 'Select all suppliers' }));
    expect(box.getAllByRole('checkbox').every(check => (check as HTMLInputElement).checked)).toBe(true);
    expect(sendButton()).toBeEnabled();
    expect(box.getByText('2 items')).toBeInTheDocument();
    await view.user.click(box.getByRole('checkbox', { name: 'Select all suppliers' }));
    expect(sendButton()).toBeDisabled();
  });

  it('says there is nothing to send when the order is empty', async () => {
    const view = await atList(seeded({ draft: null }), STAFF);
    await view.user.click(arrow());
    expect(await screen.findByText('No items in this order yet. Add quantities first.')).toBeInTheDocument();
  });

  it('chooses how the message is written with a radio group the arrow keys move', async () => {
    const view = await atList(seeded(), STAFF);
    await toSend(view);
    const group = sendScreen().getByRole('radiogroup', { name: 'WhatsApp message' });
    const bySupplier = within(group).getByRole('radio', { name: 'By supplier' });
    expect(bySupplier).toHaveAttribute('aria-checked', 'true');
    bySupplier.focus();
    await view.user.keyboard('{ArrowRight}');
    expect(within(group).getByRole('radio', { name: 'One list' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: 'One list' })).toHaveFocus();
  });
});

describe('one open road', () => {
  it('opens WhatsApp INSIDE the press, then asks to record what was sent', async () => {
    const open = spyOpen();
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills', 'Zed');
    const button = sendButton();
    act(() => {
      button.click();
      // ⚠️ Synchronously: a window opened after any await would be blocked as a pop-up.
      expect(open).toHaveBeenCalledTimes(1);
    });
    const url = pressed(open)[0] ?? '';
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const text = textOf(url);
    expect(text).toContain('Alpine Mills');
    expect(text).toContain('*Zed*');
    expect(text).toContain('- Flour 00: 2');
    const confirm = await orderSent();
    expect(view.router.state.location.pathname).toBe('/orders/place-all/confirm');
    expect(confirm.getByText('Alpine Mills')).toBeInTheDocument();
    expect(confirm.getByText('Zed')).toBeInTheDocument();
    expect(confirm.getByRole('button', { name: 'Mark as placed' })).toBeInTheDocument();
  });

  it('writes ONE list when asked to', async () => {
    const open = spyOpen();
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendScreen().getByRole('radio', { name: 'One list' }));
    await view.user.click(sendButton());
    const text = textOf(pressed(open)[0] ?? '');
    expect(text).not.toContain('Alpine Mills');
    expect(text).toContain('- Flour 00: 2');
  });

  it('still asks «Did you send it?» after a send, records only what is confirmed, and Back goes to the list', async () => {
    spyOpen();
    const source = seeded();
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const confirm = await orderSent();
    await view.user.click(confirm.getByRole('button', { name: 'Mark as placed' }));
    const asked = await screen.findByRole('alertdialog');
    expect(within(asked).getByText('Did you send the order to Alpine Mills?')).toBeInTheDocument();
    await view.user.click(within(asked).getByRole('button', { name: 'Yes, sent' }));
    await waitFor(() => { expect(source.records.has(`${TODAY}_s-alp`)).toBe(true); });
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    expect(source.records.has(`${TODAY}_s-zed`)).toBe(false);
  });

  it('goes back to the LIST from the confirm screen that follows a send, not to the send screen', async () => {
    spyOpen();
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const confirm = await orderSent();
    await view.user.click(confirm.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
  });

  it('refuses a unit clash with today’s record, says it and opens nothing', async () => {
    const open = spyOpen();
    const source = seeded({ draft: { entries: { 'i-box': { qty: 2, unit: 'bag' } }, days: { 's-alp': TODAY } } });
    source.records.set(`${TODAY}_s-alp`, {
      date: TODAY, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-box': 3 }, stock: {}, names: { 'i-box': 'Cake box' },
      units: { 'i-box': 'carton' }, createdAt: '2026-10-27T07:00:00.000Z', updatedAt: '2026-10-27T07:00:00.000Z',
    });
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText(/^Already ordered from this supplier today: Cake box — carton\./)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    await view.user.click(within(alert).getByRole('button', { name: 'OK' }));
    expect(view.router.state.location.pathname).toBe('/orders/send');
    await waitFor(() => { expect(sendButton()).toBeEnabled(); });
  });

  it('says «Nothing was opened» and stays when the browser blocks the window', async () => {
    spyOpen(null);
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    expect(await screen.findByText(/^Nothing was opened/)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/send');
    expect(screen.queryByRole('region', { name: 'Order sent' })).not.toBeInTheDocument();
  });

  it('says there is no way to send when the venue offers an employee only the in-app list', async () => {
    const open = spyOpen();
    const source = seeded({ ordersConfig: { sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } } });
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText(/^There is no way to send this order/)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('several roads', () => {
  it('shows the road chooser to a manager, with three roads, and Escape closes it with nothing opened', async () => {
    const open = spyOpen();
    const view = await atList(seeded());
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const chooser = await screen.findByRole('dialog', { name: 'How should this order go?' });
    const roads = within(chooser).getAllByRole('button').map(button => button.textContent ?? '');
    expect(roads).toHaveLength(4);
    expect(roads[0]).toContain('WhatsApp — I choose the chat');
    expect(roads[1]).toContain('WhatsApp straight to the supplier');
    expect(roads[2]).toContain('Email to the supplier');
    expect(roads[2]).toContain('it does not send it by itself');
    expect(roads[3]).toBe('Cancel');
    await view.user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'How should this order go?' })).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
    expect(view.router.state.location.pathname).toBe('/orders/send');
  });

  it('takes the road that was pressed, straight to the supplier’s number', async () => {
    const open = spyOpen();
    const view = await atList(seeded());
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const chooser = within(await screen.findByRole('dialog', { name: 'How should this order go?' }));
    await view.user.click(chooser.getByRole('button', { name: /^WhatsApp straight to the supplier/ }));
    expect(pressed(open)[0]?.startsWith('https://wa.me/447700900123?text=')).toBe(true);
    await orderSent();
  });

  it('names a supplier with no phone under the road straight to the supplier', async () => {
    spyOpen();
    const view = await atList(seeded());
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendButton());
    const chooser = within(await screen.findByRole('dialog', { name: 'How should this order go?' }));
    expect(chooser.getByRole('button', { name: /^WhatsApp straight to the supplier/ })).toHaveTextContent('no contact saved for Alpine Mills');
  });
});

describe('the order picture', () => {
  it('asks Photo or Text, shares one picture per supplier and names the one that was skipped', async () => {
    const share = allowShare();
    const open = spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toSend(view, 'Zed', 'Café');
    await view.user.click(sendButton());
    const format = within(await screen.findByRole('dialog', { name: 'How do you want to send it?' }));
    expect(format.getByRole('button', { name: 'Order photo' })).toHaveFocus();
    await view.user.click(format.getByRole('button', { name: 'Order photo' }));

    const first = within(await screen.findByRole('dialog', { name: 'Photo for Café Bar Srl (1 of 2)' }));
    await view.user.click(first.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledTimes(1);

    const second = within(await screen.findByRole('dialog', { name: 'Photo for Zed (2 of 2)' }));
    await view.user.click(second.getByRole('button', { name: 'Skip' }));

    const notice = await screen.findByRole('alertdialog');
    expect(within(notice).getByText('Not sent: Zed')).toBeInTheDocument();
    await view.user.click(within(notice).getByRole('button', { name: 'OK' }));
    expect(open).not.toHaveBeenCalled();

    // Only the supplier whose picture was shared is carried on to be recorded.
    const confirm = await orderSent();
    expect(confirm.getByText('Café Bar Srl')).toBeInTheDocument();
    expect(confirm.queryByText('Zed')).not.toBeInTheDocument();
  });

  it('sends the text at once when Text is chosen', async () => {
    allowShare();
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const format = within(await screen.findByRole('dialog', { name: 'How do you want to send it?' }));
    await view.user.click(format.getByRole('button', { name: 'Text' }));
    await waitFor(() => { expect(open).toHaveBeenCalledTimes(1); });
  });

  it('sends nothing when «Photo or text?» is cancelled', async () => {
    allowShare();
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    await screen.findByRole('dialog', { name: 'How do you want to send it?' });
    await view.user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'How do you want to send it?' })).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
    expect(view.router.state.location.pathname).toBe('/orders/send');
  });
});

describe('«Send it now» on the confirm screen', () => {
  async function toConfirmAll(view: View) {
    await view.user.click(screen.getByRole('button', { name: 'Order placed…' }));
    await view.user.click(await screen.findByRole('button', { name: 'Order placed' }));
    await screen.findByText('This is what will be recorded:', undefined, LOAD);
  }

  it('sends the CORRECTED numbers and records the supplier it reached', async () => {
    const open = spyOpen();
    const source = seeded();
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    const rye = screen.getByRole('spinbutton', { name: 'Rye 25kg — Order' });
    await view.user.clear(rye);
    await view.user.type(rye, '9');
    const confirm = within(screen.getByRole('region', { name: 'Record these orders' }));
    await view.user.click(confirm.getByRole('button', { name: 'Order placed' }));
    const asked = within(await screen.findByRole('alertdialog'));
    expect(asked.getByRole('button', { name: 'Yes, sent' })).toHaveFocus();
    await view.user.click(asked.getByRole('button', { name: 'Send them now' }));
    await waitFor(() => { expect(open).toHaveBeenCalled(); });
    expect(textOf(pressed(open)[0] ?? '')).toContain('Rye: 9');
    await waitFor(() => { expect(source.records.size).toBe(3); });
    expect(source.records.get(`${TODAY}_s-alp`)?.quantities).toEqual({ 'i-flour': 2, 'i-rye': 9 });
  });

  it('records ONLY the supplier the road reached and names the one it did not', async () => {
    const open = spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send them now' }));
    await waitFor(() => { expect(source.records.size).toBe(2); });
    expect(open).toHaveBeenCalledTimes(2);
    expect(source.records.has(`${TODAY}_s-alp`)).toBe(false);
    expect(await screen.findByText(/Not sent, still to do: Alpine Mills/)).toBeInTheDocument();
  });

  it('records nothing when no window opened, and stays', async () => {
    spyOpen(null);
    const source = seeded();
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send them now' }));
    expect(await screen.findByText(/Not sent, still to do: /)).toBeInTheDocument();
    expect(source.records.size).toBe(0);
    expect(view.router.state.location.pathname).toBe('/orders/place-all/confirm');
  });

  it('does not offer «Send it now» when no road reaches a supplier', async () => {
    const source = seeded({ ordersConfig: { sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } } });
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    const asked = within(await screen.findByRole('alertdialog'));
    expect(asked.getByRole('button', { name: 'Yes, sent' })).toBeInTheDocument();
    expect(asked.queryByRole('button', { name: /Send (it|them) now/ })).not.toBeInTheDocument();
  });
});

describe('in Italian', () => {
  it('says the arrow, the screen and the answer in Italian', async () => {
    const view = await atList(seeded(), { ...STAFF, lang: 'it' });
    await view.user.click(screen.getByRole('button', { name: 'Manda' }));
    const box = within(await screen.findByRole('region', { name: 'Manda l’ordine' }));
    expect(box.getByRole('checkbox', { name: 'Seleziona tutti i fornitori' })).toBeInTheDocument();
  });
});
