import { describe, expect, it } from 'vitest';
import {
  CLEAR_PATH, HISTORY_PATH, INCOMING_PATH, INGREDIENTS_PATH, LISTS_PATH, REORDER_PATH, requestPath, PLACE_ALL_CONFIRM_PATH, PLACE_ALL_PATH, SEND_PATH, SETTINGS_PATH, SUPPLIER_ORDER_PATH, historyDayPath, historyEditPath, incomingMissingPath, ordersScreenName, parseOrdersPath, supplierConfirmPath,
} from './ordersPath';

describe('parseOrdersPath', () => {
  it('reads the flat view, and nothing below it', () => {
    expect(parseOrdersPath('/ingredients')).toEqual({ kind: 'ingredients' });
    expect(parseOrdersPath(INGREDIENTS_PATH.slice('/orders'.length))).toEqual({ kind: 'ingredients' });
    expect(parseOrdersPath('/ingredients/x')).toEqual({ kind: 'unknown' });
    expect(ordersScreenName('/ingredients')).toBe('orders-ingredients');
    expect(ordersScreenName('/ingredients/x')).toBe('orders');
  });

  it('reads the placing and clearing screens', () => {
    expect(parseOrdersPath('/supplier/s-alp/confirm')).toEqual({ kind: 'confirm', id: 's-alp' });
    expect(parseOrdersPath('/place-all')).toEqual({ kind: 'place-all' });
    expect(parseOrdersPath('/place-all/confirm')).toEqual({ kind: 'place-all-confirm' });
    expect(parseOrdersPath('/clear')).toEqual({ kind: 'clear' });
    expect(parseOrdersPath('/send')).toEqual({ kind: 'send' });
  });

  it('keeps reading the first three addresses', () => {
    expect(parseOrdersPath('')).toEqual({ kind: 'list' });
    expect(parseOrdersPath('/supplier/a%2Fb')).toEqual({ kind: 'supplier', id: 'a/b' });
    expect(parseOrdersPath('/supplier/s-alp/items')).toEqual({ kind: 'items', id: 's-alp' });
  });

  it('sends anything deeper or unknown back to the list', () => {
    for (const rest of ['/place-all/other', '/place-all/confirm/x', '/clear/x', '/send/x', '/supplier/s/confirm/x', '/supplier/s/other', '/nope']) {
      expect(parseOrdersPath(rest)).toEqual({ kind: 'unknown' });
    }
  });

  it('reads Incoming, the screen for one order below it, and «To re-order»', () => {
    expect(parseOrdersPath('/incoming')).toEqual({ kind: 'incoming' });
    expect(parseOrdersPath('/incoming/2026-10-27_mill')).toEqual({ kind: 'incoming-missing', id: '2026-10-27_mill' });
    expect(parseOrdersPath('/incoming/2026-10-27_a%2Fb')).toEqual({ kind: 'incoming-missing', id: '2026-10-27_a/b' });
    expect(parseOrdersPath(incomingMissingPath('2026-10-27_a b/c%').slice('/orders'.length)))
      .toEqual({ kind: 'incoming-missing', id: '2026-10-27_a b/c%' });
    expect(parseOrdersPath('/reorder')).toEqual({ kind: 'reorder' });
    expect(parseOrdersPath(INCOMING_PATH.slice('/orders'.length))).toEqual({ kind: 'incoming' });
    expect(parseOrdersPath(REORDER_PATH.slice('/orders'.length))).toEqual({ kind: 'reorder' });
  });

  it('reads the order lists and one list, whole through the encoding', () => {
    expect(parseOrdersPath('/lists')).toEqual({ kind: 'lists' });
    expect(parseOrdersPath('/lists/abc')).toEqual({ kind: 'request', id: 'abc' });
    expect(parseOrdersPath('/lists/a%2Fb')).toEqual({ kind: 'request', id: 'a/b' });
    expect(parseOrdersPath(requestPath('a b/c%').slice('/orders'.length))).toEqual({ kind: 'request', id: 'a b/c%' });
    expect(parseOrdersPath(LISTS_PATH.slice('/orders'.length))).toEqual({ kind: 'lists' });
  });

  it('refuses junk after the order lists', () => {
    for (const rest of ['/lists/a/b', '/lists/%E0%A4%A', '/lists//x/y']) {
      expect(parseOrdersPath(rest)).toEqual({ kind: 'unknown' });
    }
  });

  it('names the order list screens for the usage record', () => {
    expect(ordersScreenName('/lists')).toBe('orders-lists');
    expect(ordersScreenName('/lists/abc')).toBe('orders-list');
    expect(ordersScreenName('/lists/a/b')).toBe('orders');
  });

  it('refuses junk after Incoming and «To re-order»', () => {
    for (const rest of ['/incoming/a/b', '/incoming/%E0%A4%A', '/reorder/x', '/incoming//x/y']) {
      expect(parseOrdersPath(rest)).toEqual({ kind: 'unknown' });
    }
  });

  it('builds the addresses it reads', () => {
    expect(parseOrdersPath(supplierConfirmPath('a b').slice('/orders'.length))).toEqual({ kind: 'confirm', id: 'a b' });
    expect(parseOrdersPath(PLACE_ALL_PATH.slice('/orders'.length))).toEqual({ kind: 'place-all' });
    expect(parseOrdersPath(PLACE_ALL_CONFIRM_PATH.slice('/orders'.length))).toEqual({ kind: 'place-all-confirm' });
    expect(parseOrdersPath(CLEAR_PATH.slice('/orders'.length))).toEqual({ kind: 'clear' });
    expect(parseOrdersPath(SEND_PATH.slice('/orders'.length))).toEqual({ kind: 'send' });
  });
});

describe('ordersScreenName', () => {
  it('names each screen the section draws, and nothing it does not', () => {
    expect(ordersScreenName('/supplier/s/confirm')).toBe('orders-confirm');
    expect(ordersScreenName('/place-all')).toBe('orders-place-all');
    expect(ordersScreenName('/place-all/confirm')).toBe('orders-place-all-confirm');
    expect(ordersScreenName('/clear')).toBe('orders-clear');
    expect(ordersScreenName('/send')).toBe('orders-send');
    expect(ordersScreenName('/supplier/s')).toBe('orders-supplier');
    expect(ordersScreenName('/supplier/s/items')).toBe('orders-supplier-items');
    expect(ordersScreenName('/clear/x')).toBe('orders');
    expect(ordersScreenName('')).toBe('orders');
  });
});

describe('the settings and History addresses (slice 3f-4)', () => {
  it('reads each of them', () => {
    expect(parseOrdersPath('/settings')).toEqual({ kind: 'settings' });
    expect(parseOrdersPath('/settings/supplier-order')).toEqual({ kind: 'supplier-order' });
    expect(parseOrdersPath('/history')).toEqual({ kind: 'history' });
    expect(parseOrdersPath('/history/day/2026-10-27')).toEqual({ kind: 'history-day', date: '2026-10-27' });
    expect(parseOrdersPath('/history/2026-10-27_mill')).toEqual({ kind: 'history-edit', id: '2026-10-27_mill' });
    expect(parseOrdersPath('/history/2026-W28')).toEqual({ kind: 'history-edit', id: '2026-W28' });
  });

  it('splits before it decodes, so an id with a slash comes back whole', () => {
    expect(parseOrdersPath('/history/2026-10-27_a%2Fb')).toEqual({ kind: 'history-edit', id: '2026-10-27_a/b' });
    expect(parseOrdersPath(historyEditPath('2026-10-27_a b/c%').slice('/orders'.length)))
      .toEqual({ kind: 'history-edit', id: '2026-10-27_a b/c%' });
  });

  it('does not take «day» for a record id, and sends the rest back to the list', () => {
    for (const rest of [
      '/history/day', '/history/day/', '/history/day/2026-10-27/x', '/history/x/y', '/history/%E0%A4%A', '/settings/x', '/settings/supplier-order/x', '/supplier-order', '/history/day/%E0%A4%A',
    ]) {
      expect(parseOrdersPath(rest)).toEqual({ kind: 'unknown' });
    }
  });

  it('builds the addresses it reads', () => {
    expect(parseOrdersPath(SETTINGS_PATH.slice('/orders'.length))).toEqual({ kind: 'settings' });
    expect(parseOrdersPath(SUPPLIER_ORDER_PATH.slice('/orders'.length))).toEqual({ kind: 'supplier-order' });
    expect(parseOrdersPath(HISTORY_PATH.slice('/orders'.length))).toEqual({ kind: 'history' });
    expect(parseOrdersPath(historyDayPath('2026-10-27').slice('/orders'.length))).toEqual({ kind: 'history-day', date: '2026-10-27' });
  });

  it('names each as a screen', () => {
    expect(ordersScreenName('/settings')).toBe('orders-settings');
    expect(ordersScreenName('/settings/supplier-order')).toBe('orders-settings-supplier-order');
    expect(ordersScreenName('/history')).toBe('orders-history');
    expect(ordersScreenName('/history/day/2026-10-27')).toBe('orders-history-day');
    expect(ordersScreenName('/history/2026-W28')).toBe('orders-history-edit');
    expect(ordersScreenName('/history/day')).toBe('orders');
    expect(ordersScreenName('/incoming')).toBe('orders-incoming');
    expect(ordersScreenName('/incoming/2026-10-27_mill')).toBe('orders-incoming-missing');
    expect(ordersScreenName('/reorder')).toBe('orders-reorder');
    expect(ordersScreenName('/reorder/x')).toBe('orders');
  });
});
