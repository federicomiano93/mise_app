import { describe, expect, it } from 'vitest';
import { SCREEN_RE } from '@mise/shared/usage-model';
import { CALCULATOR_CLIENT_PATHS } from '../calculator/clientsPaths';
import { screenNameFor } from '../shell/sections';
import {
  CLIENTS_ORDERS_HISTORY_PATH, CLIENTS_ORDERS_PATH, CLIENTS_ORDERING_PATH, CLIENTS_PATH, clientsPaths, clientsScreenName, parseClientsPath,
  resolveClientsPath,
} from './clientsPath';

describe('the addresses under /clients', () => {
  it('reads the page, the address book, one client, the orders, the history and the deadline', () => {
    expect(parseClientsPath('')).toEqual({ kind: 'hub' });
    expect(parseClientsPath(undefined)).toEqual({ kind: 'hub' });
    expect(parseClientsPath('/list')).toEqual({ kind: 'list', target: { kind: 'list' } });
    expect(parseClientsPath('/list/roma')).toEqual({ kind: 'list', target: { kind: 'one', id: 'roma' } });
    expect(parseClientsPath('/list/new')).toEqual({ kind: 'list', target: { kind: 'new' } });
    expect(parseClientsPath('/orders')).toEqual({ kind: 'orders', view: 'coming' });
    expect(parseClientsPath('/orders/history')).toEqual({ kind: 'orders', view: 'history' });
    expect(parseClientsPath('/ordering')).toEqual({ kind: 'ordering' });
  });

  it('decodes a client id after splitting the address, so an id with a slash comes back whole', () => {
    expect(parseClientsPath(`/list/${encodeURIComponent('a/b%c')}`)).toEqual({ kind: 'list', target: { kind: 'one', id: 'a/b%c' } });
  });

  it('knows nothing of WhatsApp, the Calculator\'s other screens, or anything junk', () => {
    for (const rest of ['/whatsapp', '/settings', '/log', '/list/a/b', '/orders/old', '/orders/history/x', '/ordering/x', '/list/%E0%A4%A', '/zzz']) {
      expect(parseClientsPath(rest)).toEqual({ kind: 'unknown' });
    }
  });

  it('sends an unknown address to the page and «new» to the list', () => {
    expect(resolveClientsPath('/whatsapp')).toEqual({ redirect: CLIENTS_PATH });
    expect(resolveClientsPath('/orders/old')).toEqual({ redirect: CLIENTS_PATH });
    expect(resolveClientsPath('/list/new')).toEqual({ redirect: `${CLIENTS_PATH}/list` });
    expect(resolveClientsPath('/list/roma')).toEqual({ list: { kind: 'one', id: 'roma' } });
    expect(resolveClientsPath('/orders/history')).toEqual({ orders: 'history' });
    expect(resolveClientsPath('')).toEqual({ hub: true });
  });

  it('builds the addresses the client screens link to', () => {
    expect(clientsPaths.hub).toBe('/clients');
    expect(clientsPaths.list).toBe('/clients/list');
    expect(clientsPaths.client('c 1')).toBe('/clients/list/c%201');
    expect(clientsPaths.orders).toBe(CLIENTS_ORDERS_PATH);
    expect(clientsPaths.ordersHistory).toBe(CLIENTS_ORDERS_HISTORY_PATH);
    expect(clientsPaths.ordersBack).toBe('/clients');
    expect(clientsPaths.ordering).toBe(CLIENTS_ORDERING_PATH);
    // Moving inside the editor is never leaving it; the page and the orders are outside.
    expect(clientsPaths.inEditor('/clients/list')).toBe(true);
    expect(clientsPaths.inEditor('/clients/list/roma')).toBe(true);
    expect(clientsPaths.inEditor('/clients')).toBe(false);
    expect(clientsPaths.inEditor('/clients/listing')).toBe(false);
    expect(clientsPaths.inEditor('/clients/orders')).toBe(false);
  });

  it('every address the client screens link to is one the section resolves to a screen, not a redirect', () => {
    for (const path of [clientsPaths.list, clientsPaths.client('x'), clientsPaths.orders, clientsPaths.ordersHistory, clientsPaths.ordering]) {
      expect(resolveClientsPath(path.slice(CLIENTS_PATH.length))).not.toHaveProperty('redirect');
    }
  });

  it('the Calculator\'s own addresses are still the default of the same shape', () => {
    expect(Object.keys(CALCULATOR_CLIENT_PATHS).sort()).toEqual(Object.keys(clientsPaths).sort());
    expect(CALCULATOR_CLIENT_PATHS.hub).toBe('/calculator/settings');
    expect(CALCULATOR_CLIENT_PATHS.ordersBack).toBe('/calculator');
    expect(CALCULATOR_CLIENT_PATHS.inEditor('/calculator/settings/clients/x')).toBe(true);
  });
});

describe('what the usage record calls the screens', () => {
  it('names the page, the editor (list and client), Orders received (both views) and the deadline', () => {
    expect(screenNameFor('/clients')).toBe('clients');
    expect(screenNameFor('/clients/list')).toBe('clients-editor');
    expect(screenNameFor('/clients/list/roma')).toBe('clients-editor');
    expect(screenNameFor('/clients/orders')).toBe('clients-orders');
    expect(screenNameFor('/clients/orders/history')).toBe('clients-orders');
    expect(screenNameFor('/clients/ordering')).toBe('clients-ordering');
  });

  it('counts an address the section would redirect as the page, never as a screen nobody saw', () => {
    expect(screenNameFor('/clients/whatsapp')).toBe('clients');
    expect(screenNameFor('/clients/list/new')).toBe('clients');
    expect(clientsScreenName('/zzz')).toBe('clients');
  });

  it('every name is one the usage record accepts', () => {
    for (const rest of ['', '/list', '/orders', '/ordering']) expect(`m2:${clientsScreenName(rest)}`).toMatch(SCREEN_RE);
  });
});
