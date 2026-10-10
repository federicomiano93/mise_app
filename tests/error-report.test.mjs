// js/error-report.js — the flow, with every collaborator replaced; and the placement pins that
// must hold even if the flow is rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createReporter, install, THROTTLE_KEY, BUFFER_MAX, NO_STORAGE_PAGE_CAP } from '../js/error-report.js';
import { recordFromConsole } from '../js/error-model.js';
import { KEEP_PREFIXES, keysToClear } from '../js/local-data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const code = rel => read(rel).split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    data,
  };
}

const READY = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };

function deps(over = {}) {
  const sent = [];
  return {
    sent,
    storage: memoryStorage(),
    now: () => new Date(2026, 9, 9, 10, 0),
    origin: () => 'https://app.test',
    screen: () => 'orders',
    deviceId: () => 'Dev1ce2Id3Abc4Def5Gh',
    kind: () => 'phone',
    online: () => true,
    version: async () => '649',
    send: async payload => { sent.push(payload); },
    ...over,
  };
}

const settle = () => new Promise(r => setTimeout(r, 10));
const err = (message, extra = {}) => ({ source: 'error', message, code: null, stack: `Error: ${message}\n    at f (a.js:1:1)`, filename: null, ...extra });

test('a ready session sends the line with screen, version, device facts and no uid of its own', async () => {
  const d = deps();
  const r = createReporter(d);
  r.setSession(READY);
  r.report(err('boom', { code: 'unavailable', filename: 'https://app.test/js/secret.js' }));
  await settle();
  assert.equal(d.sent.length, 1);
  assert.deepEqual(d.sent[0], {
    source: 'error', screen: 'orders', appVersion: '649', deviceId: 'Dev1ce2Id3Abc4Def5Gh',
    deviceKind: 'phone', online: true, code: 'unavailable', message: 'boom', stack: 'Error: boom\n    at f (a.js:1:1)',
  });
});

test('before a venue is open errors are buffered (at most 10) and sent once the session is ready', async () => {
  const d = deps();
  const r = createReporter(d);
  for (let i = 0; i < BUFFER_MAX + 5; i += 1) r.report(err(`early ${i}`));
  await settle();
  assert.equal(d.sent.length, 0);
  assert.equal(r.buffered(), BUFFER_MAX);
  r.setSession({ status: 'loading' });
  r.setSession({ status: 'ready', locationId: null, user: { uid: 'u1' } });
  r.setSession({ status: 'ready', locationId: 'bakery', user: {} });
  await settle();
  assert.equal(d.sent.length, 0);
  r.setSession(READY);
  await settle();
  assert.equal(d.sent.length, BUFFER_MAX);
  assert.equal(r.buffered(), 0);
});

test('after a sign-out nothing is sent directly; it waits for the next ready session', async () => {
  const d = deps();
  const r = createReporter(d);
  r.setSession(READY);
  r.setSession({ status: 'signed-out' });
  r.report(err('while signed out'));
  await settle();
  assert.equal(d.sent.length, 0);
  r.setSession(READY);
  await settle();
  assert.equal(d.sent.length, 1);
});

test('the same error is sent once a day, and again tomorrow', async () => {
  let clock = new Date(2026, 9, 9, 10, 0);
  const d = deps({ now: () => clock });
  const r = createReporter(d);
  r.setSession(READY);
  r.report(err('same'));
  r.report(err('same'));
  r.report(err('other'));
  await settle();
  assert.equal(d.sent.length, 2);
  assert.equal(JSON.parse(d.storage.data[THROTTLE_KEY]).count, 2);
  clock = new Date(2026, 9, 10, 8, 0);
  r.report(err('same'));
  await settle();
  assert.equal(d.sent.length, 3);
});

test('at most 20 sends a device a day', async () => {
  const d = deps();
  const r = createReporter(d);
  r.setSession(READY);
  for (let i = 0; i < 40; i += 1) r.report(err(`distinct ${i}`));
  await settle();
  assert.equal(d.sent.length, 20);
});

test('the throttle survives a new page (it lives in storage)', async () => {
  const storage = memoryStorage();
  const a = deps({ storage });
  const first = createReporter(a);
  first.setSession(READY);
  first.report(err('again'));
  await settle();
  const b = deps({ storage });
  const second = createReporter(b);
  second.setSession(READY);
  second.report(err('again'));
  await settle();
  assert.equal(a.sent.length + b.sent.length, 1);
});

test('no usable storage (missing, throwing, or dropping writes): still sends, but at most 5 a page', async () => {
  const blocked = () => { throw new Error('blocked'); };
  for (const storage of [null, { getItem: blocked, setItem: blocked }, { getItem: () => null, setItem: () => {} }]) {
    const d = deps({ storage });
    const r = createReporter(d);
    r.setSession(READY);
    for (let i = 0; i < 12; i += 1) r.report(err(`n${i}`));
    r.report(err('n0'));
    await settle();
    assert.equal(d.sent.length, NO_STORAGE_PAGE_CAP, storage ? 'storage that cannot keep the count' : 'no storage');
  }
});

test('noise is dropped', async () => {
  const d = deps();
  const r = createReporter(d);
  r.setSession(READY);
  r.report({ source: 'error', message: 'ResizeObserver loop limit exceeded', stack: null, code: null });
  r.report({ source: 'error', message: 'Script error.', stack: null, code: null });
  r.report(err('from an extension', { filename: 'chrome-extension://abc/x.js' }));
  await settle();
  assert.equal(d.sent.length, 0);
});

test('a failing send never throws, never loops, and says only the code on console.warn', async () => {
  const warnings = [];
  const errors = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...a) => warnings.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const d = deps({ send: async () => { throw Object.assign(new Error('secret detail'), { code: 'permission-denied' }); } });
    const r = createReporter(d);
    r.setSession(READY);
    r.report(err('first'));
    await settle();
    assert.deepEqual(warnings, ['Error report not sent: permission-denied']);
    assert.deepEqual(errors, []);
    // A synchronous throw from the data layer, and a send that throws before returning a promise.
    const d2 = deps({ send: () => { throw new Error('sync'); } });
    const r2 = createReporter(d2);
    r2.setSession(READY);
    r2.report(err('second'));
    await settle();
    assert.equal(warnings.length, 2);
    assert.deepEqual(errors, []);
  } finally { console.warn = origWarn; console.error = origError; }
});

test('a console.error raised while reporting is not reported again (re-entrancy)', async () => {
  const fake = { error: () => {} };
  const calls = [];
  const d = deps({
    // The collaborator logs through the wrapped console while the reporter is inside report().
    origin: () => { fake.error('inside the reporter'); return 'https://app.test'; },
    send: async payload => { calls.push(payload); },
  });
  const r = createReporter(d);
  install(r, { addEventListener() {} }, fake);
  r.setSession(READY);
  fake.error('outside');
  await settle();
  assert.deepEqual(calls.map(c => c.message), ['outside']);
});

test('install: the original console.error runs first with the same arguments and its result is kept', async () => {
  const order = [];
  const fake = { error: function original(...args) { order.push(['original', args]); return 'printed'; } };
  const d = deps({ send: async () => { order.push(['send']); } });
  const r = createReporter(d);
  r.setSession(READY);
  assert.equal(install(r, { addEventListener() {} }, fake), true);
  const thing = { a: 1 };
  assert.equal(fake.error('saveLogDoc failed:', thing), 'printed');
  await settle();
  assert.deepEqual(order[0], ['original', ['saveLogDoc failed:', thing]]);
  assert.deepEqual(order[1], ['send']);
  assert.equal(install(r, { addEventListener() {} }, fake), false, 'wrapped once only');
});

test('install: a reporter that throws cannot break console.error or the page', () => {
  const printed = [];
  const fake = { error: (...a) => printed.push(a) };
  const broken = { report: () => { throw new Error('reporter bug'); } };
  install(broken, { addEventListener() {} }, fake);
  assert.doesNotThrow(() => fake.error('still prints'));
  assert.deepEqual(printed, [['still prints']]);
});

test('install: window errors and unhandled rejections reach the reporter', () => {
  const handlers = {};
  const target = { addEventListener: (type, fn) => { handlers[type] = fn; } };
  const got = [];
  install({ report: record => got.push(record) }, target, { error() {} });
  handlers.error({ error: new Error('uncaught'), filename: 'https://app.test/js/a.js', message: 'Uncaught Error: uncaught' });
  handlers.error({ error: null, filename: '', message: 'Script error.' });
  handlers.unhandledrejection({ reason: 'plain reason' });
  handlers.unhandledrejection({ reason: { a: 1 } });
  handlers.unhandledrejection({});
  assert.deepEqual(got.map(r => [r.source, r.message]), [
    ['error', 'uncaught'], ['error', 'Script error.'], ['rejection', 'plain reason'],
    ['rejection', '[object]'], ['rejection', 'undefined'],
  ]);
  assert.equal(got[0].filename, 'https://app.test/js/a.js');
});

test('the version is asked once per page', async () => {
  let asked = 0;
  const d = deps({ version: async () => { asked += 1; return '649'; } });
  const r = createReporter(d);
  r.setSession(READY);
  r.report(err('a'));
  r.report(err('b'));
  await settle();
  assert.equal(asked, 1);
  assert.equal(d.sent.length, 2);
});

test('a version that cannot be read still sends the line, with a null version', async () => {
  const d = deps({ version: async () => { throw new Error('no worker'); } });
  const r = createReporter(d);
  r.setSession(READY);
  r.report(err('a'));
  await settle();
  assert.equal(d.sent[0].appVersion, null);
});

test('recordFromConsole feeds the reporter the way the wrapper does', async () => {
  const d = deps();
  const r = createReporter(d);
  r.setSession(READY);
  r.report(recordFromConsole(['Logs listener never started (no location open):', Object.assign(new Error('x'), { code: 'failed-precondition' })]));
  await settle();
  assert.equal(d.sent[0].source, 'console');
  assert.equal(d.sent[0].code, 'failed-precondition');
});

test('the file never calls console.error itself, and never builds a uid, name or email', () => {
  const src = code('js/error-report.js');
  assert.ok(!/console\.error\s*\(/.test(src), 'the reporter must report its own failures with console.warn');
  assert.match(src, /console\.warn\(/);
  assert.ok(!/\b(email|displayName|firstName|lastName|uid:)/.test(src.replace(/session\.user && session\.user\.uid/g, '')),
    'the uid is added by the data layer, never here');
  assert.ok(!/setItem\(\s*DEVICE_ID_KEY/.test(src), 'the device id is read, never created here');
});

test('start/install runs at module level, listeners first, then the session', () => {
  const src = code('js/error-report.js');
  assert.match(src, /if \(typeof window !== 'undefined' && typeof document !== 'undefined'\) start\(\);/);
  const fn = src.slice(src.indexOf('function start()'), src.indexOf('if (typeof window'));
  assert.match(fn, /install\(reporter, window, console\)/);
  assert.match(fn, /onSession\(/);
  assert.ok(fn.indexOf('install(') < fn.indexOf('onSession('), 'listeners go on before the session arrives');
});

test('reportError writes through addDoc with the signed-in uid and the server clock', () => {
  const firebase = read('js/firebase.js');
  const fn = firebase.slice(firebase.indexOf('export function reportError'), firebase.indexOf('// Delete one whole log document'));
  assert.match(fn, /addDoc\(collection\(db, pathFor\('errors'\)\)/);
  assert.match(fn, /serverTimestamp\(\)/);
  assert.match(fn, /uid: auth\.currentUser\.uid/);
  assert.match(fn, /bakery: currentLocationId\(\)/);
  assert.match(fn, /code: 'unauthenticated'/);
  assert.ok(fn.indexOf('...record') < fn.indexOf('uid:'), 'the record is spread first so it cannot override uid');
  assert.match(read('js/firebase.example.js'), /export function reportError\(record\)/);
});

test('the staff door starts it; the client ordering page and the reset page do not', () => {
  assert.match(read('js/auth-gate.js'), /^import '\.\/error-report\.js';$/m);
  for (const page of ['order.html', 'reset-password.html']) {
    const html = read(page).replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/error-report/.test(html), page);
    assert.ok(!/auth-gate\.js/.test(html), page);
  }
});

test('the throttle key survives a sign-out; the files are precached', () => {
  assert.deepEqual(keysToClear([THROTTLE_KEY, 'device-id', 'some-cache']), ['some-cache']);
  assert.ok(KEEP_PREFIXES.includes('error-reports'));
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/error-report\.js'/);
  assert.match(sw, /'\.\/js\/error-model\.js'/);
});

test('pins: the real sender calls reportError, and start() wires the session into the reporter', () => {
  const src = code('js/error-report.js');
  assert.match(src, /import\('\.\/firebase\.js'\)\.then\(m => m\.reportError\(payload\)\)/);
  const fn = src.slice(src.indexOf('function start()'), src.indexOf('if (typeof window'));
  assert.match(fn, /onSession\(session => reporter\.setSession\(session\)\)/);
});
