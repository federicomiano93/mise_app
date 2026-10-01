// history-window.js — which part of orders-history is read live, and which is fetched on
// demand. Pure: no Firestore and no DOM here, so the rules can be tested on their own.
//
// The Orders screen keeps a live listener on the LAST few calendar months only; anything
// older is fetched page by page when somebody asks for it (firebase-orders.js carries the
// cost reasoning). Nothing is deleted — older orders simply are not read until wanted.

import { toISODate } from './day.js';

// The one definition of "recent". Settings text and the empty state quote it.
export const HISTORY_LIVE_MONTHS = 4;

// "YYYY-MM-DD" exactly HISTORY_LIVE_MONTHS calendar months before today's LOCAL date, the
// day clamped to the length of that month (31 Jul -> 31 Mar, 30 Jun -> 28 Feb).
// Local date on purpose: the bakery's day is the day on the wall, not a UTC day (day.js).
export function liveHistoryStart(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth() - HISTORY_LIVE_MONTHS, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(now.getDate(), lastDay));
  return toISODate(first);
}

// The union of the live window and the pages loaded on demand, by record id. The LIVE copy
// wins when both hold the same id (it is the one that keeps updating). Never mutates.
export function mergeHistory(live, older) {
  const seen = new Set();
  const out = [];
  [live, older].forEach(list => {
    (list || []).forEach(record => {
      if (!record || seen.has(record.id)) return;
      seen.add(record.id);
      out.push(record);
    });
  });
  return out;
}

// What the foot of the History list shows, derived ONLY from the options passed in — the
// view is repainted on every snapshot, so no DOM flag may hold this.
//   visible  — the «Load older orders» button exists at all
//   disabled — a page is on its way (the label reads «Loading…»)
//   failed   — say the last attempt failed; the same button is the retry
export function olderFooterState(older) {
  const o = older || {};
  return {
    visible: !o.done,
    disabled: Boolean(o.loading),
    failed: Boolean(o.error) && !o.loading,
  };
}

// The empty state of the History tab, or null when there is something to list.
// 'recent' — nothing in the live window but older orders may exist
// 'none'   — nothing live AND everything older has been looked at
export function historyEmptyKind(hasRecords, older) {
  if (hasRecords) return null;
  return older?.done ? 'none' : 'recent';
}
