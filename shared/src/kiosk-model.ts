// kiosk-model.ts — the rules of «kiosk mode» for a lab tablet that stays open all day. PURE: no DOM, the clock is passed in.
//
// TypeScript port of js/kiosk-model.js for Mise 2 (staff slice 5). Behaviour is identical, input for input:
// kiosk-model.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and odd-inputs.spec.ts feeds
// both the inputs nobody planned for. The comments below are the ones the original paid for in bugs. A quirk is copied, not
// tidied: a fix is a fix to BOTH files at once.
//
// Three states: 'active' (the app is in use), 'rest' (a dark cover after a few minutes without a touch) and 'night' (still
// covered, but the screen lock is released so Android's own timeout can switch the backlight off — the only way a web page can).
//
// The keys are the current app's, with the current app's meaning: a tablet in kiosk mode at the switch stays in kiosk mode.
// `kiosk-mode` and `kiosk-last-reload` are localStorage keys of the DEVICE and start with `kiosk-`, a KEEP_PREFIXES prefix
// (local-data.ts), so a sign-out or a venue switch keeps them; `kiosk-resume` is a sessionStorage key.

import { DAY_START_HOUR } from './log-model';

export const KIOSK_STORAGE_KEY = 'kiosk-mode';
export const KIOSK_LAST_RELOAD_KEY = 'kiosk-last-reload';
export const KIOSK_RESUME_KEY = 'kiosk-resume';

export const REST_MINUTES_CHOICES: readonly number[] = Object.freeze([2, 5, 10, 20]);
export const NIGHT_HOURS_CHOICES: readonly number[] = Object.freeze([0, 1, 2, 4]);

export interface KioskSettings {
  readonly enabled: boolean;
  readonly restMinutes: number;
  readonly nightHours: number;
}
export const DEFAULT_KIOSK_SETTINGS: KioskSettings = Object.freeze({ enabled: false, restMinutes: 5, nightHours: 1 });

export type KioskState = 'active' | 'rest' | 'night';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// The work day rolls at 4am, as the pastries do (DAY_START_HOUR of log-model.ts; the original copies the number, js/log-model.js).

// A JSON string (or null) → safe settings. Never NaN, unknown values → defaults.
export function readKioskSettings(raw: unknown): { enabled: boolean; restMinutes: number; nightHours: number } {
  let obj: unknown = null;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = null; }
  if (!obj || typeof obj !== 'object') return { ...DEFAULT_KIOSK_SETTINGS };
  const o = obj as { enabled?: unknown; restMinutes?: unknown; nightHours?: unknown };
  // typeof first: Number(null) and Number('') are 0, which would read as «never».
  const rest = typeof o.restMinutes === 'number' ? o.restMinutes : NaN;
  const night = typeof o.nightHours === 'number' ? o.nightHours : NaN;
  return {
    enabled: o.enabled === true,
    restMinutes: REST_MINUTES_CHOICES.includes(rest) ? rest : DEFAULT_KIOSK_SETTINGS.restMinutes,
    nightHours: NIGHT_HOURS_CHOICES.includes(night) ? night : DEFAULT_KIOSK_SETTINGS.nightHours,
  };
}

// The text to store for a (possibly partial) change: whatever is stored is read first and clamped, so toggling the switch keeps
// restMinutes/nightHours and vice versa.
export function serializeKioskSettings(stored: unknown, change?: unknown): string {
  return JSON.stringify(readKioskSettings({ ...readKioskSettings(stored), ...((change || {}) as object) }));
}

export interface KioskStateInput {
  readonly state?: unknown;
  readonly now?: unknown;
  readonly lastInputAt?: unknown;
  readonly restSince?: unknown;
  readonly busy?: unknown;
  readonly signedIn?: unknown;
  readonly settings?: { readonly restMinutes: number; readonly nightHours: number } | null;
}

// What state the tablet should be in now, and whether the screen lock should be held.
// Input is handled by the caller (an input sets lastInputAt and state back to 'active'); here a state of 'rest'/'night' only
// moves forward with time.
// While busy or signed out the tablet stays active and the idle clock keeps counting, so it rests as soon as it is free
// (decided: the idle time already served is not wasted).
export function nextKioskState({ state, now, lastInputAt, restSince, busy, signedIn, settings }: KioskStateInput = {}): {
  state: KioskState; wakeLock: boolean;
} {
  const s = settings || DEFAULT_KIOSK_SETTINGS;
  const idleFor = Number(now) - Number(lastInputAt);
  let next: KioskState = state === 'rest' || state === 'night' ? state : 'active';
  if (next === 'active') {
    if (!busy && signedIn && idleFor >= s.restMinutes * MINUTE) next = 'rest';
  } else if (next === 'rest') {
    if (s.nightHours > 0 && Number(now) - Number(restSince) >= s.nightHours * HOUR) next = 'night';
  }
  // No lock in night (so Android can switch the backlight off) and none while signed out (a bright sign-in form all night).
  return { state: next, wakeLock: next !== 'night' && !!signedIn };
}

// The Home's «Rest» button (window event 'kiosk-rest-now'): cover the screen at once, but only for a device where kiosk mode is
// on, a person is signed in, and the cover is not already up. (Mise 2 draws that button in staff slice 6.)
export function shouldRestNow({ enabled, signedIn, state }: { enabled?: unknown; signedIn?: unknown; state?: unknown } = {}): boolean {
  return enabled === true && signedIn === true && state === 'active';
}

// ⚠️ THE TAP THAT PUTS THE SCREEN TO REST MUST NOT WAKE IT. The cover is shown from inside that tap's own click, and a key press on
// the button (Enter fires the click on keydown, so a repeat keydown follows) or a late touch event of the same gesture would reach
// the new cover and wake it at once. So the waking tap is armed only after this pause.
export const REST_NOW_GUARD_MS = 400;

// How long to wait before arming the waking tap: 0 normally, the rest of the pause when the cover was raised by the button.
export function wakeArmDelay(guardUntil: unknown, now: unknown): number {
  const left = Number(guardUntil) - Number(now);
  return left > 0 ? left : 0;
}

// An update may be applied by itself only at the moment the tablet ENTERS night (rest → night), when the screen is going off
// anyway and the page is about to reload for the day regardless.
// ⚠️ NEVER in 'rest': the screen is kept on there by the Wake Lock alone, while Android's own timeout counts from the last TOUCH —
// so any reload under the rest cover drops the lock for a few seconds, Android sees the timeout long expired and switches the
// screen off at once (the lock screen comes up although the setting says «never»).
// ⚠️ NOT later in night either: there the lock is released, Android has switched the screen off and timers freeze, so a visible
// page means somebody pressed the power button — a reload then happens in front of the baker and comes back dark. An update
// arriving later waits for the wake.
export function shouldAutoUpdate({ prevState, state, busy, updateWaiting }: {
  prevState?: unknown; state?: unknown; busy?: unknown; updateWaiting?: unknown;
} = {}): boolean {
  return prevState === 'rest' && state === 'night' && !busy && !!updateWaiting;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }
function dayString(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// The 'YYYY-MM-DD' of the work day a moment belongs to: before 04:00 it is still yesterday. Same rule as workDayIndex in
// log-model.ts.
export function workDayDate(now: unknown): string {
  const d = new Date(Number(now));
  d.setHours(d.getHours() - DAY_START_HOUR);
  return dayString(d);
}

// The caller may hand in more than these (the original's runtime passes one object to several rules).
export interface DailyReloadInput {
  readonly [key: string]: unknown;
  readonly prevState?: unknown;
  readonly state?: unknown;
  readonly now?: unknown;
  readonly busy?: unknown;
  readonly signedIn?: unknown;
  readonly visible?: unknown;
  readonly lastReloadDay?: unknown;
}

// The daily safety reload — once per calendar day, and only while nobody is looking: at the moment the tablet ENTERS night
// (rest → night) it reloads and comes back dark (resume 'night', no wake lock — the screen is going off anyway).
// ⚠️ NEVER in 'rest' (see shouldAutoUpdate: a reload under the cover switches the screen off at once, because Android's timeout
// counts from the last touch). With nightHours 0 there is no night, so that venue's daily reload happens on the WAKING TAP instead
// (shouldReloadOnWake). Never in 'active'.
// ⚠️ NOT «the first rest after 03:00»: that reloaded in front of a baker reading a recipe at 03:10, and with the screen off Android
// freezes timers, so it fired when somebody lit the screen in the morning.
// `busy` here includes a focused text field; `visible` is the page's visibility.
// Returns { reload, day, resume } — `day` is what to store as kiosk-last-reload.
export const REST_RELOAD_MINUTES = 60;
export function shouldDailyReload({ prevState, state, now, busy, signedIn, visible, lastReloadDay }: DailyReloadInput = {}): {
  reload: boolean; day: string; resume: 'night' | null;
} {
  const day = dayString(new Date(Number(now)));
  const no = { reload: false, day, resume: null };
  if (busy || !signedIn || !visible || lastReloadDay === day) return no;
  if (prevState === 'rest' && state === 'night') return { reload: true, day, resume: 'night' };
  return no;
}

export interface WakeReloadInput {
  readonly state?: unknown;
  readonly restSince?: unknown;
  readonly now?: unknown;
  readonly busy?: unknown;
  readonly signedIn?: unknown;
  readonly nightHours?: unknown;
  readonly lastReloadDay?: unknown;
}

// «Never switch off» (nightHours 0): the daily reload is done by the tap that wakes a cover which has rested for
// REST_RELOAD_MINUTES or more, once per calendar day. That tap is a touch, so Android keeps the screen on through the reload; the
// page comes back 'active' (no resume). `state` is the state BEFORE waking. Returns { reload, day }.
export function shouldReloadOnWake({ state, restSince, now, busy, signedIn, nightHours, lastReloadDay }: WakeReloadInput = {}): {
  reload: boolean; day: string;
} {
  const day = dayString(new Date(Number(now)));
  const reload = Number(nightHours) === 0 && state === 'rest' && !busy && !!signedIn
    && lastReloadDay !== day
    && Number(now) - Number(restSince) >= REST_RELOAD_MINUTES * MINUTE;
  return { reload, day };
}

// The Home's kiosk band (Rest / Exit) is shown only where kiosk mode is on, whoever signs in. (Staff slice 6.)
export function kioskBandVisible(raw: unknown): boolean {
  return readKioskSettings(raw).enabled;
}

// «Exit» asks the browser to close the page; an installed PWA on many tablets refuses. After this pause the page being STILL there
// (open and visible) means it refused, and the person is told how to close it by hand — kiosk mode itself is never switched off by
// that button. (Staff slice 6.)
export const EXIT_CHECK_MS = 500;
export function exitRefused({ visibilityState, closed }: { visibilityState?: unknown; closed?: unknown } = {}): boolean {
  return visibilityState === 'visible' && closed !== true;
}
