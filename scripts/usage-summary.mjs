// usage-summary.mjs — the pure half of scripts/read-usage.mjs: turning the REST answers about
// `locations/{lid}/usage/{id}` (js/usage.js) into numbers. No network, no credentials, so the
// tests can pin it (tests/usage-summary.test.mjs).
//
// ⚠️ NUMBERS AND FIRST NAMES. A usage line holds a device id and the signed-in account's uid
// (the owner's choice, internal use); this file never prints either. They stay inside the object
// only as the key for counting distinct people and devices and for looking up a first name, and
// inside the path that --prune needs to delete an old line.
// ⚠️ EVERY NAME IS DATA written by a device: map keys must match the same patterns the app
// uses, numbers are clamped, and app text goes through clean().

import { clean } from './feedback-notes.mjs';
import { relativePath } from './device-summary.mjs';
import { SCREEN_RE, ACTION_RE, ROUTE_RE, OTHER } from '../js/usage-model.js';

const LOCATION_ID = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
const USAGE_PATH = new RegExp(`^locations/(${LOCATION_ID})/usage/([A-Za-z0-9]{20})_(20[0-9]{6})_([A-Za-z0-9]{1,128})$`);
const DAY_MS = 24 * 60 * 60 * 1000;
export const PRUNE_DAYS = 400;
export const TOP_ROUTES = 15;

export { relativePath };

// The only documents --prune may delete: one usage line in one venue. Anything else is refused
// before a request is made.
export function usagePath(path) {
  const m = USAGE_PATH.exec(String(path ?? ''));
  return m ? { path: m[0], locationId: m[1], deviceId: m[2], dayKey: m[3], uid: m[4] } : null;
}

function int(field, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(field?.integerValue ?? field?.doubleValue);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n)) : 0;
}

function minute(field) {
  const n = Number(field?.integerValue);
  return Number.isInteger(n) && n >= 0 && n < 1440 ? n : null;
}

function intMap(field, keyOk) {
  const out = {};
  const fields = field?.mapValue?.fields || {};
  for (const key of Object.keys(fields)) {
    if (!keyOk(key)) continue;
    const n = int(fields[key]);
    if (n > 0) out[key] = n;
  }
  return out;
}

const screenKey = k => SCREEN_RE.test(k);
const routeKey = k => k === OTHER || ROUTE_RE.test(k);
const actionKey = k => ACTION_RE.test(k);

// 'YYYYMMDD' → a Date at local midnight (null when it is not a real day).
export function dayOf(dayKey) {
  const m = /^(20\d{2})(\d{2})(\d{2})$/.exec(String(dayKey ?? ''));
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.getMonth() === Number(m[2]) - 1 ? date : null;
}

export function dayKeyOf(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

// One runQuery row → a usage line, or null when the row is not a usage line at all.
export function lineFrom(document) {
  const where = usagePath(relativePath(document?.name));
  if (!where || !dayOf(where.dayKey)) return null;
  const f = document.fields || {};
  const kind = f.kind?.stringValue;
  return {
    path: where.path,
    locationId: where.locationId,
    uid: where.uid,
    deviceId: where.deviceId,
    dayKey: where.dayKey,
    kind: ['phone', 'tablet', 'computer'].includes(kind) ? kind : 'unknown',
    appVersion: typeof f.appVersion?.stringValue === 'string' ? (clean(f.appVersion.stringValue, 12) || null) : null,
    screens: intMap(f.screens, screenKey),
    seconds: intMap(f.seconds, screenKey),
    taps: intMap(f.taps, screenKey),
    routes: intMap(f.routes, routeKey),
    actions: intMap(f.actions, actionKey),
    loads: intMap(f.loads, screenKey),
    loadMs: intMap(f.loadMs, screenKey),
    firstMinute: minute(f.firstMinute),
    lastMinute: minute(f.lastMinute),
    offlineSeconds: int(f.offlineSeconds, 86400),
  };
}

export function linesFrom(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => lineFrom(row?.document)).filter(Boolean);
}

// A line with a day nobody can read counts as stale. `days` back from `now`.
export function isStale(line, now, days = PRUNE_DAYS) {
  const day = dayOf(line.dayKey);
  return !day || now - day.getTime() > days * DAY_MS;
}

function add(map, key, n) {
  map.set(key, (map.get(key) || 0) + n);
}

function sorted(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

function versionOrder(a, b) {
  if (a === 'unknown') return 1;
  if (b === 'unknown') return -1;
  return Number(b) - Number(a) || String(b).localeCompare(String(a));
}

// The lines of one venue in the last `days` days (today included), counted.
export function summariseWindow(lines, now, days) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const first = dayKeyOf(start);
  const inWindow = lines.filter(l => l.dayKey >= first);
  const perDay = new Map();
  const screens = new Map();
  const activeSeconds = new Map();
  const routes = new Map();
  const actions = new Map();
  const hours = new Array(24).fill(0);
  const loadAverages = new Map();
  const people = new Map();
  const versions = new Map();
  const seenDevices = new Set();
  let offlineSeconds = 0;
  for (const line of inWindow) {
    const day = perDay.get(line.dayKey) || { people: new Set(), devices: new Set() };
    day.people.add(line.uid);
    day.devices.add(line.deviceId);
    perDay.set(line.dayKey, day);
    for (const [k, n] of Object.entries(line.screens)) add(screens, k, n);
    for (const [k, n] of Object.entries(line.seconds)) add(activeSeconds, k, n);
    for (const [k, n] of Object.entries(line.routes)) add(routes, k, n);
    for (const [k, n] of Object.entries(line.actions)) add(actions, k, n);
    if (line.firstMinute !== null && line.lastMinute !== null && line.lastMinute >= line.firstMinute) {
      for (let h = Math.floor(line.firstMinute / 60); h <= Math.floor(line.lastMinute / 60); h += 1) hours[h] += 1;
    }
    for (const [page, count] of Object.entries(line.loads)) {
      if (!line.loadMs[page]) continue;
      const list = loadAverages.get(page) || [];
      list.push(line.loadMs[page] / count);
      loadAverages.set(page, list);
    }
    add(people, line.uid, 1);
    offlineSeconds += line.offlineSeconds;
    if (!seenDevices.has(line.deviceId)) {
      seenDevices.add(line.deviceId);
      add(versions, line.appVersion ?? 'unknown', 1);
    }
  }
  return {
    days,
    lines: inWindow.length,
    // [dayKey, people, devices], oldest first
    perDay: [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dayKey, d]) => [dayKey, d.people.size, d.devices.size]),
    screens: sorted(screens),
    // [screen, minutes] — rounded; the busiest first
    activeMinutes: sorted(activeSeconds).map(([k, s]) => [k, Math.round(s / 60)]),
    routes: sorted(routes).slice(0, TOP_ROUTES),
    actions: sorted(actions),
    hours,
    loadMedianMs: [...loadAverages.entries()].map(([page, list]) => [page, median(list)])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    offlineMinutes: Math.round(offlineSeconds / 60),
    versions: [...versions.entries()].sort((a, b) => versionOrder(a[0], b[0])),
    // [uid, days active], most days first. The uid is only for looking up a first name.
    people: sorted(people),
  };
}

export function summarise(lines, now) {
  const byVenue = new Map();
  for (const line of lines) {
    if (!byVenue.has(line.locationId)) byVenue.set(line.locationId, []);
    byVenue.get(line.locationId).push(line);
  }
  return [...byVenue.entries()]
    .map(([locationId, list]) => ({
      locationId,
      total: list.length,
      last7: summariseWindow(list, now, 7),
      last30: summariseWindow(list, now, 30),
    }))
    .sort((a, b) => a.locationId.localeCompare(b.locationId));
}

// The same numbers as data for the stats page: no uid, no device id, no name.
export function toJson(venues, names = new Map()) {
  const strip = w => ({ ...w, people: w.people.length });
  return venues.map(v => ({
    locationId: v.locationId,
    name: names.get(v.locationId) ?? null,
    total: v.total,
    last7: strip(v.last7),
    last30: strip(v.last30),
  }));
}

const pairs = (list, fmt = ([k, n]) => `${k} ${n}`) => (list.length ? list.map(fmt).join(', ') : 'none');

// `firstNames`: Map uid → first name (never a surname or email). An unknown person is
// «someone»; two people with the same first name are told apart by a number, never by the uid.
function windowLines(w, firstNames) {
  const used = new Map();
  const perPerson = w.people.map(([uid, n]) => {
    const first = clean(firstNames.get(uid) ?? '', 40) || 'someone';
    const seen = (used.get(first) || 0) + 1;
    used.set(first, seen);
    return [seen > 1 ? `${first} (${seen})` : first, n];
  });
  const busiest = w.perDay.length
    ? `${Math.max(...w.perDay.map(d => d[1]))} people at most in a day`
    : 'no activity';
  return [
    `  last ${w.days} days — ${w.lines} day-lines, ${busiest}`,
    `    people and devices per day: ${pairs(w.perDay, ([d, p, dv]) => `${d.slice(4)} ${p}/${dv}`)}`,
    `    screens by opens: ${pairs(w.screens.slice(0, 15))}`,
    `    screens by active minutes: ${pairs(w.activeMinutes.slice(0, 15))}`,
    `    top routes: ${pairs(w.routes, ([k, n]) => `${k.replace('>', ' → ')} ${n}`)}`,
    `    actions: ${pairs(w.actions)}`,
    `    hours of activity (lines active in each hour): ${pairs(w.hours.map((n, h) => [String(h).padStart(2, '0'), n]).filter(([, n]) => n > 0))}`,
    `    median load time per page (ms): ${pairs(w.loadMedianMs)}`,
    `    offline: ${w.offlineMinutes} min · by app version (newest first): ${pairs(w.versions.map(([k, n]) => [k === 'unknown' ? 'unknown' : `v${k}`, n]))}`,
    `    active days per person: ${pairs(perPerson)}`,
  ];
}

export function summaryLines(venue, name, firstNames = new Map()) {
  return [
    `${clean(name ?? '', 60) || venue.locationId} (${venue.locationId}) — ${venue.total} day-lines on file`,
    ...windowLines(venue.last7, firstNames),
    ...windowLines(venue.last30, firstNames),
  ];
}
