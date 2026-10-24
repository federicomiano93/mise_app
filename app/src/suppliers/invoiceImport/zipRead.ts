// zipRead.ts — the owner's files (zip archives, loose .xml, loose .p7m) -> «containers» of XML bytes.
// A port of the zip half of invoice-import/fatturapa.py, with limits the Python script did not need (it ran
// on the owner's own computer, from a folder of his own choosing; here the zip comes through a file picker).
// Archives are read in memory and never extracted. The limits are checked on the DECLARED sizes before
// anything is inflated, and fflate allocates exactly the declared size for an entry, so an archive that
// lies about its size is truncated, not inflated.
// Pure: no DOM, no Firebase, no globals.
//
// FULL port of js/orders/invoice-zip/zip-read.js, kept in app/ (not in shared/) because it needs fflate, and shared/
// has no runtime dependency (decision T5). Same exported names, same behaviour input for input on every real archive;
// typing only differs — EXCEPT two guards the original does not have (review of 24 Oct 2026, below).
// ⚠️ `declaredEntryCount` is a SECURITY GUARD: change it only with the tests that forge archives (zipRead.spec.ts,
// zipRead.walk.spec.ts).
//
// ⚠️ fflate IS PINNED AT 0.8.2, THE VERSION THE CURRENT APP VENDORS (js/vendor/fflate.esm.js), NOT 0.8.3 (decision T5 said
// «0.8.3 if the end-of-directory specs pass»; they passed, but could not see this): 0.8.3 switches to the ZIP64 record whenever
// the four bytes 20 before the end record are the ZIP64 LOCATOR signature, and then loops on a 64-bit count from that record —
// up to 4,294,967,295 — walking past the end of the buffer without throwing. A forged zip of 190 bytes declaring one entry made
// it walk millions (reproduced in review): the tablet's tab freezes or runs out of memory. So, on top of the pin, two guards that
// do not depend on the version: `declaredEntryCount` treats a ZIP64 locator as ZIP64 (unreadable — an invoice zip never needs
// it), and the first pass STOPS the walk as soon as it has listed more entries than the limit, whatever the record declared.

import { unzipSync } from 'fflate';
import { MAX_XML_BYTES, redactFileName } from '@mise/shared/invoice-zip/fatturapa';
import type { InvoiceRead, SkippedFile } from '@mise/shared/invoice-zip/fatturapa';
import { SKIPPED } from '@mise/shared/invoice-zip/reasons';

export const MAX_ARCHIVE_ENTRIES = 5000;
export const MAX_ARCHIVE_BYTES = 300_000_000;

// A file as the picker hands it over.
export interface PickedFile { name: string; bytes: Uint8Array }

// The limits of the reader. The defaults are the ones above; a spec passes smaller ones.
export interface ReadLimits { maxXmlBytes: number; maxEntries: number; maxArchiveBytes: number }

const baseName = (path: unknown): string => {
  const parts = String(path).replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] as string;
};

const isZip = (name: string): boolean => name.toLowerCase().endsWith('.zip');
const isXml = (name: string): boolean => name.toLowerCase().endsWith('.xml');
const isP7m = (name: string): boolean => name.toLowerCase().endsWith('.p7m');

// Python's sorted(..., key=lambda p: p.name.lower())
const byLowerName = (a: PickedFile, b: PickedFile): number => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

const EOCD_SIGNATURE = 0x06054b50;
// The ZIP64 end-of-directory LOCATOR sits 20 bytes before the end record when an archive uses ZIP64.
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_BYTES = 20;
const EOCD_MIN_BYTES = 22;
// fflate's own search window: it examines every position until the end is 65559 bytes away.
const EOCD_SEARCH_WINDOW = 65559;

// The entry count the End Of Central Directory record DECLARES, read BEFORE fflate walks the directory.
// ⚠️ IT MUST SEE WHAT fflate WILL SEE: fflate loops on «entries on this disk» (EOCD+8, not +10), and switches to the
// ZIP64 record (which holds its own, 64-bit count) when that count is 0xFFFF or the directory offset (EOCD+16) is
// 0xFFFFFFFF. So: the record is searched in the same window fflate uses (it tries every position down to 65559 bytes
// from the end); the LARGER of the two counts is returned; and a ZIP64 marker returns Infinity — an invoice zip never
// needs ZIP64, so readZip refuses it as unreadable. null when no record is found: fflate then refuses the archive as unreadable.
// ⚠️ NOT IN THE ORIGINAL: a ZIP64 LOCATOR in front of the record is a ZIP64 marker too (the header says why).
export function declaredEntryCount(bytes?: Uint8Array | null): number | null {
  if (!bytes || bytes.length < EOCD_MIN_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - EOCD_SEARCH_WINDOW);
  for (let at = bytes.length - EOCD_MIN_BYTES; at >= lowest; at--) {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    const onDisk = view.getUint16(at + 8, true);
    const total = view.getUint16(at + 10, true);
    if (onDisk === 0xffff || total === 0xffff || view.getUint32(at + 16, true) === 0xffffffff) return Infinity;
    if (at >= ZIP64_LOCATOR_BYTES && view.getUint32(at - ZIP64_LOCATOR_BYTES, true) === ZIP64_LOCATOR_SIGNATURE) return Infinity;
    return Math.max(onDisk, total);
  }
  return null;
}

type ZipRead = { entries: Record<string, Uint8Array>; p7m: number } | { refused: string; detail?: string };

// Thrown from inside fflate's walk to stop it (see readZip's first pass).
class TooManyEntries extends Error {}

// One zip -> { entries: { baseName: bytes }, p7m } or { refused: reason }.
// Every `.xml` entry is read; `.p7m` entries are counted; PDFs and everything else are ignored.
function readZip(bytes: Uint8Array, limits: ReadLimits, skipped: SkippedFile[]): ZipRead {
  const entryCount = declaredEntryCount(bytes);
  // A ZIP64 marker is not «too many entries»: an invoice zip never needs the format, so it is simply unreadable.
  if (entryCount === Infinity) return { refused: SKIPPED.ZIP_UNREADABLE };
  if (entryCount !== null && entryCount > limits.maxEntries) {
    return { refused: SKIPPED.TOO_MANY_ENTRIES, detail: String(limits.maxEntries) };
  }
  let listing: { name: string; size: number }[];
  try {
    // Pass 1: the central directory only. The filter answers false, so nothing is inflated.
    // ⚠️ NOT IN THE ORIGINAL: the walk is STOPPED once it has listed more entries than the limit, so no record — whatever it
    // declares, in whichever format the library reads it — can make it walk millions of entries (the header says why).
    listing = [];
    unzipSync(bytes, {
      filter: (file) => {
        listing.push({ name: file.name, size: file.originalSize });
        if (listing.length > limits.maxEntries) throw new TooManyEntries();
        return false;
      },
    });
  } catch (error) {
    if (error instanceof TooManyEntries) return { refused: SKIPPED.TOO_MANY_ENTRIES, detail: String(limits.maxEntries) };
    return { refused: SKIPPED.ZIP_UNREADABLE };
  }
  if (listing.length > limits.maxEntries) {
    return { refused: SKIPPED.TOO_MANY_ENTRIES, detail: String(limits.maxEntries) };
  }

  let p7m = 0;
  const wanted = new Set<string>();
  let declared = 0;
  for (const { name: path, size } of listing) {
    if (path.endsWith('/')) continue; // a folder
    const name = baseName(path);
    if (isP7m(name)) {
      p7m += 1;
    } else if (isXml(name)) {
      if (size > limits.maxXmlBytes) {
        skipped.push({ name: redactFileName(name), reason: SKIPPED.FILE_TOO_LARGE, detail: '' });
      } else {
        wanted.add(path);
        declared += size;
      }
    }
  }
  if (declared > limits.maxArchiveBytes) {
    return { refused: SKIPPED.ARCHIVE_TOO_LARGE };
  }

  let files: Record<string, Uint8Array>;
  try {
    // Pass 2: inflate only what was accepted.
    files = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
  } catch {
    return { refused: SKIPPED.ZIP_UNREADABLE };
  }
  const entries: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) entries[baseName(path)] = data;
  return { entries, p7m };
}

// files: [{ name, bytes: Uint8Array }] — what the picker gave.
// options.limits (tests only): { maxXmlBytes, maxEntries, maxArchiveBytes }.
// -> { containers: [{ source, entries: { name: bytes } }], p7mCount, skipped: [{ name, reason }] }
// Zips come first (by name, case-insensitive), then ONE container for all the loose files — the order the
// script read a folder in, which decides which copy of a duplicated invoice is the one kept.
export function readInvoiceArchives(files: readonly PickedFile[], options: { limits?: Partial<ReadLimits> } = {}): InvoiceRead {
  const limits: ReadLimits = {
    maxXmlBytes: MAX_XML_BYTES,
    maxEntries: MAX_ARCHIVE_ENTRIES,
    maxArchiveBytes: MAX_ARCHIVE_BYTES,
    ...(options.limits || {}),
  };
  const result: InvoiceRead = { containers: [], p7mCount: 0, skipped: [] };
  const sorted = [...files].sort(byLowerName);

  for (const file of sorted) {
    if (!isZip(file.name)) continue;
    const read = readZip(file.bytes, limits, result.skipped);
    if ('refused' in read) {
      result.skipped.push({ name: redactFileName(file.name), reason: read.refused, detail: read.detail || '' });
      continue;
    }
    result.containers.push({ source: redactFileName(file.name), entries: read.entries });
    result.p7mCount += read.p7m;
  }

  const loose = sorted.filter((file) => !isZip(file.name) && (isXml(file.name) || isP7m(file.name)));
  if (loose.length) {
    const entries: Record<string, Uint8Array> = {};
    for (const file of loose) {
      const name = baseName(file.name);
      if (isP7m(name)) {
        result.p7mCount += 1;
      } else if (file.bytes.length > limits.maxXmlBytes) {
        result.skipped.push({ name: redactFileName(name), reason: SKIPPED.FILE_TOO_LARGE, detail: '' });
      } else {
        entries[name] = file.bytes;
      }
    }
    result.containers.push({ source: '', entries });
  }
  return result;
}
