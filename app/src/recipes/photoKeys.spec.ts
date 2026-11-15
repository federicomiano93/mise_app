import { describe, expect, it } from 'vitest';
import { CATALOGUE_PHOTO_KEYS, noRecipeKey, photoErrorKey } from '@mise/shared/catalogue-photo-model';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';

// The walk of the Catalogue's table (the current app's tests/photo-image-model.test.mjs, the dictionary half): every one of
// the 19 codes lands on a sentence that exists in BOTH dictionaries, and only the offline one blames the connection.

const CODES = Object.keys(CATALOGUE_PHOTO_KEYS);
const NOT_ERRORS = ['nothing-readable', 'refused', 'truncated', 'no-tool'];

describe('the photo sentences', () => {
  it('has the 19 codes of the current app, 16 distinct sentences', () => {
    expect(CODES).toHaveLength(19);
    expect(new Set(Object.values(CATALOGUE_PHOTO_KEYS)).size).toBe(16);
  });

  it.each(CODES)('«%s» maps to a key that exists in English and in Italian', code => {
    const key = photoErrorKey({ details: { key: code } });
    expect(key in en, `${key} is not in en.ts`).toBe(true);
    expect(key in italian, `${key} is not in it.ts`).toBe(true);
  });

  it.each(NOT_ERRORS)('the answer «%s» (the call worked) maps to a key in both dictionaries', reason => {
    const key = noRecipeKey(reason);
    expect(key in en).toBe(true);
    expect(key in italian).toBe(true);
  });

  it('⚠️ ONLY the offline case mentions the connection', () => {
    // Telling somebody with full signal to check their connection sends them to fix the one thing that is working. A refusal,
    // a daily limit and an unreadable photograph are all decisions, and each must say so.
    const offline = photoErrorKey({ code: 'functions/unavailable' }) as keyof typeof en;
    expect(en[offline]).toMatch(/connection/i);
    expect(italian[offline]).toMatch(/connessione/i);
    for (const code of CODES.filter(candidate => candidate !== 'offline')) {
      const key = photoErrorKey({ details: { key: code } }) as keyof typeof en;
      expect(en[key], code).not.toMatch(/connection/i);
      expect(italian[key], code).not.toMatch(/connessione/i);
    }
  });

  it('every key the screens use exists in both dictionaries, with the same placeholders', () => {
    const photoKeys = (Object.keys(en) as Array<keyof typeof en>).filter(key => key.startsWith('cat.photo.'));
    expect(photoKeys.length).toBeGreaterThan(30);
    for (const key of photoKeys) expect(key in italian, key).toBe(true);
  });
});
