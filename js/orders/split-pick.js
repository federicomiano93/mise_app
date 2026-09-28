// split-pick.js — PURE: when a supplier's order/delivery day next falls,
// for the tablet split view's row chip and pane subline.
//
// ⚠️ ONE FUNCTION, TWO CALLERS. The row chip ("TODAY" / next order weekday)
// and the pane's own subline (order day + delivery day) both ask the exact
// same question — "given this list of weekdays, is one of them today, and if
// not, which is next?" — so they share one answer rather than two separate
// implementations that could quietly disagree about what "next" means.
//
// PURE and DOM-free (P15): no import of t() here — the caller translates the
// weekday index this returns, the same split js/orders/day.js already uses
// between DATA (English weekday names, compared against orderDays/
// deliveryDays) and PRESENTATION (the dictionary).

// ⚠️ DATA, NOT WORDS — copied from js/orders/day.js's own private list rather
// than imported, because that one is not exported (by design: it is the
// vocabulary stored on every supplier document, and js/i18n.js's DATA_WORDS
// already pins it English). Duplicated on purpose, same as day.js itself
// says about its own copy.
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// days: a supplier's orderDays or deliveryDays ([] or undefined = none at all).
// -> { isToday, weekdayIndex } — weekdayIndex is TODAY's (0-6) when isToday,
//    otherwise the next matching weekday's, counting forward up to 7 days.
// -> null when `days` names no weekday at all (nothing to report).
export function nextMatchingDay(days, now = new Date()) {
  const list = days || [];
  if (!list.length) return null;

  const todayIndex = now.getDay();
  if (list.includes(WEEKDAY_LONG[todayIndex])) return { isToday: true, weekdayIndex: todayIndex };

  for (let i = 1; i <= 7; i++) {
    const index = (todayIndex + i) % 7;
    if (list.includes(WEEKDAY_LONG[index])) return { isToday: false, weekdayIndex: index };
  }
  // Every entry in `list` failed to match a real weekday name (corrupt data);
  // never reached in practice, but a defensive null beats throwing.
  return null;
}
