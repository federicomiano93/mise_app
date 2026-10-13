import { describe, expect, test, vi } from 'vitest';
import { cloneConfig, DEFAULT_CONFIG } from '@mise/shared/calculator-config';
import type { CalculatorConfig } from '@mise/shared/calculator-config';
import { fakeClientOrdersSource } from '../testing/fakeClientOrdersSource';
import { menusWouldChange } from './clientOrdersModel';
import { accountOf, orderingLinkFor, tokenFrom } from './clientOrdersSource';
import { createClientOrdersStore, sortOrders, stillComing } from './clientOrdersStore';
import type { ClientOrdersMessage } from './clientOrdersStore';

// 13 Oct 2026, 09:00 local: the stream starts from «2026-10-13».
const NOW = new Date(2026, 9, 13, 9, 0).getTime();

const order = (date: string, clientId: string, extra: Record<string, unknown> = {}) => ({
  id: `${date}_${clientId}`, date, clientId, clientName: clientId, quantities: { p1: 3 },
  createdAt: `${date}T06:00:00.000Z`, updatedAt: `${date}T06:00:00.000Z`, ...extra,
});

function setup(seed: Parameters<typeof fakeClientOrdersSource>[0] = {}) {
  const source = fakeClientOrdersSource(seed);
  const warn = vi.fn();
  const store = createClientOrdersStore(source, { now: () => NOW, warn });
  const messages: ClientOrdersMessage[] = [];
  store.onMessage(message => messages.push(message));
  return { source, store, messages, warn };
}

describe('the orders still to come', () => {
  test('are watched from today, soonest day first, then the client who has waited longest', () => {
    const { store } = setup({ orders: [
      order('2026-10-15', 'a'),
      order('2026-10-14', 'b', { updatedAt: '2026-10-13T08:00:00.000Z' }),
      order('2026-10-14', 'c', { updatedAt: '2026-10-13T07:00:00.000Z' }),
      order('2026-10-12', 'old'),
    ] });
    store.start();
    const snap = store.getSnapshot();
    expect(snap.orders.map(o => o.id)).toEqual(['2026-10-14_c', '2026-10-14_b', '2026-10-15_a']);
    expect(snap.ordersLoaded).toBe(true);
    expect(snap.ordersFromServer).toBe(true);
    expect(snap.ordersFailed).toBe(false);
  });

  test('a from-cache answer is an answer but not the server\'s', () => {
    const { source, store } = setup({ orders: [order('2026-10-14', 'a')] });
    source.hold();
    store.start();
    expect(store.getSnapshot().ordersLoaded).toBe(false);
    source.push({ fromServer: false });
    expect(store.getSnapshot().ordersLoaded).toBe(true);
    expect(store.getSnapshot().ordersFromServer).toBe(false);
    source.push();
    expect(store.getSnapshot().ordersFromServer).toBe(true);
  });

  test('a dead stream empties the list and says it failed (never a stale banner)', () => {
    const { source, store } = setup({ orders: [order('2026-10-14', 'a')] });
    store.start();
    expect(store.getSnapshot().orders).toHaveLength(1);
    source.refuse.orders = true;
    source.push();
    expect(store.getSnapshot().orders).toEqual([]);
    expect(store.getSnapshot().ordersFailed).toBe(true);
  });

  test('stop() ends every listener', () => {
    const { source, store } = setup();
    store.start();
    expect(source.watching()).toBe(2);
    store.stop();
    expect(source.watching()).toBe(0);
  });

  test('stillComing drops a day that has gone by since the stream started; sortOrders does not mutate', () => {
    const list = [order('2026-10-13', 'a'), order('2026-10-14', 'b')];
    expect(stillComing(list, '2026-10-14').map(o => o.id)).toEqual(['2026-10-14_b']);
    const copy = list.slice();
    sortOrders(list.reverse());
    expect(list.map(o => o.id)).toEqual(copy.reverse().map(o => o.id));
  });
});

describe('the deadline', () => {
  test('no document reads as the default 16:00; a real answer, including none, is believed', () => {
    const { source, store } = setup();
    store.start();
    expect(store.getSnapshot().cutoff).toBe('16:00');
    expect(store.getSnapshot().cutoffFromServer).toBe(true);
    source.cutoff = '';
    source.push();
    expect(store.getSnapshot().cutoff).toBe('');
    source.cutoff = '14:30';
    source.push();
    expect(store.getSnapshot().cutoff).toBe('14:30');
  });

  test('a junk value reads as no deadline; a broken stream as none too', () => {
    const { source, store } = setup({ cutoff: '25:99' });
    store.start();
    expect(store.getSnapshot().cutoff).toBe('');
    source.cutoff = '15:00';
    source.refuse.cutoff = true;
    source.push();
    expect(store.getSnapshot().cutoff).toBe('');
  });

  test('a cached answer does not count as the server\'s', () => {
    const { source, store } = setup({ cutoff: '15:00' });
    source.hold();
    store.start();
    source.push({ fromServer: false });
    expect(store.getSnapshot().cutoff).toBe('15:00');
    expect(store.getSnapshot().cutoffFromServer).toBe(false);
  });

  test('a deadline written shows at once, holds the busy marker until answered, and is stored', () => {
    const { source, store } = setup({ cutoff: '16:00' });
    store.start();
    source.holdWrites();
    store.saveCutoff('18:15');
    expect(store.getSnapshot().cutoff).toBe('18:15');
    expect(store.getSnapshot().cutoffSaving).toBe(true);
    expect(store.getSnapshot().unsent).toBe(true);
    source.settleWrites();
    return Promise.resolve().then(() => {
      expect(source.savedCutoffs).toEqual(['18:15']);
      expect(store.getSnapshot().cutoff).toBe('18:15');
      expect(store.getSnapshot().unsent).toBe(false);
    });
  });

  test('an empty deadline is written as \'\' (no deadline), not as the default', async () => {
    const { source, store } = setup({ cutoff: '16:00' });
    store.start();
    store.saveCutoff('');
    await Promise.resolve();
    expect(source.savedCutoffs).toEqual(['']);
    expect(store.getSnapshot().cutoff).toBe('');
  });

  test('a refused deadline puts the old one back and says so', async () => {
    const { source, store, messages } = setup({ cutoff: '16:00' });
    store.start();
    source.refuse.cutoffSave = true;
    store.saveCutoff('10:00');
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot().cutoff).toBe('16:00');
    expect(store.getSnapshot().unsent).toBe(false);
    expect(messages).toEqual([{ kind: 'cutoff-not-saved' }]);
  });
});

describe('«this order went into the Calculator»', () => {
  test('records which VERSION was used, holding the busy marker until answered', async () => {
    const changed = order('2026-10-14', 'a', { updatedAt: '2026-10-13T08:30:00.000Z' });
    const { source, store } = setup({ orders: [changed] });
    store.start();
    source.holdWrites();
    store.markApplied(store.getSnapshot().orders[0]!);
    expect(store.getSnapshot().unsent).toBe(true);
    source.settleWrites();
    await Promise.resolve();
    await Promise.resolve();
    expect(source.applied).toEqual([{ id: '2026-10-14_a', appliedFor: '2026-10-13T08:30:00.000Z' }]);
    expect(store.getSnapshot().unsent).toBe(false);
    expect(store.getSnapshot().orders[0]!.appliedFor).toBe('2026-10-13T08:30:00.000Z');
  });

  test('a failure to record it is REPORTED', async () => {
    const { source, store, messages } = setup({ orders: [order('2026-10-14', 'a')] });
    store.start();
    source.refuse.applied = true;
    store.markApplied(store.getSnapshot().orders[0]!);
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toEqual([{ kind: 'applied-not-recorded' }]);
    expect(store.getSnapshot().unsent).toBe(false);
  });
});

describe('the ordering links', () => {
  const account = { uid: 'u1', clientId: 'c-roma', clientName: 'Cafe Roma', createdAt: '', linkToken: 'tok' };
  const venue = { name: 'Test Bakery', country: 'GB' as const };

  test('are read on demand, keyed by client', async () => {
    const { store } = setup({ accounts: [account] });
    expect(store.getSnapshot().accountsState).toBe('idle');
    const loading = store.loadAccounts();
    expect(store.getSnapshot().accountsState).toBe('loading');
    await loading;
    expect(store.getSnapshot().accountsState).toBe('ready');
    expect(store.getSnapshot().accounts['c-roma']?.uid).toBe('u1');
  });

  test('a failed read is «failed», never «no link» (Create would cut a working link off)', async () => {
    const { source, store } = setup({ accounts: [account] });
    source.refuse.accounts = true;
    await store.loadAccounts();
    expect(store.getSnapshot().accountsState).toBe('failed');
    expect(store.getSnapshot().accounts).toEqual({});
  });

  test('creating a link for a client that has one REPLACES it (the old grant goes)', async () => {
    const { source, store } = setup({ accounts: [account] });
    await store.loadAccounts();
    const created = await store.createLink({ id: 'c-roma', name: 'Cafe Roma', products: [] }, venue);
    expect(source.accounts.has('u1')).toBe(false);
    expect(store.getSnapshot().accounts['c-roma']).toMatchObject({ uid: created.uid, linkToken: created.token });
    expect(source.menuWrites).toEqual(['c-roma']);
  });

  test('a link made while a read is in the air asks again, never stays «loading»', async () => {
    const { source, store } = setup({ accounts: [account] });
    const real = source.listAccounts.bind(source);
    let answer: (() => void) | null = null;
    source.listAccounts = () => new Promise(resolve => { answer = () => resolve([]); });
    const first = store.loadAccounts();
    source.listAccounts = real;
    await store.createLink({ id: 'c-milano', name: 'Bar Milano', products: [] }, venue);
    answer!();
    await first;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getSnapshot().accountsState).toBe('ready');
    expect(Object.keys(store.getSnapshot().accounts).sort()).toEqual(['c-milano', 'c-roma']);
  });

  test('a refused create changes nothing and rejects', async () => {
    const { source, store } = setup({ accounts: [account] });
    await store.loadAccounts();
    source.refuse.create = true;
    await expect(store.createLink({ id: 'c-roma', name: 'Cafe Roma' }, venue)).rejects.toThrow();
    expect(store.getSnapshot().accounts['c-roma']?.uid).toBe('u1');
  });

  test('turning a link off deletes its grant; a refusal keeps it', async () => {
    const { source, store } = setup({ accounts: [account] });
    await store.loadAccounts();
    source.refuse.revoke = true;
    await expect(store.revokeLink('c-roma')).rejects.toThrow();
    expect(store.getSnapshot().accounts['c-roma']).toBeDefined();
    source.refuse.revoke = false;
    await store.revokeLink('c-roma');
    expect(store.getSnapshot().accounts['c-roma']).toBeUndefined();
    expect(source.accounts.size).toBe(0);
  });
});

describe('the menus', () => {
  const venue = { name: 'Test Bakery', country: 'IT' as const };
  const roma = { id: 'c-roma', name: 'Cafe Roma', products: [{ id: 'p1', name: 'Pizza', kind: 'number' }] };

  test('only the menus that moved are written; a paused product leaves the menu', async () => {
    const { source, store } = setup();
    await store.publishMenus([roma, { id: 'bad_id', name: 'X', products: [] }], venue);
    expect(source.menuWrites).toEqual(['c-roma']);
    expect(source.menus.get('c-roma')).toMatchObject({ bakeryName: 'Test Bakery', country: 'IT' });
    await store.publishMenus([roma], venue);
    expect(source.menuWrites).toEqual(['c-roma']);
    await store.publishMenus([{ ...roma, products: [{ id: 'p1', name: 'Pizza', active: false }] }], venue);
    expect(source.menuWrites).toEqual(['c-roma', 'c-roma']);
    expect(source.menus.get('c-roma')!.products).toEqual([]);
  });

  test('a failure is logged, never thrown', async () => {
    const { source, store, warn } = setup();
    source.refuse.menus = true;
    await expect(store.publishMenus([roma], venue)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  test('menusWouldChange: only a change a client can see', () => {
    const base: CalculatorConfig = { ...cloneConfig(DEFAULT_CONFIG), clients: [roma as never] };
    const recipesOnly: CalculatorConfig = { ...base, recipes: [{ id: 'r1', name: 'Dough' } as never] };
    expect(menusWouldChange(base, recipesOnly)).toBe(false);
    expect(menusWouldChange(base, { ...base, clients: [{ ...roma, name: 'Caffè Roma' } as never] })).toBe(true);
    expect(menusWouldChange(base, { ...base, clients: [] })).toBe(true);
    expect(menusWouldChange(base, { ...base, clients: [{ ...roma, products: [] } as never] })).toBe(true);
  });
});

describe('the link itself', () => {
  test('the token is 32 random bytes in base64url without padding', () => {
    const token = tokenFrom(new Uint8Array(32).fill(255));
    expect(token).toBe('_'.repeat(42) + '8');
    expect(token).not.toMatch(/[+/=]/);
    expect(() => tokenFrom(new Uint8Array(8))).toThrow();
  });

  test('points at order.html at the site\'s root, with the secret in the fragment', () => {
    expect(orderingLinkFor('t/k', 'loc-1', 'https://example.test/mise_app/mise2/#/calculator/settings'))
      .toBe('https://example.test/mise_app/order.html#b=loc-1&k=t%2Fk');
    expect(orderingLinkFor('tok', 'bakery', 'https://example.test/mise_app/#/calculator'))
      .toBe('https://example.test/mise_app/order.html#b=bakery&k=tok');
    expect(orderingLinkFor('tok', 'bakery', 'https://preview.test/mise2/'))
      .toBe('https://preview.test/order.html#b=bakery&k=tok');
  });

  test('a grant without a client names nobody; a missing token is null', () => {
    expect(accountOf('u', { clientName: 'x' })).toBeNull();
    expect(accountOf('u', { clientId: 'c', linkToken: '' })).toMatchObject({ uid: 'u', clientId: 'c', linkToken: null });
  });
});
