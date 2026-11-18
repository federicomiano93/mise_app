import { vi } from 'vitest';
import type { Booking, BookingData, RecipeName } from '../bookings/bookingModel';
import type { BookingsSource } from '../bookings/bookingsSource';

// A bookings source for the specs, in memory: the bookings are in one map, every write lands at once (as Firestore's local
// copy does) and every live watcher is told. A write is refused, as the rules or the network would, by setting `refuseWith`.
// ⚠️ FAKE CUSTOMERS ONLY (P13): no real name or phone in a fixture.
type Watcher = { from: string; onChange: (items: Booking[], fromCache: boolean) => void; onError: (err: unknown) => void };

export type FakeBookingsSource = BookingsSource & {
  items: Map<string, Booking>;
  recipes: RecipeName[];
  refuseWith: unknown;
  push(): void;
  breakStreams(): void;
  watching(): number;
  recipeWatchers(): number;
};

export const permissionDenied = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });

// A booking for a spec, with sensible defaults.
export function bookingFixture(partial: Partial<Booking> & { id: string }): Booking {
  return {
    customerName: 'Mario Prova',
    phone: '+39 333 000 0000',
    mode: 'pickup',
    address: '',
    date: '2026-11-18',
    time: '10:00',
    lines: [{ recipeId: null, name: 'Panettone', qty: 2, unit: 'pcs', note: '' }],
    deposit: null,
    total: null,
    notes: '',
    status: 'todo',
    number: 1,
    ...partial,
  };
}

const fromData = (id: string, data: BookingData): Booking => ({
  id,
  ...data,
  lines: data.lines.map(line => ({ ...line, note: line.note ?? '' })),
});

export function fakeBookingsSource(seed: readonly Booking[] = [], recipes: RecipeName[] = []): FakeBookingsSource {
  const items = new Map(seed.map(item => [item.id, item] as const));
  const watchers = new Set<Watcher>();
  const recipeWatchers = new Set<(recipes: RecipeName[]) => void>();
  let counter = 0;
  let refuseWith: unknown = null;
  const source = { recipes };

  function push(): void {
    for (const w of watchers) w.onChange([...items.values()].filter(b => b.date >= w.from), false);
  }
  const refusal = (): Promise<void> | null => (refuseWith === null ? null : Promise.reject(refuseWith as Error));

  return {
    items,
    get recipes() { return source.recipes; },
    set recipes(value: RecipeName[]) {
      source.recipes = value;
      for (const w of recipeWatchers) w(value);
    },
    get refuseWith() { return refuseWith; },
    set refuseWith(value: unknown) { refuseWith = value; },
    push,
    breakStreams() {
      for (const w of [...watchers]) w.onError(new Error('unavailable'));
      watchers.clear();
    },
    watching: () => watchers.size,
    recipeWatchers: () => recipeWatchers.size,
    watch: vi.fn((from: string, onChange, onError) => {
      const watcher: Watcher = { from, onChange, onError };
      watchers.add(watcher);
      queueMicrotask(() => { if (watchers.has(watcher)) onChange([...items.values()].filter(b => b.date >= from), false); });
      return () => { watchers.delete(watcher); };
    }),
    watchDay: vi.fn((date: string, onChange, onError) => {
      const watcher: Watcher = { from: date, onChange: (list, fromCache) => { onChange(list.filter(b => b.date === date), fromCache); }, onError };
      watchers.add(watcher);
      queueMicrotask(() => { if (watchers.has(watcher)) onChange([...items.values()].filter(b => b.date === date), false); });
      return () => { watchers.delete(watcher); };
    }),
    watchRecipes: vi.fn(onChange => {
      recipeWatchers.add(onChange);
      queueMicrotask(() => { if (recipeWatchers.has(onChange)) onChange(source.recipes); });
      return () => { recipeWatchers.delete(onChange); };
    }),
    create: vi.fn((data: BookingData) => {
      counter += 1;
      const id = `new${counter}`;
      const refused = refusal();
      if (refused) return { id, written: refused };
      items.set(id, fromData(id, data));
      push();
      return { id, written: Promise.resolve() };
    }),
    update: vi.fn(async (id: string, data: BookingData) => {
      const refused = refusal();
      if (refused) return refused;
      items.set(id, fromData(id, data));
      push();
    }),
    setStatus: vi.fn(async (id, status) => {
      const refused = refusal();
      if (refused) return refused;
      const current = items.get(id);
      if (current) items.set(id, { ...current, status });
      push();
    }),
    remove: vi.fn(async id => {
      const refused = refusal();
      if (refused) return refused;
      items.delete(id);
      push();
    }),
  };
}
