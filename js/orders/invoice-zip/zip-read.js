// zip-read.js — the owner's files (zip archives, loose .xml, loose .p7m) -> «containers» of XML bytes.
// A port of the zip half of invoice-import/fatturapa.py, with limits the Python script did not need (it ran
// on the owner's own computer, from a folder of his own choosing; here the zip comes through a file picker).
// Archives are read in memory and never extracted. The limits are checked on the DECLARED sizes before
// anything is inflated, and fflate allocates exactly the declared size for an entry, so an archive that
// lies about its size is truncated, not inflated.
// Pure: no DOM, no Firebase, no globals.

import { unzipSync } from '../../vendor/fflate.esm.js';
import { MAX_XML_BYTES, redactFileName } from './fatturapa.js';
import { SKIPPED } from './reasons.js';

export const MAX_ARCHIVE_ENTRIES = 5000;
export const MAX_ARCHIVE_BYTES = 300_000_000;

const baseName = (path) => {
  const parts = String(path).replace(/\\/g, '/').split('/');
  return parts[parts.length - 1];
};

const isZip = (name) => name.toLowerCase().endsWith('.zip');
const isXml = (name) => name.toLowerCase().endsWith('.xml');
const isP7m = (name) => name.toLowerCase().endsWith('.p7m');

// Python's sorted(..., key=lambda p: p.name.lower())
const byLowerName = (a, b) => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_BYTES = 22;
// fflate's own search window: it examines every position until the end is 65559 bytes away.
const EOCD_SEARCH_WINDOW = 65559;

// The entry count the End Of Central Directory record DECLARES, read BEFORE fflate walks the directory.
// ⚠️ IT MUST SEE WHAT fflate WILL SEE: fflate loops on «entries on this disk» (EOCD+8, not +10), and switches to the
// ZIP64 record (which holds its own, 64-bit count) when that count is 0xFFFF or the directory offset (EOCD+16) is
// 0xFFFFFFFF. So: the record is searched in the same window fflate uses (it tries every position down to 65559 bytes
// from the end); the LARGER of the two counts is returned; and a ZIP64 marker returns Infinity — an invoice zip never
// needs ZIP64, so it is refused. null when no record is found: fflate then refuses the archive as unreadable.
export function declaredEntryCount(bytes) {
  if (!bytes || bytes.length < EOCD_MIN_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - EOCD_SEARCH_WINDOW);
  for (let at = bytes.length - EOCD_MIN_BYTES; at >= lowest; at--) {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    const onDisk = view.getUint16(at + 8, true);
    const total = view.getUint16(at + 10, true);
    if (onDisk === 0xffff || total === 0xffff || view.getUint32(at + 16, true) === 0xffffffff) return Infinity;
    return Math.max(onDisk, total);
  }
  return null;
}

// One zip -> { entries: { baseName: bytes }, p7m } or { refused: reason }.
// Every `.xml` entry is read; `.p7m` entries are counted; PDFs and everything else are ignored.
function readZip(bytes, limits, skipped) {
  const entryCount = declaredEntryCount(bytes);
  if (entryCount !== null && entryCount > limits.maxEntries) {
    return { refused: SKIPPED.TOO_MANY_ENTRIES, detail: String(limits.maxEntries) };
  }
  let listing;
  try {
    // Pass 1: the central directory only. The filter answers false, so nothing is inflated.
    listing = [];
    unzipSync(bytes, {
      filter: (file) => {
        listing.push({ name: file.name, size: file.originalSize });
        return false;
      },
    });
  } catch {
    return { refused: SKIPPED.ZIP_UNREADABLE };
  }
  if (listing.length > limits.maxEntries) {
    return { refused: SKIPPED.TOO_MANY_ENTRIES, detail: String(limits.maxEntries) };
  }

  let p7m = 0;
  const wanted = new Set();
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

  let files;
  try {
    // Pass 2: inflate only what was accepted.
    files = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
  } catch {
    return { refused: SKIPPED.ZIP_UNREADABLE };
  }
  const entries = {};
  for (const [path, data] of Object.entries(files)) entries[baseName(path)] = data;
  return { entries, p7m };
}

// files: [{ name, bytes: Uint8Array }] — what the picker gave.
// options.limits (tests only): { maxXmlBytes, maxEntries, maxArchiveBytes }.
// -> { containers: [{ source, entries: { name: bytes } }], p7mCount, skipped: [{ name, reason }] }
// Zips come first (by name, case-insensitive), then ONE container for all the loose files — the order the
// script read a folder in, which decides which copy of a duplicated invoice is the one kept.
export function readInvoiceArchives(files, options = {}) {
  const limits = {
    maxXmlBytes: MAX_XML_BYTES,
    maxEntries: MAX_ARCHIVE_ENTRIES,
    maxArchiveBytes: MAX_ARCHIVE_BYTES,
    ...(options.limits || {}),
  };
  const result = { containers: [], p7mCount: 0, skipped: [] };
  const sorted = [...files].sort(byLowerName);

  for (const file of sorted) {
    if (!isZip(file.name)) continue;
    const read = readZip(file.bytes, limits, result.skipped);
    if (read.refused) {
      result.skipped.push({ name: redactFileName(file.name), reason: read.refused, detail: read.detail || '' });
      continue;
    }
    result.containers.push({ source: redactFileName(file.name), entries: read.entries });
    result.p7mCount += read.p7m;
  }

  const loose = sorted.filter((file) => !isZip(file.name) && (isXml(file.name) || isP7m(file.name)));
  if (loose.length) {
    const entries = {};
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
