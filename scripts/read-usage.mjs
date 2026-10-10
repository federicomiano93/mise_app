// read-usage.mjs — reads how the app is used (`locations/{lid}/usage/{id}`, js/usage.js) in
// PRODUCTION, per venue. Numbers and first names: no device id or uid is ever printed.
//
//   node scripts/read-usage.mjs                 per venue, for the last 7 and 30 days: people and
//                                               devices per day, screens by opens and active
//                                               minutes, the top 15 routes (from → to), actions,
//                                               hours of activity, median load time per page,
//                                               offline minutes, app versions, people (first name)
//   node scripts/read-usage.mjs --json FILE     also write the same numbers (no names, no ids) to FILE
//   node scripts/read-usage.mjs --prune         delete the lines older than 400 days
//
// ⚠️ WHY HERE AND NOT IN THE APP. The rules let a device WRITE its own line and nothing else —
// not even read it back. This script reads with the owner's own Google login
// (`gcloud auth login`), which bypasses the rules. The token is used in a header and never
// printed.
//
// ⚠️ IT READS PRODUCTION AND DELETES ONLY OLD USAGE LINES. The project is a constant, and each
// DELETE path is checked against a strict pattern (usage-summary.mjs) before the request is made.
// Lines are kept no longer than they are useful (P13).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { linesFrom, summarise, summaryLines, toJson, isStale, usagePath } from './usage-summary.mjs';
import { clean } from './feedback-notes.mjs';

const PROJECT = 'bakery-app-ebf90';
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const PAGE = 300;
// A safety stop, far above a year of one small business.
const MAX_PAGES = 400;

function accessToken() {
  try {
    // A fixed command string: on Windows gcloud is a .cmd, which only a shell can start.
    const out = execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim();
    if (/^[\w.\-~+/]+=*$/.test(out)) return out;
  } catch { /* reported below */ }
  throw new Error('gcloud could not print an access token — run `gcloud auth login`.');
}

// Set once the arguments are known to be valid (the token is only fetched then).
let headers = null;

function signIn() {
  headers = {
    Authorization: `Bearer ${accessToken()}`,
    'x-goog-user-project': PROJECT,
    'Content-Type': 'application/json',
  };
}

async function call(url, init = {}) {
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Firestore answered ${res.status} for ${init.method || 'GET'} ${url.slice(DOCS.length) || '/'}`);
  return res.status === 204 ? null : res.json();
}

const FIELDS = ['kind', 'appVersion', 'screens', 'seconds', 'taps', 'routes', 'actions',
  'loads', 'loadMs', 'firstMinute', 'lastMinute', 'offlineSeconds'];

// Every usage line in every venue, a page at a time (ordered by document name, so no index).
async function readUsage() {
  const lines = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const structuredQuery = {
      from: [{ collectionId: 'usage', allDescendants: true }],
      select: { fields: FIELDS.map(fieldPath => ({ fieldPath })) },
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: PAGE,
    };
    if (after) structuredQuery.startAt = { values: [{ referenceValue: after }], before: false };
    const rows = await call(`${DOCS}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery }) });
    const docs = (Array.isArray(rows) ? rows : []).filter(r => r.document);
    lines.push(...linesFrom(docs));
    if (docs.length < PAGE) return lines;
    after = docs[docs.length - 1].document.name;
  }
  throw new Error(`More than ${MAX_PAGES * PAGE} usage lines — run --prune.`);
}

async function venueName(locationId) {
  try {
    const doc = await call(`${DOCS}/locations/${locationId}`);
    return clean(doc?.fields?.name?.stringValue ?? '', 60) || null;
  } catch {
    return null;
  }
}

// FIRST NAME ONLY (as read-devices.mjs does). The uid pattern is checked before it enters a URL.
async function firstName(locationId, uid) {
  if (!/^[A-Za-z0-9]{1,128}$/.test(uid)) return null;
  try {
    const doc = await call(`${DOCS}/locations/${locationId}/members/${uid}`);
    return clean(doc?.fields?.firstName?.stringValue ?? '', 40) || null;
  } catch {
    return null;
  }
}

async function report(jsonFile) {
  const lines = await readUsage();
  if (lines.length === 0) { console.log('No usage recorded yet.'); return; }
  const venues = summarise(lines, Date.now());
  const names = new Map();
  for (const venue of venues) {
    const display = await venueName(venue.locationId);
    names.set(venue.locationId, display);
    const first = new Map();
    for (const [uid] of venue.last30.people) first.set(uid, await firstName(venue.locationId, uid));
    for (const [uid] of venue.last7.people) if (!first.has(uid)) first.set(uid, await firstName(venue.locationId, uid));
    console.log(summaryLines(venue, display, first).join('\n'));
  }
  if (jsonFile) {
    writeFileSync(jsonFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), venues: toJson(venues, names) }, null, 2)}\n`);
    console.log(`Numbers written to ${jsonFile}`);
  }
}

async function prune() {
  const now = Date.now();
  const old = (await readUsage()).filter(line => isStale(line, now));
  let deleted = 0;
  for (const line of old) {
    const where = usagePath(line.path);
    if (!where) continue;
    await call(`${DOCS}/${where.path}`, { method: 'DELETE' });
    deleted += 1;
  }
  console.log(`Deleted ${deleted} usage line${deleted === 1 ? '' : 's'} older than 400 days.`);
}

try {
  const args = process.argv.slice(2);
  const json = args[0] === '--json' && args.length === 2 && args[1];
  const pruning = args[0] === '--prune' && args.length === 1;
  if (args.length !== 0 && !json && !pruning) throw new Error('Usage: node scripts/read-usage.mjs [--json FILE | --prune]');
  signIn();
  if (pruning) await prune();
  else await report(json || null);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
