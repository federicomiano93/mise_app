// away-reminder.js — whether somebody on holiday should be reminded of it now, and how
// to read the stored day back as a date.
//
// Federico, 13 Sep 2026: «quando sono in ferie nella home vedo che sono in ferie magari se
// cerco di fare qualcosa dentro l'app, l'app mi ricorda che sono in ferie cosi se non lo
// sono piu' e o ho dimenticato di togliere la spunta che sono in ferie la tolgo». Asked
// how often, he chose ONCE A DAY: the first card opened that day. The reminder's job is
// to catch a holiday somebody FORGOT to switch off — a phone that stays silent after
// they are back is the failure it exists for.
//
// PURE, ZERO IMPORTS, so a test can run it.

// The device remembers the last day it reminded. ⚠️ Deliberately NOT in
// js/local-data.js KEEP_PREFIXES: switching venue clears it, and the reminder simply
// comes back once — which is the harmless direction.
export const AWAY_REMINDER_KEY = 'away-reminded-date';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Remind now? Only while away, only with a real today, and only if today has not
// already had its reminder. ⚠️ Storage that cannot be read arrives here as `null` and
// reads as «not reminded yet»: an extra reminder is the safe mistake, a silent phone
// after somebody came back is not.
export function reminderDue(away, lastShown, todayISO) {
  if (away !== true) return false;
  if (typeof todayISO !== 'string' || !ISO_DAY.test(todayISO)) return false;
  return lastShown !== todayISO;
}

// '2026-09-16' → that day at local midnight, or null for anything that is not a real
// calendar day ('2026-02-30' included). The stored form is for machines; a person reads
// «16 settembre».
export function dayFromISO(iso) {
  if (typeof iso !== 'string' || !ISO_DAY.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}
