import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, todayISO, toISODate, weekdayOf } from '@mise/shared/day';
import { fakeOrdersDueSource } from '../testing/fakeOrdersDueSource';
import type { FakeOrdersDueSource } from '../testing/fakeOrdersDueSource';
import { renderApp } from '../testing/renderApp';
import homeCss from './HomeSection.module.css?raw';

// «Ordini da fare» on the Home (item 7 of docs/mockups/orders-tablet-2026-11.md): the suppliers still to order today, beside «Da fare»
// on a tablet and under it on a phone; a tap opens that supplier's order; none left, or nobody shown Orders, and the card is gone.

afterEach(() => { vi.unstubAllGlobals(); });

const TODAY = todayISO();
const WEEKDAY = weekdayOf(TODAY) as string;
const OTHER = weekdayOf(toISODate(addDays(parseISODate(TODAY), 2))) as string;
const LOAD = { timeout: 5000 };

const suppliers = () => [
  { id: 's-bee', name: 'Bee Farm', orderDays: [WEEKDAY] },
  { id: 's-alp', name: 'Alpine Mills', orderDays: [WEEKDAY] },
  { id: 's-cat', name: 'Cat Dairy', orderDays: [WEEKDAY] },
  { id: 's-dee', name: 'Dee Eggs', orderDays: [OTHER] },
];
const placed = (supplierId: string) => ({ id: `${TODAY}_${supplierId}`, date: TODAY, supplierId, quantities: { x: 1 } });

function show(source: FakeOrdersDueSource, options: Parameters<typeof renderApp>[1] = {}) {
  return renderApp('/home', { ...options, data: { ordersDue: () => source, ...options.data } });
}
const card = () => screen.queryByRole('region', { name: 'Orders to place' });
const names = () => within(card() as HTMLElement).getAllByRole('link').map(link => link.textContent);

describe('the «Ordini da fare» card', () => {
  it('lists the suppliers still to order today, A to Z: not one placed today, closed today, or with another order day', async () => {
    const source = fakeOrdersDueSource({ suppliers: suppliers(), records: [placed('s-cat')], draft: { skipped: { 's-bee': TODAY } } });
    show(source);
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    expect(names()).toEqual(['Alpine Mills']);
    expect(source.placedFrom).toBe(TODAY);
  });

  it('opens that supplier\'s order in Orders', async () => {
    const source = fakeOrdersDueSource({ suppliers: suppliers() });
    const { router, user } = show(source);
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    await user.click(within(card() as HTMLElement).getByRole('link', { name: 'Alpine Mills' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/orders/supplier/s-alp'); });
  });

  it('is gone when nobody is left, and goes the moment the last one is placed', async () => {
    const source = fakeOrdersDueSource({ suppliers: [{ id: 's-alp', name: 'Alpine Mills', orderDays: [WEEKDAY] }] });
    show(source);
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    act(() => { source.records = [placed('s-alp')]; source.emit(); });
    await waitFor(() => { expect(card()).toBeNull(); });
    expect(screen.getByRole('heading', { level: 2, name: 'To do' })).toBeInTheDocument();
  });

  it('⚠️ lists nobody before the SERVER has answered: offline, this phone\'s copy alone never lights a supplier', async () => {
    const source = fakeOrdersDueSource({ suppliers: suppliers() });
    source.cacheOnly = true;
    show(source);
    await screen.findByRole('heading', { level: 2, name: 'To do' }, LOAD);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(card()).toBeNull();
    act(() => { source.cacheOnly = false; source.emit(); });
    await waitFor(() => { expect(card()).not.toBeNull(); });
  });

  it('is hidden, and reads nothing, for somebody the venue does not show Orders to', async () => {
    const source = fakeOrdersDueSource({ suppliers: suppliers() });
    show(source, { session: { location: { sections: { orders: false } } } });
    await screen.findByRole('heading', { level: 2, name: 'To do' }, LOAD);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(card()).toBeNull();
    expect(source.watching()).toBe(0);
    expect(source.placedFrom).toBeNull();
  });

  it('gives up quietly on a dead stream: the card goes, the Home stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeOrdersDueSource({ suppliers: suppliers() });
    show(source);
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    act(() => { source.breakStreams(); });
    await waitFor(() => { expect(card()).toBeNull(); });
    expect(screen.getByRole('heading', { level: 2, name: 'To do' })).toBeInTheDocument();
  });

  it('stops its listeners when the Home is left (P14)', async () => {
    const source = fakeOrdersDueSource({ suppliers: suppliers() });
    const { router } = show(source);
    await waitFor(() => { expect(source.watching()).toBe(3); }, LOAD);
    await act(async () => { await router.navigate('/settings'); });
    expect(source.watching()).toBe(0);
  });

  it('says its title in Italian', async () => {
    show(fakeOrdersDueSource({ suppliers: suppliers() }), { lang: 'it' });
    expect(await screen.findByRole('region', { name: 'Ordini da fare' }, LOAD)).toBeInTheDocument();
  });

  it('stands right of «Da fare» on a tablet and under it on a phone', async () => {
    show(fakeOrdersDueSource({ suppliers: suppliers() }));
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    const todo = screen.getByRole('heading', { level: 2, name: 'To do' });
    // «Da fare» first in the page order (left, or above).
    expect(todo.compareDocumentPosition(card() as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const css = homeCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const [phone = '', tablet = ''] = css.split('@media (min-width: 1000px)');
    expect(phone).not.toMatch(/grid-template-columns/);
    expect(tablet).toMatch(/\.cards\[data-two="true"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    expect(tablet).not.toMatch(/\.cards\s*\{/);
    expect(tablet).toMatch(/\.column\[data-two="true"\]\s*\{[^}]*max-width:\s*72rem/);
    expect(todo.closest('[data-two]')).toHaveAttribute('data-two', 'true');
  });

  // Review of PR #565: without the card «Da fare» keeps its one readable column, never half a page beside an empty one.
  it('keeps «Da fare» in one column when the card is not drawn', async () => {
    show(fakeOrdersDueSource({ suppliers: [] }));
    const todo = await screen.findByRole('heading', { level: 2, name: 'To do' }, LOAD);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(card()).toBeNull();
    expect(todo.closest('[data-two]')).toBeNull();
  });

  it('hands a keyboard\'s focus to the card\'s title when its row goes, and to «Da fare» when the card goes', async () => {
    const source = fakeOrdersDueSource({ suppliers: suppliers() });
    show(source);
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    within(card() as HTMLElement).getByRole('link', { name: 'Alpine Mills' }).focus();
    act(() => { source.records = [placed('s-alp')]; source.emit(); });
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Orders to place' })).toHaveFocus(); });
    within(card() as HTMLElement).getByRole('link', { name: 'Bee Farm' }).focus();
    act(() => { source.records = ['s-alp', 's-bee', 's-cat'].map(placed); source.emit(); });
    await waitFor(() => { expect(card()).toBeNull(); });
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'To do' })).toHaveFocus(); });
  });

  // Review of PR #565: a click on blank space (focus to the body, no related target) must not make a later snapshot steal the focus.
  it('leaves the focus alone when it went to the page and a snapshot removes no row', async () => {
    const source = fakeOrdersDueSource({ suppliers: suppliers() });
    show(source);
    await waitFor(() => { expect(card()).not.toBeNull(); }, LOAD);
    const row = within(card() as HTMLElement).getByRole('link', { name: 'Alpine Mills' });
    row.focus();
    act(() => { row.blur(); });
    expect(document.body).toHaveFocus();
    act(() => { source.records = [placed('s-cat')]; source.emit(); });
    await waitFor(() => { expect(names()).toEqual(['Alpine Mills', 'Bee Farm']); });
    expect(document.body).toHaveFocus();
  });

  // Review of PR #565: the card’s data is read inside its own part, so a failure there takes the card down, never the Home.
  it('⚠️ keeps the Home when the card’s own data breaks while drawing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { id: 's-bad', name: 'Bad', get orderDays(): string[] { throw new Error('boom'); } };
    show(fakeOrdersDueSource({ suppliers: [broken] }));
    expect(await screen.findByRole('heading', { level: 2, name: 'To do' }, LOAD)).toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(screen.getByRole('heading', { level: 2, name: 'To do' })).toBeInTheDocument();
    expect(card()).toBeNull();
  });
});
