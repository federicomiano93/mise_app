import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, SAVED, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// The iPad order of 14 Nov 2026 (the current app's v1.145.0): the line «Saved ✓» / «Not sent yet» under the Orders head and under a
// supplier's bar, and what leaving a box, closing a supplier's screen or swapping the view does — send at once, without the 800 ms pause.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills' })];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp' }),
];

const seeded = (): FakeOrdersSource => fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS });
const lines = () => [...document.querySelectorAll<HTMLElement>('p[data-state]')];
// The line a person hears: the one that is a live region (the head's is silent while a supplier's screen is open).
const speaking = () => lines().find(line => line.hasAttribute('role'));
const box = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;

async function supplierScreen(options: Parameters<typeof renderOrders>[1] = {}) {
  const source = options.source ?? seeded();
  const view = renderOrders('/orders/supplier/s-alp', { ...options, source });
  await screen.findAllByRole('spinbutton', undefined, LOAD);
  return view;
}

describe('the save line', () => {
  it('is there from the first render, empty, and says nothing before the draft has arrived', async () => {
    const source = seeded();
    source.refuse.draft = true; // the draft never arrives: not ready
    renderOrders('/orders', { source });
    await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD);
    const [line] = lines();
    expect(line).toBeDefined();
    expect(line).toHaveTextContent('');
    expect(line).toHaveAttribute('data-state', '');
  });

  it('says «Saved ✓» once the draft has arrived, a live region that was on the page before it spoke', async () => {
    renderOrders('/orders', { source: seeded() });
    await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD);
    await waitFor(() => { expect(lines()[0]).toHaveTextContent('Saved ✓'); });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toHaveAttribute('role', 'status');
    expect(lines()[0]).toHaveAttribute('aria-live', 'polite');
    expect(lines()[0]).toHaveAttribute('data-state', 'saved');
  });

  it('says «Not sent yet» while a number is waiting, and «Saved ✓» again once it has been sent', async () => {
    const { user } = await supplierScreen();
    await waitFor(() => { expect(speaking()).toHaveTextContent('Saved ✓'); });
    await user.type(box('Flour 00 25kg quantity to order'), '3');
    expect(speaking()).toHaveTextContent('Not sent yet');
    expect(speaking()).toHaveAttribute('data-state', 'unsent');
    await waitFor(() => { expect(speaking()).toHaveTextContent('Saved ✓'); }, SAVED);
  });

  it('says «Not sent yet» while the device is offline', async () => {
    await supplierScreen();
    await waitFor(() => { expect(speaking()).toHaveTextContent('Saved ✓'); });
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(speaking()).toHaveTextContent('Not sent yet');
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(speaking()).toHaveTextContent('Saved ✓');
  });

  it('says its words in Italian', async () => {
    const { user } = await supplierScreen({ lang: 'it' });
    await waitFor(() => { expect(speaking()).toHaveTextContent('Salvato ✓'); });
    await user.type(screen.getByRole('spinbutton', { name: /^Quantità da ordinare di Flour/ }), '3');
    expect(speaking()).toHaveTextContent('Non ancora inviato');
  });
});

describe('one voice on the split', () => {
  it('with a supplier open beside the list the head keeps its room but is silent, and the screen’s line speaks', async () => {
    split();
    await supplierScreen();
    await waitFor(() => { expect(lines()).toHaveLength(2); });
    const [head, bar] = lines() as [HTMLElement, HTMLElement];
    await waitFor(() => { expect(bar).toHaveTextContent('Saved ✓'); });
    expect(head).toHaveTextContent('');
    expect(head).not.toHaveAttribute('role');
    expect(head).not.toHaveAttribute('aria-live');
    expect(bar).toHaveAttribute('role', 'status');
    expect(bar).toHaveAttribute('aria-live', 'polite');
  });

  it('with no supplier open the head speaks', async () => {
    split();
    renderOrders('/orders', { source: seeded() });
    await screen.findByRole('button', { name: /^Alpine Mills/ }, LOAD);
    await waitFor(() => { expect(lines()[0]).toHaveTextContent('Saved ✓'); });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toHaveAttribute('role', 'status');
  });
});

describe('sending at once', () => {
  it('leaving the quantity box sends what was typed, without waiting for the pause', async () => {
    const source = seeded();
    const { user } = await supplierScreen({ source });
    await user.type(box('Flour 00 25kg quantity to order'), '12');
    expect(source.writes).toHaveLength(0);
    await user.tab();
    expect(source.writes).toHaveLength(1);
    expect(source.writes[0]?.entries?.['i-flour']).toMatchObject({ qty: 12 });
    // The pause then finds nothing more to send.
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(source.writes).toHaveLength(1);
  });

  it('leaving the stock box sends it too', async () => {
    const source = seeded();
    const { user } = await supplierScreen({ source });
    await user.type(box('Flour 00 25kg stock on hand'), '4');
    expect(source.writes).toHaveLength(0);
    await user.tab();
    expect(source.writes).toHaveLength(1);
    expect(source.writes[0]?.entries?.['i-flour']).toMatchObject({ stock: 4 });
  });

  it('leaving a box with nothing typed writes nothing', async () => {
    const source = seeded();
    const { user } = await supplierScreen({ source });
    await user.click(box('Flour 00 25kg quantity to order'));
    await user.tab();
    expect(source.writes).toHaveLength(0);
  });

  it('leaving a box in the flat view, «by ingredient», sends too', async () => {
    const source = seeded();
    const view = renderOrders('/orders/ingredients', { source });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await view.user.type(box('Rye quantity to order'), '2');
    expect(source.writes).toHaveLength(0);
    await view.user.tab();
    expect(source.writes).toHaveLength(1);
    expect(source.writes[0]?.entries?.['i-rye']).toMatchObject({ qty: 2 });
  });

  it('closing the supplier’s screen sends, even when no blur came (the box is removed with the focus on it)', async () => {
    const source = seeded();
    const { user } = await supplierScreen({ source });
    await user.type(box('Flour 00 25kg quantity to order'), '5');
    expect(source.writes).toHaveLength(0);
    // fireEvent: no pointer, so the focus does not move to the button and no blur does the sending.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('button', { name: /^Alpine Mills/ });
    expect(source.writes).toHaveLength(1);
    expect(source.writes[0]?.entries?.['i-flour']).toMatchObject({ qty: 5 });
  });

  it('swapping the view sends', async () => {
    const source = seeded();
    const view = renderOrders('/orders/ingredients', { source });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await view.user.type(box('Rye quantity to order'), '6');
    expect(source.writes).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Suppliers' }));
    await screen.findByRole('button', { name: /^Alpine Mills/ });
    expect(source.writes).toHaveLength(1);
    expect(source.writes[0]?.entries?.['i-rye']).toMatchObject({ qty: 6 });
  });
});
