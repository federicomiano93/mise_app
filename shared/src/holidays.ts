// holidays.ts — the public-holiday calendar of the country a venue sells in.
//
// TypeScript ADAPTED port of js/orders/holidays.js for Mise 2 (step 3f-6, Reminders). The RULES are the original's, input for input
// — an unknown country has no calendar, never the UK's; the `hasOwnProperty` guard; Italy computed by ./holidays-it; `nextHoliday`
// looks into next year; the window of `isHolidayWithinNextDays` starts tomorrow. holidays.spec.ts runs the shared tests against
// BOTH files. parity.spec.ts does NOT pair it, because the module's SHAPE differs on purpose:
//
//   - NO MODULE STATE, NO localStorage, NO fetch. The original kept the UK list in a module variable, read the cache at import and
//     fetched in `refreshHolidays`. Here the UK list is an ARGUMENT (`ukDates`, defaulting to the built-in list), and downloading
//     it, caching it and deciding when to ask again belong to Mise 2's data layer (app/src/orders/ukHolidays.ts). The parsing half
//     of `refreshHolidays` is `ukDatesFromFeed`, pure and never throwing. `refreshHolidays` itself is not ported.
//   - NEW: `HOLIDAY_COUNTRIES`, the countries that have a calendar, so a spec can pin it equal to market.ts COUNTRIES (the original
//     test compares the calendar with COUNTRIES by asking each one for its next holiday).
//   - `UK_SOURCE_URL`, `UK_CACHE_KEY` and `UK_FALLBACK` are exported (private in the original) because the data layer needs them.
//   - The built-in UK list now runs to 2028 (finding F-8: the original stops at 2026, after which a venue with no cached copy and no
//     network would hear nothing about a UK holiday).
//
// ⚠️⚠️ WHICH COUNTRY IS A PARAMETER, NEVER MODULE STATE, AND THAT IS THE WHOLE SAFETY ARGUMENT. A `let country` set once at start-up
// is the v1.57.0 defect waiting to happen: a module is evaluated at first import, which is before any venue is open, so anything
// captured then is frozen for the life of the page — and what it would freeze here is which country's holidays a bakery is told
// about. Passing it in at every call cannot go stale, and a caller that forgets it gets silence rather than the wrong country.
// (The same goes for the UK list now.)

import { italianHolidays } from './holidays-it';
import { toISODate } from './day';

// ── The United Kingdom: downloaded by the app, because it moves ──────────────
//
// England & Wales only — the app's UK venues are there, and Scotland's calendar differs.
export const UK_SOURCE_URL = 'https://www.gov.uk/bank-holidays.json';

// ⚠️ THE CACHE KEY IS UNCHANGED ON PURPOSE. The current app and Mise 2 live on the same origin, so the list one of them downloaded
// is the other's offline copy too; it is on local-data's keep-list for the same reason (public data, belongs to nobody).
export const UK_CACHE_KEY = 'uk-bank-holidays';

// Built-in fallback so the app still works offline before the first download: England & Wales, 2025 to 2028, from gov.uk.
export const UK_FALLBACK: readonly string[] = Object.freeze([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
  '2028-01-03', '2028-04-14', '2028-04-17', '2028-05-01', '2028-05-29', '2028-08-28', '2028-12-25', '2028-12-26',
]);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The England & Wales dates of gov.uk's feed (`{ 'england-and-wales': { events: [{ date: 'YYYY-MM-DD', … }] } }`).
//
// ⚠️ NEVER THROWS, AND KEEPS ONLY WHAT IS A DAY. The feed is somebody else's file; a malformed answer, a missing region or an
// event with no date yields fewer dates (or none, which the caller reads as "keep the copy you have"), never an exception and
// never a junk string that would sit in the cache for ever.
export function ukDatesFromFeed(data: unknown): string[] {
  const region = isRecord(data) ? data['england-and-wales'] : undefined;
  const events: unknown = isRecord(region) ? region.events : undefined;
  if (!Array.isArray(events)) return [];
  return events
    .map((event: unknown) => (isRecord(event) ? event.date : undefined))
    .filter((date): date is string => typeof date === 'string' && ISO_DAY.test(date));
}

// ── The one place a country picks its calendar ───────────────────────────────
//
// ⚠️ A TABLE, NOT AN if/else CHAIN, so a third country cannot be added to market.ts COUNTRIES and quietly inherit Britain's bank
// holidays. holidays.spec.ts pins that this table and COUNTRIES hold the same countries.
//
// ⚠️ BOTH ENTRIES ANSWER FOR ONE YEAR, even though the UK list is a flat array of everything gov.uk publishes. Two calendars that
// answer different questions is how a caller comes to be right about one country and wrong about the other — see nextHoliday(),
// which walks two years and would otherwise hand back Britain's whole list twice.
const CALENDAR: Readonly<Record<string, (year: number, ukDates: readonly string[]) => readonly string[]>> = Object.freeze({
  GB: (year, ukDates) => ukDates.filter(d => String(d).startsWith(`${year}-`)),
  IT: (year) => italianHolidays(year),
});

// The countries that have a calendar here. A rule, not a list: market.ts is the one place a country may be added, and a spec
// asserts this holds the same countries, so adding one there fails the build until somebody has decided what its holidays are.
export const HOLIDAY_COUNTRIES: readonly string[] = Object.freeze(Object.keys(CALENDAR));

// ⚠️⚠️ AN UNKNOWN COUNTRY HAS NO HOLIDAYS, AND NEVER FALLS BACK TO THE UK. It is the same decision as countryOf() in market.ts
// answering null rather than 'GB': showing one country's calendar to another is not "a bit off", it is telling somebody the wrong
// day the suppliers are shut. A venue whose country is missing, or whose location document failed to load, is told nothing —
// which is quiet, but never wrong.
//
// ⚠️ hasOwnProperty, NOT `CALENDAR[country]`. A plain object answers 'constructor' and 'toString' from its prototype, so a country
// of either name would hand back a function and throw instead of answering "no calendar".
function calendarFor(country: unknown, year: number, ukDates: readonly string[]): readonly string[] {
  const known = typeof country === 'string' && Object.prototype.hasOwnProperty.call(CALENDAR, country);
  return known ? CALENDAR[country]!(year, ukDates) : [];
}

function yearOf(isoDate: unknown): number | null {
  const found = /^(\d{4})-\d{2}-\d{2}$/.exec(String(isoDate || ''));
  return found ? Number(found[1]) : null;
}

// Is the given ISO date (YYYY-MM-DD) a public holiday in `country`? `ukDates` is the UK list to read (the built-in one by default).
export function isHoliday(isoDate: unknown, country: unknown, ukDates: readonly string[] = UK_FALLBACK): boolean {
  const year = yearOf(isoDate);
  if (year === null) return false;
  return calendarFor(country, year, ukDates).includes(isoDate as string);
}

// Is there a public holiday within the next `days` days (from tomorrow)?
export function isHolidayWithinNextDays(
  from: Date = new Date(),
  days: number = 7,
  country: unknown = null,
  ukDates: readonly string[] = UK_FALLBACK,
): boolean {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  for (let i = 1; i <= days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (isHoliday(toISODate(d), country, ukDates)) return true;
  }
  return false;
}

// The next public holiday on/after `from` as an ISO string, or null.
//
// ⚠️ IT LOOKS INTO NEXT YEAR TOO. The UK list is a flat array of whatever gov.uk published, but the Italian one is worked out a
// year at a time — so asking only for `from`'s own year would answer null every December, on the one screen whose job is to warn
// about Christmas.
export function nextHoliday(
  from: Date = new Date(),
  country: unknown = null,
  ukDates: readonly string[] = UK_FALLBACK,
): string | null {
  const today = toISODate(new Date(from.getFullYear(), from.getMonth(), from.getDate()));
  const year = from.getFullYear();
  const dates = [...calendarFor(country, year, ukDates), ...calendarFor(country, year + 1, ukDates)];
  return dates.sort().find(h => h >= today) || null;
}
