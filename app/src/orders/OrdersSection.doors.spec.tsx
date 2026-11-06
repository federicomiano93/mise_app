import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router';
import type { RouteObject } from 'react-router';
import { fromOrdersList, fromOrdersSupplier } from '@mise/shared/records-link';
import { routes as appRoutes } from '../routes';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// «Orders», step 3f-8b: the doors to the cards of «Ingredients & suppliers» (parity L30, N1; his choice «doors A»): the ingredient's name,
// «+» and the supplier's name on its order screen, and Back landing on the very same place.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

// The Suppliers section stands in as a stub that says where it was pushed and with what.
function Stub() {
  const where = useLocation();
  return <output data-testid="where">{JSON.stringify({ path: where.pathname + where.search, state: where.state })}</output>;
}
const routes: RouteObject[] = [{ path: '/suppliers/*', element: <Stub /> }, ...appRoutes];

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', category: 'Flour' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed' }),
];

const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-barley', { name: 'Barley', supplierId: 's-alp' }),
  ingredient('i-old', { name: 'Old oats', supplierId: 's-alp', active: false }),
  ingredient('i-butter', { name: 'Butter', supplierId: 's-zed' }),
  ingredient('i-box', { name: 'Cake box', supplierId: 's-zed', kind: 'packaging' }),
  ingredient('i-lost', { name: 'Lost item', supplierId: 'gone' }),
];

function seeded(extra: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, ...extra });
}

async function opened(path: string, source = seeded(), options: Parameters<typeof renderOrders>[1] = {}) {
  const view = renderOrders(path, { ...options, source, routes });
  await screen.findAllByRole('spinbutton', undefined, LOAD);
  return view;
}

const employee = { canManage: false, isOwner: false, role: 'staff' as const, location: { staffHiddenCards: { suppliers: true } } };
const pushed = () => JSON.parse(screen.getByTestId('where').textContent ?? '{}') as { path: string; state: unknown };
const edit = (name: string) => screen.getByRole('button', { name: `Edit ${name}` });

// jsdom does not scroll: a scrollTop that holds what it is given, for every element, so a section drawn again can be read.
const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
beforeEach(() => {
  const held = new WeakMap<Element, number>();
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get() { return held.get(this as Element) ?? 0; },
    set(value: number) { held.set(this as Element, value); },
  });
});
afterEach(() => {
  if (scrollTopDescriptor) Object.defineProperty(Element.prototype, 'scrollTop', scrollTopDescriptor);
});

describe('the name of an ingredient', () => {
  it('is a button for whoever may edit records, named «Edit» + name + weight, in both the active rows and «Not in use»', async () => {
    await opened('/orders/supplier/s-alp');
    expect(edit('Flour 00 25kg')).toBeInTheDocument();
    expect(edit('Barley')).toBeInTheDocument();
    expect(edit('Old oats')).toBeInTheDocument();
  });

  it('is plain text, the same text, where the venue hides «Ingredients & suppliers» from the person', async () => {
    await opened('/orders/supplier/s-alp', seeded(), { session: employee });
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.getByText('Barley', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an ingredient to Alpine Mills' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Card of / })).not.toBeInTheDocument();
  });

  it('is a button for an employee when the venue shows them «Ingredients & suppliers»', async () => {
    await opened('/orders/supplier/s-alp', seeded(), { session: { ...employee, location: {} } });
    expect(edit('Barley')).toBeInTheDocument();
  });

  it('names the same in Italian', async () => {
    await opened('/orders/supplier/s-alp', seeded(), { lang: 'it' });
    expect(screen.getByRole('button', { name: 'Modifica Barley' })).toBeInTheDocument();
  });

  it('pushes the card, from a supplier’s screen as «from that supplier’s screen»', async () => {
    const { user } = await opened('/orders/supplier/s-alp');
    await user.click(edit('Barley'));
    expect(await screen.findByTestId('where')).toBeInTheDocument();
    expect(pushed()).toEqual({ path: '/suppliers/ingredient/i-barley', state: fromOrdersSupplier('s-alp') });
  });

  it('pushes it «from a list» on the pseudo-supplier’s screen, which has no screen of its own in the Suppliers section', async () => {
    const { user } = await opened('/orders/supplier/no-supplier');
    await user.click(edit('Lost item'));
    expect(pushed()).toEqual({ path: '/suppliers/ingredient/i-lost', state: fromOrdersList('ingredients') });
  });

  it('names the Packaging tab for a packaging item', async () => {
    const { user } = await opened('/orders/supplier/s-zed');
    await user.click(edit('Cake box'));
    expect(pushed()).toEqual({ path: '/suppliers/ingredient/i-box', state: fromOrdersSupplier('s-zed') });
  });

  it('pushes it «from a list» on the flat view, the Packaging tab for a packaging item', async () => {
    const { user } = await opened('/orders/ingredients');
    await user.click(edit('Butter'));
    expect(pushed()).toEqual({ path: '/suppliers/ingredient/i-butter', state: fromOrdersList('ingredients') });
  });

  it('on the flat view says «packaging» for a packaging item', async () => {
    const { user } = await opened('/orders/ingredients');
    await user.click(edit('Cake box'));
    expect(pushed().state).toEqual(fromOrdersList('packaging'));
  });
});

describe('«+» in the supplier’s bar', () => {
  it('opens a new ingredient with the supplier preset', async () => {
    const { user } = await opened('/orders/supplier/s-alp');
    await user.click(screen.getByRole('button', { name: 'Add an ingredient to Alpine Mills' }));
    expect(pushed()).toEqual({ path: '/suppliers/ingredient/new?supplier=s-alp', state: fromOrdersSupplier('s-alp') });
  });

  it('opens one with no preset from the pseudo-supplier', async () => {
    const { user } = await opened('/orders/supplier/no-supplier');
    await user.click(screen.getByRole('button', { name: 'Add an ingredient with no supplier' }));
    expect(pushed()).toEqual({ path: '/suppliers/ingredient/new', state: fromOrdersList('ingredients') });
  });

  it('is named in Italian too', async () => {
    await opened('/orders/supplier/s-alp', seeded(), { lang: 'it' });
    expect(screen.getByRole('button', { name: 'Aggiungi un ingrediente a Alpine Mills' })).toBeInTheDocument();
  });
});

describe('the supplier’s name in the bar', () => {
  it('is a door to the supplier’s screen, and the screen is still named by the name alone', async () => {
    const { user } = await opened('/orders/supplier/s-alp');
    expect(screen.getByRole('region', { name: 'Alpine Mills' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Alpine Mills' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Card of Alpine Mills in Ingredients & suppliers' }));
    expect(pushed()).toEqual({ path: '/suppliers/supplier/s-alp', state: fromOrdersList('suppliers') });
  });

  it('is plain for the pseudo-supplier', async () => {
    await opened('/orders/supplier/no-supplier');
    expect(screen.getByRole('heading', { level: 2, name: 'No supplier' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'No supplier' })).queryByRole('button', { name: /^Card of / })).not.toBeInTheDocument();
  });
});

describe('Back from the card', () => {
  it('lands on the same supplier screen with the focus on the name that was pressed', async () => {
    const view = await opened('/orders/supplier/s-alp');
    await view.user.click(edit('Barley'));
    await act(async () => { await view.router.navigate(-1); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp');
    await waitFor(() => { expect(edit('Barley')).toHaveFocus(); });
  });

  it('puts the focus on «+», and on the supplier’s name', async () => {
    const view = await opened('/orders/supplier/s-alp');
    await view.user.click(screen.getByRole('button', { name: 'Add an ingredient to Alpine Mills' }));
    await act(async () => { await view.router.navigate(-1); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add an ingredient to Alpine Mills' })).toHaveFocus(); });
    await view.user.click(screen.getByRole('button', { name: /^Card of Alpine Mills/ }));
    await act(async () => { await view.router.navigate(-1); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Card of Alpine Mills/ })).toHaveFocus(); });
  });

  it('opens «Not in use» to give the focus to a name inside it', async () => {
    const view = await opened('/orders/supplier/s-alp');
    await view.user.click(edit('Old oats'));
    await act(async () => { await view.router.navigate(-1); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(edit('Old oats')).toHaveFocus(); });
  });

  it('gives the flat view back its search text, its frozen «Ordering» set, its scroll and the focus', async () => {
    const draft = { entries: { 'i-butter': { qty: 2 }, 'i-flour': { qty: 1 } }, days: {} };
    const view = await opened('/orders/ingredients', seeded({ draft }));
    await view.user.click(screen.getByRole('radio', { name: 'Ordering (2)' }));
    await view.user.type(screen.getByRole('searchbox'), 'but');
    screen.getByRole('main').scrollTop = 640;
    await view.user.click(edit('Butter'));
    expect(pushed().path).toBe('/suppliers/ingredient/i-butter');
    await act(async () => { await view.router.navigate(-1); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders/ingredients');
    expect(screen.getByRole('searchbox')).toHaveValue('but');
    expect(screen.getByRole('radio', { name: /^Ordering/ })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => { expect(edit('Butter')).toHaveFocus(); });
    expect(screen.getByRole('main').scrollTop).toBe(640);
  });

  it('gives the split’s right-hand pane its scroll back', async () => {
    split();
    const view = await opened('/orders/supplier/s-alp');
    const pane = screen.getByRole('main').querySelector('[class*="detail"]') as HTMLElement;
    pane.scrollTop = 300;
    await view.user.click(edit('Barley'));
    await act(async () => { await view.router.navigate(-1); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    expect((screen.getByRole('main').querySelector('[class*="detail"]') as HTMLElement).scrollTop).toBe(300);
  });

  it('puts the focus on the search box when the ingredient is gone, on the flat view', async () => {
    const source = seeded();
    const view = await opened('/orders/ingredients', source);
    await view.user.click(edit('Butter'));
    source.ingredients.delete('i-butter');
    await act(async () => { await view.router.navigate(-1); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(screen.getByRole('searchbox')).toHaveFocus(); });
  });

  it('puts the focus on the supplier’s title when the ingredient is gone, on its screen', async () => {
    const source = seeded();
    const view = await opened('/orders/supplier/s-alp', source);
    await view.user.click(edit('Barley'));
    source.ingredients.delete('i-barley');
    await act(async () => { await view.router.navigate(-1); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Alpine Mills' })).toHaveFocus(); });
  });

  it('does not replay the trip on another entry of the same address', async () => {
    const entries = ['/orders/ingredients', '/stocktake', '/orders/ingredients'];
    const view = renderOrders('/', { source: seeded(), routes, entries });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await view.user.type(screen.getByRole('searchbox'), 'but');
    await view.user.click(edit('Butter'));
    await act(async () => { await view.router.navigate(-3); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders/ingredients');
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('forgets the trip: the next time the section is entered by another way nothing is restored', async () => {
    const view = await opened('/orders/ingredients');
    await view.user.type(screen.getByRole('searchbox'), 'but');
    await view.user.click(edit('Butter'));
    await act(async () => { await view.router.navigate('/orders/ingredients'); });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });
});

describe('what was typed just before pressing a door', () => {
  it('is sent when the section is left', async () => {
    const source = seeded();
    const { user } = await opened('/orders/supplier/s-alp', source);
    await user.type(screen.getByRole('spinbutton', { name: 'Barley quantity to order' }), '4');
    expect(source.writes).toHaveLength(0);
    await user.click(edit('Barley'));
    await waitFor(() => { expect(source.writes.length).toBeGreaterThan(0); }, LOAD);
    expect(source.writes.at(-1)?.entries?.['i-barley']).toMatchObject({ qty: 4 });
  });
});
