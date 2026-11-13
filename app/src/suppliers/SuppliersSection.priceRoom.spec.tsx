import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// The rows draw BEFORE the prices, and a price can wrap its line: the rows below would drop under the finger as the prices land
// (port of the current app's 76be75d1; measured in Mise 2 at 360px: up to 325px). So each row keeps the room for a price, unseen,
// until the prices have answered. jsdom lays nothing out: these specs pin the STRUCTURE that guarantees it (the room is in the
// row from the first paint, hidden from sight and from screen readers, and gone when the prices land); the height is for the driver.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const SUPPLIERS = [supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed' })];
const ITEMS = [
  item('i-butter', { name: 'Butter', supplierId: 's-zed', brand: 'Kerry' }),
  item('i-milk', { name: 'Milk', supplierId: 's-zed' }),
  item('i-lone', { name: 'Lone' }),
];
const PRICES = { 'i-butter': { priceUnit: 'kg', pricePerUnit: 7.2 } };
const EMPLOYEE = { canManage: false, role: 'staff', isOwner: false } as const;

const main = () => within(screen.getByRole('main'));
const rooms = () => [...document.querySelectorAll<HTMLElement>('[data-price-room]')];
const rowOf = (name: RegExp) => main().getByRole('button', { name });

async function drawn(path = '/suppliers', options = {}) {
  const source = fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, prices: PRICES });
  source.holdPrices();
  const view = renderSuppliers(path, { source, session: { location: { country: 'GB' } }, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return { ...view, source };
}

describe('the room kept for a price on the ingredient rows', () => {
  it('⚠️ an owner\'s rows have the room from the first paint, before the prices land: unseen, and not read out', async () => {
    await drawn();
    // Every row has none yet (no price has landed), so every row reserves one, after what the line already says.
    expect(rooms()).toHaveLength(3);
    for (const room of rooms()) {
      expect(room).toHaveAttribute('aria-hidden', 'true');
      expect(room.textContent).toMatch(/£12\.50 \/ kg$/);
    }
    expect(rooms().every(room => room.closest('li')?.querySelector('button') !== null)).toBe(true);
    expect(rowOf(/^Butter/).textContent).toContain('Zed · Kerry · £12.50 / kg');
  });

  it('the room goes when the prices land: the price takes its place, and a row with no price gives it back', async () => {
    const { source } = await drawn();
    expect(rooms()).toHaveLength(3);
    act(() => { source.releasePrices(); });
    expect(rooms()).toHaveLength(0);
    expect(rowOf(/^Butter/).textContent).toContain('Zed · Kerry · £7.20 / kg');
    expect(rowOf(/^Milk/).textContent).not.toContain('£');
  });

  it('⚠️ an employee never sees prices, so no row reserves any room (no empty gap)', async () => {
    await drawn('/suppliers', { session: { ...EMPLOYEE, location: { country: 'GB' } } });
    expect(rooms()).toHaveLength(0);
    expect(main().queryByText(/£/)).not.toBeInTheDocument();
  });

  it('a supplier\'s own screen keeps the room too', async () => {
    await drawn('/suppliers/supplier/s-zed');
    await screen.findByRole('region', { name: 'Zed' }, LOAD);
    expect(rooms()).toHaveLength(2);
  });
});
