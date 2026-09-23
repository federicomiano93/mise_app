// The session is answered from this phone first, and the server is asked behind it
// (speed audit, 23 Sep 2026).
//
// ⚠️ WHAT WAS SLOW: opening any page asked the SERVER, one question after another, who
// this is, whether they run the app and what the venue is — getDoc() waits for the
// server even when the offline cache holds the answer. Measured on the emulator with a
// mid-range phone simulated (CPU x4, 150 ms latency): Orders 2.4 s → 0.9 s, Stocktake
// 1.5 s → 0.7 s, Suppliers 1.6 s → 0.7 s, Calculator 1.6 s → 1.0 s.
//
// The comparison is tested by running it; the wiring in js/firebase.js by reading it
// (it imports the SDK from a URL the suite cannot load); the behaviour — no reload on
// an ordinary opening, exactly one when the server disagrees — was driven on the
// emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sameData } from '../js/same-data.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function between(src, startMarker, endMarker, file) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} not found in ${file}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `could not find the end of ${startMarker} in ${file}`);
  const body = codeOf(src.slice(start, end));
  assert.ok(body.length > 80, `${startMarker} read as ${body.length} characters — this test can no longer see it`);
  return body;
}

// ── The comparison that decides a reload ─────────────────────────────────────

test('the same document is the same, whatever order its keys arrived in', () => {
  assert.equal(sameData({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } },
                        { b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 }), true);
  assert.equal(sameData(null, null), true);
  assert.equal(sameData(undefined, null), true, 'a missing document and no data are the same answer');
});

test('a real change is a change', () => {
  assert.equal(sameData({ locations: { bakery: 'manager' } }, { locations: { bakery: true } }), false);
  assert.equal(sameData({ a: 1 }, { a: 1, b: 2 }), false, 'a field added on the server');
  assert.equal(sameData({ list: [1, 2] }, { list: [2, 1] }), false, 'a list keeps its order');
  assert.equal(sameData({ a: 1 }, null), false, 'the document was deleted');
});

// ── The wiring ───────────────────────────────────────────────────────────────

for (const file of ['js/firebase.js', 'js/firebase.example.js']) {
  const src = read(file);

  test(`${file}: the membership and admin reads run at once, from the phone first`, () => {
    const body = between(src, 'async function resolveMembership', '\n}\n', file);
    const adminAt = body.indexOf('readAppAdmin(user)');
    const userAt = body.indexOf('readPreferCache(userRef)');
    assert.ok(adminAt !== -1 && userAt !== -1, 'one of the two reads is missing');
    assert.ok(adminAt < userAt, 'the admin read must START before the membership read is awaited');
    assert.doesNotMatch(body, /await readAppAdmin\(user\)/, 'awaiting it on its own makes the two sequential again');
    assert.match(body, /checkBehind\(behind\)/, 'a cached answer must be checked against the server');
  });

  test(`${file}: the venue is read from the phone first and checked behind`, () => {
    const body = between(src, 'async function enterLocation', '\n}\n', file);
    assert.match(body, /readPreferCache\(locationRef\)/);
    assert.match(body, /if \(cached\) checkBehind\(\[\[locationRef, location\]\]\)/);
  });

  test(`${file}: a disagreement reloads, at most once every 30 seconds`, () => {
    const body = between(src, 'function checkBehind', '\n}\n', file);
    assert.match(body, /getDocFromServer\(ref\)/, 'the check must ask the SERVER, not the cache again');
    assert.match(body, /sameData\(/);
    assert.match(body, /Date\.now\(\) - last < REFRESH_BRAKE_MS/, 'without the brake a comparison mistake is an endless reload');
    assert.match(body, /location\.reload\(\)/);
    assert.match(body, /\.catch\(/, 'offline, the check must fail quietly and keep the cached answer');
  });
}

test('the comparison is precached, or an installed phone offline would boot nothing', () => {
  assert.match(read('sw.js'), /'\.\/js\/same-data\.js'/);
});
