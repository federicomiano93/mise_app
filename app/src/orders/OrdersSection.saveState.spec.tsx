import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, SAVED, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// The current app's PR #551 «Orders: save at once», ported: every quantity typed is sent when its box is left (not after the pause),
// and the list and a supplier's screen say «Saved ✓» / «Not sent yet» for what was typed on THIS device.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const seeded = () => fakeOrdersSource({
  suppliers: [supplier('s-alp', { name: 'Alpine Mills' })],
  ingredients: [ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' })],
  draft: { entries: {}, days: {} },
});

const qtyBox = () => screen.getByRole('spinbutton', { name: 'Flour quantity to order' }) as HTMLInputElement;
const lineOf = (region: HTMLElement) => within(region).getAllByRole('status').find(node => node.hasAttribute('data-state')) as HTMLElement;

describe('a supplier’s screen says whether what was typed here reached the server', () => {
  it('«Saved ✓» once the draft is in, «Not sent yet» while the write is in the air, «Saved ✓» again when it lands', async () => {
    const source = seeded();
    renderOrders('/orders/supplier/s-alp', { source });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    const region = screen.getByRole('region', { name: 'Alpine Mills' });
    await waitFor(() => { expect(lineOf(region)).toHaveTextContent('Saved ✓'); });
    expect(lineOf(region)).toHaveAttribute('data-state', 'saved');
    expect(lineOf(region)).toHaveAttribute('aria-live', 'polite');

    const release = source.holdWrites();
    fireEvent.change(qtyBox(), { target: { value: '4' } });
    expect(lineOf(region)).toHaveTextContent('Not sent yet');
    // ⚠️ LEAVING THE BOX SENDS AT ONCE: no 800 ms pause.
    fireEvent.blur(qtyBox());
    expect(source.writes).toHaveLength(1);
    expect(source.writes[0]?.entries).toEqual({ 'i-flour': { qty: 4, unit: '', supplierId: '' } });
    expect(lineOf(region)).toHaveTextContent('Not sent yet');
    act(() => { release(); });
    await waitFor(() => { expect(lineOf(region)).toHaveTextContent('Saved ✓'); });
  });

  it('says «Not sent yet» while the device is offline, whatever was saved', async () => {
    renderOrders('/orders/supplier/s-alp', { source: seeded() });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    const region = screen.getByRole('region', { name: 'Alpine Mills' });
    await waitFor(() => { expect(lineOf(region)).toHaveTextContent('Saved ✓'); });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(lineOf(region)).toHaveTextContent('Not sent yet');
    vi.restoreAllMocks();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(lineOf(region)).toHaveTextContent('Saved ✓');
  });

  it('⚠️ closing the screen with Back sends a quantity still in its pause at once', async () => {
    const source = seeded();
    renderOrders('/orders/supplier/s-alp', { source });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    fireEvent.change(qtyBox(), { target: { value: '7' } });
    expect(source.writes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(source.writes).toHaveLength(1); });
    expect(source.writes[0]?.entries).toEqual({ 'i-flour': { qty: 7, unit: '', supplierId: '' } });
  });

  it('a box left with nothing changed sends nothing', async () => {
    const source = seeded();
    renderOrders('/orders/supplier/s-alp', { source });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    fireEvent.focus(qtyBox());
    fireEvent.blur(qtyBox());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(source.writes).toHaveLength(0);
  });
});

describe('the list’s head says it too, with one voice', () => {
  it('shows «Saved ✓» in the head of the supplier list', async () => {
    renderOrders('/orders', { source: seeded() });
    await screen.findByText('Alpine Mills', undefined, LOAD);
    await waitFor(() => { expect(screen.getByText('Saved ✓')).toBeInTheDocument(); });
  });

  it('⚠️ with a supplier open beside the list (the split), only the supplier’s line speaks', async () => {
    split();
    renderOrders('/orders/supplier/s-alp', { source: seeded() });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(screen.getAllByText('Saved ✓')).toHaveLength(1); });
    const region = screen.getByRole('region', { name: 'Alpine Mills' });
    expect(within(region).getByText('Saved ✓')).toBeInTheDocument();
  }, SAVED.timeout * 2);
});
