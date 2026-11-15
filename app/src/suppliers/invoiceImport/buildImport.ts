// buildImport.ts — the files the owner picked -> the import file: the zip half (app code, because it needs fflate) joined
// to the pure half in shared/ (`buildImportFromRead`). The two together are js/orders/invoice-zip/build-import.js's
// `buildImportFromInvoices`, with the same signature and the same result; see shared/src/invoice-zip/build-import.ts for
// what the result holds.

import { buildImportFromRead } from '@mise/shared/invoice-zip/build-import';
import type { BuildOptions, ImportResult } from '@mise/shared/invoice-zip/build-import';
import { readInvoiceArchives } from './zipRead';
import type { PickedFile, ReadLimits } from './zipRead';

// options: { parseXml (required: text -> tree), now (Date | ms | ISO text), salt, noVatKey(taxCode, name),
//            eggWeightG (default 50), excludedSuppliers, limits (tests only) }
export interface BuildImportOptions extends BuildOptions { limits?: Partial<ReadLimits> }

// files: [{ name, bytes: Uint8Array }] (a .zip, a loose .xml or .p7m).
// -> { importFile, products, candidates, excluded, skippedFiles, p7mCount, salesSkipped, documents, duplicates, otherXml }
export function buildImportFromInvoices(files: readonly PickedFile[], options: BuildImportOptions = {}): ImportResult {
  const read = readInvoiceArchives(files, { limits: options.limits });
  return buildImportFromRead(read, options);
}
