import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';
import { renderOrderImage } from './orderImage';

// There is no canvas in jsdom: the order picture is a stand-in file.
vi.mock('./orderImage', async importOriginal => ({
  ...await importOriginal<typeof import('./orderImage')>(),
  renderOrderImage: vi.fn((text: string) => Promise.resolve(new File([text], 'order.png', { type: 'image/png' }))),
}));

// «Orders», step 3f-3: the send arrow, the send screen, the road chooser and «Send it now» — since the current app's PR #554 every
// message goes through the in-app send editor (as a picture where the phone can share a file), and what was handed over waits for
// «did it go?» instead of being recorded (OrdersSection.awaiting.spec.tsx covers the answers).

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

// The send editor of one message, by its title («Order for Zed», «Order for Zed (2 of 2)», «Check the order» for the grouped chat).
const editor = async (name: string) => within(await screen.findByRole('dialog', { name }, LOAD));

// «Send» in the editor, once it is enabled (on the picture road it waits for the picture), pressed in a task of its own.
async function editorSend(name: string) {
  const box = await editor(name);
  const button = box.getByRole('button', { name: 'Send' });
  await waitFor(() => { expect(button).toBeEnabled(); }, LOAD);
  return button;
}

// The banner every device shows once an order was handed over.
const didItGo = (supplierName: string) => screen.findByText(new RegExp(`^Order to ${supplierName} sent at .+: did it go\\?$`), undefined, LOAD);

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

describe('one open road: the send editor', () => {
  it('shows exactly what the supplier will get, opens WhatsApp INSIDE «Send»’s own press, and leaves «did it go?» behind', async () => {
    const open = spyOpen();
    const source = seeded();
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendButton());
    const box = await editor('Check the order');
    // Nothing opened yet: the person sees the message first.
    expect(open).not.toHaveBeenCalled();
    const preview = box.getByRole('group', { name: 'What they will receive' });
    expect(preview).toHaveTextContent('- Flour 00: 2');
    // *Zed* drawn bold, as WhatsApp draws it.
    expect(within(preview).getByText('Zed', { selector: 'strong' })).toBeInTheDocument();
    expect(box.getByRole('textbox', { name: 'Change the message' })).toHaveAccessibleDescription(
      'Changes go only into the message: History keeps the quantities of the order.');
    const send = await editorSend('Check the order');
    act(() => {
      send.click();
      // ⚠️ Synchronously, in the editor's own press: a window opened after any await would be blocked as a pop-up.
      expect(open).toHaveBeenCalledTimes(1);
    });
    const url = pressed(open)[0] ?? '';
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(textOf(url)).toContain('*Zed*');
    // Back to the list, nothing recorded: every device now asks whether it went.
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    expect(await didItGo('Alpine Mills')).toBeInTheDocument();
    expect(await didItGo('Zed')).toBeInTheDocument();
    expect(source.records.size).toBe(0);
    const awaiting = source.draft?.awaitingSent as Record<string, { quantities: unknown; date: string }>;
    expect(awaiting['s-alp']?.quantities).toEqual({ 'i-flour': 2, 'i-rye': 3 });
    expect(awaiting['s-zed']?.quantities).toEqual({ 'i-milk': 4 });
    expect(awaiting['s-alp']?.date).toBe(TODAY);
  });

  it('⚠️ sends the EDITED text, while «did it go?» keeps the quantities of the order', async () => {
    const open = spyOpen();
    const source = seeded();
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const box = await editor('Check the order');
    const area = box.getByRole('textbox', { name: 'Change the message' });
    await view.user.type(area, '{End}\n- Salt: 1');
    expect(box.getByRole('group', { name: 'What they will receive' })).toHaveTextContent('- Salt: 1');
    act(() => { box.getByRole('button', { name: 'Send' }).click(); });
    expect(textOf(pressed(open)[0] ?? '')).toContain('- Salt: 1');
    await didItGo('Alpine Mills');
    expect((source.draft?.awaitingSent as Record<string, { quantities: unknown }>)['s-alp']?.quantities).toEqual({ 'i-flour': 2, 'i-rye': 3 });
  });

  it('writes ONE list when asked to', async () => {
    const open = spyOpen();
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendScreen().getByRole('radio', { name: 'One list' }));
    await view.user.click(sendButton());
    act(() => { void editorSend('Check the order').then(button => { button.click(); }); });
    await waitFor(() => { expect(open).toHaveBeenCalledTimes(1); });
    const text = textOf(pressed(open)[0] ?? '');
    expect(text).not.toContain('Alpine Mills');
    expect(text).toContain('- Flour 00: 2');
  });

  it('Cancel with nothing changed closes the editor and sends nothing', async () => {
    const open = spyOpen();
    const source = seeded();
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    const box = await editor('Check the order');
    await view.user.click(box.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Check the order' })).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
    expect(view.router.state.location.pathname).toBe('/orders/send');
    expect(source.draft?.awaitingSent).toBeUndefined();
  });

  it('⚠️ leaving with edits asks «Discard your changes?»: Keep editing keeps the text, Discard sends nothing', async () => {
    const open = spyOpen();
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    let box = await editor('Check the order');
    await view.user.type(box.getByRole('textbox', { name: 'Change the message' }), ' extra');
    await view.user.click(box.getByRole('button', { name: 'Cancel' }));
    let ask = within(await screen.findByRole('alertdialog', { name: 'Discard your changes?' }, LOAD));
    expect(ask.getByText('The text you changed will not be sent.')).toBeInTheDocument();
    await view.user.click(ask.getByRole('button', { name: 'Keep editing' }));
    box = await editor('Check the order');
    expect((box.getByRole('textbox', { name: 'Change the message' }) as HTMLTextAreaElement).value).toContain(' extra');
    await escapeFrom(view, screen.getByRole('dialog', { name: 'Check the order' }));
    ask = within(await screen.findByRole('alertdialog', { name: 'Discard your changes?' }, LOAD));
    await view.user.click(ask.getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(screen.queryByRole('dialog', { name: 'Check the order' })).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a unit clash with today’s record, says it and opens no editor', async () => {
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
    expect(screen.queryByRole('dialog', { name: 'Check the order' })).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    await view.user.click(within(alert).getByRole('button', { name: 'OK' }));
    expect(view.router.state.location.pathname).toBe('/orders/send');
    await waitFor(() => { expect(sendButton()).toBeEnabled(); });
  });

  it('says «Nothing was opened» and stays, asking nobody, when the browser blocks the window', async () => {
    spyOpen(null);
    const source = seeded();
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    await view.user.click(await editorSend('Check the order'));
    expect(await screen.findByText(/^Nothing was opened/)).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/orders/send');
    expect(source.draft?.awaitingSent).toBeUndefined();
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

  it('says a friendly line and frees the button when the send throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('boom'); });
    const view = await atList(seeded(), STAFF);
    await toSend(view, 'Alpine Mills');
    await view.user.click(sendButton());
    await view.user.click(await editorSend('Check the order'));
    expect(await screen.findByText('Something went wrong while sending. Try again.')).toBeInTheDocument();
    await waitFor(() => { expect(sendButton()).toBeEnabled(); });
    expect(error).toHaveBeenCalled();
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
    await escapeFrom(view, chooser);
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'How should this order go?' })).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
    expect(view.router.state.location.pathname).toBe('/orders/send');
  });

  it('takes the road that was pressed: the editor for that supplier, then straight to the supplier’s number', async () => {
    const open = spyOpen();
    const view = await atList(seeded());
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const chooser = within(await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD));
    await view.user.click(chooser.getByRole('button', { name: /^WhatsApp straight to the supplier/ }));
    const send = await editorSend('Order for Zed');
    act(() => { send.click(); });
    expect(pressed(open)[0]?.startsWith('https://wa.me/447700900123?text=')).toBe(true);
    await didItGo('Zed');
  });

  it('names a supplier with no phone under the road straight to the supplier', async () => {
    spyOpen();
    const view = await atList(seeded());
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendButton());
    const chooser = within(await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD));
    expect(chooser.getByRole('button', { name: /^WhatsApp straight to the supplier/ })).toHaveTextContent('no contact saved for Alpine Mills');
  });

  it('by email, one editor per supplier; Escape stops the batch and names the rest', async () => {
    const TWO_EMAILS = [supplier('s-one', { name: 'One Mill', email: 'one@mill.test' }), supplier('s-two', { name: 'Two Dairy', email: 'two@dairy.test' })];
    const TWO_ITEMS = [ingredient('i-a', { name: 'Flour', supplierId: 's-one' }), ingredient('i-b', { name: 'Milk', supplierId: 's-two' })];
    const open = spyOpen();
    const source = fakeOrdersSource({ suppliers: TWO_EMAILS, ingredients: TWO_ITEMS, draft: { entries: { 'i-a': { qty: 1 }, 'i-b': { qty: 2 } }, days: {} } });
    const view = await atList(source);
    await toSend(view, 'One Mill', 'Two Dairy');
    await view.user.click(sendButton());
    const chooser = within(await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD));
    await view.user.click(chooser.getByRole('button', { name: /^Email to the supplier/ }));
    // The mail app shows the asterisks as they are: so does the preview.
    const first = await editor('Order for One Mill (1 of 2)');
    expect(first.getByRole('group', { name: 'What they will receive' }).querySelector('strong')).toBeNull();
    act(() => { first.getByRole('button', { name: 'Send' }).click(); });
    expect(pressed(open)[0]?.startsWith('mailto:one%40mill.test')).toBe(true);
    await escapeFrom(view, await screen.findByRole('dialog', { name: 'Order for Two Dairy (2 of 2)' }, LOAD));
    const notice = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(notice).getByText('Not sent: Two Dairy')).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('the order AS A PICTURE through the share sheet', () => {
  it('shares one picture per supplier, drawn from the edited text; Skip names the one skipped; asks «did it go?» at once', async () => {
    const share = allowShare();
    const open = spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toSend(view, 'Zed', 'Café');
    await view.user.click(sendButton());
    // ⚠️ No «photo or text?» question any more: the phone can share a file, so the order goes as a picture.
    expect(screen.queryByRole('dialog', { name: 'How do you want to send it?' })).not.toBeInTheDocument();
    const first = await editor('Order for Café Bar Srl (1 of 2)');
    await view.user.type(first.getByRole('textbox', { name: 'Change the message' }), '{End}\n- Zucchero: 2');
    const send = await editorSend('Order for Café Bar Srl (1 of 2)');
    act(() => { send.click(); });
    expect(share).toHaveBeenCalledTimes(1);
    const shared = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0];
    expect(await shared?.text()).toContain('- Zucchero: 2');
    expect(vi.mocked(renderOrderImage)).toHaveBeenCalled();

    const second = await editor('Order for Zed (2 of 2)');
    await view.user.click(second.getByRole('button', { name: 'Skip' }));
    const notice = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(notice).getByText('Not sent: Zed')).toBeInTheDocument();
    await view.user.click(within(notice).getByRole('button', { name: 'OK' }));
    expect(open).not.toHaveBeenCalled();

    // Only the supplier whose picture was shared waits for an answer — and THIS device asks at once: the person is back here already.
    const asked = within(await screen.findByRole('alertdialog', { name: /^Order to Café Bar Srl sent at .+: did it go\?$/ }, LOAD));
    expect(asked.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(asked.getByRole('button', { name: 'No' })).toBeInTheDocument();
    expect(Object.keys(source.draft?.awaitingSent as object)).toStrictEqual(['s-caf']);
  });

  it('⚠️ falls back to the text by wa.me when the phone cannot share a file', async () => {
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => false), configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true });
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const send = await editorSend('Order for Zed');
    act(() => { send.click(); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(pressed(open)[0]?.startsWith('https://wa.me/447700900123?text=')).toBe(true);
    expect(navigator.share).not.toHaveBeenCalled();
  });

  it('⚠️ ignores Cancel and Escape while the share sheet is open', async () => {
    let answerShare: () => void = () => undefined;
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    const share = vi.fn(() => new Promise<void>(resolve => { answerShare = resolve; }));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    const send = await editorSend('Order for Zed');
    act(() => { send.click(); });
    expect(share).toHaveBeenCalledTimes(1);
    const box = await editor('Order for Zed');
    await view.user.click(box.getByRole('button', { name: 'Cancel' }));
    await view.user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Order for Zed' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog', { name: 'Discard your changes?' })).not.toBeInTheDocument();
    act(() => { answerShare(); });
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Order for Zed' })).not.toBeInTheDocument(); });
    expect(Object.keys(source.draft?.awaitingSent as object)).toStrictEqual(['s-zed']);
  });

  it('keeps the editor and sends nothing when the person closes the share sheet', async () => {
    const share = allowShare(Object.assign(new Error('closed'), { name: 'AbortError' }));
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    await view.user.click(await editorSend('Order for Zed'));
    await waitFor(() => { expect(share).toHaveBeenCalledTimes(1); });
    await editorSend('Order for Zed');
    expect(source.draft?.awaitingSent).toBeUndefined();
    expect(view.router.state.location.pathname).toBe('/orders/send');
  });

  it('offers the text when the share fails any other way, and OK opens it', async () => {
    allowShare(new Error('no sheet'));
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    await view.user.click(await editorSend('Order for Zed'));
    const ask = within(await screen.findByRole('alertdialog', undefined, LOAD));
    expect(ask.getByText('Couldn’t share the photo, sending the text instead.')).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    await pressThenMicrotasks(ask.getByRole('button', { name: 'OK' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('offers the text when the picture could not be drawn', async () => {
    allowShare();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(renderOrderImage).mockRejectedValueOnce(new Error('no canvas'));
    const open = spyOpen();
    const view = await atList(seeded({ ordersConfig: DIRECT_ONLY }), STAFF);
    await toSend(view, 'Zed');
    await view.user.click(sendButton());
    await view.user.click(await editorSend('Order for Zed'));
    const ask = within(await screen.findByRole('alertdialog', undefined, LOAD));
    await pressThenMicrotasks(ask.getByRole('button', { name: 'OK' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });
});

describe('«Send it now» on the confirm screen', () => {
  async function toConfirmAll(view: View) {
    await view.user.click(screen.getByRole('button', { name: 'Order placed…' }));
    await view.user.click(await screen.findByRole('button', { name: 'Order placed' }));
    await screen.findByText('This is what will be recorded:', undefined, LOAD);
  }

  it('⚠️ sends the CORRECTED numbers, records NOTHING, and leaves them waiting for «did it go?»', async () => {
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
    await view.user.click(await editorSend('Check the order'));
    expect(textOf(pressed(open)[0] ?? '')).toContain('Rye: 9');
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    expect(source.records.size).toBe(0);
    const awaiting = source.draft?.awaitingSent as Record<string, { quantities: unknown; draft?: unknown }>;
    expect(awaiting['s-alp']?.quantities).toEqual({ 'i-flour': 2, 'i-rye': 9 });
    // What the draft said at the send (Rye 3): «Yes» clears that line too.
    expect((awaiting['s-alp']?.draft as { quantities: unknown }).quantities).toEqual({ 'i-flour': 2, 'i-rye': 3 });
    expect(await didItGo('Alpine Mills')).toBeInTheDocument();
  });

  it('asks only about the supplier the road reached and names the one it did not', async () => {
    spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Send them now' }));
    await view.user.click(await editorSend('Order for Café Bar Srl (1 of 2)'));
    await view.user.click(await editorSend('Order for Zed (2 of 2)'));
    await waitFor(() => { expect(Object.keys(source.draft?.awaitingSent as object ?? {}).sort()).toStrictEqual(['s-caf', 's-zed']); });
    expect(source.records.size).toBe(0);
    expect(await screen.findByText(/Not sent, still to do: Alpine Mills/)).toBeInTheDocument();
  });

  it('records nothing and asks nobody when no window opened, and stays', async () => {
    spyOpen(null);
    const source = seeded();
    const view = await atList(source, STAFF);
    await toConfirmAll(view);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Send them now' }));
    await view.user.click(await editorSend('Check the order'));
    expect(await screen.findByText(/Not sent, still to do: /)).toBeInTheDocument();
    expect(source.records.size).toBe(0);
    expect(source.draft?.awaitingSent).toBeUndefined();
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

describe('naming the suppliers a send did not reach', () => {
  it('says so when a ticked supplier has no phone (no chooser to warn), and asks only about the one reached', async () => {
    const open = spyOpen();
    const source = seeded({ ordersConfig: DIRECT_ONLY });
    const view = await atList(source, STAFF);
    await toSend(view, 'Alpine Mills', 'Zed');
    await view.user.click(sendButton());
    await view.user.click(await editorSend('Order for Zed'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Not sent, still to do: Alpine Mills/)).toBeInTheDocument();
    await waitFor(() => { expect(Object.keys(source.draft?.awaitingSent as object ?? {})).toStrictEqual(['s-zed']); });
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
  it('says the arrow, the screen and the editor in Italian', async () => {
    spyOpen();
    const view = await atList(seeded(), { ...STAFF, lang: 'it' });
    await view.user.click(screen.getByRole('button', { name: 'Manda' }));
    const box = within(await screen.findByRole('region', { name: 'Manda l’ordine' }));
    await view.user.click(box.getByRole('checkbox', { name: /^Alpine Mills/ }));
    await view.user.click(box.getByRole('button', { name: 'Manda' }));
    const edit = within(await screen.findByRole('dialog', { name: 'Controlla l’ordine' }, LOAD));
    expect(edit.getByRole('group', { name: 'Cosa riceverà' })).toBeInTheDocument();
    expect(edit.getByRole('textbox', { name: 'Modifica il messaggio' })).toBeInTheDocument();
    expect(edit.getByRole('button', { name: 'Invia' })).toBeInTheDocument();
    expect(edit.getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
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
    await view.user.click(await editorSend('Check the order'));
    const text = textOf(pressed(open)[0] ?? '');
    expect(text).toContain('- Cream: 2 bottles');
    expect(text).toContain('- Flour 00: 2');
  });
});
