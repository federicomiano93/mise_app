// usage-model.ts — the pure half of the usage record.
//
// TypeScript port of js/usage-model.js for Mise 2. Behaviour is identical, input for input:
// usage-model.spec.ts runs every test against BOTH files and parity.spec.ts compares their
// exports. The comments below are the ones the original paid for in bugs.
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
// No imports, on purpose: this file also runs where the app's own modules do not exist.

export type UsageKind = 'phone' | 'tablet' | 'computer';
export type MapName = 'screens' | 'seconds' | 'taps' | 'routes' | 'actions' | 'loads' | 'loadMs';
// A name (a screen, a route, an action) and how many times it happened.
export type CountMap = Record<string, number>;

// One person on one device, one day.
export interface UsageAcc {
  screens: CountMap;
  seconds: CountMap;
  taps: CountMap;
  routes: CountMap;
  actions: CountMap;
  loads: CountMap;
  loadMs: CountMap;
  firstMinute: number | null;
  lastMinute: number | null;
  offlineSeconds: number;
}

// The line, without bakery, uid and updatedAt (see payloadOf). The minutes are left out, not
// null, when nobody was seen working.
export interface UsagePayload {
  deviceId: string;
  dayKey: string;
  kind: UsageKind;
  appVersion: string | null;
  screens: CountMap;
  seconds: CountMap;
  taps: CountMap;
  routes: CountMap;
  actions: CountMap;
  loads: CountMap;
  loadMs: CountMap;
  offlineSeconds: number;
  firstMinute?: number;
  lastMinute?: number;
}

export const CAPS = Object.freeze({
  screens: 80, seconds: 80, taps: 80, routes: 300, actions: 40, loads: 20, loadMs: 20,
});
export const OTHER = 'other';
export const SCREEN_RE = /^[a-z0-9:-]{1,40}$/;
export const ACTION_RE = /^[a-z][a-z0-9-]{0,39}$/;
export const ROUTE_RE = /^[a-z0-9:-]{1,40}>[a-z0-9:-]{1,40}$/;
export const DAY_KEY_RE = /^20[0-9]{6}$/;
export const KINDS: UsageKind[] = ['phone', 'tablet', 'computer'];
const VERSION_MAX = 12;
const LOAD_MS_MAX = 60000;
const DAY_SECONDS = 86400;
const MAPS: readonly MapName[] = ['screens', 'seconds', 'taps', 'routes', 'actions', 'loads', 'loadMs'];

export function newAcc(): UsageAcc {
  return {
    screens: {}, seconds: {}, taps: {}, routes: {}, actions: {}, loads: {}, loadMs: {},
    firstMinute: null, lastMinute: null, offlineSeconds: 0,
  };
}

function count(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function has(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

// Adds `n` to `key`, or to 'other' when the map has no room left for a new key.
function bump(map: CountMap, key: string, n: number, cap: number): void {
  if (!n) return;
  let k = key;
  if (!has(map, k)) {
    // One slot is always kept for 'other', so the map never passes its cap.
    if (Object.keys(map).length >= cap - 1) k = OTHER;
  }
  // `as number`: a key the map owns always holds a number here; the cast keeps the original's
  // arithmetic for an accumulator that somebody damaged by hand.
  map[k] = (has(map, k) ? (map[k] as number) : 0) + n;
}

export function addScreen(acc: UsageAcc, name: unknown): void {
  if (typeof name !== 'string' || !SCREEN_RE.test(name)) return;
  bump(acc.screens, name, 1, CAPS.screens);
}

// A move from one screen to the next. Staying put, or an unnamed end, is not a route.
export function addRoute(acc: UsageAcc, from: unknown, to: unknown): void {
  if (typeof from !== 'string' || typeof to !== 'string') return;
  if (!from || !to || from === to) return;
  const key = `${from}>${to}`;
  if (!ROUTE_RE.test(key)) return;
  bump(acc.routes, key, 1, CAPS.routes);
}

export function addSeconds(acc: UsageAcc, screen: unknown, seconds: unknown): void {
  if (typeof screen !== 'string' || !SCREEN_RE.test(screen)) return;
  bump(acc.seconds, screen, count(seconds), CAPS.seconds);
}

export function addTap(acc: UsageAcc, screen: unknown): void {
  if (typeof screen !== 'string' || !SCREEN_RE.test(screen)) return;
  bump(acc.taps, screen, 1, CAPS.taps);
}

export function addAction(acc: UsageAcc, name: unknown): void {
  if (typeof name !== 'string' || !ACTION_RE.test(name)) return;
  bump(acc.actions, name, 1, CAPS.actions);
}

export function addLoad(acc: UsageAcc, page: unknown, ms: unknown): void {
  if (typeof page !== 'string' || !SCREEN_RE.test(page)) return;
  const clamped = Math.min(LOAD_MS_MAX, count(ms));
  bump(acc.loads, page, 1, CAPS.loads);
  bump(acc.loadMs, page, clamped, CAPS.loadMs);
}

export function addOffline(acc: UsageAcc, seconds: unknown): void {
  acc.offlineSeconds = Math.min(DAY_SECONDS, acc.offlineSeconds + count(seconds));
}

// The local minute of the day (0–1439) a person was last seen working; the first one is kept.
export function touchMinute(acc: UsageAcc, date: unknown): void {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
  const minute = date.getHours() * 60 + date.getMinutes();
  if (acc.firstMinute === null || minute < acc.firstMinute) acc.firstMinute = minute;
  if (acc.lastMinute === null || minute > acc.lastMinute) acc.lastMinute = minute;
}

function validMinute(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440 ? value : null;
}

const KEY_OK: Record<MapName, (k: string) => boolean> = {
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
export function mergeAcc(base: UsageAcc, extra: unknown): UsageAcc {
  const from = (extra && typeof extra === 'object' ? extra : {}) as Record<string, unknown>;
  for (const name of MAPS) {
    const source = from[name];
    if (!source || typeof source !== 'object') continue;
    for (const key of Object.keys(source)) {
      if (!KEY_OK[name](key)) continue;
      bump(base[name], key, count((source as Record<string, unknown>)[key]), CAPS[name]);
    }
  }
  const first = validMinute(from.firstMinute);
  const last = validMinute(from.lastMinute);
  if (first !== null && (base.firstMinute === null || first < base.firstMinute)) base.firstMinute = first;
  if (last !== null && (base.lastMinute === null || last > base.lastMinute)) base.lastMinute = last;
  base.offlineSeconds = Math.min(DAY_SECONDS, base.offlineSeconds + count(from.offlineSeconds));
  return base;
}

export function cleanAcc(raw: unknown): UsageAcc {
  return mergeAcc(newAcc(), raw);
}

export function isEmptyAcc(acc: UsageAcc): boolean {
  return MAPS.every(name => Object.keys(acc[name]).length === 0)
    && acc.firstMinute === null && acc.lastMinute === null && acc.offlineSeconds === 0;
}

const pad = (n: number): string => String(n).padStart(2, '0');

// 'YYYYMMDD' in the device's own local time.
export function dayKeyOf(date: Date = new Date()): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

// The document id the rules demand: <deviceId>_<YYYYMMDD>_<uid>. Null when any part is wrong.
export function docId(deviceId: unknown, dayKey: unknown, uid: unknown): string | null {
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(deviceId)) return null;
  if (typeof dayKey !== 'string' || !DAY_KEY_RE.test(dayKey)) return null;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(uid)) return null;
  return `${deviceId}_${dayKey}_${uid}`;
}

// Is this one of the kinds of device the rules know?
function isKind(value: unknown): value is UsageKind {
  return (KINDS as readonly unknown[]).includes(value);
}

// The fields of the line, without bakery, uid and updatedAt (the data layer adds those: they
// must be the signed-in account's and the server's clock). Null when it could not be a line the
// rules would accept.
export function payloadOf(
  acc: unknown,
  { deviceId, dayKey, kind, appVersion }:
    { deviceId?: unknown; dayKey?: unknown; kind?: unknown; appVersion?: unknown } = {},
): UsagePayload | null {
  if (!acc || typeof deviceId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(deviceId)) return null;
  if (typeof dayKey !== 'string' || !DAY_KEY_RE.test(dayKey)) return null;
  if (!isKind(kind)) return null;
  const safe = cleanAcc(acc);
  const payload: UsagePayload = {
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
