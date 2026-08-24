// holidays.js — the public-holiday calendar of the country a venue sells in.
//
// ⚠️⚠️ THIS FILE USED TO BE bank-holidays.js AND IT KNEW ONLY THE UNITED KINGDOM.
// Federico, 24 Aug 2026, on Panificio Miano — a bakery in Italy, configured in
// Italy, reading its screen in Italian: «mi sta suggerendo le festivita' in uk ma
// dovrebbe suggerirmi le festivita' in Italia». It announced Britain's late summer
// bank holiday to a business that has never heard of it, and said nothing about
// Ferragosto, which is the day everything in Italy shuts.
//
// ⚠️ THE NAME CHANGED WITH THE CONTENT, DELIBERATELY. "Bank holiday" is a British
// term for a British thing; a file called bank-holidays.js holding two countries'
// calendars is the next person's trap, in the way this project has already paid for
// twice (v1.65.1: «a key named after its old English is the next person's trap»).
//
// ⚠️⚠️ WHICH COUNTRY IS A PARAMETER, NEVER MODULE STATE, AND THAT IS THE WHOLE
// SAFETY ARGUMENT. A `let country` set once at start-up is the v1.57.0 defect
// waiting to happen: a module is evaluated at first import, which is before any
// venue is open, so anything captured then is frozen for the life of the page — and
// what it would freeze here is which country's holidays a bakery is told about.
// Passing it in at every call cannot go stale, and a caller that forgets it gets
// silence rather than the wrong country.

import { italianHolidays } from './holidays-it.js';

// ── The United Kingdom: fetched, because it moves ────────────────────────────
//
// England & Wales only — the app's UK venues are there, and Scotland's calendar
// differs. Fetched at start-up, cached in localStorage for offline use, and falling
// back to a built-in list when the network and the cache are both unavailable.
const UK_SOURCE_URL = 'https://www.gov.uk/bank-holidays.json';

// ⚠️ THE CACHE KEY IS UNCHANGED ON PURPOSE, even though the file around it was
// renamed. It holds the UK list and nothing else, so the name is still exactly
// right — and changing it would throw away the calendar already sitting on every
// installed phone, which is the one copy that works with no network. It stays on
// js/local-data.js's keep-list for the same reason: public data, belongs to nobody.
const UK_CACHE_KEY = 'uk-bank-holidays';

// Built-in fallback so the app still works offline before the first fetch.
const UK_FALLBACK = [
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
];

function loadFromCache() {
  try {
    const raw = localStorage.getItem(UK_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch {
    return null;
  }
}

// Current UK list: cached official dates if present, otherwise the fallback.
let ukHolidays = loadFromCache() || UK_FALLBACK.slice();

// ── The one place a country picks its calendar ───────────────────────────────
//
// ⚠️ A TABLE, NOT AN if/else CHAIN, so a third country cannot be added to
// js/market.js COUNTRIES and quietly inherit Britain's bank holidays. A test pins
// that this table and COUNTRIES hold the same keys — the same guard market.js
// already uses for its currency table, and for the same reason.
// ⚠️ BOTH ENTRIES ANSWER FOR ONE YEAR, even though the UK list arrives as a flat
// array of everything gov.uk publishes. Two calendars that answer different
// questions is how a caller comes to be right about one country and wrong about the
// other — see nextHoliday() below, which walks two years and would otherwise hand
// back Britain's whole list twice.
const CALENDAR = Object.freeze({
  GB: (year) => ukHolidays.filter(d => String(d).startsWith(`${year}-`)),
  IT: (year) => italianHolidays(year),
});

// ⚠️⚠️ AN UNKNOWN COUNTRY HAS NO HOLIDAYS, AND NEVER FALLS BACK TO THE UK. It is
// the same decision as countryOf() in js/market.js answering null rather than 'GB',
// and it is the decision this whole file exists to correct: showing one country's
// calendar to another is not "a bit off", it is telling somebody the wrong day the
// suppliers are shut. A venue whose country is missing, or whose location document
// failed to load, is told nothing — which is quiet, but never wrong.
//
// ⚠️ Checked in production on 24 Aug 2026 before choosing this direction: all three
// live venues carry a country (bakery GB, restaurant GB, Panificio Miano IT), so
// nobody loses a calendar they have today.
function calendarFor(country, year) {
  const build = CALENDAR[country];
  return build ? build(year) : [];
}

function yearOf(isoDate) {
  const found = /^(\d{4})-\d{2}-\d{2}$/.exec(String(isoDate || ''));
  return found ? Number(found[1]) : null;
}

// Fetch the official UK calendar and refresh the cache. Safe to call
// fire-and-forget; on any failure the cached/fallback list is kept. Resolves to the
// active list for `country`.
//
// ⚠️ IT ASKS gov.uk ONLY FOR A UK VENUE. An Italian bakery has no reason to make
// that call, and the calendar it would download is one it must never be shown.
export async function refreshHolidays(country) {
  if (country !== 'GB') return calendarFor(country, new Date().getFullYear());
  try {
    const res = await fetch(UK_SOURCE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const events = data['england-and-wales']?.events || [];
    const dates = events.map(e => e.date).filter(Boolean);
    if (dates.length) {
      ukHolidays = dates;
      try { localStorage.setItem(UK_CACHE_KEY, JSON.stringify(dates)); } catch { /* storage full/blocked */ }
    }
  } catch (err) {
    console.warn('Holidays: keeping cached/fallback list —', err.message);
  }
  return ukHolidays;
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Is the given ISO date (YYYY-MM-DD) a public holiday in `country`?
export function isHoliday(isoDate, country) {
  const year = yearOf(isoDate);
  if (year === null) return false;
  return calendarFor(country, year).includes(isoDate);
}

// Is there a public holiday within the next `days` days (from tomorrow)?
export function isHolidayWithinNextDays(from = new Date(), days = 7, country = null) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  for (let i = 1; i <= days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (isHoliday(toISODate(d), country)) return true;
  }
  return false;
}

// The next public holiday on/after `from` as an ISO string, or null.
//
// ⚠️ IT LOOKS INTO NEXT YEAR TOO. The UK list is a flat array of whatever gov.uk
// published, but the Italian one is worked out a year at a time — so asking only
// for `from`'s own year would answer null every December, on the one screen whose
// job is to warn about Christmas.
export function nextHoliday(from = new Date(), country = null) {
  const today = toISODate(new Date(from.getFullYear(), from.getMonth(), from.getDate()));
  const year = from.getFullYear();
  const dates = [...calendarFor(country, year), ...calendarFor(country, year + 1)];
  return dates.sort().find(h => h >= today) || null;
}
