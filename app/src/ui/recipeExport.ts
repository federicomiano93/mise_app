// recipeExport.ts — the two files of the recipe export, built in the browser: a one-page PDF and an .xlsx.
//
// The impure half of js/recipe-export.js. The pure half (the model, the page geometry, the sheet description,
// the error words) is `@mise/shared/recipe-export`; this file only loads the libraries and hands them what it
// made. The recipe never leaves the device.
//
// ⚠️ THE TWO LIBRARIES ARE LOADED ONLY INSIDE buildPdfBlob / buildXlsxBlob, WITH import(). jsPDF is ~400 KB
// and write-excel-file ~70 KB; nobody opening a recipe should pay for them. `recipeExport.spec.ts` scans
// app/src and fails on a static import of either (and the build puts each in a chunk of its own).
// ⚠️ A LOAD THAT FAILS IS WRAPPED WITH libraryError(): offline before the chunk was ever fetched is told apart
// from a bug in the build (`exportErrorKey`). There is no service worker yet (step 5), so the first export
// needs a connection.

import {
  exportRow, exportTitle, libraryError, pdfLayout, pdfMeasurer, pdfSafe, rowTextOf, xlsxSheet, XLSX_FONT,
} from '@mise/shared/recipe-export';
import type { ExportModel } from '@mise/shared/recipe-export';

async function loadLibrary<T>(importer: () => Promise<T>): Promise<T> {
  try {
    return await importer();
  } catch (cause) {
    throw libraryError(cause);
  }
}

// -> Blob (application/pdf). One A4 page: the title, then «name ........ weight» per row.
export async function buildPdfBlob(model: ExportModel): Promise<Blob> {
  const { jsPDF } = await loadLibrary(() => import('jspdf'));
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: false });
  const title = pdfSafe(exportTitle(model));
  doc.setProperties({ title });
  const measure = pdfMeasurer(doc);
  const { items } = pdfLayout({
    title,
    rows: model.rows.map(row => ({ name: pdfSafe(exportRow(row).name), text: pdfSafe(rowTextOf(row)) })),
  }, measure);
  for (const item of items) {
    doc.setFont('helvetica', item.bold ? 'bold' : 'normal');
    doc.setFontSize(item.size);
    doc.text(item.text, item.x, item.y);
  }
  return doc.output('blob');
}

// -> Blob (.xlsx). `totalLabel` is the venue's own «Total» word, passed by the caller.
export async function buildXlsxBlob(model: ExportModel, totalLabel: string, sheetFallback: string = 'Recipe'): Promise<Blob> {
  const { default: writeXlsxFile } = await loadLibrary(() => import('write-excel-file/browser'));
  const { data, options } = xlsxSheet({
    title: exportTitle(model), name: model.name, rows: model.rows, totalLabel, sheetFallback, totalG: model.totalG,
  });
  // The sheet description is plain data in write-excel-file's own shape (the pure half cannot import its types).
  return writeXlsxFile(data as never, options as never, XLSX_FONT).toBlob();
}
