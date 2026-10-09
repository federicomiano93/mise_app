// openFeedback's flows, run without a browser: its collaborators are injected and the few
// DOM calls it makes go to a minimal fake document.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openFeedback } from '../js/feedback.js';
import { t } from '../js/i18n.js';

class FakeEl {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this.value = ''; this.className = '';
    this.textContent = ''; this.id = '';
    this.classList = { add: (c) => { this.className += ' ' + c; } };
  }
  append(...n) { this.children.push(...n); }
  appendChild(n) { this.children.push(n); return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  focus() { globalThis.document.activeElement = this; }
  find(tag) {
    for (const c of this.children) {
      if (c.tag === tag) return c;
      const deeper = c.find && c.find(tag);
      if (deeper) return deeper;
    }
    return null;
  }
}
globalThis.document = { activeElement: null, createElement: (tag) => new FakeEl(tag) };

// Scripted dialogs. Each confirmDialog step is (opts, snapshot) => boolean, where snapshot
// describes the form as it was opened and may type into the textarea before answering.
function harness({ confirms, send, waitMs = 20 }) {
  const log = { confirms: [], alerts: [], sends: [] };
  const queue = [...confirms];
  const deps = {
    waitMs,
    runningVersion: async () => '643',
    confirmDialog: async (opts) => {
      const area = opts.node ? opts.node.find('textarea') : null;
      const snap = {
        opts,
        area,
        valueAtOpen: area ? area.value : null,
        invalid: area ? area.getAttribute('aria-invalid') === 'true' : null,
        errorShown: opts.node ? !!opts.node.find('p') : null,
        focused: area ? globalThis.document.activeElement === area : null,
      };
      log.confirms.push(snap);
      // focus is moved by the caller right after confirmDialog() returns its promise
      await Promise.resolve();
      snap.focused = area ? globalThis.document.activeElement === area : null;
      const step = queue.shift();
      assert.ok(step, 'unexpected extra dialog: ' + (opts.message || ''));
      return step(opts, snap);
    },
    alertDialog: async (message) => { log.alerts.push(message); },
    sendFeedback: async (payload) => { log.sends.push(payload); return send ? send(payload) : undefined; },
  };
  return { deps, log, queue };
}

const type = (text) => (opts, snap) => { snap.area.value = text; return true; };
const cancelWith = (text) => (opts, snap) => { snap.area.value = text; return false; };

test('a blank send reopens the form with the error, nothing is sent', async () => {
  const h = harness({ confirms: [(o, s) => { s.area.value = '   '; return true; }, cancelWith('')] });
  await openFeedback('home', '', h.deps);
  assert.equal(h.log.sends.length, 0);
  assert.equal(h.log.confirms.length, 2);
  assert.equal(h.log.confirms[0].errorShown, false);
  assert.equal(h.log.confirms[1].errorShown, true);
  assert.equal(h.log.confirms[1].invalid, true);
  assert.equal(h.log.confirms[1].valueAtOpen, '   ');
  assert.equal(h.log.confirms[1].focused, true, 'focus goes to the textarea');
});

test('Cancel with text asks to discard; «keep writing» reopens with the text', async () => {
  const h = harness({ confirms: [cancelWith('hello'), () => false, cancelWith('hello'), () => true] });
  await openFeedback('home', '', h.deps);
  const [, discard, reopened, discard2] = h.log.confirms;
  assert.equal(discard.opts.message, t('feedback.discard.message'));
  assert.equal(discard.opts.danger, true);
  assert.equal(reopened.valueAtOpen, 'hello');
  assert.equal(discard2.opts.message, t('feedback.discard.message'));
  assert.equal(h.log.sends.length, 0);
});

test('Cancel with text and «discard» closes without sending', async () => {
  const h = harness({ confirms: [cancelWith('hello'), () => true] });
  await openFeedback('home', '', h.deps);
  assert.equal(h.log.confirms.length, 2);
  assert.equal(h.log.sends.length, 0);
  assert.equal(h.log.alerts.length, 0);
});

test('Cancel with blank text just closes', async () => {
  const h = harness({ confirms: [cancelWith('  ')] });
  await openFeedback('home', '', h.deps);
  assert.equal(h.log.confirms.length, 1);
});

test('an acked send says «sent» and calls sendFeedback with the payload', async () => {
  const h = harness({ confirms: [type('  a problem  ')] });
  await openFeedback('orders', '', h.deps);
  assert.deepEqual(h.log.sends, [{ text: 'a problem', screen: 'orders', appVersion: '643' }]);
  assert.deepEqual(h.log.alerts, [t('feedback.sent')]);
});

test('a send still pending after the wait says «queued»', async () => {
  const h = harness({ confirms: [type('offline note')], send: () => new Promise(() => {}), waitMs: 10 });
  await openFeedback('home', '', h.deps);
  assert.equal(h.log.sends.length, 1);
  assert.deepEqual(h.log.alerts, [t('feedback.queued')]);
});

test('a rejected send says «failed», logs only the code, and reopens with the text kept', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const h = harness({
      confirms: [type('secret words'), cancelWith('secret words'), () => true],
      send: () => Promise.reject(Object.assign(new Error('secret words'), { code: 'permission-denied' })),
    });
    await openFeedback('home', '', h.deps);
    assert.deepEqual(h.log.alerts, [t('feedback.failed')]);
    assert.equal(h.log.confirms[1].valueAtOpen, 'secret words');
    assert.equal(errors.length, 1);
    assert.equal(JSON.stringify(errors).includes('secret words'), false);
    assert.equal(errors[0][1], 'permission-denied');
  } finally {
    console.error = original;
  }
});

test('the dialog is the app\'s own, with «Send» as OK and the field pre-filled from the draft', async () => {
  const h = harness({ confirms: [cancelWith('')] });
  await openFeedback('home', 'draft text', h.deps);
  const first = h.log.confirms[0];
  assert.equal(first.opts.okLabel, t('feedback.send'));
  assert.equal(first.opts.cancelLabel, t('ui.cancel'));
  assert.equal(first.valueAtOpen, 'draft text');
});
