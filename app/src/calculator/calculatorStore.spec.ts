import { describe, expect, test, vi } from 'vitest';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import type { StoredDoc } from './calculatorSource';
import { CONFIG_KEY, LOGS_KEY, LOG_WINDOW_DAYS, MAX_LOG_VERSIONS, createCalculatorStore, genLogId } from './calculatorStore';
import type { CalculatorDeps, CalculatorMessage, DoughConfirm } from './calculatorStore';

// The Calculator's store against an in-memory source: what the work view shows before and after the
// database answers, and what a Confirm writes. The traps are the current app's (js/calculator-config-store.js,
// js/log-store.js, js/calculator-catalogue-link.js) plus the Pastries' one: the browser's own database can
// answer «nothing» only because this phone never synced it.

const NOW = Date.UTC(2026, 9, 12, 10, 0, 0);
const CONFIG = { clients: [], recipes: [{ id: 'r1', name: 'Pizza', catalogueId: 'cat-1', ingredients: [] }] };

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function setup(seed: Parameters<typeof fakeCalculatorSource>[0] = {}, storageSeed: Record<string, string> = {}) {
  const source = fakeCalculatorSource(seed);
  const storage = memoryStorage(storageSeed);
  let ids = 0;
  const deps: CalculatorDeps = {
    storage,
    now: () => NOW,
    newLogId: () => `log-${++ids}`,
    warn: vi.fn(),
  };
  const store = createCalculatorStore(source, { marketOrderTitle: 'Market order' }, deps);
  const messages: CalculatorMessage[] = [];
  store.onMessage(message => messages.push(message));
  return { source, storage, deps, store, messages };
}

function confirm(over: Partial<DoughConfirm> = {}): DoughConfirm {
  return {
    linkedLogId: null,
    dough: 'Pizza',
    recipeId: 'r1',
    forDay: 'today',
    version: { calculatedBy: '', at: { date: 'Monday 12 October', time: '12:00 PM' }, items: [], occasional: [] },
    ...over,
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the configuration', () => {
  test('paints at once from the local copy, before the database answers — and says «not answered»', () => {
    const { store, source } = setup({ config: CONFIG }, { [CONFIG_KEY]: JSON.stringify(CONFIG) });
    source.hold();
    store.start();
    const snap = store.getSnapshot();
    expect(snap.config.recipes.map(r => r.name)).toEqual(['Pizza']);
    expect(snap.configAnswered).toBe(false);
  });

  test('the server\'s document replaces it and is kept as the local copy (the current app\'s key)', () => {
    const { store, storage } = setup({ config: CONFIG });
    store.start();
    const snap = store.getSnapshot();
    expect(snap.configAnswered).toBe(true);
    expect(snap.config.recipes.map(r => r.name)).toEqual(['Pizza']);
    expect(JSON.parse(storage.data.get(CONFIG_KEY)!).recipes[0].name).toBe('Pizza');
  });

  test('⚠️ the server\'s «there is no document» IS an answer: a brand-new venue must not say «Loading…» for ever', () => {
    const { store } = setup({ config: null });
    store.start();
    expect(store.getSnapshot().configAnswered).toBe(true);
  });

  test('⚠️ a CACHED «there is no document» is not an answer (the phone may never have synced it)', () => {
    const { store, source } = setup({ config: null });
    source.hold();
    store.start();
    source.push({ fromServer: false });
    expect(store.getSnapshot().configAnswered).toBe(false);
    source.push({ fromServer: true });
    expect(store.getSnapshot().configAnswered).toBe(true);
  });

  test('a cached DOCUMENT is an answer: it is the venue\'s real data, read from the server once', () => {
    const { store, source } = setup({ config: CONFIG });
    source.hold();
    store.start();
    source.push({ fromServer: false });
    expect(store.getSnapshot().configAnswered).toBe(true);
  });

  test('⚠️ an answer that changes only the metadata keeps the SAME config and linked objects', () => {
    const { store, source } = setup({ config: CONFIG, recipes: [{ id: 'cat-1', name: 'Pizza dough' }] });
    store.start();
    const before = store.getSnapshot();
    source.push({ fromServer: false }); // the connection dropped
    source.push({ fromServer: true }); // and came back
    expect(store.getSnapshot().config).toBe(before.config);
    expect(store.getSnapshot().linked).toBe(before.linked);
  });

  test('the first answer equal to the local copy is still news: it is the answer', () => {
    const { store, source } = setup({ config: CONFIG }, { [CONFIG_KEY]: JSON.stringify(CONFIG) });
    source.hold();
    store.start();
    const before = store.getSnapshot();
    source.release();
    expect(store.getSnapshot().configAnswered).toBe(true);
    expect(store.getSnapshot().config).toBe(before.config);
  });

  test('a later «no document» (deleted) keeps what is on screen', () => {
    const { store, source } = setup({ config: CONFIG });
    store.start();
    source.config = null;
    source.push();
    expect(store.getSnapshot().config.recipes.map(r => r.name)).toEqual(['Pizza']);
  });

  test('a refused stream is said, and the screen can tell «could not load» from «loading»', () => {
    const { store, source, messages } = setup({ config: CONFIG });
    source.refuse.config = true;
    store.start();
    expect(store.getSnapshot().configFailed).toBe(true);
    expect(store.getSnapshot().configAnswered).toBe(false);
    expect(messages).toContainEqual({ kind: 'config-stream-broken' });
  });

  test('a corrupt local copy reads as the empty default, never as a crash', () => {
    const { store } = setup({}, { [CONFIG_KEY]: '{not json' });
    expect(store.getSnapshot().config.recipes).toEqual([]);
  });
});

describe('linked catalogue recipes', () => {
  test('⚠️ each linked recipe is watched one by one, and only while the section is open (P14)', () => {
    const { store, source } = setup({ config: CONFIG, recipes: [{ id: 'cat-1', name: 'Pizza dough' }] });
    store.start();
    expect(source.watchedRecipes()).toEqual(['cat-1']);
    expect(store.getSnapshot().linked['cat-1']).toMatchObject({ name: 'Pizza dough' });
    store.stop();
    expect(source.watchedRecipes()).toEqual([]);
  });

  test('⚠️ «not answered yet» (missing key) and «gone» (null) are two different answers', () => {
    const { store, source } = setup({ config: CONFIG });
    source.hold();
    store.start();
    source.push({ fromServer: true });
    expect(store.getSnapshot().linked).toEqual({ 'cat-1': null });
  });

  test('⚠️ a CACHED «missing» is not shown as «the recipe was deleted»', () => {
    const { store, source } = setup({ config: CONFIG }, { [CONFIG_KEY]: JSON.stringify(CONFIG) });
    source.hold();
    store.start();
    source.push({ fromServer: false });
    expect('cat-1' in store.getSnapshot().linked).toBe(false);
  });

  test('a recipe no tab points at any more stops being watched and leaves the snapshot', () => {
    const { store, source } = setup({ config: CONFIG, recipes: [{ id: 'cat-1', name: 'Pizza dough' }] });
    store.start();
    source.config = { clients: [], recipes: [{ id: 'r1', name: 'Pizza', ingredients: [] }] };
    source.push();
    expect(source.watchedRecipes()).toEqual([]);
    expect(store.getSnapshot().linked).toEqual({});
  });
});

const old: StoredDoc = { id: 'log-old', dough: 'Pizza', createdAtMs: NOW - 1000, versions: [{ kind: 'create' }] };

describe('the logs', () => {
  test(`are read for the last ${LOG_WINDOW_DAYS} days only`, () => {
    const { store, source } = setup({
      logs: [old, { id: 'log-ancient', dough: 'Pizza', createdAtMs: NOW - (LOG_WINDOW_DAYS + 1) * 86_400_000 }],
    });
    store.start();
    expect(store.getSnapshot().logs.map(l => l.id)).toEqual(['log-old']);
    expect(source.logs.size).toBe(2);
  });

  test('⚠️ an EMPTY cached answer is not believed over a local copy that had logs', () => {
    const { store, source } = setup({ logs: [] }, { [LOGS_KEY]: JSON.stringify([old]) });
    source.hold();
    store.start();
    expect(store.getSnapshot().logsLoaded).toBe(true);
    source.push({ fromServer: false });
    expect(store.getSnapshot().logs.map(l => l.id)).toEqual(['log-old']);
    source.push({ fromServer: true });
    expect(store.getSnapshot().logs).toEqual([]);
  });

  test('with no local copy, the logs are «not loaded» until an answer comes', () => {
    const { store, source } = setup({ logs: [old] });
    source.hold();
    store.start();
    expect(store.getSnapshot().logsLoaded).toBe(false);
    source.release();
    expect(store.getSnapshot().logsLoaded).toBe(true);
  });

  test('a dead logs stream keeps the local copy as the best guess, and is said', () => {
    const { store, source, messages } = setup({}, { [LOGS_KEY]: JSON.stringify([old]) });
    source.refuse.logs = true;
    store.start();
    expect(store.getSnapshot().logs.map(l => l.id)).toEqual(['log-old']);
    expect(store.getSnapshot().logsLoaded).toBe(true);
    expect(messages).toContainEqual({ kind: 'logs-stream-broken' });
  });
});

describe('confirming a dough', () => {
  test('a tab with no log CREATES one, local-first, stamped as from the Calculator', async () => {
    const { store, source, storage } = setup({ config: CONFIG });
    source.holdSaves();
    store.start();
    const result = store.confirmDough(confirm());
    expect(result).toEqual({ logId: 'log-1', target: 'create' });
    // Shown and kept on this phone before the database has it.
    expect(store.getSnapshot().logs.map(l => l.id)).toEqual(['log-1']);
    expect(store.getSnapshot().unsent).toBe(true);
    expect(JSON.parse(storage.data.get(LOGS_KEY)!)[0].id).toBe('log-1');
    expect(source.saved[0]).toMatchObject({ id: 'log-1', dough: 'Pizza', origin: 'calculator', createdAtMs: NOW, forDay: 'today' });
    expect((source.saved[0]!.versions as { kind: string }[])[0]!.kind).toBe('create');
    source.settleSaves();
    await flush();
    expect(store.getSnapshot().unsent).toBe(false);
    expect(store.getSnapshot().logs.map(l => l.id)).toEqual(['log-1']);
  });

  test('⚠️ the tab\'s log still there → a new VERSION of it, never a second log', () => {
    const { store, source } = setup({ config: CONFIG, logs: [old] });
    store.start();
    const result = store.confirmDough(confirm({ linkedLogId: 'log-old', forDay: 'tomorrow' }));
    expect(result).toEqual({ logId: 'log-old', target: 'update' });
    const written = source.saved[0]!;
    expect(written.id).toBe('log-old');
    expect(written.forDay).toBe('tomorrow');
    expect((written.versions as { kind: string }[]).map(v => v.kind)).toEqual(['create', 'edit']);
  });

  test('⚠️ two Confirms before the database answers: the second is a version of the FIRST log', () => {
    const { store, source } = setup({ config: CONFIG });
    source.holdSaves();
    store.start();
    const first = store.confirmDough(confirm())!;
    const second = store.confirmDough(confirm({ linkedLogId: first.logId }))!;
    expect(second).toEqual({ logId: first.logId, target: 'update' });
    expect(store.getSnapshot().logs).toHaveLength(1);
  });

  test('⚠️ a dead logs stream: a SAVED log stays in the list, so the next Confirm is a version, not a second log', async () => {
    const { store, source, storage } = setup({ config: CONFIG });
    source.refuse.logs = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store.start();
    const first = store.confirmDough(confirm())!;
    await flush();
    expect(store.getSnapshot().unsent).toBe(false);
    expect(store.getSnapshot().logs.map(l => l.id)).toEqual([first.logId]);
    expect(JSON.parse(storage.data.get(LOGS_KEY)!).map((l: { id: string }) => l.id)).toEqual([first.logId]);
    expect(store.confirmDough(confirm({ linkedLogId: first.logId }))).toEqual({ logId: first.logId, target: 'update' });
  });

  test('the tab\'s log deleted elsewhere → a fresh log (confirmTarget)', () => {
    const { store } = setup({ config: CONFIG, logs: [] });
    store.start();
    expect(store.confirmDough(confirm({ linkedLogId: 'log-gone' }))).toEqual({ logId: 'log-1', target: 'create' });
  });

  test(`⚠️ a log already at ${MAX_LOG_VERSIONS} versions is not written again (the rules would refuse every write)`, () => {
    const full: StoredDoc = { ...old, versions: Array.from({ length: MAX_LOG_VERSIONS }, () => ({ kind: 'edit' })) };
    const { store, source, messages } = setup({ config: CONFIG, logs: [full] });
    store.start();
    expect(store.confirmDough(confirm({ linkedLogId: 'log-old' }))).toBeNull();
    expect(source.saved).toEqual([]);
    expect(messages).toContainEqual({ kind: 'log-full', dough: 'Pizza' });
  });

  test('⚠️ a write the database REFUSES is said out loud, and the screen shows what the server holds', async () => {
    const { store, source, messages } = setup({ config: CONFIG });
    source.refuse.save = true;
    store.start();
    store.confirmDough(confirm());
    await flush();
    expect(messages).toContainEqual({ kind: 'log-not-saved', dough: 'Pizza' });
    expect(store.getSnapshot().logs).toEqual([]);
    expect(store.getSnapshot().unsent).toBe(false);
  });

  test('an older write answering late does not drop a newer version the stream has not shown yet', async () => {
    const { store, source } = setup({ config: CONFIG });
    let releaseFirst: () => void = () => {};
    source.saveLog = () => new Promise<void>(resolve => { releaseFirst = resolve; });
    source.appendLogVersion = () => new Promise<void>(() => {}); // the second never answers (offline)
    store.start();
    const first = store.confirmDough(confirm())!;
    store.confirmDough(confirm({ linkedLogId: first.logId }));
    releaseFirst();
    await flush();
    const log = store.getSnapshot().logs.find(l => l.id === first.logId)!;
    expect(log.versions).toHaveLength(2);
  });

  test('a screen listener that throws never stops the data', () => {
    const { store, deps } = setup({ config: CONFIG });
    store.subscribe(() => { throw new Error('screen bug'); });
    store.start();
    expect(store.getSnapshot().configAnswered).toBe(true);
    expect(deps.warn).toHaveBeenCalled();
  });
});

describe('start and stop', () => {
  test('start → stop → start (React\'s development mode) leaves one set of listeners', () => {
    const { store, source } = setup({ config: CONFIG });
    store.start();
    store.stop();
    store.start();
    expect(source.watchedRecipes()).toEqual(['cat-1']);
  });
});

describe('genLogId', () => {
  test('log-<uuid>, or log-<time36>-<random> without crypto.randomUUID (js/log-store.js)', () => {
    expect(genLogId(() => 'abc')).toBe('log-abc');
    expect(genLogId(undefined, 36 ** 3, () => 0.5)).toMatch(/^log-1000-[0-9a-z]+$/);
  });
});

// ── Step 3c-2: saving the configuration (js/calculator-config-store.js `saveConfig`) ──

describe('saving the configuration', () => {
  const EDITED = { ...CONFIG, recipes: [{ id: 'r1', name: 'Pizza bianca', ingredients: [] }] };
  const names = (store: { getSnapshot(): { config: { recipes: { name: string }[] } } }) =>
    store.getSnapshot().config.recipes.map(r => r.name);

  test('local-first: the screen and the local copy change at once, then it reaches the database', async () => {
    const { store, source, storage } = setup({ config: CONFIG });
    store.start();
    const saving = store.saveConfig(EDITED as never);
    expect(names(store)).toEqual(['Pizza bianca']);
    expect(JSON.parse(storage.data.get(CONFIG_KEY)!).recipes[0].name).toBe('Pizza bianca');
    await expect(saving).resolves.toEqual({ synced: true });
    expect(source.savedConfigs).toHaveLength(1);
    expect((source.config as { configRev: number }).configRev).toBe(1);
    expect(names(store)).toEqual(['Pizza bianca']);
  });

  test('⚠️ NOTHING is sent before the database has answered once: the empty default must never overwrite a venue', async () => {
    const { store, source } = setup({ config: CONFIG });
    source.hold();
    store.start();
    await expect(store.saveConfig(EDITED as never)).resolves.toEqual({ synced: false, reason: 'no-server-answer' });
    expect(source.savedConfigs).toHaveLength(0);
    // Kept on this device, as the current app does; the screen says so.
    expect(names(store)).toEqual(['Pizza bianca']);
  });

  test('⚠️ the server\'s «there is no document» IS an answer: a brand-new venue saves its first client', async () => {
    const { store, source } = setup({ config: null });
    store.start();
    await expect(store.saveConfig(EDITED as never)).resolves.toEqual({ synced: true });
    expect(source.savedConfigs).toHaveLength(1);
  });

  test('⚠️ a refused write is TAKEN BACK here too, and says why (permission-denied = this app is out of date)', async () => {
    const { store, source, storage } = setup({ config: CONFIG });
    store.start();
    source.refuse.configSave = true;
    await expect(store.saveConfig(EDITED as never)).resolves.toEqual({ synced: false, reason: 'write-failed', code: 'permission-denied' });
    expect(names(store)).toEqual(['Pizza']);
    expect(JSON.parse(storage.data.get(CONFIG_KEY)!).recipes[0].name).toBe('Pizza');
  });

  test('a failure without a code reads as a connection failure (code null)', async () => {
    const { store, source } = setup({ config: CONFIG });
    store.start();
    source.saveConfig = () => Promise.reject(new Error('offline'));
    await expect(store.saveConfig(EDITED as never)).resolves.toEqual({ synced: false, reason: 'write-failed', code: null });
  });

  test('a failed save does not take back a NEWER save made meanwhile', async () => {
    const { store, source } = setup({ config: CONFIG });
    store.start();
    let failFirst: (err: unknown) => void = () => {};
    const real = source.saveConfig.bind(source);
    source.saveConfig = (config) => {
      if (source.savedConfigs.length === 0) {
        source.savedConfigs.push({});
        return new Promise<number>((_resolve, reject) => { failFirst = reject; });
      }
      return real(config);
    };
    const first = store.saveConfig(EDITED as never);
    const NEWER = { ...CONFIG, recipes: [{ id: 'r1', name: 'Pizza rossa', ingredients: [] }] };
    await store.saveConfig(NEWER as never);
    failFirst(Object.assign(new Error('x'), { code: 'unavailable' }));
    await first;
    expect(names(store)).toEqual(['Pizza rossa']);
  });

  test('⚠️ while a save is in the air, the stream\'s OLD document (a connection blip) does not put the old settings back', async () => {
    const { store, source } = setup({ config: CONFIG });
    store.start();
    source.holdConfigSaves();
    const saving = store.saveConfig(EDITED as never);
    expect(store.getSnapshot().unsent).toBe(true);
    source.push({ fromServer: false }); // the metadata changed: the same old document again
    expect(names(store)).toEqual(['Pizza bianca']);
    source.settleConfigSaves();
    await saving;
    expect(names(store)).toEqual(['Pizza bianca']);
    expect(store.getSnapshot().unsent).toBe(false);
  });

  test('a document older than the revision this phone wrote is held until the newer one arrives', async () => {
    const { store, source } = setup({ config: { ...CONFIG, configRev: 4 } });
    store.start();
    await store.saveConfig(EDITED as never); // writes revision 5
    source.config = { ...CONFIG, configRev: 4 }; // a late echo of the old document
    source.push();
    expect(names(store)).toEqual(['Pizza bianca']);
    source.config = { ...CONFIG, recipes: [{ id: 'r1', name: 'Another phone', ingredients: [] }], configRev: 6 };
    source.push();
    expect(names(store)).toEqual(['Another phone']);
  });

  test('a refused save shows the server\'s newest document if one arrived meanwhile', async () => {
    const { store, source } = setup({ config: CONFIG });
    store.start();
    source.holdConfigSaves();
    source.refuse.configSave = true;
    const saving = store.saveConfig(EDITED as never);
    source.config = { ...CONFIG, recipes: [{ id: 'r1', name: 'Another phone', ingredients: [] }], configRev: 3 };
    source.push();
    expect(names(store)).toEqual(['Pizza bianca']);
    source.settleConfigSaves();
    await saving;
    expect(names(store)).toEqual(['Another phone']);
  });

  test('saving a link starts watching the newly linked catalogue recipe', async () => {
    const { store, source } = setup({ config: { clients: [], recipes: [] }, recipes: [{ id: 'cat-9', name: 'Bread', ingredients: [] }] });
    store.start();
    await store.saveConfig({ clients: [], recipes: [{ id: 'x', name: 'Bread', catalogueId: 'cat-9', ingredients: [] }] } as never);
    expect(source.watchedRecipes()).toContain('cat-9');
  });
});

describe('the link picker', () => {
  test('reads the catalogue only when asked, and the stamp reaches the recipe', async () => {
    const { store, source } = setup({ config: CONFIG, recipes: [{ id: 'cat-1', name: 'Pizza', ingredients: [{ label: 'Flour' }] }] });
    store.start();
    expect(source.catalogueReads()).toBe(0);
    const list = await store.listCatalogueRecipes();
    expect(list.map(r => r.id)).toEqual(['cat-1']);
    expect(source.catalogueReads()).toBe(1);
    const rows = await store.stampRowIds('cat-1') as { rid: string; label: string }[];
    expect(rows.map(r => r.label)).toEqual(['Flour']);
    expect(source.stamps).toEqual([{ id: 'cat-1', ingredients: rows }]);
  });

  test('a refused read or stamp rejects (the picker says so and links nothing)', async () => {
    const { store, source } = setup({ config: CONFIG });
    store.start();
    source.refuse.catalogue = true;
    source.refuse.stamp = true;
    await expect(store.listCatalogueRecipes()).rejects.toBeTruthy();
    await expect(store.stampRowIds('cat-1')).rejects.toBeTruthy();
  });
});

describe('the review fixes of 3c-2', () => {
  test('⚠️ a document from the browser\'s own database paints the screen but is NOT enough to write: nothing is sent', async () => {
    const { store, source } = setup({ config: CONFIG });
    source.hold();
    store.start();
    // Yesterday's copy, from the browser's database (a tablet reopening on the Clients editor).
    source.config = { ...CONFIG, configRev: 2 };
    source.push({ fromServer: false });
    expect(store.getSnapshot().configAnswered).toBe(true);
    expect(store.getSnapshot().configFromServer).toBe(false);
    await expect(store.saveConfig({ clients: [], recipes: [] } as never)).resolves.toEqual({ synced: false, reason: 'no-server-answer' });
    expect(source.savedConfigs).toHaveLength(0);
  });

  test('the first SERVER answer is news even when it equals the cached one (an editor is waiting for it)', () => {
    const { store, source } = setup({ config: CONFIG });
    source.hold();
    store.start();
    source.push({ fromServer: false });
    const before = store.getSnapshot();
    source.push({ fromServer: true });
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.configFromServer).toBe(true);
    expect(after.config).toBe(before.config);
  });

  test('the server\'s «no document» counts as a server answer too', () => {
    const { store } = setup({ config: null });
    store.start();
    expect(store.getSnapshot().configFromServer).toBe(true);
  });

  test('⚠️ after a save the copy carries the revision it was written as — with a dead stream, a deleted import stays deleted', async () => {
    const { store, source } = setup({ config: { clients: [], recipes: [{ id: 'own', name: 'Own' }, { id: 'cat-x', name: 'Imported' }], configRev: 3 } });
    store.start();
    // No echo of the save reaches the store (as with a dead stream): only the save's own answer.
    source.refuse.config = true;
    await store.saveConfig({ clients: [], recipes: [{ id: 'own', name: 'Own 2' }, { id: 'cat-x', name: 'Imported' }], configRev: 3 } as never);
    expect(store.getSnapshot().config.configRev).toBe(4);
    // The person deletes the imported recipe and saves again: it must not come back.
    await store.saveConfig({ ...store.getSnapshot().config, recipes: [{ id: 'own', name: 'Own 2' }] } as never);
    expect((source.config as { recipes: { id: string }[] }).recipes.map(r => r.id)).toEqual(['own']);
  });
});

describe('the Dough history (step 3c-3)', () => {
  const at = { date: 'Monday 12 October', time: '12:00 PM' };
  const version = { calculatedBy: '', at, items: [], occasional: [] };
  const two: StoredDoc = {
    id: 'log-two', dough: 'Pizza', recipeId: 'r1', forDay: 'today', origin: 'manual', createdAtMs: NOW - 500,
    versions: [{ kind: 'create', calculatedBy: 'Ann', at, text: 'first' }, { kind: 'edit', calculatedBy: 'Bo', at, text: 'second' }],
  };

  test('«Add log» makes a NEW log marked manual, at once, and sends it', () => {
    const { store, source } = setup({ config: CONFIG });
    store.start();
    const id = store.addLog({ dough: 'Pizza', recipeId: 'r1', forDay: 'tomorrow', version });
    const log = store.getSnapshot().logs.find(l => l.id === id)!;
    expect(log.origin).toBe('manual');
    expect(log.forDay).toBe('tomorrow');
    expect(log.createdAtMs).toBe(NOW);
    expect(log.versions).toHaveLength(1);
    expect(log.versions[0]!.kind).toBe('create');
    expect(source.saved.map(doc => doc.id)).toEqual([id]);
  });

  test('an edit appends an `edit` version and keeps every earlier one', () => {
    const { store, source } = setup({ config: CONFIG, logs: [two] });
    store.start();
    expect(store.editLog('log-two', { ...version, calculatedBy: 'Cy', text: 'third' })).toBe('saved');
    const log = store.getSnapshot().logs.find(l => l.id === 'log-two')!;
    expect(log.versions.map(v => v.text)).toEqual(['first', 'second', 'third']);
    expect(log.versions[2]!.kind).toBe('edit');
    expect(source.saved).toHaveLength(1);
  });

  test('a restore appends a COPY of the chosen version on top — the history is never truncated', () => {
    const { store, source } = setup({ config: CONFIG, logs: [two] });
    store.start();
    expect(store.restoreLog('log-two', 0, { calculatedBy: 'Di', at })).toBe('saved');
    const log = store.getSnapshot().logs.find(l => l.id === 'log-two')!;
    expect(log.versions.map(v => v.text)).toEqual(['first', 'second', 'first']);
    expect(log.versions[2]).toMatchObject({ kind: 'restore', restoredFrom: 0, calculatedBy: 'Di' });
    expect(source.saved).toHaveLength(1);
  });

  test('a restore of a version that does not exist writes nothing', () => {
    const { store, source } = setup({ config: CONFIG, logs: [two] });
    store.start();
    expect(store.restoreLog('log-two', 2, { calculatedBy: '', at })).toBe('missing');
    expect(store.restoreLog('log-two', -1, { calculatedBy: '', at })).toBe('missing');
    expect(store.restoreLog('log-two', 0.5, { calculatedBy: '', at })).toBe('missing');
    expect(source.saved).toEqual([]);
  });

  test('an edit or a restore of a log not in the list writes nothing', () => {
    const { store, source } = setup({ config: CONFIG });
    store.start();
    expect(store.editLog('log-nope', version)).toBe('missing');
    expect(store.restoreLog('log-nope', 0, { calculatedBy: '', at })).toBe('missing');
    expect(source.saved).toEqual([]);
  });

  test('⚠️ a full log takes no edit and no restore, and says so without speaking of Reset', () => {
    const full: StoredDoc = { ...two, versions: Array.from({ length: MAX_LOG_VERSIONS }, () => ({ kind: 'edit' })) };
    const { store, source, messages } = setup({ config: CONFIG, logs: [full] });
    store.start();
    expect(store.editLog('log-two', version)).toBe('full');
    expect(store.restoreLog('log-two', 0, { calculatedBy: '', at })).toBe('full');
    expect(source.saved).toEqual([]);
    expect(messages).toEqual([
      { kind: 'log-history-full', dough: 'Pizza' },
      { kind: 'log-history-full', dough: 'Pizza' },
    ]);
  });

  test('a delete takes the log out at once — the list and the local copy — and sends it', () => {
    const { store, source, storage } = setup({ config: CONFIG, logs: [two, old] });
    store.start();
    store.deleteLog('log-two');
    expect(store.getSnapshot().logs.map(l => l.id)).toEqual(['log-old']);
    expect(JSON.parse(storage.data.get(LOGS_KEY)!).map((l: { id: string }) => l.id)).toEqual(['log-old']);
    expect(source.deletedIds).toEqual(['log-two']);
  });

  test('⚠️ offline, the deleted log stays gone while the delete waits — even when the stream still holds it', async () => {
    const { store, source } = setup({ config: CONFIG, logs: [two] });
    source.holdSaves();
    store.start();
    store.deleteLog('log-two');
    expect(store.getSnapshot().unsent).toBe(true);
    source.push({ fromServer: false });
    expect(store.getSnapshot().logs).toEqual([]);
    source.settleSaves();
    await flush();
    expect(store.getSnapshot().logs).toEqual([]);
    expect(store.getSnapshot().unsent).toBe(false);
  });

  test('⚠️ a delete the database REFUSES brings the log back and says so', async () => {
    const { store, source, messages } = setup({ config: CONFIG, logs: [two] });
    source.refuse.remove = true;
    store.start();
    store.deleteLog('log-two');
    expect(store.getSnapshot().logs).toEqual([]);
    await flush();
    expect(store.getSnapshot().logs.map(l => l.id)).toEqual(['log-two']);
    expect(store.getSnapshot().unsent).toBe(false);
    expect(messages).toContainEqual({ kind: 'log-not-deleted', dough: 'Pizza' });
  });

  test('⚠️ a log whose delete is STILL WAITING stays gone when its own write lands and the stream shows it', async () => {
    const { store, source } = setup({ config: CONFIG });
    let landWrite: () => void = () => {};
    source.saveLog = log => new Promise<void>(resolve => {
      landWrite = () => {
        source.logs.set(log.id, { ...log } as StoredDoc);
        source.push();
        resolve();
      };
    });
    // The delete never answers (offline): the log must not be shown again meanwhile.
    source.deleteLog = () => new Promise<void>(() => {});
    store.start();
    const id = store.addLog({ dough: 'Pizza', recipeId: 'r1', forDay: 'today', version });
    store.deleteLog(id);
    await flush();
    landWrite();
    await flush();
    expect(source.logs.has(id)).toBe(true);
    expect(store.getSnapshot().logs).toEqual([]);
  });

  test('⚠️ a log whose delete has already finished does not come back when its own write answers', async () => {
    const { store, source } = setup({ config: CONFIG });
    let landWrite: () => void = () => {};
    source.saveLog = () => new Promise<void>(resolve => { landWrite = resolve; });
    store.start();
    const id = store.addLog({ dough: 'Pizza', recipeId: 'r1', forDay: 'today', version });
    store.deleteLog(id);
    await flush();
    landWrite();
    await flush();
    expect(store.getSnapshot().logs).toEqual([]);
  });

  test('a tab locked to a deleted log confirms into a NEW log', () => {
    const { store } = setup({ config: CONFIG, logs: [old] });
    store.start();
    store.deleteLog('log-old');
    expect(store.confirmDough(confirm({ linkedLogId: 'log-old' }))).toEqual({ logId: 'log-1', target: 'create' });
  });

  test('a history write the database refuses is said in the history\'s own words', async () => {
    const { store, source, messages } = setup({ config: CONFIG, logs: [two] });
    source.refuse.save = true;
    store.start();
    store.editLog('log-two', version);
    store.addLog({ dough: 'Focaccia', recipeId: 'r1', forDay: 'today', version });
    await flush();
    expect(messages).toEqual([
      { kind: 'log-history-not-saved', dough: 'Pizza' },
      { kind: 'log-history-not-saved', dough: 'Focaccia' },
    ]);
  });

  test('an edit of a log being deleted writes nothing', () => {
    const { store, source } = setup({ config: CONFIG, logs: [two] });
    source.holdSaves();
    store.start();
    store.deleteLog('log-two');
    expect(store.editLog('log-two', version)).toBe('missing');
    expect(source.saved).toEqual([]);
  });
});

describe('a new version is ADDED to the server\'s chain, never written over it (review of 3c-3)', () => {
  const at = { date: 'Monday 12 October', time: '12:00 PM' };
  const base: StoredDoc = {
    id: 'log-x', dough: 'Pizza', recipeId: 'r1', forDay: 'today', origin: 'manual', createdAtMs: NOW - 500,
    versions: [{ kind: 'create', at, text: 'v1' }],
  };

  test('⚠️ another phone\'s version added meanwhile survives this phone\'s edit', async () => {
    const { store, source } = setup({ config: CONFIG, logs: [base] });
    store.start();
    // Another phone appends v2 on the server; this phone's stream has not shown it yet.
    source.logs.set('log-x', { ...base, versions: [...(base.versions as unknown[]), { kind: 'edit', at, text: 'theirs' }] });
    expect(store.editLog('log-x', { calculatedBy: '', at, text: 'mine' })).toBe('saved');
    await flush();
    expect((source.logs.get('log-x')!.versions as { text: string }[]).map(v => v.text)).toEqual(['v1', 'theirs', 'mine']);
    expect(source.appended.map(a => (a.version as { text: string }).text)).toEqual(['mine']);
    // The stream then shows the server's chain.
    expect(store.getSnapshot().logs.find(l => l.id === 'log-x')!.versions.map(v => v.text)).toEqual(['v1', 'theirs', 'mine']);
  });

  test('⚠️ a log another phone deleted is NOT recreated by an edit or a restore: refused, and said', async () => {
    const { store, source, messages } = setup({ config: CONFIG, logs: [base] });
    store.start();
    source.logs.delete('log-x'); // gone on the server; this phone still shows it
    store.editLog('log-x', { calculatedBy: '', at, text: 'mine' });
    store.restoreLog('log-x', 0, { calculatedBy: '', at });
    await flush();
    expect(source.logs.has('log-x')).toBe(false);
    expect(source.saved).toEqual([]);
    expect(messages.filter(m => m.kind === 'log-history-not-saved')).toHaveLength(2);
  });

  test('a re-Confirm adds its version and moves the day, without sending the chain', async () => {
    const { store, source } = setup({ config: CONFIG, logs: [base] });
    store.start();
    store.confirmDough(confirm({ linkedLogId: 'log-x', forDay: 'tomorrow' }));
    await flush();
    expect(source.appended).toHaveLength(1);
    expect(source.appended[0]).toMatchObject({ id: 'log-x', forDay: 'tomorrow' });
    expect(source.logs.get('log-x')!.forDay).toBe('tomorrow');
  });

  test('offline, two edits in a row are both added, in order', async () => {
    const { store, source } = setup({ config: CONFIG, logs: [base] });
    source.holdSaves();
    store.start();
    store.editLog('log-x', { calculatedBy: '', at, text: 'a' });
    store.editLog('log-x', { calculatedBy: '', at, text: 'b' });
    expect(store.getSnapshot().logs.find(l => l.id === 'log-x')!.versions.map(v => v.text)).toEqual(['v1', 'a', 'b']);
    source.settleSaves();
    await flush();
    expect((source.logs.get('log-x')!.versions as { text: string }[]).map(v => v.text)).toEqual(['v1', 'a', 'b']);
  });
});
