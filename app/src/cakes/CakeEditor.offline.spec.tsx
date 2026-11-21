import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { COPY_WAIT_MS } from '../foodcost/copyWait';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { SPONGE, cakeDoc, renderCakes } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD } from '../testing/renderFoodcost';

// A first visit with no signal: the venue's reference grams never answer (this phone has no copy of them either). An existing cake
// opens at once on its own grams; a new cake and the Reference screen wait for the deadline, then go on as «no reference yet».
// Fake data only.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const foodcost = () => fakeFoodcostSource({ products: [SPONGE], ingredients: [FLOUR], prices: FLOUR_PRICES });
const offline = (cakes: ReturnType<typeof cakeDoc>[] = []) => fakeCakesSource({ cakes, reference: null, referenceOffline: true });
const deadline = () => act(async () => { await vi.advanceTimersByTimeAsync(COPY_WAIT_MS + 50); });

const NO_REFERENCE = 'There are no reference grams yet, so every line needs its grams typed by hand.';

describe('the reference grams never answer', () => {
  it('an existing cake opens at once, without waiting for the deadline', async () => {
    renderCakes('/cakes/c1', { cakes: offline([cakeDoc('c1', 'Sacher')]), foodcost: foodcost() });
    expect(await screen.findByRole('heading', { level: 2, name: 'Sacher' }, LOAD)).toBeInTheDocument();
    // Its own reference is none and the venue's has not answered: it does not claim «no reference» yet.
    expect(screen.queryByText(NO_REFERENCE)).not.toBeInTheDocument();
  });

  it('a new cake waits for the deadline, then opens with the «no reference grams» band', async () => {
    renderCakes('/cakes/new', { cakes: offline(), foodcost: foodcost() });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByRole('heading', { level: 2, name: 'New cake' })).not.toBeInTheDocument();
    await deadline();
    expect(await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD)).toBeInTheDocument();
    expect(screen.getByText(NO_REFERENCE)).toBeInTheDocument();
  });

  it('the Reference screen waits for the deadline, then opens its empty boxes and its Save', async () => {
    renderCakes('/cakes/reference', { cakes: offline(), foodcost: foodcost() });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await deadline();
    expect(await screen.findByRole('textbox', { name: /^Diameter/ }, LOAD)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
