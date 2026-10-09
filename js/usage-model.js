// usage-model.js — the pure half of the usage record (js/usage.js).
//
// The owner wants to know how the app is used: which screens, for how long, and above all the
// MOVES from one screen to the next — the routes that deserve a shortcut. One person on one
// device keeps ONE small accumulator per day; this file builds it and turns it into the exact
// line the rules accept (firestore.rules, match /usage/{id}).
//
// ⚠️ EVERY MAP IS BOUNDED. The rules cap the size of each map (screens, seconds, taps 80 ·
// routes 300 · actions 40 · loads, loadMs 20). Once a map is one short of its cap, any new key
// is counted under the single key 'other', so a device can never build a line the rules would
// refuse for good (and an unrefusable line is the only one that keeps getting sent).
// ⚠️ EVERY NUMBER IS AN INTEGER, never NaN, clamped at 0 — the rules say `is int`.
//
// Zero imports: the tests run this without a browser.

export const CAPS = Object.freeze({
  screens: 80, seconds: 80, taps: 80, routes: 300, actions: 40, loads: 20, loadMs: 20,
});
export const OTHER = 'other';
export const SCREEN_RE = /^[a-z0-9:-]{1,40}$/;
export const ACTION_RE = /^[a-z][a-z0-9-]{0,39}$/;
export const ROUTE_RE = /^[a-z0-9:-]{1,40}>[a-z0-9:-]{1,40}$/;
export const DAY_KEY_RE = /^20[0-9]{6}$/;
export const KINDS = ['phone', 'tablet', 'computer'];
const VERSION_MAX = 12;
const LOAD_MS_MAX = 60000;
const DAY_SECONDS = 86400;
const MAPS = ['screens', 'seconds', 'taps', 'routes', 'actions', 'loads', 'loadMs'];

export function newAcc() {
  return {
    screens: {}, seconds: {}, taps: {}, routes: {}, actions: {}, loads: {}, loadMs: {},
    firstMinute: null, lastMinute: null, offlineSeconds: 0,
  };
}

function count(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function has(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key);
}

// Adds `n` to `key`, or to 'other' when the map has no room left for a new key.
function bump(map, key, n, cap) {
  if (!n) return;
  let k = key;
  if (!has(map, k)) {
    // One slot is always kept for 'other', so the map never passes its cap.
    if (Object.keys(map).length >= cap - 1) k = OTHER;
  }
  map[k] = (has(map, k) ? map[k] : 0) + n;
}

export function addScreen(acc, name) {
  if (typeof name !== 'string' || !SCREEN_RE.test(name)) return;
  bump(acc.screens, name, 1, CAPS.screens);
}

// A move from one screen to the next. Staying put, or an unnamed end, is not a route.
export function addRoute(acc, from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return;
  if (!from || !to || from === to) return;
  const key = `${from}>${to}`;
  if (!ROUTE_RE.test(key)) return;
  bump(acc.routes, key, 1, CAPS.routes);
}

export function addSeconds(acc, screen, seconds) {
  if (typeof screen !== 'string' || !SCREEN_RE.test(screen)) return;
  bump(acc.seconds, screen, count(seconds), CAPS.seconds);
}

export function addTap(acc, screen) {
  if (typeof screen !== 'string' || !SCREEN_RE.test(screen)) return;
  bump(acc.taps, screen, 1, CAPS.taps);
}

export function addAction(acc, name) {
  if (typeof name !== 'string' || !ACTION_RE.test(name)) return;
  bump(acc.actions, name, 1, CAPS.actions);
}

export function addLoad(acc, page, ms) {
  if (typeof page !== 'string' || !SCREEN_RE.test(page)) return;
  const clamped = Math.min(LOAD_MS_MAX, count(ms));
  bump(acc.loads, page, 1, CAPS.loads);
  bump(acc.loadMs, page, clamped, CAPS.loadMs);
}

export function addOffline(acc, seconds) {
  acc.offlineSeconds = Math.min(DAY_SECONDS, acc.offlineSeconds + count(seconds));
}

// The local minute of the day (0–1439) a person was last seen working; the first one is kept.
export function touchMinute(acc, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
  const minute = date.getHours() * 60 + date.getMinutes();
  if (acc.firstMinute === null || minute < acc.firstMinute) acc.firstMinute = minute;
  if (acc.lastMinute === null || minute > acc.lastMinute) acc.lastMinute = minute;
}

function validMinute(value) {
  return Number.isInteger(value) && value >= 0 && value < 1440 ? value : null;
}

const KEY_OK = {
  screens: k => SCREEN_RE.test(k),
  seconds: k => SCREEN_RE.test(k),
  taps: k => SCREEN_RE.test(k),
  routes: k => k === OTHER || ROUTE_RE.test(k),
  actions: k => ACTION_RE.test(k),
  loads: k => SCREEN_RE.test(k),
  loadMs: k => SCREEN_RE.test(k),
};

// `extra` folded into `base` (which is changed and returned). `extra` may be anything read back
// from storage: unknown keys, bad names and bad numbers are dropped, caps are enforced. This is
// both the merge of a page's new counts into the day's stored ones and the way a stored value
// is made safe before it can reach the rules.
export function mergeAcc(base, extra) {
  const from = extra && typeof extra === 'object' ? extra : {};
  for (const name of MAPS) {
    const source = from[name];
    if (!source || typeof source !== 'object') continue;
    for (const key of Object.keys(source)) {
      if (!KEY_OK[name](key)) continue;
      bump(base[name], key, count(source[key]), CAPS[name]);
    }
  }
  const first = validMinute(from.firstMinute);
  const last = validMinute(from.lastMinute);
  if (first !== null && (base.firstMinute === null || first < base.firstMinute)) base.firstMinute = first;
  if (last !== null && (base.lastMinute === null || last > base.lastMinute)) base.lastMinute = last;
  base.offlineSeconds = Math.min(DAY_SECONDS, base.offlineSeconds + count(from.offlineSeconds));
  return base;
}

export function cleanAcc(raw) {
  return mergeAcc(newAcc(), raw);
}

export function isEmptyAcc(acc) {
  return MAPS.every(name => Object.keys(acc[name]).length === 0)
    && acc.firstMinute === null && acc.lastMinute === null && acc.offlineSeconds === 0;
}

const pad = n => String(n).padStart(2, '0');

// 'YYYYMMDD' in the device's own local time.
export function dayKeyOf(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

// The document id the rules demand: <deviceId>_<YYYYMMDD>_<uid>. Null when any part is wrong.
export function docId(deviceId, dayKey, uid) {
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(deviceId)) return null;
  if (typeof dayKey !== 'string' || !DAY_KEY_RE.test(dayKey)) return null;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(uid)) return null;
  return `${deviceId}_${dayKey}_${uid}`;
}

// The fields of the line, without bakery, uid and updatedAt (the data layer adds those: they
// must be the signed-in account's and the server's clock). Null when it could not be a line the
// rules would accept.
export function payloadOf(acc, { deviceId, dayKey, kind, appVersion } = {}) {
  if (!acc || typeof deviceId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(deviceId)) return null;
  if (typeof dayKey !== 'string' || !DAY_KEY_RE.test(dayKey)) return null;
  if (!KINDS.includes(kind)) return null;
  const safe = cleanAcc(acc);
  const payload = {
    deviceId,
    dayKey,
    kind,
    appVersion: typeof appVersion === 'string' && appVersion.length > 0 && appVersion.length <= VERSION_MAX
      ? appVersion : null,
    screens: safe.screens,
    seconds: safe.seconds,
    taps: safe.taps,
    routes: safe.routes,
    actions: safe.actions,
    loads: safe.loads,
    loadMs: safe.loadMs,
    offlineSeconds: safe.offlineSeconds,
  };
  if (safe.firstMinute !== null) payload.firstMinute = safe.firstMinute;
  if (safe.lastMinute !== null) payload.lastMinute = safe.lastMinute;
  return payload;
}
