// The install guide offered once after a join (staff slice 2), run against BOTH implementations: the TypeScript port and
// js/install-hint.js, which the live app uses today. Ported from the behaviour half of tests/install-hint.test.mjs.

import { describe, expect, test } from 'vitest';
import * as ported from './install-hint';
import * as legacyJs from '../../js/install-hint.js';

const legacy = legacyJs as unknown as typeof ported;

function fakeStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] ?? null : null),
    setItem: (k: string, v: string) => { data[k] = String(v); },
    removeItem: (k: string) => { delete data[k]; },
  };
}
const brokenStorage = {
  getItem(): string | null { throw new Error('denied'); },
  setItem(): void { throw new Error('denied'); },
  removeItem(): void { throw new Error('denied'); },
};

describe.each([['the port', ported], ['js/install-hint.js', legacy]] as const)('%s', (_name, m) => {
  test('the current app\'s own key', () => {
    expect(m.JUST_JOINED_KEY).toBe('just-joined');
  });

  test('nobody who has not just joined is offered anything', () => {
    expect(m.checkInstallHint({ storage: fakeStorage(), standalone: false }).offer).toBe(false);
  });

  test('an app already on the home screen says nothing, and forgets the flag', () => {
    const storage = fakeStorage({ [m.JUST_JOINED_KEY]: '1' });
    expect(m.checkInstallHint({ storage, standalone: true }).offer).toBe(false);
    expect(storage.getItem(m.JUST_JOINED_KEY)).toBeNull();
  });

  test('a storage that refuses everything is a silence, not a crash', () => {
    const r = m.checkInstallHint({ storage: brokenStorage, standalone: false });
    expect(r.offer).toBe(false);
    expect(() => { r.adopt(); }).not.toThrow();
    expect(m.markJustJoined(brokenStorage)).toBe(false);
  });

  test('somebody who has just joined, in a browser, is offered the guide; asking does not spend it; adopt() does', () => {
    const storage = fakeStorage();
    expect(m.markJustJoined(storage)).toBe(true);
    const first = m.checkInstallHint({ storage, standalone: false });
    expect(first.offer).toBe(true);
    expect(storage.getItem(m.JUST_JOINED_KEY)).toBe('1');
    first.adopt();
    expect(m.checkInstallHint({ storage, standalone: false }).offer).toBe(false);
  });

  test('only the exact flag counts', () => {
    for (const value of ['', '0', 'true', ' 1']) {
      expect(m.checkInstallHint({ storage: fakeStorage({ [m.JUST_JOINED_KEY]: value }), standalone: false }).offer, value)
        .toBe(false);
    }
  });
});
