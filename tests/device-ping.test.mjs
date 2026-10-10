// js/device-ping.js — the flow, with every collaborator replaced; and the privacy and
// placement pins that must hold even if the flow is rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pingIfDue, deviceIdFrom, DEVICE_ID_KEY, PING_DAY_KEY_PREFIX } from '../js/device-ping.js';
import { sameSession } from '../js/device-model.js';
import { KEEP_PREFIXES, keysToClear } from '../js/local-data.js';
import { missingFromPrecache } from './helpers/precache.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    data,
  };
}

function deps(over = {}) {
  const sent = [];
  return {
    sent,
    storage: memoryStorage(),
    randomBytes: () => Uint8Array.from({ length: 64 }, (_, i) => (i * 7) % 200),
    now: () => new Date(2026, 9, 9, 10, 0),
    kind: () => 'phone',
    installed: () => true,
    version: async () => '643',
    send: async (payload, id) => { sent.push({ payload, id }); },
    ...over,
  };
}

const STAMP = PING_DAY_KEY_PREFIX + 'bakery-u1';
const READY = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };

test('a ready venue is reported once, with the signed-in uid, the four facts and a fresh id', async () => {
  const d = deps();
  assert.equal(await pingIfDue(READY, d), 'sent');
  assert.equal(d.sent.length, 1);
  assert.deepEqual(d.sent[0].payload, { bakery: 'bakery', uid: 'u1', kind: 'phone', appVersion: '643', installed: true });
  assert.match(d.sent[0].id, /^[A-Za-z0-9]{20}$/);
  assert.equal(d.storage.data[DEVICE_ID_KEY], d.sent[0].id);
  assert.equal(d.storage.data[STAMP], '2026-10-09');
});

test('the same device, the same venue, the same day: no second write', async () => {
  const d = deps();
  await pingIfDue(READY, d);
  assert.equal(await pingIfDue(READY, d), 'not-due');
  assert.equal(d.sent.length, 1);
});

test('another venue the same day is reported, with the SAME device id', async () => {
  const d = deps();
  await pingIfDue(READY, d);
  assert.equal(await pingIfDue({ status: 'ready', locationId: 'loc-b', user: { uid: 'u1' } }, d), 'sent');
  assert.equal(d.sent.length, 2);
  assert.equal(d.sent[0].id, d.sent[1].id);
});

test('another person on the same device, same day, is reported', async () => {
  const d = deps();
  await pingIfDue(READY, d);
  assert.equal(await pingIfDue({ ...READY, user: { uid: 'u2' } }, d), 'sent');
  assert.equal(d.sent.length, 2);
  assert.equal(d.sent[0].id, d.sent[1].id);
  assert.equal(d.sent[1].payload.uid, 'u2');
  assert.equal(await pingIfDue({ ...READY, user: { uid: 'u2' } }, d), 'not-due');
});

test('a write that never settles (offline) still stamps the day, so the next page does not queue another', async () => {
  // Its own account: the never-settling write stays «in flight» for the life of the module.
  const hanging = { ...READY, user: { uid: 'hangs' } };
  const d = deps({ send: payload => { d.sent.push(payload); return new Promise(() => {}); } });
  pingIfDue(hanging, d);   // never awaited: it will not settle
  await new Promise(r => setTimeout(r, 20));
  assert.equal(d.sent.length, 1);
  assert.equal(d.storage.data[PING_DAY_KEY_PREFIX + 'bakery-hangs'], '2026-10-09');
});

test('a passing failure takes the stamp back; a refusal keeps it', async () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    for (const code of ['unavailable', 'unauthenticated', 'deadline-exceeded']) {
      const d = deps({ send: async () => { throw Object.assign(new Error('x'), { code }); } });
      assert.equal(await pingIfDue(READY, d), 'failed');
      assert.equal(d.storage.data[STAMP], undefined, code);
    }
    const d = deps({ send: async () => { throw Object.assign(new Error('x'), { code: 'invalid-argument' }); } });
    await pingIfDue(READY, d);
    assert.equal(d.storage.data[STAMP], '2026-10-09');
  } finally { console.warn = original; }
});

test('the same venue and account is never sent twice at the same moment', async () => {
  let release;
  const d = deps({ send: payload => { d.sent.push(payload); return new Promise(r => { release = r; }); } });
  const slow = { ...READY, user: { uid: 'slow' } };
  const first = pingIfDue(slow, d);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(await pingIfDue(slow, d), 'skipped');
  release();
  assert.equal(await first, 'sent');
  assert.equal(d.sent.length, 1);
});

test('tomorrow it is reported again', async () => {
  const d = deps();
  await pingIfDue(READY, d);
  d.now = () => new Date(2026, 9, 10, 8, 0);
  assert.equal(await pingIfDue(READY, d), 'sent');
});

test('only a venue that is open and ready, with a signed-in uid, is reported', async () => {
  const d = deps();
  for (const s of [null, { status: 'hub' }, { status: 'no-access' }, { status: 'signed-out' },
    { status: 'loading' }, { status: 'ready' }, { status: 'ready', locationId: null },
    { status: 'ready', locationId: 'bakery' }, { status: 'ready', locationId: 'bakery', user: {} }]) {
    assert.equal(await pingIfDue(s, d), 'skipped');
  }
  assert.equal(d.sent.length, 0);
});

test('no usable storage: nothing is sent, with a throwaway id or otherwise', async () => {
  const noStorage = deps({ storage: null });
  assert.equal(await pingIfDue(READY, noStorage), 'no-storage');
  const droppingWrites = deps({ storage: { getItem: () => null, setItem: () => {} } });
  assert.equal(await pingIfDue(READY, droppingWrites), 'no-storage');
  const blocked = () => { throw new Error('blocked'); };
  const throwing = deps({ storage: { getItem: blocked, setItem: blocked } });
  assert.equal(await pingIfDue(READY, throwing), 'no-storage');
  assert.equal(noStorage.sent.length + droppingWrites.sent.length + throwing.sent.length, 0);
});

test('a failed send never throws, says only the error code, and is tried again next page', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const d = deps({ send: async () => { throw Object.assign(new Error('secret detail'), { code: 'unavailable' }); } });
    assert.equal(await pingIfDue(READY, d), 'failed');
    assert.equal(d.storage.data[STAMP], undefined);
    assert.deepEqual(warnings, ['Device count not sent: unavailable']);
  } finally { console.warn = original; }
});

test('a refusal by the rules is not retried on every page of the day', async () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    const d = deps({ send: async () => { throw Object.assign(new Error('x'), { code: 'permission-denied' }); } });
    assert.equal(await pingIfDue(READY, d), 'failed');
    assert.equal(d.storage.data[STAMP], '2026-10-09');
  } finally { console.warn = original; }
});

test('a known id is kept; a damaged one is replaced', () => {
  const kept = memoryStorage({ [DEVICE_ID_KEY]: 'Ab3dEf6hIj9lMn2pQr5t' });
  assert.equal(deviceIdFrom(kept, () => new Uint8Array(64)), 'Ab3dEf6hIj9lMn2pQr5t');
  const damaged = memoryStorage({ [DEVICE_ID_KEY]: 'nonsense' });
  assert.match(deviceIdFrom(damaged, () => Uint8Array.from({ length: 64 }, (_, i) => i)), /^[A-Za-z0-9]{20}$/);
});

test('the id and the day survive a sign-out and a venue switch', () => {
  assert.deepEqual(keysToClear([DEVICE_ID_KEY, PING_DAY_KEY_PREFIX + 'bakery-u1', 'device-other', 'some-cache']), ['device-other', 'some-cache']);
  assert.ok(KEEP_PREFIXES.some(p => DEVICE_ID_KEY.startsWith(p)));
});

test('the line carries the signed-in uid but never a name or email, and is written whole with the server clock', () => {
  // By the owner's choice (9 Oct 2026) the line says WHOSE device it is: the uid, and only the
  // writer's own (the rules check uid == request.auth.uid). A name or an email never goes in.
  const ping = read('js/device-ping.js').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\b(email|displayName|firstName|lastName)\b/.test(ping), 'device-ping.js must not touch a name or an email');
  assert.match(ping, /session\.user && session\.user\.uid/, 'the uid comes from the open session');
  const firebase = read('js/firebase.js');
  const fn = firebase.slice(firebase.indexOf('export function pingDevice'), firebase.indexOf('// Delete one whole log document'));
  assert.match(fn, /serverTimestamp\(\)/);
  assert.match(fn, /uid: auth\.currentUser\.uid/, "the uid written is the signed-in account's");
  assert.ok(!/payload\.uid/.test(fn), 'never falls back to the payload uid');
  assert.match(fn, /code: 'unauthenticated'/, 'signed out is a passing failure');
  assert.ok(!/merge/.test(fn) && !/\b(email|displayName)\b/.test(fn));
  assert.match(read('js/firebase.example.js'), /export function pingDevice\(payload, id\)/);
});

test('the staff door starts it and the client ordering page does not', () => {
  assert.match(read('js/auth-gate.js'), /^import '\.\/device-ping\.js';$/m);
  const order = read('order.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/device-ping/.test(order));
  assert.ok(!/auth-gate\.js/.test(order));
});

test('the fire-time check: same venue and same account, still ready', () => {
  const a = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };
  assert.equal(sameSession(a, { ...a }), true);
  assert.equal(sameSession(a, { ...a, locationId: 'loc-b' }), false);
  assert.equal(sameSession(a, { ...a, user: { uid: 'u2' } }), false);
  assert.equal(sameSession(a, { status: 'signed-out' }), false);
  assert.equal(sameSession(a, { ...a, status: 'loading' }), false);
  assert.equal(sameSession(a, null), false);
  assert.equal(sameSession(null, a), false);
  assert.equal(sameSession({ ...a, user: null }, { ...a, user: null }), false);
});

test('the counter starts: start() runs at load and waits, re-reads the session, then pings', () => {
  const ping = read('js/device-ping.js').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.match(ping, /if \(typeof window !== 'undefined' && typeof document !== 'undefined'\) start\(\);/);
  const fn = ping.slice(ping.indexOf('function start()'), ping.indexOf('if (typeof window'));
  assert.match(fn, /onSession\(/);
  assert.match(fn, /setTimeout\(/);
  assert.match(fn, /currentSession\(\)/);
  assert.match(fn, /sameSession\(session, now\)/);
  assert.match(fn, /pingIfDue\(now\)/);
  assert.ok(fn.indexOf('onSession(') < fn.indexOf('setTimeout(') && fn.indexOf('setTimeout(') < fn.indexOf('sameSession(') && fn.indexOf('sameSession(') < fn.indexOf('pingIfDue('));
});

test('only the two real prefixes are kept, not everything that starts with device-', () => {
  assert.ok(KEEP_PREFIXES.includes('device-id') && KEEP_PREFIXES.includes('device-ping-'));
  assert.ok(!KEEP_PREFIXES.includes('device-'));
});

test('both new files are precached', () => {
  assert.deepEqual(missingFromPrecache(['js/device-ping.js', 'js/device-model.js']), []);
});
