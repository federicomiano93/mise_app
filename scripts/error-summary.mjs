// error-summary.mjs — the pure half of scripts/read-errors.mjs: turning the REST answers about
// `locations/{lid}/errors/{id}` (js/error-report.js) into groups of «the same error», and the
// one path a delete may name. No network, no credentials, so the tests can pin it
// (tests/error-summary.test.mjs).
//
// ⚠️ EVERYTHING HERE CAME FROM A DEVICE. A message or a stack is whatever the app (or a page
// it loaded) said, so it is DATA: every text goes through clean() (control and invisible
// characters flattened, length cut) before it is stored or printed, and read-errors.mjs prints
// it inside a block that cannot be closed from inside. The account id and device id are read
// only to count distinct people and devices; they are never printed.

import { signature } from '../js/error-model.js';
import { clean, relativePath } from './feedback-notes.mjs';

export { clean, relativePath };

const LOCATION_ID = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
// The id is the one addDoc() makes — the rules refuse any other shape.
const ERROR_PATH = new RegExp(`^locations/(${LOCATION_ID})/errors/([A-Za-z0-9]{20})$`);
const DAY_MS = 24 * 60 * 60 * 1000;
export const KEEP_DAYS = 30;
const STACK_PRINT_LINES = 10;

// The only documents --clear and --prune may delete: one error line in one venue.
export function errorPath(path) {
  const match = ERROR_PATH.exec(String(path ?? ''));
  return match ? { path: match[0], locationId: match[1], id: match[2] } : null;
}

function str(field) {
  return typeof field?.stringValue === 'string' ? field.stringValue : null;
}

// One runQuery row → an error line, or null when the row is not one at all.
export function errorFrom(document) {
  const where = errorPath(relativePath(document?.name));
  if (!where) return null;
  const f = document.fields || {};
  const stack = str(f.stack);
  const created = Date.parse(f.createdAt?.timestampValue ?? '');
  return {
    path: where.path,
    locationId: where.locationId,
    source: clean(str(f.source) ?? '', 12) || 'unknown',
    screen: clean(str(f.screen) ?? '', 60) || null,
    appVersion: clean(str(f.appVersion) ?? '', 12) || null,
    deviceKind: clean(str(f.deviceKind) ?? '', 12) || 'unknown',
    online: f.online?.booleanValue === true ? true : (f.online?.booleanValue === false ? false : null),
    code: clean(str(f.code) ?? '', 60) || null,
    message: clean(str(f.message) ?? '', 300) || '(empty)',
    // Line breaks are the structure of a stack: kept, each line cleaned.
    stack: stack ? stack.split(/\r?\n/).slice(0, STACK_PRINT_LINES).map(l => clean(l, 200)).filter(Boolean).join('\n') || null : null,
    person: clean(str(f.uid) ?? '', 128) || null,
    device: clean(str(f.deviceId) ?? '', 20) || null,
    createdMs: Number.isFinite(created) ? created : null,
  };
}

export function errorsFrom(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => errorFrom(row?.document)).filter(Boolean);
}

// A line with no readable date counts as old: it can never look recent.
export function isOld(error, now, days = KEEP_DAYS) {
  return error.createdMs === null || now - error.createdMs > days * DAY_MS;
}

// --clear "<text>": the same flattening the app applied, so a copied message matches. An empty
// text matches nothing (it would otherwise match everything).
export function messageMatches(error, text) {
  const needle = clean(text, 1000);
  return needle !== '' && error.message.includes(needle);
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

const byCount = (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]));

// Versions: newest first, «unknown» last.
function versionOrder(a, b) {
  if (a[0] === 'unknown') return 1;
  if (b[0] === 'unknown') return -1;
  return Number(b[0]) - Number(a[0]) || String(b[0]).localeCompare(String(a[0]));
}

// Same error = same signature (source + start of the message + first frame), most frequent first.
export function groupErrors(errors) {
  const groups = new Map();
  for (const e of errors) {
    const key = signature(e);
    if (!groups.has(key)) {
      groups.set(key, {
        message: e.message, source: e.source, count: 0, firstMs: null, lastMs: null,
        venues: new Map(), screens: new Map(), versions: new Map(), kinds: new Map(),
        online: 0, offline: 0, people: new Set(), codes: new Map(),
        stack: null, stackMs: -1, stackVersion: null, paths: [],
      });
    }
    const g = groups.get(key);
    g.count += 1;
    g.paths.push(e.path);
    if (e.createdMs !== null) {
      g.firstMs = g.firstMs === null ? e.createdMs : Math.min(g.firstMs, e.createdMs);
      g.lastMs = g.lastMs === null ? e.createdMs : Math.max(g.lastMs, e.createdMs);
    }
    bump(g.venues, e.locationId);
    bump(g.screens, e.screen ?? 'unknown');
    bump(g.versions, e.appVersion ?? 'unknown');
    bump(g.kinds, e.deviceKind);
    if (e.online === true) g.online += 1;
    else if (e.online === false) g.offline += 1;
    if (e.person) g.people.add(e.person);
    if (e.code) bump(g.codes, e.code);
    // ONE sample stack: the most recent one that has any.
    // The release it came from travels with it: a bundled frame can only be mapped back with
    // today's build (scripts/source-map.mjs), and says so when this is not today's release.
    if (e.stack && (e.createdMs ?? 0) >= g.stackMs) {
      g.stack = e.stack; g.stackMs = e.createdMs ?? 0; g.stackVersion = e.appVersion ?? null;
    }
  }
  return [...groups.values()]
    .map(g => ({
      ...g,
      venues: [...g.venues.entries()].sort(byCount),
      screens: [...g.screens.entries()].sort(byCount),
      versions: [...g.versions.entries()].sort(versionOrder),
      kinds: [...g.kinds.entries()].sort(byCount),
      codes: [...g.codes.entries()].sort(byCount),
      people: g.people.size,
    }))
    .sort((a, b) => b.count - a.count || (b.lastMs ?? 0) - (a.lastMs ?? 0) || a.message.localeCompare(b.message));
}

const day = ms => (ms === null ? 'no date' : new Date(ms).toISOString().slice(0, 16).replace('T', ' '));

// `names`: Map locationId → venue name (or nothing). The message goes out as a JSON string,
// quoted and escaped, like read-feedback.mjs does with a note.
export function groupLines(group, names = new Map()) {
  const pairs = list => (list.length ? list.map(([k, n]) => `${clean(k, 60)} ${n}`).join(', ') : 'none');
  // Text a device chose (screen, code) is quoted like the message: app data is never printed bare.
  const quoted = list => (list.length ? list.map(([k, n]) => `${JSON.stringify(clean(k, 60))} ${n}`).join(', ') : 'none');
  const venues = group.venues.map(([lid, n]) => [clean(names.get(lid) ?? '', 60) || lid, n]);
  const lines = [
    `${group.count}× [${clean(group.source, 12)}] ${JSON.stringify(group.message)}`,
    `  first ${day(group.firstMs)} · last ${day(group.lastMs)} (UTC)`,
    `  venues: ${pairs(venues)}`,
    `  screens: ${quoted(group.screens)}`,
    `  app versions: ${pairs(group.versions.map(([k, n]) => [k === 'unknown' ? 'unknown' : `v${k}`, n]))}`,
    `  devices: ${pairs(group.kinds)} · online ${group.online} · offline ${group.offline}`,
    `  people affected: ${group.people}`,
  ];
  if (group.codes.length) lines.push(`  code: ${quoted(group.codes)}`);
  if (group.stack) lines.push('  sample stack:', ...group.stack.split('\n').map(l => `    ${JSON.stringify(l)}`));
  return lines;
}

// --clear deletes every line whose message CONTAINS the text, so a short one («error») would
// wipe unrelated problems. Returns the reason it is refused, or null when it is long enough.
export const MIN_CLEAR_LENGTH = 8;
export function clearTextProblem(text) {
  const needle = clean(text, 1000);
  if (needle === '') return 'Refused: --clear needs the text to look for.';
  if (needle.length < MIN_CLEAR_LENGTH) {
    return `Refused: --clear needs at least ${MIN_CLEAR_LENGTH} characters, so it cannot sweep away unrelated errors.`;
  }
  return null;
}

// Firestore's runAggregationQuery answer → the count, or null when it is not one.
export function countFrom(rows) {
  const value = Array.isArray(rows) ? rows[0]?.result?.aggregateFields?.n?.integerValue : undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && value !== undefined ? n : null;
}

const TREND_DAYS = 30;

// The groups of groupErrors as a plain object for the stats page, plus the number of error
// lines per UTC day for the last 30 days (oldest first, empty days included). `names`: Map
// locationId → venue name. No stack, uid or device id is ever copied in.
export function errorsJson(errors, names = new Map(), now = Date.now()) {
  const counts = list => list.map(([k, n]) => ({ name: clean(k, 60), count: n }));
  const groups = groupErrors(errors).map(g => ({
    label: clean(String(g.message).split(/\r?\n/)[0], 160),
    source: clean(g.source, 12),
    count: g.count,
    firstSeen: g.firstMs === null ? null : new Date(g.firstMs).toISOString(),
    lastSeen: g.lastMs === null ? null : new Date(g.lastMs).toISOString(),
    venues: g.venues.map(([lid, n]) => ({ name: clean(names.get(lid) ?? '', 60) || lid, count: n })),
    screens: counts(g.screens),
    appVersions: counts(g.versions),
    deviceKinds: counts(g.kinds),
    online: g.online,
    offline: g.offline,
    people: g.people,
    code: g.codes.length ? clean(g.codes[0][0], 60) : null,
  }));
  const today = Math.floor(now / DAY_MS);
  const perDay = new Map();
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) perDay.set(new Date((today - i) * DAY_MS).toISOString().slice(0, 10), 0);
  for (const e of errors) {
    if (e.createdMs === null) continue;
    const key = new Date(e.createdMs).toISOString().slice(0, 10);
    if (perDay.has(key)) perDay.set(key, perDay.get(key) + 1);
  }
  return {
    generatedAt: new Date(now).toISOString(),
    scope: 'production',
    total: errors.length,
    groups,
    perDay: [...perDay.entries()].map(([date, count]) => ({ date, count })),
  };
}
