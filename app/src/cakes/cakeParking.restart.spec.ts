import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cake } from '@mise/shared/cake-model';
import { UNSAVED_CAKES_KEY, flushRemembered, readParkedCake, rememberCake } from './cakeParking';
import type { ParkedCake } from './cakeParking';

// After a restart: a module with an EMPTY shelf and the device's storage as it was left. (Its own file: resetting the modules would hand the
// specs that draw the app a second copy of every context.)

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

const cake = (name: string): Cake => ({
  id: 'k', name, diameterCm: 20, tiers: 1, discs: 2, slices: 8, lines: [], packaging: [], assemblyMinutes: null,
  sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, discHeightCm: null, ref: null, model: 1,
});
const MINE = { uid: 'u1', locationId: 'bakery' };
const copy = (key: string, name = 'Torta', owner = MINE): ParkedCake => ({
  ...owner, key, savedId: null, working: cake(name), initial: cake(''), texts: { price: '', target: '', vatSelect: '', vatOther: '' },
  tier: 0, openStepKey: null, selected: null, fromScratch: false,
});
const stored = (): { copies: Array<{ key: string }> } | null => {
  const text = window.localStorage.getItem(UNSAVED_CAKES_KEY);
  return text === null ? null : (JSON.parse(text) as { copies: Array<{ key: string }> });
};

describe('reading back after a restart', () => {
  // A restart: a module with an empty shelf, and the device's storage as it was left.
  async function restarted() {
    vi.resetModules();
    return import('./cakeParking');
  }

  it('puts this person\'s copy in this venue back on the shelf, and nobody else\'s', async () => {
    flushWith(copy('mine', 'Mine'), copy('theirs', 'Theirs', { uid: 'u2', locationId: 'bakery' }), copy('elsewhere', 'Elsewhere', { uid: 'u1', locationId: 'restaurant' }));
    const fresh = await restarted();
    expect(fresh.peekParked('mine', MINE)).toBeNull();
    fresh.restoreCakesFromDevice(MINE);
    expect(fresh.peekParked('mine', MINE)?.working.name).toBe('Mine');
    expect(fresh.peekParked('theirs', MINE)).toBeNull();
    expect(fresh.peekParked('elsewhere', MINE)).toBeNull();
    expect(fresh.peekParked('theirs', { uid: 'u2', locationId: 'bakery' })).toBeNull();
    // Kept on the device until saved or discarded.
    expect(stored()?.copies).toHaveLength(3);
  });

  it('restores nothing before a venue is open', async () => {
    flushWith(copy('mine'));
    const fresh = await restarted();
    fresh.restoreCakesFromDevice(null);
    expect(fresh.peekParked('mine', MINE)).toBeNull();
  });

  it('throws a value that is not a list of copies away', async () => {
    window.localStorage.setItem(UNSAVED_CAKES_KEY, '{not json');
    const fresh = await restarted();
    fresh.restoreCakesFromDevice(MINE);
    expect(window.localStorage.getItem(UNSAVED_CAKES_KEY)).toBeNull();

    window.localStorage.setItem(UNSAVED_CAKES_KEY, JSON.stringify({ copies: 'nope' }));
    fresh.restoreCakesFromDevice(MINE);
    expect(window.localStorage.getItem(UNSAVED_CAKES_KEY)).toBeNull();
  });

  it('throws a malformed copy away and keeps the sound ones', async () => {
    const good = JSON.parse(JSON.stringify(copy('good', 'Good'))) as Record<string, unknown>;
    const noTexts = { ...JSON.parse(JSON.stringify(copy('bad1'))), texts: null } as Record<string, unknown>;
    const badTier = { ...JSON.parse(JSON.stringify(copy('bad2'))), tier: 7 } as Record<string, unknown>;
    const badStep = { ...JSON.parse(JSON.stringify(copy('bad3'))), openStepKey: 'nonsense' } as Record<string, unknown>;
    const noCake = { ...JSON.parse(JSON.stringify(copy('bad4'))), working: 'cake' } as Record<string, unknown>;
    window.localStorage.setItem(UNSAVED_CAKES_KEY, JSON.stringify({ v: 1, copies: [noTexts, good, badTier, badStep, noCake, 42, null] }));
    const fresh = await restarted();
    fresh.restoreCakesFromDevice(MINE);
    for (const key of ['bad1', 'bad2', 'bad3', 'bad4']) expect(fresh.peekParked(key, MINE)).toBeNull();
    expect(fresh.peekParked('good', MINE)?.working.name).toBe('Good');
    expect(stored()?.copies.map(held => held.key)).toEqual(['good']);
  });

  it('never lets a junk number into a restored cake', () => {
    const junk = { ...JSON.parse(JSON.stringify(copy('j'))), working: { ...cake('J'), diameterCm: 'wide', discs: NaN, tiers: 99 } } as unknown;
    const read = readParkedCake(junk);
    expect(Number.isFinite(read?.working.diameterCm)).toBe(true);
    expect(Number.isFinite(read?.working.discs)).toBe(true);
  });

  function flushWith(...copies: ParkedCake[]) {
    for (const held of copies) rememberCake(held);
    flushRemembered();
  }
});

