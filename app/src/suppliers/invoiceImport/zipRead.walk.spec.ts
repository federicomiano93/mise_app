// @vitest-environment node
//
// The zip reader's second guard of its own (review of 24 Oct 2026, the header of zipRead.ts): the first pass STOPS walking
// the central directory as soon as it has listed more entries than the limit, whatever the end record declared. A library
// that loops on a count the pre-check did not see (fflate 0.8.3 on a ZIP64 locator, reproduced in review) can then never
// walk millions of entries. fflate 0.8.2, pinned, cannot be made to do that with a real archive, so the walk is played here:
// `unzipSync` is replaced, for this file only, by one that hands the filter as many entries as the test asks for. The js
// original has no such guard and is not run here.

import { describe, expect, test, vi } from 'vitest';

const walk = vi.hoisted(() => ({ entries: 0, seen: 0 }));

vi.mock('fflate', async (importOriginal) => {
  const real = await importOriginal<typeof import('fflate')>();
  return {
    ...real,
    unzipSync: (_bytes: Uint8Array, options?: { filter?: (file: { name: string; originalSize: number }) => boolean }) => {
      for (let i = 0; i < walk.entries; i += 1) {
        walk.seen += 1;
        options?.filter?.({ name: `n${i}.xml`, originalSize: 10 });
      }
      return {};
    },
  };
});

const { readInvoiceArchives } = await import('./zipRead');
const { strToU8, zipSync } = await import('fflate');

describe('the first pass stops at the limit', () => {
  // A real one-entry zip: its end record declares 1, so the pre-check lets it through to the walk.
  const honest = zipSync({ 'a.xml': strToU8('<x/>') });

  test('a walk that goes on past the limit is stopped one entry after it, and the archive refused as too many entries', () => {
    walk.entries = 1_000_000;
    walk.seen = 0;
    const read = readInvoiceArchives([{ name: 'forged.zip', bytes: honest }], { limits: { maxEntries: 3 } });
    expect(walk.seen, 'stopped at the fourth entry, not a million').toBe(4);
    expect(read.containers).toStrictEqual([]);
    expect(read.skipped).toStrictEqual([{ name: 'forged.zip', reason: 'too-many-entries', detail: '3' }]);
  });

  test('a walk within the limit is not stopped', () => {
    walk.entries = 3;
    walk.seen = 0;
    const read = readInvoiceArchives([{ name: 'ok.zip', bytes: honest }], { limits: { maxEntries: 3 } });
    expect(walk.seen).toBe(6);
    expect(read.skipped).toStrictEqual([]);
  });
});
