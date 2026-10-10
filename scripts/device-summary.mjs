// device-summary.mjs — the pure half of scripts/read-devices.mjs: turning the REST answers
// about `locations/{lid}/devices/{id}` into numbers. No network, no credentials, so the tests
// can pin it (tests/device-summary.test.mjs).
//
// ⚠️ NUMBERS ONLY. A device line holds a random id, the signed-in account's uid (never a name
// or email) and four facts; this file never prints the id or the uid, and returns them only
// inside the path that --prune needs to delete a stale line and as the key for a first name.

import { clean } from './feedback-notes.mjs';

const LOCATION_ID = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
const DEVICE_PATH = new RegExp(`^locations/(${LOCATION_ID})/devices/([A-Za-z0-9]{20})$`);
const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_DAYS = 90;

export function relativePath(name) {
  const at = String(name ?? '').indexOf('/documents/');
  return at === -1 ? null : String(name).slice(at + '/documents/'.length);
}

// The only documents --prune may delete: one device line in one venue. Anything else is
// refused before a request is made.
export function devicePath(path) {
  const match = DEVICE_PATH.exec(String(path ?? ''));
  return match ? { path: match[0], locationId: match[1], id: match[2] } : null;
}

// One runQuery row → a device, or null when the row is not a device line at all.
export function deviceFrom(document) {
  const where = devicePath(relativePath(document?.name));
  if (!where) return null;
  const f = document.fields || {};
  const seen = Date.parse(f.lastSeen?.timestampValue ?? '');
  return {
    path: where.path,
    locationId: where.locationId,
    uid: /^[A-Za-z0-9]{1,128}$/.test(f.uid?.stringValue ?? '') ? f.uid.stringValue : null,
    kind: typeof f.kind?.stringValue === 'string' ? f.kind.stringValue : 'unknown',
    installed: f.installed?.booleanValue === true,
    // Cleaned like a venue name: the value is written by a device, so it is data, not text to trust.
    appVersion: typeof f.appVersion?.stringValue === 'string' ? (clean(f.appVersion.stringValue, 12) || null) : null,
    lastSeenMs: Number.isFinite(seen) ? seen : null,
  };
}

export function devicesFrom(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => deviceFrom(row?.document)).filter(Boolean);
}

// A line with no readable date counts as stale: it can never be seen as recent.
export function isStale(device, now, days = STALE_DAYS) {
  return device.lastSeenMs === null || now - device.lastSeenMs > days * DAY_MS;
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

// Newest release first; «unknown» last.
function versionOrder(a, b) {
  if (a === 'unknown') return 1;
  if (b === 'unknown') return -1;
  return Number(b) - Number(a) || String(b).localeCompare(String(a));
}

// Per venue: how many devices were seen in the last 7 days, the last 30 days, and ever (still
// on file); and, among the ones seen in the last 30 days, the split by kind, installed vs
// browser, and release.
export function summarise(devices, now) {
  const venues = new Map();
  for (const device of devices) {
    if (!venues.has(device.locationId)) {
      venues.set(device.locationId, {
        locationId: device.locationId, total: 0, last7: 0, last30: 0,
        kinds: new Map(), installed: { installed: 0, browser: 0 }, versions: new Map(),
        people: new Map(),
      });
    }
    const v = venues.get(device.locationId);
    v.total += 1;
    if (device.lastSeenMs === null) continue;
    const age = now - device.lastSeenMs;
    if (age <= 7 * DAY_MS) v.last7 += 1;
    if (age <= 30 * DAY_MS) {
      v.last30 += 1;
      bump(v.kinds, device.kind);
      v.installed[device.installed ? 'installed' : 'browser'] += 1;
      bump(v.versions, device.appVersion ?? 'unknown');
      if (device.uid) bump(v.people, device.uid);
    }
  }
  return [...venues.values()]
    .map(v => ({
      ...v,
      kinds: [...v.kinds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      versions: [...v.versions.entries()].sort((a, b) => versionOrder(a[0], b[0])),
      // [uid, devices], most devices first. The uid is only for looking up a first name.
      people: [...v.people.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    }))
    .sort((a, b) => a.locationId.localeCompare(b.locationId));
}

// [[label, devices], …] — `firstNames`: Map uid → first name (never a surname or email). An
// unknown person is «someone»; two people with the same first name are told apart by a number,
// never by the uid.
function peopleLabels(venue, firstNames) {
  const used = new Map();
  return venue.people.map(([uid, n]) => {
    const first = clean(firstNames.get(uid) ?? '', 40) || 'someone';
    const seen = (used.get(first) || 0) + 1;
    used.set(first, seen);
    return [seen > 1 ? `${first} (${seen})` : first, n];
  });
}

export function summaryLines(venue, name, firstNames = new Map()) {
  const pairs = list => (list.length ? list.map(([k, n]) => `${k} ${n}`).join(', ') : 'none');
  const perPerson = peopleLabels(venue, firstNames);
  return [
    `${name || venue.locationId} (${venue.locationId})`,
    `  devices seen: last 7 days ${venue.last7} · last 30 days ${venue.last30} · on file ${venue.total}`,
    `  of the last 30 days — by kind: ${pairs(venue.kinds)}`,
    `  installed ${venue.installed.installed} · in a browser ${venue.installed.browser}`,
    `  by app version (newest first): ${pairs(venue.versions.map(([k, n]) => [k === 'unknown' ? 'unknown' : `v${k}`, n]))}`,
    `  devices per person: ${pairs(perPerson)}`,
  ];
}

// The same numbers as summaryLines, as a plain object for the stats page. `names`: Map
// locationId → venue name; `firstNamesByVenue`: Map locationId → Map uid → first name. No device
// id and no uid is ever copied in.
export function summaryJson(venues, names = new Map(), firstNamesByVenue = new Map(), now = Date.now()) {
  const counts = list => list.map(([k, n]) => ({ name: k, devices: n }));
  return {
    generatedAt: new Date(now).toISOString(),
    scope: 'production',
    venues: venues.map(v => ({
      venue: clean(names.get(v.locationId) ?? '', 60) || v.locationId,
      seen7Days: v.last7,
      seen30Days: v.last30,
      onFile: v.total,
      byKind: counts(v.kinds),
      installed: v.installed.installed,
      browser: v.installed.browser,
      byAppVersion: counts(v.versions),
      perPerson: peopleLabels(v, firstNamesByVenue.get(v.locationId) ?? new Map())
        .map(([person, n]) => ({ person, devices: n })),
    })),
  };
}
