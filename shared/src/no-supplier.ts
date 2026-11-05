// no-supplier.ts — the pseudo-supplier for things bought without one. PURE.
//
// TypeScript ADAPTED port of js/orders/no-supplier.js for Mise 2. Everything is the same, input for input,
// except where the original asks the interface dictionary for the pseudo-supplier's name
// (`t('orders.noSupplier')`): here that word is handed in. `noSupplier(name)` takes it, and so does
// `orderSuppliers(activeSuppliers, resolvedIngredients, name)`, the only other function that reaches it.
// `isNoSupplier` and `resolveSuppliers` are unchanged. `NO_SUPPLIER_ID` is re-exported as in the original.
//
// NOT PORTED: the frozen constant `NO_SUPPLIER`. The original builds it ONCE at import with
// `t('orders.noSupplier')`, in whatever language the page started in — a known compromise its own comment
// admits — and keeps it only «for the id, the shape and the tests». Mise 2 never reads a language at import:
// `noSupplier(name)` builds the same frozen object (id, name, category '', deliveryDays [], orderDays [],
// active true) at the moment it is drawn.
//
// no-supplier.spec.ts runs the original after `setLanguage(...)` and the port with the original's own
// `t('orders.noSupplier')` handed in, and demands the same answer; parity.spec.ts does not pair it (the arity of
// the two adapted functions differs by design).
//
// Plenty of what the bakery buys has no supplier: the supermarket, the cash &
// carry, the shop down the road. Those are ordinary ingredients and must behave
// like ordinary ingredients — same card, same row, same order flow.
//
// But the whole order flow is keyed by supplier: the draft stamps a day per
// supplier, an order is archived as orders-history/{day}_{supplierId}, the
// tick-lists are lists of suppliers. So "no supplier" needs a supplier to belong
// to, and it gets a fake one.
//
// It is NEVER written to the `suppliers` collection — it lives only in the page's
// memory, assembled here on every render. What DOES reach Firestore is the string
// 'no-supplier' as an ingredient's supplierId and as half of a history document id
// ("2026-07-29_no-supplier"). Both were checked against firestore.rules: a
// non-empty supplierId string and the "YYYY-MM-DD_<anything>" id pattern. No rules
// change, no rules deploy.

import { withLineSuppliers } from './line-supplier';

// ⚠️ THE ID ITSELF LIVES IN records.ts since 13 Sep 2026: the ingredient card is shared
// with the Catalogue, which may not import this folder, and a stored id must never exist in
// two spellings.
import { NO_SUPPLIER_ID } from './records';
export { NO_SUPPLIER_ID };

export function isNoSupplier(supplierId?: unknown): boolean {
  return supplierId === NO_SUPPLIER_ID;
}

export interface PseudoSupplier {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly deliveryDays: readonly string[];
  readonly orderDays: readonly string[];
  readonly active: boolean;
}

// The pseudo-supplier with its name in TODAY's language, which the caller reads from its dictionary
// (`orders.noSupplier`) and hands in.
//
// Frozen: it is handed to the same code that handles real suppliers, and a single
// shared object that anything could quietly mutate would be a very confusing bug.
// ⚠️ `name` IS A PLAIN STRING AND THAT IS A KNOWN COMPROMISE. This object is handed
// straight to code that expects a real supplier document, which carries a plain
// `name` string — giving it a key instead would mean teaching every one of those
// places that this one supplier is different, which is worse. So the object is rebuilt
// whenever it is drawn, with the word in the language of the moment.
export function noSupplier(name: string): PseudoSupplier {
  return Object.freeze({
    id: NO_SUPPLIER_ID,
    name,
    category: '',
    deliveryDays: Object.freeze([] as string[]),
    // No order days on purpose: these things are bought when you happen to pass the
    // shop, so they must never appear in the "order these today" reminder. They DO
    // appear in the "left over from an earlier day" one — that is a safety net and
    // has to catch everything.
    orderDays: Object.freeze([] as string[]),
    active: true,
  });
}

// Every ingredient's supplierId resolved against the suppliers that actually
// exist. Anything pointing nowhere — deliberately saved as 'no-supplier', or
// orphaned because its supplier was deleted — comes back filed under the
// pseudo-supplier.
//
// This is the ONE place that decides an ingredient's supplier. Everything
// downstream (which card it sits on, which order it is archived into, which rows
// are cleared afterwards) reads the resolved value, so those three can never
// disagree — which is exactly what would happen if the flat list merely DREW
// orphans under "No supplier" while the order flow still went by the stored id.
//
// `suppliersLoaded` is not optional. Suppliers and ingredients arrive from
// Firestore in separate snapshots, and before the supplier one lands every single
// supplier is "missing": resolving then would flash all 65 ingredients as
// "No supplier" for a frame. Untouched list until the suppliers are really in.
//
// `entries` (the draft) is optional and is the SECOND thing this lens decides: a line the
// draft sends to another supplier («Ordina da un altro fornitore», line-supplier.ts) comes
// back filed under THAT supplier, with `usualSupplierId` naming its own. Without `entries`
// every ingredient stays with its usual supplier — which is what the read-only product
// list wants, because what a supplier sells does not change with one order.
export function resolveSuppliers<T>(
  ingredients?: readonly T[] | null,
  suppliers?: readonly unknown[] | null,
  suppliersLoaded?: unknown,
  entries: unknown = null,
): T[] {
  const list = (ingredients || []) as T[];
  if (!suppliersLoaded) return list;

  const known = new Set((suppliers || []).map(s => (s as { id?: unknown }).id));
  const usual = list.map(ing =>
    known.has((ing as { supplierId?: unknown }).supplierId) ? ing : { ...ing, supplierId: NO_SUPPLIER_ID });
  return withLineSuppliers(usual, entries, suppliers);
}

// The suppliers the order screen works with: the real active ones (already sorted
// by the caller) plus the pseudo-supplier, appended LAST so it reads as the
// leftovers bucket it is rather than sorting itself in among the N's.
//
// It only appears when something is actually filed under it — an empty
// "No supplier" card on every screen would be noise. `noSupplierName` is the word for it
// in the language of the moment.
export function orderSuppliers<T>(
  activeSuppliers: readonly T[] | null | undefined,
  resolvedIngredients: readonly unknown[] | null | undefined,
  noSupplierName: string,
): (T | PseudoSupplier)[] {
  const used = (resolvedIngredients || []).some(
    i => (i as { supplierId?: unknown; active?: unknown }).supplierId === NO_SUPPLIER_ID && (i as { active?: unknown }).active !== false);
  const list: (T | PseudoSupplier)[] = (activeSuppliers || []).slice();
  if (used) list.push(noSupplier(noSupplierName));
  return list;
}
