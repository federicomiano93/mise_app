// The rules of kiosk mode (staff slice 5), run against BOTH implementations: the TypeScript port and js/kiosk-model.js, which
// the current app runs. Ported from the model half of tests/kiosk-model.test.mjs, tests/kiosk-daily-reload.test.mjs,
// tests/kiosk-home-band.test.mjs, tests/kiosk-pins.test.mjs and tests/kiosk-slice2.test.mjs.

import { describe, expect, test } from 'vitest';
import * as ported from './kiosk-model';
import * as legacyJs from '../../js/kiosk-model.js';
import { DAY_START_HOUR } from './log-model';

const legacy = legacyJs as unknown as typeof ported;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const S = { enabled: true, restMinutes: 5, nightHours: 1 };
const base = { state: 'active', now: 10 * HOUR, lastInputAt: 10 * HOUR, restSince: 0, busy: false, signedIn: true, settings: S };

describe.each([['the port', ported], ['js/kiosk-model.js', legacy]] as const)('%s', (_name, m) => {
  test('the current app’s own keys', () => {
    expect(m.KIOSK_STORAGE_KEY).toBe('kiosk-mode');
    expect(m.KIOSK_LAST_RELOAD_KEY).toBe('kiosk-last-reload');
    expect(m.KIOSK_RESUME_KEY).toBe('kiosk-resume');
  });

  test('the choices of minutes and hours', () => {
    expect(m.REST_MINUTES_CHOICES).toStrictEqual([2, 5, 10, 20]);
    expect(m.NIGHT_HOURS_CHOICES).toStrictEqual([0, 1, 2, 4]);
    expect(m.DEFAULT_KIOSK_SETTINGS).toStrictEqual({ enabled: false, restMinutes: 5, nightHours: 1 });
  });

  test('rests at exactly restMinutes, not a moment before', () => {
    expect(m.nextKioskState({ ...base, now: base.lastInputAt + 5 * MIN - 1 }).state).toBe('active');
    expect(m.nextKioskState({ ...base, now: base.lastInputAt + 5 * MIN }).state).toBe('rest');
  });

  test('never rests while busy or signed out, and rests as soon as it is free', () => {
    const late = base.lastInputAt + 30 * MIN;
    expect(m.nextKioskState({ ...base, now: late, busy: true }).state).toBe('active');
    expect(m.nextKioskState({ ...base, now: late, signedIn: false }).state).toBe('active');
    expect(m.nextKioskState({ ...base, now: late }).state).toBe('rest');
  });

  test('night only after nightHours of rest, never with 0', () => {
    const rest = { ...base, state: 'rest', restSince: 100 * HOUR };
    expect(m.nextKioskState({ ...rest, now: 100 * HOUR + HOUR - 1 }).state).toBe('rest');
    expect(m.nextKioskState({ ...rest, now: 100 * HOUR + HOUR }).state).toBe('night');
    expect(m.nextKioskState({ ...rest, now: 150 * HOUR, settings: { ...S, nightHours: 0 } }).state).toBe('rest');
  });

  test('wake lock is held in active and rest, released in night', () => {
    expect(m.nextKioskState(base).wakeLock).toBe(true);
    expect(m.nextKioskState({ ...base, state: 'rest', restSince: base.now }).wakeLock).toBe(true);
    expect(m.nextKioskState({ ...base, state: 'night', restSince: 0 }).wakeLock).toBe(false);
  });

  test('no wake lock when signed out, in any state', () => {
    expect(m.nextKioskState({ ...base, signedIn: false }).wakeLock).toBe(false);
    expect(m.nextKioskState({ ...base, state: 'rest', restSince: base.now, signedIn: false }).wakeLock).toBe(false);
  });

  test('night stays night until an input (the runtime sets active)', () => {
    expect(m.nextKioskState({ ...base, state: 'night', restSince: 0 }).state).toBe('night');
  });

  test('no settings means the defaults; an unknown state reads as active', () => {
    expect(m.nextKioskState({ ...base, settings: null, now: base.lastInputAt + 5 * MIN }).state).toBe('rest');
    expect(m.nextKioskState({ ...base, state: 'asleep' }).state).toBe('active');
  });

  test('auto-update only at the night ENTRY, free and an update is waiting — never under the rest cover', () => {
    const ok = { prevState: 'rest', state: 'night', busy: false, updateWaiting: true };
    expect(m.shouldAutoUpdate(ok)).toBe(true);
    expect(m.shouldAutoUpdate({ ...ok, prevState: 'night' }), 'later in night the update waits for the wake').toBe(false);
    expect(m.shouldAutoUpdate({ ...ok, state: 'rest' }), 'a reload in rest switches the screen off at once').toBe(false);
    expect(m.shouldAutoUpdate({ ...ok, state: 'active' })).toBe(false);
    expect(m.shouldAutoUpdate({ ...ok, busy: true })).toBe(false);
    expect(m.shouldAutoUpdate({ ...ok, updateWaiting: false })).toBe(false);
    expect(m.shouldAutoUpdate()).toBe(false);
  });

  test('work day rolls at 04:00', () => {
    expect(m.workDayDate(new Date(2026, 9, 5, 3, 59).getTime())).toBe('2026-10-04');
    expect(m.workDayDate(new Date(2026, 9, 5, 4, 0).getTime())).toBe('2026-10-05');
    expect(m.workDayDate(new Date(2026, 0, 1, 1, 0).getTime())).toBe('2025-12-31');
  });

  test('settings are clamped: garbage, missing, out of range', () => {
    expect(m.readKioskSettings(null)).toStrictEqual(m.DEFAULT_KIOSK_SETTINGS);
    expect(m.readKioskSettings('not json')).toStrictEqual(m.DEFAULT_KIOSK_SETTINGS);
    expect(m.readKioskSettings('42')).toStrictEqual(m.DEFAULT_KIOSK_SETTINGS);
    expect(m.readKioskSettings('{"enabled":true}')).toStrictEqual({ enabled: true, restMinutes: 5, nightHours: 1 });
    expect(m.readKioskSettings('{"enabled":"yes","restMinutes":3,"nightHours":9}')).toStrictEqual(m.DEFAULT_KIOSK_SETTINGS);
    expect(m.readKioskSettings('{"enabled":true,"restMinutes":20,"nightHours":0}')).toStrictEqual({ enabled: true, restMinutes: 20, nightHours: 0 });
    expect(m.readKioskSettings('{"enabled":true,"restMinutes":"x","nightHours":null}')).toStrictEqual({ enabled: true, restMinutes: 5, nightHours: 1 });
    expect(m.DEFAULT_KIOSK_SETTINGS.enabled).toBe(false);
  });

  test('a read is a fresh object, never the frozen default itself', () => {
    const read = m.readKioskSettings(null);
    expect(read).not.toBe(m.DEFAULT_KIOSK_SETTINGS);
    expect(Object.isFrozen(read)).toBe(false);
  });

  test('saving a change keeps the other kiosk settings', () => {
    const stored = JSON.stringify({ enabled: true, restMinutes: 20, nightHours: 4 });
    expect(m.readKioskSettings(m.serializeKioskSettings(stored, { enabled: false })))
      .toStrictEqual({ enabled: false, restMinutes: 20, nightHours: 4 });
    expect(m.readKioskSettings(m.serializeKioskSettings(null, { enabled: true })))
      .toStrictEqual({ enabled: true, restMinutes: 5, nightHours: 1 });
    expect(m.readKioskSettings(m.serializeKioskSettings('garbage', { nightHours: 0 })))
      .toStrictEqual({ enabled: false, restMinutes: 5, nightHours: 0 });
    expect(m.readKioskSettings(m.serializeKioskSettings(stored, { restMinutes: 7 })))
      .toStrictEqual({ enabled: true, restMinutes: 5, nightHours: 4 });
  });

  test('the stored text has the current app’s shape, key for key', () => {
    expect(m.serializeKioskSettings(null, { enabled: true })).toBe('{"enabled":true,"restMinutes":5,"nightHours":1}');
    expect(m.serializeKioskSettings('{"enabled":true,"restMinutes":20,"nightHours":4,"extra":1}', { nightHours: 0 }))
      .toBe('{"enabled":true,"restMinutes":20,"nightHours":0}');
    expect(m.serializeKioskSettings(null)).toBe('{"enabled":false,"restMinutes":5,"nightHours":1}');
  });

  test('daily reload: once per day, at the rest→night transition, free and visible', () => {
    const now = new Date(2026, 9, 5, 3, 10).getTime();
    const enter = { prevState: 'rest', state: 'night', restSince: now - HOUR, now, busy: false, signedIn: true,
      visible: true, nightHours: 1, lastReloadDay: '2026-10-04' };
    expect(m.shouldDailyReload(enter)).toStrictEqual({ reload: true, day: '2026-10-05', resume: 'night' });
    expect(m.shouldDailyReload({ ...enter, lastReloadDay: '2026-10-05' }).reload, 'once per day').toBe(false);
    expect(m.shouldDailyReload({ ...enter, busy: true }).reload).toBe(false);
    expect(m.shouldDailyReload({ ...enter, signedIn: false }).reload).toBe(false);
    expect(m.shouldDailyReload({ ...enter, visible: false }).reload).toBe(false);
    // Not at the transition: already night, still rest, or active — never.
    expect(m.shouldDailyReload({ ...enter, prevState: 'night' }).reload).toBe(false);
    expect(m.shouldDailyReload({ ...enter, prevState: 'rest', state: 'rest' }).reload).toBe(false);
    expect(m.shouldDailyReload({ ...enter, prevState: 'active', state: 'active' }).reload).toBe(false);
    expect(m.shouldDailyReload({ ...enter, busy: true })).toStrictEqual({ reload: false, day: '2026-10-05', resume: null });
  });

  test('⚠ with «never» night there is NO reload under the rest cover, however long it rests', () => {
    const now = new Date(2026, 9, 5, 14, 0).getTime();
    const rest = { prevState: 'rest', state: 'rest', restSince: now - 60 * MIN, now, busy: false, signedIn: true,
      visible: true, nightHours: 0, lastReloadDay: null };
    expect(m.shouldDailyReload(rest).reload, '60 minutes').toBe(false);
    expect(m.shouldDailyReload({ ...rest, restSince: now - 5 * HOUR }).reload, '5 hours').toBe(false);
  });

  test('reload on the waking tap: nightHours 0, rested 60 minutes or more, free, signed in, once a day', () => {
    const now = new Date(2026, 9, 5, 14, 0).getTime();
    const tap = { state: 'rest', restSince: now - 60 * MIN, now, busy: false, signedIn: true, nightHours: 0, lastReloadDay: '2026-10-04' };
    expect(m.REST_RELOAD_MINUTES).toBe(60);
    expect(m.shouldReloadOnWake(tap)).toStrictEqual({ reload: true, day: '2026-10-05' });
    expect(m.shouldReloadOnWake({ ...tap, restSince: now - 5 * HOUR }).reload).toBe(true);
    expect(m.shouldReloadOnWake({ ...tap, lastReloadDay: null }).reload).toBe(true);
    expect(m.shouldReloadOnWake({ ...tap, restSince: now - 60 * MIN + 1 }).reload, 'one millisecond short').toBe(false);
    expect(m.shouldReloadOnWake({ ...tap, nightHours: 1 }).reload, 'with a night the transition is the trigger').toBe(false);
    expect(m.shouldReloadOnWake({ ...tap, lastReloadDay: '2026-10-05' }).reload, 'already today').toBe(false);
    expect(m.shouldReloadOnWake({ ...tap, busy: true }).reload).toBe(false);
    expect(m.shouldReloadOnWake({ ...tap, signedIn: false }).reload).toBe(false);
    expect(m.shouldReloadOnWake({ ...tap, state: 'night' }).reload).toBe(false);
    expect(m.shouldReloadOnWake({ ...tap, state: 'active' }).reload).toBe(false);
  });

  test('the Home band (slice 6) is shown only where kiosk mode is on, and survives garbage', () => {
    expect(m.kioskBandVisible(null)).toBe(false);
    expect(m.kioskBandVisible('not json')).toBe(false);
    expect(m.kioskBandVisible(m.serializeKioskSettings(null, { enabled: false }))).toBe(false);
    expect(m.kioskBandVisible(m.serializeKioskSettings(null, { enabled: true }))).toBe(true);
  });

  test('Rest now (slice 6): only on a kiosk device, signed in, not already resting', () => {
    expect(m.shouldRestNow({ enabled: true, signedIn: true, state: 'active' })).toBe(true);
    expect(m.shouldRestNow({ enabled: false, signedIn: true, state: 'active' })).toBe(false);
    expect(m.shouldRestNow({ enabled: true, signedIn: false, state: 'active' })).toBe(false);
    expect(m.shouldRestNow({ enabled: true, signedIn: true, state: 'rest' })).toBe(false);
    expect(m.shouldRestNow({ enabled: true, signedIn: true, state: 'night' })).toBe(false);
    expect(m.shouldRestNow()).toBe(false);
  });

  test('the waking tap is armed after the guard of the button that raised the cover, at once otherwise', () => {
    const now = 1_000_000;
    expect(m.REST_NOW_GUARD_MS).toBe(400);
    expect(m.wakeArmDelay(now + m.REST_NOW_GUARD_MS, now)).toBe(m.REST_NOW_GUARD_MS);
    expect(m.wakeArmDelay(now + 100, now)).toBe(100);
    expect(m.wakeArmDelay(now - 1, now)).toBe(0);
    expect(m.wakeArmDelay(0, now)).toBe(0);
  });

  test('Exit (slice 6): closing refused means the page is still visible after the pause', () => {
    expect(m.EXIT_CHECK_MS).toBe(500);
    expect(m.exitRefused({ visibilityState: 'visible', closed: false })).toBe(true);
    expect(m.exitRefused({ visibilityState: 'hidden', closed: false })).toBe(false);
    expect(m.exitRefused({ visibilityState: 'visible', closed: true })).toBe(false);
  });
});

test('the work day rolls at the hour log-model.ts uses (the original copies the number)', () => {
  expect(DAY_START_HOUR).toBe(4);
});
