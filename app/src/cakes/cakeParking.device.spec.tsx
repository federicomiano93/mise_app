import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { keysToClear } from '@mise/shared/local-data';
import type { Cake } from '@mise/shared/cake-model';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { renderCakes, storedReference } from '../testing/renderCakes';
import { LOAD } from '../testing/renderFoodcost';
import {
  REMEMBER_DELAY_MS, UNSAVED_CAKES_KEY, clearParkedCakes, discardParked, flushRemembered, forgetCake, parkCake, peekParked, readParkedCake,
  rememberCake, resetParkedCakes, restoreCakesFromDevice,
} from './cakeParking';
import type { ParkedCake } from './cakeParking';

// An unsaved cake survives a close nobody could stop (a tablet's app swiped away): while the form is dirty its copy is written on the device
// (after a short pause), read back for the same person in the same venue only, field by field, and gone at Save, Discard, Delete and sign-out.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); resetParkedCakes(); });

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

describe('the key', () => {
  it('starts with no kept prefix, so a sign-out or a venue switch wipes it with the other keys', () => {
    expect(keysToClear([UNSAVED_CAKES_KEY, 'kiosk-settings'])).toEqual([UNSAVED_CAKES_KEY]);
  });
});

describe('writing', () => {
  it('waits for a pause after the last change, and writes only the latest', () => {
    vi.useFakeTimers();
    rememberCake(copy('a', 'T'));
    vi.advanceTimersByTime(REMEMBER_DELAY_MS - 1);
    rememberCake(copy('a', 'To'));
    vi.advanceTimersByTime(REMEMBER_DELAY_MS - 1);
    expect(stored()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(stored()?.copies).toHaveLength(1);
    expect(readParkedCake(stored()?.copies[0])?.working.name).toBe('To');
  });

  it('writes at once when the page is hidden', () => {
    vi.useFakeTimers();
    rememberCake(copy('a'));
    expect(stored()).toBeNull();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Reflect.deleteProperty(document, 'visibilityState');
    expect(stored()?.copies).toHaveLength(1);
  });

  it('writes a copy set aside for the Recipes at once', () => {
    parkCake(copy('a'));
    expect(stored()?.copies).toHaveLength(1);
  });

  it('forgets a cake, even one still waiting for its pause', () => {
    vi.useFakeTimers();
    rememberCake(copy('a'));
    rememberCake(copy('b'));
    flushRemembered();
    rememberCake(copy('a', 'later'));
    forgetCake('a');
    vi.advanceTimersByTime(REMEMBER_DELAY_MS * 2);
    expect(stored()?.copies.map(held => held.key)).toEqual(['b']);
    forgetCake('b');
    expect(stored()).toBeNull();
  });

  it('is emptied by the list\'s Discard and by the shell emptying the shelf', () => {
    parkCake(copy('a'));
    parkCake(copy('b'));
    discardParked('a');
    expect(stored()?.copies.map(held => held.key)).toEqual(['b']);
    clearParkedCakes();
    expect(stored()).toBeNull();
  });
});

describe('storage that fails', () => {
  it('does not break writing, forgetting, restoring or emptying when it throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(() => { rememberCake(copy('a')); flushRemembered(); }).not.toThrow();
    expect(() => { parkCake(copy('b')); }).not.toThrow();
    expect(() => { forgetCake('a'); }).not.toThrow();
    expect(() => { restoreCakesFromDevice(MINE); }).not.toThrow();
    expect(() => { clearParkedCakes(); }).not.toThrow();
    // The shelf in memory still works.
    parkCake(copy('c'));
    expect(peekParked('c', MINE)?.key).toBe('c');
  });

  it('does not break when the browser will not give the storage at all', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    expect(() => { rememberCake(copy('a')); flushRemembered(); forgetCake('a'); restoreCakesFromDevice(MINE); clearParkedCakes(); }).not.toThrow();
  });
});

describe('in the cake form', () => {
  const source = () => fakeCakesSource({ cakes: [], reference: storedReference() });
  const typeName = async (user: ReturnType<typeof renderCakes>['user'], text: string) => {
    await user.type(await screen.findByRole('textbox', { name: 'Name' }, LOAD), text);
  };

  it('writes the copy after typing, and offers it as «Unsaved cake» when Cakes opens after a restart', async () => {
    const { user } = renderCakes('/cakes/new', { cakes: source() });
    await typeName(user, 'Sacher');
    await waitFor(() => { expect(stored()?.copies).toHaveLength(1); }, { timeout: 3000 });
    const left = window.localStorage.getItem(UNSAVED_CAKES_KEY);
    expect(left).not.toBeNull();

    // The forced close: nothing runs on the way out; the next start finds the storage as it was, and an empty shelf.
    cleanup();
    resetParkedCakes();
    window.localStorage.setItem(UNSAVED_CAKES_KEY, left ?? '');

    renderCakes('/cakes', { cakes: source() });
    expect(await screen.findByText('Unsaved cake: Sacher', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume “Sacher”' })).toBeInTheDocument();
  });

  it('removes the copy when the cake is saved', async () => {
    const { user } = renderCakes('/cakes/new', { cakes: source() });
    await typeName(user, 'Sacher');
    await waitFor(() => { expect(stored()?.copies).toHaveLength(1); }, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(stored()).toBeNull(); });
  });

  it('removes the copy when the person leaves and discards', async () => {
    const { user } = renderCakes('/cakes/new', { cakes: source() });
    await typeName(user, 'Sacher');
    await waitFor(() => { expect(stored()?.copies).toHaveLength(1); }, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await discardButton());
    await waitFor(() => { expect(stored()).toBeNull(); });
  });

  it('removes the copy when «Discard» is pressed on the list\'s line', async () => {
    window.localStorage.setItem(UNSAVED_CAKES_KEY, JSON.stringify({ v: 1, copies: [JSON.parse(JSON.stringify(copy('a', 'Sacher')))] }));
    const { user } = renderCakes('/cakes', { cakes: source() });
    await screen.findByText('Unsaved cake: Sacher', undefined, LOAD);
    await user.click(screen.getByRole('button', { name: 'Discard “Sacher”' }));
    await user.click(await discardButton());
    await waitFor(() => { expect(stored()).toBeNull(); });
    expect(screen.queryByText('Unsaved cake: Sacher')).not.toBeInTheDocument();
  });

  async function discardButton(): Promise<HTMLElement> {
    return within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' });
  }
});
