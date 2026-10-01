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

// Where the foot of the History list puts things, decided from plain numbers so the
// placement (and the «a loaded page must be SEEN» rule) can be tested without a DOM.
//   recentCount   — day sections inside the historyDays window
//   olderInMemory — day sections parked behind «Show older orders» (in memory already)
//   showingOlder  — the person has asked to see past the window (kept by history.js)
//   older         — { loading, done, error } of the on-demand paging
// -> { empty, days, parkedFoot, note, load }
//   empty      — null, 'recent' or 'none' (see historyEmptyKind); 'recent' also gets the button
//   days       — 'recent' (only the window) or 'all' (everything in memory)
//   parkedFoot — «Show older orders (N)» is drawn
//   note       — the «No orders in the last N days» line above it
//   load       — «Load older orders» is drawn, after everything that is in memory
export function historyFooter({ recentCount, olderInMemory, showingOlder, older }) {
  const paging = older || { done: true };
  const hasRecords = (recentCount || 0) + (olderInMemory || 0) > 0;
  const empty = historyEmptyKind(hasRecords, paging);
  if (empty) return { empty, days: 'recent', parkedFoot: false, note: false, load: empty === 'recent' };

  const parked = olderInMemory > 0 && !showingOlder;
  return {
    empty: null,
    days: showingOlder ? 'all' : 'recent',
    parkedFoot: parked,
    note: parked && !(recentCount > 0),
    load: !parked && olderFooterState(paging).visible,
  };
}

// The paging of orders older than the live window, with the two Firestore reads INJECTED so
// it can be tested with fakes. `fetchPage({ before, cursor })` -> { records, cursor, done };
// `fetchLegacy()` -> records. `onChange` is called when a load starts and when it ends (the
// caller repaints). Failures never clear what was loaded and never move the cursor, so a
// retry asks for exactly the same page; a legacy failure leaves `done` false and the retry
// fetches only the legacy record.
export function createOlderLoader({ fetchPage, fetchLegacy, before, onChange }) {
  const s = {
    loading: false, done: false, error: false, cursor: null, pagesDone: false, records: [],
  };
  const changed = () => onChange?.();

  async function load() {
    if (s.loading || s.done) return;
    s.loading = true;
    s.error = false;
    changed();
    try {
      if (!s.pagesDone) {
        const page = await fetchPage({ before, cursor: s.cursor });
        s.records = mergeHistory(s.records, page.records);
        s.cursor = page.cursor;
        s.pagesDone = page.done;
      }
      if (s.pagesDone) {
        s.records = mergeHistory(s.records, await fetchLegacy());
        s.done = true;
      }
    } catch (err) {
      console.error('Loading older orders failed:', err);
      s.error = true;
    } finally {
      s.loading = false;
      changed();
    }
  }

  // After an edit or delete of a loaded record: the live listener cannot see it. `next`
  // replaces the record whole (as replaceDoc does); null removes it.
  function patch(id, next) {
    if (!s.records.some(r => r && r.id === id)) return false;
    s.records = next
      ? s.records.map(r => (r && r.id === id ? { ...next, bakery: r.bakery, id } : r))
      : s.records.filter(r => r && r.id !== id);
    changed();
    return true;
  }

  return {
    load,
    patch,
    state: () => ({
      loading: s.loading, done: s.done, error: s.error, cursor: s.cursor, records: s.records,
    }),
  };
}
