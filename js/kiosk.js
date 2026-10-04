// kiosk.js — «kiosk mode» for a lab tablet that stays open all day. Loaded on every page
// that loads js/sw-update.js (never on order.html, the client's page). The rules live in
// js/kiosk-model.js (pure, tested); this file only feeds them events and draws the cover.
//
// OFF BY DEFAULT, and when it is off this file does nothing beyond reading one
// localStorage key. The setting belongs to the DEVICE (localStorage, kept across
// sign-out — see KEEP_PREFIXES in js/local-data.js), never to a venue or a person.
// No Firestore reads or writes anywhere here.
//
// After a few minutes without a touch a black rest screen covers the app; after a longer
// while the screen lock is let go so Android can switch the backlight off. One tap wakes
// it WITHOUT reaching what is underneath.
//
// Pause drawing while resting: deliberately NOT coupled to the Orders render scheduler.
// The cover is enough, and Orders keeps its live data so the rest screen is fresh.

import { t, onLanguageChange, localeTag } from './i18n.js';
import { BUSY_SELECTORS, MAX_ATTEMPTS, readAttempts } from './update-gate.js';
import { acquireWakeLock, releaseWakeLock } from './wake-lock.js';
import {
  KIOSK_STORAGE_KEY, KIOSK_LAST_RELOAD_KEY, KIOSK_RESUME_KEY,
  readKioskSettings, nextKioskState, shouldAutoUpdate, shouldDailyReload, workDayDate,
} from './kiosk-model.js';

const TICK_MS = 15 * 1000;
const FADE_MS = 200;
// After the finger LIFTS (or the gesture is cancelled) the cover wakes if no `click`
// followed: on Android, preventDefault() on touchstart suppresses the click, so this
// timer is the normal wake path on a tablet, and the click is the path for a mouse.
const LIFT_WAIT_MS = 700;
const SHIFT_PX = 6;
const WAKE_OWNER = 'kiosk';
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
const SWALLOWED = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup',
  'touchstart', 'touchend', 'touchcancel', 'click'];
const LIFTED = ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel'];

// ── The waking tap ───────────────────────────────────────────────────────────
//
// ⚠️ THE TAP THAT WAKES THE SCREEN MUST NOT PRESS WHAT IS UNDER IT. Every event of the
// gesture that lands on the cover is stopped at the window, in the capture phase, before
// anything below can see it; and the cover is removed only after the finger has lifted
// (a `click` ends it at once, otherwise LIFT_WAIT_MS later), so a ghost click cannot fall
// through onto the button beneath, and a long press stays swallowed until it ends.
// Events aimed at something else (the update banner, 9999) pass.
// A key press wakes it too, and the key is swallowed — but only a key aimed at the cover
// itself (or the page body); a key meant for a dialog or gate above passes untouched.
// onWake(viaKey) tells the caller how it was woken.
//
// ⚠️ The default timers are arrow functions on purpose: handing the native setTimeout
// over as a method of an object calls it with the wrong `this` («Illegal invocation»),
// and then the tablet's cover would never wake on touch.
export function armWakeTap(win, overlay, onWake,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) }) {
  let timer = null;
  let done = false;

  function finish(viaKey) {
    if (done) return;
    done = true;
    if (timer !== null) timers.clear(timer);
    disarm();
    onWake(viaKey === true);
  }
  function onPointerish(event) {
    if (!overlay.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click') { finish(false); return; }
    if (LIFTED.includes(event.type) && timer === null) timer = timers.set(() => finish(false), LIFT_WAIT_MS);
  }
  function onKey(event) {
    const target = event.target;
    const doc = win.document;
    const ours = overlay.contains(target) || (doc && (target === doc.body || target === doc.documentElement));
    if (!ours) return;
    event.preventDefault();
    event.stopPropagation();
    finish(true);
  }
  function onWheel() { finish(false); }

  function disarm() {
    SWALLOWED.forEach(type => win.removeEventListener(type, onPointerish, true));
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('wheel', onWheel, true);
  }

  SWALLOWED.forEach(type => win.addEventListener(type, onPointerish, { capture: true, passive: false }));
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('wheel', onWheel, { capture: true, passive: true });
  return disarm;
}

// ── State ────────────────────────────────────────────────────────────────────

let state = 'active';
let settings = null;
let lastInputAt = 0;
let restSince = 0;
let venueName = '';
let sessionStatus = 'loading';
let overlay = null;
let overlayParts = null;
let disarmWake = null;
let tickTimer = null;
let lockHeld = false;
let updating = false;
let unsubLanguage = null;
let unsubSession = null;
let started = false;
let startToken = 0;
let shiftStep = 0;
let lastShiftMinute = -1;
let focusBeforeRest = null;
let updateNowImpl = async () => { const mod = await import('./sw-update.js'); await mod.updateNow(); };

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function hhmm(date) {
  return new Intl.DateTimeFormat(localeTag(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function longDate(date) {
  return new Intl.DateTimeFormat(localeTag(), { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}
function sameDayAsLocal(iso, date) {
  const p = n => String(n).padStart(2, '0');
  return iso === `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function line(className, text) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

// Pages add lines with no import between features: a window event, handled synchronously.
function collectExtraLines() {
  const detail = { lines: [] };
  try { window.dispatchEvent(new CustomEvent('kiosk-rest-info', { detail })); } catch { /* ignore */ }
  return detail.lines.filter(x => typeof x === 'string' && x !== '');
}

function paintRest() {
  if (!overlay) return;
  const now = new Date();
  const parts = overlayParts;
  parts.time.textContent = hhmm(now);
  parts.date.textContent = longDate(now);
  parts.venue.textContent = venueName;
  parts.venue.hidden = venueName === '';
  const day = workDayDate(now.getTime());
  const showDay = !sameDayAsLocal(day, now);
  parts.workDay.hidden = !showDay;
  if (showDay) {
    const [y, m, d] = day.split('-').map(Number);
    parts.workDay.textContent = t('kiosk.rest.workDay', { date: longDate(new Date(y, m - 1, d)) });
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  parts.offline.hidden = !offline;
  parts.offline.textContent = offline ? t('kiosk.rest.offline') : '';
  parts.extra.textContent = '';
  collectExtraLines().forEach(text => parts.extra.append(line('kiosk-rest-line', text)));
  const tap = t('kiosk.rest.tap');
  parts.tap.textContent = tap;
  overlay.setAttribute('aria-label', tap);
  // Burn-in: the block moves a few pixels when the MINUTE changes (the paint itself runs
  // on every 15 s tick), by transform only.
  const minute = Math.floor(now.getTime() / 60000);
  if (minute !== lastShiftMinute) {
    lastShiftMinute = minute;
    shiftStep = (shiftStep + 1) % 4;
    const dx = (shiftStep % 2 === 0 ? -1 : 1) * SHIFT_PX;
    const dy = (shiftStep < 2 ? -1 : 1) * SHIFT_PX;
    parts.block.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}

function showRest() {
  if (overlay) return;
  const active = document.activeElement;
  focusBeforeRest = active && active !== document.body ? active : null;
  overlay = document.createElement('div');
  overlay.id = 'kiosk-rest';
  overlay.className = 'kiosk-rest';
  // A screen cover, not a dialog: a button that wakes the screen, reachable by keyboard.
  overlay.setAttribute('role', 'button');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.tabIndex = 0;
  const block = document.createElement('div');
  block.className = 'kiosk-rest-block';
  const time = line('kiosk-rest-time', '');
  const date = line('kiosk-rest-line', '');
  const venue = line('kiosk-rest-line', '');
  const workDay = line('kiosk-rest-line', '');
  const offline = line('kiosk-rest-line', '');
  const extra = document.createElement('div');
  const tap = line('kiosk-rest-tap', '');
  block.append(time, date, venue, workDay, offline, extra, tap);
  overlay.append(block);
  overlayParts = { block, time, date, venue, workDay, offline, extra, tap };
  lastShiftMinute = -1;
  document.body.append(overlay);
  paintRest();
  if (reducedMotion() || typeof requestAnimationFrame !== 'function') overlay.classList.add('kiosk-rest--shown');
  else requestAnimationFrame(() => requestAnimationFrame(() => overlay && overlay.classList.add('kiosk-rest--shown')));
  try { overlay.focus({ preventScroll: true }); } catch { /* ignore */ }
  disarmWake = armWakeTap(window, overlay, wake);
}

function hideRest() {
  if (disarmWake) { disarmWake(); disarmWake = null; }
  const gone = overlay;
  overlay = null;
  overlayParts = null;
  if (!gone) return;
  if (reducedMotion()) { gone.remove(); return; }
  gone.classList.remove('kiosk-rest--shown');
  setTimeout(() => gone.remove(), FADE_MS);
}

// ── The state machine, driven ────────────────────────────────────────────────

function typingNow() {
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  const tag = a.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable === true;
}

// ⚠️ THE UPDATE GATE IS NOT WORK. It is `.app-dialog-backdrop` (a BUSY selector) and it
// appears the moment an update waits and the page is free — and the cover's own insertion
// triggers its observer. Counting it as busy would mean the kiosk never updates itself.
function busyBySelectors() {
  return BUSY_SELECTORS.some(selector => {
    for (const el of document.querySelectorAll(selector)) {
      if (!(el.closest && el.closest('#sw-update-gate'))) return true;
    }
    return false;
  });
}

// Signed in and working: a venue is open AND the sign-in cover, the business picker and
// the invitation (all drawn in #auth-gate) are not up.
function isSignedIn() {
  const gate = document.getElementById('auth-gate');
  return sessionStatus === 'ready' && (!gate || gate.childElementCount === 0);
}

function syncLock(wanted) {
  if (wanted && !lockHeld) { lockHeld = true; acquireWakeLock(WAKE_OWNER); }
  else if (!wanted && lockHeld) { lockHeld = false; releaseWakeLock(WAKE_OWNER); }
}

function enter(next) {
  if (next === state) return;
  if (next === 'rest') restSince = Date.now();
  state = next;
  if (state === 'active') hideRest();
  else showRest();
}

function wake(viaKey) {
  const back = focusBeforeRest;
  focusBeforeRest = null;
  lastInputAt = Date.now();
  // A reload already on its way must not bring the cover back to a person who is here.
  if (updating) { try { sessionStorage.removeItem(KIOSK_RESUME_KEY); } catch { /* ignore */ } }
  enter('active');
  syncLock(true);
  // Only after a KEY: refocusing a quantity box after a touch would pop the keyboard.
  if (viaKey === true && back && back.isConnected) {
    try { back.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
}

async function maybeReload(prev, busy, signedIn) {
  if (updating) return;
  const now = Date.now();
  const daily = shouldDailyReload({
    prevState: prev, state, restSince, now, busy, signedIn,
    visible: document.visibilityState === 'visible',
    nightHours: settings.nightHours, lastReloadDay: safeGet(localStorage, KIOSK_LAST_RELOAD_KEY),
  });
  if (daily.reload) {
    updating = true;
    safeSet(localStorage, KIOSK_LAST_RELOAD_KEY, daily.day);
    safeSet(sessionStorage, KIOSK_RESUME_KEY, daily.resume);
    location.reload();
    return;
  }
  if (busy || readAttempts() >= MAX_ATTEMPTS) return;
  if (!('serviceWorker' in navigator)) return;
  let waiting = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    waiting = !!(reg && reg.waiting && navigator.serviceWorker.controller);
  } catch { waiting = false; }
  // The world may have moved while we asked: re-check with the current state.
  const stillBusy = busyBySelectors() || typingNow();
  if (!shouldAutoUpdate({ state, busy: stillBusy, updateWaiting: waiting })) return;
  updating = true;
  safeSet(sessionStorage, KIOSK_RESUME_KEY, state);
  try {
    await updateNowImpl();
  } catch { updating = false; }
}

function tick() {
  if (!settings || !settings.enabled) return;
  const signedIn = isSignedIn();
  // The sign-in, no-access and picker screens make the rest of the page inert, so a cover
  // left up would be a black screen nobody can wake. (While the session is still
  // 'loading' — a page resumed after a reload — the cover is kept.)
  if (state !== 'active' && sessionStatus !== 'loading' && !signedIn) { wake(false); return; }
  const busySelectors = busyBySelectors();
  const prev = state;
  // A focused field does NOT keep the screen on: the cover takes focus, the typed value is
  // already saved (rest needs minutes of silence). It only holds back the reloads.
  const result = nextKioskState({
    state, now: Date.now(), lastInputAt, restSince, busy: busySelectors, signedIn, settings,
  });
  enter(result.state);
  syncLock(result.wakeLock);
  if (state !== 'active') {
    paintRest();
    maybeReload(prev, busySelectors || typingNow(), signedIn);
  }
}

function onSessionChange(session) {
  sessionStatus = (session && session.status) || 'loading';
  venueName = (sessionStatus === 'ready' && (session.name || session.locationId)) || '';
  if (state !== 'active' && sessionStatus !== 'loading' && sessionStatus !== 'ready') wake(false);
  else if (overlay) paintRest();
}

function onInput() {
  // While resting the cover handles the wake; here we only note the touch.
  if (state === 'active') lastInputAt = Date.now();
}
function onVisible() {
  if (document.visibilityState !== 'visible') return;
  // Coming back from another app is not idleness: the clock starts again.
  lastInputAt = Date.now();
  tick();
}

// ── Starting and stopping ────────────────────────────────────────────────────

function safeGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}
function safeSet(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* storage blocked */ }
}

function start() {
  if (started) return;
  started = true;
  const token = ++startToken;
  lastInputAt = Date.now();
  INPUT_EVENTS.forEach(type => document.addEventListener(type, onInput, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', onVisible);
  tickTimer = setInterval(tick, TICK_MS);
  unsubLanguage = onLanguageChange(() => { if (overlay) paintRest(); });
  import('./firebase.js').then(({ onSession }) => {
    // A stop→start while this import was pending must not leave two subscriptions.
    if (!started || token !== startToken) return;
    unsubSession = onSession(onSessionChange);
  }).catch(() => { /* no venue name: the line stays hidden */ });

  // A reload we started ourselves (update, daily) comes back in the state it left, so
  // the screen is not lit up in the middle of the night. It is dropped again as soon as
  // the session turns out not to be a working one (see onSessionChange).
  const resume = safeGet(sessionStorage, KIOSK_RESUME_KEY);
  try { sessionStorage.removeItem(KIOSK_RESUME_KEY); } catch { /* ignore */ }
  if (resume === 'rest' || resume === 'night') {
    restSince = Date.now();
    state = resume;
    showRest();
    syncLock(resume !== 'night');
  } else {
    syncLock(true);
  }
}

function stop() {
  if (!started) return;
  started = false;
  startToken++;
  INPUT_EVENTS.forEach(type => document.removeEventListener(type, onInput, true));
  document.removeEventListener('visibilitychange', onVisible);
  clearInterval(tickTimer);
  tickTimer = null;
  if (unsubLanguage) { unsubLanguage(); unsubLanguage = null; }
  if (unsubSession) { unsubSession(); unsubSession = null; }
  hideRest();
  state = 'active';
  syncLock(false);
}

function applySettings() {
  settings = readKioskSettings(safeGet(localStorage, KIOSK_STORAGE_KEY));
  if (settings.enabled) start();
  else stop();
}

function init() {
  applySettings();
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === KIOSK_STORAGE_KEY) applySettings();
  });
  // The Home settings switch fires this when the setting changes on the SAME page (a
  // `storage` event only reaches other tabs).
  window.addEventListener('kiosk-settings-changed', applySettings);
}

// ⚠️ ONLY FOR TESTS (like __announce in sw-update.js): nothing in the app may call it.
export const __testing = {
  tick,
  session: onSessionChange,
  applySettings,
  state: () => state,
  hasLock: () => lockHeld,
  setUpdater(fn) { updateNowImpl = fn; },
};

// Runs only in a browser; importing this file in node (tests) does nothing.
if (typeof window !== 'undefined' && typeof document !== 'undefined') init();
