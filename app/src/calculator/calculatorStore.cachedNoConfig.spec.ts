import { describe, expect, test, vi } from 'vitest';
import { calculatorEmptyReason } from '@mise/shared/calculator-config';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { createCalculatorStore } from './calculatorStore';

// Item 40 of docs/mise2-port-owed.md: the current app's d3eb57f3 and 3d98a3e4 (25 Oct 2026, the audit that reproduced it
// on the emulator). Mise 2 has these two guards BY DESIGN (calculatorSource.ts `watchConfig` reports `fromServer` from
// `includeMetadataChanges`; calculatorStore.ts `readConfig` ignores a cached «no document», `saveConfig` waits for the
// server, `applyConfig` keeps the same object for the same document) and its other specs pin each piece. This file pins
// the SCENARIO the audit found, end to end through the store, so the guard cannot be taken out by one piece alone:
//
//   offline, Firestore answers a configuration it never fetched on this phone with «does not exist», FROM ITS CACHE. If
//   that counted as the server's word, the empty Calculator would say «no recipes yet», saving would unlock over the
//   empty default, and the first Save once the signal came back would write an empty address book over the venue's.

const REAL = {
  clients: [{ id: 'c-real', name: 'A real client', products: [] }],
  recipes: [{ id: 'r1', name: 'Pizza', logic: 'orders', visible: true, order: 0, ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }] }],
  configRev: 7,
};

function setup(config: Record<string, unknown> | null) {
  const source = fakeCalculatorSource({ config });
  const store = createCalculatorStore(source, { marketOrderTitle: 'Market order' }, {
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    now: () => Date.UTC(2026, 9, 25, 12, 0, 0),
    newLogId: () => 'log-1',
    warn: vi.fn(),
  });
  return { source, store };
}

describe('a cached «no configuration» is never taken for the server\'s answer', () => {
  test('⚠️ the screen stays on «Loading…», not «no recipes yet», until the server speaks', () => {
    const { source, store } = setup(null);
    source.hold();
    store.start();
    source.push({ fromServer: false });
    const snap = store.getSnapshot();
    expect(snap.configAnswered).toBe(false);
    expect(calculatorEmptyReason(snap.config, snap.configAnswered)).toBe('loading');
  });

  test('⚠️ and saving stays locked: the empty default is kept on the device, never sent over the real address book', async () => {
    const { source, store } = setup(null);
    source.hold();
    store.start();
    source.push({ fromServer: false });
    await expect(store.saveConfig({ clients: [], recipes: [] } as never)).resolves.toEqual({ synced: false, reason: 'no-server-answer' });
    expect(source.savedConfigs).toHaveLength(0);
  });

  test('the server\'s own «no document» still arrives afterwards (a brand-new venue must not wait for ever) and unlocks saving', async () => {
    const { source, store } = setup(null);
    source.hold();
    store.start();
    source.push({ fromServer: false });
    source.push({ fromServer: true });
    const snap = store.getSnapshot();
    expect(snap.configAnswered).toBe(true);
    expect(calculatorEmptyReason(snap.config, snap.configAnswered)).toBe('no-recipes');
    await expect(store.saveConfig({ clients: [{ id: 'c-first', name: 'First', products: [] }], recipes: [] } as never)).resolves.toMatchObject({ synced: true });
    expect(source.savedConfigs).toHaveLength(1);
  });

  test('going offline after the server answered neither locks saving nor wipes the copy on screen', async () => {
    const { source, store } = setup(REAL);
    store.start();
    source.config = null; // what the browser's own database says after the connection drops
    source.push({ fromServer: false });
    const snap = store.getSnapshot();
    expect(snap.config.clients[0]?.id).toBe('c-real');
    expect(snap.configFromServer).toBe(true);
  });

  test('a cached document that exists is believed for the screen, but is not enough to write', async () => {
    const { source, store } = setup(REAL);
    source.hold();
    store.start();
    source.push({ fromServer: false });
    expect(store.getSnapshot().configAnswered).toBe(true);
    await expect(store.saveConfig(REAL as never)).resolves.toEqual({ synced: false, reason: 'no-server-answer' });
    expect(source.savedConfigs).toHaveLength(0);
  });

  test('⚠️ the same document sent again (the server confirming the cache, offline, back online) draws nothing', () => {
    const { source, store } = setup(REAL);
    store.start();
    const before = store.getSnapshot();
    source.push({ fromServer: false });
    source.push({ fromServer: true });
    source.push({ fromServer: false });
    // The SAME object: a new one reads as «the configuration changed» to every screen, and the full-screen recipe closes.
    expect(store.getSnapshot().config).toBe(before.config);
    // A real change from another phone is still drawn.
    source.config = { ...REAL, configRev: 8, clients: [{ id: 'c-other', name: 'Another phone added me', products: [] }] };
    source.push({ fromServer: true });
    expect(store.getSnapshot().config).not.toBe(before.config);
    expect(store.getSnapshot().config.clients[0]?.id).toBe('c-other');
  });
});
