// history-window.ts — which part of orders-history is read live, and which is fetched on demand. TypeScript FULL port of
// js/orders/history-window.js for Mise 2 (step 3f-2b, for the live window the suggestions read; the paging and the foot of
// the History list serve slice 3f-4). Pure: no Firestore and no DOM. history-window.spec.ts runs every test against both
// files and parity.spec.ts pairs them.
//
// The Orders screen keeps a live listener on the LAST few calendar months only; anything older is fetched page by page
// when somebody asks for it. Nothing is deleted — older orders simply are not read until wanted.

import { toISODate } from './day';

// shared/ compiles against plain ES2022 (no DOM, no Node types), but the browser and Node both have a console: the one
// call the loader makes is declared here, so the port logs a failed page exactly as the original does.
declare const console: { error(...args: unknown[]): void };

// The one definition of "recent".
//
// ⚠️ TWO, NOT FOUR (Federico, 4 Oct 2026). Every opening of Orders re-reads the whole window from the offline cache, and
// the NUMBER of records is what costs (measured on a weak-tablet profile: four months 3.4 s of CPU, two 2.6 s). Two months
// still holds the last 8 orders a weekly supplier's suggestions average; a monthly supplier falls under MIN_ORDERS — his
// accepted trade-off.
export const HISTORY_LIVE_MONTHS = 2;

// "YYYY-MM-DD" exactly HISTORY_LIVE_MONTHS calendar months before today's LOCAL date, the day clamped to the length of
// that month (31 Jul -> 31 Mar, 30 Jun -> 28 Feb). Local date on purpose: the bakery's day is the day on the wall.
export function liveHistoryStart(now: Date = new Date()): string {
  const first = new Date(now.getFullYear(), now.getMonth() - HISTORY_LIVE_MONTHS, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(now.getDate(), lastDay));
  return toISODate(first);
}

type WithId = { readonly id?: unknown } | null | undefined;

// The union of the live window and the pages loaded on demand, by record id. The LIVE copy wins when both hold the same
// id (it is the one that keeps updating). Never mutates.
export function mergeHistory<T extends WithId>(live?: readonly T[] | null, older?: readonly T[] | null): T[] {
  const seen = new Set<unknown>();
  const out: T[] = [];
  [live, older].forEach(list => {
    (list || []).forEach(record => {
      if (!record || seen.has(record.id)) return;
      seen.add(record.id);
      out.push(record);
    });
  });
  return out;
}

export interface OlderPaging {
  readonly loading?: boolean;
  readonly done?: boolean;
  readonly error?: boolean;
}

// What the foot of the History list shows, derived ONLY from the options passed in.
//   visible  — the «Load older orders» button exists at all
//   disabled — a page is on its way (the label reads «Loading…»)
//   failed   — say the last attempt failed; the same button is the retry
export function olderFooterState(older?: OlderPaging | null): { visible: boolean; disabled: boolean; failed: boolean } {
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
export function historyEmptyKind(hasRecords: boolean, older?: OlderPaging | null): 'recent' | 'none' | null {
  if (hasRecords) return null;
  return older?.done ? 'none' : 'recent';
}

// Where the foot of the History list puts things, decided from plain numbers.
//   recentCount   — day sections inside the historyDays window
//   olderInMemory — day sections parked behind «Show older orders» (in memory already)
//   showingOlder  — the person has asked to see past the window
//   older         — { loading, done, error } of the on-demand paging
export function historyFooter({ recentCount, olderInMemory, showingOlder, older }: {
  recentCount?: number;
  olderInMemory?: number;
  showingOlder?: boolean;
  older?: OlderPaging | null;
}): { empty: 'recent' | 'none' | null; days: 'recent' | 'all'; parkedFoot: boolean; note: boolean; load: boolean } {
  const paging = older || { done: true };
  const hasRecords = (recentCount || 0) + (olderInMemory || 0) > 0;
  const empty = historyEmptyKind(hasRecords, paging);
  if (empty) return { empty, days: 'recent', parkedFoot: false, note: false, load: empty === 'recent' };

  const parked = (olderInMemory as number) > 0 && !showingOlder;
  return {
    empty: null,
    days: showingOlder ? 'all' : 'recent',
    parkedFoot: parked,
    note: parked && !((recentCount as number) > 0),
    load: !parked && olderFooterState(paging).visible,
  };
}

type Page<R, C> = { readonly records: readonly R[]; readonly cursor: C; readonly done: boolean };

// The paging of orders older than the live window, with the two Firestore reads INJECTED so it can be tested with fakes.
// `fetchPage({ before, cursor })` -> { records, cursor, done }; `fetchLegacy()` -> records. `onChange` is called when a
// load starts and when it ends. Failures never clear what was loaded and never move the cursor, so a retry asks for
// exactly the same page; a legacy failure leaves `done` false and the retry fetches only the legacy record.
export function createOlderLoader<R extends { readonly id?: unknown; readonly bakery?: unknown }, C = unknown>({
  fetchPage, fetchLegacy, before, onChange,
}: {
  fetchPage: (args: { before: string; cursor: C | null }) => Promise<Page<R, C>>;
  fetchLegacy: () => Promise<readonly R[]>;
  before: string;
  onChange?: () => void;
}) {
  const s = {
    loading: false, done: false, error: false, cursor: null as C | null, pagesDone: false, records: [] as R[],
  };
  const changed = () => onChange?.();

  async function load(): Promise<void> {
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

  // After an edit or delete of a loaded record: the live listener cannot see it. `next` replaces the record whole; null
  // removes it.
  function patch(id: unknown, next: R | null): boolean {
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
