// The Catalogue's table of what to say when reading a recipe from a photograph does not work (P15), run against BOTH
// files: catalogue-photo-model.ts and js/catalogue/photo-model.js. Ported from the sentence-choosing half of
// tests/photo-image-model.test.mjs. The walk that every key exists in BOTH dictionaries (en.ts / it.ts) is the app's
// (app/src/recipes/photoKeys.spec.ts): the dictionaries belong to the app.
//
// ⚠️ THE SENTENCE-CHOOSING IS THE PART THAT MATTERS MOST, and it looks least like it needs a test. This project has
// already shipped a screen that told somebody with full signal to check their connection — which sends them to fix the
// one thing that is working. Exactly one answer may mention the connection (the app's spec checks the words).

import { describe, expect, test } from 'vitest';
import * as ported from './catalogue-photo-model';
import * as legacyJs from '../../js/catalogue/photo-model.js';

const legacy = legacyJs as unknown as typeof ported;

const CODES = [
  'signed-out', 'no-location', 'no-images', 'too-many-images', 'image-too-large', 'images-too-large', 'bad-image',
  'not-allowed', 'person-limit', 'venue-limit', 'photo-off', 'read-failed', 'too-slow', 'nothing-readable', 'refused',
  'truncated', 'no-tool', 'undecodable', 'offline',
];

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('a bare Firebase code still lands somewhere sensible', () => {
    expect(m.photoErrorKey({ code: 'functions/unauthenticated' })).toBe('cat.photo.err.signedOut');
    expect(m.photoErrorKey({ code: 'functions/permission-denied' })).toBe('cat.photo.err.notAllowed');
    expect(m.photoErrorKey({ code: 'functions/resource-exhausted' })).toBe('cat.photo.err.personLimit');
    expect(m.photoErrorKey({ code: 'functions/unavailable' })).toBe('cat.photo.err.offline');
    expect(m.photoErrorKey({ code: 'functions/deadline-exceeded' })).toBe('cat.photo.err.tooSlow');
  });

  test('an unknown failure never leaves the screen blank', () => {
    for (const err of [null, undefined, {}, new Error('boom'), { code: 'functions/weird' }]) {
      expect(m.photoErrorKey(err), JSON.stringify(err)).toBe('cat.photo.err.failed');
    }
  });

  test('the details key wins over the code', () => {
    const err = { code: 'functions/resource-exhausted', details: { key: 'venue-limit' } };
    expect(m.photoErrorKey(err)).toBe('cat.photo.err.venueLimit');
  });

  test('a read that worked but found nothing has its own sentences, and an unknown reason falls back to «nothing found»', () => {
    expect(m.noRecipeKey('nothing-readable')).toBe('cat.photo.err.nothingFound');
    expect(m.noRecipeKey('no-tool')).toBe('cat.photo.err.nothingFound');
    expect(m.noRecipeKey('refused')).toBe('cat.photo.err.refused');
    expect(m.noRecipeKey('truncated')).toBe('cat.photo.err.tooLong');
    expect(m.noRecipeKey('who-knows')).toBe('cat.photo.err.nothingFound');
    expect(m.noRecipeKey(undefined)).toBe('cat.photo.err.nothingFound');
  });

  test('every one of the 19 codes gives a cat.photo.err.* key, 16 sentences between them', () => {
    const keys = CODES.map(code => m.photoErrorKey({ details: { key: code } }));
    for (const key of keys) expect(key).toMatch(/^cat\.photo\.err\.[a-zA-Z]+$/);
    expect(new Set(keys).size).toBe(16);
  });

  test('only the offline code is the connection’s', () => {
    expect(m.photoErrorKey({ details: { key: 'offline' } })).toBe('cat.photo.err.offline');
    for (const code of CODES.filter(c => c !== 'offline')) {
      expect(m.photoErrorKey({ details: { key: code } }), code).not.toBe('cat.photo.err.offline');
    }
  });
});

describe('shared/ catalogue-photo-model: the table', () => {
  test('holds exactly the 19 codes and the two files agree on every one', () => {
    expect(Object.keys(ported.CATALOGUE_PHOTO_KEYS).sort()).toStrictEqual([...CODES].sort());
    for (const code of CODES) {
      expect(ported.photoErrorKey({ details: { key: code } }), code).toBe(legacy.photoErrorKey({ details: { key: code } }));
      expect(ported.noRecipeKey(code), code).toBe(legacy.noRecipeKey(code));
    }
  });
});
