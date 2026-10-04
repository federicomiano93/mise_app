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
