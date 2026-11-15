// calculator-order-prefill.ts — PURE: fill a WhatsApp order from what was already calculated and logged, so the
// same quantities are not typed twice.
//
// TypeScript PARTIAL (adapted) port of js/calculator-order-prefill.js for Mise 2. `PREFILL_WORK_DAYS` and
// `prefillFromLogs` are the same, byte for byte in behaviour; `prefillNote(filledCount, window, t)` takes the
// translate function as an argument, because the original calls the interface dictionary, which in Mise 2
// belongs to the app. calculator-order-prefill.spec.ts runs the pure tests against BOTH files and the note
// against the port only; parity.spec.ts does not pair it (the note's arity differs by design).
//
// No DOM, no Firebase, no storage, so it can be unit-tested (P15 — the owner cannot read code, and these
// numbers end up in a message sent to a client).
//
// ⚠️ This deliberately bends P20 ("never auto-fill real-looking values"). It is acceptable ONLY because the
// order form shows the numbers before anything is sent, every one of them can be corrected — and the screen
// says where they came from. That sentence (prefillNote) is not decoration: it is the condition that makes the
// exception honest. If it ever disappears, this should go with it.

import { workDayIndex } from './log-model';
import type { LogVersion } from './log-model';
import type { OrderEntry } from './calculator-order-text';

// A row's identity: the client it belongs to plus the product. The same product ordered by two clients is two
// independent numbers.
const rowKey = (clientName: unknown, productId: unknown): string => String(clientName || '') + '|' + String(productId || '');

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── How far back the offer may reach ─────────────────────────────────────────
// TWO WORK DAYS: today and yesterday. Not a preference — it is how the bakery works. Some products are made
// the day BEFORE the order goes out and some the same morning, so today's order is assembled from both days'
// work and neither alone is the answer.
//
// ⚠️ WORK days, so the boundary is 4am and not midnight (workDayIndex). Someone shaping at 00:30 is still on
// last night's shift, and a midnight cut would drop their own log out of the window they are standing in.
//
// ⚠️ THIS IS ALSO THE FIX FOR AN OLDER HOLE: there used to be NO limit at all. The logs are never deleted — the
// "keep visible for N hours" setting only hides them from the Log screen — so the offer could reach back weeks
// and present a three-week-old quantity as "from your saved logs", with nothing saying how old it was. A
// plausible stale number is the worst kind: nothing on screen looks wrong.
export const PREFILL_WORK_DAYS = 2;

// Which work days each window accepts, as offsets back from today. Written as a table rather than as
// comparisons so the three options cannot drift apart, and so 'yesterday' is visibly [1] — yesterday ONLY, not
// "yesterday onwards".
const WINDOW_OFFSETS: Record<string, number[]> = {
  both: [0, 1],
  today: [0],
  yesterday: [1],
};

// The quantity to offer for each (client, product), taken from the most recent log IN THE WINDOW that recorded
// one. `logs` must arrive NEWEST FIRST (`sortLogs` of log-model sorts that way) and `latestOf` returns a log's
// current version.
//
// `nowMs` is the clock and `window` the chosen setting, both passed in so this stays pure and testable.
//
// ⚠️ THE NEWEST LOG THAT MENTIONS A ROW DECIDES IT — **ZERO INCLUDED**. A dough log lists EVERY product of its
// recipe, for every client, including the ones at zero — so a zero in the newest log is that log saying "none
// of these today", which is exactly an answer. The code once skipped a zero and kept searching backwards, and
// the form offered yesterday's 10 for a row today's log plainly showed as 0 — in a message about to be sent to
// that client. So a row is decided ONCE, by the first log that names it; only decisions above zero are
// offered, because a zero needs no filling in.
//
// ⚠️ AN UNREADABLE CLOCK OFFERS NOTHING, deliberately. Falling back to "no window" would silently restore the
// unbounded behaviour above — the failure would look exactly like the feature working. Offering nothing means
// the quantities get typed, which is merely the old way of doing it.
export function prefillFromLogs(
  entries: readonly (OrderEntry | null | undefined)[] | unknown,
  logs: readonly unknown[] | unknown,
  latestOf: ((log: unknown) => LogVersion | null) | null | undefined,
  { nowMs, window }: { nowMs?: unknown; window?: unknown } = {},
): Record<string, number> {
  const clock = Number(nowMs);
  if (!Number.isFinite(clock) || clock <= 0) return {};
  // An unknown window widens to 'both' rather than narrowing: a corrupt setting must not quietly hide a day's
  // work from the order.
  const offsets = (typeof window === 'string' && Object.hasOwn(WINDOW_OFFSETS, window) ? WINDOW_OFFSETS[window] : undefined)
    ?? WINDOW_OFFSETS['both'] as number[];
  const today = workDayIndex(clock);
  const allowed = new Set(offsets.map(o => today - o));

  // What each row was last recorded as. `logs` arrives newest first, so the FIRST log to name a row is the one
  // that decides it — and it decides it even when the answer is zero, which is what stops an older number
  // outliving today's.
  const decided = new Map<string, number>();

  for (const log of (Array.isArray(logs) ? logs as unknown[] : [])) {
    if (!log || typeof latestOf !== 'function') continue;
    // A log with no usable timestamp lands far in the past and is skipped: there is no honest way to say
    // whether it belongs to this order.
    if (!allowed.has(workDayIndex(num((log as { createdAtMs?: unknown }).createdAtMs)))) continue;
    const version = latestOf(log);
    for (const item of ((version && version.items) || [])) {
      if (!item) continue;
      const key = rowKey(item.clientName, item.id);
      if (!decided.has(key)) decided.set(key, num(item.qty));
    }
  }

  // Only answer for the rows the form is actually showing, and only where there is something to fill in — a
  // row decided as zero is already zero on screen, and counting it would inflate the "N quantities filled in"
  // note with nothing.
  const out: Record<string, number> = {};
  (Array.isArray(entries) ? entries as (OrderEntry | null | undefined)[] : []).forEach((entry, entryIndex) => {
    if (!entry || !entry.client) return;
    for (const product of (entry.products || [])) {
      if (!product) continue;
      const qty = decided.get(rowKey(entry.client.name, product.id));
      if (qty !== undefined && qty > 0) out[entryIndex + '|' + String(product.id)] = qty;
    }
  });
  return out;
}

// The three words for the window, as KEYS: the original keeps them in a module constant, and a t() there would
// freeze the language the page loaded in — the lookup happens inside prefillNote().
const WINDOW_KEYS = {
  both: 'calc.prefill.window.both',
  today: 'calc.prefill.window.today',
  yesterday: 'calc.prefill.window.yesterday',
} as const;

export type PrefillKey =
  | (typeof WINDOW_KEYS)[keyof typeof WINDOW_KEYS]
  | 'calc.prefill.nothingLogged'
  | 'calc.prefill.filled';

// The translate function prefillNote needs: Mise 2's `t` (whose keys are a wider union) fits.
export type PrefillTranslate = (key: PrefillKey, params?: Readonly<Record<string, string | number>>) => string;

// The sentence shown above the form. Names where the numbers came from, or says plainly that nothing was found
// — never silent either way.
//
// ⚠️ IT NAMES THE WINDOW THAT WAS ACTUALLY USED, not just "your saved logs". The old wording was true and
// useless: it did not say how old the numbers were, which is the one thing somebody checking them before
// sending needs to know. And since the window is a SETTING, the sentence has to follow it — a fixed sentence
// would start lying the moment the setting was changed, which is worse than saying nothing.
export function prefillNote(filledCount: number, window: unknown, t: PrefillTranslate): string {
  const key = typeof window === 'string' && Object.hasOwn(WINDOW_KEYS, window)
    ? WINDOW_KEYS[window as keyof typeof WINDOW_KEYS]
    : WINDOW_KEYS.both;
  const when = t(key);
  if (!filledCount) return t('calc.prefill.nothingLogged', { when });
  return t('calc.prefill.filled', { n: filledCount, when });
}
