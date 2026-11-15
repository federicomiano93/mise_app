// away-reminder.ts — whether somebody on holiday should be reminded of it now, and how
// to read the stored day back as a date. PURE.
//
// TypeScript port of js/away-reminder.js for Mise 2. Behaviour is identical, input for input:
// shared/src/away-reminder.spec.ts runs every test against BOTH files and parity.spec.ts
// compares their exports. The comments below are the ones the original paid for in bugs.
//
// Federico, 13 Sep 2026: the app reminds somebody who is on holiday ONCE A DAY, the first
// time they open a section that day. The reminder's job is to catch a holiday somebody
// FORGOT to switch off — a phone that stays silent after they are back is the failure it
// exists for.

// The device remembers the last day it reminded. ⚠️ Deliberately NOT in KEEP_PREFIXES of
// local-data: switching venue clears it, and the reminder simply comes back once — which is
// the harmless direction.
export const AWAY_REMINDER_KEY = 'away-reminded-date';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Remind now? Only while away, only with a real today, and only if today has not
// already had its reminder. ⚠️ Storage that cannot be read arrives here as `null` and
// reads as «not reminded yet»: an extra reminder is the safe mistake, a silent phone
// after somebody came back is not.
export function reminderDue(away: unknown, lastShown: unknown, todayISO: unknown): boolean {
  if (away !== true) return false;
  if (typeof todayISO !== 'string' || !ISO_DAY.test(todayISO)) return false;
  return lastShown !== todayISO;
}

// '2026-09-16' → that day at local midnight, or null for anything that is not a real
// calendar day ('2026-02-30' included). The stored form is for machines; a person reads
// «16 settembre».
export function dayFromISO(iso: unknown): Date | null {
  if (typeof iso !== 'string' || !ISO_DAY.test(iso)) return null;
  const [y = NaN, m = NaN, d = NaN] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}
