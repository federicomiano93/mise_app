import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { renderCakes, storedReference } from '../testing/renderCakes';
import { LOAD } from '../testing/renderFoodcost';
import { clearParkedCakes, parkCake, peekParked, resetParkedCakes } from './cakeParking';
import type { ParkedCake } from './cakeParking';
import type { Cake } from '@mise/shared/cake-model';

// A set-aside cake belongs to ONE person in ONE venue: a sign-out or a venue change that does not reload the page must never hand it to
// anybody else, nor keep it.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); resetParkedCakes(); });

const cake = (name: string): Cake => ({
  id: 'k', name, diameterCm: 20, tiers: 1, discs: 2, slices: 8, lines: [], packaging: [], assemblyMinutes: null,
  sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, ref: null, model: 1,
});

function copy(key: string, owner: { uid: string; locationId: string }, name = 'Torta'): ParkedCake {
  return {
    ...owner, key, savedId: null, working: cake(name), initial: cake(''), texts: { price: '', target: '', vatSelect: '', vatOther: '' },
    tier: 0, openStepKey: null, selected: null, fromScratch: false,
  };
}
const MINE = { uid: 'u1', locationId: 'bakery' };

describe('whose copy it is', () => {
  it('peekParked returns the copy only to the uid and the venue it was parked under', () => {
    parkCake(copy('a', MINE));
    expect(peekParked('a', MINE)?.key).toBe('a');
    expect(peekParked('a', { uid: 'u2', locationId: 'bakery' })).toBeNull();
    expect(peekParked('a', { uid: 'u1', locationId: 'restaurant' })).toBeNull();
    expect(peekParked('a', null)).toBeNull();
    expect(peekParked(null, MINE)).toBeNull();
  });

  it('clearParkedCakes empties the shelf', () => {
    parkCake(copy('a', MINE));
    parkCake(copy('b', MINE));
    clearParkedCakes();
    expect(peekParked('a', MINE)).toBeNull();
    expect(peekParked('b', MINE)).toBeNull();
  });
});

describe('the list', () => {
  async function openList() {
    const view = renderCakes('/cakes', { cakes: fakeCakesSource({ cakes: [], reference: storedReference() }) });
    await screen.findByRole('button', { name: 'New cake' }, LOAD);
    return view;
  }

  it('offers this person’s copy in this venue, and nobody else’s', async () => {
    parkCake(copy('mine', MINE, 'Mine'));
    parkCake(copy('other-person', { uid: 'u2', locationId: 'bakery' }, 'Theirs'));
    parkCake(copy('other-venue', { uid: 'u1', locationId: 'restaurant' }, 'Elsewhere'));
    await openList();
    expect(await screen.findByText('Unsaved cake: Mine')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved cake: Theirs')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved cake: Elsewhere')).not.toBeInTheDocument();
  });

  it('a sign-out in the shell takes the copy away for good, even for the same person signing in again', async () => {
    parkCake(copy('mine', MINE, 'Mine'));
    const { store } = await openList();
    expect(await screen.findByText('Unsaved cake: Mine')).toBeInTheDocument();
    const before = store.getSnapshot();
    act(() => { store.set({ status: 'signed-out', user: null, locationId: null }); });
    act(() => { store.set({ status: 'ready', user: before.user, locationId: before.locationId }); });
    expect(screen.queryByText('Unsaved cake: Mine')).not.toBeInTheDocument();
    expect(peekParked('mine', MINE)).toBeNull();
  });

  it('a change of venue takes the copy away too', async () => {
    parkCake(copy('mine', MINE, 'Mine'));
    const { store } = await openList();
    expect(await screen.findByText('Unsaved cake: Mine')).toBeInTheDocument();
    act(() => { store.set({ locationId: 'restaurant' }); });
    act(() => { store.set({ locationId: 'bakery' }); });
    expect(screen.queryByText('Unsaved cake: Mine')).not.toBeInTheDocument();
    expect(peekParked('mine', MINE)).toBeNull();
  });
});
