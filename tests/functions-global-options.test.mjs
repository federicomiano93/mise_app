// The ceiling on how many copies of a function Google may start at once.
//
// ⚠️ firebase-functions reads the global options when each function is DEFINED.
// functions/global-options.js sets them, so it must run before any module that
// defines a function — i.e. it must be the FIRST import of functions/index.js.
// Moved one line down, every function defined above it would deploy with Google's
// default of 100 copies and nothing anywhere would say so.
//
// ⚠️ Read as text, not imported: firebase-functions is installed in CI only for the
// deploy job, so a test that imported it would fail there and pass here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (n) => readFileSync(new URL(n, new URL('../', import.meta.url)), 'utf8');
// Comments describe the trap in the same words the code uses: read the CODE only.
const codeOf = (name) => read(name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('global-options.js is the first import of functions/index.js', () => {
  const first = codeOf('functions/index.js').match(/^\s*(import|export)\b[^;]*;/m);
  assert.ok(first, 'functions/index.js has no import at all');
  assert.match(first[0], /^\s*import\s+['"]\.\/global-options\.js['"];$/,
    `the first import must be './global-options.js', found: ${first[0].trim()}`);
});

test('the ceiling is set once, with a number', () => {
  const code = codeOf('functions/global-options.js');
  assert.match(code, /export const MAX_INSTANCES = (\d+);/);
  const n = Number(code.match(/export const MAX_INSTANCES = (\d+);/)[1]);
  assert.ok(n >= 1 && n <= 20, `MAX_INSTANCES ${n} is outside 1..20`);
  assert.match(code, /setGlobalOptions\(\{\s*maxInstances:\s*MAX_INSTANCES\s*\}\);/);
});

test('no other functions file calls setGlobalOptions', () => {
  // A second call is «undefined behaviour» in firebase-functions' own words.
  const others = readdirSync(new URL('../functions/', import.meta.url))
    .filter((f) => f.endsWith('.js') && f !== 'global-options.js')
    .filter((f) => /setGlobalOptions\s*\(/.test(codeOf(`functions/${f}`)));
  assert.deepEqual(others, []);
});
