// calculator-tab-keys.ts — the local-storage keys one Calculator tab keeps its state under, and the two small
// decisions made about them (is a tab stale? what does a stored lock say?). PURE: no DOM, no storage — the
// caller reads and writes the keys.
//
// NEW IN MISE 2, NOT A PORT: in the current app these keys are string literals scattered through js/app.js
// and js/calc.js (`'qty-' + id`, `'param-' + recipeId`, …) and the decisions are inline in `expireStaleTabs`
// and `restoreLock`. They are gathered here so the keys are spelled once, and pinned by
// calculator-tab-keys.spec.ts against the spelling the current app uses.
//
// ⚠️ THE KEYS ARE SHARED WITH THE CURRENT APP (same origin, same localStorage): both apps read each other's
// copy, so the spelling and the shape of the values must match exactly. None of them is in `KEEP_PREFIXES`
// (local-data.ts), so a venue switch wipes them all — a refused or never-answered load must never leave one
// venue's quantities on screen in another.
//
//   qty-<clientId>::<productId>   the typed quantity, as the box shows it (`<qtyId>` = pairId())
//   param-<rid>                   the leavening %
//   total-<rid>                   the typed total, g
//   trays-<rid>                   the number of trays
//   extra-<rid>                   the extra dough amount
//   extra-unit-<rid>              'g' | 'kg'
//   touched-<rid>                 Date.now() as text — the last time the tab persisted something
//   revealed-<rid>                '1' once the result card is shown
//   lock-<rid>                    {"locked":bool,"logId":string|null}
//
// ⚠️ `touched-` IS WRITTEN IN EXACTLY THE PLACES THE TAB PERSISTS SOMETHING. Written anywhere else, a used tab
// is wiped as if untouched; written nowhere, a stale tab survives.

import { workDayIndex } from './log-model';

export const qtyKey = (qtyId: unknown): string => 'qty-' + String(qtyId);
export const paramKey = (rid: unknown): string => 'param-' + String(rid);
export const totalKey = (rid: unknown): string => 'total-' + String(rid);
export const traysKey = (rid: unknown): string => 'trays-' + String(rid);
export const extraKey = (rid: unknown): string => 'extra-' + String(rid);
export const extraUnitKey = (rid: unknown): string => 'extra-unit-' + String(rid);
export const touchedKey = (rid: unknown): string => 'touched-' + String(rid);
export const revealedKey = (rid: unknown): string => 'revealed-' + String(rid);
export const lockKey = (rid: unknown): string => 'lock-' + String(rid);

// Every key to REMOVE to forget a tab: its revealed flag, its lock, every quantity, and param, total, trays,
// extra, extra-unit and touched. This is the ONE list "Reset all fields" and the new-work-day sweep both go
// through, so they can never drift apart when a field is added.
//
// ⚠️ THE LOCK MUST GO WITH THE NUMBERS. After a Confirm the tab stays linked to that log, and the next
// Confirm UPDATES it instead of making a new one: clearing the numbers without the link would make
// tomorrow's first Confirm rewrite yesterday's log with today's dough.
//
// `qtyIds` are the tab's current `qtyId`s (getTabProducts(config, rid).map(p => p.qtyId)).
export function tabKeysToForget(rid: unknown, qtyIds: readonly unknown[]): string[] {
  return [
    revealedKey(rid),
    lockKey(rid),
    ...qtyIds.map(qtyKey),
    paramKey(rid),
    totalKey(rid),
    traysKey(rid),
    extraKey(rid),
    extraUnitKey(rid),
    touchedKey(rid),
  ];
}

// Whether a tab was last used on an EARLIER work day and so must be cleared. `stamp` is what the `touched-`
// key held (text, or null when absent); a missing, zero, negative or non-numeric stamp is never stale (the
// tab was not used, there is nothing to clear). The day rolls over at 4am (workDayIndex), so a dough
// calculated at 23:30 and revisited at 00:30 is still the same night's work.
export function isStaleTab(stamp: unknown, nowMs: unknown): boolean {
  const ms = Number(stamp);
  if (!Number.isFinite(ms) || ms <= 0) return false;
  return workDayIndex(ms) !== workDayIndex(nowMs);
}

// The ids of the tabs to clear, given a function that reads each tab's stored `touched-` text.
export function staleTabIds(recipeIds: readonly string[], readStamp: (key: string) => unknown, nowMs: unknown): string[] {
  return recipeIds.filter(rid => isStaleTab(readStamp(touchedKey(rid)), nowMs));
}

export interface TabLock {
  locked: boolean;
  logId: string | null;
}

// What a stored lock says, or null when there is none (or it is unreadable — a corrupt value must not stop
// the page from drawing).
export function parseLock(raw: unknown): TabLock | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as { locked?: unknown; logId?: unknown };
    return { locked: !!v.locked, logId: (v.logId as string) || null };
  } catch {
    return null;
  }
}

// What is stored for a lock.
export function serializeLock(locked: unknown, logId?: unknown): string {
  return JSON.stringify({ locked: !!locked, logId: logId || null });
}
