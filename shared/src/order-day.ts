// order-day.ts — WHICH DAY the quantities being typed belong to. PURE: no DOM, no
// Firestore, imports only the day arithmetic, so every rule is asserted by a unit test.
//
// TypeScript port of js/orders/order-day.js for Mise 2. Behaviour is identical, input for input:
// order-day.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values.
//
// The draft (drafts/current) is ONE shared order with a per-supplier day stamp
// (`days`). The stamp used to be «today» on every keystroke. That is wrong the moment
// somebody starts typing NEXT week's quantities after this week's order was placed:
// the next morning they look like an order forgotten yesterday, and on the same day
// they look like an untold addition to the order just recorded.
//
// THE RULE (the owner's decision, 3 Oct 2026 — deliberately needs NO history):
//   * a supplier with no order days → today, as ever;
//   * today IS one of its order days → today;
//   * ANY other day → its NEXT order day, even if this cycle's order was never recorded.
//     The owner accepted that: a forgotten order goes to the next cycle unless he picks
//     «Today» on the supplier's screen.
// A stamp already today or in the future is kept: it is the person's choice, or an
// earlier computation of this same rule.
//
// ⚠️ THE STAMP IS NOT THE RECORD DATE. Placing an order files it under the day it was
// really placed: recordDay() clamps a future stamp to today.

import { addDays, parseISODate, toISODate, weekdayOf } from './day';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type SupplierDays = { orderDays?: unknown; deliveryDays?: unknown } | null | undefined;

// A supplier's order days, narrowed to the stored English weekday names. Anything
// else (a stray value) is ignored rather than trusted.
function orderDaysOf(supplier: unknown): string[] {
  return ((((supplier as SupplierDays)?.orderDays || []) as string[])).filter(d => WEEKDAYS.includes(d));
}

// True when ISO day `stamp` falls strictly after `today`.
export function isFutureDay(stamp?: unknown, today?: unknown): boolean {
  return Boolean(stamp) && Boolean(today) && String(stamp) > String(today);
}

// The first date STRICTLY after `today` whose weekday is one of the supplier's order
// days, as "YYYY-MM-DD" — or null when the supplier has none.
export function nextOrderDay(supplier: unknown, today?: string | null): string | null {
  const days = orderDaysOf(supplier);
  if (!days.length || !today) return null;
  const start = parseISODate(today);
  for (let step = 1; step <= 7; step += 1) {
    const iso = toISODate(addDays(start, step));
    if (days.includes(weekdayOf(iso) as string)) return iso;
  }
  return null;
}

// The first date STRICTLY after `iso` that is one of the supplier's delivery days, or ''
// when it has none. The same rule as expectedDeliveryOn (deliveries), kept here so this
// pure file needs no import of another screen's module.
export function nextDeliveryAfter(supplier: unknown, iso?: string | null): string {
  const days = (((supplier as SupplierDays)?.deliveryDays || []) as string[]).filter(d => WEEKDAYS.includes(d));
  if (!days.length || !iso) return '';
  const start = parseISODate(iso);
  for (let step = 1; step <= 7; step += 1) {
    const next = toISODate(addDays(start, step));
    if (days.includes(weekdayOf(next) as string)) return next;
  }
  return '';
}

// Where quantities typed NOW belong, with no stamp to respect yet.
export function targetDayFor({ supplier, today }: { supplier?: unknown; today: string }): string | null {
  const days = orderDaysOf(supplier);
  if (!days.length) return today;
  if (days.includes(weekdayOf(today) as string)) return today;
  return nextOrderDay(supplier, today);
}

// The stamp after a row of this supplier changed: the existing one when it is today or
// later, otherwise the rule above.
export function stampFor({ current, supplier, today }: { current?: string | null; supplier?: unknown; today: string }): string | null {
  if (current && String(current) >= String(today)) return current;
  return targetDayFor({ supplier, today });
}

// The future day a supplier's order is going to, to SHOW on its screen before anything is
// typed: the stamp when it is in the future, or — with no stamp, or a stale one — the day
// the next keystroke WOULD be stamped for, when that is in the future. '' means «today».
export function previewDay({ current, supplier, today }: { current?: string | null; supplier?: unknown; today: string }): string {
  if (isFutureDay(current, today)) return current as string;
  // A stamp of today is a choice already made («Today»): never second-guessed.
  if (current && String(current) >= String(today)) return '';
  const target = targetDayFor({ supplier, today });
  return isFutureDay(target, today) ? target as string : '';
}

export interface DayOption { value: 'today' | 'past' | 'next' | 'later'; kind: 'today' | 'past' | 'next' | 'later'; day: string }

// What the supplier screen's day select OFFERS and which answer it shows. ⚠️ IT TELLS THE
// TRUTH ABOUT THE STORED STAMP: a select that only knew «Today / Next order» would show
// «Today» over rows stamped for another day, and hide the stamp of a supplier whose order
// days were later edited away.
//   options: [{ value, kind, day }] in date order, deduped by date. `value` is the kind:
//     'past'  — the stored stamp, already gone by, while the supplier still has items;
//     'today';
//     'next'  — the computed next order day (only with order days);
//     'later' — a stored future stamp that is NOT the computed next order day.
//   selected: the stored stamp when it is today or later, or the past one with items;
//     otherwise what the next keystroke would do (previewDay).
//   selectedDay: the date of the selected option, what the expected delivery is counted from.
// The caller shows the line only with two or more options.
export function dayChoices(
  { supplier, stamp, hasItems, today }: { supplier?: unknown; stamp?: string | null; hasItems?: unknown; today: string },
): { options: DayOption[]; selected: DayOption['value']; selectedDay: string } {
  const next = nextOrderDay(supplier, today);
  const options: DayOption[] = [{ value: 'today', kind: 'today', day: today }];
  if (stamp && String(stamp) < String(today) && hasItems) {
    options.push({ value: 'past', kind: 'past', day: stamp });
  }
  if (next) options.push({ value: 'next', kind: 'next', day: next });
  if (isFutureDay(stamp, today) && stamp !== next) {
    options.push({ value: 'later', kind: 'later', day: stamp as string });
  }
  options.sort((x, y) => String(x.day).localeCompare(String(y.day)));

  let selected: DayOption['value'];
  if (stamp && String(stamp) === String(today)) selected = 'today';
  else if (isFutureDay(stamp, today)) selected = stamp === next ? 'next' : 'later';
  else if (stamp && hasItems) selected = 'past';
  else selected = previewDay({ current: stamp, supplier, today }) ? 'next' : 'today';

  const chosen = options.find(o => o.value === selected) || options[0]!;
  return { options, selected: chosen.value, selectedDay: chosen.day };
}

// The «for the next order» answer on the pending banner: the next order day, but only when
// today is NOT one of the supplier's order days («It's today's» already covers that case,
// and «next order» would jump a whole week). null when it does not apply.
export function nextOrderOffer(supplier: unknown, today?: string | null): string | null {
  if (!today || orderDaysOf(supplier).includes(weekdayOf(today) as string)) return null;
  return nextOrderDay(supplier, today);
}

// The day an order is RECORDED under: the stamp, but never later than today.
export function recordDay(stamp?: string | null, today?: string | null): string | null | undefined {
  return isFutureDay(stamp, today) ? today : stamp;
}

// The suppliers whose rows are meant for THIS cycle: everything except those stamped
// for a later day. The untold-changes banner asks only about these.
export function notForLater<T>(suppliers?: readonly T[] | null, days?: unknown, today?: string | null): T[] {
  const stamps = days as Record<string, unknown> | null | undefined;
  return (suppliers || []).filter(s => !isFutureDay(stamps?.[(s as { id?: string } | null | undefined)?.id as string], today));
}
