// order-day.js — WHICH DAY the quantities being typed belong to. PURE: no DOM, no
// Firestore, imports only the day helpers, so every rule is asserted by a unit test.
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

import { addDays, parseISODate, toISODate, weekdayOf } from './day.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A supplier's order days, narrowed to the stored English weekday names. Anything
// else (a stray value) is ignored rather than trusted.
function orderDaysOf(supplier) {
  return (supplier?.orderDays || []).filter(d => WEEKDAYS.includes(d));
}

// True when ISO day `stamp` falls strictly after `today`.
export function isFutureDay(stamp, today) {
  return Boolean(stamp) && Boolean(today) && String(stamp) > String(today);
}

// The first date STRICTLY after `today` whose weekday is one of the supplier's order
// days, as "YYYY-MM-DD" — or null when the supplier has none.
export function nextOrderDay(supplier, today) {
  const days = orderDaysOf(supplier);
  if (!days.length || !today) return null;
  const start = parseISODate(today);
  for (let step = 1; step <= 7; step += 1) {
    const iso = toISODate(addDays(start, step));
    if (days.includes(weekdayOf(iso))) return iso;
  }
  return null;
}

// The first date STRICTLY after `iso` that is one of the supplier's delivery days, or ''
// when it has none. The same rule as expectedDeliveryOn (deliveries.js), kept here so this
// pure file needs no import of another screen's module.
export function nextDeliveryAfter(supplier, iso) {
  const days = (supplier?.deliveryDays || []).filter(d => WEEKDAYS.includes(d));
  if (!days.length || !iso) return '';
  const start = parseISODate(iso);
  for (let step = 1; step <= 7; step += 1) {
    const next = toISODate(addDays(start, step));
    if (days.includes(weekdayOf(next))) return next;
  }
  return '';
}

// Where quantities typed NOW belong, with no stamp to respect yet.
export function targetDayFor({ supplier, today }) {
  const days = orderDaysOf(supplier);
  if (!days.length) return today;
  if (days.includes(weekdayOf(today))) return today;
  return nextOrderDay(supplier, today);
}

// The stamp after a row of this supplier changed: the existing one when it is today or
// later, otherwise the rule above.
export function stampFor({ current, supplier, today }) {
  if (current && String(current) >= String(today)) return current;
  return targetDayFor({ supplier, today });
}

// The future day a supplier's order is going to, to SHOW on its screen before anything is
// typed: the stamp when it is in the future, or — with no stamp, or a stale one — the day
// the next keystroke WOULD be stamped for, when that is in the future. '' means «today».
export function previewDay({ current, supplier, today }) {
  if (isFutureDay(current, today)) return current;
  // A stamp of today is a choice already made («Today»): never second-guessed.
  if (current && String(current) >= String(today)) return '';
  const target = targetDayFor({ supplier, today });
  return isFutureDay(target, today) ? target : '';
}

// The «for the next order» answer on the pending banner: the next order day, but only when
// today is NOT one of the supplier's order days («It's today's» already covers that case,
// and «next order» would jump a whole week). null when it does not apply.
export function nextOrderOffer(supplier, today) {
  if (!today || orderDaysOf(supplier).includes(weekdayOf(today))) return null;
  return nextOrderDay(supplier, today);
}

// The day an order is RECORDED under: the stamp, but never later than today.
export function recordDay(stamp, today) {
  return isFutureDay(stamp, today) ? today : stamp;
}

// The suppliers whose rows are meant for THIS cycle: everything except those stamped
// for a later day. The untold-changes banner asks only about these.
export function notForLater(suppliers, days, today) {
  return (suppliers || []).filter(s => !isFutureDay(days?.[s?.id], today));
}
