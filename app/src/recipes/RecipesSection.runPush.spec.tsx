import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakePhonePush } from '../testing/fakePhonePush';
import type { FakePhonePush } from '../testing/fakePhonePush';
import { fakeTimerPush } from '../testing/fakeTimerPush';
import type { FakeTimerPush } from '../testing/fakeTimerPush';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';
import { stopAlarm } from './guidedAlarm';
import { SESSION_KEY } from './guidedSession';
import { resetResumeOffer } from './ResumeOffer';

// The guided mix and the server push (notifications step 2): the line under the controls in its three states, and the booking
// of the timer's push (timerPush.ts) — made on taps only, cancelled whenever the step stops being wanted. The mix itself:
// RecipesSection.run.spec.tsx.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

const T0 = Date.UTC(2026, 9, 17, 10, 0, 0);
const STARTED = T0 - 60_000;
const STEPS = [
  { text: 'Mix the flour and the water', rows: [], seconds: 90, speed: '' },
  { text: 'Add the salt', rows: [], seconds: 0, speed: '' },
  { text: 'Rest the dough', rows: [], seconds: 600, speed: '' },
];
const FOCACCIA = recipe('r1', { name: 'Focaccia', ingredients: [{ label: 'Flour', grams: 600, unit: 'g', rid: 'rf' }], steps: STEPS });

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.stubGlobal('Audio', class {
    loop = false; preload = ''; muted = false; currentTime = 0;
    play() { return Promise.resolve(); }
    pause() { /* nothing */ }
    load() { /* nothing */ }
  });
  resetResumeOffer();
});

afterEach(() => {
  stopAlarm();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
  window.localStorage.clear();
});

function leaveSession(overrides: Record<string, unknown> = {}) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({
    recipeId: 'r1',
    snapshot: { name: 'Focaccia', ingredients: [{ label: 'Flour', grams: 600, unit: 'g', rid: 'rf' }], steps: STEPS, endNote: '', targetGrams: 0 },
    stepIndex: 0, endsAt: 0, startedAt: STARTED, ...overrides,
  }));
}

const REGISTERED = { reason: 'granted', owner: 'u1' } as const;

async function openRun(phonePush: FakePhonePush = fakePhonePush(REGISTERED), timerPush: FakeTimerPush = fakeTimerPush(), lang: 'en' | 'it' = 'en') {
  if (window.localStorage.getItem(SESSION_KEY) === null) leaveSession();
  const view = renderRecipes('/recipes/r1/mix', { source: sourceWith([FOCACCIA]), phonePush, timerPush, lang });
  const run = await screen.findByRole('region', { name: 'Focaccia' }, LOAD);
  return { ...view, phonePush, timerPush, run: within(run) };
}

const ID_STEP_1 = `r1-${STARTED}-0-${T0 + 90_000}`;

describe('the line under the controls', () => {
  it('A: a phone registered for this person says it will also send a notification, with no button', async () => {
    const { run } = await openRun();
    expect(run.getByText('It will also send a notification if you leave the app.')).toBeInTheDocument();
    expect(run.queryByRole('button', { name: 'Also tell me if I leave the app' })).toBeNull();
    expect(run.queryByText(/Keep this screen open/)).toBeNull();
  });

  it('B: a phone that has not been asked gets the button and the honest line under it', async () => {
    const { run } = await openRun(fakePhonePush({ reason: 'ask' }));
    expect(run.getByRole('button', { name: 'Also tell me if I leave the app' })).toBeInTheDocument();
    expect(run.getByText('Otherwise keep this screen open — the alarm cannot ring from a closed app.')).toBeInTheDocument();
  });

  it('B: a phone that allowed notifications but is registered for nobody gets the button too', async () => {
    const { run } = await openRun(fakePhonePush({ reason: 'granted', owner: 'somebody-else' }));
    expect(run.getByRole('button', { name: 'Also tell me if I leave the app' })).toBeInTheDocument();
  });

  it.each([
    ['blocked', 'Notifications are blocked. Turn them on for this app in your browser/site settings, then reload.'],
    ['install-first', 'On iPhone and iPad, notifications only work once the app has been added to the Home Screen.'],
    ['unsupported', 'This device does not support notifications.'],
  ] as const)('C: %s says why, then the honest line, and no button', async (reason, sentence) => {
    const { run } = await openRun(fakePhonePush({ reason }));
    expect(run.getByText(sentence)).toBeInTheDocument();
    expect(run.getByText(/^Keep this screen open/)).toBeInTheDocument();
    expect(run.queryByRole('button', { name: 'Also tell me if I leave the app' })).toBeNull();
  });

  it('C: the preview project (not configured) and permission-only mode say only the honest line', async () => {
    const first = await openRun(fakePhonePush({ reason: 'not-configured' }));
    expect(first.run.getByText(/^Keep this screen open/)).toBeInTheDocument();
    expect(first.run.queryByText(/notification/i)).toBeNull();
  });

  it('C: permission-only mode says only the honest line', async () => {
    const { run } = await openRun(fakePhonePush({ reason: 'unsupported', only: 'default' }));
    expect(run.getByText(/^Keep this screen open/)).toBeInTheDocument();
    expect(run.queryByText('This device does not support notifications.')).toBeNull();
  });

  it('is in Italian for an Italian phone', async () => {
    const { run } = await openRun(fakePhonePush({ reason: 'ask' }), fakeTimerPush(), 'it');
    expect(run.getByRole('button', { name: 'Avvisami anche se esco dall’app' })).toBeInTheDocument();
    expect(run.getByText('Altrimenti tieni aperta questa schermata — la sveglia non può suonare da un’app chiusa.')).toBeInTheDocument();
  });

  it('B → A: the button registers from the tap and the line turns into the confirmation', async () => {
    leaveSession();
    const { user, run, phonePush } = await openRun(fakePhonePush({ reason: 'ask', outcome: 'on' }));
    await user.click(run.getByRole('button', { name: 'Also tell me if I leave the app' }));
    expect(phonePush.register).toHaveBeenCalledTimes(1);
    const line = await run.findByText('It will also send a notification if you leave the app.');
    expect(run.queryByRole('button', { name: 'Also tell me if I leave the app' })).toBeNull();
    await waitFor(() => { expect(document.activeElement).toBe(line.closest('p')); });
  });

  it('B stays B and keeps the focus on the button when the prompt is dismissed (answer ask)', async () => {
    const { user, run } = await openRun(fakePhonePush({ reason: 'ask', outcome: 'ask' }));
    const button = run.getByRole('button', { name: 'Also tell me if I leave the app' });
    await user.click(button);
    await act(async () => { await Promise.resolve(); });
    expect(run.getByRole('button', { name: 'Also tell me if I leave the app' })).toHaveFocus();
  });

  it('a phone that says on but lost its subscription gets the button back (verify, once, as the screen opens)', async () => {
    const phonePush = fakePhonePush({ reason: 'granted', owner: 'u1', verifyAnswer: 'cleared' });
    const { run } = await openRun(phonePush);
    expect(await run.findByRole('button', { name: 'Also tell me if I leave the app' })).toBeInTheDocument();
    expect(phonePush.verify).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['blocked', 'Notifications are blocked. Turn them on for this app in your browser/site settings, then reload.'],
    ['install-first', 'On iPhone and iPad, notifications only work once the app has been added to the Home Screen.'],
    ['unsupported', 'This device does not support notifications.'],
    ['failed', 'Notifications could not be turned on for this phone. Check your connection and try again.'],
  ] as const)('B → C: a tap answered %s shows that reason and the honest line', async (outcome, sentence) => {
    const { user, run } = await openRun(fakePhonePush({ reason: 'ask', outcome }));
    await user.click(run.getByRole('button', { name: 'Also tell me if I leave the app' }));
    const why = await run.findByText(sentence);
    await waitFor(() => { expect(document.activeElement).toBe(why); });
    expect(run.getByText(/^Keep this screen open/)).toBeInTheDocument();
    expect(run.queryByRole('button', { name: 'Also tell me if I leave the app' })).toBeNull();
  });

  it('is disabled while the registration runs, so a second tap cannot start another', async () => {
    let finish: (outcome: 'on') => void = () => undefined;
    const phonePush = fakePhonePush({ reason: 'ask' });
    phonePush.register.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { user, run } = await openRun(phonePush);
    const button = run.getByRole('button', { name: 'Also tell me if I leave the app' });
    await user.click(button);
    // Pending, not disabled: it keeps the focus and blocks a second press.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await user.click(button);
    expect(phonePush.register).toHaveBeenCalledTimes(1);
    await act(async () => { finish('on'); await Promise.resolve(); });
  });

  it('reads the phone again when the page becomes visible (the person may have changed the browser’s settings)', async () => {
    const phonePush = fakePhonePush({ reason: 'blocked' });
    const { run } = await openRun(phonePush);
    expect(run.getByText(/^Notifications are blocked/)).toBeInTheDocument();
    phonePush.reason = 'granted';
    phonePush.owner = 'u1';
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await run.findByText('It will also send a notification if you leave the app.')).toBeInTheDocument();
  });
});

describe('booking the timer’s push', () => {
  it('books nothing when a fresh mix opens, or when the phone is not registered for this person', async () => {
    const fresh = await openRun();
    await act(async () => { await Promise.resolve(); });
    expect(fresh.timerPush.schedule).not.toHaveBeenCalled();
    expect(fresh.timerPush.cancel).not.toHaveBeenCalled();
    cleanup();
    leaveSession({ endsAt: T0 + 300_000 });
    const resumed = await openRun(fakePhonePush({ reason: 'ask' }));
    await act(async () => { await Promise.resolve(); });
    expect(resumed.timerPush.schedule).not.toHaveBeenCalled();
    expect(resumed.timerPush.cancel).not.toHaveBeenCalled();
  });

  it('⚠️ a mix resumed on a running timer cancels the old booking and books a fresh id, once', async () => {
    leaveSession({ endsAt: T0 + 300_000 });
    const { timerPush } = await openRun();
    await act(async () => { await Promise.resolve(); });
    const base = `r1-${STARTED}-0-${T0 + 300_000}`;
    expect(timerPush.cancel).toHaveBeenCalledWith(base);
    expect(timerPush.schedule).toHaveBeenCalledTimes(1);
    expect(timerPush.schedule).toHaveBeenCalledWith({ id: `${base}-r${T0}`, fireAt: T0 + 300_000, title: 'Focaccia', body: 'Mix the flour and the water' });
  });

  it('⚠️ leaving after a resume cancels the fresh booking', async () => {
    leaveSession({ endsAt: T0 + 300_000 });
    const { user, run, timerPush } = await openRun();
    await act(async () => { await Promise.resolve(); });
    await user.click(run.getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Leave the guided mix?' })).getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' });
    await waitFor(() => { expect(timerPush.cancel).toHaveBeenCalledWith(`r1-${STARTED}-0-${T0 + 300_000}-r${T0}`); });
  });

  it('⚠️ a mix resumed with under 30 seconds left books nothing, but Done still cancels a stale booking', async () => {
    leaveSession({ endsAt: T0 + 20_000 });
    const { user, run, timerPush } = await openRun();
    await act(async () => { await Promise.resolve(); });
    expect(timerPush.schedule).not.toHaveBeenCalled();
    expect(timerPush.cancel).not.toHaveBeenCalled();
    await user.click(run.getByRole('button', { name: 'Done early' }));
    expect(timerPush.cancel).toHaveBeenCalledWith(`r1-${STARTED}-0-${T0 + 20_000}`);
  });

  it('a resume booking that comes back after the step was finished is cancelled at once', async () => {
    leaveSession({ endsAt: T0 + 300_000 });
    const timerPush = fakeTimerPush({ hold: true });
    const { user, run } = await openRun(fakePhonePush(REGISTERED), timerPush);
    await user.click(run.getByRole('button', { name: 'Done early' }));
    await act(async () => { timerPush.release(); await Promise.resolve(); });
    expect(timerPush.cancel).toHaveBeenCalledWith(`r1-${STARTED}-0-${T0 + 300_000}-r${T0}`);
  });

  it('⚠️ «Start the timer» books once: the id carries the run, the step and the end, the title is the recipe and the body the step', async () => {
    leaveSession();
    const { user, run, timerPush } = await openRun();
    await user.click(run.getByRole('button', { name: 'Start the timer' }));
    expect(timerPush.schedule).toHaveBeenCalledTimes(1);
    expect(timerPush.schedule).toHaveBeenCalledWith({
      id: ID_STEP_1, fireAt: T0 + 90_000, title: 'Focaccia', body: 'Mix the flour and the water',
    });
    await act(async () => { await Promise.resolve(); });
    expect(timerPush.cancel).not.toHaveBeenCalled();
  });

  it('falls back to «Mise» for a recipe with no name and to «Time is up.» for a step with no words', async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({
      recipeId: 'r1',
      snapshot: { name: '', ingredients: [], steps: [{ text: '', rows: [], seconds: 90, speed: '' }], endNote: '', targetGrams: 0 },
      stepIndex: 0, endsAt: 0, startedAt: STARTED,
    }));
    const timerPush = fakeTimerPush();
    const view = renderRecipes('/recipes/r1/mix', { source: sourceWith([FOCACCIA]), phonePush: fakePhonePush(REGISTERED), timerPush });
    await view.user.click(await screen.findByRole('button', { name: 'Start the timer' }, LOAD));
    expect(timerPush.schedule).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mise', body: 'Time is up.' }));
  });

  it('⚠️ «Done early» cancels the booking', async () => {
    leaveSession();
    const { user, run, timerPush } = await openRun();
    await user.click(run.getByRole('button', { name: 'Start the timer' }));
    await waitFor(() => { expect(timerPush.schedule).toHaveBeenCalled(); });
    await act(async () => { await Promise.resolve(); });
    await user.click(run.getByRole('button', { name: 'Done early' }));
    expect(timerPush.cancel).toHaveBeenCalledTimes(1);
    expect(timerPush.cancel).toHaveBeenCalledWith(ID_STEP_1);
  });

  it('«Skip the timer» books nothing and has nothing to cancel', async () => {
    leaveSession();
    const { user, run, timerPush } = await openRun();
    await user.click(run.getByRole('button', { name: 'Skip the timer' }));
    expect(timerPush.schedule).not.toHaveBeenCalled();
    expect(timerPush.cancel).not.toHaveBeenCalled();
  });

  it('finishing the last step cancels the booking', async () => {
    leaveSession({ stepIndex: 2 });
    const { user, run, timerPush } = await openRun();
    await user.click(run.getByRole('button', { name: 'Start the timer' }));
    await act(async () => { await Promise.resolve(); });
    await user.click(run.getByRole('button', { name: 'Done early' }));
    expect(timerPush.cancel).toHaveBeenCalledWith(`r1-${STARTED}-2-${T0 + 600_000}`);
  });

  it('⚠️ «+1 min» cancels the old booking, then books the new end under a new id', async () => {
    leaveSession();
    const { user, run, timerPush } = await openRun();
    await user.click(run.getByRole('button', { name: 'Start the timer' }));
    await act(async () => { await Promise.resolve(); });
    await user.click(run.getByRole('button', { name: '+1 min' }));
    expect(timerPush.cancel).toHaveBeenCalledWith(ID_STEP_1);
    expect(timerPush.schedule).toHaveBeenCalledTimes(2);
    expect(timerPush.schedule).toHaveBeenLastCalledWith(expect.objectContaining({ id: `r1-${STARTED}-0-${T0 + 150_000}`, fireAt: T0 + 150_000 }));
    const cancelOrder = timerPush.cancel.mock.invocationCallOrder[0] ?? 0;
    const scheduleOrder = timerPush.schedule.mock.invocationCallOrder[1] ?? 0;
    expect(cancelOrder).toBeLessThan(scheduleOrder);
  });

  it('⚠️ a booking that comes back after the step was finished is cancelled at once', async () => {
    leaveSession();
    const timerPush = fakeTimerPush({ hold: true });
    const { user, run } = await openRun(fakePhonePush(REGISTERED), timerPush);
    await user.click(run.getByRole('button', { name: 'Start the timer' }));
    await user.click(run.getByRole('button', { name: 'Done early' }));
    expect(timerPush.cancel).not.toHaveBeenCalled();
    await act(async () => { timerPush.release(); await Promise.resolve(); });
    expect(timerPush.cancel).toHaveBeenCalledWith(ID_STEP_1);
  });

  it('a booking that comes back after «+1 min» is cancelled, and only the new one is kept', async () => {
    leaveSession();
    const timerPush = fakeTimerPush({ hold: true });
    const { user, run } = await openRun(fakePhonePush(REGISTERED), timerPush);
    await user.click(run.getByRole('button', { name: 'Start the timer' }));
    await user.click(run.getByRole('button', { name: '+1 min' }));
    await act(async () => { timerPush.release(); await Promise.resolve(); });
    expect(timerPush.cancel).toHaveBeenCalledWith(ID_STEP_1);
    expect(timerPush.cancel).not.toHaveBeenCalledWith(`r1-${STARTED}-0-${T0 + 150_000}`);
  });

  it('⚠️ leaving the mix cancels what is booked', async () => {
    leaveSession();
    const { user, run, timerPush } = await openRun();
    await user.click(run.getByRole('button', { name: 'Start the timer' }));
    await act(async () => { await Promise.resolve(); });
    await user.click(run.getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Leave the guided mix?' })).getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' });
    await waitFor(() => { expect(timerPush.cancel).toHaveBeenCalledWith(ID_STEP_1); });
  });

  it('a booking that answers nothing is not remembered, so nothing is cancelled later', async () => {
    leaveSession();
    const timerPush = fakeTimerPush({ answer: '' });
    const { user, run } = await openRun(fakePhonePush(REGISTERED), timerPush);
    await user.click(run.getByRole('button', { name: 'Start the timer' }));
    await act(async () => { await Promise.resolve(); });
    await user.click(run.getByRole('button', { name: 'Done early' }));
    expect(timerPush.cancel).not.toHaveBeenCalled();
  });

  it('⚠️ registering the phone with a timer already running books that timer once', async () => {
    leaveSession();
    const phonePush = fakePhonePush({ reason: 'ask', outcome: 'on' });
    // Before the registration the real timerPush books nothing and answers '' (a phone not registered for this person).
    const { user, run, timerPush } = await openRun(phonePush, fakeTimerPush({ answer: '' }));
    await user.click(run.getByRole('button', { name: 'Start the timer' }));
    await act(async () => { await Promise.resolve(); });
    expect(timerPush.schedule).toHaveBeenCalledTimes(1);
    timerPush.answer = 'booking';
    await user.click(run.getByRole('button', { name: 'Also tell me if I leave the app' }));
    await waitFor(() => { expect(timerPush.schedule).toHaveBeenCalledTimes(2); });
    expect(timerPush.schedule).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID_STEP_1, fireAt: T0 + 90_000 }));
  });

  it('registering the phone with no timer running books nothing', async () => {
    leaveSession();
    const { user, run, timerPush } = await openRun(fakePhonePush({ reason: 'ask', outcome: 'on' }));
    await user.click(run.getByRole('button', { name: 'Also tell me if I leave the app' }));
    await act(async () => { await Promise.resolve(); });
    expect(timerPush.schedule).not.toHaveBeenCalled();
  });
});
