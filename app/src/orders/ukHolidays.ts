// ukHolidays.ts — Britain's public holidays for a UK venue (step 3f-6, parity R13): the copy kept on this phone, and gov.uk
// asked for a fresh one at most once a day.
//
// The data half of js/orders/holidays.js, which kept the list in a module variable, read localStorage at import and fetched on
// every page load. The calendar rules themselves are pure and live in @mise/shared/holidays, which takes the list as an
// argument; this file only decides WHICH list to hand them.
//
// ⚠️ THE SAME CACHE KEY AS THE CURRENT APP (`uk-bank-holidays`). Both apps live on the same origin, so the list one of them
// downloaded is the other's offline copy too; the key is on local-data's KEEP_PREFIXES (public data, belongs to nobody), and so
// is the day of the last download, whose key starts with it.
//
// ⚠️ ONLY A UK VENUE ASKS gov.uk (the original's rule): an Italian venue computes its calendar and makes no request at all.
//
// ⚠️ ONCE A DAY, NOT ON EVERY OPENING (decision D5 of the slice, P14): Orders opens and closes many times a day inside one app,
// and the list changes perhaps once a year. A failed request is not remembered as done, so the next opening tries again.

import { useEffect, useState } from 'react';
import { todayISO } from '@mise/shared/day';
import { UK_CACHE_KEY, UK_FALLBACK, UK_SOURCE_URL, ukDatesFromFeed } from '@mise/shared/holidays';

export const UK_FETCHED_KEY = `${UK_CACHE_KEY}-fetched`;

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// The list to use now: the downloaded copy joined with the built-in one, sorted, each day once. ⚠️ JOINED, not either-or: a copy
// downloaded years ago stops early, and the built-in list (to 2028) must still answer for the years it holds. Both are official
// dates, so the union is never wrong about a day the other knows. Unreadable storage → the built-in list alone.
export function knownUkDates(storage: KeyStore | null): readonly string[] {
  let cached: string[] = [];
  try {
    const raw = storage?.getItem(UK_CACHE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(list)) cached = list.filter((day): day is string => typeof day === 'string' && ISO_DAY.test(day));
  } catch { /* a broken copy is no copy */ }
  return [...new Set([...UK_FALLBACK, ...cached])].sort();
}

export interface UkRefreshDeps {
  readonly storage: KeyStore | null;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly today: string;
}

// Asks gov.uk for the list, unless it was already downloaded today. Resolves to the new list (already joined, as knownUkDates),
// or null when nothing changed: asked already today, or the request failed (the copy on the phone stays). Never throws.
export async function refreshUkDates({ storage, fetch, today }: UkRefreshDeps): Promise<readonly string[] | null> {
  try {
    if (storage?.getItem(UK_FETCHED_KEY) === today) return null;
  } catch { /* unreadable storage: ask, and keep nothing */ }
  try {
    const response = await fetch(UK_SOURCE_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dates = ukDatesFromFeed(await response.json());
    // ⚠️ AN EMPTY ANSWER IS NOT A CALENDAR: it never replaces the copy, and is not counted as today's download.
    if (!dates.length) return null;
    try {
      storage?.setItem(UK_CACHE_KEY, JSON.stringify(dates));
      storage?.setItem(UK_FETCHED_KEY, today);
    } catch { /* storage full or blocked: the list is still used for this opening */ }
    return [...new Set([...UK_FALLBACK, ...dates])].sort();
  } catch (err) {
    console.warn('UK holidays: keeping the copy on this phone —', err instanceof Error ? err.message : err);
    return null;
  }
}

function browserStorage(): KeyStore | null {
  try { return window.localStorage; } catch { return null; }
}

// One request at a time for the whole app: two screens asking at once share it. Forgotten once answered, so a later opening asks
// again only if the download did not land (refreshUkDates then reads the day it was stored).
let inFlight: Promise<readonly string[] | null> | null = null;

// The UK list for this venue's screens. `country` is the venue's ('GB', 'IT', or null while unknown): only 'GB' downloads.
export function useUkHolidays(country: string | null): readonly string[] {
  const [dates, setDates] = useState<readonly string[]>(() => knownUkDates(browserStorage()));
  useEffect(() => {
    if (country !== 'GB') return undefined;
    let live = true;
    if (!inFlight) {
      const asked = refreshUkDates({ storage: browserStorage(), fetch: (url, init) => window.fetch(url, init), today: todayISO() });
      inFlight = asked;
      void asked.finally(() => { if (inFlight === asked) inFlight = null; });
    }
    void inFlight.then(list => { if (live && list) setDates(list); });
    return () => { live = false; };
  }, [country]);
  return dates;
}
