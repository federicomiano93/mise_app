import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '@mise/shared/calculator-config';
import type { Client, Recipe } from '@mise/shared/calculator-config';
import {
  firstInvalid, isEmptyClient, moveClients, newClient, newId, newProduct, patchClient, patchProduct,
  pausedQuantityKeys, sameClients, settleClients,
} from './clientsModel';
import { configOf } from '../testing/renderCalculator';

const config = normalizeConfig(configOf());
const recipes: Recipe[] = config.recipes;
const clients: Client[] = config.clients;

describe('new things', () => {
  it('makes ids like the current app: a prefix and six base-36 characters', () => {
    expect(newId('c', () => 0.5)).toBe('c-i');
    expect(newClient().id).toMatch(/^c-[0-9a-z]{1,6}$/);
    expect(newProduct(recipes).id).toMatch(/^p-[0-9a-z]{1,6}$/);
  });

  it('a new client is empty', () => {
    expect(newClient()).toMatchObject({ name: '', products: [] });
  });

  it('a new product starts on the first recipe at 100 g with no crate box, and is active', () => {
    expect(newProduct(recipes)).toMatchObject({
      name: '', recipeId: 'focaccia', weight: 100, kind: 'number', crate: { show: false, perBox: 20 }, active: true,
    });
    expect(newProduct([]).recipeId).toBe('');
  });
});

describe('isEmptyClient', () => {
  it('is true for no name and no products, false once either exists', () => {
    expect(isEmptyClient({ id: 'a', name: '', products: [] })).toBe(true);
    expect(isEmptyClient({ id: 'a', name: '  ', products: [] })).toBe(true);
    expect(isEmptyClient({ id: 'a', name: 'x', products: [] })).toBe(false);
    expect(isEmptyClient({ id: 'a', name: '', products: [newProduct(recipes)] })).toBe(false);
    expect(isEmptyClient(undefined)).toBe(true);
  });
});

describe('firstInvalid', () => {
  it('is null when every client and product has a name', () => {
    expect(firstInvalid(clients)).toBeNull();
  });

  it('names the first client with a blank name, or a product with a blank name', () => {
    const second = patchClient(clients, 'sole', { name: ' ' });
    expect(firstInvalid(second)).toEqual({ clientId: 'sole' });
    const product = patchProduct(clients, 'roma', 'tray', { name: '' });
    expect(firstInvalid(product)).toEqual({ clientId: 'roma' });
    expect(firstInvalid(patchProduct(second, 'roma', 'tray', { name: '' }))).toEqual({ clientId: 'roma' });
  });
});

describe('settleClients', () => {
  it('clamps weights and pieces per crate, and never leaves a NaN', () => {
    const wild = patchProduct(
      patchProduct(clients, 'roma', 'tray', { weight: 99999, crate: { show: true, perBox: 5000 } }),
      'roma', 'slab', { weight: Number.NaN, crate: { show: true, perBox: Number.NaN } },
    );
    const roma = settleClients(wild, recipes)[0]?.products ?? [];
    expect(roma[0]).toMatchObject({ weight: 5000, crate: { show: true, perBox: 1000 } });
    expect(roma[1]).toMatchObject({ weight: 1, crate: { show: true, perBox: 20 } });
    expect(settleClients(wild, recipes).flatMap(client => client.products).every(product => Number.isFinite(product.weight))).toBe(true);
  });

  it('re-homes a product whose recipe is gone onto the first one, and leaves the others', () => {
    const lost = patchProduct(clients, 'roma', 'roll', { recipeId: 'gone' });
    const roma = settleClients(lost, recipes)[0]?.products ?? [];
    expect(roma[3]?.recipeId).toBe('focaccia');
    expect(roma[0]?.recipeId).toBe('focaccia');
    expect(settleClients(lost, [])[0]?.products[3]?.recipeId).toBe('gone');
  });

  it('changes nothing in a book that is already in range, and is idempotent', () => {
    const once = settleClients(clients, recipes);
    expect(sameClients(once, clients)).toBe(true);
    expect(settleClients(once, recipes)).toEqual(once);
  });
});

describe('pausedQuantityKeys', () => {
  it('spells the key of every paused product with the shared helpers', () => {
    expect(pausedQuantityKeys(clients)).toEqual(['qty-roma::paused']);
    expect(pausedQuantityKeys([])).toEqual([]);
  });
});

describe('moveClients', () => {
  const three: Client[] = ['a', 'b', 'c'].map(id => ({ id, name: id, products: [] }));
  const order = (list: Client[]) => list.map(client => client.id).join('');

  it('moves before and after a target', () => {
    expect(order(moveClients(three, new Set(['c']), 'a', 'before'))).toBe('cab');
    expect(order(moveClients(three, new Set(['a']), 'c', 'after'))).toBe('bca');
    expect(order(moveClients(three, new Set(['a']), 'b', 'after'))).toBe('bac');
  });

  it('moves several together in their own order', () => {
    expect(order(moveClients(three, new Set(['a', 'b']), 'c', 'after'))).toBe('cab');
  });

  it('a target among the moved, or unknown, changes nothing', () => {
    expect(order(moveClients(three, new Set(['a']), 'a', 'before'))).toBe('abc');
    expect(order(moveClients(three, new Set(['a']), 'zz', 'before'))).toBe('abc');
  });
});
