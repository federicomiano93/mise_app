import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import { entriesBehind } from '../testing/recipeLinkHelpers';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';
import { isRinging, stopAlarm } from './guidedAlarm';
import { FROM_RECIPE } from './recipesNav';
import { SESSION_KEY } from './guidedSession';
import { resetResumeOffer } from './ResumeOffer';

// Under StrictMode every effect runs twice. The guided mix's screen decides in an effect (leave for the recipe, say the mix is
// stale) and the list asks its question in one: each must still happen ONCE, and the offer must not be lost to the abandoned
// first run of the effect.

beforeAll(async () => {
  configure({ reactStrictMode: true });
  await import('./RecipesSection');
}, 60_000);

afterAll(() => { configure({ reactStrictMode: false }); });

const NOW = Date.now();
const ROWS = [{ label: 'Flour', grams: 600, unit: 'g', rid: 'rf' }];
const STEPS = [{ text: 'Mix', rows: ['rf'], seconds: 0, speed: '' }, { text: 'Rest', rows: [], seconds: 0, speed: '' }];
const FOCACCIA = recipe('r1', { name: 'Focaccia', ingredients: ROWS, steps: STEPS });

beforeEach(() => { window.localStorage.clear(); resetResumeOffer(); });
afterEach(() => { stopAlarm(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

function leaveSession(overrides: Record<string, unknown> = {}) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({
    recipeId: 'r1',
    snapshot: { name: 'Focaccia', ingredients: ROWS, steps: STEPS, endNote: '', targetGrams: 0 },
    stepIndex: 1, endsAt: 0, startedAt: NOW - 60_000, ...overrides,
  }));
}

describe('under StrictMode: the guided mix', () => {
  it('a typed address with nothing saved moves ONCE, replacing itself', async () => {
    const { router } = renderRecipes('/recipes/r1/mix', { source: sourceWith([FOCACCIA]) });
    const moves = vi.spyOn(router, 'navigate');
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(router.state.location.pathname).toBe('/recipes/r1');
    expect(moves.mock.calls.filter(([to]) => typeof to === 'string' || typeof to === 'number')).toHaveLength(1);
  });

  it('reopened after a reload with a stale mix behind it, it says so once and steps back ONCE', async () => {
    leaveSession({ startedAt: NOW - 25 * 3600_000 });
    const { router } = renderRecipes('/recipes/r1/mix', {
      source: sourceWith([FOCACCIA]),
      entries: [{ pathname: '/recipes/r1' }, { pathname: '/recipes/r1/mix', state: FROM_RECIPE }],
    });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    expect(await screen.findAllByText('That mix is no longer available — start it again.')).toHaveLength(1);
    expect(await entriesBehind(router)).toBe(0);
  });

  it('⚠️ a mix picked up on a timer that already ran out rings on the SECOND mount too', async () => {
    const plays: { muted: boolean }[] = [];
    vi.stubGlobal('Audio', class {
      loop = false; preload = ''; muted = false; currentTime = 0;
      play() { plays.push({ muted: this.muted }); return Promise.resolve(); }
      pause() { /* nothing */ }
      load() { /* nothing */ }
    });
    const timed = [{ text: 'Rest', rows: [], seconds: 600, speed: '' }];
    leaveSession({
      stepIndex: 0, endsAt: NOW - 30 * 60_000,
      snapshot: { name: 'Focaccia', ingredients: ROWS, steps: timed, endNote: '', targetGrams: 0 },
    });
    renderRecipes('/recipes/r1/mix', { source: sourceWith([FOCACCIA]) });
    await screen.findByRole('region', { name: 'Focaccia' }, LOAD);
    await waitFor(() => { expect(plays.some(play => !play.muted)).toBe(true); });
    expect(isRinging()).toBe(true);
  });

  it('⚠️ the offer on the list survives the abandoned first run of its effect', async () => {
    leaveSession();
    renderRecipes('/recipes', { source: sourceWith([FOCACCIA]) });
    const dialog = await screen.findByRole('alertdialog', { name: 'Carry on mixing?' }, LOAD);
    expect(within(dialog).getByText('You were part-way through “Focaccia” — step 2 of 2.')).toBeInTheDocument();
  });
});
