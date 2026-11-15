import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';

// «Orders», port of v1.145.0 (piece 5, his ask): «Send to the supplier» on an order LIST received in the app. It sends the lines that
// are not ticked yet, with the LIST's own quantities, names and units — never the shared order, which has moved on — and then asks
// «did it go?» with exactly those quantities.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TODAY = todayISO();
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;
const WHATSAPP_ONLY = { sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: false } };

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed' }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-milk', { name: 'Milk', supplierId: 's-zed', unit: 'l' }),
];

function list(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: TODAY,
    fromUid: 'u-1',
    fromName: 'Marco',
    quantities: { 'i-flour': 4, 'i-rye': 2, 'i-milk': 3 },
    names: { 'i-flour': 'Flour', 'i-rye': 'Rye', 'i-milk': 'Milk' },
    supplierOf: { 'i-flour': 's-alp', 'i-rye': 's-alp', 'i-milk': 's-zed' },
    supplierNames: { 's-alp': 'Alpine Mills', 's-zed': 'Zed' },
    done: {},
    note: '',
    createdAt: `${TODAY}T10:00:00.000Z`,
    updatedAt: `${TODAY}T10:00:00.000Z`,
    ...extra,
  };
}

function seeded(request: Record<string, unknown>, over: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({
    suppliers: SUPPLIERS, ingredients: ITEMS, requests: { 'r-1': request }, ordersConfig: WHATSAPP_ONLY,
    // The shared order has moved on since the list was sent: the flour is 9 now.
    draft: { entries: { 'i-flour': { qty: 9 }, 'i-milk': { qty: 3 } }, days: { 's-alp': TODAY, 's-zed': TODAY } },
    ...over,
  });
}

async function atOne(source: FakeOrdersSource) {
  const view = renderOrders('/orders/lists/r-1', { source, ...STAFF });
  await screen.findByRole('region', { name: 'Order list' }, LOAD);
  return view;
}
const one = () => within(screen.getByRole('region', { name: 'Order list' }));
const asking = (source: FakeOrdersSource) => (source.draft?.awaitingSent ?? {}) as Record<string, Record<string, unknown>>;
const textOf = (url: string) => decodeURIComponent(url.slice(url.indexOf('?text=') + '?text='.length));

describe('«Send to the supplier» on an order list', () => {
  it('says «Send to the suppliers» when the list covers several, «Send to the supplier» when one', async () => {
    await atOne(seeded(list()));
    expect(await one().findByRole('button', { name: 'Send to the suppliers' })).toBeInTheDocument();
  });

  it('says «Send to the supplier» for a list of one supplier', async () => {
    await atOne(seeded(list({
      quantities: { 'i-flour': 4 }, names: { 'i-flour': 'Flour' }, supplierOf: { 'i-flour': 's-alp' }, supplierNames: { 's-alp': 'Alpine Mills' },
    })));
    expect(await one().findByRole('button', { name: 'Send to the supplier' })).toBeInTheDocument();
  });

  it('speaks Italian', async () => {
    renderOrders('/orders/lists/r-1', { source: seeded(list()), ...STAFF, lang: 'it' });
    expect(await screen.findByRole('button', { name: 'Invia ai fornitori' }, LOAD)).toBeInTheDocument();
  });

  it('sends only the lines NOT ticked, with the LIST’s numbers (not the shared order’s), then asks «did it go?» with those', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
    const source = seeded(list({ done: { 'i-rye': true } }));
    const view = await atOne(source);
    await view.user.click(await one().findByRole('button', { name: 'Send to the suppliers' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Check the order' }, LOAD));
    await waitFor(() => { expect(editor.getByRole('button', { name: 'Send' })).toBeEnabled(); }, LOAD);
    act(() => { editor.getByRole('button', { name: 'Send' }).click(); });
    expect(open).toHaveBeenCalledTimes(1);
    const text = textOf(String(open.mock.calls[0]?.[0]));
    // The list said 4 of flour (the shared order says 9 now) and the rye is already bought.
    expect(text).toContain('- Flour: 4');
    expect(text).toContain('- Milk: 3');
    expect(text).not.toContain('Rye');
    expect(text).not.toContain('Flour: 9');
    await waitFor(() => { expect(Object.keys(asking(source)).sort()).toEqual(['s-alp', 's-zed']); });
    expect(asking(source)['s-alp']).toMatchObject({ quantities: { 'i-flour': 4 }, date: TODAY });
    expect(asking(source)['s-zed']).toMatchObject({ quantities: { 'i-milk': 3 } });
    // No `draft`: «Yes» clears only draft lines that still read what the list said.
    expect(asking(source)['s-alp']).not.toHaveProperty('draft');
    // Nothing was recorded, and the ticks are not touched by sending.
    expect(source.records.size).toBe(0);
    expect(source.ticks).toEqual([]);
    expect(await screen.findByText(/^Order to Alpine Mills sent at .+: did it go\?$/)).toBeInTheDocument();
  });

  it('is hidden when every line is ticked', async () => {
    await atOne(seeded(list({ done: { 'i-flour': true, 'i-rye': true, 'i-milk': true } })));
    expect(screen.queryByRole('button', { name: /^Send to the supplier/ })).not.toBeInTheDocument();
  });

  it('is hidden when no road reaches a supplier (only the in-app list is open)', async () => {
    const source = seeded(list(), { ordersConfig: { sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } } });
    await atOne(source);
    // The page is drawn (its Finish button is there) and still offers no send.
    await one().findByRole('button', { name: 'Finish' }, LOAD);
    expect(screen.queryByRole('button', { name: /^Send to the supplier/ })).not.toBeInTheDocument();
  });

  it('leaves out a supplier the order does not know any more', async () => {
    const source = seeded(list({
      quantities: { 'i-flour': 4, 'i-gone': 1 }, names: { 'i-flour': 'Flour', 'i-gone': 'Gone' },
      supplierOf: { 'i-flour': 's-alp', 'i-gone': 's-old' }, supplierNames: { 's-alp': 'Alpine Mills', 's-old': 'Old Ltd' },
    }));
    await atOne(source);
    expect(await one().findByRole('button', { name: 'Send to the supplier' })).toBeInTheDocument();
  });
});
