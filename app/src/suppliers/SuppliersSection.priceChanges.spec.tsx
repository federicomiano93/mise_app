import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { renderApp } from '../testing/renderApp';
import { LOAD } from '../testing/renderSuppliers';
import { fakePriceChangesSource } from './priceChanges/testing/fakePriceChangesSource';
import type { FakePriceChangesSource } from './priceChanges/testing/fakePriceChangesSource';
import type { StoredDoc } from './suppliersSource';

// «Price changes» (step 3e-7, part 1): the read-only report. Parity I101-I112; ports of tests/price-changes-screen.test.mjs.
// Invented names and prices only. «Today» is fixed at Monday 26 October 2026, so the current month is October and the
// current week (it starts on Sunday by default) is 25-31 October.

beforeAll(async () => {
  await import('./SuppliersSection');
}, 60_000);

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0)); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const IT = { country: 'IT' };
const EMPLOYEE = { canManage: false, role: 'staff', isOwner: false } as const;
const MINUS = '−';

const change = (id: string, fields: Record<string, unknown>): StoredDoc => ({
  id, ingredientId: 'ing-flour', supplierId: 'sup-mill', name: 'Frozen name', priceUnit: 'kg', oldPrice: 1, newPrice: 1.1,
  oldDate: '2026-08-01', date: '2026-09-12', invoiceId: '1', line: 1, pct: 10, ...fields,
});

const SEPTEMBER: StoredDoc[] = [
  change('c-flour', { ingredientId: 'ing-flour', name: 'Old flour name', pct: 10 }),
  change('c-sugar', { ingredientId: 'ing-sugar', name: 'Sugar', pct: 25, date: '2026-09-14', oldPrice: 2, newPrice: 2.5 }),
  change('c-butter', { ingredientId: 'ing-butter', name: 'Butter', pct: -4, date: '2026-09-20', oldPrice: 5, newPrice: 4.8 }),
  change('c-milk', { ingredientId: 'ing-milk', name: 'Milk', pct: -12, date: '2026-09-18', oldPrice: 1, newPrice: 0.88 }),
];

const STORE = () => fakeSuppliersSource({
  suppliers: [{ id: 'sup-mill', name: 'Mill Co' }],
  ingredients: [
    { id: 'ing-flour', name: 'Flour 00' }, { id: 'ing-sugar', name: 'Sugar' }, { id: 'ing-butter', name: 'Butter' }, { id: 'ing-milk', name: 'Milk' },
  ],
});

type Options = NonNullable<Parameters<typeof renderApp>[1]>;

function open(changes: StoredDoc[] = SEPTEMBER, path = '/suppliers/price-changes', options: Options = {}) {
  const fake = fakePriceChangesSource(changes);
  const view = renderApp(path, { session: { location: IT }, ...options, data: { suppliers: STORE, priceChanges: () => fake, ...options.data } });
  return { ...view, fake };
}

async function report(name = 'Price changes') {
  const region = await screen.findByRole('region', { name }, LOAD);
  return within(region);
}

const listCalls = (fake: FakePriceChangesSource) => fake.calls.filter(call => call.method === 'list');

describe('the door and the address', () => {
  it('the door is after the import door for an owner of an Italian venue, and opens the screen with the focus on its title', async () => {
    const { router, user } = open(SEPTEMBER, '/suppliers');
    const door = await screen.findByRole('button', { name: 'Price changes' }, LOAD);
    expect(screen.getByRole('button', { name: 'Import from invoices' }).nextElementSibling).toBe(door);
    await user.click(door);
    const inScreen = await report();
    expect(router.state.location.pathname).toBe('/suppliers/price-changes');
    expect(inScreen.getByRole('heading', { level: 2, name: 'Price changes' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await waitFor(() => { expect(inScreen.getByRole('heading', { level: 2, name: 'Price changes' })).toHaveFocus(); });
    expect(screen.getByRole('region', { name: 'Price changes' }).closest('[data-view]')).toHaveAttribute('data-view', 'wide');
  });

  it.each([
    ['an employee', { ...EMPLOYEE, location: IT }],
    ['an owner in the United Kingdom', { location: { country: 'GB' } }],
  ])('%s has no door, and the address they type sends them to the list', async (_who, session) => {
    open(SEPTEMBER, '/suppliers', { session });
    await screen.findByRole('tab', { name: 'Packaging' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Price changes' })).not.toBeInTheDocument();
  });

  it.each([
    ['an employee', { ...EMPLOYEE, location: IT }],
    ['an owner in the United Kingdom', { location: { country: 'GB' } }],
  ])('%s who types the address is sent to the list (replaced)', async (_who, session) => {
    const { router, fake } = open(SEPTEMBER, '/suppliers/price-changes', { session });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('region', { name: 'Price changes' })).not.toBeInTheDocument();
    expect(fake.calls).toHaveLength(0);
  });

  it('Back returns to the list it came from, with the focus on the door', async () => {
    const { router, user } = open(SEPTEMBER, '/suppliers/suppliers');
    await user.click(await screen.findByRole('button', { name: 'Price changes' }, LOAD));
    const inScreen = await report();
    await user.click(inScreen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Price changes' })).toHaveFocus(); });
  });

  it('speaks Italian in an Italian interface', async () => {
    open(SEPTEMBER, '/suppliers/price-changes', { lang: 'it' });
    const inScreen = await report('Variazioni prezzi');
    expect(await inScreen.findByText('settembre 2026')).toBeInTheDocument();
    expect(inScreen.getByText('2 aumenti · 2 diminuzioni')).toBeInTheDocument();
    expect(inScreen.getByRole('heading', { level: 3, name: 'Aumenti' })).toBeInTheDocument();
    expect(inScreen.getByRole('heading', { level: 3, name: 'Diminuzioni' })).toBeInTheDocument();
    expect(inScreen.getByRole('button', { name: 'Periodo precedente' })).toBeInTheDocument();
    expect(inScreen.getByRole('button', { name: 'Settimana' })).toBeInTheDocument();
    expect(inScreen.getAllByText(/fattura del 12 set/).length).toBeGreaterThan(0);
  });
});

describe('opening', () => {
  it('reads the newest change first, then the month that holds it', async () => {
    const { fake } = open();
    const inScreen = await report();
    expect(await inScreen.findByText('September 2026')).toBeInTheDocument();
    await inScreen.findByText('Flour 00');
    expect(fake.calls[0]).toEqual({ method: 'latest' });
    expect(listCalls(fake).at(-1)).toEqual({ method: 'list', from: '2026-09-01', to: '2026-09-30' });
    expect(inScreen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
    expect(inScreen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('with nothing stored it shows the current month and says where changes come from', async () => {
    const { fake } = open([]);
    const inScreen = await report();
    expect(await inScreen.findByText('No changes in this period.')).toBeInTheDocument();
    expect(inScreen.getByText('Changes appear when you import invoices.')).toBeInTheDocument();
    expect(inScreen.getByText('October 2026')).toBeInTheDocument();
    expect(listCalls(fake).at(-1)).toEqual({ method: 'list', from: '2026-10-01', to: '2026-10-31' });
  });

  it('says Loading until the first answer, never an empty state', async () => {
    const fake = fakePriceChangesSource(SEPTEMBER);
    const release = fake.hold();
    open(SEPTEMBER, '/suppliers/price-changes', { data: { priceChanges: () => fake } });
    const inScreen = await report();
    expect(inScreen.getByText('Loading…')).toBeInTheDocument();
    expect(inScreen.queryByText('No changes in this period.')).not.toBeInTheDocument();
    release();
    await inScreen.findByText('Flour 00');
    expect(inScreen.queryByText('Loading…')).not.toBeInTheDocument();
  });
});

describe('never a false «no changes»', () => {
  it('a non-empty answer from the cache carries the note above the list', async () => {
    const fake = fakePriceChangesSource(SEPTEMBER);
    fake.fromCache = true;
    open(SEPTEMBER, '/suppliers/price-changes', { data: { priceChanges: () => fake } });
    const inScreen = await report();
    expect(await inScreen.findByText('No connection: some changes may be missing.')).toBeInTheDocument();
    expect(inScreen.getByText('Flour 00')).toBeInTheDocument();
  });

  it('an EMPTY answer from the cache asks for the connection instead of saying nothing changed', async () => {
    const fake = fakePriceChangesSource([]);
    fake.fromCache = true;
    open([], '/suppliers/price-changes', { data: { priceChanges: () => fake } });
    const inScreen = await report();
    expect(await inScreen.findByText('The connection is needed to see the changes.')).toBeInTheDocument();
    expect(inScreen.queryByText('No changes in this period.')).not.toBeInTheDocument();
  });

  it('an empty NEWEST-DATE answer from the cache is not «nothing at all»: it asks for the connection, and Try again recovers', async () => {
    const fake = fakePriceChangesSource([]);
    fake.fromCache = true;
    const { user } = open([], '/suppliers/price-changes', { data: { priceChanges: () => fake } });
    const inScreen = await report();
    expect(await inScreen.findByText('The connection is needed to see the changes.')).toBeInTheDocument();
    expect(inScreen.queryByText('No changes in this period.')).not.toBeInTheDocument();
    expect(inScreen.queryByText('Changes appear when you import invoices.')).not.toBeInTheDocument();
    expect(fake.calls.filter(call => call.method === 'list')).toHaveLength(0);
    fake.fromCache = false;
    fake.changes = SEPTEMBER;
    await user.click(inScreen.getByRole('button', { name: 'Try again' }));
    await inScreen.findByText('Flour 00');
    expect(fake.calls.filter(call => call.method === 'latest')).toHaveLength(2);
  });

  it('a failed start shows the error, and Try again reads the newest date again', async () => {
    const fake = fakePriceChangesSource(SEPTEMBER);
    fake.failNext(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = open(SEPTEMBER, '/suppliers/price-changes', { data: { priceChanges: () => fake } });
    const inScreen = await report();
    expect(await inScreen.findByRole('alert')).toHaveTextContent('The price changes could not be loaded. Try again.');
    await user.click(inScreen.getByRole('button', { name: 'Try again' }));
    await inScreen.findByText('Flour 00');
    expect(fake.calls.filter(call => call.method === 'latest')).toHaveLength(2);
  });

  it('a failed period reload retries only the period', async () => {
    const fake = fakePriceChangesSource(SEPTEMBER);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = open(SEPTEMBER, '/suppliers/price-changes', { data: { priceChanges: () => fake } });
    const inScreen = await report();
    await inScreen.findByText('Flour 00');
    fake.failNext(new Error('boom'));
    await user.click(inScreen.getByRole('button', { name: 'Previous period' }));
    await inScreen.findByRole('alert');
    const latestBefore = fake.calls.filter(call => call.method === 'latest').length;
    await user.click(inScreen.getByRole('button', { name: 'Try again' }));
    expect(await inScreen.findByText('No changes in this period.')).toBeInTheDocument();
    expect(fake.calls.filter(call => call.method === 'latest')).toHaveLength(latestBefore);
    expect(listCalls(fake).at(-1)).toEqual({ method: 'list', from: '2026-08-01', to: '2026-08-31' });
    expect(inScreen.getByText('August 2026')).toBeInTheDocument();
  });

  it('offline, the error says the connection is needed', async () => {
    const fake = fakePriceChangesSource(SEPTEMBER);
    fake.failNext(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    open(SEPTEMBER, '/suppliers/price-changes', { data: { priceChanges: () => fake } });
    const inScreen = await report();
    expect(await inScreen.findByRole('alert')).toHaveTextContent('You are offline. Price changes need the connection.');
  });
});

describe('the controls', () => {
  it('switching to Week keeps the day the month ended on, and Next steps one week on', async () => {
    const { fake, user } = open();
    const inScreen = await report();
    await inScreen.findByText('Flour 00');
    await user.click(inScreen.getByRole('button', { name: 'Week' }));
    // September ended on the 30th (a Wednesday): the Sunday-to-Saturday week that holds it.
    await waitFor(() => { expect(listCalls(fake).at(-1)).toEqual({ method: 'list', from: '2026-09-27', to: '2026-10-03' }); });
    expect(inScreen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    expect(inScreen.getByText(/27 Sep.* – 3 Oct 2026/)).toBeInTheDocument();
    // Next steps one week on.
    await user.click(inScreen.getByRole('button', { name: 'Next period' }));
    await waitFor(() => { expect(listCalls(fake).at(-1)).toEqual({ method: 'list', from: '2026-10-04', to: '2026-10-10' }); });
  });

  it('a week that holds today stays on today when the kind is switched', async () => {
    const { fake, user } = open([]);
    const inScreen = await report();
    await inScreen.findByText('No changes in this period.');
    await user.click(inScreen.getByRole('button', { name: 'Week' }));
    await waitFor(() => { expect(listCalls(fake).at(-1)).toEqual({ method: 'list', from: '2026-10-25', to: '2026-10-31' }); });
    await user.click(inScreen.getByRole('button', { name: 'Month' }));
    await waitFor(() => { expect(listCalls(fake).at(-1)).toEqual({ method: 'list', from: '2026-10-01', to: '2026-10-31' }); });
  });

  it('Next is disabled on the period that holds today, and the focus moves to the period label, which is one live element', async () => {
    const { user } = open();
    const inScreen = await report();
    await inScreen.findByText('Flour 00');
    const label = inScreen.getByText('September 2026');
    expect(label).toHaveAttribute('aria-live', 'polite');
    expect(inScreen.getByRole('button', { name: 'Next period' })).toBeEnabled();
    await user.click(inScreen.getByRole('button', { name: 'Next period' }));
    await inScreen.findByText('No changes in this period.');
    expect(inScreen.getByRole('button', { name: 'Next period' })).toBeDisabled();
    // The very same element, updated in place.
    expect(label.isConnected).toBe(true);
    expect(label).toHaveTextContent('October 2026');
    expect(label).toHaveFocus();
    await user.click(inScreen.getByRole('button', { name: 'Previous period' }));
    expect(await inScreen.findByText('Flour 00')).toBeInTheDocument();
    expect(label).toHaveTextContent('September 2026');
  });

  it('⚠️ a late answer for a period no longer on show is dropped', async () => {
    const fake = fakePriceChangesSource([...SEPTEMBER, change('c-aug', { name: 'Late August item', ingredientId: 'ing-gone', date: '2026-08-10', pct: 7 })]);
    const { user } = open(SEPTEMBER, '/suppliers/price-changes', { data: { priceChanges: () => fake } });
    const inScreen = await report();
    await inScreen.findByText('Flour 00');
    const release = fake.hold();
    await user.click(inScreen.getByRole('button', { name: 'Previous period' }));
    await waitFor(() => { expect(listCalls(fake).at(-1)).toEqual({ method: 'list', from: '2026-08-01', to: '2026-08-31' }); });
    // Before August answers, the person goes on to July, which answers at once.
    await user.click(inScreen.getByRole('button', { name: 'Previous period' }));
    expect(await inScreen.findByText('No changes in this period.')).toBeInTheDocument();
    release();
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(inScreen.queryByText('Late August item')).not.toBeInTheDocument();
    expect(inScreen.getByText('No changes in this period.')).toBeInTheDocument();
    expect(inScreen.getByText('July 2026')).toBeInTheDocument();
  });
});

describe('the list', () => {
  it('draws increases and decreases, biggest first, the sign as text', async () => {
    open();
    const inScreen = await report();
    await inScreen.findByText('Flour 00');
    expect(inScreen.getByText('2 increases · 2 decreases')).toBeInTheDocument();
    const names = (title: string) => {
      const section = inScreen.getByRole('heading', { level: 3, name: title }).closest('section') as HTMLElement;
      return within(section).getAllByRole('listitem').map(item => item.querySelector('p')?.textContent);
    };
    expect(names('Increases')).toEqual(['Sugar', 'Flour 00']);
    expect(names('Decreases')).toEqual(['Milk', 'Butter']);
    expect(inScreen.getByText('+25%')).toBeInTheDocument();
    expect(inScreen.getByText('+10%')).toBeInTheDocument();
    expect(inScreen.getByText(`${MINUS}12%`)).toBeInTheDocument();
    expect(inScreen.getByText(`${MINUS}4%`)).toBeInTheDocument();
  });

  it('a section with nothing is not drawn, and the summary uses the singular', async () => {
    open([change('c-only', { ingredientId: 'ing-sugar', pct: 3 })]);
    const inScreen = await report();
    await inScreen.findByText('Sugar');
    expect(inScreen.getByText('1 increase · 0 decreases')).toBeInTheDocument();
    expect(inScreen.queryByRole('heading', { level: 3, name: 'Decreases' })).not.toBeInTheDocument();
  });

  it('a row names the live ingredient, the supplier, the invoice date and the prices per unit in the venue money', async () => {
    open([change('c-one', { name: 'Old flour name' })]);
    const inScreen = await report();
    const row = (await inScreen.findByText('Flour 00')).closest('li') as HTMLElement;
    expect(within(row).getByText(/Mill Co · invoice of 12 Sep.* 2026/)).toBeInTheDocument();
    expect(within(row).getByText(/1,00.*kg → .*1,10.*kg/)).toBeInTheDocument();
    expect(within(row).queryByText(/Different pack/)).not.toBeInTheDocument();
  });

  it('a change with no supplier says only the invoice date', async () => {
    open([change('c-one', { supplierId: undefined })]);
    const inScreen = await report();
    expect(await inScreen.findByText(/^Invoice of 12 Sep.* 2026$/)).toBeInTheDocument();
  });

  it('the different-pack line shows only when both packs exist and differ', async () => {
    open([
      change('c-a', { ingredientId: 'ing-flour', oldPack: 'Bag 1 kg', newPack: 'Bag 5 kg', pct: 9 }),
      change('c-b', { ingredientId: 'ing-sugar', oldPack: 'Bag 1 kg', newPack: 'Bag 1 kg', pct: 8 }),
      change('c-c', { ingredientId: 'ing-butter', oldPack: 'Bag 1 kg', pct: 7 }),
    ]);
    const inScreen = await report();
    await inScreen.findByText('Flour 00');
    expect(inScreen.getAllByText(/Different pack/)).toHaveLength(1);
    expect(inScreen.getByText('Different pack: Bag 1 kg → Bag 5 kg')).toBeInTheDocument();
  });

  it('a change of a deleted ingredient stays as history under its frozen name', async () => {
    open([change('c-gone', { ingredientId: 'ing-deleted', name: 'Frozen flour' })]);
    const inScreen = await report();
    expect(await inScreen.findByText('Frozen flour')).toBeInTheDocument();
  });

  it('the row dates follow the interface language too', async () => {
    open([change('c-one', {})], '/suppliers/price-changes', { lang: 'it' });
    const inScreen = await report('Variazioni prezzi');
    expect(await inScreen.findByText(/Mill Co · fattura del 12 set 2026/)).toBeInTheDocument();
  });

  it('it never writes and holds no edits', async () => {
    const { fake } = open();
    const inScreen = await report();
    await inScreen.findByText('Flour 00');
    expect(Object.keys(fake).filter(key => /^(set|save|delete|add|write|remove)/.test(key))).toEqual([]);
  });
});
