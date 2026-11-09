// order-day-choices.ts — the seven days a supplier with NO order days can be ordered for. PURE: no DOM, no
// Firestore, imports only the day arithmetic.
//
// NEW in Mise 2: the current app has no original of this (Federico's decision F2). A supplier that names its
// order days gets its own choices (order-day.ts dayChoices); a supplier with none used to be «today» only, so
// next week's order could not be started early. Its day line now offers a week: today and the six days after.
// parity.spec.ts does not pair it for that reason.
//
// All the arithmetic is addDays / parseISODate / toISODate of day.ts, so it is local-calendar and DST-safe: a
// week that crosses the clocks changing still has seven consecutive dates.

import { addDays, parseISODate, toISODate } from './day';

export interface WeekOption {
  // Always the option's ISO day, 'YYYY-MM-DD'.
  readonly value: string;
  // past: a stored stamp before today that still has items; later: a stored stamp beyond the week.
  readonly kind: 'past' | 'today' | 'tomorrow' | 'weekday' | 'later';
  readonly day: string;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Does this supplier name at least one order day? The same reading as order-day.ts's private orderDaysOf: the
// stored English weekday words count, anything else is ignored. Repeated here (a small read) because order-day.ts
// is a paired full port and must not grow an export.
export function hasOrderDays(supplier: unknown): boolean {
  const days = (supplier as { orderDays?: unknown } | null | undefined)?.orderDays;
  return Array.isArray(days) && days.some(d => WEEKDAYS.includes(d as string));
}

// A real calendar day written 'YYYY-MM-DD'. «2026-02-30» is not one: it would roll over into March.
function validDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && toISODate(parseISODate(value)) === value;
}

// The choices for the day line, in date order, and the one selected.
//   * stamp: the day already stored for this supplier (days.<supplierId>), if any;
//   * hasItems: whether the supplier has quantities typed — a stamp in the past only matters then;
//   * today: 'YYYY-MM-DD', handed in (a pure function never reads the clock).
// A stamp that is not a valid day is treated as absent. A stamp inside the seven days is simply that day's
// option; one beyond them adds a `later` option at the end; a past one adds a `past` option at the front only
// while there is something typed under it — an old stamp over nothing describes nothing.
export function weekChoices(
  { stamp, hasItems, today }: { stamp?: string | null; hasItems?: unknown; today: string },
): { options: WeekOption[]; selected: string; selectedDay: string } {
  const start = parseISODate(today);
  const week = Array.from({ length: 7 }, (_, i) => toISODate(addDays(start, i)));
  const last = week[6] as string;
  const stored = validDay(stamp) ? stamp : '';

  const options: WeekOption[] = [];
  const past = Boolean(stored) && stored < today && Boolean(hasItems);
  if (past) options.push({ value: stored, kind: 'past', day: stored });
  week.forEach((day, i) => {
    const kind = i === 0 ? 'today' : i === 1 ? 'tomorrow' : 'weekday';
    options.push({ value: day, kind, day });
  });
  if (stored && stored > last) options.push({ value: stored, kind: 'later', day: stored });

  const selected = stored && stored >= today ? stored : past ? stored : today;
  return { options, selected, selectedDay: selected };
}
