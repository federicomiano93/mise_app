import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';
import { isRinging, stopAlarm } from './guidedAlarm';
import { SESSION_KEY } from './guidedSession';
import { resetResumeOffer } from './ResumeOffer';

// Step 3d-8, slice B: the guided mix at /recipes/<id>/mix — how it starts (the card writes the session), the clock (derived
// from the wall clock, never counted), the controls, the alarm, resume after a reload, the finish card, leaving, and the
// offer on the list. The pure rules: guidedRunModel.spec.ts; the saved session: guidedSession.spec.ts.
//
// ⚠️ ONLY `Date` IS FAKED. The run's 250 ms interval is real, so the clock is moved with setSystemTime and the screen is
// given a moment (waitFor) to repaint — except where the point is that it repaints AT ONCE (the page becoming visible),
// where the jump and the event happen in the same breath and the answer is read synchronously.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

const T0 = Date.UTC(2026, 9, 17, 10, 0, 0);

// A fake Audio element: every play() is logged with whether it was muted, so the tests can tell the silent unlock from a ring.
const plays: { muted: boolean }[] = [];
const sounds: FakeSound[] = [];
class FakeSound {
  loop = false;
  preload = '';
  muted = false;
  paused = true;
  currentTime = 0;
  constructor(public src: string) { sounds.push(this); }
  play() { plays.push({ muted: this.muted }); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() { /* nothing */ }
}
const rings = () => plays.filter(play => !play.muted).length;

let vibrate: ReturnType<typeof vi.fn>;
let sentinels: { released: boolean }[];

function installPhone(options: { wakeLock?: boolean } = {}) {
  vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  sentinels = [];
  if (options.wakeLock !== false) {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          const sentinel = { released: false, release: async () => { sentinel.released = true; }, addEventListener: () => undefined };
          sentinels.push(sentinel);
          return sentinel;
        },
      },
    });
  }
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  plays.length = 0;
  for (const sound of sounds) { sound.paused = true; sound.muted = false; }
  vi.stubGlobal('Audio', FakeSound);
  installPhone();
  resetResumeOffer();
});

afterEach(() => {
  stopAlarm();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'vibrate');
  Reflect.deleteProperty(navigator, 'wakeLock');
  Reflect.deleteProperty(document, 'visibilityState');
  window.localStorage.clear();
});

// Total 1000 g, so a batch of 2000 g doubles every amount.
const ROWS = [
  { label: 'Flour', grams: 600, unit: 'g', rid: 'rf' },
  { label: 'Water', grams: 380, unit: 'g', rid: 'rw' },
  { label: 'Salt', grams: 10, unit: 'g', rid: 'rs' },
  { label: 'Yeast', grams: 10, unit: 'g', rid: 'ry' },
];
const STEPS = [
  { text: 'Mix the flour and the water', rows: ['rf', 'rw'], seconds: 90, speed: '1' },
  { text: 'Add the salt', rows: ['rs', 'gone'], seconds: 0, speed: '2' },
  { text: 'Rest the dough', rows: [], seconds: 600, speed: '2' },
];
const FOCACCIA = recipe('r1', { name: 'Focaccia', ingredients: ROWS, steps: STEPS, endNote: 'Check 24 degrees' });
const BARE = recipe('bare', { name: 'Bare' });
const OTHER = recipe('other', { name: 'Other', ingredients: ROWS, steps: STEPS });
const SOURCE = () => sourceWith([FOCACCIA, BARE, OTHER]);

type Saved = { recipeId: string; stepIndex: number; endsAt: number; startedAt: number; snapshot: { name: string; targetGrams: number; steps: unknown[] } };
const stored = (): Saved | null => {
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw === null ? null : JSON.parse(raw) as Saved;
};

// A session as the current app (or this one) would have left it.
function leaveSession(overrides: Record<string, unknown> = {}, recipeId = 'r1') {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({
    recipeId,
    snapshot: { name: 'Focaccia', ingredients: ROWS, steps: STEPS, endNote: 'Check 24 degrees', targetGrams: 0 },
    stepIndex: 0,
    endsAt: 0,
    startedAt: T0 - 60_000,
    ...overrides,
  }));
}

const run = () => screen.getByRole('region', { name: 'Focaccia' });
const inRun = () => within(run());
const press = (name: string) => inRun().getByRole('button', { name });
const live = () => inRun().getAllByRole('status').map(node => node.textContent ?? '');

async function openRun(path = '/recipes/r1/mix', options: Parameters<typeof renderRecipes>[1] = {}) {
  const view = renderRecipes(path, { source: SOURCE(), ...options });
  await screen.findByRole('region', { name: 'Focaccia' }, LOAD);
  return view;
}

async function openRecipe(id = 'r1', { heading = 'Ingredients', ...options }: Parameters<typeof renderRecipes>[1] & { heading?: string } = {}) {
  const view = renderRecipes(`/recipes/${id}`, { source: SOURCE(), ...options });
  await screen.findByRole('heading', { level: 3, name: heading }, LOAD);
  return view;
}

const card = () => within(screen.getByRole('main')).getByRole('heading', { level: 3, name: 'Procedure' }).closest('section')!;

// Move the wall clock, and wait for the screen to have caught up with it.
async function jumpTo(ms: number, expected: string | RegExp) {
  vi.setSystemTime(ms);
  // «Time is up.» can be on the page twice at the very instant (the card and the quiet live region), hence getAll.
  await waitFor(() => { expect(inRun().getAllByText(expected).length).toBeGreaterThan(0); }, { timeout: 3000 });
}

describe('how a mix starts', () => {
  it('⚠️ writes the session with the batch the page shows, then lands on step 1', async () => {
    const { router, user } = await openRecipe();
    const main = within(screen.getByRole('main'));
    await user.type(main.getByRole('spinbutton', { name: 'Total dough weight in grams' }), '2000');
    await user.click(main.getByRole('button', { name: 'Calculate' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Calculate' }));
    await waitFor(() => { expect(main.getByRole('button', { name: 'Clear — back to base recipe' })).toBeInTheDocument(); });

    await user.click(within(card()).getByRole('button', { name: 'Guided mixing' }));

    expect(router.state.location.pathname).toBe('/recipes/r1/mix');
    expect(router.state.historyAction).toBe('PUSH');
    const saved = stored();
    expect(saved).toMatchObject({ recipeId: 'r1', stepIndex: 0, endsAt: 0, startedAt: T0 });
    expect(saved?.snapshot).toMatchObject({ name: 'Focaccia', targetGrams: 2000, endNote: 'Check 24 degrees' });
    expect(Object.keys(saved ?? {})).toEqual(['recipeId', 'snapshot', 'stepIndex', 'endsAt', 'startedAt']);

    await screen.findByRole('region', { name: 'Focaccia' });
    expect(inRun().getByText('Step 1 of 3')).toBeInTheDocument();
    expect(inRun().getByRole('heading', { level: 3, name: 'Mix the flour and the water' })).toBeInTheDocument();
    // The batch doubles the recipe: 600 g → 1200 g.
    const lines = inRun().getAllByRole('listitem').map(item => item.textContent);
    expect(lines).toEqual(['Flour1200g', 'Water760g']);
  });

  it('with no batch applied the snapshot holds 0 and the amounts are the recipe’s own', async () => {
    const { user } = await openRecipe();
    await user.click(within(card()).getByRole('button', { name: 'Guided mixing' }));
    await screen.findByRole('region', { name: 'Focaccia' });
    expect(stored()?.snapshot.targetGrams).toBe(0);
    expect(inRun().getAllByRole('listitem').map(item => item.textContent)).toEqual(['Flour600g', 'Water380g']);
  });

  it('shows the recipe’s name as the title with «Guided mixing» under it, and no Edit', async () => {
    const { user } = await openRecipe();
    await user.click(within(card()).getByRole('button', { name: 'Guided mixing' }));
    await screen.findByRole('region', { name: 'Focaccia' });
    expect(inRun().getByRole('heading', { level: 2, name: 'Focaccia' })).toBeInTheDocument();
    expect(inRun().getByText('Guided mixing')).toBeInTheDocument();
    expect(inRun().queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('is drawn full width: the section marks the layout as the run’s', async () => {
    leaveSession();
    await openRun();
    expect(document.querySelector('[data-view]')?.getAttribute('data-view')).toBe('run');
  });
});

describe('the clock', () => {
  it('starts as the instant it ends, and shows what is left', async () => {
    leaveSession();
    const { user } = await openRun();
    expect(inRun().getByText('01:30')).toBeInTheDocument();
    await user.click(press('Start the timer'));
    expect(stored()?.endsAt).toBe(T0 + 90_000);
    expect(inRun().getByText('01:30')).toBeInTheDocument();
    await jumpTo(T0 + 30_000, '01:00');
    expect(press('Running…')).toBeDisabled();
  });

  it('⚠️ a clock moved backwards is read as the timer running again, not as a timer that is up', async () => {
    leaveSession();
    const { user } = await openRun();
    await user.click(press('Start the timer'));
    await jumpTo(T0 - 600_000, '11:30');
    expect(isRinging()).toBe(false);
    expect(inRun().queryByText(/Time is up|Time was up/)).not.toBeInTheDocument();
  });

  it('⚠️ a page that was hidden while the timer ran out says how late it is THE MOMENT it comes back', async () => {
    leaveSession();
    const { user } = await openRun();
    await user.click(press('Start the timer'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    // The jump and the event in one breath: nothing but the visibility handler can have repainted the screen.
    vi.setSystemTime(T0 + 90_000 + 5 * 60_000);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(inRun().getByText('Time was up 5 minutes ago.')).toBeInTheDocument();
    expect(inRun().getByText('00:00')).toBeInTheDocument();
    expect(isRinging()).toBe(true);
    // The way on is the ordinary one now.
    expect(press('Done')).toBeInTheDocument();
    expect(inRun().queryByRole('button', { name: 'Start the timer' })).not.toBeInTheDocument();
  });

  it('says «Time is up» to a screen reader once, in a region that was already there', async () => {
    leaveSession();
    const { user } = await openRun();
    const region = inRun().getAllByRole('status')[1] as HTMLElement;
    expect(region.textContent).toBe('');
    await user.click(press('Start the timer'));
    await jumpTo(T0 + 90_000, 'Time is up.');
    expect(inRun().getAllByRole('status')[1]).toBe(region);
    expect(region.textContent).toBe('Time is up.');
  });

  it('never makes the countdown a live region: only the two quiet regions speak', async () => {
    leaveSession();
    const { user } = await openRun();
    await user.click(press('Start the timer'));
    const statuses = inRun().getAllByRole('status');
    expect(statuses).toHaveLength(2);
    for (const status of statuses) expect(status).not.toContainElement(inRun().getByText('01:30'));
  });

  it('adds a minute to the end and saves it', async () => {
    leaveSession();
    const { user } = await openRun();
    await user.click(press('Start the timer'));
    await user.click(press('+1 min'));
    expect(stored()?.endsAt).toBe(T0 + 150_000);
    expect(inRun().getByText('02:30')).toBeInTheDocument();
  });

  it('«Done early» goes on to the next step with no timer running, and saves that', async () => {
    leaveSession();
    const { user } = await openRun();
    await user.click(press('Start the timer'));
    await user.click(press('Done early'));
    expect(inRun().getByText('Step 2 of 3')).toBeInTheDocument();
    expect(stored()).toMatchObject({ stepIndex: 1, endsAt: 0 });
  });

  it('«Skip the timer» goes on without starting it', async () => {
    leaveSession();
    const { user } = await openRun();
    await user.click(press('Skip the timer'));
    expect(inRun().getByText('Step 2 of 3')).toBeInTheDocument();
    expect(stored()).toMatchObject({ stepIndex: 1, endsAt: 0 });
  });

  it('a step with no timer has «Done» and no clock', async () => {
    leaveSession({ stepIndex: 1 });
    await openRun();
    expect(press('Done')).toBeInTheDocument();
    expect(inRun().queryByText(/^\d\d:\d\d$/)).not.toBeInTheDocument();
  });

  it('the last step’s button says «Done — finish»', async () => {
    leaveSession({ stepIndex: 2 });
    const { user } = await openRun();
    await user.click(press('Skip the timer'));
    expect(await inRun().findByText('Dough finished')).toBeInTheDocument();
  });
});

describe('the mixer speed', () => {
  it('⚠️ announces a CHANGE once, and keeps the badge for the step', async () => {
    leaveSession();
    const { user } = await openRun();
    // Step 1 (first after opening): the badge, and nothing said.
    expect(inRun().getByText('Speed 1')).toBeInTheDocument();
    expect(live()[0]).toBe('');
    await user.click(press('Skip the timer'));
    // Step 2 runs at 2: a change.
    expect(live()[0]).toBe('Speed 2');
    expect(inRun().getByText('Speed 2', { selector: 'p:not([role])' })).toBeInTheDocument();
    await user.click(press('Done'));
    // Step 3 runs at 2 again: the same gear, nothing said.
    expect(live()[0]).toBe('');
    expect(inRun().getByText('Speed 2', { selector: 'p:not([role])' })).toBeInTheDocument();
  });

  it('⚠️ a step that DROPS the speed says nothing (never «Speed » with no number), and a rise is still said', async () => {
    const steps = [
      { text: 'Slow', rows: [], seconds: 0, speed: '1' },
      { text: 'Fast', rows: [], seconds: 0, speed: '2' },
      { text: 'Rest', rows: [], seconds: 0, speed: '' },
    ];
    leaveSession({ snapshot: { name: 'Focaccia', ingredients: ROWS, steps, endNote: '', targetGrams: 0 } });
    const { user } = await openRun();
    await user.click(press('Done'));
    expect(live()[0]).toBe('Speed 2');
    await user.click(press('Done'));
    expect(inRun().getByRole('heading', { level: 3, name: 'Rest' })).toBeInTheDocument();
    expect(live()[0]).toBe('');
    expect(inRun().queryByText(/^Speed/)).not.toBeInTheDocument();
  });

  it('⚠️ says nothing about the speed of a mix picked up part-way', async () => {
    leaveSession({ stepIndex: 1 });
    await openRun();
    expect(inRun().getByText('Speed 2', { selector: 'p:not([role])' })).toBeInTheDocument();
    expect(live()[0]).toBe('');
  });
});

describe('the alarm', () => {
  it('authorises the sound, silently, at the tap that starts a timer', async () => {
    leaveSession();
    const { user } = await openRun();
    expect(plays).toHaveLength(0);
    await user.click(press('Start the timer'));
    await waitFor(() => { expect(plays).toEqual([{ muted: true }]); });
    expect(isRinging()).toBe(false);
  });

  it('⚠️ rings once per step, when its timer ends, and vibrates', async () => {
    leaveSession({ stepIndex: 2 });
    const { user } = await openRun();
    await user.click(press('Start the timer'));
    await waitFor(() => { expect(plays).toHaveLength(1); });
    await jumpTo(T0 + 600_000, 'Time is up.');
    expect(rings()).toBe(1);
    expect(isRinging()).toBe(true);
    expect(vibrate).toHaveBeenCalled();
    // More ticks, still the one ring.
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(rings()).toBe(1);
  });

  it('⚠️ «+1 min» tapped in the instant the timer ran out stops that alarm, and the countdown runs again', async () => {
    leaveSession({ stepIndex: 2 });
    const { user } = await openRun();
    await user.click(press('Start the timer'));
    const plusOne = press('+1 min');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    // One breath: the clock passes the end, the tick rings, and the person taps the button the screen has not yet redrawn.
    act(() => {
      vi.setSystemTime(T0 + 600_000 + 500);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(isRinging()).toBe(true);
      plusOne.click();
    });
    expect(isRinging()).toBe(false);
    expect(stored()?.endsAt).toBe(T0 + 660_000);
    await jumpTo(T0 + 600_000 + 1000, '00:59');
    expect(press('Running…')).toBeDisabled();
    expect(inRun().queryByText(/Time is up|Time was up/)).not.toBeInTheDocument();
  });

  it('stops when the step is done', async () => {
    leaveSession({ stepIndex: 2 });
    const { user } = await openRun();
    await user.click(press('Start the timer'));
    await jumpTo(T0 + 600_000, 'Time is up.');
    await user.click(press('Done — finish'));
    expect(isRinging()).toBe(false);
  });

  it('rings straight away for a mix picked up on a timer that ran out while the app was closed', async () => {
    leaveSession({ endsAt: T0 - 30 * 60_000 });
    await openRun();
    expect(inRun().getByText('Time was up 30 minutes ago.')).toBeInTheDocument();
    await waitFor(() => { expect(rings()).toBe(1); });
    expect(isRinging()).toBe(true);
  });
});

describe('picking a mix up again', () => {
  it('⚠️ reopening the address after a reload goes on from the stored step and timer, never from the start', async () => {
    leaveSession({ stepIndex: 2, endsAt: T0 + 120_000 });
    await openRun();
    expect(inRun().getByText('Step 3 of 3')).toBeInTheDocument();
    expect(inRun().getByText('02:00')).toBeInTheDocument();
    expect(press('Running…')).toBeDisabled();
    expect(stored()).toMatchObject({ stepIndex: 2, endsAt: T0 + 120_000 });
  });

  it('with no mix saved for the recipe, a typed address goes to the recipe, replacing itself', async () => {
    const { router } = renderRecipes('/recipes/r1/mix', { source: SOURCE() });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(router.state.location.pathname).toBe('/recipes/r1');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('a mix saved for ANOTHER recipe is left alone', async () => {
    leaveSession({}, 'other');
    renderRecipes('/recipes/r1/mix', { source: SOURCE() });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(stored()?.recipeId).toBe('other');
  });

  it('⚠️ a mix that aged out says so, is cleared, and lands on the recipe — never a fresh run', async () => {
    leaveSession({ startedAt: T0 - 25 * 3600_000 });
    const { router } = renderRecipes('/recipes/r1/mix', { source: SOURCE() });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    const message = await screen.findByText('That mix is no longer available — start it again.');
    expect(message.closest('[role="status"]')).not.toBeNull();
    expect(stored()).toBeNull();
    expect(router.state.location.pathname).toBe('/recipes/r1');
  });

  it('a mix whose recipe has been deleted is stale too', async () => {
    leaveSession({}, 'gone-recipe');
    const { router } = renderRecipes('/recipes/gone-recipe/mix', { source: SOURCE() });
    await screen.findByText('That mix is no longer available — start it again.', undefined, LOAD);
    expect(stored()).toBeNull();
    expect(router.state.location.pathname).toBe('/recipes/gone-recipe');
  });
});

describe('the card', () => {
  it('offers «Guided mixing» when no mix is on the go', async () => {
    await openRecipe();
    expect(within(card()).getByRole('button', { name: 'Guided mixing' })).toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: /Resume/ })).not.toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: 'Start again from the beginning' })).not.toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Edit the steps' })).toBeInTheDocument();
  });

  it('offers «Resume — step N of M» with «Start again» under it when a mix of THIS recipe is on the go', async () => {
    leaveSession({ stepIndex: 1 });
    await openRecipe();
    expect(within(card()).getByRole('button', { name: 'Resume the guided mix — step 2 of 3' })).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Start again from the beginning' })).toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: 'Guided mixing' })).not.toBeInTheDocument();
  });

  it('ignores a mix of another recipe, and one that has aged out', async () => {
    leaveSession({}, 'other');
    await openRecipe();
    expect(within(card()).getByRole('button', { name: 'Guided mixing' })).toBeInTheDocument();
  });

  it('has no mix button at all for a recipe with no steps', async () => {
    await openRecipe('bare');
    expect(within(card()).queryByRole('button', { name: 'Guided mixing' })).not.toBeInTheDocument();
  });

  it('Resume goes to the run, and Start again begins at step 1 with a fresh session', async () => {
    leaveSession({ stepIndex: 1 });
    const { user } = await openRecipe();
    await user.click(within(card()).getByRole('button', { name: 'Start again from the beginning' }));
    await screen.findByRole('region', { name: 'Focaccia' });
    expect(inRun().getByText('Step 1 of 3')).toBeInTheDocument();
    expect(stored()).toMatchObject({ stepIndex: 0, endsAt: 0, startedAt: T0 });
  });

  it('⚠️ with a storage that refuses the write, «Guided mixing» still opens the run on step 1', async () => {
    const { user } = await openRecipe();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await user.click(within(card()).getByRole('button', { name: 'Guided mixing' }));
    await screen.findByRole('region', { name: 'Focaccia' });
    expect(inRun().getByText('Step 1 of 3')).toBeInTheDocument();
    expect(stored()).toBeNull();
  });

  it('⚠️ with a storage that refuses the write, «Start again» does not fall back on the OLDER mix at step 2', async () => {
    leaveSession({ stepIndex: 1 });
    const { user } = await openRecipe();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await user.click(within(card()).getByRole('button', { name: 'Start again from the beginning' }));
    await screen.findByRole('region', { name: 'Focaccia' });
    expect(inRun().getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('Resume continues at the stored step', async () => {
    leaveSession({ stepIndex: 1 });
    const { user, router } = await openRecipe();
    await user.click(within(card()).getByRole('button', { name: /^Resume the guided mix/ }));
    await screen.findByRole('region', { name: 'Focaccia' });
    expect(router.state.location.pathname).toBe('/recipes/r1/mix');
    expect(inRun().getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('⚠️ Resume tapped on a mix that has since aged out says so, clears it, and stays on the recipe', async () => {
    leaveSession({ stepIndex: 1 });
    const { user, router } = await openRecipe();
    const resume = within(card()).getByRole('button', { name: /^Resume the guided mix/ });
    // Time passes while the page is open (a phone left on the bench overnight).
    vi.setSystemTime(T0 + 25 * 3600_000);
    await user.click(resume);
    const message = await screen.findByText('That mix is no longer available — start it again.');
    expect(message.closest('[role="status"]')).not.toBeNull();
    expect(stored()).toBeNull();
    expect(router.state.location.pathname).toBe('/recipes/r1');
    expect(within(card()).getByRole('button', { name: 'Guided mixing' })).toBeInTheDocument();
  });
});

describe('the frozen snapshot', () => {
  it('⚠️ keeps the amounts and the words the mix was started with when the recipe is edited elsewhere', async () => {
    leaveSession();
    const source = SOURCE();
    renderRecipes('/recipes/r1/mix', { source });
    await screen.findByRole('region', { name: 'Focaccia' }, LOAD);
    source.recipes.set('r1', recipe('r1', {
      name: 'Focaccia', ingredients: [{ label: 'Flour', grams: 9999, unit: 'g', rid: 'rf' }],
      steps: [{ text: 'Something else entirely', rows: ['rf'], seconds: 5, speed: '9' }],
    }));
    act(() => { source.push(); });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(inRun().getByRole('heading', { level: 3, name: 'Mix the flour and the water' })).toBeInTheDocument();
    expect(inRun().getAllByRole('listitem').map(item => item.textContent)).toEqual(['Flour600g', 'Water380g']);
    expect(inRun().getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('a row the recipe has lost since keeps its place and says it is gone', async () => {
    leaveSession({ stepIndex: 1 });
    await openRun();
    const items = inRun().getAllByRole('listitem').map(item => item.textContent);
    expect(items).toEqual(['Salt10g', 'No longer in the recipe']);
  });
});

describe('the end', () => {
  async function finish() {
    leaveSession({ stepIndex: 2 });
    const view = await openRun();
    await view.user.click(press('Skip the timer'));
    await inRun().findByText('Dough finished');
    return view;
  }

  it('shows «Dough finished», the closing message, and every row no step mentioned with its amount', async () => {
    await finish();
    expect(inRun().getByText('Check 24 degrees')).toBeInTheDocument();
    expect(inRun().getByText('Not in any step — check these went in:')).toBeInTheDocument();
    const missed = inRun().getByText('Not in any step — check these went in:').closest('div')!;
    expect(within(missed).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Yeast10g']);
    expect(inRun().queryByRole('button', { name: 'Skip the timer' })).not.toBeInTheDocument();
  });

  it('⚠️ clears the saved session, so a finished mix is never offered back', async () => {
    await finish();
    expect(stored()).toBeNull();
  });

  it('leaves without asking once it is finished, back to the recipe', async () => {
    const { user, router } = await finish();
    await user.click(press('Back to the recipe'));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/recipes/r1');
  });

  it('has no warning when every row is in a step and no message when there is none', async () => {
    const all = recipe('all', { name: 'Focaccia', ingredients: ROWS.slice(0, 1), steps: [{ text: 'Mix', rows: ['rf'], seconds: 0, speed: '' }] });
    leaveSession({
      snapshot: { name: 'Focaccia', ingredients: ROWS.slice(0, 1), steps: [{ text: 'Mix', rows: ['rf'], seconds: 0, speed: '' }], endNote: '', targetGrams: 0 },
    }, 'all');
    const { user } = await openRun('/recipes/all/mix', { source: sourceWith([all]) });
    await user.click(press('Done — finish'));
    await inRun().findByText('Dough finished');
    expect(inRun().queryByText(/Not in any step/)).not.toBeInTheDocument();
  });
});

describe('leaving', () => {
  it('⚠️ asks, says where you are, and KEEPS the session either way', async () => {
    leaveSession({ stepIndex: 1 });
    const { user, router } = await openRun();
    await user.click(press('Back'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave the guided mix?' });
    expect(within(dialog).getByText('You are on step 2 of 3. It will be waiting where you left it.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/recipes/r1/mix');
    expect(stored()?.stepIndex).toBe(1);

    await user.click(press('Back'));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Leave the guided mix?' })).getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' });
    expect(router.state.location.pathname).toBe('/recipes/r1');
    expect(stored()?.stepIndex).toBe(1);
  });

  it('every other way out asks as well: a move to another address', async () => {
    leaveSession();
    const { router, user } = await openRun();
    // The router learns of the screen’s blocker one render after it is drawn: let it.
    await act(async () => { await Promise.resolve(); });
    act(() => { void router.navigate('/recipes'); });
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave the guided mix?' }, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(stored()).not.toBeNull();
  });

  it('comes back to the recipe with no second entry for it', async () => {
    const { user, router } = await openRecipe();
    await user.click(within(card()).getByRole('button', { name: 'Guided mixing' }));
    await screen.findByRole('region', { name: 'Focaccia' });
    await user.click(press('Back'));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' });
    expect(router.state.location.pathname).toBe('/recipes/r1');
    expect(router.state.historyAction).toBe('POP');
    // The focus is back on the card’s first mix button, where the person left.
    await waitFor(() => { expect(document.activeElement).toBe(within(card()).getByRole('button', { name: /^Resume the guided mix/ })); });
  });

  it('stops the alarm on the way out', async () => {
    leaveSession({ stepIndex: 2 });
    const { user } = await openRun();
    await user.click(press('Start the timer'));
    await jumpTo(T0 + 600_000, 'Time is up.');
    expect(isRinging()).toBe(true);
    await user.click(press('Back'));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' });
    expect(isRinging()).toBe(false);
  });
});

describe('the phone', () => {
  it('holds the screen awake while the mix is open, lets go when it is finished, and holds the app’s own reloads back', async () => {
    leaveSession({ stepIndex: 2 });
    const { user } = await openRun();
    await waitFor(() => { expect(sentinels).toHaveLength(1); });
    expect(isBusy()).toBe(true);
    await user.click(press('Skip the timer'));
    await inRun().findByText('Dough finished');
    await waitFor(() => { expect(sentinels[0]?.released).toBe(true); });
    expect(isBusy()).toBe(false);
  });

  it('says the honest line: keep the screen open, with or without a wake lock', async () => {
    leaveSession();
    await openRun();
    expect(inRun().getByText('Keep this screen open — the alarm cannot ring if you leave the app.')).toBeInTheDocument();
    cleanup();
    Reflect.deleteProperty(navigator, 'wakeLock');
    await openRun();
    expect(inRun().getByText('Keep this screen open and awake — the alarm cannot ring if you leave the app.')).toBeInTheDocument();
  });

  it('promises no notification: there is none in Mise 2 yet', async () => {
    leaveSession();
    await openRun();
    expect(inRun().queryByText(/notification/i)).not.toBeInTheDocument();
  });
});

describe('the offer on the list', () => {
  it('asks «Carry on mixing?» once per opening, naming the mix and the step', async () => {
    leaveSession({ stepIndex: 1 });
    const { user, router } = renderRecipes('/recipes', { source: SOURCE() });
    const dialog = await screen.findByRole('alertdialog', { name: 'Carry on mixing?' }, LOAD);
    expect(within(dialog).getByText('You were part-way through “Focaccia” — step 2 of 3.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    // «Not now» KEEPS the session.
    expect(stored()?.stepIndex).toBe(1);
    // The list comes back: no second question this opening.
    act(() => { void router.navigate('/recipes/bare'); });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' });
    act(() => { void router.navigate('/recipes'); });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('«Carry on» goes into the run, and Back from it is the recipe, then the list', async () => {
    leaveSession({ stepIndex: 1 });
    const { user, router } = renderRecipes('/recipes', { source: SOURCE() });
    const dialog = await screen.findByRole('alertdialog', { name: 'Carry on mixing?' }, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Carry on' }));
    await screen.findByRole('region', { name: 'Focaccia' });
    expect(router.state.location.pathname).toBe('/recipes/r1/mix');
    expect(inRun().getByText('Step 2 of 3')).toBeInTheDocument();
    await user.click(press('Back'));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Leave the guided mix?' })).getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' });
    expect(router.state.location.pathname).toBe('/recipes/r1');
  });

  it('is not made for a mix that aged out, one of a deleted recipe, or when none is saved', async () => {
    leaveSession({ startedAt: T0 - 25 * 3600_000 });
    renderRecipes('/recipes', { source: SOURCE() });
    await screen.findByText('Focaccia', undefined, LOAD);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('is not made when the app opens on a recipe: only when the list is what is on screen', async () => {
    leaveSession();
    await openRecipe();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByRole('alertdialog', { name: 'Carry on mixing?' })).not.toBeInTheDocument();
  });
});

describe('in Italian', () => {
  it('says the current app’s Italian words on the card and in the run', async () => {
    const { user } = await openRecipe('r1', { lang: 'it', session: { language: 'it' }, heading: 'Ingredienti' });
    const italianCard = within(screen.getByRole('main')).getByRole('heading', { level: 3, name: 'Procedimento' }).closest('section')!;
    await user.click(within(italianCard).getByRole('button', { name: 'Impasto guidato' }));
    const region = await screen.findByRole('region', { name: 'Focaccia' });
    expect(within(region).getByText('Passo 1 di 3')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Avvia il timer' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Salta il timer' })).toBeInTheDocument();
    expect(within(region).getByText('Velocità 1')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Avvia il timer' }));
    vi.setSystemTime(T0 + 90_000 + 5 * 60_000);
    await waitFor(() => { expect(within(region).getByText('Il tempo è scaduto 5 minuti fa.')).toBeInTheDocument(); }, { timeout: 3000 });
    expect(within(region).getByRole('button', { name: 'Fatto' })).toBeInTheDocument();
  });

  it('says the finish card’s own warning in Italian', async () => {
    leaveSession({ stepIndex: 2 });
    const { user } = await openRun('/recipes/r1/mix', { lang: 'it', session: { language: 'it' } });
    await user.click(within(screen.getByRole('region', { name: 'Focaccia' })).getByRole('button', { name: 'Salta il timer' }));
    expect(await screen.findByText('Impasto finito')).toBeInTheDocument();
    expect(screen.getByText('In nessun passaggio — controlla che siano entrati:')).toBeInTheDocument();
  });
});
