import { resolveDirectClient, resolveListClients } from '@mise/shared/calculator-config';
import type { ResolvedProduct, WhatsappClient, WhatsappList } from '@mise/shared/calculator-config';
import { numberOf } from './calculatorInput';

// What the order form is made of, as plain functions so every rule is a spec without a screen.

// One section of the form: a client (its name is the heading) and the rows it shows — the products it orders and
// its free lines, in the order the list holds them.
export type OrderEntry = {
  client: { name: string };
  products: ResolvedProduct[];
};

// A saved list, read live from the address book: one entry per client still there. An EMPTY result means every
// client of the list has since been deleted (the screen says so instead of opening an empty form).
export function listEntries(config: unknown, list: WhatsappList): OrderEntry[] {
  return resolveListClients(config, list).map(entry => ({ client: { name: entry.client.name }, products: entry.products }));
}

// A direct client: ONE entry, named as typed. `null` only for a value that is not a client at all.
export function directEntries(config: unknown, direct: WhatsappClient): OrderEntry[] {
  const resolved = resolveDirectClient(config, direct);
  return resolved ? [{ client: { name: resolved.name }, products: resolved.products }] : [];
}

// A box's key: the client entry's index and the product's id. ⚠️ BOTH, because a list may attach the SAME product
// to two client entries — the same product ordered by two clients is two independent numbers. (The current app
// namespaces the DOM ids the same way, `wa-<entry>-<product>`; here the key is state, the id is only a label's
// target.)
export function quantityKey(entryIndex: number, productId: unknown): string {
  return `${entryIndex}|${String(productId)}`;
}

// What every box says when the form opens: the prefilled number where there is one, else 0. Free lines are never
// in the prefill (they never match a log row), so they start at 0.
export function startingQuantities(entries: readonly OrderEntry[], prefilled: Readonly<Record<string, number>>): Record<string, string> {
  const out: Record<string, string> = {};
  entries.forEach((entry, entryIndex) => {
    for (const product of entry.products) {
      const key = quantityKey(entryIndex, product.id);
      out[key] = String(prefilled[key] ?? 0);
    }
  });
  return out;
}

// The same boxes all at 0 (Clear all).
export function zeroQuantities(start: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(start).map(key => [key, '0']));
}

// Whether a quantity was changed by hand: any box that says a different NUMBER than the form opened with. Compared as
// numbers, so tapping a 0 (the box empties) and leaving it (the 0 comes back) is not a change, and typing a number
// and typing it away again is not one either. Clear all counts when it cleared something.
export function changedByHand(start: Readonly<Record<string, string>>, now: Readonly<Record<string, string>>): boolean {
  return Object.keys(now).some(key => numberOf(now[key]) !== numberOf(start[key]));
}
