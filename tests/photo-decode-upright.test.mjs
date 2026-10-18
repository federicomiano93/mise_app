// Decoding a photo the right way up, on every browser the venues actually use.
//
// ⚠️ FOUND ON THE REAL LAB TABLET (SM-T550, Chrome 101 — the newest it can get), 18 Oct
// 2026: Chrome 101 refuses `imageOrientation: 'from-image'` with a TypeError, and every
// photo taken with the tablet's camera was reported as «an unreadable format». Only a
// TypeError — the OPTIONS refused — may retry without them (Chrome 101's default already
// honours the EXIF rotation, measured there). A photo that cannot be decoded at all
// fails with a DOMException and must still fail at once, as «undecodable».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeUpright } from '../js/photo-model.js';
import { decodeUpright as catalogueDecode } from '../js/catalogue/photo-model.js';

const read = (n) => readFileSync(new URL(n, new URL('../', import.meta.url)), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// A stand-in for createImageBitmap that records every call and answers from a script.
function fakeCreate(...answers) {
  const calls = [];
  const create = async (...args) => {
    calls.push(args);
    const answer = answers[calls.length - 1];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { create, calls };
}

const FILE = { name: 'photo.jpg' };
const BITMAP = { width: 30, height: 40 };

test('a modern browser decodes once, with the EXIF option', async () => {
  const { create, calls } = fakeCreate(BITMAP);
  assert.equal(await decodeUpright(FILE, create), BITMAP);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [FILE, { imageOrientation: 'from-image' }]);
});

test('⚠️ Chrome 101: the option refused with a TypeError retries ONCE without options', async () => {
  const { create, calls } = fakeCreate(
    new TypeError("The provided value 'from-image' is not a valid enum value"), BITMAP);
  assert.equal(await decodeUpright(FILE, create), BITMAP);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], [FILE], 'the retry passes no options at all');
});

test('⚠️ a photo that cannot be decoded (DOMException) is NOT retried', async () => {
  const broken = new DOMException('The source image could not be decoded.', 'InvalidStateError');
  const { create, calls } = fakeCreate(broken, BITMAP);
  await assert.rejects(decodeUpright(FILE, create), (e) => e === broken);
  assert.equal(calls.length, 1, 'a second try would only hide a HEIC photo behind a slower failure');
});

test('a retry that also fails rejects, and is not tried a third time', async () => {
  const { create, calls } = fakeCreate(new TypeError('bad enum'), new DOMException('no', 'InvalidStateError'));
  await assert.rejects(decodeUpright(FILE, create), DOMException);
  assert.equal(calls.length, 2);
});

test('⚠️ with no stand-in it calls the real global createImageBitmap', async () => {
  // Every other test passes `create`; a typo in the default would make every photo on
  // every device «unreadable» with the whole suite green.
  const saved = globalThis.createImageBitmap;
  const { create, calls } = fakeCreate(BITMAP);
  globalThis.createImageBitmap = create;
  try {
    assert.equal(await decodeUpright(FILE), BITMAP);
    assert.equal(calls.length, 1);
  } finally {
    if (saved === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = saved;
  }
});

test('the Catalogue reaches the same function through its own model', () => {
  assert.equal(catalogueDecode, decodeUpright);
});

test('⚠️ both photo screens decode through decodeUpright, and neither calls the browser directly', () => {
  for (const name of ['js/catalogue/photo-capture.js', 'js/orders/photo-capture.js']) {
    const code = codeOf(read(name));
    assert.match(code, /bitmap = await decodeUpright\(file\)/, name);
    assert.ok(!code.includes('createImageBitmap('),
      `${name}: a direct call skips the Chrome 101 retry and the tablet reads no photo`);
    assert.match(code, /throw new Error\('undecodable'\)/, `${name}: an undecodable photo still says so`);
  }
});
