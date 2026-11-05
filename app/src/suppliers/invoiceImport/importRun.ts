// importRun.ts — what the import screen holds between its steps, and the pure steps that make it (step 3e-6, part B3a).
// No React and no database here: the screen reads, asks and shows; the model decides (@mise/shared/invoice-import-model),
// the plan applies (@mise/shared/invoice-import-plan), importSource.ts talks to Firestore.

import { parseImportFile } from '@mise/shared/invoice-import-model';
import type { ParsedImport } from '@mise/shared/invoice-import-model';
import { stopKind } from '@mise/shared/invoice-import-plan';
import type { ImportResult } from '@mise/shared/invoice-zip/build-import';
import { domToTree } from '@mise/shared/invoice-zip/fatturapa';
import type { ParseXml } from '@mise/shared/invoice-zip/fatturapa';
import { selectImport } from '@mise/shared/invoice-zip/selection';
import type { Selection } from '@mise/shared/invoice-zip/selection';
import type { MessageKey } from '../../i18n/en';
import type { StoredDoc } from '../suppliersSource';
import { buildImportFromInvoices } from './buildImport';

// The import file the rest of the screen reads: the selection's file, run through the model's parser (the seam between the
// reader and the app, parity I30).
export type ImportFile = Extract<ParsedImport, { ok: true }>['file'];

// What the person ticked on the first screen: a product put back, a remembered supplier brought back.
export interface Ticks {
  readonly overrides: Readonly<Record<string, string>>;
  readonly supplierOverrides: Readonly<Record<string, string>>;
}

export const NO_TICKS: Ticks = Object.freeze({ overrides: Object.freeze({}), supplierOverrides: Object.freeze({}) });

// What the venue holds, as the section's store shows it now.
export interface Existing {
  readonly suppliers: readonly StoredDoc[];
  readonly ingredients: readonly StoredDoc[];
}

// What the invoices said, what the venue remembered, and what the person ticked — and the selection that makes of them the file
// the next steps work on.
//
// ⚠️ PART B3b HAND-OVER: this is the state step 3 starts from. `file` is what is to be imported, `selection` and `built` are
// what the remembered decisions (`decisionChanges`) are worked out from, `storedDecisions` is what the venue remembered when
// the files were read, and the ticks are the first screen's answers.
export interface ImportRun {
  readonly built: ImportResult;
  readonly storedDecisions: readonly StoredDoc[];
  readonly ticks: Ticks;
  readonly selection: Selection;
  readonly file: ImportFile;
}

// The selection of a read, drawn again from what was read, what the venue remembered and what the person ticked.
export function chooseFrom(built: ImportResult, storedDecisions: readonly StoredDoc[], ticks: Ticks, existing: Existing): ImportRun {
  const selection = selectImport(built, {
    decisions: storedDecisions,
    existingSuppliers: existing.suppliers,
    existingIngredients: existing.ingredients,
    overrides: { ...ticks.overrides },
    supplierOverrides: { ...ticks.supplierOverrides },
  });
  const parsed = parseImportFile(JSON.stringify(selection.importFile));
  // The reader makes this file itself, so a refusal here is a bug, not a bad file: the screen says the plain «could not be read».
  if (!parsed.ok) throw new Error(`The selection is not an import file (${parsed.error}).`);
  return { built, storedDecisions, ticks, selection, file: parsed.file };
}

// The browser's own XML parser, the way the reader asks for one: text → tree. domToTree throws when the parser answered with a
// <parsererror> document (a broken file is skipped by the reader, never a crash).
export const browserParseXml: ParseXml = text => domToTree(new DOMParser().parseFromString(text, 'application/xml'));

// The files the person picked → what the invoices hold. Everything — unzip, XML parse, classify, price — runs in memory on the
// main thread; nothing is written. ⚠️ THE SALT OF A SUPPLIER WITHOUT A VAT NUMBER IS THE VENUE'S ID (parity I31): its key is a
// hash of the salt and the tax code, and the default salt is the empty one, which would make every venue's keys alike.
// `alreadyImported` (the import log's invoice ids, importLog.ts): those invoices are set aside as soon as they are read and come
// back as the result's `alreadyImported`; nothing else of the import ever sees them. Without it the reader sets nothing aside.
export async function readInvoiceFiles(
  files: readonly File[],
  venueId: string,
  parseXml: ParseXml = browserParseXml,
  alreadyImported?: ReadonlySet<string>,
): Promise<ImportResult> {
  const inputs: { name: string; bytes: Uint8Array }[] = [];
  for (const file of files) inputs.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  return buildImportFromInvoices(inputs, { parseXml, now: new Date(), salt: venueId, ...(alreadyImported ? { alreadyImported } : {}) });
}

// Which sentence tells a person why a call failed: a refusal and a lost connection (a timeout counts as one) have their own;
// anything else gets the screen's own fallback.
export function failureKey(error: unknown, fallback: MessageKey): MessageKey {
  const kind = stopKind(error);
  if (kind === 'permission') return 'sup.imp.stop.permission';
  if (kind === 'offline') return 'sup.imp.stop.offline';
  return fallback;
}
