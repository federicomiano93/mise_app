// What a change on Orders → Settings writes into config/orders (step 3f-8, parity M3–M8), or why it writes nothing. PURE: the
// store (ordersStore.ts saveSetting) sends the patch; this decides it, so every refusal is asserted in settingsPatch.spec.ts.
//
// The rules of the current app's management.js, one for one:
//   • order lists OFF is refused while lists are the only road an employee has (`listsAreTheOnlyRoad`): they would be left with no
//     way to send an order at all;
//   • the LAST road cannot be closed, judged on the roads staff REALLY have (`effectiveRoutes`: with lists off the manager road
//     does not count), and a preference pointing at a closed road moves to the first open one (`validateRoutes`);
//   • the week start is checked before the network (`isValidWeekStart`): an unknown value would be read back as Sunday;
//   • the days of History are a whole number from 1 to 365 (`Math.floor`, as the current app): an empty box or a 0 would draw an
//     EMPTY History, which reads as «the orders have been deleted». The current app puts the old number back in silence; Mise 2
//     says so (difference S1 in docs/parity/orders.md);
//   • the supplier order is the ids in the order dragged, through `normalizeSupplierOrder` (no duplicates, ≤ 300).
//
// ⚠️ WHO MAY WRITE IS NOT DECIDED HERE: the rules let only an owner or a manager write config/orders (canManage), and the screen
// locks or hides the controls as a courtesy (P2).

import { effectiveRoutes, listsAreTheOnlyRoad, toStored, validateRoutes } from '@mise/shared/send-routes';
import type { Route } from '@mise/shared/send-routes';
import { isValidWeekStart } from '@mise/shared/work-week';
import { normalizeSupplierOrder } from '@mise/shared/supplier-order';
import type { OrdersConfig } from '@mise/shared/orders-config';

export const MIN_HISTORY_DAYS = 1;
export const MAX_HISTORY_DAYS = 365;

export type SettingChange =
  | { readonly kind: 'showStock'; readonly on: boolean }
  | { readonly kind: 'orderLists'; readonly on: boolean }
  | { readonly kind: 'route'; readonly route: Route; readonly on: boolean }
  | { readonly kind: 'weekStart'; readonly day: string }
  // What the box holds, as typed: a number or the box's text.
  | { readonly kind: 'historyDays'; readonly value: unknown }
  | { readonly kind: 'supplierOrder'; readonly ids: readonly string[] };

// Why nothing is written: 'only-road' — lists are the only road staff have; 'last-road' — the last road would close; 'invalid' — a
// week day or a day count outside what may be stored; 'unchanged' — the value is already the stored one.
export type SettingRefusal = 'only-road' | 'last-road' | 'invalid' | 'unchanged';

export type SettingPatch = { readonly patch: Record<string, unknown> } | { readonly refused: SettingRefusal };

// The whole number a History box holds, or null when it is not one from 1 to 365.
export function historyDaysOf(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= MIN_HISTORY_DAYS && n <= MAX_HISTORY_DAYS ? n : null;
}

export function settingPatch(change: SettingChange, config: OrdersConfig): SettingPatch {
  switch (change.kind) {
    case 'showStock':
      return { patch: { showStock: change.on === true } };
    case 'orderLists':
      if (!change.on && listsAreTheOnlyRoad(config.sendSettings)) return { refused: 'only-road' };
      return { patch: { orderLists: change.on === true } };
    case 'route': {
      const routes = { ...config.sendSettings.routes, [change.route]: change.on === true };
      const preferred = config.sendSettings.preferred;
      if (!validateRoutes(effectiveRoutes(routes, config.orderLists), preferred).ok) return { refused: 'last-road' };
      const verdict = validateRoutes(routes, preferred);
      if (!verdict.ok) return { refused: 'last-road' };
      return { patch: toStored(verdict.routes, verdict.preferred) };
    }
    case 'weekStart':
      if (!isValidWeekStart(change.day)) return { refused: 'invalid' };
      if (change.day === config.weekStartsOn) return { refused: 'unchanged' };
      return { patch: { weekStartsOn: change.day } };
    case 'historyDays': {
      const days = historyDaysOf(change.value);
      if (days === null) return { refused: 'invalid' };
      if (days === config.historyDays) return { refused: 'unchanged' };
      return { patch: { historyDays: days } };
    }
    case 'supplierOrder':
      return { patch: { supplierOrder: normalizeSupplierOrder(change.ids) } };
  }
}
