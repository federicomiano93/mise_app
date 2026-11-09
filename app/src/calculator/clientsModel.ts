import { CRATE_PERBOX_DEFAULT, clampCratePerBox, clampWeight, pairId } from '@mise/shared/calculator-config';
import type { Client, Product, Recipe } from '@mise/shared/calculator-config';
import { qtyKey } from '@mise/shared/calculator-tab-keys';

// What the Clients editor does with the address book, as plain functions (ports of the working copy in
// js/calculator-settings.js): it edits ONE copy of the whole `clients` array, and Save writes that array over
// the latest configuration — no other key of it is touched.

// The default weight of a product just added (the current app's «Add product»).
export const NEW_PRODUCT_WEIGHT = 100;

// A short random id after a prefix: `c-` for a client, `p-` for a product (the current app's `genId`).
export function newId(prefix: 'c' | 'p', random: () => number = Math.random): string {
  return prefix + '-' + random().toString(36).slice(2, 8);
}

export function newClient(random?: () => number): Client {
  return { id: newId('c', random), name: '', products: [] };
}

// A product starts empty with placeholders: no name, the first recipe, 100 g, a number box, no crate box.
export function newProduct(recipes: readonly Recipe[], random?: () => number): Product {
  return {
    id: newId('p', random),
    name: '',
    recipeId: recipes[0]?.id ?? '',
    weight: NEW_PRODUCT_WEIGHT,
    kind: 'number',
    crate: { show: false, perBox: CRATE_PERBOX_DEFAULT },
    active: true,
  };
}

export const isBlank = (text: unknown): boolean => typeof text !== 'string' || text.trim() === '';

// A client just added and left untouched: no name and no products. It is not kept.
export function isEmptyClient(client: Client | undefined): boolean {
  return !client || (isBlank(client.name) && (client.products ?? []).length === 0);
}

// The first client that cannot be saved: a blank name, or a product with a blank name. null when all are complete.
export type Invalid = { readonly clientId: string };

export function firstInvalid(clients: readonly Client[]): Invalid | null {
  for (const client of clients) {
    if (isBlank(client.name) || (client.products ?? []).some(product => isBlank(product.name))) {
      return { clientId: client.id };
    }
  }
  return null;
}

// What is written: every weight clamped (never NaN), every crate box clamped, a product whose recipe is gone
// re-homed onto the first one (the select showed it there). Idempotent. A legacy `kg` product has no crate box
// to clamp, and a product with no `crate` at all is left without one.
export function settleClients(clients: readonly Client[], recipes: readonly Recipe[]): Client[] {
  const known = new Set(recipes.map(recipe => recipe.id));
  const first = recipes[0]?.id;
  return clients.map(client => ({
    ...client,
    products: (client.products ?? []).map(product => {
      const settled: Product = { ...product, weight: clampWeight(product.weight) };
      if (product.kind !== 'kg' && typeof product.crate === 'object' && product.crate !== null) {
        settled.crate = { ...product.crate, perBox: clampCratePerBox(product.crate.perBox) };
      }
      if (first !== undefined && !known.has(product.recipeId)) settled.recipeId = first;
      return settled;
    }),
  }));
}

export function sameClients(a: readonly Client[], b: readonly Client[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The `qty-…` keys of every paused product's typed quantity.
//
// ⚠️ A paused product has no row, so its number would become unreachable by «Reset all fields» and then reappear
// inside a real dough the day the product is switched back on. The key is spelled by the one function both apps
// share, never by hand.
export function pausedQuantityKeys(clients: readonly Client[]): string[] {
  const keys: string[] = [];
  for (const client of clients) {
    for (const product of client.products ?? []) {
      if (product.active === false) keys.push(qtyKey(pairId(client.id, product.id)));
    }
  }
  return keys;
}

export function patchClient(clients: readonly Client[], id: string, patch: Partial<Client>): Client[] {
  return clients.map(client => (client.id === id ? { ...client, ...patch } : client));
}

export function patchProduct(
  clients: readonly Client[], clientId: string, productId: string, patch: Partial<Product>,
): Client[] {
  return clients.map(client => (client.id !== clientId ? client : {
    ...client,
    products: (client.products ?? []).map(product => (product.id === productId ? { ...product, ...patch } : product)),
  }));
}

// Moves the clients named by `moved` to just before or after `target`, keeping their own order. A drop ON the
// target counts as «before» it. A target among the moved ones, or an unknown one, changes nothing.
export function moveClients(
  clients: readonly Client[], moved: ReadonlySet<string>, targetId: string, position: 'before' | 'after' | 'on',
): Client[] {
  if (moved.has(targetId) || !clients.some(client => client.id === targetId)) return [...clients];
  const lifted = clients.filter(client => moved.has(client.id));
  const rest = clients.filter(client => !moved.has(client.id));
  const at = rest.findIndex(client => client.id === targetId);
  const index = position === 'after' ? at + 1 : at;
  return [...rest.slice(0, index), ...lifted, ...rest.slice(index)];
}
