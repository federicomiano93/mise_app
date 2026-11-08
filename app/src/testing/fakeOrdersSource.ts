import type { DraftPayload } from '../orders/draftSync';
import type { OrdersMeta, OrdersSource, RosterRow, StoredDoc } from '../orders/ordersSource';

// An «Orders» source for the specs, in memory, that behaves like Firestore's own local view: a draft write is in the
// document and every watcher is told AT ONCE (Firestore shows its pending writes), and a refused write is taken back and
// the watchers are told again — then its promise rejects. `holdWrites` keeps the next writes «in the air» (offline) until
// the returned release is called. From step 3f-2 it also holds the order records (`records`), and each of the three writes of
// placing can be made to fail once (`fail`), so every step of the sequence has a spec. From step 3f-2b the records are watched
// too (`watchRecentHistory`: those dated on or after the window's start; a recorded order is told at once), and `init.records`
// seeds them. From step 3f-4 (History) it pages the records older than the window like the real query (`date < before`, newest
// first, `pageSize` at a time, then the legacy records with a `weekStart`), and rewrites or deletes one record in a fake
// transaction; `fail.older`, `fail.legacy` and `fail.rewrite` refuse the next one, `duringRewrite` acts in its second. From step 3f-5
// (Incoming) it answers a delivery, resolves a missing line and merges config/orders like Firestore's local view: the change is
// in the record (or the config) and told AT ONCE, and a refused one (`failDelivery`) is taken back and told again — then its
// promise rejects. `holdWrites` holds these too. From step 3f-7 (order lists) it holds `requests` (newest first, as the query asks) and
// watches them; a list written, ticked or deleted is told AT ONCE and taken back when refused (`failRequest`). `requestsCached` answers
// from the browser's copy; `roster`, `awayDays` and `member` feed the reads, each refused by `failRead`.
type ListListener = { onChange: (list: StoredDoc[], meta: OrdersMeta) => void; onError: (err: unknown) => void };
type DocListener = { onChange: (data: Record<string, unknown> | null, meta: OrdersMeta) => void; onError: (err: unknown) => void };

export type FakeOrdersSource = OrdersSource & {
  suppliers: Map<string, StoredDoc>;
  ingredients: Map<string, StoredDoc>;
  ordersConfig: Record<string, unknown> | null;
  // drafts/current as stored (null = none).
  draft: Record<string, unknown> | null;
  // Every draft write the store sent, in order (refused ones included).
  writes: DraftPayload[];
  // The next draft writes are refused (the rules said no).
  refuseWrites: boolean;
  // The next watches fail (the rules refused them, or the stream died).
  refuse: { suppliers: boolean; ingredients: boolean; config: boolean; draft: boolean; history: boolean; requests: boolean };
  // Another phone writes the draft: merged like a setDoc merge, then every watcher is told.
  remoteMerge(payload: Record<string, unknown>): void;
  // Every watcher is told again (e.g. after the maps were changed by hand).
  emit(): void;
  // The window's start the store asked for (null before it watched).
  historyFrom: string | null;
  // The history watchers are told the answer comes from the browser's copy, not the server (a phone offline).
  historyCached: boolean;
  // Every history watcher is told again (after `records` was changed by hand).
  emitHistory(): void;
  // How many listeners are open now.
  openListeners(): number;
  // Keeps every later write waiting until the returned function is called (then they settle, in order).
  holdWrites(): () => void;
  // orders-history as stored, by id.
  records: Map<string, Record<string, unknown>>;
  // Every clear of the draft, in order (refused ones included).
  clears: Array<{ paths: readonly string[]; updatedAt: string }>;
  // How many record transactions were attempted.
  recordAttempts: number;
  // The NEXT read of a record / record transaction / draft clear is refused (then the flag goes back to false).
  fail: { read: boolean; record: boolean; clear: boolean };
  // Runs inside the next record transaction, after the read and before the write (another phone acting in that second).
  duringRecord: (() => void) | null;
  // The page size of getOlderHistory (the real one is OLDER_PAGE_SIZE, 100), and every page asked for.
  pageSize: number;
  olderReads: Array<{ before: string; cursor: unknown }>;
  legacyReads: number;
  // The next older page / legacy read / rewrite transaction is refused (then the flag goes back to false).
  failHistory: { older: boolean; legacy: boolean; rewrite: boolean; recent: boolean };
  // Every getRecentHistoryFromServer asked for, by its `fromDate`.
  recentReads: string[];
  // Runs inside the next rewrite transaction, after the read and before `decide` (another phone writing in that second).
  duringRewrite: (() => void) | null;
  // Every rewrite attempted, by record id.
  rewrites: string[];
  // Every delivery answer, «Resolved» and config/orders merge sent, in order (refused ones included).
  deliveryWrites: Array<
    | { kind: 'confirm'; id: string; patch: Record<string, unknown> }
    | { kind: 'resolve'; id: string; ingredientId: string; at: string }
    | { kind: 'config'; patch: Record<string, unknown> }>;
  // The NEXT write of that kind is refused (then the flag goes back to false).
  failDelivery: { confirm: boolean; resolve: boolean; config: boolean };
  // order-requests as stored, by id.
  requests: Map<string, Record<string, unknown>>;
  // The watchers are told the answer comes from the browser's copy, not the server.
  requestsCached: boolean;
  // Every tick merge sent, in order (refused ones included), and every token mute.
  ticks: Array<{ id: string; done: Readonly<Record<string, boolean>>; updatedAt: string }>;
  mutes: Array<{ token: string; mute: boolean }>;
  // The NEXT write of an order list (a new one, a tick, a delete, a mute) is refused (then the flag goes back to false).
  failRequest: boolean;
  // The roster, who is away, and the sender's own row; a read of any of them rejects while `failRead` is on.
  roster: RosterRow[];
  awayDays: StoredDoc[];
  member: Record<string, unknown> | null;
  failRead: boolean;
  reads: number;
  // Another phone writes a list, or changes one: every watcher is told.
  emitRequests(): void;
  // ingredient-prices as stored, by ingredient id (step 3f-8c). `refusePrices` makes the rules refuse the read: the watcher is
  // told ({}, false), as the real one is. `priceWatches` counts every listener ever opened on the collection, `priceWatchersOpen`
  // the ones open now.
  prices: Map<string, Record<string, unknown>>;
  refusePrices: boolean;
  // The browser's copy answers first, holding prices (readable), then the server refuses: the real order for a person who lost the
  // right to read prices while this phone still held them.
  refusePricesAfterCopy: boolean;
  priceWatches: number;
  priceWatchersOpen(): number;
  // Another phone (or the card) changes a price: every price watcher is told.
  emitPrices(): void;
};

// A merge like setDoc(…, { merge: true }): maps merged key by key at every depth, everything else replaced.
function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    const before = out[key];
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      && before && typeof before === 'object' && !Array.isArray(before)
      ? deepMerge(before as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  return out;
}

export function fakeOrdersSource(init: {
  suppliers?: StoredDoc[]; ingredients?: StoredDoc[]; ordersConfig?: Record<string, unknown> | null;
  draft?: Record<string, unknown> | null; records?: Record<string, Record<string, unknown>>;
  requests?: Record<string, Record<string, unknown>>;
  prices?: Record<string, Record<string, unknown>>;
} = {}): FakeOrdersSource {
  const supplierWatchers = new Set<ListListener>();
  const ingredientWatchers = new Set<ListListener>();
  const configWatchers = new Set<DocListener>();
  const draftWatchers = new Set<DocListener>();
  const historyWatchers = new Set<{ from: string; onChange: (list: StoredDoc[], meta: OrdersMeta) => void }>();
  const requestWatchers = new Set<ListListener>();
  const priceWatchers = new Set<(map: Record<string, Record<string, unknown>>, readable: boolean, meta: OrdersMeta) => void>();
  let nextRequest = 1;
  let held: Array<() => void> | null = null;
  const fromServer: OrdersMeta = { fromServer: true };

  const source: FakeOrdersSource = {
    suppliers: new Map((init.suppliers ?? []).map(s => [s.id, s])),
    ingredients: new Map((init.ingredients ?? []).map(i => [i.id, i])),
    ordersConfig: init.ordersConfig ?? null,
    draft: init.draft ?? null,
    writes: [],
    refuseWrites: false,
    refuse: { suppliers: false, ingredients: false, config: false, draft: false, history: false, requests: false },
    historyFrom: null,
    historyCached: false,

    watchSuppliers(onChange, onError) {
      const l = { onChange, onError };
      if (source.refuse.suppliers) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      supplierWatchers.add(l);
      queueMicrotask(() => { if (supplierWatchers.has(l)) onChange([...source.suppliers.values()], fromServer); });
      return () => { supplierWatchers.delete(l); };
    },
    watchIngredients(onChange, onError) {
      const l = { onChange, onError };
      if (source.refuse.ingredients) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      ingredientWatchers.add(l);
      queueMicrotask(() => { if (ingredientWatchers.has(l)) onChange([...source.ingredients.values()], fromServer); });
      return () => { ingredientWatchers.delete(l); };
    },
    watchOrdersConfig(onChange, onError) {
      const l = { onChange, onError };
      if (source.refuse.config) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      configWatchers.add(l);
      queueMicrotask(() => { if (configWatchers.has(l)) onChange(source.ordersConfig, fromServer); });
      return () => { configWatchers.delete(l); };
    },
    watchDraft(onChange, onError) {
      const l = { onChange, onError };
      if (source.refuse.draft) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      draftWatchers.add(l);
      queueMicrotask(() => { if (draftWatchers.has(l)) onChange(source.draft, fromServer); });
      return () => { draftWatchers.delete(l); };
    },

    watchRecentHistory(fromDate, onChange, onError) {
      source.historyFrom = fromDate;
      if (source.refuse.history) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      const l = { from: fromDate, onChange };
      historyWatchers.add(l);
      queueMicrotask(() => { if (historyWatchers.has(l)) onChange(historyFrom(fromDate), historyMeta()); });
      return () => { historyWatchers.delete(l); };
    },

    mergeDraft(payload) {
      source.writes.push(payload);
      const before = source.draft;
      source.draft = deepMerge(before ?? {}, { ...payload, bakery: 'bakery' } as Record<string, unknown>);
      tellDraft();
      const refused = source.refuseWrites;
      const settle = (resolve: () => void, reject: (err: unknown) => void) => {
        if (refused) {
          source.draft = before;
          tellDraft();
          reject(new Error('permission-denied'));
        } else resolve();
      };
      return new Promise<void>((resolve, reject) => {
        if (held) held.push(() => settle(resolve, reject));
        else queueMicrotask(() => settle(resolve, reject));
      });
    },

    records: new Map(Object.entries(init.records ?? {})),
    clears: [],
    recordAttempts: 0,
    fail: { read: false, record: false, clear: false },
    duringRecord: null,

    // updateDoc with deleteField(): only the named dotted paths go; a nested map left empty stays as {} (Firestore does
    // the same). A refused clear changes nothing.
    async clearDraft(paths, updatedAt) {
      source.clears.push({ paths: [...paths], updatedAt });
      await Promise.resolve();
      if (source.fail.clear) {
        source.fail.clear = false;
        throw new Error('permission-denied');
      }
      if (!source.draft) throw new Error('not-found');
      const next = structuredClone(source.draft);
      for (const path of paths) {
        const keys = path.split('.');
        let at: Record<string, unknown> | undefined = next;
        for (const key of keys.slice(0, -1)) {
          const inner: unknown = at?.[key];
          at = inner && typeof inner === 'object' ? inner as Record<string, unknown> : undefined;
        }
        if (at) delete at[keys[keys.length - 1] as string];
      }
      next.updatedAt = updatedAt;
      source.draft = next;
      tellDraft();
    },

    async readRecord(id) {
      await Promise.resolve();
      if (source.fail.read) {
        source.fail.read = false;
        throw new Error('unavailable');
      }
      const record = source.records.get(id);
      return record ? structuredClone(record) : null;
    },

    pageSize: 100,
    olderReads: [],
    legacyReads: 0,
    failHistory: { older: false, legacy: false, rewrite: false, recent: false },
    recentReads: [],
    duringRewrite: null,
    rewrites: [],

    // `date < before`, by `date` descending (ids break ties, as Firestore orders by the field and then the document), after the
    // cursor, `pageSize` at a time. The cursor here is the last record's id.
    async getOlderHistory({ before, cursor }) {
      source.olderReads.push({ before, cursor });
      await Promise.resolve();
      if (source.failHistory.older) {
        source.failHistory.older = false;
        throw new Error('unavailable');
      }
      const all = [...source.records.entries()]
        .filter(([, r]) => typeof r.date === 'string' && r.date < before)
        .map(([id, r]) => ({ ...structuredClone(r), id }) as StoredDoc)
        .sort((a, b) => (String(b.date).localeCompare(String(a.date)) || b.id.localeCompare(a.id)));
      const start = cursor ? all.findIndex(r => r.id === cursor) + 1 : 0;
      const records = all.slice(start, start + source.pageSize);
      return {
        records,
        cursor: records.length ? (records[records.length - 1] as StoredDoc).id : cursor,
        done: records.length < source.pageSize,
      };
    },

    // `date >= fromDate`, as the server holds the records now.
    async getRecentHistoryFromServer(fromDate) {
      source.recentReads.push(fromDate);
      await Promise.resolve();
      if (source.failHistory.recent) throw new Error('unavailable');
      return [...source.records.entries()]
        .filter(([, r]) => typeof r.date === 'string' && r.date >= fromDate)
        .map(([id, r]) => ({ ...structuredClone(r), id }) as StoredDoc);
    },

    async getLegacyHistory() {
      source.legacyReads += 1;
      await Promise.resolve();
      if (source.failHistory.legacy) {
        source.failHistory.legacy = false;
        throw new Error('unavailable');
      }
      return [...source.records.entries()]
        .filter(([, r]) => typeof r.weekStart === 'string')
        .map(([id, r]) => ({ ...structuredClone(r), id }) as StoredDoc);
    },

    async rewriteRecord(id, decide) {
      source.rewrites.push(id);
      await Promise.resolve();
      const run = source.duringRewrite;
      source.duringRewrite = null;
      run?.();
      if (source.failHistory.rewrite) {
        source.failHistory.rewrite = false;
        throw new Error('unavailable');
      }
      const existing = source.records.get(id);
      // What decide throws aborts the write, as in a real transaction.
      const next = decide(existing ? structuredClone(existing) : null);
      if (next === null) {
        source.records.delete(id);
        tellHistory();
        return null;
      }
      const stamped = { ...next, bakery: 'bakery' };
      source.records.set(id, stamped);
      tellHistory();
      return stamped;
    },

    async recordOrder(id, merge) {
      source.recordAttempts += 1;
      await Promise.resolve();
      const existing = source.records.get(id);
      const run = source.duringRecord;
      source.duringRecord = null;
      run?.();
      if (source.fail.record) {
        source.fail.record = false;
        throw new Error('unavailable');
      }
      // What merge throws (orders/unit-conflict) aborts the write, as in a real transaction.
      const next = { ...merge(existing ? structuredClone(existing) : null), bakery: 'bakery' };
      source.records.set(id, next);
      tellHistory();
      return next;
    },

    deliveryWrites: [],
    failDelivery: { confirm: false, resolve: false, config: false },

    // updateDoc: refused when the record is not there (not-found), `missing` replaced whole.
    confirmDelivery(id, patch) {
      source.deliveryWrites.push({ kind: 'confirm', id, patch: { ...patch } });
      const before = source.records.get(id);
      if (!before) return Promise.reject(new Error('not-found'));
      source.records.set(id, { ...structuredClone(before), ...structuredClone(patch), bakery: 'bakery' });
      tellHistory();
      return settleWrite('confirm', () => { source.records.set(id, before); tellHistory(); });
    },

    // setDoc merge: the map is added to, key by key; a record that is not there is created (as Firestore's merge would).
    resolveMissing(recordId, ingredientId, at) {
      source.deliveryWrites.push({ kind: 'resolve', id: recordId, ingredientId, at });
      const before = source.records.get(recordId);
      source.records.set(recordId, deepMerge(before ? structuredClone(before) : {},
        { missingResolved: { [ingredientId]: at }, updatedAt: at, bakery: 'bakery' }));
      tellHistory();
      return settleWrite('resolve', () => {
        if (before) source.records.set(recordId, before); else source.records.delete(recordId);
        tellHistory();
      });
    },

    mergeOrdersConfig(patch) {
      source.deliveryWrites.push({ kind: 'config', patch: { ...patch } });
      const before = source.ordersConfig;
      source.ordersConfig = deepMerge(before ? structuredClone(before) : {}, { ...patch, bakery: 'bakery' });
      tellConfig();
      return settleWrite('config', () => { source.ordersConfig = before; tellConfig(); });
    },

    requests: new Map(Object.entries(init.requests ?? {})),
    requestsCached: false,
    ticks: [],
    mutes: [],
    failRequest: false,
    roster: [],
    awayDays: [],
    member: null,
    failRead: false,
    reads: 0,

    watchOrderRequests(onChange, onError) {
      const l = { onChange, onError };
      if (source.refuse.requests) { queueMicrotask(() => onError(new Error('permission-denied'))); return () => {}; }
      requestWatchers.add(l);
      queueMicrotask(() => { if (requestWatchers.has(l)) onChange(requestList(), { fromServer: !source.requestsCached }); });
      return () => { requestWatchers.delete(l); };
    },

    createOrderRequest(payload) {
      const id = `list-${nextRequest}`;
      nextRequest += 1;
      source.requests.set(id, { ...structuredClone(payload), bakery: 'bakery' });
      tellRequests();
      return settleRequest(() => { source.requests.delete(id); tellRequests(); });
    },

    setRequestDone(id, done, updatedAt) {
      source.ticks.push({ id, done: { ...done }, updatedAt });
      const before = source.requests.get(id);
      source.requests.set(id, deepMerge(before ? structuredClone(before) : {}, { done, updatedAt }));
      tellRequests();
      return settleRequest(() => {
        if (before) source.requests.set(id, before); else source.requests.delete(id);
        tellRequests();
      });
    },

    deleteOrderRequest(id) {
      const before = source.requests.get(id);
      source.requests.delete(id);
      tellRequests();
      return settleRequest(() => {
        if (before) source.requests.set(id, before);
        tellRequests();
      });
    },

    readOwnMember() {
      source.reads += 1;
      return source.failRead ? Promise.reject(new Error('unavailable')) : Promise.resolve(source.member);
    },
    getRoster() {
      source.reads += 1;
      return source.failRead ? Promise.reject(new Error('permission-denied')) : Promise.resolve(source.roster);
    },
    getAwayDays() {
      source.reads += 1;
      return source.failRead ? Promise.reject(new Error('permission-denied')) : Promise.resolve(source.awayDays);
    },

    setPhoneMute(token, mute) {
      source.mutes.push({ token, mute });
      return settleRequest(() => {});
    },

    emitRequests: () => tellRequests(),

    prices: new Map(Object.entries(init.prices ?? {})),
    refusePrices: false,
    refusePricesAfterCopy: false,
    priceWatches: 0,
    priceWatchersOpen: () => priceWatchers.size,
    watchPrices(onChange) {
      source.priceWatches += 1;
      if (source.refusePrices) {
        queueMicrotask(() => onChange({}, false, { fromServer: false }));
        return () => {};
      }
      if (source.refusePricesAfterCopy) {
        let open = true;
        queueMicrotask(() => {
          if (!open) return;
          onChange(Object.fromEntries(source.prices), true, { fromServer: false });
          setTimeout(() => { if (open) onChange({}, false, { fromServer: false }); }, 0);
        });
        return () => { open = false; };
      }
      priceWatchers.add(onChange);
      queueMicrotask(() => { if (priceWatchers.has(onChange)) onChange(Object.fromEntries(source.prices), true, fromServer); });
      return () => { priceWatchers.delete(onChange); };
    },
    emitPrices() {
      for (const l of priceWatchers) l(Object.fromEntries(source.prices), true, fromServer);
    },

    remoteMerge(payload) {
      source.draft = deepMerge(source.draft ?? {}, payload);
      tellDraft();
    },

    emit() {
      for (const l of supplierWatchers) l.onChange([...source.suppliers.values()], fromServer);
      for (const l of ingredientWatchers) l.onChange([...source.ingredients.values()], fromServer);
      tellConfig();
      tellDraft();
      tellHistory();
      tellRequests();
    },

    emitHistory: () => tellHistory(),

    openListeners: () => supplierWatchers.size + ingredientWatchers.size + configWatchers.size + draftWatchers.size
      + historyWatchers.size + requestWatchers.size + priceWatchers.size,

    holdWrites() {
      held = [];
      return () => {
        const waiting = held ?? [];
        held = null;
        for (const run of waiting) run();
      };
    },
  };

  // `date >= from`, as the query asks: a record with no date (the legacy weekly one) is never in it.
  function historyFrom(from: string): StoredDoc[] {
    return [...source.records.entries()]
      .filter(([, r]) => typeof r.date === 'string' && r.date >= from)
      .map(([id, r]) => ({ ...structuredClone(r), id }));
  }
  function tellHistory() {
    for (const l of historyWatchers) l.onChange(historyFrom(l.from), historyMeta());
  }
  function historyMeta(): OrdersMeta {
    return { fromServer: !source.historyCached };
  }

  function tellConfig() {
    const doc = source.ordersConfig ? structuredClone(source.ordersConfig) : null;
    for (const l of configWatchers) l.onChange(doc, fromServer);
  }

  // A write already shown to the watchers settles a moment later (or when `holdWrites` lets it go): refused, it is taken back.
  function settleWrite(kind: keyof FakeOrdersSource['failDelivery'], takeBack: () => void): Promise<void> {
    const refused = source.failDelivery[kind];
    source.failDelivery[kind] = false;
    const settle = (resolve: () => void, reject: (err: unknown) => void) => {
      if (refused) {
        takeBack();
        reject(new Error('permission-denied'));
      } else resolve();
    };
    return new Promise<void>((resolve, reject) => {
      if (held) held.push(() => settle(resolve, reject));
      else queueMicrotask(() => settle(resolve, reject));
    });
  }

  // Newest first, by `createdAt`, as the query asks.
  function requestList(): StoredDoc[] {
    return [...source.requests.entries()]
      .map(([id, r]): StoredDoc => ({ ...structuredClone(r), id }))
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  }
  function tellRequests() {
    for (const l of requestWatchers) l.onChange(requestList(), { fromServer: !source.requestsCached });
  }
  function settleRequest(takeBack: () => void): Promise<void> {
    const refused = source.failRequest;
    source.failRequest = false;
    const settle = (resolve: () => void, reject: (err: unknown) => void) => {
      if (refused) {
        takeBack();
        reject(new Error('permission-denied'));
      } else resolve();
    };
    return new Promise<void>((resolve, reject) => {
      if (held) held.push(() => settle(resolve, reject));
      else queueMicrotask(() => settle(resolve, reject));
    });
  }

  function tellDraft() {
    const doc = source.draft ? structuredClone(source.draft) : null;
    for (const l of draftWatchers) l.onChange(doc, fromServer);
  }

  return source;
}
