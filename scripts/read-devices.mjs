// read-devices.mjs — counts the devices that use the app (`locations/{lid}/devices/{id}`,
// js/device-ping.js) in PRODUCTION, per venue. Numbers and first names: no device id, uid or
// email is ever printed.
//
//   node scripts/read-devices.mjs            per venue: devices seen in 7 / 30 days / on file,
//                                            split by kind, installed vs browser, app version,
//                                            and devices per person (first name)
//   node scripts/read-devices.mjs --prune    delete the lines not seen for 90 days
//
// ⚠️ WHY HERE AND NOT IN THE APP. The rules let a device WRITE its own line and nothing else —
// not even read it back. This script reads with the owner's own Google login
// (`gcloud auth login`), which bypasses the rules. The token is used in a header and never
// printed.
//
// ⚠️ IT READS PRODUCTION AND DELETES ONLY STALE DEVICE LINES. The project is a constant, only
// the six fields of a line are selected, and each DELETE path is checked against a strict
// pattern (device-summary.mjs) before the request is made. Lines are kept no longer than they
// are useful (P13).
import { execSync } from 'node:child_process';
import { devicesFrom, summarise, summaryLines, isStale, devicePath } from './device-summary.mjs';
import { clean } from './feedback-notes.mjs';

const PROJECT = 'bakery-app-ebf90';
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function accessToken() {
  try {
    // A fixed command string: on Windows gcloud is a .cmd, which only a shell can start.
    const out = execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim();
    if (/^[\w.\-~+/]+=*$/.test(out)) return out;
  } catch { /* reported below */ }
  throw new Error('gcloud could not print an access token — run `gcloud auth login`.');
}

const token = accessToken();
const headers = {
  Authorization: `Bearer ${token}`,
  'x-goog-user-project': PROJECT,
  'Content-Type': 'application/json',
};

async function call(url, init = {}) {
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Firestore answered ${res.status} for ${init.method || 'GET'} ${url.slice(DOCS.length) || '/'}`);
  return res.status === 204 ? null : res.json();
}

const FIELDS = ['bakery', 'uid', 'kind', 'appVersion', 'installed', 'lastSeen'];

// Every device line in every venue. No filter and no order, so no index; only the six fields
// of a line are asked for.
async function readDevices() {
  const rows = await call(`${DOCS}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'devices', allDescendants: true }],
        select: { fields: FIELDS.map(fieldPath => ({ fieldPath })) },
        // A thousand is the ceiling of this script; the printout says so if it is reached.
        limit: 1000,
      },
    }),
  });
  return devicesFrom(rows);
}

async function venueName(locationId) {
  try {
    const doc = await call(`${DOCS}/locations/${locationId}`);
    return clean(doc?.fields?.name?.stringValue ?? '', 60) || null;
  } catch {
    return null;
  }
}

// FIRST NAME ONLY (as read-feedback.mjs does): enough to say whose devices they are; the
// surname and email stay in the roster. The uid pattern is checked before it enters a URL.
async function firstName(locationId, uid) {
  if (!/^[A-Za-z0-9]{1,128}$/.test(uid)) return null;
  try {
    const doc = await call(`${DOCS}/locations/${locationId}/members/${uid}`);
    return clean(doc?.fields?.firstName?.stringValue ?? '', 40) || null;
  } catch {
    return null;
  }
}

async function report() {
  const devices = await readDevices();
  if (devices.length === 0) { console.log('No devices counted yet.'); return; }
  if (devices.length >= 1000) console.log('⚠️ 1000 lines read: the list may be longer — run --prune, or raise the limit.');
  const venues = summarise(devices, Date.now());
  for (const venue of venues) {
    const names = new Map();
    for (const [uid] of venue.people) names.set(uid, await firstName(venue.locationId, uid));
    console.log(summaryLines(venue, await venueName(venue.locationId), names).join('\n'));
  }
}

async function prune() {
  const now = Date.now();
  const stale = (await readDevices()).filter(device => isStale(device, now));
  let deleted = 0;
  for (const device of stale) {
    const where = devicePath(device.path);
    if (!where) continue;
    await call(`${DOCS}/${where.path}`, { method: 'DELETE' });
    deleted += 1;
  }
  console.log(`Deleted ${deleted} device line${deleted === 1 ? '' : 's'} not seen for 90 days.`);
}

try {
  const args = process.argv.slice(2);
  if (args.length === 0) await report();
  else if (args[0] === '--prune' && args.length === 1) await prune();
  else throw new Error('Usage: node scripts/read-devices.mjs [--prune]');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
