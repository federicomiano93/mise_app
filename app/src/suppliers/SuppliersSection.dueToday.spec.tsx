import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO, weekdayOf } from '@mise/shared/day';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, renderSuppliers, split, supplier } from '../testing/renderSuppliers';

// «Ingredients & suppliers», the Suppliers tab: the suppliers STILL TO ORDER TODAY are tagged «To order today», tinted and listed
// first (item 12 of docs/mise2-port-owed.md; the first-in-the-list order is Mise 2's own, his note of 9 Nov 2026). The rule is
// reminders' dueTodayIds, the one the Orders section's «Order today» strip uses.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const TODAY = todayISO();
const WEEKDAY = weekdayOf(TODAY) as string;
const NOT_TODAY = WEEKDAY === 'Monday' ? 'Tuesday' : 'Monday';

// A–Z: Alpine has another order day, Bee and Cat are ordered today, Dee was ordered this morning, Eve was closed as not ordered.
const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills', orderDays: [NOT_TODAY] }),
  supplier('s-bee', { name: 'Bee Farm', orderDays: [WEEKDAY] }),
  supplier('s-cat', { name: 'Cat Dairy', orderDays: [WEEKDAY] }),
  supplier('s-dee', { name: 'Dee Eggs', orderDays: [WEEKDAY] }),
  supplier('s-eve', { name: 'Eve Fish', orderDays: [WEEKDAY] }),
];
const PLACED = [{ id: `${TODAY}_s-dee`, date: TODAY, supplierId: 's-dee' }];
const CLOSED = { entries: {}, days: {}, skipped: { 's-eve': TODAY } };
const USUAL = ['Alpine Mills', 'Bee Farm', 'Cat Dairy', 'Dee Eggs', 'Eve Fish'];

const main = () => within(screen.getByRole('main'));
const rows = () => main().getAllByRole('listitem');
const rowNames = () => rows().map(row => row.querySelector('button > span > span')?.textContent ?? '');
const rowOf = (name: string) => rows().find(row => row.querySelector('button > span > span')?.textContent === name) as HTMLElement;
const buttonOf = (name: string) => rowOf(name).querySelector('button') as HTMLButtonElement;
const tagged = () => screen.queryAllByText('To order today');

function seeded(extra: Partial<Parameters<typeof fakeSuppliersSource>[0]> = {}): FakeSuppliersSource {
  const source = fakeSuppliersSource({ suppliers: SUPPLIERS, ...extra });
  source.placedRecords = PLACED;
  source.draftDoc = CLOSED;
  return source;
}

async function loaded(source = seeded(), options: Parameters<typeof renderSuppliers>[1] = {}) {
  const view = renderSuppliers('/suppliers/suppliers', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

describe('the suppliers to order today in the Suppliers list', () => {
  it('tags only the suppliers still to order, and puts them first in their usual order, the rest after them unchanged', async () => {
    await loaded();
    await waitFor(() => { expect(tagged()).toHaveLength(2); }, LOAD);
    expect(rowNames()).toEqual(['Bee Farm', 'Cat Dairy', 'Alpine Mills', 'Dee Eggs', 'Eve Fish']);
    for (const name of ['Alpine Mills', 'Dee Eggs', 'Eve Fish']) {
      expect(rowOf(name)).not.toHaveTextContent('To order today');
      expect(buttonOf(name)).not.toHaveAttribute('data-due');
    }
    expect(buttonOf('Bee Farm')).toHaveAttribute('data-due', 'true');
  });

  it('puts the tag in the row button, so it is part of its accessible name', async () => {
    await loaded();
    await waitFor(() => { expect(tagged()).toHaveLength(2); }, LOAD);
    expect(await screen.findByRole('button', { name: /^Bee Farm.*To order today/ }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cat Dairy.*To order today/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Alpine Mills(?!.*To order today)/ })).toBeInTheDocument();
  });

  it('says it in Italian', async () => {
    await loaded(seeded(), { lang: 'it', session: { language: 'it' } });
    expect(await screen.findAllByText('Da ordinare oggi', undefined, LOAD)).toHaveLength(2);
    expect(screen.queryByText('To order today')).not.toBeInTheDocument();
  });

  it('⚠️ lights nobody and keeps the usual order until the records and the draft have arrived', async () => {
    const source = seeded();
    source.holdDue();
    await loaded(source);
    expect(tagged()).toHaveLength(0);
    expect(rowNames()).toEqual(USUAL);
    act(() => { source.releaseDue(); });
    await waitFor(() => { expect(tagged()).toHaveLength(2); });
    expect(rowNames()).toEqual(['Bee Farm', 'Cat Dairy', 'Alpine Mills', 'Dee Eggs', 'Eve Fish']);
  });

  it('⚠️ waits for the draft as well as for the records', async () => {
    const source = seeded();
    source.watchDraft = () => () => undefined;
    await loaded(source);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(tagged()).toHaveLength(0);
    expect(rowNames()).toEqual(USUAL);
  });

  it('a dead draft counts as arrived with no closes: the closed supplier is lit again, the safe side', async () => {
    const source = seeded();
    source.refuse.draftDoc = true;
    await loaded(source);
    await waitFor(() => { expect(tagged()).toHaveLength(3); }, LOAD);
    expect(buttonOf('Eve Fish')).toHaveAttribute('data-due', 'true');
  });

  it('a dead records stream lights nobody', async () => {
    const source = seeded();
    source.refuse.placed = true;
    await loaded(source);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(tagged()).toHaveLength(0);
    expect(rowNames()).toEqual(USUAL);
  });

  it('never lights a switched-off supplier', async () => {
    const off = [SUPPLIERS[0]!, supplier('s-bee', { name: 'Bee Farm', orderDays: [WEEKDAY], active: false }), ...SUPPLIERS.slice(2)];
    await loaded(seeded({ suppliers: off }));
    await waitFor(() => { expect(tagged()).toHaveLength(1); }, LOAD);
    expect(rowNames()[0]).toBe('Cat Dairy');
    expect(rowOf('Bee Farm')).toHaveTextContent('Switched off');
  });

  it('puts the due ones first inside each group when some suppliers are starred', async () => {
    const source = seeded({ ordersConfig: { favouriteSuppliers: ['s-alp', 's-cat'] } });
    await loaded(source);
    await waitFor(() => { expect(tagged()).toHaveLength(2); }, LOAD);
    // Favourites: Cat (due) before Alpine; the others: Bee (due) before Dee and Eve. The headings stay.
    expect(rowNames()).toEqual(['Cat Dairy', 'Alpine Mills', 'Bee Farm', 'Dee Eggs', 'Eve Fish']);
    expect(main().getAllByRole('heading', { level: 2 })).toHaveLength(2);
  });

  it('is applied inside what a search shows', async () => {
    const { user } = await loaded();
    await waitFor(() => { expect(tagged()).toHaveLength(2); }, LOAD);
    await user.type(screen.getByRole('searchbox'), 'e');
    await waitFor(() => { expect(rowNames()).toEqual(['Bee Farm', 'Alpine Mills', 'Dee Eggs', 'Eve Fish']); });
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'dee');
    await waitFor(() => { expect(rowNames()).toEqual(['Dee Eggs']); });
  });

  it('follows a supplier being placed or closed on another phone', async () => {
    const source = seeded();
    await loaded(source);
    await waitFor(() => { expect(tagged()).toHaveLength(2); }, LOAD);
    act(() => { source.setDraftDoc({ ...CLOSED, skipped: { 's-eve': TODAY, 's-bee': TODAY } }); });
    await waitFor(() => { expect(rowNames()).toEqual(['Cat Dairy', 'Alpine Mills', 'Bee Farm', 'Dee Eggs', 'Eve Fish']); });
    act(() => { source.setPlaced([...PLACED, { id: `${TODAY}_s-cat`, date: TODAY, supplierId: 's-cat' }]); });
    await waitFor(() => { expect(tagged()).toHaveLength(0); });
    expect(rowNames()).toEqual(USUAL);
  });

  it('opens ONE listener on the records and ONE on the draft, from today', async () => {
    const source = seeded();
    await loaded(source);
    expect(source.placedWatches).toBe(1);
    expect(source.draftWatches).toBe(1);
    expect(source.placedFrom).toEqual([TODAY]);
  });

  it('does not redraw the rows when the draft changes without changing who is closed', async () => {
    const source = seeded();
    await loaded(source);
    await waitFor(() => { expect(tagged()).toHaveLength(2); }, LOAD);
    const bee = rowOf('Bee Farm');
    act(() => { source.setDraftDoc({ ...CLOSED, entries: { 'i-flour': { qty: 3 } }, updatedAt: 'later' }); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(rowOf('Bee Farm')).toBe(bee);
    expect(rowNames().slice(0, 2)).toEqual(['Bee Farm', 'Cat Dairy']);
  });

  // ⚠️ The FOCUSED row is the one pushed DOWN: [Alpine, Bee, Cat] with nobody due, Alpine focused; Bee becomes due and goes first, so
  // Alpine's node is the one React moves — and a moved node loses the focus in a browser. useFocusAcrossReorder hands it back (the hook
  // itself is proved against a simulated loss in shell/useFocusAcrossReorder.spec.tsx; jsdom keeps the focus of a moved node, so this
  // spec pins the behaviour of the whole list: the same node, still current, still focused).
  it('keeps the focus and the open supplier when the order change pushes the focused row down', async () => {
    split();
    const suppliers = [
      supplier('s-alp', { name: 'Alpine Mills', orderDays: [NOT_TODAY] }),
      supplier('s-bee', { name: 'Bee Farm', orderDays: [NOT_TODAY] }),
      supplier('s-cat', { name: 'Cat Dairy', orderDays: [NOT_TODAY] }),
    ];
    const source = fakeSuppliersSource({ suppliers });
    const { user, router } = await loaded(source);
    await waitFor(() => { expect(rowNames()).toEqual(['Alpine Mills', 'Bee Farm', 'Cat Dairy']); }, LOAD);
    await user.click(buttonOf('Alpine Mills'));
    await waitFor(() => { expect(buttonOf('Alpine Mills')).toHaveAttribute('aria-current', 'true'); });
    const alpine = buttonOf('Alpine Mills');
    act(() => { alpine.focus(); });
    expect(alpine).toHaveFocus();
    const path = router.state.location.pathname;
    act(() => { source.suppliers.set('s-bee', { ...suppliers[1]!, orderDays: [WEEKDAY] }); source.push(); });
    await waitFor(() => { expect(rowNames()).toEqual(['Bee Farm', 'Alpine Mills', 'Cat Dairy']); });
    expect(buttonOf('Alpine Mills')).toBe(alpine);
    expect(alpine).toHaveAttribute('aria-current', 'true');
    expect(alpine).toHaveFocus();
    expect(router.state.location.pathname).toBe(path);
  });

  it('⚠️ a saved copy that lacks this morning’s record lights nobody until the SERVER answers (no flash, no jump)', async () => {
    const source = seeded();
    source.placedRecords = [];
    source.draftDoc = null;
    source.fromCache = true;
    await loaded(source);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(tagged()).toHaveLength(0);
    expect(rowNames()).toEqual(USUAL);
    // Bee was ordered this morning on another phone: the server's snapshot has it, and Bee never shows as due.
    source.placedRecords = [...PLACED, { id: `${TODAY}_s-bee`, date: TODAY, supplierId: 's-bee' }];
    source.fromCache = false;
    act(() => { source.push(); });
    await waitFor(() => { expect(tagged()).toHaveLength(2); });
    expect(buttonOf('Bee Farm')).not.toHaveAttribute('data-due');
    expect(rowNames().slice(0, 2)).toEqual(['Cat Dairy', 'Eve Fish']);
  });

  it('offline, with no word from the server for the records and the draft: nobody is lit and the usual order stays', async () => {
    const source = seeded();
    source.fromCache = true;
    await loaded(source);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(tagged()).toHaveLength(0);
    expect(rowNames()).toEqual(USUAL);
  });

  it('works the lit set out again when the day changes at midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 10, 9, 23, 59, 0));
    const suppliers = [
      supplier('s-alp', { name: 'Alpine Mills', orderDays: ['Tuesday'] }),
      supplier('s-bee', { name: 'Bee Farm', orderDays: ['Monday'] }),
    ];
    await loaded(fakeSuppliersSource({ suppliers }));
    await waitFor(() => { expect(rowNames()).toEqual(['Bee Farm', 'Alpine Mills']); }, LOAD);
    expect(tagged()).toHaveLength(1);
    vi.setSystemTime(new Date(2026, 10, 10, 0, 0, 30));
    act(() => { vi.advanceTimersByTime(60_000); });
    await waitFor(() => { expect(rowNames()).toEqual(['Alpine Mills', 'Bee Farm']); });
    expect(rowOf('Alpine Mills')).toHaveTextContent('To order today');
    expect(rowOf('Bee Farm')).not.toHaveTextContent('To order today');
  });
});
