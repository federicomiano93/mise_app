// alert-dismissal.js — closing a calendar notice you have read, without losing it.
//
// PURE: no DOM, no storage. Every rule here is asserted by a unit test rather than
// read back out of a rendered screen (P15).
//
// ⚠️⚠️ ONLY THE CALENDAR NOTICES ARE CLOSEABLE, AND THAT IS FEDERICO'S DECISION
// (24 Aug 2026). A coming holiday, or a holiday landing on a delivery day, is
// something to READ ONCE. The other notices on that screen — orders to place today,
// orders that never arrived, something added that nobody was told about — are WORK,
// and a closeable piece of work is a piece of work somebody can close by mistake and
// never see again. This file is only ever handed what #orders-alerts holds, which
// notifications.js has already narrowed to the calendar.
//
// ⚠️ THE KEY IS WHAT MAKES "IT COMES BACK ON ITS OWN" TRUE. Every alert already
// carries a stable one — `bh-2026-12-25`, `conf-<supplier>-<date>` — so a DIFFERENT
// holiday is a different key and is shown at full size without anybody asking. The
// same holiday, once closed, stays closed.

// The alerts still to be shown at full size.
export function visibleAlerts(alerts, dismissed) {
  const closed = new Set(dismissed || []);
  return (alerts || []).filter(a => a && !closed.has(a.key));
}

// The alerts that have been closed but are still true — what the little pill stands
// for, and what comes back when it is tapped.
export function hiddenAlerts(alerts, dismissed) {
  const closed = new Set(dismissed || []);
  return (alerts || []).filter(a => a && closed.has(a.key));
}

// ⚠️⚠️ THE MEMORY CLEANS ITSELF BY DATE, AND THE FIRST VERSION DID IT BY PRESENCE
// — WHICH WAS A DEFECT, FOUND BY RELOADING THE REAL APP. Keeping only the keys still
// among "today's alerts" sounds tighter and is not: the alerts are recomputed on
// every paint, and the FIRST paint happens before the suppliers have arrived. With no
// suppliers there is no delivery-clash alert, so its key was pruned out of storage as
// though the notice had expired — and the moment the suppliers landed it came back
// wide open, a notice somebody had explicitly put away.
//
// Every key this app makes ends in the date the notice is ABOUT (`bh-2026-12-25`,
// `conf-<supplier>-2026-12-25`), so the honest question is "is this still in the
// future?" — which no snapshot can answer wrongly.
//
// ⚠️ A KEY WITH NO DATE IN IT IS DROPPED. None exist today; if a future kind of
// notice arrives without one, it will reopen rather than be silenced for ever, and
// that is the safe direction for something whose whole job is to be read.
const DATE_AT_END = /(\d{4}-\d{2}-\d{2})$/;

export function pruneDismissed(dismissed, todayIso) {
  const today = String(todayIso || '');
  return (dismissed || []).filter(key => {
    const found = DATE_AT_END.exec(String(key || ''));
    return found ? found[1] >= today : false;
  });
}

// Closing one, and re-opening everything.
export function withDismissed(dismissed, key) {
  if (!key) return [...(dismissed || [])];
  const next = new Set(dismissed || []);
  next.add(key);
  return [...next];
}

// ⚠️ THE PILL RE-OPENS EVERY CLOSED NOTICE, not the one that happens to be first.
// It stands for "the notices you have put away", and putting them away is a single
// gesture in the other direction too — a pill that reopened them one at a time would
// make somebody tap it three times to find out there was nothing new.
export function reopenAll() {
  return [];
}

// ── Reading and writing the memory ───────────────────────────────────────────
//
// ⚠️⚠️ IF THE MEMORY CANNOT BE READ, THE NOTICE IS SHOWN. This is the opposite
// direction from whats-new-boot.js, deliberately: there, silence costs nothing but a
// missed announcement, so unreadable storage stays quiet. Here silence HIDES
// something true about the week ahead, so unreadable storage shows everything. The
// safe direction is decided by what the silence would cost.
export const DISMISSED_KEY = 'orders-alerts-dismissed';

export function readDismissed(storage) {
  try {
    const raw = storage.getItem(DISMISSED_KEY);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.filter(k => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

// Returns whether it landed. A failure is not worth telling anybody about — the
// worst it costs is a notice that opens again tomorrow.
export function writeDismissed(storage, keys) {
  try {
    storage.setItem(DISMISSED_KEY, JSON.stringify(keys || []));
    return true;
  } catch {
    return false;
  }
}
