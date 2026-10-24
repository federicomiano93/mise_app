// @vitest-environment node
//
// The zip reader's pre-check (P15), run against BOTH implementations: app/src/suppliers/invoiceImport/zipRead.ts and
// js/orders/invoice-zip/zip-read.js. ⚠️ `declaredEntryCount` is a SECURITY GUARD: it reads how many entries the archive
// DECLARES before fflate walks the directory, and it must see exactly what fflate sees. These are the six tests of
// section «5 · the entry count, before fflate» of tests/invoice-import-review.test.mjs (the file's other tests are about
// the current app's screen and model, not about the reader). The reader's limits, the corrupt archive and the loose files
// are in buildImport.spec.ts (tests/invoice-zip-build.test.mjs).
//
// PORTED: 6 of the 6 zip-reader tests of tests/invoice-import-review.test.mjs. Invented archives only.

import { describe, expect, test } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { implementations, ported } from './testing/implementations';

describe.each(implementations)('%s', (_name, impl) => {
  const { declaredEntryCount, readInvoiceArchives } = impl.zipRead;

  const zipOfEntries = (n: number): Uint8Array => {
    const members: Record<string, Uint8Array> = {};
    for (let i = 0; i < n; i += 1) members[`n${i}.xml`] = strToU8('<x/>');
    return zipSync(members);
  };
  // The position of the End Of Central Directory record of a zip made by fflate (no comment: it is the last 22 bytes).
  const eocdAt = (bytes: Uint8Array): number => bytes.length - 22;
  const forge = (bytes: Uint8Array, { onDisk, total, offset }: { onDisk?: number; total?: number; offset?: number }): Uint8Array => {
    const copy = new Uint8Array(bytes);
    const view = new DataView(copy.buffer);
    const at = eocdAt(copy);
    if (onDisk !== undefined) view.setUint16(at + 8, onDisk, true);
    if (total !== undefined) view.setUint16(at + 10, total, true);
    if (offset !== undefined) view.setUint32(at + 16, offset, true);
    return copy;
  };
  const refusal = (bytes: Uint8Array, options?: { limits: { maxEntries: number } }): [string, string] => {
    const read = readInvoiceArchives([{ name: 'forged.zip', bytes }], options);
    expect(read.containers).toStrictEqual([]);
    const skipped = read.skipped[0] as { reason: string; detail: string };
    return [skipped.reason, skipped.detail];
  };

  test('the limits themselves (review of 24 Oct 2026: nothing else pins them)', () => {
    expect(impl.zipRead.MAX_ARCHIVE_ENTRIES).toBe(5000);
    expect(impl.zipRead.MAX_ARCHIVE_BYTES).toBe(300_000_000);
    expect(impl.fatturapa.MAX_XML_BYTES).toBe(30_000_000);
  });

  test('5 · the entry count is read from the End Of Central Directory record', () => {
    expect(declaredEntryCount(zipOfEntries(3))).toBe(3);
    expect(declaredEntryCount(zipOfEntries(1))).toBe(1);
    expect(declaredEntryCount(new Uint8Array(10))).toBe(null);
    expect(declaredEntryCount(strToU8('not a zip, only long enough to be looked at, no record in it'))).toBe(null);
  });

  // ⚠️ WHICH CASES PROVE THE PRE-CHECK (measured by removing it): a forged +8 count of 60000, 6000/6000 and the 0xFFFF
  // count are ALSO caught by the check made after fflate has walked the directory. Only the two below are not — a
  // SMALL +8 count with a huge +10 count, and the ZIP64 offset — fflate reads those archives without complaint, so
  // without the pre-check they would be accepted.
  test('5 · a record that declares too many entries is refused first (+8 is what fflate loops on, +10 must not hide it)', () => {
    const real = zipOfEntries(1);
    expect(refusal(forge(real, { onDisk: 1, total: 60000 })), 'PROVES THE PRE-CHECK: without it this archive is read as if it were honest')
      .toStrictEqual(['too-many-entries', '5000']);
    expect(refusal(forge(real, { onDisk: 60000, total: 1 }))).toStrictEqual(['too-many-entries', '5000']);
    expect(refusal(forge(real, { onDisk: 6000, total: 6000 }))).toStrictEqual(['too-many-entries', '5000']);
    expect(declaredEntryCount(forge(real, { onDisk: 60000, total: 1 }))).toBe(60000);
  });

  test('5 · a ZIP64 marker is «zip unreadable» (not «too many entries»): an invoice zip never needs the format', () => {
    const real = zipOfEntries(1);
    expect(refusal(forge(real, { offset: 0xffffffff })), 'PROVES THE PRE-CHECK: without it fflate reads this archive as an honest one')
      .toStrictEqual(['zip-unreadable', '']);
    expect(refusal(forge(real, { onDisk: 0xffff, total: 0xffff }))).toStrictEqual(['zip-unreadable', '']);
    expect(declaredEntryCount(forge(real, { offset: 0xffffffff }))).toBe(Infinity);
  });

  test('5 · the record is searched down to exactly 65559 bytes from the end, like fflate', () => {
    const real = zipOfEntries(1);
    const padded = (extra: number): Uint8Array => { const out = new Uint8Array(real.length + extra); out.set(real); return out; };
    const exact = padded(65559 - 22);
    expect(exact.length - (real.length - 22)).toBe(65559);
    expect(declaredEntryCount(exact), 'at len - 65559: found').toBe(1);
    expect(declaredEntryCount(padded(65559 - 22 + 1)), 'at len - 65560: not found').toBe(null);
  });

  test('5 · the limit is the one the caller gives, and an honest archive is read', () => {
    const three = zipOfEntries(3);
    expect(refusal(three, { limits: { maxEntries: 2 } })[0]).toBe('too-many-entries');
    expect(readInvoiceArchives([{ name: 'a.zip', bytes: three }], { limits: { maxEntries: 3 } }).skipped.length).toBe(0);
  });

  test('5 · the record is found in the same window as fflate (a comment as long as the format allows)', () => {
    const real = zipOfEntries(1);
    const comment = 65535;
    const withComment = new Uint8Array(real.length + comment);
    withComment.set(real);
    new DataView(withComment.buffer).setUint16(real.length - 2, comment, true);
    expect(declaredEntryCount(withComment)).toBe(1);
    expect(Object.keys((readInvoiceArchives([{ name: 'a.zip', bytes: withComment }]).containers[0] as { entries: object }).entries).length).toBe(1);
  });
});

// ⚠️ ONE GUARD THE ORIGINAL DOES NOT HAVE (review of 24 Oct 2026, the header of zipRead.ts): a ZIP64 LOCATOR in front of the
// end record. fflate 0.8.3 switches to the ZIP64 record on that locator alone and loops on its 64-bit count (a 190-byte forged
// zip made it walk millions of entries); 0.8.2, pinned now, does not — but the guard must not depend on the version. The js
// original (0.8.2, no such check) reads this archive as its one honest entry, so this test runs on the port only.
describe('the port only: a ZIP64 locator', () => {
  const { declaredEntryCount, readInvoiceArchives } = ported.zipRead;

  // A real one-entry zip with a 20-byte ZIP64 end-of-directory locator inserted in front of its end record.
  const withLocator = (): Uint8Array => {
    const real = zipSync({ 'a.xml': strToU8('<x/>') });
    const eocd = real.length - 22;
    const out = new Uint8Array(real.length + 20);
    out.set(real.subarray(0, eocd), 0);
    const view = new DataView(out.buffer);
    view.setUint32(eocd, 0x07064b50, true);
    out.set(real.subarray(eocd), eocd + 20);
    return out;
  };

  test('is a ZIP64 marker: «zip unreadable», nothing walked', () => {
    const bytes = withLocator();
    expect(declaredEntryCount(bytes)).toBe(Infinity);
    const read = readInvoiceArchives([{ name: 'forged.zip', bytes }]);
    expect(read.containers).toStrictEqual([]);
    expect(read.skipped).toStrictEqual([{ name: 'forged.zip', reason: 'zip-unreadable', detail: '' }]);
  });
});
