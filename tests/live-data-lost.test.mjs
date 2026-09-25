// The Orders «lost the live connection for …» message names what was lost in the
// venue's language (P15).
//
// ⚠️ EACH NAME IS HANDED OVER AS A FUNCTION, asked only when a stream drops. init()
// subscribes at module load, before the venue's language is known, so a phrase fetched
// then was English on an Italian venue. And liveDataLost() CALLS what it is given: a
// plain string handed back in would throw inside Firestore's error handler, and the
// one message that tells somebody to reload would never appear — with no test red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/orders/orders-main.js', import.meta.url), 'utf8');

test('⚠️ every liveDataLost() call is handed a function that asks t()', () => {
  const calls = [...src.matchAll(/liveDataLost\(([^\n]*?)\)\)?;?\s*$/gm)]
    .map(m => m[1]).filter(arg => !arg.startsWith('what'));
  assert.ok(calls.length >= 5, `only ${calls.length} calls found — the scan is broken`);
  for (const arg of calls) {
    assert.match(arg, /^\(\) => t\('orders\.live\.[a-z]+'\)\)?$/, `not a thunk over t(): ${arg}`);
  }
});

test('liveDataLost asks its argument when the stream drops, not before', () => {
  assert.match(src, /function liveDataLost\(what\) \{\s*return \(\) => setStatus\(\s*t\('orders\.liveConnectionLost', \{ what: what\(\) \}\)/);
});
