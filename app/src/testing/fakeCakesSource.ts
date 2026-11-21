import { vi } from 'vitest';
import type { CakesMeta, CakesSource } from '../cakes/cakesSource';
import type { StoredDoc } from '../foodcost/foodcostSource';

// A Cakes source for the specs of screens, in memory: the cakes and the reference grams are plain values, every answer comes from
// the server (this fake is a database that is online), and the live watchers are told again by push(). A cake is never written
// through this source — it travels in Food cost's batch (fakeFoodcostSource keeps it in `cakes`) — so a spec that needs the list to
// follow a save sets `cakes` and calls push().
type CakesListener = { onChange: (list: StoredDoc[], meta: CakesMeta) => void; onError: (err: unknown) => void };
type ReferenceListener = (data: Record<string, unknown> | null, meta: CakesMeta) => void;

const FROM_SERVER: CakesMeta = { fromServer: true };
const FROM_COPY: CakesMeta = { fromServer: false };

export type FakeCakesSource = CakesSource & {
  cakes: Map<string, StoredDoc>;
  // `cake-settings/reference` as stored (null: none).
  reference: Record<string, unknown> | null;
  // The next reference save is refused (permission-denied).
  refuse: { reference: boolean };
  // Every reference write that reached the source, in order.
  saved: { grams: unknown; updatedAt: string }[];
  // The reference answers from this phone's own copy only (a first visit offline): a missing document is then NOT an answer.
  referenceOffline: boolean;
  // Tells every watcher again, as another phone's write would.
  push(): void;
  // Holds back the first answer of the cakes until release() (Firestore still loading).
  hold(): void;
  release(): void;
  // The cakes' stream dies now: every live watcher gets the error.
  failCakes(): void;
};

export function fakeCakesSource(seed: { cakes?: StoredDoc[]; reference?: Record<string, unknown> | null; referenceOffline?: boolean } = {}): FakeCakesSource {
  const cakes = new Map((seed.cakes ?? []).map(doc => [doc.id, doc] as const));
  const cakeWatchers = new Set<CakesListener>();
  const referenceWatchers = new Set<ReferenceListener>();
  const refuse = { reference: false };
  const saved: FakeCakesSource['saved'] = [];
  let held = false;

  const refused = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });

  const fake: FakeCakesSource = {
    cakes, refuse, saved,
    referenceOffline: seed.referenceOffline === true,
    reference: seed.reference === undefined ? null : seed.reference,

    push() {
      if (!held) for (const w of cakeWatchers) w.onChange([...cakes.values()], FROM_SERVER);
      for (const w of referenceWatchers) w(fake.reference, fake.referenceOffline ? FROM_COPY : FROM_SERVER);
    },
    hold() { held = true; },
    release() { held = false; fake.push(); },
    failCakes() {
      for (const w of [...cakeWatchers]) { cakeWatchers.delete(w); w.onError(refused()); }
    },

    watchCakes: vi.fn<CakesSource['watchCakes']>((onChange, onError) => {
      const listener: CakesListener = { onChange, onError };
      cakeWatchers.add(listener);
      // Like onSnapshot: the first answer arrives after the call returns.
      queueMicrotask(() => { if (cakeWatchers.has(listener) && !held) onChange([...cakes.values()], FROM_SERVER); });
      return () => { cakeWatchers.delete(listener); };
    }),

    watchReference: vi.fn<CakesSource['watchReference']>(onChange => {
      referenceWatchers.add(onChange);
      queueMicrotask(() => { if (referenceWatchers.has(onChange)) onChange(fake.reference, fake.referenceOffline ? FROM_COPY : FROM_SERVER); });
      return () => { referenceWatchers.delete(onChange); };
    }),

    saveReference: vi.fn<CakesSource['saveReference']>(async (grams, updatedAt) => {
      if (refuse.reference) throw refused();
      saved.push({ grams, updatedAt });
      fake.reference = { bakery: 'bakery', grams: { ...grams }, updatedAt };
      fake.push();
    }),
  };
  return fake;
}
