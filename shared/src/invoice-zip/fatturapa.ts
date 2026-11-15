// fatturapa.ts — reads FatturaPA e-invoices (a tree of already-read XML files) into plain objects.
// A port of invoice-import/fatturapa.py. Nothing here touches the disk, the network or the DOM: the XML
// parser is INJECTED by the caller (`parseXml(text) -> tree`), where a tree node is
//   { name /* local name, namespaces stripped */, children: [node…], text /* text before the first child */ }
// In the browser the caller passes `text => domToTree(new DOMParser().parseFromString(text, 'text/xml'))`;
// the tests pass their own small strict parser (testing/xml-tree.ts).
//
// FULL port of js/orders/invoice-zip/fatturapa.js: same exported names, same values, same behaviour input for
// input. Typing only differs. `domToTree` takes its document structurally (`XmlDocumentLike`, only what it
// reads), because shared/ has no DOM types; a real DOMParser result is assignable to it. parity.spec.ts compares
// the exports.

import { sha256Hex } from './sha256';
import { escapeRegex, pyFloat } from './py-compat';
import { SKIPPED } from './reasons';

// shared/ declares no DOM types (tsconfig `lib` is ES2022 only), and TextDecoder is a platform global in the
// browser and in Node alike: this declares just the use made of it here, emits nothing and changes no behaviour.
declare const TextDecoder: new (label?: string, options?: { fatal?: boolean }) => { decode(input?: Uint8Array): string };

// Document types the import understands: TD01 an ordinary invoice, TD24 and TD25 DEFERRED
// invoices (fattura differita: the goods were delivered on the delivery notes of the month
// and invoiced together afterwards, which is how most suppliers of a bakery bill). They are
// kept ON PURPOSE. Anything else (a TD04 credit note, say) is listed as excluded, never
// silently dropped.
export const KEPT_TYPES = ['TD01', 'TD24', 'TD25'];

// An import file's line number is at most 999999 (the app's rule). A second invoice inside
// one file gets the numbers of its lines pushed up by LINE_BLOCK per body, so a price point's
// id stays unique and the invoice id stays the file's own SDI id (digits only).
export const LINE_BLOCK = 100_000;
export const MAX_BODIES = 9;

// `<base>_MT_001.xml` (SDI metadata) and `<base>_PAD_MT_001.xml` (PEC reception date).
export const METADATA_RE = /^(.+?)(_PAD)?_MT_\d+\.xml$/i;

// An e-invoice is a few hundred KB. A file far bigger than that is not one.
export const MAX_XML_BYTES = 30_000_000;

// ── the tree ─────────────────────────────────────────────────────────────────

// One element: its local name, its children, and the text before the first child.
export interface TreeNode { name: string; children: TreeNode[]; text: string }

// text -> tree. Throws for anything it cannot read.
export type ParseXml = (source: string) => TreeNode;

// What `domToTree` reads of a DOM node / document. A browser's Document and Element satisfy these.
export interface DomNodeLike {
  nodeType: number;
  nodeValue?: string | null;
  localName?: string;
  childNodes?: Iterable<DomNodeLike>;
}
export interface XmlDocumentLike {
  documentElement?: DomNodeLike | null;
  getElementsByTagName?: (name: string) => { length: number };
}

// Browser side: a DOMParser result -> plain tree. Reads only the node it is given, local names only.
// DOMParser does not throw on malformed XML, it returns a <parsererror> document: that is refused here.
export function domToTree(document: XmlDocumentLike | null | undefined): TreeNode {
  const root = document && document.documentElement;
  if (!root) throw new Error('empty XML document');
  if (root.localName === 'parsererror' || (document.getElementsByTagName
    && document.getElementsByTagName('parsererror').length > 0)) {
    throw new Error('invalid XML');
  }
  const convert = (el: DomNodeLike): TreeNode => {
    let text = '';
    let sawElement = false;
    const children: TreeNode[] = [];
    // The cast is typing only: an element without child nodes throws here, as in the original.
    for (const node of el.childNodes as Iterable<DomNodeLike>) {
      if (node.nodeType === 1) {
        sawElement = true;
        children.push(convert(node));
      } else if (!sawElement && (node.nodeType === 3 || node.nodeType === 4)) {
        text += node.nodeValue;
      }
    }
    return { name: el.localName as string, children, text };
  };
  return convert(root);
}

// ElementTree-style paths over a tree: «A/B» (direct children, in order) or «.//A» (any descendant).
function findAll(node: TreeNode | null | undefined, path: string): TreeNode[] {
  if (!node) return [];
  if (path.startsWith('.//')) {
    const name = path.slice(3);
    const out: TreeNode[] = [];
    const walk = (n: TreeNode): void => {
      for (const child of n.children) {
        if (child.name === name) out.push(child);
        walk(child);
      }
    };
    walk(node);
    return out;
  }
  let current = [node];
  for (const step of path.split('/')) {
    current = current.flatMap((n) => n.children.filter((child) => child.name === step));
  }
  return current;
}

const find = (node: TreeNode | null | undefined, path: string): TreeNode | null => findAll(node, path)[0] || null;

// The text of the first element at `path`, trimmed; '' when there is none.
export function text(node: TreeNode | null | undefined, path: string): string {
  const el = find(node, path);
  return el && el.text ? el.text.trim() : '';
}

// float(s.replace(",", ".")) or null
export function number(s?: unknown): number | null {
  return pyFloat(String(s ?? '').replace(',', '.'));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// YYYY-MM-DD from an ISO date (with or without time/zone) or an e-mail date («Mon, 01 Sep 2026 …»).
export function isoDate(s?: unknown): string {
  const value = String(s || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return iso[0];
  const mail = /^(?:[A-Za-z]+,?\s+)?(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{2,4})(?!\d)/.exec(value);
  if (!mail) return '';
  // The casts are typing only: every group of this pattern takes part in a match.
  const month = MONTHS.indexOf((mail[2] as string).slice(0, 3).toLowerCase());
  if (month < 0) return '';
  let year = Number(mail[3]);
  if ((mail[3] as string).length <= 2) year += year > 68 ? 1900 : 2000;
  const day = Number(mail[1]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normaliseVat(country: unknown, code: unknown): string {
  return `${String(country)}${String(code)}`.replace(/\s+/g, '').toUpperCase();
}

// Key of a supplier without a VAT number: «NOVAT:» + the first 12 hex characters of a SHA-256 of
// salt + the tax code (or, with no tax code, the name). ⚠️ Only a SALTED hash of the tax code leaves
// this function: the tax code of a sole trader is personal data, and a tax code has so little entropy that
// an unsalted hash could be reversed by trying every possibility.
export function noVatKey(taxCode: unknown, fallbackName: unknown, salt = ''): string {
  const basis = String(taxCode || '').replace(/\s+/g, '').toUpperCase()
    || String(fallbackName || '').replace(/\s+/g, ' ').trim().toUpperCase();
  return `NOVAT:${sha256Hex(salt + basis).slice(0, 12)}`;
}

// The key a supplier without a VAT number is known by: (tax code, name) -> key.
export type NoVatKeyOf = (taxCode: string, fallbackName: string) => string;

function supplierOf(root: TreeNode, noVatKeyOf: NoVatKeyOf): { key: string; name: string; vat: string; taxCode: string } {
  const anag = find(root, 'FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici');
  let name = text(anag, 'Anagrafica/Denominazione')
    || [text(anag, 'Anagrafica/Nome'), text(anag, 'Anagrafica/Cognome')].filter(Boolean).join(' ');
  name = name.replace(/\s+/g, ' ').trim();
  const vat = normaliseVat(text(anag, 'IdFiscaleIVA/IdPaese'), text(anag, 'IdFiscaleIVA/IdCodice'));
  const taxCode = text(anag, 'CodiceFiscale');
  if (vat) return { key: vat, name, vat, taxCode };
  return { key: noVatKeyOf(taxCode, name), name, vat: '', taxCode };
}

// The BUYER's VAT number (CessionarioCommittente), normalised like the seller's; '' when the invoice states none
// (a private buyer is known by tax code only, which is never read here).
function buyerVatOf(root: TreeNode): string {
  const anag = find(root, 'FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici');
  return anag ? normaliseVat(text(anag, 'IdFiscaleIVA/IdPaese'), text(anag, 'IdFiscaleIVA/IdCodice')) : '';
}

// One line of an invoice, as read.
export interface InvoiceLine {
  number: number;
  articleCode: string;
  description: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  total: number | null;
  vatRate: number | null;
  natura: string;
  hasDiscount: boolean;
}

function linesOf(body: TreeNode, offset = 0): InvoiceLine[] {
  return findAll(body, 'DatiBeniServizi/DettaglioLinee').map((el, index) => {
    const quantity = number(text(el, 'Quantita'));
    const unitPrice = number(text(el, 'PrezzoUnitario'));
    let total = number(text(el, 'PrezzoTotale'));
    if (total === null && quantity !== null && unitPrice !== null) total = quantity * unitPrice;
    return {
      number: offset + Math.trunc(number(text(el, 'NumeroLinea')) || index + 1),
      articleCode: text(el, 'CodiceArticolo/CodiceValore'),
      description: text(el, 'Descrizione').replace(/\s+/g, ' ').trim(),
      quantity,
      unit: text(el, 'UnitaMisura'),
      unitPrice,
      total,
      vatRate: number(text(el, 'AliquotaIVA')),
      natura: text(el, 'Natura'),
      hasDiscount: find(el, 'ScontoMaggiorazione') !== null,
    };
  });
}

const PERSONAL_TAX_CODE_RE = /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/gi;

// A file name as it may be shown: anything shaped like a personal tax code is blanked.
// EVERY file name that is printed or listed goes through here — the SDI names a file
// `IT<tax code>_<number>.xml`, and for a sole trader that is a person's tax code.
export function redactFileName(name: unknown): string {
  return String(name).replace(PERSONAL_TAX_CODE_RE, '***');
}

// The SDI names a file `IT<tax code>_<number>.xml`: for a sole trader that is a
// person's tax code, personal data that must not reach the output. Blank the
// supplier's own tax code, and anything shaped like a personal one, whatever the VAT.
function redact(name: unknown, taxCode: string): string {
  let out = String(name);
  if (taxCode) out = out.replace(new RegExp(escapeRegex(taxCode), 'giu'), '***');
  return redactFileName(out);
}

// One invoice (one body of a FatturaElettronica), as read.
export interface InvoiceDocument {
  file: string;
  docId: string;
  supplierKey: string;
  supplierName: string;
  vatNumber: string;
  buyerVat: string;
  docType: string;
  date: string;
  number: string;
  total: number | null;
  sdiId: string;
  receptionDate: string;
  lines: InvoiceLine[];
}

// One FatturaElettronica tree -> one document per body.
// `doc.docId` is an id for THIS program only (dedupe, status): the SDI id, or the file's base name when
// there is none, plus «-2», «-3» for further invoices in one file. It is never written to the import file:
// a document with no SDI id is excluded, and the price points carry `sdiId`.
export function parseInvoice(root: TreeNode, base: unknown, sdiId: string, reception: unknown,
  noVatKeyOf: NoVatKeyOf): InvoiceDocument[] {
  const { key, name, vat, taxCode } = supplierOf(root, noVatKeyOf);
  const shown = redact(base, taxCode);
  const buyerVat = buyerVatOf(root);
  return findAll(root, 'FatturaElettronicaBody').map((body, i) => {
    const general = find(body, 'DatiGenerali/DatiGeneraliDocumento');
    let docId = sdiId || shown;
    if (i) docId = `${docId}-${i + 1}`;
    return {
      file: shown, // shown to the owner; a sole trader's tax code is blanked out of it
      docId,
      supplierKey: key,
      supplierName: name,
      vatNumber: vat,
      buyerVat,
      docType: text(general, 'TipoDocumento').toUpperCase(),
      date: isoDate(text(general, 'Data')),
      number: text(general, 'Numero'),
      total: number(text(general, 'ImportoTotaleDocumento')),
      sdiId,
      receptionDate: isoDate(reception),
      lines: linesOf(body, i * LINE_BLOCK),
    };
  });
}

// ── reading the bytes ────────────────────────────────────────────────────────

const DTD_RE = /<!\s*(DOCTYPE|ENTITY)/i;

// Bytes -> text: a BOM is honoured and dropped; an encoding declared in the XML header is used when the
// platform knows it (an old Latin-1 invoice), UTF-8 otherwise.
export function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 200));
  const declared = /^﻿?\s*<\?xml[^>]*\sencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (declared && !hasBom && !/^utf-?8$/i.test(declared[1] as string)) {
    try {
      return new TextDecoder(declared[1]).decode(bytes);
    } catch {
      // an encoding this platform does not know: read it as UTF-8, like the rest
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

// bytes -> tree. Throws an Error for anything not parseable, too big, or carrying a DTD.
export function parseXmlBytes(bytes: Uint8Array, parseXml: ParseXml): TreeNode {
  if (bytes.length > MAX_XML_BYTES) throw new Error(SKIPPED.FILE_TOO_LARGE);
  const source = decodeXml(bytes).replace(/^\s+/, '');
  // A parser may expand entities, so a crafted DOCTYPE could eat all the memory ("billion laughs").
  // A FatturaPA never has a DTD: refuse any that does.
  if (DTD_RE.test(source)) throw new Error(SKIPPED.DTD_NOT_ALLOWED);
  return parseXml(source);
}

function readMetadata(entries: Record<string, Uint8Array>, parseXml: ParseXml): {
  sdi: Map<string, string>; reception: Map<string, string>;
} {
  const sdi = new Map<string, string>();
  const reception = new Map<string, string>();
  for (const [name, data] of Object.entries(entries)) {
    const m = METADATA_RE.exec(name);
    if (!m) continue;
    let root: TreeNode;
    try {
      root = parseXmlBytes(data, parseXml);
    } catch {
      continue;
    }
    const base = m[1] as string;
    const foundSdi = text(root, './/IdentificativoSdI') || text(root, 'IdentificativoSdI');
    const foundPec = text(root, './/PECEmailDate') || text(root, 'PECEmailDate');
    if (foundSdi && !sdi.has(base)) sdi.set(base, foundSdi);
    if (foundPec && !reception.has(base)) reception.set(base, foundPec);
  }
  return { sdi, reception };
}

// The VAT number every invoice of the zip was ISSUED TO most often: the owner's own (the zip is his purchases).
// ⚠️ ONLY A STRICT MAJORITY of the invoices that name a buyer counts: a zip of two venues (or a tie) says nothing
// about whose it is, and then nothing is skipped. '' when no invoice names a buyer.
export function ownerVatOf(documents: readonly { buyerVat: string }[]): string {
  const counts = new Map<string, number>();
  for (const doc of documents) {
    if (doc.buyerVat) counts.set(doc.buyerVat, (counts.get(doc.buyerVat) || 0) + 1);
  }
  const naming = [...counts.values()].reduce((sum, n) => sum + n, 0);
  for (const [vat, count] of counts) {
    if (count * 2 > naming) return vat;
  }
  return '';
}

// A file or an archive the reader left out, and why (reasons.ts SKIPPED).
export interface SkippedFile { name: string; reason: string; detail: string }

// What the zip reader hands over: the XML of every container (an archive, or all the loose files together).
export interface InvoiceRead {
  containers: { source?: string; entries: Record<string, Uint8Array> }[];
  p7mCount: number;
  skipped: SkippedFile[];
}

export interface LoadOptions {
  parseXml?: ParseXml;
  noVatKey?: NoVatKeyOf;
  salt?: string;
}

export interface LoadResult {
  documents: InvoiceDocument[];
  skipped: SkippedFile[];
  p7mCount: number;
  duplicates: number;
  otherXml: number;
  salesSkipped: number;
}

// `read` is what readInvoiceArchives() returns: { containers: [{ entries: { name: bytes } }], p7mCount, skipped }.
// options.parseXml (required), options.noVatKey(taxCode, fallbackName) -> key, options.salt (for the default key).
// -> { documents, skipped: [{ name, reason }], p7mCount, duplicates, otherXml, salesSkipped }
// ⚠️ A SALES INVOICE IS NOT A PRICE: an invoice whose SELLER is the owner (the VAT number most invoices of the zip
// were issued to) is the owner's own sale to somebody, so its lines are what he charges, never what he pays. It is
// dropped here and only counted (`salesSkipped`). With no owner to be found nothing is dropped.
export function loadInvoices(read: InvoiceRead, options: LoadOptions = {}): LoadResult {
  const { parseXml } = options;
  if (typeof parseXml !== 'function') throw new Error('loadInvoices needs options.parseXml');
  const salt = options.salt || '';
  const noVatKeyOf: NoVatKeyOf = options.noVatKey
    || ((taxCode, fallbackName) => noVatKey(taxCode, fallbackName, salt));
  const result: LoadResult = {
    documents: [],
    skipped: [...read.skipped],
    p7mCount: read.p7mCount,
    duplicates: 0,
    otherXml: 0,
    salesSkipped: 0,
  };

  const seen = new Set<string>();
  for (const { entries } of read.containers) {
    const { sdi: sdiIds, reception: receptions } = readMetadata(entries, parseXml);
    for (const name of Object.keys(entries).sort()) {
      if (METADATA_RE.test(name)) continue;
      const base = name.slice(0, -4);
      let root: TreeNode;
      try {
        root = parseXmlBytes(entries[name] as Uint8Array, parseXml);
      } catch (error) {
        const message = error && (error as { message?: unknown }).message;
        const known = message === SKIPPED.FILE_TOO_LARGE || message === SKIPPED.DTD_NOT_ALLOWED;
        result.skipped.push({
          name: redactFileName(name),
          reason: known ? message as string : SKIPPED.XML_UNREADABLE,
          detail: known ? '' : String(message || ''),
        });
        continue;
      }
      if (root.name !== 'FatturaElettronica') {
        result.otherXml += 1;
        continue;
      }
      if (findAll(root, 'FatturaElettronicaBody').length > MAX_BODIES) {
        result.skipped.push({
          name: redactFileName(name), reason: SKIPPED.TOO_MANY_INVOICES_IN_FILE, detail: String(MAX_BODIES),
        });
        continue;
      }
      for (const doc of parseInvoice(root, base, sdiIds.get(base) || '', receptions.get(base) || '', noVatKeyOf)) {
        // The same invoice is in several archives; the SDI id is what tells.
        if (seen.has(doc.docId)) {
          result.duplicates += 1;
          continue;
        }
        seen.add(doc.docId);
        result.documents.push(doc);
      }
    }
  }
  const owner = ownerVatOf(result.documents);
  if (owner) {
    const kept = result.documents.filter((doc) => doc.vatNumber !== owner);
    result.salesSkipped = result.documents.length - kept.length;
    result.documents = kept;
  }
  return result;
}
