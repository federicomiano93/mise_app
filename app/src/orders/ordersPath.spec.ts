import { describe, expect, it } from 'vitest';
import { CLEAR_PATH, PLACE_ALL_CONFIRM_PATH, PLACE_ALL_PATH, SEND_PATH, ordersScreenName, parseOrdersPath, supplierConfirmPath } from './ordersPath';

describe('parseOrdersPath', () => {
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
