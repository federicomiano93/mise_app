import type { DueMeta, OrdersDueSource, StoredDoc } from '../home/ordersDueSource';

// The Home's «Ordini da fare» source for the specs, in memory. Every watch answers at once as the SERVER (`fromServer`) unless
// `cacheOnly` is set (a phone offline: only its saved copy answers). `emit()` tells every live watcher again (another phone's write).
export type FakeOrdersDueSource = OrdersDueSource & {
  suppliers: StoredDoc[];
  records: StoredDoc[];
  draft: Record<string, unknown> | null;
  cacheOnly: boolean;
  // Every live stream fails (permission-denied, or the network).
  breakStreams(): void;
  emit(): void;
  // How many listeners are live (the card must stop them when the Home goes).
  watching(): number;
  // The day the records were asked from.
  placedFrom: string | null;
};

type Watcher = { tell: () => void; fail: (err: unknown) => void };

export function fakeOrdersDueSource(init: { suppliers?: StoredDoc[]; records?: StoredDoc[]; draft?: Record<string, unknown> | null } = {}): FakeOrdersDueSource {
  const watchers = new Set<Watcher>();
  const watch = (tell: (meta: DueMeta) => void, fail: (err: unknown) => void) => {
    const watcher: Watcher = { tell: () => { tell({ fromServer: !source.cacheOnly }); }, fail };
    watchers.add(watcher);
    queueMicrotask(() => { if (watchers.has(watcher)) watcher.tell(); });
    return () => { watchers.delete(watcher); };
  };
  const source: FakeOrdersDueSource = {
    suppliers: init.suppliers ?? [],
    records: init.records ?? [],
    draft: init.draft ?? null,
    cacheOnly: false,
    placedFrom: null,
    watchSuppliers: (onChange, onError) => watch(meta => { onChange(source.suppliers, meta); }, onError),
    watchPlaced: (fromDate, onChange, onError) => {
      source.placedFrom = fromDate;
      return watch(meta => { onChange(source.records.filter(r => typeof r.date === 'string' && r.date >= fromDate), meta); }, onError);
    },
    watchDraft: (onChange, onError) => watch(meta => { onChange(source.draft, meta); }, onError),
    breakStreams: () => { for (const w of [...watchers]) w.fail(Object.assign(new Error('permission-denied'), { code: 'permission-denied' })); },
    emit: () => { for (const w of [...watchers]) w.tell(); },
    watching: () => watchers.size,
  };
  return source;
}
