import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», port of v1.145.0: «Send» on a supplier's own screen — an icon in the bar, left of «+», that sends THAT supplier's lines
// through the same roads and the same editor as the send screen.

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
  it('is an icon button named for the supplier, BEFORE «+» in the bar', async () => {
    await opened(seeded({ draft: DRAFT }));
    const send = sendIcon();
    const add = screen.getByRole('button', { name: 'Add an ingredient to Alpine Mills' });
    expect(send.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(send.textContent).toBe('');
    // ⚠️ Left of «+» in the page order too (the tab order and the reading order follow the DOM).
    expect(send.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(send.parentElement).toBe(add.parentElement);
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
    const editor = within(await screen.findByRole('dialog', { name: 'Check the order' }, LOAD));
    const preview = editor.getByRole('group', { name: 'What they will receive' });
    expect(preview).toHaveTextContent('Flour 00');
    expect(preview).not.toHaveTextContent('Whole milk');
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
    const chooser = await screen.findByRole('dialog', { name: 'How should this order go?' }, LOAD);
    // A second press while the chooser is up opens nothing more.
    act(() => { send.click(); });
    expect(screen.getAllByRole('dialog', { name: 'How should this order go?' })).toHaveLength(1);
    await user.click(within(chooser).getByRole('button', { name: /^WhatsApp — I choose the chat/ }));
    const editor = within(await screen.findByRole('dialog', { name: 'Check the order' }, LOAD));
    act(() => { send.click(); });
    expect(screen.queryByRole('dialog', { name: 'How should this order go?' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog', { name: 'Check the order' })).toHaveLength(1);
    act(() => { editor.getByRole('button', { name: 'Send' }).click(); });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('frees the button again after the editor is left, so the order can be sent later', async () => {
    const open = openSpy();
    const { user } = await opened(seeded({ draft: DRAFT }), STAFF);
    await user.click(sendIcon());
    await user.click(within(await screen.findByRole('dialog', { name: 'Check the order' }, LOAD)).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Check the order' })).not.toBeInTheDocument(); });
    expect(open).not.toHaveBeenCalled();
    await user.click(sendIcon());
    expect(await screen.findByRole('dialog', { name: 'Check the order' }, LOAD)).toBeInTheDocument();
  });

  it('a window that throws is told as «Nothing was opened», and the button is free again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = await opened(seeded({ draft: DRAFT }), STAFF);
    vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('boom'); });
    await user.click(sendIcon());
    const editor = within(await screen.findByRole('dialog', { name: 'Check the order' }, LOAD));
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

  it('is named in Italian', async () => {
    await opened(seeded({ draft: DRAFT }), { lang: 'it' });
    expect(screen.getByRole('button', { name: 'Invia l’ordine a Alpine Mills' })).toBeEnabled();
  });

  it('keeps «+», «What they sell» and the summary in the bar beside it (the row wraps, none is dropped)', async () => {
    await opened(seeded({ draft: DRAFT }));
    for (const name of ['Add an ingredient to Alpine Mills', 'What they sell', 'Summary (1)', 'Send the order to Alpine Mills']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
