// build-import.js — the invoices the owner picked -> the import file the «Import from invoices» screen reads
// (invoice-import/README.md, «The import file — the contract with the app»), built in memory.
// The Python script needed a workbook in the middle where the owner marked «importa» row by row; here every
// product proposed as an ingredient is taken with its proposals unchanged, and the rest is returned
// beside it (`products`) so a screen can show what was left out and why.
// Pure: no DOM, no Firebase, no clock (`options.now` is injected), no file names or tax codes in the output.

import { formatPackSize, invoiceNameOf } from './classify.js';
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

const NEEDS_CHECK = 'da verificare';
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
      good: p.reliability !== NEEDS_CHECK,
      // How far this price can be trusted, and whether it was worked out from the pack weight written in the
      // invoice description: the app re-reads such a price with the weight the venue keeps (invoice-import-model.js).
      reliability: p.reliability,
      ...(p.note === NOTE.WEIGHT_FROM_DESCRIPTION ? { fromPack: true } : {}),
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

  // Why the product cannot be turned into an ingredient at all (null = it can, whatever its type).
  const invoicedByPieces = unitClass(latestLine.unit)[0] === PIECES;
  let unreadable = null;
  if (problems.length) unreadable = problems.join('; ');
  else if (params.priceUnit === null) {
    unreadable = invoicedByPieces ? LEFT_OUT.PIECES_NEED_UNIT_AND_WEIGHT : NOTE.NO_PRICE_UNIT;
  } else if (invoicedByPieces && (params.priceUnit === 'kg' || params.priceUnit === 'l') && params.pack === null) {
    unreadable = LEFT_OUT.PIECES_NEED_PACK_WEIGHT;
  } else if (!points.length) {
    const last = evaluation.results[evaluation.results.length - 1];
    unreadable = last ? last.computed.note : LEFT_OUT.NO_COMPUTABLE_PRICE;
  }
  row.canImport = unreadable === null;
  if (row.type !== IMPORTED_TYPE) row.leftOutReason = NOT_IMPORTED_REASON;
  else if (unreadable !== null) row.leftOutReason = unreadable;
  if (unreadable !== null) {
    row.unreadableReason = unreadable;
    return { row, ingredient: null };
  }

  // ⚠️ A PRICE NOBODY COULD VOUCH FOR IS NEVER IMPORTED, BUT THE PRODUCT IS: only the points of invoices that are
  // not «da verificare» go in. With none left the ingredient is still created (the recipes and the order list
  // need it), with no price, and `priceCheck` says why so the screen can ask for a look.
  const good = row.prices.filter((p) => p.good);
  // ⚠️ THE NEWEST INVOICE CANNOT BE VOUCHED FOR WHILE OLDER ONES CAN: the current price would then come from an
  // older invoice without anybody being told. The import file says so, and the app asks (planIngredients).
  const newest = evaluation.results[evaluation.results.length - 1];
  const latestUnverified = good.length > 0 && Boolean(newest) && newest.computed.reliability === NEEDS_CHECK;
  const checkReason = evaluation.reliability === NEEDS_CHECK ? (evaluation.note || LEFT_OUT.NEEDS_CHECKING) : '';
  const ingredient = {
    key: product.key,
    supplierKey: product.supplierKey,
    mergeWith: '',
    name,
    // The description of the NEWEST invoice, as the supplier wrote it (only the lot blocks removed).
    ...(invoiceNameOf(row.description) ? { invoiceName: invoiceNameOf(row.description) } : {}),
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
    prices: good.map(({ good: _good, ...p }) => p),
    ...(latestUnverified ? { latestUnverified: true } : {}),
    ...(checkReason && good.length === 0 ? { priceCheck: checkReason.split('; ')[0] } : {}),
  };
  row.inImport = row.type === IMPORTED_TYPE;
  return { row, ingredient };
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

  const candidates = described.map((d) => d.ingredient).filter(Boolean).sort((a, b) => cmp(a.key, b.key));
  const typeByKey = new Map(described.map((d) => [d.row.key, d.row.type]));
  const ingredients = candidates.filter((i) => typeByKey.get(i.key) === IMPORTED_TYPE);
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
    // Every product that COULD be imported, whatever it was taken for: what a person may still promote to an
    // ingredient (selection.js). importFile.ingredients is the subset proposed as ingredients.
    candidates,
    excluded: catalogue.excluded,
    skippedFiles: load.skipped,
    p7mCount: load.p7mCount,
    // Invoices the owner issued himself (he is the seller): dropped before any price is read (fatturapa.js).
    salesSkipped: load.salesSkipped || 0,
    documents,
    duplicates: load.duplicates,
    otherXml: load.otherXml,
  };
}
