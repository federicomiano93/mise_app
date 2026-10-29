// The addresses of «Orders», in one place so the section, the list's rows and the screens one level down cannot disagree
// (docs/parity/orders.md, decision T1). Slice 3f-1 drew the first three; slice 3f-2 adds the placing and clearing screens.
//
//   /orders                         the supplier list
//   /orders/supplier/<id>           one supplier's order screen (`no-supplier` is a valid id: the pseudo-supplier)
//   /orders/supplier/<id>/items     «What they sell», read-only, one level below that screen
//   /orders/supplier/<id>/confirm   «This is what will be recorded» for one supplier, one level below its screen
//   /orders/place-all               the picker of the suppliers to record together, one level below the list
//   /orders/place-all/confirm       the same confirm screen for the ticked suppliers (their ids travel in the navigation state)
//   /orders/clear                   the picker of the suppliers whose quantities to clear, one level below the list
//   /orders/send                    the send screen (slice 3f-3): the suppliers to send to, one level below the list
//   /orders/settings                the Orders settings (slice 3f-4), one level below the list; for now one door, «Past orders»
//   /orders/history                 «Past orders», one level below the settings
//   /orders/history/day/<date>      sending a whole day of recorded orders again, one level below History
//   /orders/history/<recordId>      correcting one recorded order, one level below History (`day` is not a record id)
//   anything else                   unknown: the section goes back to /orders

export const ORDERS_PATH = '/orders';

export type OrdersView =
  | { readonly kind: 'list' }
  | { readonly kind: 'supplier'; readonly id: string }
  | { readonly kind: 'items'; readonly id: string }
  | { readonly kind: 'confirm'; readonly id: string }
  | { readonly kind: 'place-all' }
  | { readonly kind: 'place-all-confirm' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'send' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'history' }
  | { readonly kind: 'history-day'; readonly date: string }
  | { readonly kind: 'history-edit'; readonly id: string }
  | { readonly kind: 'unknown' };

export const supplierPath = (id: string): string => `${ORDERS_PATH}/supplier/${encodeURIComponent(id)}`;
export const supplierItemsPath = (id: string): string => `${supplierPath(id)}/items`;
export const supplierConfirmPath = (id: string): string => `${supplierPath(id)}/confirm`;
export const PLACE_ALL_PATH = `${ORDERS_PATH}/place-all`;
export const PLACE_ALL_CONFIRM_PATH = `${PLACE_ALL_PATH}/confirm`;
export const CLEAR_PATH = `${ORDERS_PATH}/clear`;
export const SEND_PATH = `${ORDERS_PATH}/send`;
export const SETTINGS_PATH = `${ORDERS_PATH}/settings`;
export const HISTORY_PATH = `${ORDERS_PATH}/history`;
export const historyDayPath = (date: string): string => `${HISTORY_PATH}/day/${encodeURIComponent(date)}`;
export const historyEditPath = (id: string): string => `${HISTORY_PATH}/${encodeURIComponent(id)}`;

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
  if (first === 'place-all') {
    if (parts.length === 1) return { kind: 'place-all' };
    return parts.length === 2 && second === 'confirm' ? { kind: 'place-all-confirm' } : { kind: 'unknown' };
  }
  if (first === 'clear') return parts.length === 1 ? { kind: 'clear' } : { kind: 'unknown' };
  if (first === 'send') return parts.length === 1 ? { kind: 'send' } : { kind: 'unknown' };
  if (first === 'settings') return parts.length === 1 ? { kind: 'settings' } : { kind: 'unknown' };
  if (first === 'history') {
    if (parts.length === 1) return { kind: 'history' };
    if (second === undefined) return { kind: 'unknown' };
    // ⚠️ `day` IS NOT A RECORD ID: /orders/history/day alone is nothing, and /orders/history/day/<date> is the day screen.
    if (second === 'day') {
      const date = parts.length === 3 && third !== undefined ? decoded(third) : null;
      return date !== null && date !== '' ? { kind: 'history-day', date } : { kind: 'unknown' };
    }
    const id = decoded(second);
    return parts.length === 2 && id !== null && id !== '' ? { kind: 'history-edit', id } : { kind: 'unknown' };
  }
  if (first !== 'supplier' || second === undefined) return { kind: 'unknown' };
  const id = decoded(second);
  if (id === null || id === '') return { kind: 'unknown' };
  if (parts.length === 2) return { kind: 'supplier', id };
  if (parts.length === 3 && third === 'items') return { kind: 'items', id };
  if (parts.length === 3 && third === 'confirm') return { kind: 'confirm', id };
  return { kind: 'unknown' };
}

// What the usage record calls the screen at an address (shell/sections.ts screenNameFor): `orders`, `orders-supplier`,
// `orders-supplier-items`, `orders-confirm`, `orders-place-all`, `orders-place-all-confirm`, `orders-clear`, `orders-send`, `orders-settings`,
// `orders-history`, `orders-history-day` and `orders-history-edit`.
// ⚠️ ONLY AN ADDRESS THE SECTION DRAWS counts as its screen: an unknown one is sent back to the list, and logging it as a
// screen would put one nobody saw in the owner's statistics.
export function ordersScreenName(rest: string): string {
  const view = parseOrdersPath(rest);
  if (view.kind === 'supplier') return 'orders-supplier';
  if (view.kind === 'items') return 'orders-supplier-items';
  if (view.kind === 'confirm') return 'orders-confirm';
  if (view.kind === 'place-all') return 'orders-place-all';
  if (view.kind === 'place-all-confirm') return 'orders-place-all-confirm';
  if (view.kind === 'clear') return 'orders-clear';
  if (view.kind === 'send') return 'orders-send';
  if (view.kind === 'settings') return 'orders-settings';
  if (view.kind === 'history') return 'orders-history';
  if (view.kind === 'history-day') return 'orders-history-day';
  if (view.kind === 'history-edit') return 'orders-history-edit';
  return 'orders';
}
