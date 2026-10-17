// Unit tests for the phone's half of reading something from a photograph (P15 — the owner cannot read code, so these
// tests are the safety net), run against BOTH implementations: the TypeScript port in shared/ and js/photo-model.js,
// which the live app uses today. Ported from tests/photo-image-model.test.mjs (the size and guard half; the dictionary
// half is catalogue-photo-model.spec.ts and the app's photoKeys.spec.ts). The module is a FULL port, so parity.spec.ts
// also compares its exports name by name.

import { describe, expect, test } from 'vitest';
import * as ported from './photo-model';
import * as legacyJs from '../../js/photo-model.js';
import * as server from '../../functions/recipe-photo-model.js';

const legacy = legacyJs as unknown as typeof ported;

const img = (bytes: number) => ({ mediaType: 'image/jpeg', data: 'A'.repeat(Math.ceil(bytes * 4 / 3)) });

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── the size the photo is drawn at ──
  test('a big photo is brought down to the long edge, aspect kept', () => {
    expect(m.fitWithin(4032, 3024)).toStrictEqual({ w: 1568, h: 1176 });
    expect(m.fitWithin(3024, 4032)).toStrictEqual({ w: 1176, h: 1568 });
    expect(m.fitWithin(4000, 4000)).toStrictEqual({ w: 1568, h: 1568 });
  });

  test('a small photo is never UPSCALED', () => {
    // Blowing up a small picture adds bytes and pixels and not one legible letter, and the reader charges by the pixel.
    expect(m.fitWithin(800, 600)).toStrictEqual({ w: 800, h: 600 });
    expect(m.fitWithin(1568, 20)).toStrictEqual({ w: 1568, h: 20 });
  });

  test('nonsense dimensions give nothing rather than NaN', () => {
    for (const [w, h] of [[0, 100], [100, 0], [-5, 5], [Number.NaN, 100], [undefined, 1], ['x', 'y']] as const) {
      expect(m.fitWithin(w, h), `${String(w)}x${String(h)}`).toStrictEqual({ w: 0, h: 0 });
    }
  });

  test('the result is always whole pixels and at least one', () => {
    const { w, h } = m.fitWithin(10000, 3);
    expect(w).toBe(m.MAX_EDGE);
    expect(h, 'a canvas of height 0 draws nothing at all').toBe(1);
    expect(Number.isInteger(w) && Number.isInteger(h)).toBe(true);
  });

  test('a different long edge is honoured', () => {
    expect(m.fitWithin(2000, 1000, 1000)).toStrictEqual({ w: 1000, h: 500 });
  });

  // ── the data URL ──
  test('the payload is taken out of the data URL, and only from a real one', () => {
    expect(m.base64Of('data:image/jpeg;base64,QUFB')).toBe('QUFB');
    expect(m.mediaTypeOf('data:image/jpeg;base64,QUFB')).toBe('image/jpeg');
    expect(m.mediaTypeOf('data:image/png;base64,QUFB')).toBe('image/png');
  });

  test('anything that is not an image data URL yields nothing', () => {
    // Sending the whole `data:…` string as if it were base64 is refused by the server with a message about the photo,
    // and nobody would ever work out why.
    for (const bad of ['', null, 42, 'QUFB', 'data:text/plain;base64,QUFB', 'https://x/y.jpg', 'data:image/jpeg,QUFB']) {
      expect(m.base64Of(bad), JSON.stringify(bad)).toBe('');
    }
    for (const bad of ['', null, 42, 'QUFB', 'data:', 'data:image/jpeg']) {
      expect(m.mediaTypeOf(bad), JSON.stringify(bad)).toBe('');
    }
  });

  test('approxBytes never wildly over-states', () => {
    expect(m.approxBytes('AAAA')).toBe(3);
    expect(m.approxBytes('')).toBe(0);
    expect(m.approxBytes(undefined)).toBe(0);
    expect(m.approxBytes(12)).toBe(0);
  });

  // ── the guard, run before anything is uploaded ──
  test('a good set has no problem', () => {
    expect(m.payloadProblem([img(1000), img(1000)])).toBeNull();
  });

  test('every refusal is named', () => {
    expect(m.payloadProblem([])).toBe('no-images');
    expect(m.payloadProblem(null)).toBe('no-images');
    expect(m.payloadProblem(Array.from({ length: m.MAX_PHOTOS + 1 }, () => img(10)))).toBe('too-many-images');
    expect(m.payloadProblem([img(m.MAX_IMAGE_BYTES + 5000)])).toBe('image-too-large');
    expect(m.payloadProblem([{ data: '' }])).toBe('bad-image');
    expect(m.payloadProblem([null])).toBe('bad-image');
    expect(m.payloadProblem(Array.from({ length: 5 }, () => img(Math.floor(m.MAX_TOTAL_BYTES / 4))))).toBe('images-too-large');
  });

  test('the long edge stays at 1568 and the qualities and caps keep their numbers', () => {
    // Larger is downsampled by the reader anyway — pure cost. Smaller loses handwriting, which is most of what this is for.
    expect(m.MAX_EDGE).toBe(1568);
    expect(m.JPEG_QUALITY).toBe(0.82);
    expect(m.FALLBACK_QUALITY).toBe(0.7);
    expect(m.MAX_PHOTOS).toBe(5);
  });

  test('the phone’s guard agrees with the server’s', () => {
    // The server's is the one that is enforced; this one only saves a slow upload. If they disagreed, somebody would be
    // refused by whichever is stricter with a message written for the other.
    expect(m.MAX_PHOTOS).toBe(server.MAX_IMAGES);
    expect(m.MAX_IMAGE_BYTES).toBe(server.MAX_IMAGE_BYTES);
    expect(m.MAX_TOTAL_BYTES).toBe(server.MAX_TOTAL_BYTES);
  });

  // ── what the screen says ──
  const TABLE = {
    'signed-out': 'S', 'not-allowed': 'N', 'person-limit': 'P', 'venue-limit': 'V', offline: 'O', 'too-slow': 'T',
    'read-failed': 'F', 'nothing-readable': 'R', refused: 'X',
  };

  test('errorKey: the details key wins over the code', () => {
    // The server sends both. The key is specific («your daily allowance»), the code is a family («resource-exhausted»).
    expect(m.errorKey({ code: 'functions/resource-exhausted', details: { key: 'venue-limit' } }, TABLE)).toBe('V');
  });

  test('errorKey: a bare Firebase code still lands somewhere sensible', () => {
    expect(m.errorKey({ code: 'functions/unauthenticated' }, TABLE)).toBe('S');
    expect(m.errorKey({ code: 'functions/permission-denied' }, TABLE)).toBe('N');
    expect(m.errorKey({ code: 'functions/resource-exhausted' }, TABLE)).toBe('P');
    expect(m.errorKey({ code: 'functions/unavailable' }, TABLE)).toBe('O');
    expect(m.errorKey({ code: 'unavailable' }, TABLE)).toBe('O');
    expect(m.errorKey({ code: 'functions/deadline-exceeded' }, TABLE)).toBe('T');
  });

  test('errorKey: an unknown failure is the general one, never blank', () => {
    for (const err of [null, undefined, {}, new Error('boom'), { code: 'functions/weird' }, { details: { key: 'nonsense' } }, 'text']) {
      expect(m.errorKey(err, TABLE), JSON.stringify(err)).toBe('F');
    }
  });

  test('answerKey: a reason the table knows, else «nothing readable»', () => {
    expect(m.answerKey('refused', TABLE)).toBe('X');
    expect(m.answerKey('nothing-readable', TABLE)).toBe('R');
    expect(m.answerKey('who-knows', TABLE)).toBe('R');
    expect(m.answerKey(undefined, TABLE)).toBe('R');
  });

  test('no phrase is resolved here: the functions return what the table holds', () => {
    expect(m.errorKey({ details: { key: 'offline' } }, { offline: 'cat.x', 'read-failed': 'cat.y' })).toBe('cat.x');
  });
});

describe('shared/ photo-model: the functions and constants it has', () => {
  test('exports the same names as the current app', () => {
    expect(Object.keys(ported).sort()).toStrictEqual(Object.keys(legacy).sort());
  });
});
