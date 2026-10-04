import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readKioskSettings, nextKioskState, shouldAutoUpdate, workDayDate,
  KIOSK_STORAGE_KEY, DEFAULT_KIOSK_SETTINGS,
} from '../js/kiosk-model.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const S = { enabled: true, restMinutes: 5, nightHours: 1 };
const base = { state: 'active', now: 10 * HOUR, lastInputAt: 10 * HOUR, restSince: 0, busy: false, signedIn: true, settings: S };

test('storage key', () => assert.equal(KIOSK_STORAGE_KEY, 'kiosk-mode'));

test('rests at exactly restMinutes, not a moment before', () => {
  assert.equal(nextKioskState({ ...base, now: base.lastInputAt + 5 * MIN - 1 }).state, 'active');
  assert.equal(nextKioskState({ ...base, now: base.lastInputAt + 5 * MIN }).state, 'rest');
});

test('never rests while busy or signed out, and rests as soon as it is free', () => {
  const late = base.lastInputAt + 30 * MIN;
  assert.equal(nextKioskState({ ...base, now: late, busy: true }).state, 'active');
  assert.equal(nextKioskState({ ...base, now: late, signedIn: false }).state, 'active');
  assert.equal(nextKioskState({ ...base, now: late }).state, 'rest');
});

test('night only after nightHours of rest, never with 0', () => {
  const rest = { ...base, state: 'rest', restSince: 100 * HOUR };
  assert.equal(nextKioskState({ ...rest, now: 100 * HOUR + HOUR - 1 }).state, 'rest');
  assert.equal(nextKioskState({ ...rest, now: 100 * HOUR + HOUR }).state, 'night');
  assert.equal(nextKioskState({ ...rest, now: 150 * HOUR, settings: { ...S, nightHours: 0 } }).state, 'rest');
});

test('wake lock is held in active and rest, released in night', () => {
  assert.equal(nextKioskState(base).wakeLock, true);
  assert.equal(nextKioskState({ ...base, state: 'rest', restSince: base.now }).wakeLock, true);
  assert.equal(nextKioskState({ ...base, state: 'night', restSince: 0 }).wakeLock, false);
});

test('night stays night until an input (the runtime sets active)', () => {
  assert.equal(nextKioskState({ ...base, state: 'night', restSince: 0 }).state, 'night');
});

test('auto-update only when resting, free and an update is waiting', () => {
  const ok = { state: 'rest', busy: false, updateWaiting: true };
  assert.equal(shouldAutoUpdate(ok), true);
  assert.equal(shouldAutoUpdate({ ...ok, state: 'night' }), true);
  assert.equal(shouldAutoUpdate({ ...ok, state: 'active' }), false);
  assert.equal(shouldAutoUpdate({ ...ok, busy: true }), false);
  assert.equal(shouldAutoUpdate({ ...ok, updateWaiting: false }), false);
});


test('work day rolls at 04:00', () => {
  assert.equal(workDayDate(new Date(2026, 9, 5, 3, 59).getTime()), '2026-10-04');
  assert.equal(workDayDate(new Date(2026, 9, 5, 4, 0).getTime()), '2026-10-05');
  assert.equal(workDayDate(new Date(2026, 0, 1, 1, 0).getTime()), '2025-12-31');
});

test('settings are clamped: garbage, missing, out of range', () => {
  assert.deepEqual(readKioskSettings(null), DEFAULT_KIOSK_SETTINGS);
  assert.deepEqual(readKioskSettings('not json'), DEFAULT_KIOSK_SETTINGS);
  assert.deepEqual(readKioskSettings('42'), DEFAULT_KIOSK_SETTINGS);
  assert.deepEqual(readKioskSettings('{"enabled":true}'), { enabled: true, restMinutes: 5, nightHours: 1 });
  assert.deepEqual(readKioskSettings('{"enabled":"yes","restMinutes":3,"nightHours":9}'), DEFAULT_KIOSK_SETTINGS);
  assert.deepEqual(readKioskSettings('{"enabled":true,"restMinutes":20,"nightHours":0}'), { enabled: true, restMinutes: 20, nightHours: 0 });
  assert.deepEqual(readKioskSettings('{"enabled":true,"restMinutes":"x","nightHours":null}'), { enabled: true, restMinutes: 5, nightHours: 1 });
  assert.equal(DEFAULT_KIOSK_SETTINGS.enabled, false);
});
