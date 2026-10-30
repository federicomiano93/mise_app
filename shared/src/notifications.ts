// notifications.ts — which order alerts exist today. The pure decision layer of js/orders/notifications.js, for Mise 2
// (step 3f-6, Reminders).
//
// TypeScript ADAPTED, PARTIAL port. PORTED: `computeAlerts` and `isReminderDue`, with the same rules and the same ORDER of alerts
// (the order alert, then the holiday notice, then one delivery clash per holiday and supplier). NOT PORTED: the renderers
// (`renderAlerts`, `renderNotificationSettings`, the banner and pill markup) and `maybeNotify` (the browser Notification) — they
// are screen code and become Mise 2 components. notifications.spec.ts runs the assertions about WHICH alerts appear against BOTH
// files; parity.spec.ts does NOT pair it.
//
// ⚠️⚠️ THE DIFFERENCE ON PURPOSE (finding F-6): THIS RETURNS DATA, NOT WORDS. The original pours the English word «tomorrow», English
// weekday names and raw ISO dates ("2026-12-25") into the Italian sentences it builds, and calls the dictionary from inside a pure
// function. Here an alert is `{ kind, key, … }` plus the facts a sentence needs — the supplier, the ISO day, how many days away,
// the next delivery — and the screen spells them with the app's dictionary and the venue's language. There is no `t()` here and no
// string meant for a person. (The stored weekday names stay English: they are DATA, compared with the suppliers' `orderDays` and
// `deliveryDays`, never shown.)
//
// ⚠️⚠️ THE CALENDAR IS THE VENUE'S COUNTRY'S, AND IT IS PASSED IN. `country` travels with every call so this file stays pure and a
// caller which forgets it gets silence instead of the wrong country. `country` defaults to null, which means «no calendar at
// all»: the Home badge reads only the `order` alert, which is about weekdays and knows nothing about holidays. The UK list is an
// argument too (`ukDates`, the built-in one by default): the data layer downloads and caches it.
//
// Order timing is a fixed weekday model (per Federico): each supplier has its own order days (the days he places the order) and
// delivery days. No "days-before" math.

import { isHoliday, UK_FALLBACK } from './holidays';
import { toISODate, weekdayOf } from './day';

// How far ahead the holiday notice looks (from tomorrow): up to a week, so orders can be planned.
export const HOLIDAY_WINDOW_DAYS = 7;
// How far ahead a holiday is checked against the suppliers' delivery days (from tomorrow).
export const CONFLICT_WINDOW_DAYS = 14;

// How far ahead a supplier's NEXT delivery is looked for. Private, as in the original (a literal there).
const NEXT_DELIVERY_DAYS = 7;

// The fields of a supplier these rules read. A stored document is whatever was written, so everything is optional.
export interface AlertSupplier {
  readonly id?: string;
  readonly active?: boolean;
  readonly orderDays?: readonly unknown[] | null;
  readonly deliveryDays?: readonly unknown[] | null;
}

// One supplier to order today, and when it next delivers: `inDays` 1 is tomorrow, `null` when it declares no delivery day within
// the next seven days.
export type OrderAlertLine<S> = { supplier: S; nextDelivery: { iso: string; inDays: number } | null };

export type CalendarAlert<S> =
  | { kind: 'order'; key: string; lines: OrderAlertLine<S>[] }
  | { kind: 'holiday'; key: string; iso: string; inDays: number }
  | { kind: 'conflict'; key: string; supplier: S; iso: string };

// The ISO day `i` days after `from`, read in local time.
function dayAfter(from: Date, i: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() + i);
  return toISODate(d);
}

// Public-holiday ISO dates within the next `days` days (from tomorrow).
function upcomingHolidays(from: Date, days: number, country: unknown, ukDates: readonly string[]): string[] {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const result: string[] = [];
  for (let i = 1; i <= days; i++) {
    const iso = dayAfter(start, i);
    if (isHoliday(iso, country, ukDates)) result.push(iso);
  }
  return result;
}

// The first public holiday within the next `days` days (from tomorrow), as { iso, inDays }, or null. Gives an exact «in N days»
// countdown for the notice.
function nextHolidayWithin(from: Date, days: number, country: unknown, ukDates: readonly string[]): { iso: string; inDays: number } | null {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  for (let i = 1; i <= days; i++) {
    const iso = dayAfter(start, i);
    if (isHoliday(iso, country, ukDates)) return { iso, inDays: i };
  }
  return null;
}

// The supplier's NEXT delivery relative to `now`: the first of the next seven days (from tomorrow) that is one of its delivery
// days. Only the next delivery is returned — never the full list of delivery weekdays.
function nextDeliveryOf(supplier: AlertSupplier, now: Date): { iso: string; inDays: number } | null {
  const days = supplier.deliveryDays || [];
  if (!days.length) return null;
  for (let i = 1; i <= NEXT_DELIVERY_DAYS; i++) {
    const iso = dayAfter(now, i);
    if (days.includes(weekdayOf(iso))) return { iso, inDays: i };
  }
  return null;
}

export function computeAlerts<S extends AlertSupplier>(
  suppliers: readonly S[] | null | undefined,
  now: Date = new Date(),
  country: string | null = null,
  ukDates: readonly string[] = UK_FALLBACK,
): CalendarAlert<S>[] {
  const alerts: CalendarAlert<S>[] = [];
  const active = (suppliers || []).filter(s => s.active !== false);
  const todayWd = weekdayOf(toISODate(now));

  // 1. Place the order — every supplier whose ORDER day is today, in ONE grouped alert (the primary reminder). Each line says when
  //    the supplier delivers next.
  const toOrder = active.filter(s => (s.orderDays || []).includes(todayWd));
  if (toOrder.length) {
    alerts.push({
      kind: 'order',
      key: `order-${toISODate(now)}`,
      lines: toOrder.map(supplier => ({ supplier, nextDelivery: nextDeliveryOf(supplier, now) })),
    });
  }

  // 2. Public holiday ahead — warn up to 7 days before so orders can be planned.
  //
  // ⚠️ THE ALERT NAMES NO COUNTRY (Federico's decision, 24 Aug 2026): the calendar decides WHICH days appear, the sentence the
  // screen builds just says a day is coming — a person reading their own venue's screen already knows which country they are in.
  const holiday = nextHolidayWithin(now, HOLIDAY_WINDOW_DAYS, country, ukDates);
  if (holiday) alerts.push({ kind: 'holiday', key: `bh-${holiday.iso}`, iso: holiday.iso, inDays: holiday.inDays });

  // 3. Delivery conflict — an upcoming holiday lands on a supplier's delivery day.
  upcomingHolidays(now, CONFLICT_WINDOW_DAYS, country, ukDates).forEach(iso => {
    // ⚠️ `wd` is the STORED value compared against the supplier's deliveryDays and must stay English — translating it would make
    // a Monday supplier never match a Monday. What reaches the screen is spelled from `iso` by the app.
    const wd = weekdayOf(iso);
    active.forEach(supplier => {
      if ((supplier.deliveryDays || []).includes(wd)) {
        alerts.push({ kind: 'conflict', key: `conf-${supplier.id}-${iso}`, supplier, iso });
      }
    });
  });

  return alerts;
}

// True when the daily «place the order» reminder has not yet been shown today. `lastShownIso` is the last date it was shown on this
// device ('YYYY-MM-DD') or null/undefined if never. Pure and date-based so it is unit-testable.
export function isReminderDue(lastShownIso: string | null | undefined, now: Date = new Date()): boolean {
  return lastShownIso !== toISODate(now);
}
