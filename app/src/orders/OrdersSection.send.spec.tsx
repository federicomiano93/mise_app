import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';
import { isBusy } from '../session/busy';
import { renderOrderImage } from './orderImage';

// There is no canvas in jsdom: the order picture is a stand-in file.
vi.mock('./orderImage', async importOriginal => ({
  ...await importOriginal<typeof import('./orderImage')>(),
  renderOrderImage: vi.fn((text: string) => Promise.resolve(new File([text], 'order.png', { type: 'image/png' }))),
}));

// «Orders», step 3f-3: the send arrow, the send screen, the road chooser, the send editor (v1.145.0: it replaces «Photo or text?») and «Send it now».

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

const TODAY = todayISO();
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;
// The venue lets staff use WhatsApp alone: ONE road, taken in the press. (A venue that has not touched its send settings also
// offers «to the manager», so a chooser would open — OrdersSection.listsSend.spec.tsx covers that.)
const WHATSAPP_ONLY = { sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: false } };
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
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, draft: DRAFT, ordersConfig: WHATSAPP_ONLY, ...options });
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

// Escape, once the focus is inside the open dialog: before that, on a slow runner, the key lands on the page and nothing hears it.
async function escapeFrom(view: View, dialog: HTMLElement) {
  await waitFor(() => { expect(dialog.contains(document.activeElement)).toBe(true); }, LOAD);
  await view.user.keyboard('{Escape}');
}

// After a send that reached suppliers the screen goes back to the LIST and «did it go?» waits on every device (v1.145.0): nothing is
// recorded by the send, and the confirm screen is no longer in the road.
async function backAtList(view: View) {
  await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); }, LOAD);
}
type Asked = { at: string; date: string; quantities: Record<string, number>; units: Record<string, string>; draft?: unknown };
const asking = (source: FakeOrdersSource) => (source.draft?.awaitingSent ?? {}) as Record<string, Asked>;
async function waitingFor(source: FakeOrdersSource, ...ids: string[]) {
  await waitFor(() => { expect(Object.keys(asking(source)).sort()).toEqual([...ids].sort()); }, LOAD);
}

// The send editor of one message (SendEditorDialog.tsx): «Send» in it is the press that opens the window or starts the share.
const editorOf = async (name: string | RegExp = 'Check the order') => within(await screen.findByRole('dialog', { name }, LOAD));
async function editorSend(view: View, name: string | RegExp = 'Check the order') {
  const editor = await editorOf(name);
  await waitFor(() => { expect(editor.getByRole('button', { name: 'Send' })).toBeEnabled(); }, LOAD);
  await view.user.click(editor.getByRole('button', { name: 'Send' }));
}

const pressed = (open: ReturnType<typeof spyOpen>) => open.mock.calls.map(call => String(call[0]));
const textOf = (url: string) => decodeURIComponent(url.slice(url.indexOf('?text=') + '?text='.length));

function spyOpen(result: unknown = { opener: null }) {
  return vi.spyOn(window, 'open').mockImplementation(() => result as Window | null);
}

// ⚠️ A press and what follows it IN THE SAME TASK: the click, then only microtasks (no timer, no waitFor). A window opened by
// a later task would be a blocked pop-up in a real browser; an answer that is merely awaited from the press is still the tap.
async function pressThenMicrotasks(button: HTMLElement) {
  act(() => { button.click(); });
  for (let hop = 0; hop < 60; hop++) await Promise.resolve();
}

function allowShare(rejection?: unknown) {
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
  const share = vi.fn(() => (rejection === undefined ? Promise.resolve() : Promise.reject(rejection as Error)));
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
    const source = seeded();
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendButton());
    // ⚠️ The send editor comes first: nothing opens until the person has seen the message and pressed ITS «Send».
    const editor = await editorOf();
    expect(open).not.toHaveBeenCalled();
    expect(editor.getByRole('group', { name: 'What they will receive' })).toHaveTextContent('- Flour 00: 2');
    const press = editor.getByRole('button', { name: 'Send' });
    act(() => {
      press.click();
      // ⚠️ Synchronously: a window opened after any await would be blocked as a pop-up.
      expect(open).toHaveBeenCalledTimes(1);
    });
    const url = pressed(open)[0] ?? '';
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const text = textOf(url);
    expect(text).toContain('Alpine Mills');
    expect(text).toContain('*Zed*');
    expect(text).toContain('- Flour 00: 2');
    // Back at the list, with ONE question per supplier, written whole with exactly what went, and nothing recorded.
    await backAtList(view);
    await waitingFor(source, 's-alp', 's-zed');
    expect(asking(source)['s-alp']).toMatchObject({ date: TODAY, quantities: { 'i-flour': 2, 'i-rye': 3 } });
    expect(asking(source)['s-zed']).toMatchObject({ date: TODAY, quantities: { 'i-milk': 4 } });
    expect(asking(source)['s-alp']?.at).toBe(asking(source)['s-zed']?.at);
    expect(source.records.size).toBe(0);
    // The banners ask on the list, on this device and on every other.
    expect(await screen.findByText(/^Order to Alpine Mills sent at .+: did it go\?$/)).toBeInTheDocument();
    expect(screen.getByText(/^Order to Zed sent at .+: did it go\?$/)).toBeInTheDocument();
  });

  it('writes ONE list when asked to', async () => {
    const open = spyOpen();
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendScreen().getByRole('radio', { name: 'One list' }));
    await view.user.click(sendButton());
    await editorSend(view);
    const text = textOf(pressed(open)[0] ?? '');
    expect(text).not.toContain('Alpine Mills');
    expect(text).toContain('- Flour 00: 2');
  });

  it('«Yes» on the banner records what WENT, on the day it was for, and clears only what was sent', async () => {
    spyOpen();
    const source = seeded();
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    await editorSend(view);
    await backAtList(view);
    await waitingFor(source, 's-alp');
    // A colleague types the rye again after the send: it is the next order, and survives.
    source.remoteMerge({ entries: { 'i-rye': { qty: 7 } } });
    const sentence = await screen.findByText(/^Order to Alpine Mills sent at .+: did it go\?$/);
    await view.user.click(screen.getByRole('button', { name: 'Yes', description: sentence.textContent ?? '' }));
    await waitFor(() => { expect(source.records.has(`${TODAY}_s-alp`)).toBe(true); });
    expect(source.records.get(`${TODAY}_s-alp`)?.quantities).toEqual({ 'i-flour': 2, 'i-rye': 3 });
    expect(source.records.has(`${TODAY}_s-zed`)).toBe(false);
    await waitingFor(source);
    await waitFor(() => { expect((source.draft?.entries as Record<string, unknown>)['i-flour']).toBeUndefined(); });
    expect((source.draft?.entries as Record<string, { qty: number }>)['i-rye']?.qty).toBe(7);
    expect(await screen.findByText('Alpine Mills — order saved to history ✓')).toBeInTheDocument();
  });

  it('goes back to the LIST after a send, not to a confirm screen and not to the send screen', async () => {
    spyOpen();
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    await editorSend(view);
    await backAtList(view);
    await waitFor(() => { expect(screen.queryByRole('region', { name: 'Send order' })).not.toBeInTheDocument(); });
    expect(screen.queryByRole('region', { name: 'Order sent' })).not.toBeInTheDocument();
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
    const alert = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(alert).getByText(/^Already ordered from this supplier today: Cake box — carton\./)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Check the order' })).not.toBeInTheDocument();
    await view.user.click(within(alert).getByRole('button', { name: 'OK' }));
    expect(view.router.state.location.pathname).toBe('/orders/send');
    await waitFor(() => { expect(sendButton()).toBeEnabled(); });
  });

  it('says «Nothing was opened» and stays when the browser blocks the window', async () => {
    spyOpen(null);
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    await editorSend(view);
    expect(await screen.findByText(/^Nothing was opened/)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/send');
    expect(screen.queryByRole('region', { name: 'Order sent' })).not.toBeInTheDocument();
  });

  it('says there is no way to send when the venue offers an employee only the in-app list and has turned order lists off', async () => {
    const open = spyOpen();
    const source = seeded({ ordersConfig: { orderLists: false, sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } } });
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const alert = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(alert).getByText(/^There is no way to send this order/)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('several roads', () => {
  it('shows the road chooser to a manager, with every road, and Escape closes it with nothing opened', async () => {
    const open = spyOpen();
    const view = await atList(seeded());
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const chooser = await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD);
    const roads = within(chooser).getAllByRole('button').map(button => button.textContent ?? '');
    expect(roads).toHaveLength(5);
    expect(roads[0]).toContain('To whoever runs the place, in the app');
    expect(roads[1]).toContain('WhatsApp — I choose the chat');
    expect(roads[2]).toContain('WhatsApp straight to the supplier');
    expect(roads[3]).toContain('Email to the supplier');
    expect(roads[3]).toContain('it does not send it by itself');
    expect(roads[4]).toBe('Cancel');
    await escapeFrom(view, await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'How should this order go?' })).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
    expect(view.router.state.location.pathname).toBe('/orders/send');
  });

  it('takes the road that was pressed, straight to the supplier’s number', async () => {
    const open = spyOpen();
    const view = await atList(seeded());
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const chooser = within(await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD));
    const road = chooser.getByRole('button', { name: /^WhatsApp straight to the supplier/ });
    await view.user.click(road);
    // The road shows the message first; the editor's own press opens the window.
    const editor = await editorOf('Order for Zed');
    expect(open).not.toHaveBeenCalled();
    act(() => {
      editor.getByRole('button', { name: 'Send' }).click();
      // ⚠️ Synchronously, in the editor's own press.
      expect(open).toHaveBeenCalledTimes(1);
    });
    expect(pressed(open)[0]?.startsWith('https://wa.me/447700900123?text=')).toBe(true);
    await backAtList(view);
  });

  it('names a supplier with no phone under the road straight to the supplier', async () => {
    spyOpen();
    const view = await atList(seeded());
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendButton());
    const chooser = within(await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD));
    expect(chooser.getByRole('button', { name: /^WhatsApp straight to the supplier/ })).toHaveTextContent('no contact saved for Alpine Mills');
  });
});

describe('the send editor and the order picture', () => {
  it('shows each message in its own editor, shares one picture per supplier and names the one that was skipped', async () => {
    const share = allowShare();
    const open = spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toSend(view, 'Zed', 'Café');
    await view.user.click(sendButton());
    // The picture is drawn ahead of the tap: «Send» waits for it, and the press shares it (no «Photo or text?» any more).
    const first = await editorOf('Order for Café Bar Srl (1 of 2)');
    expect(screen.queryByRole('dialog', { name: 'How do you want to send it?' })).not.toBeInTheDocument();
    await waitFor(() => { expect(first.getByRole('button', { name: 'Send' })).toBeEnabled(); }, LOAD);
    await view.user.click(first.getByRole('button', { name: 'Send' }));
    expect(share).toHaveBeenCalledTimes(1);

    const second = await editorOf('Order for Zed (2 of 2)');
    await view.user.click(second.getByRole('button', { name: 'Skip' }));

    const notice = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(notice).getByText('Not sent: Zed')).toBeInTheDocument();
    await view.user.click(within(notice).getByRole('button', { name: 'OK' }));
    expect(open).not.toHaveBeenCalled();

    // Only the supplier whose picture was shared is asked about.
    await backAtList(view);
    await waitingFor(source, 's-caf');
    expect(source.records.size).toBe(0);
  });

  it('⚠️ shares the picture of the EDITED message and opens nothing', async () => {
    const share = allowShare();
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const editor = await editorOf('Order for Zed');
    const box = editor.getByRole('textbox', { name: 'Change the message' });
    await view.user.click(box);
    await view.user.keyboard(' (call before 9)');
    await editorSend(view, 'Order for Zed');
    expect(share).toHaveBeenCalledTimes(1);
    const [{ files }] = share.mock.calls[0] as unknown as [{ files: File[] }];
    expect(await files[0]?.text()).toContain('(call before 9)');
    expect(vi.mocked(renderOrderImage)).toHaveBeenLastCalledWith(expect.stringContaining('(call before 9)'), expect.anything());
    expect(open).not.toHaveBeenCalled();
  });

  it('where the browser cannot share a picture the press opens the text, and an edit reaches the link', async () => {
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const editor = await editorOf('Order for Zed');
    await view.user.click(editor.getByRole('textbox', { name: 'Change the message' }));
    await view.user.keyboard(' PLUS ONE SACK');
    act(() => { editor.getByRole('button', { name: 'Send' }).click(); });
    // ⚠️ In the press itself, from the edited text.
    expect(open).toHaveBeenCalledTimes(1);
    expect(pressed(open)[0]?.startsWith('https://wa.me/447700900123?text=')).toBe(true);
    expect(textOf(pressed(open)[0] ?? '')).toContain('PLUS ONE SACK');
    await backAtList(view);
  });

  it('sends nothing when the editor is left, and stays on the send screen', async () => {
    allowShare();
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    await escapeFrom(view, await screen.findByRole('dialog', { name: 'Order for Zed' }, LOAD));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Order for Zed' })).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
    expect(view.router.state.location.pathname).toBe('/orders/send');
  });
});

describe('a send holds the reload', () => {
  it('⚠️ holds it between two editors and until the send has settled, then lets go', async () => {
    spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    expect(isBusy()).toBe(false);
    await toSend(view, 'Zed', 'Café');
    await view.user.click(sendButton());
    await editorOf('Order for Café Bar Srl (1 of 2)');
    expect(isBusy()).toBe(true);
    await editorSend(view, 'Order for Café Bar Srl (1 of 2)');
    await editorOf('Order for Zed (2 of 2)');
    expect(isBusy()).toBe(true);
    await editorSend(view, 'Order for Zed (2 of 2)');
    await backAtList(view);
    await waitFor(() => { expect(isBusy()).toBe(false); }, LOAD);
  });

  it('lets go when the chooser is cancelled', async () => {
    const view = await atList(seeded({ ordersConfig: null }), { session: { canManage: true, role: 'manager', isOwner: false } });
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const chooser = await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD);
    expect(isBusy()).toBe(true);
    await escapeFrom(view, chooser);
    await waitFor(() => { expect(isBusy()).toBe(false); }, LOAD);
  });
});

describe('«Send it now» on the confirm screen', () => {
  async function toConfirmAll(view: View) {
    await view.user.click(screen.getByRole('button', { name: 'Order placed…' }));
    await view.user.click(await screen.findByRole('button', { name: 'Order placed' }));
    await screen.findByText('This is what will be recorded:', undefined, LOAD);
  }

  it('sends the CORRECTED numbers and records NOTHING: the question waits with them, and with what the order said before', async () => {
    const open = spyOpen();
    const source = seeded();
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    const rye = screen.getByRole('spinbutton', { name: 'Rye 25kg — Order' });
    await view.user.clear(rye);
    await view.user.type(rye, '9');
    const confirm = within(screen.getByRole('region', { name: 'Record these orders' }));
    await view.user.click(confirm.getByRole('button', { name: 'Order placed' }));
    const asked = within(await screen.findByRole('alertdialog', undefined, LOAD));
    expect(asked.getByRole('button', { name: 'Yes, sent' })).toHaveFocus();
    await view.user.click(asked.getByRole('button', { name: 'Send them now' }));
    // The corrected numbers are in the message the editor shows, and the press sends it.
    expect((await editorOf()).getByRole('group', { name: 'What they will receive' })).toHaveTextContent('Rye: 9');
    await editorSend(view);
    await waitFor(() => { expect(open).toHaveBeenCalled(); });
    expect(textOf(pressed(open)[0] ?? '')).toContain('Rye: 9');
    await backAtList(view);
    await waitingFor(source, 's-alp', 's-caf', 's-zed');
    // The CONFIRMED numbers, and — because the person corrected the rye — what the order said before, so «Yes» clears the lines that
    // still read it (a corrected 3 → 9 must not stay behind as a phantom order).
    expect(asking(source)['s-alp']).toMatchObject({
      quantities: { 'i-flour': 2, 'i-rye': 9 },
      draft: { quantities: { 'i-flour': 2, 'i-rye': 3 } },
    });
    expect(source.records.size).toBe(0);
  });

  it('asks about ONLY the suppliers the road reached and names the one it did not', async () => {
    const open = spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Send them now' }));
    // ⚠️ ONE window per tap: each editor's own «Send» opens its window, none opens in «Send them now».
    expect(open).not.toHaveBeenCalled();
    await editorSend(view, 'Order for Café Bar Srl (1 of 2)');
    expect(open).toHaveBeenCalledTimes(1);
    const next = await editorOf('Order for Zed (2 of 2)');
    act(() => {
      next.getByRole('button', { name: 'Send' }).click();
      expect(open).toHaveBeenCalledTimes(2);
    });
    await backAtList(view);
    // Only the suppliers the road reached are asked about; the one it did not reach is named.
    await waitingFor(source, 's-caf', 's-zed');
    expect(source.records.size).toBe(0);
    expect(await screen.findByText(/Not sent, still to do: Alpine Mills/)).toBeInTheDocument();
  });

  it('records nothing when no window opened, and stays', async () => {
    spyOpen(null);
    const source = seeded();
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Send them now' }));
    await editorSend(view);
    expect(await screen.findByText(/Not sent, still to do: /)).toBeInTheDocument();
    expect(source.records.size).toBe(0);
    expect(view.router.state.location.pathname).toBe('/orders/place-all/confirm');
  });

  it('does not offer «Send it now» when no road reaches a supplier', async () => {
    const source = seeded({ ordersConfig: { sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } } });
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    const asked = within(await screen.findByRole('alertdialog', undefined, LOAD));
    expect(asked.getByRole('button', { name: 'Yes, sent' })).toBeInTheDocument();
    expect(asked.queryByRole('button', { name: /Send (it|them) now/ })).not.toBeInTheDocument();
  });
});

describe('one window per tap', () => {
  const TWO_EMAILS = [
    supplier('s-one', { name: 'One Mill', email: 'one@mill.test' }),
    supplier('s-two', { name: 'Two Dairy', email: 'two@dairy.test' }),
  ];
  const TWO_ITEMS = [
    ingredient('i-a', { name: 'Flour', supplierId: 's-one' }),
    ingredient('i-b', { name: 'Milk', supplierId: 's-two' }),
  ];
  const TWO_DRAFT = { entries: { 'i-a': { qty: 1 }, 'i-b': { qty: 2 } }, days: { 's-one': TODAY, 's-two': TODAY } };

  it('opens each window inside its own editor\'s press, none in the tap that started the send', async () => {
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toSend(view, 'Zed', 'Café');
    act(() => {
      sendButton().click();
      expect(open).not.toHaveBeenCalled();
    });
    const first = await editorOf('Order for Café Bar Srl (1 of 2)');
    await waitFor(() => { expect(first.getByRole('button', { name: 'Send' })).toHaveFocus(); });
    act(() => {
      first.getByRole('button', { name: 'Send' }).click();
      // ⚠️ Synchronously, in the first editor's own press.
      expect(open).toHaveBeenCalledTimes(1);
    });
    const next = await editorOf('Order for Zed (2 of 2)');
    expect(open).toHaveBeenCalledTimes(1);
    const press = next.getByRole('button', { name: 'Send' });
    await waitFor(() => { expect(press).toHaveFocus(); });
    act(() => {
      press.click();
      expect(open).toHaveBeenCalledTimes(2);
    });
    expect(pressed(open)[0]?.startsWith('https://wa.me/39021234567?text=')).toBe(true);
    expect(pressed(open)[1]?.startsWith('https://wa.me/447700900123?text=')).toBe(true);
    await backAtList(view);
  });

  it('Skip leaves that supplier unsent and names it', async () => {
    const open = spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toSend(view, 'Zed', 'Café');
    await view.user.click(sendButton());
    await editorSend(view, 'Order for Café Bar Srl (1 of 2)');
    const next = await editorOf('Order for Zed (2 of 2)');
    await view.user.click(next.getByRole('button', { name: 'Skip' }));
    const notice = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(notice).getByText('Not sent: Zed')).toBeInTheDocument();
    await view.user.click(within(notice).getByRole('button', { name: 'OK' }));
    expect(open).toHaveBeenCalledTimes(1);
    await backAtList(view);
    await waitingFor(source, 's-caf');
    expect(await screen.findByText(/Not sent, still to do: Zed/)).toBeInTheDocument();
  });

  it('by email, Escape in the second editor stops the batch and names the rest', async () => {
    const open = spyOpen();
    const source = fakeOrdersSource({ suppliers: TWO_EMAILS, ingredients: TWO_ITEMS, draft: TWO_DRAFT });
    const view = await atList(source);
    await toSend(view, 'One Mill', 'Two Dairy');
    await view.user.click(sendButton());
    const chooser = within(await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD));
    await view.user.click(chooser.getByRole('button', { name: /^Email to the supplier/ }));
    const first = await editorOf('Order for One Mill (1 of 2)');
    // An email is shown as it will arrive: plain, the asterisks as they are.
    expect(first.getByRole('group', { name: 'What they will receive' })).toHaveTextContent('*Order — Bakery*');
    act(() => {
      first.getByRole('button', { name: 'Send' }).click();
      expect(open).toHaveBeenCalledTimes(1);
    });
    expect(pressed(open)[0]?.startsWith('mailto:')).toBe(true);
    await escapeFrom(view, await screen.findByRole('dialog', { name: 'Order for Two Dairy (2 of 2)' }, LOAD));
    const notice = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(notice).getByText('Not sent: Two Dairy')).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a window that throws counts as blocked: the person is told, the button is free again, the log carries the error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('boom'); });
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    await editorSend(view);
    expect(await screen.findByText(/^Nothing was opened/)).toBeInTheDocument();
    await waitFor(() => { expect(sendButton()).toBeEnabled(); });
    expect(error).toHaveBeenCalled();
    expect(view.router.state.location.pathname).toBe('/orders/send');
  });
});

describe('naming the suppliers a send did not reach', () => {
  it('says so on the way back to the list when a ticked supplier has no phone (no chooser to warn)', async () => {
    const open = spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendButton());
    await editorSend(view, 'Order for Zed');
    await backAtList(view);
    await waitingFor(source, 's-zed');
    expect(open).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Not sent, still to do: Alpine Mills/)).toBeInTheDocument();
  });
});

describe('the order picture, when the share goes wrong', () => {
  async function toPhoto(view: View) {
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    await editorOf('Order for Zed');
  }

  it('keeps the editor and records nothing when the person closes the share sheet', async () => {
    const share = allowShare(Object.assign(new Error('closed'), { name: 'AbortError' }));
    const open = spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toPhoto(view);
    await editorSend(view, 'Order for Zed');
    await waitFor(() => { expect(share).toHaveBeenCalledTimes(1); });
    const editor = await editorOf('Order for Zed');
    await waitFor(() => { expect(editor.getByRole('button', { name: 'Send' })).toBeEnabled(); });
    expect(open).not.toHaveBeenCalled();
    expect(source.records.size).toBe(0);
    expect(view.router.state.location.pathname).toBe('/orders/send');
  });

  it('offers the text when the share fails any other way, and OK opens it', async () => {
    allowShare(new Error('no sheet'));
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toPhoto(view);
    await editorSend(view, 'Order for Zed');
    const ask = within(await screen.findByRole('alertdialog', undefined, LOAD));
    expect(ask.getByText('Couldn’t share the photo, sending the text instead.')).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    await pressThenMicrotasks(ask.getByRole('button', { name: 'OK' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens the text in the press of the OK when the picture could not be drawn', async () => {
    allowShare();
    // Every drawing fails (the app may draw twice on mount); the stand-in is put back at the end.
    vi.mocked(renderOrderImage).mockRejectedValue(new Error('no canvas'));
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toPhoto(view);
    // A drawing that failed leaves «Send» on: its press answers «failed» and the batch asks about the text.
    await editorSend(view, 'Order for Zed');
    const ask = within(await screen.findByRole('alertdialog', undefined, LOAD));
    expect(open).not.toHaveBeenCalled();
    await pressThenMicrotasks(ask.getByRole('button', { name: 'OK' }));
    expect(open).toHaveBeenCalledTimes(1);
    vi.mocked(renderOrderImage).mockImplementation(text => Promise.resolve(new File([text], 'order.png', { type: 'image/png' })));
  });
});

describe('«Did you send it?»', () => {
  it('records nothing and keeps the screen on Escape', async () => {
    const source = seeded();
    const view = await atList(source, STAFF);
    await view.user.click(screen.getByRole('button', { name: 'Order placed…' }));
    await view.user.click(await screen.findByRole('button', { name: 'Order placed' }));
    await screen.findByText('This is what will be recorded:', undefined, LOAD);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await escapeFrom(view, await screen.findByRole('alertdialog', undefined, LOAD));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.records.size).toBe(0);
    expect(view.router.state.location.pathname).toBe('/orders/place-all/confirm');
    expect(screen.getByText('This is what will be recorded:')).toBeInTheDocument();
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

describe('the package word (Mise 2 only)', () => {
  it('⚠️ the message the supplier gets says «- Cream: 2 bottles», and the plain lines stay plain', async () => {
    const open = spyOpen();
    const source = fakeOrdersSource({
      suppliers: SUPPLIERS,
      ingredients: [...ITEMS, ingredient('i-cream', { name: 'Cream', supplierId: 's-alp', unit: 'bottle', packUnit: 'bottle' })],
      draft: { entries: { ...DRAFT.entries, 'i-cream': { qty: 2 } }, days: DRAFT.days },
      ordersConfig: WHATSAPP_ONLY,
    });
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    await editorSend(view);
    const text = textOf(pressed(open)[0] ?? '');
    expect(text).toContain('- Cream: 2 bottles');
    expect(text).toContain('- Flour 00: 2');
    await backAtList(view);
    await waitingFor(source, 's-alp');
  });
});

describe('leaving the send screen in the middle of a batch', () => {
  it('⚠️ an order that already went still waits for «did it go?» when the screen is left with the next editor open', async () => {
    spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toSend(view, 'Zed', 'Café');
    await view.user.click(sendButton());
    await editorSend(view, 'Order for Café Bar Srl (1 of 2)');
    await editorOf('Order for Zed (2 of 2)');
    // The phone's back gesture, with the second editor still open.
    await act(async () => { await view.router.navigate(-1); });
    await backAtList(view);
    await waitingFor(source, 's-caf');
  });
});
