import { describe, expect, test } from 'vitest';
import { DEV_VERSION, miseVersion } from '../../build-version';
import { MISE2_VERSION } from './version';

// The limit firestore.rules puts on appVersion in errors, devices and usage. A longer stamp
// would make the shared models (error-model, device-model, usage-model) turn it into null, so
// every line would say «release unknown» without anything failing.
const RULES_LIMIT = 12;

describe('MISE2_VERSION', () => {
  test('is a stamp the rules accept: «m2-» and a commit, or «m2-dev», never longer than 12 characters', () => {
    expect(MISE2_VERSION).toMatch(/^m2-([0-9a-f]{7}|dev)$/);
    expect(MISE2_VERSION.length).toBeLessThanOrEqual(RULES_LIMIT);
  });

  test('cannot be mistaken for a release of the current app, whose appVersion is the cache number', () => {
    expect(MISE2_VERSION).not.toMatch(/^\d+$/);
  });
});

describe('miseVersion (the stamp vite.config.ts defines)', () => {
  test('is «m2-» and the seven digits of the commit', () => {
    expect(miseVersion(() => 'dbd49a4\n')).toBe('m2-dbd49a4');
  });

  test('cuts a longer id back to seven digits (git lengthens it when seven are ambiguous)', () => {
    const version = miseVersion(() => 'dbd49a4f1\n');
    expect(version).toBe('m2-dbd49a4');
    expect(version.length).toBeLessThanOrEqual(RULES_LIMIT);
  });

  test('falls back to «m2-dev» when git is missing, fails or says something that is not a commit', () => {
    expect(miseVersion(() => { throw new Error('git: not found'); })).toBe(DEV_VERSION);
    expect(miseVersion(() => '')).toBe(DEV_VERSION);
    expect(miseVersion(() => 'fatal: not a git repository')).toBe(DEV_VERSION);
    expect(miseVersion(() => 'ABCDEFG')).toBe(DEV_VERSION);
    expect(miseVersion(() => 'abc12')).toBe(DEV_VERSION);
  });

  test('is never longer than 12 characters, whatever git says', () => {
    for (const answer of ['', 'x', 'dbd49a4', 'dbd49a4f1c2e3', 'not a repository'.repeat(20)]) {
      expect(miseVersion(() => answer).length).toBeLessThanOrEqual(RULES_LIMIT);
    }
    expect(DEV_VERSION.length).toBeLessThanOrEqual(RULES_LIMIT);
  });

  // It runs the real git: on a busy PC that alone has taken more than Vitest's default 5 s.
  test('with the real git of this checkout it is a commit stamp or the fallback', () => {
    expect(miseVersion()).toMatch(/^m2-([0-9a-f]{7}|dev)$/);
  }, 20_000);
});
