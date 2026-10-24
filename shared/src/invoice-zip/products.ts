// products.ts — groups invoice lines into products and works out what to propose for each.
// A port of invoice-import/products.py (without the config file and the workbook cells' file I/O).
// A product is one supplier's article: the key is the supplier plus the article code, or the normalised
// description when the invoice gives no code (see classify.ts). Pure.
//
// FULL port of js/orders/invoice-zip/products.js: same exported names, same values, same behaviour input for
// input. Typing only differs. parity.spec.ts compares the exports.

import {
  classify, cleanName, eggsPerPack, isEgg, isUnattributedDiscount, packInfo, packWord, parsePack, parsePackText,
  productKey,
} from './classify';
import type { LineType, PackInfo } from './classify';
import { KEPT_TYPES } from './fatturapa';
import type { InvoiceDocument, InvoiceLine, LoadResult } from './fatturapa';
import {
  PACK_UNITS, PIECES, computeDocument, params as makeParams, roundHalfUp, unitClass, unitWeightKg, worse,
} from './pricing';
import type { ComputedPrice, PricingPack, PricingParams } from './pricing';
import { DOCUMENT_STATUS, EXCLUDED, NOTE } from './reasons';

export const DEFAULT_EGG_WEIGHT_G = 50.0;
export const NO_SDI_REASON = EXCLUDED.NO_SDI_ID;
const VAT_RATES = [0, 4, 5, 10, 20, 22];
export const TYPE_ORDER: Record<LineType, number> = { ingrediente: 0, packaging: 1, rivendita: 2 };
export const EGG_PACK_WORD = 'uovo';

// What the import is configured with.
export interface ProductConfig {
  eggWeightG: number;
  excludedSuppliers: Record<string, string>;
}

// options: { eggWeightG (default 50), excludedSuppliers: { 'IT00000000099': 'reason' } }
// The values are `unknown` on purpose: whatever the caller holds is cleaned here (a text for the weight is refused).
export interface ConfigOptions {
  eggWeightG?: unknown;
  excludedSuppliers?: Record<string, unknown> | null;
}

export function makeConfig(options: ConfigOptions = {}): ProductConfig {
  const egg = options.eggWeightG;
  const excluded: Record<string, string> = {};
  for (const [key, reason] of Object.entries(options.excludedSuppliers || {})) {
    excluded[String(key).replace(/\s+/g, '').toUpperCase()] = String(reason);
  }
  return {
    eggWeightG: typeof egg === 'number' && Number.isFinite(egg) && egg > 0 ? egg : DEFAULT_EGG_WEIGHT_G,
    excludedSuppliers: excluded,
  };
}

// The docs are sorted by (date, docId): ascending, so the last spelling of a supplier seen is the latest.
const docOrder = (a: InvoiceDocument, b: InvoiceDocument): number => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.docId !== b.docId) return a.docId < b.docId ? -1 : 1;
  return 0;
};

// What the catalogue says of one supplier.
export interface CatalogueSupplier { key: string; name: string; vatNumber: string }

// One entry of a product: one invoice's lines of it, and what the line was taken for.
export interface ProductEntry { doc: InvoiceDocument; lines: InvoiceLine[]; type: LineType }

// A product: one supplier's article. `entries` run oldest first.
export interface Product { key: string; supplierKey: string; code: string; entries: ProductEntry[] }

// Whether a document is in, and if not why.
export interface DocStatus { status: string; reason: string; detail: string }

// A document or a line that is left out, and why.
export interface ExcludedRow {
  level: 'document' | 'line';
  supplier: string;
  vatNumber: string;
  number: string;
  date: string;
  line: number | null;
  description: string;
  reason: string;
  detail: string;
  file: string;
}

export interface Catalogue {
  documents: InvoiceDocument[];
  docStatus: Map<string, DocStatus>;
  suppliers: Map<string, CatalogueSupplier>;
  products: Map<string, Product>;
  excluded: ExcludedRow[];
  discountDocs: Set<string>;
  config: ProductConfig;
  load: LoadResult;
}

// load: what loadInvoices() returned. -> the catalogue.
// A product: { key, supplierKey, code, entries: [{ doc, lines, type }] } (entries oldest first).
export function buildCatalogue(load: LoadResult, config: ProductConfig): Catalogue {
  const documents = [...load.documents].sort(docOrder);
  const suppliers = new Map<string, CatalogueSupplier>();
  const products = new Map<string, Product>();
  const excluded: ExcludedRow[] = [];
  const docStatus = new Map<string, DocStatus>();
  const discountDocs = new Set<string>();

  for (const doc of documents) {
    suppliers.set(doc.supplierKey, { key: doc.supplierKey, name: doc.supplierName, vatNumber: doc.vatNumber });

    const docRow = (reason: string, detail = ''): void => {
      docStatus.set(doc.docId, { status: DOCUMENT_STATUS.EXCLUDED, reason, detail });
      excluded.push({
        level: 'document', supplier: doc.supplierName, vatNumber: doc.vatNumber, number: doc.number,
        date: doc.date, line: null, description: '', reason, detail, file: doc.file,
      });
    };

    if (Object.prototype.hasOwnProperty.call(config.excludedSuppliers, doc.supplierKey)) {
      docRow(EXCLUDED.SUPPLIER_EXCLUDED, config.excludedSuppliers[doc.supplierKey]);
      continue;
    }
    if (!KEPT_TYPES.includes(doc.docType)) {
      docRow(EXCLUDED.DOCUMENT_TYPE, doc.docType || '?');
      continue;
    }
    // ⚠️ NO SDI ID, NO PRICE: the id of a price in Mise is the invoice's SDI id and its line. A file
    // name is not an identity (the same invoice downloaded twice is named differently), so a
    // document without one is listed and kept out, never given a made-up id.
    if (!doc.sdiId) {
      docRow(EXCLUDED.NO_SDI_ID);
      continue;
    }
    docStatus.set(doc.docId, { status: DOCUMENT_STATUS.INCLUDED, reason: '', detail: '' });

    const grouped = new Map<string, InvoiceLine[]>();
    const types = new Map<string, LineType>();
    for (const line of doc.lines) {
      const lineRow = (reason: string): void => {
        excluded.push({
          level: 'line', supplier: doc.supplierName, vatNumber: doc.vatNumber, number: doc.number, date: doc.date,
          line: line.number, description: line.description, reason, detail: '', file: doc.file,
        });
      };

      if (isUnattributedDiscount(line.description, line.quantity, line.total)) {
        discountDocs.add(doc.docId);
        lineRow(EXCLUDED.SEPARATE_DISCOUNT_LINE);
        continue;
      }
      const [kind, reason] = classify(line.description, line.quantity, line.total);
      if (kind === 'excluded') {
        lineRow(reason);
        continue;
      }
      const key = productKey(doc.supplierKey, line.articleCode, line.description);
      if (!grouped.has(key)) grouped.set(key, []);
      (grouped.get(key) as InvoiceLine[]).push(line);
      if (!types.has(key)) types.set(key, kind);
    }
    for (const [key, lines] of grouped) {
      if (!products.has(key)) {
        products.set(key, { key, supplierKey: doc.supplierKey, code: (lines[0] as InvoiceLine).articleCode.trim(), entries: [] });
      }
      (products.get(key) as Product).entries.push({ doc, lines, type: types.get(key) as LineType });
    }
  }
  return { documents, docStatus, suppliers, products, excluded, discountDocs, config, load };
}

export const latestOf = (product: Product): ProductEntry => product.entries[product.entries.length - 1] as ProductEntry;
export const typeOf = (product: Product): LineType => latestOf(product).type;
export const descriptionOf = (product: Product): string => (latestOf(product).lines[0] as InvoiceLine).description;

// ── proposals and evaluation ─────────────────────────────────────────────────

// Price unit and package, read from the most recent invoice's description.
export function proposeParams(product: Product, config: ProductConfig): PricingParams {
  const entry = latestOf(product);
  const eggWeight = config.eggWeightG / 1000;
  const first = entry.lines[0] as InvoiceLine;
  const cls = unitClass(first.unit)[0];
  if (cls === PIECES && entry.lines.some((ln) => isEgg(ln.description))) {
    let n: number | null = null;
    for (const ln of entry.lines) {
      const found = eggsPerPack(ln.description);
      if (found) { n = found; break; }
    }
    return makeParams({ priceUnit: 'pcs', packCount: n && n > 1 ? n : null, egg: true, eggWeightKg: eggWeight });
  }
  let info: PackInfo | null = null;
  for (const ln of entry.lines) {
    const found = parsePack(ln.description);
    if (found) { info = found; break; }
  }
  // The cast is typing only: an unknown pack unit throws here, as in the original.
  const packDim = info ? (PACK_UNITS[info.unit] as [string, number])[0] : null;
  let priceUnit: string | null;
  if (cls === PIECES) {
    priceUnit = packDim;
  } else {
    priceUnit = cls;
    if (packDim !== cls) info = null; // «LT 1» on a line invoiced in kg: not a package of this product
  }
  const pack: PricingPack | null = info ? packInfo(info.size, info.unit) : null;
  const packCount = info && info.count && info.count > 1 ? info.count : null;
  return makeParams({ priceUnit, pack, packCount, egg: false, eggWeightKg: eggWeight });
}

export function proposeName(product: Product): string {
  return cleanName(descriptionOf(product), product.code);
}

// Eggs bought by the tray are a carton of N eggs in Mise («Cartone, contiene 30 × uovo»):
// without a word the app would fall back to its default «busta», which reads as 30 bags.
export function proposePackWord(product: Product): string {
  const entry = latestOf(product);
  if (unitClass((entry.lines[0] as InvoiceLine).unit)[0] === PIECES && entry.lines.some((ln) => isEgg(ln.description))) {
    return EGG_PACK_WORD;
  }
  return packWord(descriptionOf(product));
}

// One price point of a product: one invoice's price, with how far it can be trusted.
export interface PricePoint {
  invoiceId: string;
  line: number;
  date: string;
  price: number;
  qty: number;
  vatRate: number | null | undefined;
  reliability: string;
  note: string;
}

export interface Evaluation {
  results: { entry: ProductEntry; computed: ComputedPrice }[];
  points: PricePoint[];
  reliability: string;
  note: string;
  unitWeightKg: number | null;
}

// products: the catalogue. problems: strings from paramsFromCells().
// -> { results: [{ entry, computed }], points, reliability, note, unitWeightKg }
// A point: { invoiceId, line, date, price (4 decimals), qty (3 decimals), vatRate }
export function evaluate(product: Product, p: PricingParams, catalogue: Catalogue,
  problems: readonly string[] | null = null): Evaluation {
  const results: Evaluation['results'] = [];
  const points: PricePoint[] = [];
  for (const entry of product.entries) {
    const computed = computeDocument(entry.lines, p, catalogue.discountDocs.has(entry.doc.docId));
    results.push({ entry, computed });
    if (computed.price !== null && computed.qty !== null) {
      points.push({
        invoiceId: entry.doc.sdiId,
        line: Math.min(...entry.lines.map((ln) => ln.number)),
        date: entry.doc.date,
        price: roundHalfUp(computed.price, 4),
        qty: roundHalfUp(computed.qty, 3),
        vatRate: computed.vatRate,
        // How far THIS invoice's price can be trusted: the import keeps the good points of a product whose
        // worst invoice is «da verificare» (selection.ts, build-import.ts).
        reliability: computed.reliability,
        note: computed.note,
      });
    }
  }
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  points.sort((a, b) => cmp(a.date, b.date) || cmp(a.invoiceId, b.invoiceId) || a.line - b.line);
  let worst = 'alta';
  let note = '';
  for (const { computed } of results) { // entries run oldest first, so a tie keeps the latest note
    if (worse(computed.reliability, worst) === computed.reliability) {
      worst = computed.reliability;
      note = computed.note;
    }
  }
  if (problems && problems.length) {
    worst = 'da verificare';
    note = problems.join('; ');
  }
  return {
    results, points, reliability: worst, note, unitWeightKg: p.priceUnit === 'pcs' ? unitWeightKg(p) : null,
  };
}

// The line's rate if it is one Mise knows, else null («not stated», never 0).
export function vatOf(value?: number | null): number | null {
  if (value === null || value === undefined) return null;
  return Number.isInteger(value) && VAT_RATES.includes(value) ? value : null;
}

// ── the workbook's cells, read back into params ──────────────────────────────

const PRICE_UNIT_WORDS: Record<string, string> = {
  kg: 'kg', l: 'l', lt: 'l', litri: 'l', litro: 'l', pz: 'pcs', pcs: 'pcs', pezzi: 'pcs', pezzo: 'pcs',
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// Cells (unit, weight, count) -> params, plus anything in them that could not be read.
// The app has no workbook, but the import is defined as «every proposal accepted unchanged»; running the
// proposal through the same cell round trip keeps this port's result identical to the script's.
export function paramsFromCells(unitCell: unknown, weightCell: unknown, countCell: unknown,
  proposal: { egg: boolean; eggWeightKg: number }): { params: PricingParams; problems: string[] } {
  const problems: string[] = [];
  const unitText = cellText(unitCell).toLowerCase();
  let priceUnit: string | null = null;
  if (unitText) {
    priceUnit = Object.prototype.hasOwnProperty.call(PRICE_UNIT_WORDS, unitText) ? PRICE_UNIT_WORDS[unitText] as string : null;
    if (priceUnit === null) problems.push(NOTE.PRICE_UNIT_UNREADABLE);
  }
  let pack: PricingPack | null = null;
  const weightText = cellText(weightCell);
  if (weightText) {
    const parsed = parsePackText(weightText);
    if (parsed) pack = packInfo(parsed[0], parsed[1] as PackInfo['unit']);
    else problems.push(NOTE.PACK_WEIGHT_UNREADABLE);
  }
  let packCount: number | null = null;
  const countText = cellText(countCell);
  if (countText) {
    const value = Number(countText.replace(',', '.'));
    if (!/^[+-]?\d+(?:[.,]\d*)?$/.test(countText) || !Number.isInteger(value) || value < 1) {
      problems.push(NOTE.PACK_COUNT_UNREADABLE);
    } else {
      packCount = value > 1 ? value : null;
    }
  }
  return {
    params: makeParams({ priceUnit, pack, packCount, egg: proposal.egg, eggWeightKg: proposal.eggWeightKg }),
    problems,
  };
}

export const unitCell = (priceUnit: string | null): string => (priceUnit === 'pcs' ? 'pz' : priceUnit || '');
