// fakePriceChangesSource.ts — an in-memory PriceChangesSource for the screen's specs (specs only).
//
// `changes` is «the server»: listPriceChanges() answers the ones whose `date` falls in the range, oldest first, and
// latestPriceChangeDate() the newest date — as the real queries do. On top of that it
//   • RECORDS every call (`calls`, in order), so a spec can tell which period was asked for;
//   • answers FROM THE CACHE on request (`fromCache = true`): the same documents, flagged, as the real source does after a
//     failed server read;
//   • FAILS on request (`failNext(error)`), once per call, to show the error and «Try again»;
//   • HOLDS a call pending (`hold()`) until the spec releases it, to answer an older period AFTER a newer one (late answers).
//
// Invented data only.

import type { LatestChangeAnswer, PriceChangesAnswer, PriceChangesSource } from '../priceChangesSource';
import type { StoredDoc } from '../../suppliersSource';

export interface FakePriceChangesSource extends PriceChangesSource {
  changes: StoredDoc[];
  fromCache: boolean;
  readonly calls: Array<{ readonly method: 'list'; readonly from: string; readonly to: string } | { readonly method: 'latest' }>;
  failNext(error: unknown): void;
  // The next call waits until the returned function is called.
  hold(): () => void;
}

export function fakePriceChangesSource(changes: StoredDoc[] = []): FakePriceChangesSource {
  const failures: unknown[] = [];
  let gate: Promise<void> | null = null;

  async function answer<T>(make: () => T): Promise<T> {
    const waitFor = gate;
    gate = null;
    if (failures.length > 0) {
      const error = failures.shift();
      if (waitFor) await waitFor;
      throw error;
    }
    if (waitFor) await waitFor;
    return make();
  }

  const fake: FakePriceChangesSource = {
    changes,
    fromCache: false,
    calls: [],
    failNext(error) { failures.push(error); },
    hold() {
      let release: () => void = () => undefined;
      gate = new Promise<void>(resolve => { release = resolve; });
      return release;
    },
    listPriceChanges(from, to) {
      fake.calls.push({ method: 'list', from, to });
      return answer<PriceChangesAnswer>(() => ({
        docs: fake.changes
          .filter(c => typeof c.date === 'string' && c.date >= from && c.date <= to)
          .sort((x, y) => String(x.date).localeCompare(String(y.date))),
        fromCache: fake.fromCache,
      }));
    },
    latestPriceChangeDate() {
      fake.calls.push({ method: 'latest' });
      return answer<LatestChangeAnswer>(() => {
        const dates = fake.changes.map(c => c.date).filter((d): d is string => typeof d === 'string').sort();
        return { date: dates[dates.length - 1] ?? '', fromCache: fake.fromCache };
      });
    },
  };
  return fake;
}
