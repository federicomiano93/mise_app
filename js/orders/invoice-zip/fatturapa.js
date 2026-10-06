// fatturapa.js — reads FatturaPA e-invoices (a tree of already-read XML files) into plain objects.
// A port of invoice-import/fatturapa.py. Nothing here touches the disk, the network or the DOM: the XML
// parser is INJECTED by the caller (`parseXml(text) -> tree`), where a tree node is
//   { name /* local name, namespaces stripped */, children: [node…], text /* text before the first child */ }
// In the browser the caller passes `text => domToTree(new DOMParser().parseFromString(text, 'text/xml'))`;
// the tests pass their own small strict parser (tests/helpers/xml-tree.mjs).

import { sha256Hex } from './sha256.js';
import { escapeRegex, pyFloat } from './py-compat.js';
import { SKIPPED } from './reasons.js';

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

// Browser side: a DOMParser result -> plain tree. Reads only the node it is given, local names only.
// DOMParser does not throw on malformed XML, it returns a <parsererror> document: that is refused here.
export function domToTree(document) {
  const root = document && document.documentElement;
  if (!root) throw new Error('empty XML document');
  if (root.localName === 'parsererror' || (document.getElementsByTagName
    && document.getElementsByTagName('parsererror').length > 0)) {
    throw new Error('invalid XML');
  }
  const convert = (el) => {
    let text = '';
    let sawElement = false;
    const children = [];
    for (const node of el.childNodes) {
      if (node.nodeType === 1) {
        sawElement = true;
        children.push(convert(node));
      } else if (!sawElement && (node.nodeType === 3 || node.nodeType === 4)) {
        text += node.nodeValue;
      }
    }
    return { name: el.localName, children, text };
  };
  return convert(root);
}

// ElementTree-style paths over a tree: «A/B» (direct children, in order) or «.//A» (any descendant).
function findAll(node, path) {
  if (!node) return [];
  if (path.startsWith('.//')) {
    const name = path.slice(3);
    const out = [];
    const walk = (n) => {
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

const find = (node, path) => findAll(node, path)[0] || null;

// The text of the first element at `path`, trimmed; '' when there is none.
export function text(node, path) {
  const el = find(node, path);
  return el && el.text ? el.text.trim() : '';
}

// float(s.replace(",", ".")) or null
export function number(s) {
  return pyFloat(String(s ?? '').replace(',', '.'));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// YYYY-MM-DD from an ISO date (with or without time/zone) or an e-mail date («Mon, 01 Sep 2026 …»).
export function isoDate(s) {
  const value = String(s || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return iso[0];
  const mail = /^(?:[A-Za-z]+,?\s+)?(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{2,4})(?!\d)/.exec(value);
  if (!mail) return '';
  const month = MONTHS.indexOf(mail[2].slice(0, 3).toLowerCase());
  if (month < 0) return '';
  let year = Number(mail[3]);
  if (mail[3].length <= 2) year += year > 68 ? 1900 : 2000;
  const day = Number(mail[1]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normaliseVat(country, code) {
  return `${country}${code}`.replace(/\s+/g, '').toUpperCase();
}

// Key of a supplier without a VAT number: «NOVAT:» + the first 12 hex characters of a SHA-256 of
// salt + the tax code (or, with no tax code, the name). ⚠️ Only a SALTED hash of the tax code leaves
// this function: the tax code of a sole trader is personal data, and a tax code has so little entropy that
// an unsalted hash could be reversed by trying every possibility.
export function noVatKey(taxCode, fallbackName, salt = '') {
  const basis = String(taxCode || '').replace(/\s+/g, '').toUpperCase()
    || String(fallbackName || '').replace(/\s+/g, ' ').trim().toUpperCase();
  return `NOVAT:${sha256Hex(salt + basis).slice(0, 12)}`;
}

function supplierOf(root, noVatKeyOf) {
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
function buyerVatOf(root) {
  const anag = find(root, 'FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici');
  return anag ? normaliseVat(text(anag, 'IdFiscaleIVA/IdPaese'), text(anag, 'IdFiscaleIVA/IdCodice')) : '';
}

function linesOf(body, offset = 0) {
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
export function redactFileName(name) {
  return String(name).replace(PERSONAL_TAX_CODE_RE, '***');
}

// The SDI names a file `IT<tax code>_<number>.xml`: for a sole trader that is a
// person's tax code, personal data that must not reach the output. Blank the
// supplier's own tax code, and anything shaped like a personal one, whatever the VAT.
function redact(name, taxCode) {
  let out = String(name);
  if (taxCode) out = out.replace(new RegExp(escapeRegex(taxCode), 'giu'), '***');
  return redactFileName(out);
}

// One FatturaElettronica tree -> one document per body.
// `doc.docId` is an id for THIS program only (dedupe, status): the SDI id, or the file's base name when
// there is none, plus «-2», «-3» for further invoices in one file. It is never written to the import file:
// a document with no SDI id is excluded, and the price points carry `sdiId`.
export function parseInvoice(root, base, sdiId, reception, noVatKeyOf) {
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
export function decodeXml(bytes) {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 200));
  const declared = /^﻿?\s*<\?xml[^>]*\sencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (declared && !hasBom && !/^utf-?8$/i.test(declared[1])) {
    try {
      return new TextDecoder(declared[1]).decode(bytes);
    } catch {
      // an encoding this platform does not know: read it as UTF-8, like the rest
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

// bytes -> tree. Throws an Error for anything not parseable, too big, or carrying a DTD.
export function parseXmlBytes(bytes, parseXml) {
  if (bytes.length > MAX_XML_BYTES) throw new Error(SKIPPED.FILE_TOO_LARGE);
  const source = decodeXml(bytes).replace(/^\s+/, '');
  // A parser may expand entities, so a crafted DOCTYPE could eat all the memory ("billion laughs").
  // A FatturaPA never has a DTD: refuse any that does.
  if (DTD_RE.test(source)) throw new Error(SKIPPED.DTD_NOT_ALLOWED);
  return parseXml(source);
}

function readMetadata(entries, parseXml) {
  const sdi = new Map();
  const reception = new Map();
  for (const [name, data] of Object.entries(entries)) {
    const m = METADATA_RE.exec(name);
    if (!m) continue;
    let root;
    try {
      root = parseXmlBytes(data, parseXml);
    } catch {
      continue;
    }
    const base = m[1];
    const foundSdi = text(root, './/IdentificativoSdI') || text(root, 'IdentificativoSdI');
    const foundPec = text(root, './/PECEmailDate') || text(root, 'PECEmailDate');
    if (foundSdi && !sdi.has(base)) sdi.set(base, foundSdi);
    if (foundPec && !reception.has(base)) reception.set(base, foundPec);
  }
  return { sdi, reception };
}

// The VAT number every invoice of the zip was ISSUED TO most often: the owner's own (the zip is his purchases).
// '' when no invoice names a buyer, or when two numbers tie (nothing can then be said about whose zip it is).
export function ownerVatOf(documents) {
  const counts = new Map();
  for (const doc of documents) {
    if (doc.buyerVat) counts.set(doc.buyerVat, (counts.get(doc.buyerVat) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  let tie = false;
  for (const [vat, count] of counts) {
    if (count > bestCount) { best = vat; bestCount = count; tie = false; } else if (count === bestCount) tie = true;
  }
  return tie ? '' : best;
}

// `read` is what readInvoiceArchives() returns: { containers: [{ entries: { name: bytes } }], p7mCount, skipped }.
// options.parseXml (required), options.noVatKey(taxCode, fallbackName) -> key, options.salt (for the default key).
// -> { documents, skipped: [{ name, reason }], p7mCount, duplicates, otherXml, salesSkipped }
// ⚠️ A SALES INVOICE IS NOT A PRICE: an invoice whose SELLER is the owner (the VAT number most invoices of the zip
// were issued to) is the owner's own sale to somebody, so its lines are what he charges, never what he pays. It is
// dropped here and only counted (`salesSkipped`). With no owner to be found nothing is dropped.
export function loadInvoices(read, options = {}) {
  const { parseXml } = options;
  if (typeof parseXml !== 'function') throw new Error('loadInvoices needs options.parseXml');
  const salt = options.salt || '';
  const noVatKeyOf = options.noVatKey || ((taxCode, fallbackName) => noVatKey(taxCode, fallbackName, salt));
  const result = {
    documents: [],
    skipped: [...read.skipped],
    p7mCount: read.p7mCount,
    duplicates: 0,
    otherXml: 0,
    salesSkipped: 0,
  };

  const seen = new Set();
  for (const { entries } of read.containers) {
    const { sdi: sdiIds, reception: receptions } = readMetadata(entries, parseXml);
    for (const name of Object.keys(entries).sort()) {
      if (METADATA_RE.test(name)) continue;
      const base = name.slice(0, -4);
      let root;
      try {
        root = parseXmlBytes(entries[name], parseXml);
      } catch (error) {
        const message = error && error.message;
        const known = message === SKIPPED.FILE_TOO_LARGE || message === SKIPPED.DTD_NOT_ALLOWED;
        result.skipped.push({
          name: redactFileName(name),
          reason: known ? message : SKIPPED.XML_UNREADABLE,
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
