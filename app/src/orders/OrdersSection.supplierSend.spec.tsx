import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», port of v1.145.0: «Send» on a supplier's own screen — an icon at the end of its head (16 Nov 2026), that sends THAT
// supplier's lines through the same roads and the same editor as the send screen.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TODAY = todayISO();
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;
const WHATSAPP_ONLY = { sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: false } };

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', phone: '+44 7700 900123' }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-milk', { name: 'Whole milk', shortName: 'Milk', supplierId: 's-zed', unit: 'l' }),
];
const DRAFT = { entries: { 'i-flour': { qty: 2 }, 'i-milk': { qty: 4 } }, days: { 's-alp': TODAY, 's-zed': TODAY } };

function seeded(over: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, ordersConfig: WHATSAPP_ONLY, ...over });
}

async function opened(source: FakeOrdersSource, options: Parameters<typeof renderOrders>[1] = {}, id = 's-alp') {
  const view = renderOrders(`/orders/supplier/${id}`, { source, ...options });
  await screen.findAllByRole('spinbutton', undefined, LOAD);
  return view;
}

const sendIcon = (name = 'Alpine Mills') => screen.getByRole('button', { name: `Send the order to ${name}` });
const openSpy = () => vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
const textOf = (url: string) => decodeURIComponent(url.slice(url.indexOf('?text=') + '?text='.length));

describe('«Send» in a supplier’s bar', () => {
  it('is an icon button named for the supplier, the last control of the head', async () => {
    await opened(seeded({ draft: DRAFT }));
    const send = sendIcon();
    expect(send.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(send.textContent).toBe('');
    const head = send.closest('header') as HTMLElement;
    const buttons = within(head).getAllByRole('button');
    expect(buttons[buttons.length - 1]).toBe(send);
  });

  it('is off while nothing is typed for the supplier, and on after the first quantity', async () => {
    const { user } = await opened(seeded());
    expect(sendIcon()).toBeDisabled();
    await user.type(screen.getByRole('spinbutton', { name: 'Flour 00 25kg quantity to order' }), '3');
    await waitFor(() => { expect(sendIcon()).toBeEnabled(); });
  });

  it('is off for a supplier with nothing typed even when ANOTHER supplier has an order', async () => {
    await opened(seeded({ draft: { entries: { 'i-milk': { qty: 4 } }, days: { 's-zed': TODAY } } }));
    expect(sendIcon()).toBeDisabled();
  });

  it('sends only THIS supplier’s lines, shows them in the editor, and opens the window from its «Send»', async () => {
    const open = openSpy();
    const { user } = await opened(seeded({ draft: DRAFT }), STAFF);
    await user.click(sendIcon());
    const editor = within(await screen.findByRole('dialog', { name: 'Alpine Mills' }, LOAD));
    const box = editor.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.value).toContain('Flour 00');
    expect(box.value).not.toContain('Whole milk');
    expect(open).not.toHaveBeenCalled();
    act(() => { editor.getByRole('button', { name: 'Send' }).click(); });
    expect(open).toHaveBeenCalledTimes(1);
    const text = textOf(String(open.mock.calls[0]?.[0]));
    expect(text).toContain('- Flour 00');
    expect(text).not.toContain('Whole milk');
  });

  it('⚠️ goes through the road chooser when there is more than one road, and one send at a time', async () => {
    const open = openSpy();
    const { user } = await opened(seeded({ draft: DRAFT, ordersConfig: null }));
    const send = sendIcon();
    await user.click(send);
    const chooser = await screen.findByRole('dialog', { name: 'Send to' }, LOAD);
    // A second press while the chooser is up opens nothing more.
    act(() => { send.click(); });
    expect(screen.getAllByRole('dialog', { name: 'Send to' })).toHaveLength(1);
    await user.click(within(chooser).getByRole('button', { name: /^WhatsApp/ }));
    const editor = within(await screen.findByRole('dialog', { name: 'Alpine Mills' }, LOAD));
    act(() => { send.click(); });
    expect(screen.queryByRole('dialog', { name: 'Send to' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog', { name: 'Alpine Mills' })).toHaveLength(1);
    act(() => { editor.getByRole('button', { name: 'Send' }).click(); });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('frees the button again after the editor is left, so the order can be sent later', async () => {
    const open = openSpy();
    const { user } = await opened(seeded({ draft: DRAFT }), STAFF);
    await user.click(sendIcon());
    await user.click(within(await screen.findByRole('dialog', { name: 'Alpine Mills' }, LOAD)).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Alpine Mills' })).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
    await user.click(await waitFor(() => sendIcon(), LOAD));
    expect(await screen.findByRole('dialog', { name: 'Alpine Mills' }, LOAD)).toBeInTheDocument();
  });

  it('a window that throws is told as «Nothing was opened», and the button is free again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = await opened(seeded({ draft: DRAFT }), STAFF);
    vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('boom'); });
    await user.click(sendIcon());
    const editor = within(await screen.findByRole('dialog', { name: 'Alpine Mills' }, LOAD));
    await user.click(editor.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/^Nothing was opened/)).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
    await waitFor(() => { expect(sendIcon()).toBeEnabled(); });
  });

  it('writes the in-app list for a manager and says so, like the send screen', async () => {
    const source = seeded({ draft: DRAFT, ordersConfig: { sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } } });
    const { user } = await opened(source, STAFF);
    await user.click(sendIcon());
    expect(await screen.findByText(/^List sent/, undefined, LOAD)).toBeInTheDocument();
  });

  it('opens «Invia a» in Italian, one word per road', async () => {
    const { user } = await opened(seeded({ draft: DRAFT, ordersConfig: null }), { lang: 'it' });
    await user.click(screen.getByRole('button', { name: 'Invia l’ordine a Alpine Mills' }));
    const chooser = await screen.findByRole('dialog', { name: 'Invia a' }, LOAD);
    // The venue's default roads: the in-app list and WhatsApp (the full set is pinned in English in OrdersSection.send.spec.tsx).
    expect(within(chooser).getAllByRole('button').map(button => button.textContent)).toEqual(['Chi gestisce il locale', 'WhatsApp', 'Annulla']);
  });

  it('is named in Italian', async () => {
    await opened(seeded({ draft: DRAFT }), { lang: 'it' });
    expect(screen.getByRole('button', { name: 'Invia l’ordine a Alpine Mills' })).toBeEnabled();
  });

  // The order photo is off (16 Nov 2026, ORDER_PHOTO_ON in orderImage.ts): even where the browser could share a picture, the editor
  // offers the text and its «Send» opens the chat with it; no share sheet is asked for.
  it('⚠️ sends the text, never the photo, even where the browser can share one', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    const open = openSpy();
    const { user } = await opened(seeded({ draft: DRAFT }), STAFF);
    await user.click(sendIcon());
    const editor = within(await screen.findByRole('dialog', { name: 'Alpine Mills' }, LOAD));
    expect(editor.getByRole('button', { name: 'Send' })).toBeEnabled();
    act(() => { editor.getByRole('button', { name: 'Send' }).click(); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(share).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });
});
