import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, sendFromEditor, supplier } from '../testing/renderOrders';

// «Order to Alpine Mills sent at 10:42: did it go?» (the current app's PR #554): the question every device of the venue shows from
// drafts/current.awaitingSent until somebody answers, the dialog on the device that sent, and «Send» on a supplier's own screen.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TODAY = todayISO();
const AT = new Date().toISOString();
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;
const WHATSAPP_ONLY = { sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: false } };

const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills' }), supplier('s-zed', { name: 'Zed Dairy', shortName: 'Zed' })];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-milk', { name: 'Milk', supplierId: 's-zed', unit: 'l' }),
];

// What another device left: Flour 2 went to Alpine Mills; Rye 5 was typed AFTER the send (the next order).
const WAITING = { at: AT, date: TODAY, quantities: { 'i-flour': 2 }, units: { 'i-flour': 'kg' } };
function anotherDeviceSent(extra: Record<string, unknown> = {}): FakeOrdersSource {
  return fakeOrdersSource({
    suppliers: SUPPLIERS, ingredients: ITEMS, ordersConfig: WHATSAPP_ONLY,
    draft: { entries: { 'i-flour': { qty: 2 }, 'i-rye': { qty: 5 } }, days: { 's-alp': TODAY }, awaitingSent: { 's-alp': WAITING }, ...extra },
  });
}

const banner = () => screen.findByText(/^Order to Alpine Mills sent at .+: did it go\?$/, undefined, LOAD);
const rowOf = (sentence: HTMLElement) => within(sentence.closest('[data-keep]') as HTMLElement);

describe('the question on EVERY device', () => {
  it('shows the banner on a device that did not send it, with «Yes» and «No» described by the question', async () => {
    renderOrders('/orders', { source: anotherDeviceSent(), ...STAFF });
    const sentence = await banner();
    const yes = rowOf(sentence).getByRole('button', { name: 'Yes' });
    expect(yes).toHaveAccessibleDescription(sentence.textContent ?? '');
    expect(rowOf(sentence).getByRole('button', { name: 'No' })).toBeInTheDocument();
  });

  it('⚠️ «Yes» claims the question, records EXACTLY what went, clears only those lines and keeps what was typed since', async () => {
    const source = anotherDeviceSent();
    const view = renderOrders('/orders', { source, ...STAFF });
    await view.user.click(rowOf(await banner()).getByRole('button', { name: 'Yes' }));
    await waitFor(() => { expect(source.records.has(`${TODAY}_s-alp`)).toBe(true); });
    expect(source.records.get(`${TODAY}_s-alp`)?.quantities).toEqual({ 'i-flour': 2 });
    expect(source.awaitingWrites.find(write => write.op === 'claim')?.done).toBe(true);
    await waitFor(() => { expect((source.draft?.entries as Record<string, unknown>)['i-flour']).toBeUndefined(); });
    expect((source.draft?.entries as Record<string, unknown>)['i-rye']).toEqual({ qty: 5 });
    // Rye is still there, so the day stamp stays.
    expect((source.draft?.days as Record<string, unknown>)['s-alp']).toBe(TODAY);
    await waitFor(() => { expect(screen.queryByText(/did it go\?$/)).not.toBeInTheDocument(); });
    expect(await screen.findByText('Alpine Mills — order saved to history ✓')).toBeInTheDocument();
  });

  it('«No» removes only the question: the quantities stay in the order', async () => {
    const source = anotherDeviceSent();
    const view = renderOrders('/orders', { source, ...STAFF });
    await view.user.click(rowOf(await banner()).getByRole('button', { name: 'No' }));
    expect(await screen.findByText('Not recorded: the quantities for Alpine Mills stay in the order.')).toBeInTheDocument();
    expect(source.records.size).toBe(0);
    expect((source.draft?.awaitingSent as Record<string, unknown>)['s-alp']).toBeUndefined();
    expect((source.draft?.entries as Record<string, unknown>)['i-flour']).toEqual({ qty: 2 });
  });

  it('⚠️ answered on another device first: the claim finds the key gone and NOTHING is recorded here', async () => {
    const source = anotherDeviceSent();
    const view = renderOrders('/orders', { source, ...STAFF });
    const yes = rowOf(await banner()).getByRole('button', { name: 'Yes' });
    // The other device's claim lands on the server; this one's snapshot has not caught up yet.
    source.draft = { ...source.draft, awaitingSent: {} };
    await view.user.click(yes);
    expect(await screen.findByText('Already answered on another device.')).toBeInTheDocument();
    expect(source.records.size).toBe(0);
  });

  it('no network for the claim: nothing recorded, it says so, and the question stays', async () => {
    const source = anotherDeviceSent();
    source.failAwaiting.claim = true;
    const view = renderOrders('/orders', { source, ...STAFF });
    await view.user.click(rowOf(await banner()).getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText('Could not save the order — check your network and try again.')).toBeInTheDocument();
    expect(source.records.size).toBe(0);
    expect(await banner()).toBeInTheDocument();
  });

  it('a recording that fails puts the question back for every device', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = anotherDeviceSent();
    source.fail.record = true;
    const view = renderOrders('/orders', { source, ...STAFF });
    await view.user.click(rowOf(await banner()).getByRole('button', { name: 'Yes' }));
    await waitFor(() => { expect(source.awaitingWrites.some(write => write.op === 'restore' && write.done === true)).toBe(true); });
    expect((source.draft?.awaitingSent as Record<string, { at: string }>)['s-alp']?.at).toBe(AT);
    expect(await banner()).toBeInTheDocument();
  });

  it('⚠️ History already holds this order: asks first, and «Don’t record» records nothing twice', async () => {
    const source = anotherDeviceSent();
    source.records.set(`${TODAY}_s-alp`, {
      date: TODAY, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-flour': 2 }, stock: {}, names: {},
      createdAt: AT, updatedAt: AT,
    });
    const view = renderOrders('/orders', { source, ...STAFF });
    await view.user.click(rowOf(await banner()).getByRole('button', { name: 'Yes' }));
    const ask = within(await screen.findByRole('alertdialog', { name: 'It may already be recorded' }, LOAD));
    await view.user.click(ask.getByRole('button', { name: 'Don’t record' }));
    expect(await screen.findByText('Not recorded.')).toBeInTheDocument();
    expect(source.records.get(`${TODAY}_s-alp`)?.quantities).toEqual({ 'i-flour': 2 });
    expect((source.draft?.awaitingSent as Record<string, unknown>)['s-alp']).toBeUndefined();
  });

  it('«Order placed» for that supplier answers the question too, on every device', async () => {
    const source = anotherDeviceSent();
    const view = renderOrders('/orders/supplier/s-alp/confirm', { source, ...STAFF });
    await screen.findByText('This is what will be recorded:', undefined, LOAD);
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await view.user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Yes, sent' }));
    await waitFor(() => { expect(source.records.has(`${TODAY}_s-alp`)).toBe(true); });
    await waitFor(() => { expect((source.draft?.awaitingSent as Record<string, unknown>)['s-alp']).toBeUndefined(); });
  });

  it('asks in Italian: «Ordine a … inviato alle …: è partito?»', async () => {
    renderOrders('/orders', { source: anotherDeviceSent(), ...STAFF, lang: 'it' });
    const sentence = await screen.findByText(/^Ordine a Alpine Mills inviato alle .+: è partito\?$/, undefined, LOAD);
    expect(rowOf(sentence).getByRole('button', { name: 'Sì' })).toBeInTheDocument();
  });
});

describe('«Send» on a supplier’s own screen, and the device that sent it', () => {
  const seeded = () => fakeOrdersSource({
    suppliers: SUPPLIERS, ingredients: ITEMS, ordersConfig: WHATSAPP_ONLY,
    draft: { entries: { 'i-flour': { qty: 2 } }, days: { 's-alp': TODAY } },
  });
  const sendHere = () => screen.getByRole('button', { name: 'Send the order to Alpine Mills' });

  it('is disabled while nothing is typed', async () => {
    renderOrders('/orders/supplier/s-zed', { source: seeded(), ...STAFF });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    expect(screen.getByRole('button', { name: 'Send the order to Zed' })).toBeDisabled();
  });

  it('sends this supplier’s rows through the editor, and asks «did it go?» on THIS device once the page is back', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
    const source = seeded();
    const view = renderOrders('/orders/supplier/s-alp', { source, ...STAFF });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await view.user.click(sendHere());
    await sendFromEditor();
    expect(open).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(String(open.mock.calls[0]?.[0]))).toContain('Flour: 2');
    await waitFor(() => { expect((source.draft?.awaitingSent as Record<string, unknown> | undefined)?.['s-alp']).toBeDefined(); });
    // WhatsApp took the page away; it comes back: the question is asked here at once.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const asked = within(await screen.findByRole('alertdialog', { name: /^Order to Alpine Mills sent at .+: did it go\?$/ }, LOAD));
    await view.user.click(asked.getByRole('button', { name: 'Yes' }));
    await waitFor(() => { expect(source.records.get(`${TODAY}_s-alp`)?.quantities).toEqual({ 'i-flour': 2 }); });
  });

  it('Escape on the dialog leaves the question to the banner: nothing is answered', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
    const source = seeded();
    const view = renderOrders('/orders/supplier/s-alp', { source, ...STAFF });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await view.user.click(sendHere());
    await sendFromEditor();
    await waitFor(() => { expect((source.draft?.awaitingSent as Record<string, unknown> | undefined)?.['s-alp']).toBeDefined(); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    await waitFor(() => { expect(dialog.contains(document.activeElement)).toBe(true); }, LOAD);
    await view.user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(source.records.size).toBe(0);
    expect((source.draft?.awaitingSent as Record<string, unknown>)['s-alp']).toBeDefined();
  });

  it('⚠️ a question the other devices could not be told stays on THIS device, and «Yes» records it without a claim', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
    const source = seeded();
    source.failAwaiting.set = true;
    const view = renderOrders('/orders/supplier/s-alp', { source, ...STAFF });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await view.user.click(sendHere());
    await sendFromEditor();
    expect(await screen.findByText('The other devices could not be told: answer here whether the order to Alpine Mills went.', undefined, LOAD)).toBeInTheDocument();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const asked = within(await screen.findByRole('alertdialog', { name: /did it go\?$/ }, LOAD));
    await view.user.click(asked.getByRole('button', { name: 'Yes' }));
    await waitFor(() => { expect(source.records.has(`${TODAY}_s-alp`)).toBe(true); });
    expect(source.awaitingWrites.some(write => write.op === 'claim')).toBe(false);
  });
});
