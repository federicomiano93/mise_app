// kiosk-model.js — the rules of «kiosk mode» for a lab tablet that stays open all day.
// PURE: no imports, no DOM, the clock is passed in, so every rule is asserted in a test
// (tests/kiosk-model.test.mjs) and js/kiosk.js only has to feed it events.
//
// Three states: 'active' (the app is in use), 'rest' (a dark cover after a few minutes
// without a touch) and 'night' (still covered, but the screen lock is released so
// Android's own timeout can switch the backlight off — the only way a web page can).

export const KIOSK_STORAGE_KEY = 'kiosk-mode';
export const KIOSK_LAST_RELOAD_KEY = 'kiosk-last-reload';
export const KIOSK_RESUME_KEY = 'kiosk-resume';

export const REST_MINUTES_CHOICES = Object.freeze([2, 5, 10, 20]);
export const NIGHT_HOURS_CHOICES = Object.freeze([0, 1, 2, 4]);
export const DEFAULT_KIOSK_SETTINGS = Object.freeze({ enabled: false, restMinutes: 5, nightHours: 1 });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// The work day rolls at 4am, as the pastries do (DAY_START_HOUR in js/log-model.js).
const DAY_START_HOUR = 4;
// The nightly safety reload happens from 03:00 local time, once the tablet is resting.
const RELOAD_FROM_HOUR = 3;

// A JSON string (or null) → safe settings. Never NaN, unknown values → defaults.
export function readKioskSettings(raw) {
  let obj = null;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = null; }
  if (!obj || typeof obj !== 'object') return { ...DEFAULT_KIOSK_SETTINGS };
  // typeof first: Number(null) and Number('') are 0, which would read as «never».
  const rest = typeof obj.restMinutes === 'number' ? obj.restMinutes : NaN;
  const night = typeof obj.nightHours === 'number' ? obj.nightHours : NaN;
  return {
    enabled: obj.enabled === true,
    restMinutes: REST_MINUTES_CHOICES.includes(rest) ? rest : DEFAULT_KIOSK_SETTINGS.restMinutes,
    nightHours: NIGHT_HOURS_CHOICES.includes(night) ? night : DEFAULT_KIOSK_SETTINGS.nightHours,
  };
}

// The text to store for a (possibly partial) change: whatever is stored is read first and
// clamped, so toggling the switch keeps restMinutes/nightHours and vice versa.
export function serializeKioskSettings(stored, change) {
  return JSON.stringify(readKioskSettings({ ...readKioskSettings(stored), ...(change || {}) }));
}

// What state the tablet should be in now, and whether the screen lock should be held.
// Input is handled by the caller (an input sets lastInputAt and state back to 'active');
// here a state of 'rest'/'night' only moves forward with time.
// While busy or signed out the tablet stays active and the idle clock keeps counting, so
// it rests as soon as it is free (decided: the idle time already served is not wasted).
export function nextKioskState({ state, now, lastInputAt, restSince, busy, signedIn, settings } = {}) {
  const s = settings || DEFAULT_KIOSK_SETTINGS;
  const idleFor = Number(now) - Number(lastInputAt);
  let next = state === 'rest' || state === 'night' ? state : 'active';
  if (next === 'active') {
    if (!busy && signedIn && idleFor >= s.restMinutes * MINUTE) next = 'rest';
  } else if (next === 'rest') {
    if (s.nightHours > 0 && Number(now) - Number(restSince) >= s.nightHours * HOUR) next = 'night';
  }
  return { state: next, wakeLock: next !== 'night' };
}

// An update may be applied only while nobody is looking at the screen.
export function shouldAutoUpdate({ state, busy, updateWaiting } = {}) {
  return (state === 'rest' || state === 'night') && !busy && !!updateWaiting;
}

function pad(n) { return String(n).padStart(2, '0'); }
function dayString(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// The 'YYYY-MM-DD' of the work day a moment belongs to: before 04:00 it is still yesterday.
// Same rule as workDayIndex in js/log-model.js (copied: this module imports nothing).
export function workDayDate(now) {
  const d = new Date(Number(now));
  d.setHours(d.getHours() - DAY_START_HOUR);
  return dayString(d);
}

// Once per calendar day: the first time the tablet is resting and free at/after 03:00.
// Returns { reload, day } — `day` is what to store as kiosk-last-reload.
export function shouldNightlyReload({ state, busy, now, lastReloadDay } = {}) {
  const d = new Date(Number(now));
  const day = dayString(d);
  const resting = state === 'rest' || state === 'night';
  const reload = resting && !busy && d.getHours() >= RELOAD_FROM_HOUR && lastReloadDay !== day;
  return { reload, day };
}
