// supplier-order.js — the order the suppliers are listed in on the Orders main screen.
// PURE: no DOM, no Firestore, so it can be asserted in a test (P15).
//
// The owner or manager drags the suppliers into an order in Orders → Settings, and it
// applies to the whole venue (config/orders.supplierOrder, a list of supplier ids).
// A supplier added AFTER the order was saved is not in the list: it goes below the
// ordered ones, alphabetically, so a new supplier never disappears or lands at random.

const MAX_ENTRIES = 300;
const MAX_ID_LENGTH = 200;

// Anything stored → a list of unique, non-empty ids. Never throws: a corrupt value
// must leave the list as it has always been (alphabetical), not break the screen.
export function normalizeSupplierOrder(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item || item.length > MAX_ID_LENGTH) continue;
    seen.add(item);
    if (seen.size >= MAX_ENTRIES) break;
  }
  return [...seen];
}

// A NEW array: the suppliers named in `order` first, in that order, then every other
// supplier alphabetically by its label. Ids in `order` that match nothing are ignored.
export function sortSuppliersByOrder(suppliers, order, labelOf) {
  const list = Array.isArray(suppliers) ? suppliers : [];
  const position = new Map(normalizeSupplierOrder(order).map((id, i) => [id, i]));
  const ranked = list.filter(s => position.has(s.id))
    .sort((a, b) => position.get(a.id) - position.get(b.id));
  const rest = list.filter(s => !position.has(s.id))
    .sort((a, b) => String(labelOf(a)).localeCompare(String(labelOf(b))));
  return [...ranked, ...rest];
}
