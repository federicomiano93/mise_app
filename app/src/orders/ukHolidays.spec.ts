// Britain's holiday list on this phone (ukHolidays.ts, parity R13, decision D5 of step 3f-6): the copy, the once-a-day download,
// and the failures that must keep what is there.

import { describe, expect, it, vi } from 'vitest';
import { UK_CACHE_KEY, UK_FALLBACK, UK_SOURCE_URL } from '@mise/shared/holidays';
import { KEEP_PREFIXES, keysToClear } from '@mise/shared/local-data';
import { UK_FETCHED_KEY, knownUkDates, refreshUkDates } from './ukHolidays';

const TODAY = '2026-10-30';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

const feed = (dates: string[]) => ({ 'england-and-wales': { division: 'england-and-wales', events: dates.map(date => ({ title: 'x', date })) } });

function answering(body: unknown, ok = true) {
  return vi.fn(async (_url: string, _init: RequestInit) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response);
}

describe('knownUkDates — the list used now', () => {
  it('with nothing stored, the built-in list (which reaches 2028, finding F-8)', () => {
    expect(knownUkDates(memory())).toStrictEqual([...UK_FALLBACK].sort());
    expect(knownUkDates(null)).toContain('2028-12-26');
  });

  it('a stored copy is joined with the built-in list, each day once, sorted', () => {
    const list = knownUkDates(memory({ [UK_CACHE_KEY]: JSON.stringify(['2029-01-01', '2026-12-25']) }));
    expect(list).toContain('2029-01-01');
    expect(list).toContain('2027-12-27');
    expect(list.filter(day => day === '2026-12-25')).toHaveLength(1);
    expect([...list]).toStrictEqual([...list].sort());
  });

  it('a broken copy or junk inside it never reaches the calendar', () => {
    expect(knownUkDates(memory({ [UK_CACHE_KEY]: '{not json' }))).toStrictEqual([...UK_FALLBACK].sort());
    const list = knownUkDates(memory({ [UK_CACHE_KEY]: JSON.stringify([42, null, '25/12/2026', '2030-01-01']) }));
    expect(list).toContain('2030-01-01');
    expect(list).not.toContain('25/12/2026');
  });

  it('storage that throws answers the built-in list', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(knownUkDates(throwing)).toStrictEqual([...UK_FALLBACK].sort());
  });
});

describe('refreshUkDates — gov.uk at most once a day', () => {
  it('downloads, keeps the copy and the day, and answers the joined list', async () => {
    const storage = memory();
    const fetch = answering(feed(['2029-01-01', '2029-04-02']));

    const list = await refreshUkDates({ storage, fetch, today: TODAY });

    expect(fetch).toHaveBeenCalledWith(UK_SOURCE_URL, { cache: 'no-cache' });
    expect(JSON.parse(storage.data.get(UK_CACHE_KEY) ?? '[]')).toStrictEqual(['2029-01-01', '2029-04-02']);
    expect(storage.data.get(UK_FETCHED_KEY)).toBe(TODAY);
    expect(list).toContain('2029-04-02');
    expect(list).toContain('2026-12-25');
  });

  it('⚠️ already downloaded today: no request at all', async () => {
    const fetch = answering(feed(['2029-01-01']));
    expect(await refreshUkDates({ storage: memory({ [UK_FETCHED_KEY]: TODAY }), fetch, today: TODAY })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloaded yesterday: asks again', async () => {
    const fetch = answering(feed(['2029-01-01']));
    await refreshUkDates({ storage: memory({ [UK_FETCHED_KEY]: '2026-10-29' }), fetch, today: TODAY });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('⚠️ a failed request keeps the copy, and is not counted as today’s download', async () => {
    const storage = memory({ [UK_CACHE_KEY]: JSON.stringify(['2026-12-25']) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const fetch of [answering(feed(['2029-01-01']), false), vi.fn(async () => { throw new Error('offline'); })]) {
      expect(await refreshUkDates({ storage, fetch, today: TODAY })).toBeNull();
    }
    warn.mockRestore();
    expect(storage.data.get(UK_CACHE_KEY)).toBe(JSON.stringify(['2026-12-25']));
    expect(storage.data.has(UK_FETCHED_KEY)).toBe(false);
  });

  it('⚠️ an answer with no dates is not a calendar: the copy stays and the next opening asks again', async () => {
    const storage = memory({ [UK_CACHE_KEY]: JSON.stringify(['2026-12-25']) });
    expect(await refreshUkDates({ storage, fetch: answering({ scotland: {} }), today: TODAY })).toBeNull();
    expect(storage.data.get(UK_CACHE_KEY)).toBe(JSON.stringify(['2026-12-25']));
    expect(storage.data.has(UK_FETCHED_KEY)).toBe(false);
  });

  it('storage that refuses the write still answers the downloaded list', async () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    expect(await refreshUkDates({ storage, fetch: answering(feed(['2029-01-01'])), today: TODAY })).toContain('2029-01-01');
  });
});

describe('the copy survives a venue switch', () => {
  it('both keys start with a kept prefix', () => {
    expect(keysToClear([UK_CACHE_KEY, UK_FETCHED_KEY], KEEP_PREFIXES)).toStrictEqual([]);
  });
});
