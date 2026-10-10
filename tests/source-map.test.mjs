// scripts/source-map.mjs maps a frame in dist/<page>.js back to the js/ file it was built from.
// The decoder is hand-written (no library), so it is pinned against maps small enough to check
// by hand, and once against a real bundle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeVlq, decodeMappings, originalPosition, repoPath, mapStack, currentCacheVersion,
} from '../scripts/source-map.mjs';

const ROOT = new URL('..', import.meta.url);

test('base64 VLQ: zero, positives, negatives and a continued digit', () => {
  assert.deepEqual(decodeVlq('A'), [0]);
  assert.deepEqual(decodeVlq('C'), [1]);
  assert.deepEqual(decodeVlq('D'), [-1]);
  assert.deepEqual(decodeVlq('E'), [2]);
  assert.deepEqual(decodeVlq('gB'), [16], 'a digit with the continuation bit carries into the next');
  assert.deepEqual(decodeVlq('hB'), [-16]);
  assert.deepEqual(decodeVlq('AAgBC'), [0, 0, 16, 1], 'several values in one run');
  assert.throws(() => decodeVlq('A!'), /not a source-map character/);
});

// A map written out by hand:
//   generated line 1:  col 0 → a.js line 1 col 0 ;  col 10 → a.js line 1 col 6
//   generated line 2:  col 0 → b.js line 4 col 2 ;  col 5 → b.js line 4 col 1  (a negative delta)
//   (line 3 has nothing, and a column-only segment "F" is dropped)
const MAP = { version: 3, sources: ['../js/a.js', '../js/sub/b.js'], mappings: 'AAAA,UAAM;ACGJ,KAAD;;F' };

test('the mappings string becomes absolute positions, line by line', () => {
  const lines = decodeMappings(MAP.mappings);
  assert.deepEqual(lines[0], [
    { col: 0, source: 0, line: 0, column: 0 },
    { col: 10, source: 0, line: 0, column: 6 },
  ]);
  assert.deepEqual(lines[1], [
    { col: 0, source: 1, line: 3, column: 2 },
    { col: 5, source: 1, line: 3, column: 1 },
  ]);
  assert.deepEqual(lines[2], []);
  assert.equal(lines.length, 4);
});

test('a position is found by the nearest segment at or before its column', () => {
  assert.deepEqual(originalPosition(MAP, 1, 0), { source: '../js/a.js', line: 1, column: 0 });
  assert.deepEqual(originalPosition(MAP, 1, 9), { source: '../js/a.js', line: 1, column: 0 });
  assert.deepEqual(originalPosition(MAP, 1, 10), { source: '../js/a.js', line: 1, column: 6 });
  assert.deepEqual(originalPosition(MAP, 2, 400), { source: '../js/sub/b.js', line: 4, column: 1 });
  assert.equal(originalPosition(MAP, 3, 0), null, 'a line with no segment');
  assert.equal(originalPosition(MAP, 99, 0), null, 'a line past the end');
});

test('a source is relative to the map: ../js/x.js beside dist/ is js/x.js', () => {
  assert.equal(repoPath('dist/orders.js.map', '../js/orders/x.js'), 'js/orders/x.js');
});

const loadMap = file => (file === 'dist/orders.js.map' ? MAP : null);

test('a bundled frame gets a mapped line, the original stays, and an older release is flagged', () => {
  const stack = [
    'TypeError: x is undefined',
    '    at render (https://example.test/mise_app/dist/orders.js:2:7)',
    '    at https://example.test/mise_app/js/other.js:1:1',
  ].join('\n');

  const current = mapStack(stack, { loadMap, appVersion: '658', currentVersion: '658' }).split('\n');
  assert.deepEqual(current, [
    'TypeError: x is undefined',
    '    at render (https://example.test/mise_app/dist/orders.js:2:7)',
    '→ js/sub/b.js:4',
    '    at https://example.test/mise_app/js/other.js:1:1',
  ]);

  const older = mapStack(stack, { loadMap, appVersion: '650', currentVersion: '658' });
  assert.match(older, /→ js\/sub\/b\.js:4 \(mapped with the current build\)/);
  assert.match(older, /dist\/orders\.js:2:7\)/, 'the original frame is kept');
  // An unknown release is treated like an older one: never claim an exact match.
  assert.match(mapStack(stack, { loadMap, appVersion: null, currentVersion: '658' }), /mapped with the current build/);
});

test('a frame that cannot be mapped is left alone, and no stack stays no stack', () => {
  const frame = '    at f (https://example.test/mise_app/dist/missing.js:1:5)';
  assert.equal(mapStack(frame, { loadMap }), frame, 'no map for that bundle');
  const far = '    at f (https://example.test/mise_app/dist/orders.js:3:1)';
  assert.equal(mapStack(far, { loadMap }), far, 'a line the map has nothing for');
  assert.equal(mapStack(frame, { loadMap: () => { throw new Error('disk'); } }), frame);
  assert.equal(mapStack(null, { loadMap }), null);
  assert.equal(mapStack('', { loadMap }), '');
});

test('the current release is read from the cache name in sw.js', () => {
  assert.equal(currentCacheVersion("const CACHE_NAME = 'theitalianclub-v658';"), '658');
  assert.equal(currentCacheVersion('nothing here'), null);
  assert.match(currentCacheVersion(readFileSync(new URL('sw.js', ROOT), 'utf8')), /^\d+$/);
});

// ⚠️ The instrument, once, against the real build: find a function by name in the bundle, look
// its position up in the real map, and require the answer to be the file that defines it.
test('a position inside the real dist/index.js maps back to the real source', () => {
  const bundle = readFileSync(new URL('dist/index.js', ROOT), 'utf8');
  const map = JSON.parse(readFileSync(new URL('dist/index.js.map', ROOT), 'utf8'));
  assert.ok(map.sources.every(s => s.startsWith('../js/')), 'every source points into js/');
  assert.equal(map.sourcesContent, undefined, 'the sources are not duplicated into the map');

  const at = bundle.indexOf('function runInOrder(');
  assert.ok(at > 0, 'runInOrder keeps its name in the bundle (identifiers are not minified)');
  const before = bundle.slice(0, at).split('\n');
  const line = before.length;
  const column = before[before.length - 1].length;

  const place = originalPosition(map, line, column);
  assert.ok(place, 'the map has a place for it');
  assert.equal(repoPath('dist/index.js.map', place.source), 'js/pages/run-in-order.js');
  const source = readFileSync(new URL('js/pages/run-in-order.js', ROOT), 'utf8').split(/\r?\n/);
  assert.match(source[place.line - 1], /runInOrder/);
});
