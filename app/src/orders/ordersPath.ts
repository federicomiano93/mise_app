// The addresses of «Orders», in one place so the section, the list's rows and the screens one level down cannot disagree
// (docs/parity/orders.md, decision T1). Slice 3f-1 draws these three; the rest of T1's table comes with its own slice.
//
//   /orders                         the supplier list
//   /orders/supplier/<id>           one supplier's order screen (`no-supplier` is a valid id: the pseudo-supplier)
//   /orders/supplier/<id>/items     «What they sell», read-only, one level below that screen
//   anything else                   unknown: the section goes back to /orders

export const ORDERS_PATH = '/orders';

export type OrdersView =
  | { readonly kind: 'list' }
  | { readonly kind: 'supplier'; readonly id: string }
  | { readonly kind: 'items'; readonly id: string }
  | { readonly kind: 'unknown' };

export const supplierPath = (id: string): string => `${ORDERS_PATH}/supplier/${encodeURIComponent(id)}`;
export const supplierItemsPath = (id: string): string => `${supplierPath(id)}/items`;

// A segment as it was typed, back to the id it stands for; null when it is not valid percent-encoding.
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// `rest` is what follows /orders in the address AS IT IS WRITTEN: each segment is split first and decoded after, so an id
// with a slash, a percent sign or a space in it comes back whole.
export function parseOrdersPath(rest: string | undefined): OrdersView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  if (parts.length === 0) return { kind: 'list' };
  const [first, second, third] = parts;
  if (first !== 'supplier' || second === undefined) return { kind: 'unknown' };
  const id = decoded(second);
  if (id === null || id === '') return { kind: 'unknown' };
  if (parts.length === 2) return { kind: 'supplier', id };
  if (parts.length === 3 && third === 'items') return { kind: 'items', id };
  return { kind: 'unknown' };
}

// What the usage record calls the screen at an address (shell/sections.ts screenNameFor): `orders`, `orders-supplier`
// and `orders-supplier-items`. ⚠️ ONLY AN ADDRESS THE SECTION DRAWS counts as its screen: an unknown one is sent back to
// the list, and logging it as a screen would put one nobody saw in the owner's statistics.
export function ordersScreenName(rest: string): string {
  const view = parseOrdersPath(rest);
  if (view.kind === 'supplier') return 'orders-supplier';
  if (view.kind === 'items') return 'orders-supplier-items';
  return 'orders';
}
