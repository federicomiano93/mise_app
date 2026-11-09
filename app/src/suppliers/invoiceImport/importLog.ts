// importLog.ts — the import log without the screen or the database (Federico's decision of 21 Oct 2026, «ok a tutto»; Mise 2
// only: the current app keeps no record of the files it imported). No React and no Firestore: importSource.ts reads and writes the
// records (`invoice-imports`), the screen words them. Every date here is the INVOICES' own `Data` (YYYY-MM-DD), never the day of
// the upload, except `importedAt`, which is the moment the record was written.
//
// What it answers:
//   • the past imports, newest first («file, date — N invoices from X to Y»);
//   • the summary above them: the first and last invoice date imported, and the MONTHS between them that no imported invoice
//     falls in («Missing: from December 2025 to July 2026»);
//   • for a file just read, BEFORE anything is written: how many of its invoices are new and how many were imported before
//     (`fileVerdict`), with the day they were — the reader has already set those aside (`alreadyImported` of build-import), so
//     the rest of the import never sees them;
//   • at the end of a run, the record to write (`logEntryOf`).
//
// ⚠️ AN INVOICE IS KNOWN BY ITS OWN ID, NEVER BY THE FILE'S NAME: the reader's `docId` (the SDI id; the file-name id only for an
// invoice without one, which carries no price anyway). A zip renamed, or two months merged into one, is still the same invoices.
// ⚠️ AN INVOICE IS RECORDED ONLY WHEN EVERYTHING IT FED WAS SEEN THROUGH (`logEntryOf`): an ingredient row that failed, stopped,
// lost its price changes or a name the person chose leaves every invoice it holds a price of OUT of the record, so loading the
// same file again offers them again. A record says «done», never «tried». The create-only price points stay the second guard.

import { redactFileName } from '@mise/shared/invoice-zip/fatturapa';
import type { ImportResult } from '@mise/shared/invoice-zip/build-import';
import type { PlanEntry } from '@mise/shared/invoice-import-plan';
import type { StoredDoc } from '../suppliersSource';
import type { ImportFile } from './importRun';

// The rules' caps (firestore.rules, `invoice-imports`).
export const MAX_FILE_NAME = 500;
export const MAX_LOG_INVOICES = 5000;
export const MAX_LOG_MONTHS = 600;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
// The reader's included documents (DOCUMENT_STATUS.INCLUDED of @mise/shared/invoice-zip/reasons): the invoices that can carry a
// price. An excluded one (a credit note, an invoice without an SDI id, a supplier left out) is never counted nor recorded.
const INCLUDED = 'included';

// One record of the log, as the screen reads it. A record whose shape is wrong is dropped, never fatal.
export interface ImportRecord {
  readonly id: string;
  readonly fileName: string;
  readonly importedAt: string;
  readonly firstDate: string;
  readonly lastDate: string;
  readonly months: readonly string[];
  readonly invoiceIds: readonly string[];
}

// What is written: the record less its id (minted by the source), plus nothing else — no «who imported» (P13).
export type ImportRecordData = Omit<ImportRecord, 'id'>;

const isDate = (value: unknown): value is string => typeof value === 'string' && DATE_RE.test(value);

// A stored document → a record, or null when it is not one (a hand edit, a future shape).
export function recordOf(doc: StoredDoc): ImportRecord | null {
  const { id, fileName, importedAt, firstDate, lastDate, months, invoiceIds } = doc;
  if (typeof fileName !== 'string' || typeof importedAt !== 'string' || !isDate(firstDate) || !isDate(lastDate)) return null;
  if (!Array.isArray(months) || !Array.isArray(invoiceIds)) return null;
  const ids = invoiceIds.filter((value): value is string => typeof value === 'string' && value !== '');
  if (ids.length === 0) return null;
  return {
    id,
    fileName,
    importedAt,
    firstDate,
    lastDate,
    months: months.filter((value): value is string => typeof value === 'string' && MONTH_RE.test(value)),
    invoiceIds: ids,
  };
}

export const recordsOf = (docs: readonly StoredDoc[]): ImportRecord[] =>
  docs.map(recordOf).filter((record): record is ImportRecord => record !== null);

// Newest first; two written at the same moment keep a fixed order.
export function pastImports(records: readonly ImportRecord[]): ImportRecord[] {
  return [...records].sort((a, b) => (a.importedAt === b.importedAt ? a.id.localeCompare(b.id) : (a.importedAt < b.importedAt ? 1 : -1)));
}

// Every invoice id the venue imported: what the reader sets aside.
export function importedIds(records: readonly ImportRecord[]): Set<string> {
  const ids = new Set<string>();
  records.forEach(record => { record.invoiceIds.forEach(id => ids.add(id)); });
  return ids;
}

// A run of consecutive missing months, YYYY-MM to YYYY-MM (the same month twice for one).
export interface MonthGap {
  readonly from: string;
  readonly to: string;
}

export interface LogSummary {
  readonly firstDate: string;
  readonly lastDate: string;
  readonly gaps: readonly MonthGap[];
}

const monthOf = (date: string): string => date.slice(0, 7);

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${String(year + 1).padStart(4, '0')}-01` : `${month.slice(0, 4)}-${String(m + 1).padStart(2, '0')}`;
}

// The months strictly between the first and the last imported invoice that no imported invoice falls in. A month before the
// first or after the last is not «missing»: the log cannot know where the person's books start or end.
export function missingMonths(first: string, last: string, covered: ReadonlySet<string>): MonthGap[] {
  const gaps: MonthGap[] = [];
  let open: string | null = null;
  let previous = '';
  // Fifty years at most: a malformed record can never spin this loop.
  for (let month = monthOf(first), steps = 0; month <= monthOf(last) && steps < MAX_LOG_MONTHS; month = nextMonth(month), steps++) {
    if (covered.has(month)) {
      if (open !== null) gaps.push({ from: open, to: previous });
      open = null;
    } else if (open === null) {
      open = month;
    }
    previous = month;
  }
  if (open !== null) gaps.push({ from: open, to: previous });
  return gaps;
}

// «Invoices loaded: from X to Y» and the missing months; null when nothing was ever imported.
export function summarizeLog(records: readonly ImportRecord[]): LogSummary | null {
  if (records.length === 0) return null;
  let firstDate = '';
  let lastDate = '';
  const covered = new Set<string>();
  records.forEach(record => {
    if (firstDate === '' || record.firstDate < firstDate) firstDate = record.firstDate;
    if (lastDate === '' || record.lastDate > lastDate) lastDate = record.lastDate;
    record.months.forEach(month => covered.add(month));
    // A record always covers the months of its own first and last invoice.
    covered.add(monthOf(record.firstDate));
    covered.add(monthOf(record.lastDate));
  });
  return { firstDate, lastDate, gaps: missingMonths(firstDate, lastDate, covered) };
}

// What a file holds, said before anything is written: «This file: N invoices from X to Y — A new, B already imported».
export interface FileVerdict {
  readonly total: number;
  readonly newCount: number;
  readonly oldCount: number;
  // '' when no invoice of the file carries a readable date.
  readonly firstDate: string;
  readonly lastDate: string;
  // The most recent `importedAt` of a record holding one of the old invoices; '' when none is old.
  readonly importedAt: string;
}

const newInvoicesOf = (built: ImportResult) => built.documents.filter(doc => doc.status === INCLUDED);

export function fileVerdict(built: ImportResult, records: readonly ImportRecord[]): FileVerdict {
  const fresh = newInvoicesOf(built);
  const old = built.alreadyImported ?? [];
  const dates = [...fresh.map(doc => doc.date), ...old.map(doc => doc.date)].filter(isDate).sort();
  const oldIds = new Set(old.map(doc => doc.docId));
  let importedAt = '';
  records.forEach(record => {
    if (record.importedAt > importedAt && record.invoiceIds.some(id => oldIds.has(id))) importedAt = record.importedAt;
  });
  return {
    total: fresh.length + old.length,
    newCount: fresh.length,
    oldCount: old.length,
    firstDate: dates[0] ?? '',
    lastDate: dates[dates.length - 1] ?? '',
    importedAt,
  };
}

// The rows of step 3 that were NOT seen through when the screen closed with «Done» and nothing to write: every row is either
// skipped by the person or already in Mise, except a row whose price was held for a look («Lascia per ora»: it comes back on the
// next load), a row the plan could not handle (an error) or one in a state this file does not know — left out, never guessed.
export function unfinishedWithoutRun(entries: readonly PlanEntry[]): Set<string> {
  const done = new Set(['skipped', 'unchanged']);
  return new Set(entries.filter(entry => !done.has(entry.row.status) || entry.row.held === true).map(entry => entry.planned.key));
}

// The picked files' names as the record keeps them: a personal tax code blanked (the SDI names a sole trader's file after it),
// joined, cut to the rules' cap.
export function fileNameOf(names: readonly string[]): string {
  const joined = names.map(name => redactFileName(name).trim()).filter(Boolean).join(', ');
  return joined.length > MAX_FILE_NAME ? `${joined.slice(0, MAX_FILE_NAME - 1)}…` : joined;
}

export interface LogEntryInput {
  // What the reader made of the files (`documents` = the NEW invoices; the old ones were set aside).
  readonly built: ImportResult;
  // The import file the run worked on (the selection's): which invoice each ingredient row holds a price of.
  readonly file: ImportFile;
  // The rows not seen through (the run's `unfinishedKeys`, or `unfinishedWithoutRun`).
  readonly unfinishedKeys: ReadonlySet<string>;
  // The picked files' names.
  readonly fileNames: readonly string[];
  readonly now: Date;
}

// The record of this import, or null when there is nothing to record (no new invoice seen through, or none with a date).
export function logEntryOf({ built, file, unfinishedKeys, fileNames, now }: LogEntryInput): ImportRecordData | null {
  // The invoices an unfinished row holds a price of. A price carries the invoice's SDI id; several invoices in one file share it
  // (the reader numbers their lines apart), so every document with that SDI id is left out.
  const held = new Set<string>();
  file.ingredients.forEach(ingredient => {
    if (!unfinishedKeys.has(ingredient.key)) return;
    ingredient.prices.forEach(price => { if (price.invoiceId) held.add(String(price.invoiceId)); });
  });
  const seen = new Set<string>();
  const kept = newInvoicesOf(built).filter(doc => {
    if (doc.sdiId && held.has(doc.sdiId)) return false;
    if (!doc.docId || seen.has(doc.docId)) return false;
    seen.add(doc.docId);
    return true;
  }).slice(0, MAX_LOG_INVOICES);
  const dates = kept.map(doc => doc.date).filter(isDate).sort();
  const fileName = fileNameOf(fileNames);
  if (kept.length === 0 || dates.length === 0 || fileName === '') return null;
  const months = [...new Set(dates.map(monthOf))].sort().slice(0, MAX_LOG_MONTHS);
  return {
    fileName,
    importedAt: now.toISOString(),
    firstDate: dates[0] as string,
    lastDate: dates[dates.length - 1] as string,
    months,
    invoiceIds: kept.map(doc => doc.docId).sort(),
  };
}
