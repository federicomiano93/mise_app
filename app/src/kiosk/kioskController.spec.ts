// The kiosk's runtime (staff slice 5): the idle → rest → night timeline on fake timers, the screen lock per state, the busy marker
// held under the cover, and #406's rule — no reload in 'rest' or later in 'night', an update and the daily reload only at the
// rest→night tick, the «Never» reload on the waking tap. Ported from js/kiosk.js's behaviour (tests/kiosk-*.test.mjs pin its source).

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KIOSK_LAST_RELOAD_KEY, KIOSK_RESUME_KEY } from '@mise/shared/kiosk-model';
import type { KioskSettings } from '@mise/shared/kiosk-model';
import { isBusy, isBusyApartFrom, markBusy } from '../session/busy';
import { BUSY_RETRY_MS, RELOAD_GRACE_MS, watchServiceWorker } from '../shell/serviceWorker';
import type { ServiceWorkerEnv } from '../shell/serviceWorker';
import { memoryStorage } from '../testing/renderWithSession';
import { ACTIVE_HOLD_AFTER_MS, RELOAD_STALL_MS, TICK_MS, WAKE_OWNER, createKioskController } from './kioskController';
import type { KioskController, KioskEnv } from './kioskController';

const MIN = 60_000;
const HOUR = 60 * MIN;
const ON: KioskSettings = { enabled: true, restMinutes: 5, nightHours: 1 };
const NEVER: KioskSettings = { enabled: true, restMinutes: 5, nightHours: 0 };
const READY = { status: 'ready', signedIn: true } as const;

function makeEnv(over: Partial<KioskEnv> = {}) {
  const local = memoryStorage();
  const session = memoryStorage();
  const lock = { held: false, owners: [] as string[] };
  const env: KioskEnv = {
    now: () => Date.now(),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: id => { clearInterval(id as ReturnType<typeof setInterval>); },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: id => { clearTimeout(id as ReturnType<typeof setTimeout>); },
    local: () => local,
    session: () => session,
    document,
    reload: vi.fn(),
    updateWaiting: vi.fn(async () => false),
    acquireWakeLock: vi.fn((owner: string) => { lock.held = true; lock.owners.push(owner); }),
    releaseWakeLock: vi.fn(() => { lock.held = false; }),
    refreshWakeLock: vi.fn(),
    // The real marker: the shell's update and the copy check ask it.
    markBusy,
    isBusyApartFrom,
    ...over,
  };
  return { env, local, session, lock };
}

let controller: KioskController | null = null;
function start(settings: KioskSettings, over: Partial<KioskEnv> = {}, session: { status: 'ready' | 'loading' | 'signed-out'; signedIn: boolean } = READY) {
  const world = makeEnv(over);
  controller = createKioskController(world.env);
  controller.setSession(session);
  controller.applySettings(settings);
  return { ...world, controller };
}
const state = () => controller?.getSnapshot().state;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 5, 14, 0, 0));
  sessionStorage.clear();
});

afterEach(() => {
  controller?.stop();
  controller = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('the timeline', () => {
  test('rests after exactly the chosen minutes without a touch, then night after the chosen hours', async () => {
    start(ON);
    await vi.advanceTimersByTimeAsync(5 * MIN - TICK_MS);
    expect(state()).toBe('active');
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(state()).toBe('rest');
    await vi.advanceTimersByTimeAsync(HOUR - TICK_MS);
    expect(state()).toBe('rest');
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(state()).toBe('night');
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(state(), 'night stays night until somebody wakes it').toBe('night');
  });

  test('a touch restarts the idle clock', async () => {
    start(ON);
    await vi.advanceTimersByTimeAsync(4 * MIN);
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(4 * MIN);
    expect(state()).toBe('active');
    await vi.advanceTimersByTimeAsync(MIN);
    expect(state()).toBe('rest');
  });

  test('with «Never» it rests and never goes to night', async () => {
    start(NEVER);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(state()).toBe('rest');
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(state()).toBe('rest');
  });

  test('never rests while an editor holds the busy marker, and rests as soon as it is free', async () => {
    const release = markBusy();
    try {
      start(ON);
      await vi.advanceTimersByTimeAsync(30 * MIN);
      expect(state()).toBe('active');
      release();
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(state(), 'the idle time already served is not wasted').toBe('rest');
    } finally { release(); }
  });

  test('never rests over an open dialog', async () => {
    start(ON);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    document.body.append(dialog);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(state()).toBe('active');
    dialog.remove();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(state()).toBe('rest');
  });

  test('never rests while nobody is signed in with a venue open', async () => {
    start(ON, {}, { status: 'signed-out', signedIn: false });
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(state()).toBe('active');
  });

  test('the setting off does nothing at all, and switching it off wakes a resting tablet', async () => {
    const { lock } = start({ ...ON, enabled: false });
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(state()).toBe('active');
    expect(lock.held).toBe(false);
    controller?.applySettings(ON);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(state()).toBe('rest');
    controller?.applySettings({ ...ON, enabled: false });
    expect(state()).toBe('active');
    expect(lock.held).toBe(false);
    expect(isBusy()).toBe(false);
  });

  test('a new choice of minutes takes effect without a restart', async () => {
    start(ON);
    controller?.applySettings({ ...ON, restMinutes: 20 });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(state()).toBe('active');
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(state()).toBe('rest');
  });

  test('a sign-out under the cover wakes it (a black screen in front of the sign-in form would be a trap)', async () => {
    start(ON);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(state()).toBe('rest');
    controller?.setSession({ status: 'signed-out', signedIn: false });
    expect(state()).toBe('active');
  });

  test('the join form or a venue being left over a ready session wakes it at the next tick', async () => {
    start(ON);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    controller?.setSession({ status: 'ready', signedIn: false });
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(state()).toBe('active');
  });
});

describe('the screen lock (#406)', () => {
  test('held in active and rest while signed in, asked for again on every tick, released in night', async () => {
    const { env, lock } = start(ON);
    expect(lock.held).toBe(true);
    expect(lock.owners).toEqual([WAKE_OWNER]);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(state()).toBe('rest');
    expect(lock.held).toBe(true);
    const refreshes = vi.mocked(env.refreshWakeLock).mock.calls.length;
    await vi.advanceTimersByTimeAsync(TICK_MS * 4);
    expect(vi.mocked(env.refreshWakeLock).mock.calls.length - refreshes).toBe(4);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(state()).toBe('night');
    expect(lock.held, 'Android may switch the backlight off').toBe(false);
  });

  test('released when signed out, held again when somebody signs in', () => {
    const { lock } = start(ON);
    controller?.setSession({ status: 'signed-out', signedIn: false });
    expect(lock.held).toBe(false);
    controller?.setSession({ status: 'loading', signedIn: false });
    controller?.setSession(READY);
    expect(lock.held).toBe(true);
  });

  test('held while a fresh page is still loading its session', () => {
    const { lock } = start(ON, {}, { status: 'loading', signedIn: false });
    expect(lock.held).toBe(true);
  });

  test('the waking tap after night asks for it again', async () => {
    const { lock } = start(ON);
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR);
    expect(lock.held).toBe(false);
    controller?.wakeTap(false);
    expect(state()).toBe('active');
    expect(lock.held).toBe(true);
  });
});

describe('the busy marker under the cover', () => {
  test('held in rest and in night, let go by the waking tap', async () => {
    start(ON);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(isBusy()).toBe(true);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(state()).toBe('night');
    expect(isBusy()).toBe(true);
    controller?.wakeTap(false);
    expect(isBusy()).toBe(false);
  });

  test('in use but untouched: held after half a minute while the screen is kept on, let go by the next touch', async () => {
    start(ON);
    expect(isBusy()).toBe(false);
    await vi.advanceTimersByTimeAsync(ACTIVE_HOLD_AFTER_MS - 1);
    expect(isBusy()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isBusy()).toBe(true);
    document.dispatchEvent(new Event('keydown'));
    expect(isBusy()).toBe(false);
  });

  test('a signed-out tablet (no screen lock) holds nothing while active', async () => {
    start(ON, {}, { status: 'signed-out', signedIn: false });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(isBusy()).toBe(false);
  });

});

describe('#406: no reload under the rest screen', () => {
  test('nothing reloads in rest, however long, with or without an update waiting', async () => {
    const { env } = start(NEVER, { updateWaiting: vi.fn(async () => true) });
    await vi.advanceTimersByTimeAsync(5 * MIN + 30 * HOUR);
    expect(state()).toBe('rest');
    expect(env.reload).not.toHaveBeenCalled();
    expect(isBusy(), 'the cover holds the marker throughout').toBe(true);
  });

  test('the daily reload happens exactly at the night-entry tick, and comes back dark', async () => {
    const { env, local, session } = start(ON);
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR - TICK_MS);
    expect(env.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(state()).toBe('night');
    expect(env.reload).toHaveBeenCalledTimes(1);
    expect(local.getItem(KIOSK_LAST_RELOAD_KEY)).toBe('2026-10-05');
    expect(session.getItem(KIOSK_RESUME_KEY)).toBe('night');
  });

  test('never later in night, and once a day only', async () => {
    const { env } = start(ON);
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR);
    expect(env.reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20 * HOUR);
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  test('already reloaded today: the night step reloads nothing', async () => {
    const { env, local } = start(ON);
    local.setItem(KIOSK_LAST_RELOAD_KEY, '2026-10-05');
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR + MIN);
    expect(state()).toBe('night');
    expect(env.reload).not.toHaveBeenCalled();
  });

  test('a field focused when it went to rest holds the night reload back (somebody was typing), the cover holding the focus', async () => {
    const { env } = start(ON);
    const input = document.createElement('input');
    const cover = document.createElement('div');
    cover.tabIndex = 0;
    document.body.append(input, cover);
    input.focus();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(state()).toBe('rest');
    cover.focus();   // what RestScreen does as it appears
    await vi.advanceTimersByTimeAsync(HOUR + MIN);
    expect(state()).toBe('night');
    expect(env.reload).not.toHaveBeenCalled();
  });

  test('a waiting update is let in at the night step through the shell: the hold is let go, the resume written, the kiosk reloads nothing itself', async () => {
    const { env, local, session } = start(ON, { updateWaiting: vi.fn(async () => true) });
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR - TICK_MS);
    expect(isBusy()).toBe(true);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(state()).toBe('night');
    expect(env.updateWaiting).toHaveBeenCalled();
    expect(isBusy(), 'the shell’s update path may go in now').toBe(false);
    expect(session.getItem(KIOSK_RESUME_KEY)).toBe('night');
    expect(local.getItem(KIOSK_LAST_RELOAD_KEY)).toBe('2026-10-05');
    expect(env.reload, 'the update replaces the daily reload').not.toHaveBeenCalled();
  });

  test('no reload came within the stall time: the hold is taken again and the resume forgotten', async () => {
    const { session } = start(ON, { updateWaiting: vi.fn(async () => true) });
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR);
    expect(isBusy()).toBe(false);
    await vi.advanceTimersByTimeAsync(RELOAD_STALL_MS);
    expect(isBusy()).toBe(true);
    expect(session.getItem(KIOSK_RESUME_KEY)).toBeNull();
    expect(state()).toBe('night');
  });

  test('somebody else busy at the night step: no update, no reload', async () => {
    const { env } = start(ON, { updateWaiting: vi.fn(async () => true) });
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR - TICK_MS);
    const release = markBusy();
    try {
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(state()).toBe('night');
      expect(env.reload).not.toHaveBeenCalled();
      release();
      await vi.advanceTimersByTimeAsync(HOUR);
      expect(env.reload, 'never later in night').not.toHaveBeenCalled();
      expect(isBusy(), 'the cover still holds').toBe(true);
    } finally { release(); }
  });

  test('the daily reload that never comes: the hold is taken again, the resume forgotten', async () => {
    const { env, session } = start(ON);
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR);
    expect(env.reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RELOAD_STALL_MS);
    expect(isBusy(), 'never a cover without the marker').toBe(true);
    expect(session.getItem(KIOSK_RESUME_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  test('a release that arrived later in night is let in by the waking tap, under the cover saying «reloading»', async () => {
    let waiting = false;
    const { env, local } = start(ON, { updateWaiting: vi.fn(async () => waiting) });
    local.setItem(KIOSK_LAST_RELOAD_KEY, '2026-10-05');   // today's reload already done
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR + MIN);
    expect(state()).toBe('night');
    waiting = true;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(isBusy(), 'still nothing under the cover').toBe(true);
    controller?.wakeTap(false);
    expect(controller?.getSnapshot()).toMatchObject({ state: 'night', reloading: true });
    expect(isBusy(), 'the shell’s update path may go in').toBe(false);
    expect(env.reload, 'the shell reloads, not the kiosk').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RELOAD_STALL_MS);
    expect(state(), 'no reload came: the app is given back').toBe('active');
  });

  test('woken while the update is on its way: the page comes back lit, not dark', async () => {
    const { session } = start(ON, { updateWaiting: vi.fn(async () => true) });
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR);
    expect(session.getItem(KIOSK_RESUME_KEY)).toBe('night');
    controller?.wakeTap(false);
    expect(session.getItem(KIOSK_RESUME_KEY)).toBeNull();
  });

  test('end to end with the shell’s own watcher: no update under the cover, the worker let in at the night step', async () => {
    const posted: unknown[] = [];
    const reg = Object.assign(new EventTarget(), {
      waiting: { postMessage: (message: unknown) => { posted.push(message); } },
      installing: null,
      update: () => Promise.resolve(),
    });
    const container = Object.assign(new EventTarget(), { controller: {}, register: () => Promise.resolve(reg) });
    const shellReload = vi.fn();
    const swEnv: ServiceWorkerEnv = {
      container: container as unknown as ServiceWorkerContainer,
      scriptUrl: '/mise_app/sw.js',
      scope: '/mise_app/',
      isBusy,
      reload: shellReload,
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      setInterval: () => 0,
      onVisible: () => {},
      readStamp: () => null,
      writeStamp: () => {},
    };
    // The kiosk rests first; the release arrives while the cover is up.
    start(ON, { updateWaiting: vi.fn(async () => posted.length === 0) });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(state()).toBe('rest');
    await watchServiceWorker(swEnv);
    await vi.advanceTimersByTimeAsync(HOUR - TICK_MS);
    expect(posted, 'never under the rest cover').toEqual([]);
    await vi.advanceTimersByTimeAsync(TICK_MS + BUSY_RETRY_MS);
    expect(state()).toBe('night');
    expect(posted).toEqual([{ action: 'skipWaiting' }]);
    container.dispatchEvent(new Event('controllerchange'));
    await vi.advanceTimersByTimeAsync(RELOAD_GRACE_MS);
    expect(shellReload).toHaveBeenCalledTimes(1);
  });
});

describe('«Never»: the daily reload on the waking tap', () => {
  test('after 60 minutes of rest the waking tap reloads, the cover saying so, and the page comes back lit', async () => {
    const { env, local, session } = start(NEVER);
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR);
    controller?.wakeTap(false);
    expect(env.reload).toHaveBeenCalledTimes(1);
    expect(controller?.getSnapshot()).toMatchObject({ state: 'rest', reloading: true });
    expect(local.getItem(KIOSK_LAST_RELOAD_KEY)).toBe('2026-10-05');
    expect(session.getItem(KIOSK_RESUME_KEY)).toBeNull();
  });

  test('before 60 minutes, or once already today, the tap only wakes', async () => {
    const { env, local } = start(NEVER);
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR - MIN);
    controller?.wakeTap(false);
    expect(env.reload).not.toHaveBeenCalled();
    expect(state()).toBe('active');
    local.setItem(KIOSK_LAST_RELOAD_KEY, '2026-10-05');
    await vi.advanceTimersByTimeAsync(5 * MIN + 2 * HOUR);
    controller?.wakeTap(false);
    expect(env.reload).not.toHaveBeenCalled();
  });

  test('a reload that stalls gives the app back after a while', async () => {
    start(NEVER);
    await vi.advanceTimersByTimeAsync(5 * MIN + HOUR);
    controller?.wakeTap(false);
    expect(state()).toBe('rest');
    await vi.advanceTimersByTimeAsync(RELOAD_STALL_MS);
    expect(state()).toBe('active');
  });
});

describe('a page reloaded by the kiosk itself', () => {
  test('comes back dark in night: the cover up, the marker held, no screen lock', () => {
    sessionStorage.setItem(KIOSK_RESUME_KEY, 'night');
    const world = makeEnv({ session: () => sessionStorage });
    controller = createKioskController(world.env);
    controller.setSession({ status: 'loading', signedIn: false });
    controller.applySettings(ON);
    expect(state()).toBe('night');
    expect(isBusy()).toBe(true);
    expect(world.lock.held).toBe(false);
    expect(sessionStorage.getItem(KIOSK_RESUME_KEY), 'read once').toBeNull();
  });

  test('a stop and start again before the first tick (React replays effects in development) still resumes', () => {
    sessionStorage.setItem(KIOSK_RESUME_KEY, 'night');
    const world = makeEnv({ session: () => sessionStorage });
    controller = createKioskController(world.env);
    controller.setSession({ status: 'loading', signedIn: false });
    controller.applySettings(ON);
    controller.stop();
    controller.applySettings(ON);
    expect(state()).toBe('night');
  });

  test('a session that turns out not to be a working one drops the cover', () => {
    sessionStorage.setItem(KIOSK_RESUME_KEY, 'night');
    const world = makeEnv({ session: () => sessionStorage });
    controller = createKioskController(world.env);
    controller.setSession({ status: 'loading', signedIn: false });
    controller.applySettings(ON);
    controller.setSession({ status: 'signed-out', signedIn: false });
    expect(state()).toBe('active');
  });
});

describe('the focus', () => {
  test('goes back where it was after a key, and after a touch unless it was a text field', async () => {
    start(ON);
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    (document.activeElement as HTMLElement | null)?.blur();
    controller?.wakeTap(true);
    expect(document.activeElement).toBe(button);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    input.blur();
    controller?.wakeTap(false);
    expect(document.activeElement, 'a touch must not pop the keyboard up').not.toBe(input);
  });
});
