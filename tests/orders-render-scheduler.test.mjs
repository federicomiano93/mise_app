// Orders draws what its live listeners change ONCE per frame (render-scheduler.js), draws a
// hidden History / Incoming body only when it opens, and keeps every keystroke synchronous.
// The scheduler is pure and tested directly; the wiring in orders-main.js is pinned by source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRenderScheduler } from '../js/orders/render-scheduler.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = src => src.replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '');
const main = strip(readFileSync(join(ROOT, 'js/orders/orders-main.js'), 'utf8'));

// A frame queue the test advances by hand.
function harness() {
  const frames = [];
  const flushed = [];
  const scheduler = createRenderScheduler({
    flush: parts => flushed.push([...parts].sort()),
    raf: cb => frames.push(cb),
  });
  const frame = () => { const cbs = frames.splice(0); cbs.forEach(cb => cb()); };
  return { scheduler, flushed, frames, frame };
}

test('a burst of schedules is drawn once, with the union of the parts', () => {
  const h = harness();
  h.scheduler.schedule('list', 'history');
  h.scheduler.schedule('incoming');
  h.scheduler.schedule('list');
  assert.equal(h.frames.length, 1, 'one frame requested for the whole burst');
  assert.equal(h.flushed.length, 0, 'nothing is drawn before the frame');
  h.frame();
  assert.deepEqual(h.flushed, [['history', 'incoming', 'list']]);
  h.frame();
  assert.equal(h.flushed.length, 1, 'and nothing again');
});

test('parts asked for while drawing get their own frame', () => {
  const frames = [];
  const seen = [];
  const scheduler = createRenderScheduler({
    flush: parts => { seen.push([...parts]); if (parts.has('a')) scheduler.schedule('b'); },
    raf: cb => frames.push(cb),
  });
  scheduler.schedule('a');
  frames.splice(0).forEach(cb => cb());
  assert.equal(frames.length, 1);
  frames.splice(0).forEach(cb => cb());
  assert.deepEqual(seen, [['a'], ['b']]);
});

test('while paused nothing is drawn and everything is kept; un-pausing draws once', () => {
  const h = harness();
  h.scheduler.setPaused(true);
  h.scheduler.schedule('list');
  h.scheduler.schedule('history');
  assert.equal(h.frames.length, 0, 'no frame is even requested while paused');
  h.frame();
  assert.equal(h.flushed.length, 0);
  assert.deepEqual([...h.scheduler.pending()].sort(), ['history', 'list']);
  h.scheduler.setPaused(false);
  h.frame();
  assert.deepEqual(h.flushed, [['history', 'list']]);
  assert.equal(h.scheduler.pending().size, 0);
});

test('pausing after a frame was requested keeps the parts for the un-pause', () => {
  const h = harness();
  h.scheduler.schedule('list');
  h.scheduler.setPaused(true);
  h.frame();                       // the frame fires while paused: it must not draw
  assert.equal(h.flushed.length, 0);
  h.scheduler.setPaused(false);
  h.frame();
  assert.deepEqual(h.flushed, [['list']]);
});

test('un-pausing with nothing waiting draws nothing', () => {
  const h = harness();
  h.scheduler.setPaused(true);
  h.scheduler.setPaused(false);
  assert.equal(h.frames.length, 0);
});

test('orders-main exposes setRenderPaused through the scheduler and nothing imports it yet', () => {
  assert.match(main, /export function setRenderPaused\(paused\) \{\s*scheduler\.setPaused\(paused\);/);
  assert.match(main, /createRenderScheduler\(\{\s*flush: flushRender,\s*raf: callback => requestAnimationFrame\(callback\)/);
});

// Each listener stores its data itself and records what to draw.
function handlerBody(opening) {
  const start = main.indexOf(opening);
  assert.ok(start >= 0, opening);
  return main.slice(start, main.indexOf('liveDataLost(', start));
}

test('every snapshot handler schedules its drawing instead of drawing', () => {
  const direct = /\b(render|renderHistory|renderIncoming|renderReminders|renderSummary|renderOpenRequest|renderUntoldChanges|showAlerts|syncInputsFromState|paintMoney|renderRequestList)\(\)/;
  for (const opening of [
    'watchDraft(draft =>',
    'watchRecentHistory(state.historyFrom, list =>',
    'watchOrderRequests(list =>',
    'watchCollection(COLLECTIONS.suppliers, list =>',
    'watchIngredientPrices((map, readable) =>',
    'watchCollection(COLLECTIONS.ingredients, list =>',
  ]) {
    // showAlerts() stays direct in the suppliers handler on purpose: it also raises the browser
    // notification, which must fire while the page is hidden (no animation frames then).
    const body = handlerBody(opening).replace(/\bshowAlerts\(\);/, '');
    assert.match(body, /scheduleRender\(/, `${opening} schedules`);
    assert.doesNotMatch(body, direct, `${opening} draws nothing directly`);
  }
  const configAt = main.indexOf('function watchOrdersConfig()');
  const config = main.slice(configAt, main.indexOf('\n}\n', configAt));
  assert.match(config, /scheduleRender\('list'\)/);
  assert.match(config, /scheduleRender\('history'\)/);
  assert.doesNotMatch(config, /\b(render|renderHistory)\(\)/);
});

test('the draft handler still stores state at once and keeps the old drawing order', () => {
  const body = handlerBody('watchDraft(draft =>');
  assert.match(body, /setEntries\(draft\.entries\);\s*state\.days = draft\.days \|\| \{\};/);
  assert.match(body, /state\.loaded\.draft = true;/);
  assert.match(body, /scheduleRender\('list'\)/);
  assert.match(body, /scheduleRender\('sync', 'reminders'\)/);
  assert.match(body, /checkPendingOnce\(\);/);
  assert.match(body, /scheduleRender\('summary'\)/);
  assert.match(body, /scheduleRender\('openRequest'\)/);
});

test('a keystroke and the user actions stay synchronous: afterChange never schedules', () => {
  const start = main.indexOf('afterChange(supplierId');
  const hook = main.slice(start, main.indexOf('onPlaced(supplierId)', start));
  assert.doesNotMatch(hook, /scheduleRender/);
  assert.match(hook, /refreshSupplierDerived\(/);
  assert.match(hook, /refreshOrderTotals\(\);\s*paintMoney\(\);/);
  for (const fn of ['function openSupplier(', 'function setView(', 'async function placeOrder(', 'function expandSupplier(']) {
    const at = main.indexOf(fn);
    const body = main.slice(at, main.indexOf('\n}\n', at));
    assert.doesNotMatch(body, /scheduleRender/, fn);
  }
});

test('applyHistory stores the list and no longer draws Incoming itself', () => {
  const at = main.indexOf('function applyHistory(list)');
  const body = main.slice(at, main.indexOf('\n}\n', at));
  assert.match(body, /state\.history = list;/);
  assert.doesNotMatch(body, /renderIncoming\(\)/);
  assert.doesNotMatch(body, /\brender\(\)/);
  assert.match(body, /scheduleRender\('history', 'incoming', 'list'\)/);
});

test('the flush draws Incoming once: render() already did when it got that far', () => {
  const at = main.indexOf('function flushRender(parts)');
  const body = main.slice(at, main.indexOf('\n}\n', at));
  assert.match(body, /if \(parts\.has\('list'\)\) drawPart\('list', render\);/);
  assert.match(body, /parts\.has\('incoming'\) && !incomingDrawn/);
  assert.match(body, /if \(parts\.has\('sync'\)\) drawPart\('sync', syncInputsFromState\);\s*else if \(parts\.has\('money'\)\) drawPart\('money', paintMoney\);/);
  assert.match(main, /function renderIncoming\(\) \{\s*incomingDrawCount \+= 1;/);
});

test('History is only marked out of date while closed, and drawn when it opens', () => {
  const at = main.indexOf('function renderHistory()');
  const body = main.slice(at, main.indexOf('\n}\n', at));
  assert.match(body, /^function renderHistory\(\) \{\s*if \(!historyVisible\(\)\) \{ historyDirty = true; return; \}\s*historyDirty = false;/);
  assert.match(main, /function historyVisible\(\) \{[^}]*!overlay\.hidden/);
  const open = main.slice(main.indexOf('function openHistory()'), main.indexOf('function renderHistory()'));
  assert.match(open, /overlay\.hidden = false;\s*if \(historyDirty\) renderHistory\(\);/);
  assert.match(main, /openHistory: \(\) => \{\s*closeAlertsPanel\(\);[^}]*openHistory\(\);/);
});

test('the Incoming list body waits for its tab, the banners and the badge do not', () => {
  const at = main.indexOf('function renderIncoming()');
  const body = main.slice(at, main.indexOf('\nfunction incomingContext()', at));
  assert.match(body, /if \(deliveriesVisible\(\)\) drawDeliveries\(ctx\);\s*else deliveriesDirty = true;/);
  assert.match(body, /renderOwedBanner\(/);
  assert.match(body, /renderReorderButton\(/);
  assert.match(body, /refreshDeliveriesBadge\(owedCount\)/);
  assert.doesNotMatch(body, /renderDeliveries\(/);
  assert.match(main, /if \(panel === 'tab-deliveries' && deliveriesDirty\) drawDeliveries\(\);/);
  assert.match(main, /function deliveriesVisible\(\) \{\s*return document\.getElementById\('tab-deliveries'\)\?\.classList\.contains\('active'\) === true;/);
});

test('checkPendingOnce stores state.pending and schedules the banner instead of drawing it', () => {
  const at = main.indexOf('function checkPendingOnce()');
  const body = main.slice(at, main.indexOf('\n}\n', at));
  assert.match(body, /state\.pending = pendingSuppliers\(/);
  assert.match(body, /scheduleRender\('reminders'\)/);
  assert.doesNotMatch(body, /renderReminders\(\)/);
});

// Review of 4 Oct 2026: one part that throws must not stop the others, nor the scheduler.
test('a flush that throws does not leave the scheduler stuck', () => {
  const frames = [];
  let calls = 0;
  const scheduler = createRenderScheduler({
    flush: () => { calls += 1; if (calls === 1) throw new Error('boom'); },
    raf: cb => frames.push(cb),
  });
  scheduler.schedule('list');
  assert.throws(() => frames.splice(0).forEach(cb => cb()));
  scheduler.schedule('history');
  frames.splice(0).forEach(cb => cb());
  assert.equal(calls, 2, 'the next schedule is drawn');
});

test('every part of the flush is drawn on its own, so one failure leaves the others', () => {
  const flush = main.slice(main.indexOf('function flushRender('), main.indexOf('function dropListViews('));
  for (const name of ['list', 'sync', 'money', 'history', 'incoming', 'reminders', 'untold', 'summary', 'requestList', 'openRequest']) {
    assert.match(flush, new RegExp(`drawPart\\('${name}', `), name);
  }
  assert.match(main, /function drawPart\(name, draw\) \{\n\s*try \{ draw\(\); \} catch \(err\) \{ console\.error\(/);
});

test('holiday and delivery-clash alerts are raised at once, not on the next frame', () => {
  assert.doesNotMatch(main, /'alerts'/, 'alerts are no longer a deferred part');
  const supp = main.slice(main.indexOf("state.loaded.suppliers = true;"), main.indexOf("checkPendingOnce();", main.indexOf("state.loaded.suppliers = true;")));
  assert.match(supp, /showAlerts\(\);/);
});
