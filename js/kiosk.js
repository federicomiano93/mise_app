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
import { isBusy } from './update-gate.js';
import { acquireWakeLock, releaseWakeLock } from './wake-lock.js';
import {
  KIOSK_STORAGE_KEY, KIOSK_LAST_RELOAD_KEY, KIOSK_RESUME_KEY,
  readKioskSettings, nextKioskState, shouldAutoUpdate, shouldNightlyReload, workDayDate,
} from './kiosk-model.js';

const TICK_MS = 15 * 1000;
const FADE_MS = 200;
// If the tap's `click` never arrives (a long press, a cancelled gesture), wake anyway.
const CLICK_WAIT_MS = 700;
const SHIFT_PX = 6;
const WAKE_OWNER = 'kiosk';
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
const SWALLOWED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'];

// ── The waking tap ───────────────────────────────────────────────────────────
//
// ⚠️ THE TAP THAT WAKES THE SCREEN MUST NOT PRESS WHAT IS UNDER IT. Every event of the
// gesture that lands on the cover is stopped at the window, in the capture phase, before
// anything below can see it; and the cover is removed only AFTER that tap's `click`
// (or after CLICK_WAIT_MS if none comes), so the click cannot fall through onto the
// button beneath. Events aimed at something else (the update banner, 9999) pass.
// A key press wakes it too, and the key is swallowed.
export function armWakeTap(win, overlay, onWake, timers = { set: setTimeout, clear: clearTimeout }) {
  let started = false;
  let timer = null;
  let done = false;

  function finish() {
    if (done) return;
    done = true;
    if (timer !== null) timers.clear(timer);
    disarm();
    onWake();
  }
  function onPointerish(event) {
    if (!overlay.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click') { finish(); return; }
    if (!started) {
      started = true;
      timer = timers.set(finish, CLICK_WAIT_MS);
    }
  }
  function onKey(event) {
    event.preventDefault();
    event.stopPropagation();
    // Only Enter/Space/any key wakes; a lone modifier does not matter, the cover is
    // not a form.
    finish();
  }
  function onWheel() { finish(); }

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

// ── The cover ────────────────────────────────────────────────────────────────

let state = 'active';
let settings = null;
let lastInputAt = 0;
let restSince = 0;
let venueName = '';
let overlay = null;
let overlayParts = null;
let disarmWake = null;
let tickTimer = null;
let lockHeld = false;
let updating = false;
let unsubLanguage = null;
let unsubSession = null;
let started = false;
let shiftStep = 0;

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
  // Burn-in: the block moves a few pixels every minute, by transform only.
  shiftStep = (shiftStep + 1) % 4;
  const dx = (shiftStep % 2 === 0 ? -1 : 1) * SHIFT_PX;
  const dy = (shiftStep < 2 ? -1 : 1) * SHIFT_PX;
  parts.block.style.transform = `translate(${dx}px, ${dy}px)`;
}

function showRest() {
  if (overlay) return;
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
  document.body.append(overlay);
  paintRest();
  if (reducedMotion()) overlay.classList.add('kiosk-rest--shown');
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
function isBusyNow() { return isBusy(document) || typingNow(); }

// The sign-in cover, the business picker and the invitation all live in #auth-gate, which
// auth-gate.js empties once a venue is open: nothing in it = signed in and working.
function isSignedIn() {
  const gate = document.getElementById('auth-gate');
  return !gate || gate.childElementCount === 0;
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

function wake() {
  lastInputAt = Date.now();
  enter('active');
  syncLock(true);
}

async function maybeUpdateOrReload(busy) {
  if (updating) return;
  const now = Date.now();
  const nightly = shouldNightlyReload({
    state, busy, now, lastReloadDay: safeGet(localStorage, KIOSK_LAST_RELOAD_KEY),
  });
  if (nightly.reload) {
    updating = true;
    safeSet(localStorage, KIOSK_LAST_RELOAD_KEY, nightly.day);
    safeSet(sessionStorage, KIOSK_RESUME_KEY, state);
    location.reload();
    return;
  }
  if (!('serviceWorker' in navigator)) return;
  let waiting = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    waiting = !!(reg && reg.waiting && navigator.serviceWorker.controller);
  } catch { waiting = false; }
  // The world may have moved while we asked: re-check with the current state.
  if (!shouldAutoUpdate({ state, busy: isBusyNow(), updateWaiting: waiting })) return;
  updating = true;
  safeSet(sessionStorage, KIOSK_RESUME_KEY, state);
  try {
    const mod = await import('./sw-update.js');
    await mod.updateNow();
  } catch { updating = false; }
}

function tick() {
  if (!settings || !settings.enabled) return;
  const busy = isBusyNow();
  const result = nextKioskState({
    state, now: Date.now(), lastInputAt, restSince, busy, signedIn: isSignedIn(), settings,
  });
  enter(result.state);
  syncLock(result.wakeLock);
  if (state !== 'active') {
    paintRest();
    maybeUpdateOrReload(busy);
  }
}

function onInput() {
  // While resting the cover handles the wake; here we only note the touch.
  if (state === 'active') lastInputAt = Date.now();
}
function onVisible() {
  if (document.visibilityState === 'visible') tick();
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
  lastInputAt = Date.now();
  INPUT_EVENTS.forEach(type => document.addEventListener(type, onInput, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', onVisible);
  tickTimer = setInterval(tick, TICK_MS);
  unsubLanguage = onLanguageChange(() => { if (overlay) paintRest(); });
  import('./firebase.js').then(({ onSession }) => {
    if (!started) return;
    unsubSession = onSession(session => {
      venueName = (session && session.status === 'ready' && (session.name || session.locationId)) || '';
      if (overlay) paintRest();
    });
  }).catch(() => { /* no venue name: the line stays hidden */ });

  // A reload we started ourselves (update, nightly) comes back in the state it left, so
  // the screen is not lit up in the middle of the night.
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
  // Slice 2's switch fires this when the setting changes on the SAME page (a `storage`
  // event only reaches other tabs).
  window.addEventListener('kiosk-settings-changed', applySettings);
}

// A top-level subscription must come last (tests/early-session-callback.test.mjs); this
// one is not a subscription to the session, only the start, and runs only in a browser.
if (typeof window !== 'undefined' && typeof document !== 'undefined') init();
