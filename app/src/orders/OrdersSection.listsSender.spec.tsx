import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';
import type { RosterRow } from './ordersSource';

// ⚠️ WHO A RECEIVED LIST IS SHOWN AS SENT BY (security audit; the current app's a8500872, shownSender). `fromName` is free text the
// rules can only measure: an employee could send a list «from Federico». The roster row for `fromUid` (written by the server) names
// the sender on BOTH screens whenever the roster has it; the typed name stands in only while the roster has not arrived or could
// not be read. Never an address, whatever the source.

const TODAY = todayISO();
const SUPPLIERS = [supplier('s-alp', { name: 'Alpine Mills', active: true })];
const ITEMS = [ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', active: true })];

function list(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: TODAY,
    fromUid: 'u-marco',
    fromName: 'Federico',
    quantities: { 'i-flour': 4 },
    names: { 'i-flour': 'Flour' },
    supplierOf: { 'i-flour': 's-alp' },
    supplierNames: { 's-alp': 'Alpine Mills' },
    done: {},
    note: '',
    createdAt: `${TODAY}T10:00:00.000Z`,
    updatedAt: `${TODAY}T10:00:00.000Z`,
    ...extra,
  };
}

const MARCO: RosterRow = { uid: 'u-marco', role: 'staff', firstName: 'Marco', lastName: 'Rossi' };

function seeded(requests: Record<string, Record<string, unknown>>, roster: RosterRow[] = [MARCO]): FakeOrdersSource {
  const source = fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, requests });
  source.roster = roster;
  return source;
}

const lists = () => within(screen.getByRole('region', { name: 'Order lists' }));
const one = () => within(screen.getByRole('region', { name: 'Order list' }));

async function atLists(source: FakeOrdersSource, options: Parameters<typeof renderOrders>[1] = {}) {
  renderOrders('/orders/lists', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
}

async function atOne(source: FakeOrdersSource, id: string) {
  renderOrders(`/orders/lists/${id}`, { source });
  await screen.findByRole('region', { name: 'Order list' }, LOAD);
}

describe('the name a received list is shown under', () => {
  it('⚠️ the lists: a list typed «from Federico» shows the roster name of the account that sent it', async () => {
    await atLists(seeded({ 'r-1': list() }));
    await waitFor(() => expect(lists().getByRole('listitem').textContent).toMatch(/^From Marco Rossi/), LOAD);
    expect(document.body.textContent).not.toContain('Federico');
  });

  it('⚠️ one list: the same, the roster name and never the typed one', async () => {
    await atOne(seeded({ 'r-1': list() }), 'r-1');
    expect(await one().findByText('From Marco Rossi', undefined, LOAD)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Federico');
  });

  it('reads the roster once, however many times the screens are drawn', async () => {
    const source = seeded({ 'r-1': list(), 'r-2': list({ fromUid: 'u-gone', fromName: 'Elena' }) });
    const getRoster = vi.spyOn(source, 'getRoster');
    await atLists(source);
    await waitFor(() => expect(lists().getAllByRole('listitem')[0]?.textContent).toMatch(/From Marco Rossi/), LOAD);
    expect(getRoster).toHaveBeenCalledTimes(1);
  });

  it('a sender the roster no longer has keeps the typed name', async () => {
    await atLists(seeded({ 'r-1': list({ fromUid: 'u-gone', fromName: 'Elena' }) }));
    await waitFor(() => expect(firstCard()).toMatch(/^From Elena/), LOAD);
  });

  it('⚠️ a roster row with no name still wins: «Someone», never the typed name', async () => {
    await atLists(seeded({ 'r-1': list() }, [{ uid: 'u-marco', role: 'staff', firstName: '', lastName: '' }]));
    await waitFor(() => expect(firstCard()).toMatch(/^From Someone/), LOAD);
    expect(document.body.textContent).not.toContain('Federico');
  });

  it('a roster that is refused: the typed name stands in, on both screens', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const source = seeded({ 'r-1': list({ fromName: 'Marco' }) });
    source.failRead = true;
    await atLists(source);
    await waitFor(() => expect(warn).toHaveBeenCalled(), LOAD);
    expect(firstCard()).toMatch(/^From Marco/);
    warn.mockRestore();
  });

  it('one list, roster refused: the typed name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const source = seeded({ 'r-1': list({ fromName: 'Marco' }) });
    source.failRead = true;
    await atOne(source, 'r-1');
    await waitFor(() => expect(warn).toHaveBeenCalled(), LOAD);
    expect(one().getByText('From Marco')).toBeInTheDocument();
    warn.mockRestore();
  });

  it('while the roster is on its way the typed name is shown, and the roster name replaces it when it lands', async () => {
    const source = seeded({ 'r-1': list() });
    let land: (rows: RosterRow[]) => void = () => undefined;
    source.getRoster = () => new Promise<RosterRow[]>(resolve => { land = resolve; });
    await atLists(source);
    expect(firstCard()).toMatch(/^From Federico/);
    land([MARCO]);
    await waitFor(() => expect(firstCard()).toMatch(/^From Marco Rossi/), LOAD);
  });

  it('⚠️ a typed address is never printed: «Qualcuno» in Italian, with no roster row for the sender', async () => {
    await atLists(seeded({ 'r-1': list({ fromUid: 'u-gone', fromName: 'boss@example.test' }) }), { lang: 'it' });
    const card = () => within(screen.getByRole('region', { name: 'Liste d’ordine' })).getAllByRole('listitem')[0]?.textContent ?? '';
    await waitFor(() => expect(card()).toMatch(/^Da Qualcuno/), LOAD);
    expect(document.body.textContent).not.toContain('boss@example.test');
  });

  it('⚠️ a typed address is «Someone» while the roster is refused, too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const source = seeded({ 'r-1': list({ fromName: 'boss@example.test' }) });
    source.failRead = true;
    await atLists(source);
    await waitFor(() => expect(warn).toHaveBeenCalled(), LOAD);
    expect(firstCard()).toMatch(/^From Someone/);
    expect(document.body.textContent).not.toContain('boss@example.test');
    warn.mockRestore();
  });
});

function firstCard(): string {
  return lists().getAllByRole('listitem')[0]?.textContent ?? '';
}
