import { test } from 'node:test';
import assert from 'node:assert/strict';

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function install() {
  const log = { requests: 0, releases: 0 };
  setNavigator({ wakeLock: { async request() {
    log.requests++;
    return { addEventListener() {}, release() { log.releases++; } };
  } } });
  const vis = new Map();
  globalThis.document = { visibilityState: 'visible',
    addEventListener(t, f) { vis.set(t, f); }, removeEventListener(t) { vis.delete(t); } };
  return { log, vis };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('held while any owner holds it, released with the last', async () => {
  const { log } = install();
  const { acquireWakeLock, releaseWakeLock } = await import('../js/wake-lock.js');
  acquireWakeLock('a'); acquireWakeLock('b'); await tick();
  assert.equal(log.requests, 1);
  releaseWakeLock('a'); assert.equal(log.releases, 0);
  releaseWakeLock('b'); assert.equal(log.releases, 1);
});

test('refreshWakeLock asks again after the sentinel was released, and after a refused request', async () => {
  const log = { requests: 0, fail: false, sentinels: [] };
  setNavigator({ wakeLock: { async request() {
    log.requests++;
    if (log.fail) throw new Error('refused');
    const s = { listener: null, addEventListener(t, f) { s.listener = f; }, release() {} };
    log.sentinels.push(s);
    return s;
  } } });
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const { acquireWakeLock, releaseWakeLock, refreshWakeLock } = await import('../js/wake-lock.js');

  refreshWakeLock(); await tick();
  assert.equal(log.requests, 0, 'no owner: nothing to ask for');

  acquireWakeLock('k'); await tick();
  assert.equal(log.requests, 1);
  refreshWakeLock(); await tick();
  assert.equal(log.requests, 1, 'a live sentinel is not asked for twice');

  log.sentinels[0].listener();   // released by the browser, the page never hidden
  refreshWakeLock(); await tick();
  assert.equal(log.requests, 2, 'asked again after the release');

  globalThis.document.visibilityState = 'hidden';
  log.sentinels[1].listener();
  refreshWakeLock(); await tick();
  assert.equal(log.requests, 2, 'not while the page is hidden');
  globalThis.document.visibilityState = 'visible';

  log.fail = true;
  refreshWakeLock(); await tick();
  assert.equal(log.requests, 3, 'a request that is refused…');
  log.fail = false;
  refreshWakeLock(); await tick();
  assert.equal(log.requests, 4, '…is retried by the next refresh');
  releaseWakeLock('k');
});

test('refreshWakeLock does nothing without a document', async () => {
  install();
  const { refreshWakeLock } = await import('../js/wake-lock.js');
  const saved = globalThis.document;
  delete globalThis.document;
  try { assert.doesNotThrow(() => refreshWakeLock()); } finally { globalThis.document = saved; }
});

test('listens for the page coming back while held; never throws without the API', async () => {
  const { log, vis } = install();
  const { acquireWakeLock, releaseWakeLock } = await import('../js/wake-lock.js');
  acquireWakeLock('x'); await tick();
  assert.ok(vis.has('visibilitychange'));
  releaseWakeLock('x');
  assert.ok(!vis.has('visibilitychange'));
  setNavigator({});
  assert.doesNotThrow(() => { acquireWakeLock('y'); releaseWakeLock('y'); });
  assert.equal(log.requests, 1);
});
