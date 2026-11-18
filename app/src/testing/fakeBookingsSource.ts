import { vi } from 'vitest';
import { readPriceList } from '@mise/shared/price-list';
import type { PriceList } from '@mise/shared/price-list';
import type { Booking, BookingData } from '../bookings/bookingModel';
import type { BookingsSource } from '../bookings/bookingsSource';
import { DEFAULT_SETTINGS } from '../bookings/bookingSettings';
import type { BookingSettings } from '../bookings/bookingSettings';

// A bookings source for the specs, in memory: the bookings are in one map, every write lands at once (as Firestore's local
// copy does) and every live watcher is told. A write is refused, as the rules or the network would, by setting `refuseWith`.
// ⚠️ FAKE CUSTOMERS ONLY (P13): no real name or phone in a fixture.
type Watcher = { from: string; onChange: (items: Booking[], fromCache: boolean) => void; onError: (err: unknown) => void };

export type FakeBookingsSource = BookingsSource & {
  items: Map<string, Booking>;
  // The published price list (an empty list: never published). Setting it tells every live watcher.
  priceList: PriceList;
  refuseWith: unknown;
  // The venue's settings (config/bookings). Setting it tells every live watcher, as the server.
  settings: BookingSettings;
  // The server's answer about the settings is held back until releaseSettings(): this device's copy answers first, with the
  // defaults (a phone that never read them, offline).
  holdSettings(): void;
  releaseSettings(): void;
  // A refused settings write (the rules, offline).
  refuseSettingsWith: unknown;
  push(): void;
  breakStreams(): void;
  watching(): number;
  priceListWatchers(): number;
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
    slotEnd: null,
    lines: [{ recipeId: null, productId: null, unitPrice: null, packSize: null, packUnit: null, weightKg: null, name: 'Panettone', qty: 2, unit: 'pcs', note: '' }],
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
  slotEnd: data.slotEnd ?? null,
  lines: data.lines.map(({ packSize, packUnit, weightKg, ...line }) => ({ ...line, note: line.note ?? '', packSize: packSize ?? null, packUnit: packUnit ?? null, weightKg: weightKg ?? null })),
});

// A price list for a spec, from stored-shape items.
export const priceListOf = (items: ReadonlyArray<Record<string, unknown>>): PriceList => readPriceList({ items });

export function fakeBookingsSource(
  seed: readonly Booking[] = [],
  priceList: PriceList = { items: [], publishedAtMs: null },
  settings: BookingSettings = DEFAULT_SETTINGS,
): FakeBookingsSource {
  const items = new Map(seed.map(item => [item.id, item] as const));
  const watchers = new Set<Watcher>();
  const listWatchers = new Set<(list: PriceList) => void>();
  type SettingsWatcher = (value: BookingSettings, meta: { readonly fromServer: boolean }) => void;
  const settingsWatchers = new Set<SettingsWatcher>();
  let counter = 0;
  let refuseWith: unknown = null;
  let refuseSettingsWith: unknown = null;
  let settingsHeld = false;
  const source = { priceList, settings };
  const tellSettings = () => { for (const w of settingsWatchers) w(source.settings, { fromServer: true }); };

  function push(): void {
    for (const w of watchers) w.onChange([...items.values()].filter(b => b.date >= w.from), false);
  }
  const refusal = (): Promise<void> | null => (refuseWith === null ? null : Promise.reject(refuseWith as Error));

  return {
    items,
    get priceList() { return source.priceList; },
    set priceList(value: PriceList) {
      source.priceList = value;
      for (const w of listWatchers) w(value);
    },
    get refuseWith() { return refuseWith; },
    set refuseWith(value: unknown) { refuseWith = value; },
    get settings() { return source.settings; },
    set settings(value: BookingSettings) {
      source.settings = value;
      tellSettings();
    },
    get refuseSettingsWith() { return refuseSettingsWith; },
    set refuseSettingsWith(value: unknown) { refuseSettingsWith = value; },
    holdSettings() { settingsHeld = true; },
    releaseSettings() {
      settingsHeld = false;
      tellSettings();
    },
    watchSettings: vi.fn((onChange: SettingsWatcher) => {
      settingsWatchers.add(onChange);
      queueMicrotask(() => {
        if (!settingsWatchers.has(onChange)) return;
        if (settingsHeld) onChange(DEFAULT_SETTINGS, { fromServer: false });
        else onChange(source.settings, { fromServer: true });
      });
      return () => { settingsWatchers.delete(onChange); };
    }),
    saveSettings: vi.fn(async (value: BookingSettings, _previous: BookingSettings) => {
      if (refuseSettingsWith !== null) throw refuseSettingsWith as Error;
      source.settings = value;
      tellSettings();
    }),
    push,
    breakStreams() {
      for (const w of [...watchers]) w.onError(new Error('unavailable'));
      watchers.clear();
    },
    watching: () => watchers.size,
    priceListWatchers: () => listWatchers.size,
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
    watchPriceList: vi.fn(onChange => {
      listWatchers.add(onChange);
      queueMicrotask(() => { if (listWatchers.has(onChange)) onChange(source.priceList); });
      return () => { listWatchers.delete(onChange); };
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
