// guard.js — one screen's bug must not break the data underneath it (safety net, step 0).
//
// The stores call the screen's refresh function from inside a live Firestore listener and,
// for a local-first save, BEFORE the network write. Until this existed a throw from that
// refresh escaped into the store. The language listeners swallowed their errors in silence,
// so js/error-report.js (which records console.error) never saw them.
//
// Executed here: guarded() itself and the language listeners. The stores and js/firebase.js
// load the Firebase SDK from a CDN and cannot run in node — tests/store-notify-guarded.test.mjs
// pins their wiring as source text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guarded } from '../js/guard.js';
import { onLanguageChange, setLanguage, currentLanguage, LANGUAGES } from '../js/i18n.js';

// Replaces console.error for one callback and always puts it back.
function captureConsoleError(run) {
  const original = console.error;
  const calls = [];
  console.error = (...args) => { calls.push(args); };
  try {
    run(calls);
  } finally {
    console.error = original;
  }
  return calls;
}

test('guarded: anything that is not a function gives null', () => {
  for (const value of [undefined, null, 0, 'refresh', {}, [], true]) {
    assert.equal(guarded('x', value), null, String(value));
  }
});

test('guarded: arguments, this and the return value pass straight through', () => {
  const seen = [];
  const target = { name: 'screen' };
  const wrapped = guarded('x', function (a, b) { seen.push([this, a, b]); return a + b; });
  assert.equal(typeof wrapped, 'function');
  assert.equal(wrapped.call(target, 2, 3), 5);
  assert.deepEqual(seen, [[target, 2, 3]]);
});

test('guarded: a throw is logged with the label and the error, answered with undefined, never rethrown', () => {
  const boom = new Error('screen bug');
  const wrapped = guarded('Catalogue: screen refresh', () => { throw boom; });
  let result = 'not run';
  const calls = captureConsoleError(() => {
    assert.doesNotThrow(() => { result = wrapped(); });
  });
  assert.equal(result, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'Catalogue: screen refresh failed:');
  assert.equal(calls[0][1], boom);
});

test('guarded: a call after a throw still works', () => {
  let n = 0;
  const wrapped = guarded('x', () => {
    n += 1;
    if (n === 1) throw new Error('first time only');
    return n;
  });
  const calls = captureConsoleError(() => {
    assert.equal(wrapped(), undefined);
  });
  assert.equal(calls.length, 1);
  assert.equal(wrapped(), 2);
  assert.equal(wrapped(), 3);
});

test('guarded: a successful call logs nothing', () => {
  const wrapped = guarded('x', () => 'fine');
  const calls = captureConsoleError(() => {
    assert.equal(wrapped(), 'fine');
  });
  assert.deepEqual(calls, []);
});

test('setLanguage: a listener that throws is reported and the next one still runs', () => {
  const start = currentLanguage();
  const other = LANGUAGES.find(l => l !== start);
  assert.ok(other, 'the test needs a second language to switch to');

  const boom = new Error('language listener bug');
  const ran = [];
  const offFirst = onLanguageChange(() => { throw boom; });
  const offSecond = onLanguageChange(lang => { ran.push(lang); });
  let calls;
  try {
    calls = captureConsoleError(() => { setLanguage(other); });
  } finally {
    offFirst();
    offSecond();
    setLanguage(start);
  }

  assert.deepEqual(ran, [other], 'the second listener must run although the first threw');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'Language listener failed:');
  assert.equal(calls[0][1], boom);
  assert.equal(currentLanguage(), start, 'the test puts the language back');
});

test('setLanguage: nothing is logged when no listener throws', () => {
  const start = currentLanguage();
  const other = LANGUAGES.find(l => l !== start);
  const off = onLanguageChange(() => {});
  let calls;
  try {
    calls = captureConsoleError(() => { setLanguage(other); });
  } finally {
    off();
    setLanguage(start);
  }
  assert.deepEqual(calls, []);
});
