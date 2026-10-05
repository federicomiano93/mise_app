// build-import.js — the invoices the owner picked -> the import file the «Import from invoices» screen reads
// (invoice-import/README.md, «The import file — the contract with the app»), built in memory.
// The Python script needed a workbook in the middle where the owner marked «importa» row by row; here every
// product proposed as an ingredient is taken with its proposals unchanged, and the rest is returned
// beside it (`products`) so a screen can show what was left out and why.
// Pure: no DOM, no Firebase, no clock (`options.now` is injected), no file names or tax codes in the output.

import { formatPackSize } from './classify.js';
import { loadInvoices } from './fatturapa.js';
import { roundHalfUp, PIECES, unitClass } from './pricing.js';
import {
  EGG_PACK_WORD, NO_SDI_REASON, TYPE_ORDER, buildCatalogue, descriptionOf, evaluate, latestOf, makeConfig,
  paramsFromCells, proposeName, proposePackWord, proposeParams, typeOf, unitCell, vatOf,
} from './products.js';
import { LEFT_OUT, NOTE } from './reasons.js';
import { readInvoiceArchives } from './zip-read.js';

export const IMPORT_FORMAT = 'mise-invoice-import';
export const IMPORT_VERSION = 1;
// Only ingredients are imported; packaging and resale are told apart so the owner sees what the program
// took each product for.
export const IMPORTED_TYPE = 'ingrediente';
export const NOT_IMPORTED_REASON = LEFT_OUT.NOT_AN_INGREDIENT;
export { NO_SDI_REASON };

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function generatedAt(now) {
  if (now === undefined || now === null) return '';
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// What one product looks like in the result and, when it can be imported, in the file.
// -> { row, ingredient } where `ingredient` is null when the product stays out (and row.leftOutReason says why).
function describeProduct(catalogue, product) {
  const supplier = catalogue.suppliers.get(product.supplierKey);
  const proposal = proposeParams(product, catalogue.config);
  const cells = {
    unit: unitCell(proposal.priceUnit),
    weight: proposal.pack ? formatPackSize(proposal.pack.size, proposal.pack.unit) : '',
    count: proposal.packCount || '',
  };
  const { params, problems } = paramsFromCells(cells.unit, cells.weight, cells.count, proposal);
  const evaluation = evaluate(product, params, catalogue, problems);
  const { points } = evaluation;
  const latestLine = latestOf(product).lines[0];
  const name = proposeName(product);
  const packUnit = proposePackWord(product);

  const row = {
    key: product.key,
    supplierKey: product.supplierKey,
    supplierName: supplier.name,
    vatNumber: supplier.vatNumber,
    type: typeOf(product),
    name,
    brand: '',
    category: '',
    supplierCode: product.code,
    description: descriptionOf(product),
    weight: params.pack ? formatPackSize(params.pack.size, params.pack.unit) : '',
    packUnit,
    packCount: params.packCount,
    priceUnit: params.priceUnit,
    unitWeightKg: params.priceUnit === 'pcs' && evaluation.unitWeightKg
      ? roundHalfUp(evaluation.unitWeightKg, 6) : null,
    vatRate: vatOf(latestLine.vatRate),
    reliability: evaluation.reliability,
    note: evaluation.note,
    prices: points.map((p) => ({
      invoiceId: p.invoiceId, line: p.line, invoiceDate: p.date, pricePerUnit: p.price, qty: p.qty,
    })),
    lastPrice: points.length ? points[points.length - 1].price : null,
    minPrice: points.length ? Math.min(...points.map((p) => p.price)) : null,
    maxPrice: points.length ? Math.max(...points.map((p) => p.price)) : null,
    purchases: product.entries.length,
    totalQty: points.length ? roundHalfUp(points.reduce((sum, p) => sum + p.qty, 0), 3) : null,
    lastDate: latestOf(product).doc.date,
    inImport: false,
    leftOutReason: '',
  };

  const leave = (reason) => {
    row.leftOutReason = reason;
    return { row, ingredient: null };
  };

  if (row.type !== IMPORTED_TYPE) return leave(NOT_IMPORTED_REASON);
  if (problems.length) return leave(problems.join('; '));
  const invoicedByPieces = unitClass(latestLine.unit)[0] === PIECES;
  if (params.priceUnit === null) {
    return leave(invoicedByPieces ? LEFT_OUT.PIECES_NEED_UNIT_AND_WEIGHT : NOTE.NO_PRICE_UNIT);
  }
  if (invoicedByPieces && (params.priceUnit === 'kg' || params.priceUnit === 'l') && params.pack === null) {
    return leave(LEFT_OUT.PIECES_NEED_PACK_WEIGHT);
  }
  if (!points.length) {
    const last = evaluation.results[evaluation.results.length - 1];
    return leave(last ? last.computed.note : LEFT_OUT.NO_COMPUTABLE_PRICE);
  }
  // A price nobody could vouch for is not offered for import: the screen shows it with its reason.
  if (evaluation.reliability === 'da verificare') return leave(evaluation.note || LEFT_OUT.NEEDS_CHECKING);

  row.inImport = true;
  return {
    row,
    ingredient: {
      key: product.key,
      supplierKey: product.supplierKey,
      mergeWith: '',
      name,
      brand: '',
      category: '',
      supplierCode: product.code,
      weight: row.weight,
      // An egg tray still needs the egg word, or the app names the 30 eggs «bags».
      packUnit: packUnit || (params.egg && params.packCount ? EGG_PACK_WORD : ''),
      packCount: params.packCount,
      priceUnit: params.priceUnit,
      unitWeightKg: row.unitWeightKg,
      vatRate: row.vatRate,
      prices: row.prices.map((p) => ({ ...p })),
    },
  };
}

const rowOrder = (catalogue) => (a, b) => (
  (TYPE_ORDER[a.type] - TYPE_ORDER[b.type])
  || cmp(a.supplierName.toLowerCase(), b.supplierName.toLowerCase())
  || cmp(a.name.toLowerCase(), b.name.toLowerCase())
  || cmp(a.key, b.key)
);

// files: [{ name, bytes: Uint8Array }] (a .zip, a loose .xml or .p7m).
// options: { parseXml (required: text -> tree), now (Date | ms | ISO text), salt, noVatKey(taxCode, name),
//            eggWeightG (default 50), excludedSuppliers, limits (tests only) }
// -> { importFile, products, excluded, skippedFiles, p7mCount, documents, duplicates, otherXml }
export function buildImportFromInvoices(files, options = {}) {
  const read = readInvoiceArchives(files, { limits: options.limits });
  const load = loadInvoices(read, options);
  const catalogue = buildCatalogue(load, makeConfig(options));

  const described = [...catalogue.products.values()].map((product) => describeProduct(catalogue, product));
  const products = described.map((d) => d.row).sort(rowOrder(catalogue));

  const ingredients = described.map((d) => d.ingredient).filter(Boolean).sort((a, b) => cmp(a.key, b.key));
  const used = [...new Set(ingredients.map((i) => i.supplierKey))].sort();
  const suppliers = used.map((key) => {
    const s = catalogue.suppliers.get(key);
    return { key, vatNumber: s.vatNumber, name: s.name };
  });

  const documents = catalogue.documents.map((doc) => ({
    docId: doc.docId,
    sdiId: doc.sdiId,
    file: doc.file,
    supplierKey: doc.supplierKey,
    supplierName: doc.supplierName,
    vatNumber: doc.vatNumber,
    docType: doc.docType,
    date: doc.date,
    number: doc.number,
    total: doc.total,
    ...(catalogue.docStatus.get(doc.docId) || { status: '', reason: '', detail: '' }),
    lines: doc.lines.length,
  }));

  return {
    importFile: {
      format: IMPORT_FORMAT,
      version: IMPORT_VERSION,
      generatedAt: generatedAt(options.now),
      suppliers,
      ingredients,
    },
    products,
    excluded: catalogue.excluded,
    skippedFiles: load.skipped,
    p7mCount: load.p7mCount,
    documents,
    duplicates: load.duplicates,
    otherXml: load.otherXml,
  };
}
