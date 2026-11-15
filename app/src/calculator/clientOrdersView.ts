// clientOrdersView.ts — the pure half of the screens that show the clients' own orders: what needs the owner's
// attention, the words for a day and for «how long ago», the live name of a product, and the inspect step of putting
// an order into the Calculator. A port of the drawing helpers of js/calculator-client-orders.js, with no React in it.

import { getTabProducts, getVisibleRecipes } from '@mise/shared/calculator-config';
import type { Client } from '@mise/shared/calculator-config';
import { isApplied, orderChangedSinceApplied } from '@mise/shared/client-order-model';
import { lockKey, parseLock, qtyKey } from '@mise/shared/calculator-tab-keys';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { numberOf } from './calculatorInput';
import type { ClientOrder } from './clientOrdersStore';

type Say = (key: MessageKey, params?: MessageParams) => string;

// What still needs the owner's attention: an order never used, or one changed since.
//
// ⚠️ AN ORDER ALREADY USED AND UNTOUCHED SINCE IS DONE, and a banner that stays lit after the job is a banner
// people learn to ignore (the lesson of the Home badge, which said «3» all day after all three orders had gone out).
export function needsAttention(order: ClientOrder): boolean {
  return !isApplied(order) || orderChangedSinceApplied(order);
}

// The banner's numbers over the orders still to come: how many need attention, and how many of those CHANGED.
export function bannerCounts(orders: readonly ClientOrder[]): { waiting: number; changed: number } {
  const waiting = orders.filter(needsAttention);
  return { waiting: waiting.length, changed: waiting.filter(orderChangedSinceApplied).length };
}

// The name of a client's product as the address book has it now, or '' for one the client no longer has.
export function liveNameOf(client: Client | null): (id: string) => string {
  return id => {
    const product = (client?.products ?? []).find(known => known && known.id === id);
    return product ? product.name : '';
  };
}

// «Tomorrow · Tuesday 11 August». The weekday is what a baker checks; the date is what settles an argument about
// which one was meant. The date is in the INTERFACE language's locale: it is read by the person reading the screen.
export function dayLabel(say: Say, locale: string, iso: unknown, nowMs: number): string {
  const [y, m, d] = String(iso ?? '').split('-').map(Number);
  if (!y || !m || !d) return String(iso ?? '');
  const date = new Date(y, m - 1, d);
  const today = new Date(nowMs);
  const days = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  const full = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  if (days === 0) return say('calc.co.whenToday', { date: full });
  if (days === 1) return say('calc.co.whenTomorrow', { date: full });
  return full;
}

// When it arrived, in the words a person uses: «20 min ago» answers the question nobody asks an exact timestamp for.
export function arrivedLabel(say: Say, locale: string, order: ClientOrder, nowMs: number): string {
  const at = Date.parse(String(order.updatedAt ?? ''));
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((nowMs - at) / 60000);
  if (minutes < 1) return say('calc.co.justNow');
  if (minutes < 60) return say('calc.co.minAgo', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return say('calc.co.hoursAgo', { n: hours });
  return new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

// «A, B and C»: the grammar of the list is the interface language's (`ui.listPair`).
export function joinList(say: Say, names: readonly string[]): string {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return say('ui.listPair', { a: list.slice(0, -1).join(', '), b: list[list.length - 1] ?? '' });
}

// One row of a patch, as the person is asked about it.
export interface ApplyTarget {
  readonly qtyId: string;
  readonly recipeId: string;
  readonly recipeName: string;
  readonly productName: string;
  // What the tab holds now for this (client, product), and what the order would put there.
  readonly current: number;
  readonly next: number;
  // The tab is confirmed: its boxes are locked until Edit is tapped.
  readonly locked: boolean;
}

// What `patch` would do, row by row (the current app's `inspectQuantities`). A key with no box is simply absent from the
// answer: the product is paused, deleted, or on a recipe that is not a visible tab, and there is nothing to fill in
// either way.
//
// ⚠️ INSPECT AND APPLY ARE SEPARATE ON PURPOSE. The screen has to say what is about to change BEFORE anything does —
// which row already holds a different number, which tab is confirmed and will not move.
export function inspectPatch(
  config: unknown,
  patch: Readonly<Record<string, number>>,
  read: (key: string) => string | null,
): ApplyTarget[] {
  const index = new Map<string, { recipeId: string; recipeName: string; productName: string }>();
  for (const recipe of getVisibleRecipes(config)) {
    for (const row of getTabProducts(config, recipe.id)) {
      index.set(row.qtyId, { recipeId: recipe.id, recipeName: recipe.name, productName: row.name });
    }
  }
  const out: ApplyTarget[] = [];
  for (const [qtyId, next] of Object.entries(patch)) {
    const where = index.get(qtyId);
    if (!where) continue;
    out.push({
      qtyId,
      ...where,
      current: numberOf(read(qtyKey(qtyId))),
      next: Number(next) || 0,
      // Writing a confirmed tab's boxes anyway would put a number on screen that the recipe above it does not account for.
      locked: !!parseLock(read(lockKey(where.recipeId)))?.locked,
    });
  }
  return out;
}
