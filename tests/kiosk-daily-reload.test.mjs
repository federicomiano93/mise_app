import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDailyReload } from '../js/kiosk-model.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

test('daily reload: once per day, at the rest→night transition, free and visible', () => {
  const now = new Date(2026, 9, 5, 3, 10).getTime();
  const enter = { prevState: 'rest', state: 'night', restSince: now - HOUR, now, busy: false, signedIn: true,
    visible: true, nightHours: 1, lastReloadDay: '2026-10-04' };
  assert.deepEqual(shouldDailyReload(enter), { reload: true, day: '2026-10-05', resume: 'night' });
  assert.equal(shouldDailyReload({ ...enter, lastReloadDay: '2026-10-05' }).reload, false, 'once per day');
  assert.equal(shouldDailyReload({ ...enter, busy: true }).reload, false);
  assert.equal(shouldDailyReload({ ...enter, signedIn: false }).reload, false);
  assert.equal(shouldDailyReload({ ...enter, visible: false }).reload, false);
  // Not at the transition: already night, still rest, or active — never.
  assert.equal(shouldDailyReload({ ...enter, prevState: 'night' }).reload, false);
  assert.equal(shouldDailyReload({ ...enter, prevState: 'rest', state: 'rest' }).reload, false);
  assert.equal(shouldDailyReload({ ...enter, prevState: 'active', state: 'active' }).reload, false);
});

test('daily reload with «never» night: after 60 minutes of continuous rest, resting again', () => {
  const now = new Date(2026, 9, 5, 14, 0).getTime();
  const rest = { prevState: 'rest', state: 'rest', restSince: now - 60 * MIN, now, busy: false, signedIn: true,
    visible: true, nightHours: 0, lastReloadDay: null };
  assert.deepEqual(shouldDailyReload(rest), { reload: true, day: '2026-10-05', resume: 'rest' });
  assert.equal(shouldDailyReload({ ...rest, restSince: now - 60 * MIN + 1 }).reload, false);
  assert.equal(shouldDailyReload({ ...rest, nightHours: 1 }).reload, false, 'with a night the transition is the trigger');
  assert.equal(shouldDailyReload({ ...rest, state: 'active', prevState: 'active' }).reload, false);
});
