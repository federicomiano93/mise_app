import { vi } from 'vitest';
import type { PastriesSource, StoredDoc } from '../pastries/pastriesSource';

// A Pastries source for the specs of screens, in memory: the seven days and the records are
// documents in two maps, every write lands at once (or is refused, with `refuse`), and every
// live watcher is told, like Firestore would. The store itself is covered against its own fake
// in pastriesStore.spec.ts; a screen's spec only needs a database that behaves.
type Listener = { onChange: (docs: StoredDoc[]) => void; onError: (err: unknown) => void; date?: string };

export type FakePastriesSource = PastriesSource & {
  days: Map<string, StoredDoc>;
  logs: Map<string, StoredDoc>;
  // The next writes of this kind are refused.
  refuse: { saveDay: boolean; confirmLog: boolean; deleteLog: boolean };
  // Tells every watcher again (as another phone's write would).
  push(): void;
  // Kills every live stream with an error.
  breakStreams(): void;
};

export function fakePastriesSource(seed: { days?: StoredDoc[]; logs?: StoredDoc[] } = {}): FakePastriesSource {
  const days = new Map((seed.days ?? []).map(doc => [doc.id, doc] as const));
  const logs = new Map((seed.logs ?? []).map(doc => [doc.id, doc] as const));
  const dayWatchers = new Set<Listener>();
  const logWatchers = new Set<Listener>();
  const refuse = { saveDay: false, confirmLog: false, deleteLog: false };

  const sortedLogs = () => [...logs.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  function push(): void {
    for (const w of dayWatchers) w.onChange([...days.values()]);
    for (const w of logWatchers) {
      w.onChange(w.date === undefined ? sortedLogs() : sortedLogs().filter(doc => doc.date === w.date));
    }
  }
  function watch(set: Set<Listener>, listener: Listener): () => void {
    set.add(listener);
    // Like onSnapshot: the first answer arrives after the call returns.
    queueMicrotask(() => { if (set.has(listener)) push(); });
    return () => { set.delete(listener); };
  }
  const refused = () => Promise.reject(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));

  return {
    days,
    logs,
    refuse,
    push,
    breakStreams() {
      for (const w of [...dayWatchers, ...logWatchers]) w.onError(new Error('unavailable'));
      dayWatchers.clear();
      logWatchers.clear();
    },
    watchDays: vi.fn((onChange, onError) => watch(dayWatchers, { onChange, onError })),
    watchLogs: vi.fn((onChange, onError) => watch(logWatchers, { onChange, onError })),
    watchLogsForDate: vi.fn((date, onChange, onError) => watch(logWatchers, { onChange, onError, date })),
    saveDay: vi.fn<PastriesSource['saveDay']>(async (day, items, note) => {
      if (refuse.saveDay) return refused();
      days.set(day, { id: day, day, items: [...items], note, bakery: 'bakery', updatedAt: new Date().toISOString() });
      push();
    }),
    getLog: vi.fn<PastriesSource['getLog']>(async id => logs.get(id) ?? null),
    confirmLog: vi.fn<PastriesSource['confirmLog']>(async (id, build) => {
      if (refuse.confirmLog) return refused();
      const { id: _id, ...payload } = build(logs.get(id) ?? null);
      logs.set(id, { ...payload, id, bakery: 'bakery' });
      push();
    }),
    deleteLog: vi.fn<PastriesSource['deleteLog']>(async id => {
      if (refuse.deleteLog) return refused();
      logs.delete(id);
      push();
    }),
  };
}
