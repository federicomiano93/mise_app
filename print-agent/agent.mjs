// agent.mjs — the program on the shop computer that turns queued labels into paper.
//
// ⚠️⚠️ THIS IS THE ONLY WAY A PHONE CAN PRINT TO A PRINTER ON A CABLE. No browser on
// any phone can reach a printer attached to a different machine; that is a fact about
// phones and no amount of app can change it. So the phone writes a job to Firestore
// and this program, running where the printer is plugged in, takes it and prints it.
//
// ⚠️ ZERO DEPENDENCIES, ON PURPOSE. It is plain Node — global fetch, node:net,
// node:child_process — and there is no package.json and no node_modules. The
// alternative was the Firebase SDK, which would have put a dependency tree on a shop
// computer that nobody will ever update. This repository's rule is that a new
// dependency is a decision to escalate rather than to make, and this one turned out
// not to be needed at all.
//
// ⚠️ WHAT THAT COSTS, STATED AS A NUMBER (P14): with no SDK there is no live
// listener, so the queue is POLLED. Idle it asks every 15 seconds — about 5 800
// reads a day against a free allowance of 50 000 — and speeds up to every 3 seconds
// for a minute after it sees work, so printing feels immediate when somebody is
// actually printing. POLL_IDLE_MS below is the dial if that ever needs turning down.
//
// ⚠️ IT SIGNS IN AS AN ORDINARY EMPLOYEE, never with a service account. A service
// account key on a shop computer would bypass every Firestore rule in the database;
// this account can read the venue's recipes and print jobs and nothing more, exactly
// like any phone on the counter.
//
// Run it:   node print-agent/agent.mjs
// Set it up: see print-agent/README.md

import { readFileSync } from 'node:fs';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

import {
  canMove, nextJob, expiredJobs, HEARTBEAT_MS,
} from '../js/print-queue-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const VERSION = '1.0.0';
const POLL_IDLE_MS = 15000;
const POLL_BUSY_MS = 3000;
const BUSY_FOR_MS = 60000;      // stay quick for a minute after seeing work
const CLEANUP_EVERY_MS = 30 * 60 * 1000;

// ── Where the credentials live ───────────────────────────────────────────────
//
// ⚠️⚠️ OUTSIDE THIS REPOSITORY, ALWAYS. GitHub Pages serves everything in the repo,
// so a credentials file that drifted in here would publish an account password on
// the web the moment somebody committed it. The default is under LOCALAPPDATA and
// it is not a suggestion.
function configPath() {
  if (process.env.MISE_AGENT_CONFIG) return process.env.MISE_AGENT_CONFIG;
  const base = process.env.LOCALAPPDATA || process.env.XDG_CONFIG_HOME || tmpdir();
  return join(base, 'Mise', 'print-agent.json');
}

function loadConfig() {
  const path = configPath();
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    die(`No settings file at ${path}.\nCopy print-agent/print-agent.example.json there and fill it in.`);
  }
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) { die(`${path} is not valid JSON: ${e.message}`); }

  for (const key of ['email', 'password', 'locationId', 'printer']) {
    if (!cfg[key]) die(`${path} is missing "${key}".`);
  }
  const mode = cfg.printer.mode;
  if (mode !== 'share' && mode !== 'tcp') {
    die(`printer.mode must be "share" (a printer on this computer) or "tcp" (one on the network).`);
  }
  if (mode === 'share' && !cfg.printer.target) die('printer.target is missing — e.g. "\\\\\\\\THIS-PC\\\\ZEBRA".');
  if (mode === 'tcp' && !cfg.printer.host) die('printer.host is missing — the printer\'s address on the network.');
  return cfg;
}

// ⚠️ THE PROJECT'S OWN PUBLIC CONFIG IS READ OUT OF THE APP, NOT COPIED HERE. Two
// copies of an api key is two things to change when a project moves, and the one
// that gets forgotten is the one on a computer in a back room. Each field is pulled
// with its own narrow pattern and a named failure, rather than by parsing the whole
// object — a parser that half-works would hand this program a wrong project id and
// it would fail as «permission denied», which explains nothing.
function readAppConfig() {
  const src = readFileSync(join(REPO, 'js', 'firebase.js'), 'utf8');
  const one = (field) => {
    const m = src.match(new RegExp(`${field}:\\s*"([^"]+)"`));
    if (!m) die(`Could not find ${field} in js/firebase.js — has that file changed shape?`);
    return m[1];
  };
  return { apiKey: one('apiKey'), projectId: one('projectId') };
}

// ── Signing in ───────────────────────────────────────────────────────────────

async function signIn({ apiKey }, { email, password }) {
  const r = await fetch(`${authBase()}/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await r.json();
  if (!r.ok) die(`Sign-in refused: ${body.error && body.error.message}`);
  return {
    uid: body.localId,
    idToken: body.idToken,
    refreshToken: body.refreshToken,
    // ⚠️ REFRESHED EARLY, NOT ON EXPIRY. A token that expires mid-print turns one
    // label into a permission error, and this program is meant to run for months.
    expiresAt: Date.now() + (Number(body.expiresIn || 3600) - 300) * 1000,
  };
}

async function freshToken({ apiKey }, session) {
  if (Date.now() < session.expiresAt) return session;
  const r = await fetch(`${tokenBase()}/token?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`,
  });
  const body = await r.json();
  if (!r.ok) die(`Could not refresh the sign-in: ${body.error && body.error.message}`);
  session.idToken = body.id_token;
  session.refreshToken = body.refresh_token;
  session.expiresAt = Date.now() + (Number(body.expires_in || 3600) - 300) * 1000;
  return session;
}

// ── Talking to Firestore over REST ───────────────────────────────────────────
//
// The SDK's shapes by hand: a document is { fields: { name: { stringValue } } }.
// Only the four types this program uses are handled, and anything else is left
// alone rather than guessed at.

const encode = (v) => {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { nullValue: null };
};

const decode = (f) => {
  if (!f) return null;
  if ('stringValue' in f) return f.stringValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  return null;
};

const toDoc = (fields) => Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, encode(v)]));
const fromDoc = (d) => Object.fromEntries(Object.entries((d && d.fields) || {}).map(([k, v]) => [k, decode(v)]));

// ⚠️⚠️ THE EMULATOR SWITCH, AND IT EXISTS BECAUSE OF A LESSON THIS PROJECT HAS
// ALREADY PAID FOR THREE TIMES. Without it the only way to try this program is
// against the REAL database — the same trap as the Cloud Functions calls that ran
// against production from a page whose console said «LOCAL EMULATOR mode». Set
// MISE_AGENT_EMULATOR=127.0.0.1:8080 (and 9099 for auth) and nothing here can reach
// Google at all.
//
// ⚠️ IT IS AN ENVIRONMENT VARIABLE, NEVER A SETTING IN THE FILE. A settings file is
// copied from machine to machine; a shop computer that inherited «emulator» from
// somebody's test would print nothing and explain nothing.
const EMULATOR = process.env.MISE_AGENT_EMULATOR || '';
const AUTH_EMULATOR = process.env.MISE_AGENT_AUTH_EMULATOR || '';

function api(cfg) {
  const base = EMULATOR
    ? `http://${EMULATOR}/v1`
    : 'https://firestore.googleapis.com/v1';
  return `${base}/projects/${cfg.projectId}/databases/(default)/documents`;
}

function authBase() {
  return AUTH_EMULATOR
    ? `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`
    : 'https://identitytoolkit.googleapis.com/v1';
}

function tokenBase() {
  return AUTH_EMULATOR
    ? `http://${AUTH_EMULATOR}/securetoken.googleapis.com/v1`
    : 'https://securetoken.googleapis.com/v1';
}

async function call(url, session, init = {}) {
  const r = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.idToken}`,
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
  return { ok: r.ok, status: r.status, body };
}

// ── The queue ────────────────────────────────────────────────────────────────

async function listJobs(app, cfg, session) {
  const url = `${api(app)}/locations/${cfg.locationId}/print-jobs?pageSize=50`;
  const { ok, body, status } = await call(url, session);
  if (!ok) throw new Error(`could not read the queue (${status}): ${body && body.error && body.error.message}`);
  return (body.documents || []).map(d => ({
    _name: d.name,
    _updateTime: d.updateTime,
    ...fromDoc(d),
  }));
}

// ⚠️⚠️ THE CLAIM IS CONDITIONAL, AND THIS IS WHAT STOPS A LABEL PRINTING TWICE.
// The write carries the document's updateTime as a precondition: if another agent
// touched it first, the server refuses this one outright. The security rules refuse
// queued→claimed from anything that is no longer queued as well — two locks, because
// the failure they prevent is a duplicate allergen label on somebody's food, and the
// program on the other side of the race is one nobody is watching.
// ⚠️⚠️ IT GOES THROUGH :commit AND NOT THROUGH A REST PATCH, AND BOTH REASONS COST
// AN AFTERNOON TO FIND. A `PATCH …?currentDocument.updateTime=…`:
//
//   1. IGNORED THE PRECONDITION ENTIRELY. The server answered «the stored version
//      does not match the required base version (0)» — the timestamp never reached
//      it, so the one lock against two agents printing the same label was not there
//      at all, and nothing said so.
//   2. WAS EVALUATED AS A **CREATE** as well as an update, because a PATCH on a path
//      may create. That ran this collection's create rule against a document that
//      already existed and produced an EVALUATION ERROR — which comes back as 403,
//      indistinguishable from an ordinary refusal. Hours of «why can the agent not
//      claim a job» that had nothing to do with permissions.
//
// The :commit endpoint takes the precondition as a structured field, is unambiguously
// an update, and was proved against the emulator three ways: a stale precondition is
// refused, the current one succeeds, and a second agent using the same one is refused.
async function commitWrite(app, session, write) {
  const root = api(app).replace(/\/documents$/, '');
  const { ok, status, body } = await call(`${root}/documents:commit`, session, {
    method: 'POST',
    body: JSON.stringify({ writes: [write] }),
  });
  return { ok, status, body };
}

async function claim(app, session, job, uid) {
  if (!canMove(job.status, 'claimed')) return false;
  const { ok, status } = await commitWrite(app, session, {
    update: {
      name: job._name,
      fields: toDoc({ status: 'claimed', claimedBy: uid, claimedAt: new Date().toISOString() }),
    },
    updateMask: { fieldPaths: ['status', 'claimedBy', 'claimedAt'] },
    // ⚠️ THE LOCK. If another agent touched the document first its version has moved
    // and this write is refused outright.
    currentDocument: { updateTime: job._updateTime },
  });
  // ⚠️ A REFUSED PRECONDITION IS THE SYSTEM WORKING, not an error to report or
  // retry: it means the other agent got there first and is printing it.
  if (!ok && (status === 400 || status === 409 || status === 412)) return false;
  if (!ok) throw new Error(`could not claim a job (${status})`);
  return true;
}

async function finish(app, session, job, ok, error) {
  await commitWrite(app, session, {
    update: {
      name: job._name,
      fields: toDoc(ok ? { status: 'done' } : { status: 'failed', error: String(error).slice(0, 500) }),
    },
    updateMask: { fieldPaths: ok ? ['status'] : ['status', 'error'] },
    currentDocument: { exists: true },
  });
  // ⚠️ A PRINTED JOB IS CLEARED AWAY. An unbounded queue is unbounded reads, on
  // every app open, for ever.
  if (ok) await commitWrite(app, session, { delete: job._name });
}

async function sweep(app, cfg, session, jobs) {
  for (const job of expiredJobs(jobs, Date.now())) {
    await commitWrite(app, session, { delete: job._name });
  }
}

// ── Saying «I am here» ───────────────────────────────────────────────────────
//
// ⚠️ THE PHONE MUST BE TOLD, NOT LEFT TO GUESS (P17). Somebody at the counter who
// taps Print and sees nothing has no way to tell a slow network from a computer that
// was switched off last night. This is what lets the app say which, before the tap.
async function beat(app, cfg, session, agentId, printerName) {
  const path = `locations/${cfg.locationId}/print-agents/${agentId}`;
  await call(`${api(app)}/${path}`, session, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: toDoc({
        bakery: cfg.locationId,
        lastSeenAt: new Date().toISOString(),
        printer: printerName,
        version: VERSION,
      }),
    }),
  });
}

// ── Putting bytes on paper ───────────────────────────────────────────────────

// A printer on this computer, shared so raw bytes can be written to it.
//
// ⚠️⚠️ RAW, WHICH IS THE WHOLE POINT — a Windows driver would RASTERISE the ZPL and
// print a page of the codes as text. Sharing the printer and copying bytes to the
// share bypasses the driver's rendering, which is why the README asks for a share
// rather than a printer name.
//
// ⚠️ AND THE EXIT CODE IS CHECKED. A copy to a share that does not exist fails
// quietly enough to look like success if nobody asks — "the network path was not
// found" goes to stderr and the job would otherwise be marked printed.
async function printToShare(target, text) {
  const dir = await mkdtemp(join(tmpdir(), 'mise-label-'));
  const file = join(dir, 'label.zpl');
  await writeFile(file, text, 'binary');
  try {
    await new Promise((resolve, reject) => {
      const p = spawn('cmd.exe', ['/c', 'copy', '/b', file, target], { windowsHide: true });
      let err = '';
      p.stderr.on('data', d => { err += d.toString(); });
      p.stdout.on('data', d => { err += d.toString(); });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`copy to ${target} failed (${code}): ${err.trim()}`));
      });
    });
  } finally {
    await unlink(file).catch(() => {});
  }
}

// A printer with its own address on the network, on the port every label printer
// listens on. Node can open this socket; no browser can, which is half the reason
// this program exists.
function printToTcp(host, port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: port || 9100 });
    const fail = (e) => { socket.destroy(); reject(e); };
    socket.setTimeout(15000, () => fail(new Error(`${host}:${port || 9100} did not answer`)));
    socket.on('error', fail);
    socket.on('connect', () => socket.end(text, 'binary'));
    socket.on('close', () => resolve());
  });
}

async function printJob(cfg, text) {
  if (cfg.printer.mode === 'tcp') return printToTcp(cfg.printer.host, cfg.printer.port, text);
  return printToShare(cfg.printer.target, text);
}

// ── The loop ─────────────────────────────────────────────────────────────────

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const printerName = (cfg) => (cfg.printer.mode === 'tcp'
  ? `${cfg.printer.host}:${cfg.printer.port || 9100}`
  : cfg.printer.target);

async function main() {
  const cfg = loadConfig();
  const app = readAppConfig();
  const agentId = (process.env.MISE_AGENT_ID || hostname() || 'shop-pc')
    .replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60) || 'shop-pc';

  let session = await signIn(app, cfg);
  console.log(`Misé print agent ${VERSION}`);
  // ⚠️ SAID OUT LOUD, EVERY TIME. A window that does not say which database it is
  // talking to is how somebody tests against production and never finds out.
  console.log(`  data:    ${EMULATOR ? `LOCAL EMULATOR ${EMULATOR}` : 'PRODUCTION'}`);
  console.log(`  venue:   ${cfg.locationId}`);
  console.log(`  printer: ${printerName(cfg)}`);
  console.log(`  agent:   ${agentId}`);
  console.log('  waiting for labels — leave this window open.\n');

  let busyUntil = 0;
  let lastBeat = 0;
  let lastSweep = 0;

  // ⚠️ ONE FAILURE MUST NOT STOP THE PROGRAM. A shop computer loses its network
  // several times a day; an agent that exits on the first hiccup is one somebody has
  // to notice and restart, and nobody is watching this window.
  for (;;) {
    try {
      session = await freshToken(app, session);

      if (Date.now() - lastBeat > HEARTBEAT_MS) {
        await beat(app, cfg, session, agentId, printerName(cfg));
        lastBeat = Date.now();
      }

      const jobs = await listJobs(app, cfg, session);

      if (Date.now() - lastSweep > CLEANUP_EVERY_MS) {
        await sweep(app, cfg, session, jobs);
        lastSweep = Date.now();
      }

      const job = nextJob(jobs, Date.now());
      if (job) {
        busyUntil = Date.now() + BUSY_FOR_MS;
        if (await claim(app, session, job, session.uid)) {
          const when = new Date().toLocaleTimeString();
          try {
            await printJob(cfg, job.payload);
            await finish(app, session, job, true);
            console.log(`${when}  printed 1 label`);
          } catch (err) {
            await finish(app, session, job, false, err.message);
            console.error(`${when}  FAILED: ${err.message}`);
          }
        }
      }
    } catch (err) {
      console.error(`${new Date().toLocaleTimeString()}  ${err.message}`);
    }
    const wait = Date.now() < busyUntil ? POLL_BUSY_MS : POLL_IDLE_MS;
    await new Promise(r => setTimeout(r, wait));
  }
}

// Exported for the tests; nothing else imports this file.
export { encode, decode, toDoc, fromDoc, readAppConfig, printerName };

if (process.argv[1] && process.argv[1].endsWith('agent.mjs')) {
  main().catch((err) => die(err.stack || err.message));
}
