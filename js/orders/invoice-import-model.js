// invoice-import-model.js — what «Import from invoices» would WRITE, decided without writing anything.
// PURE (P15): no Firebase, no DOM, so every rule below runs under node --test.
//
// The owner's computer turns the supplier e-invoices into one JSON file (invoice-import/README.md is the
// contract). The screen reads it, shows a dry run built from the functions below, and writes through the
// app with the signed-in user — the same rules as the forms. This module is the part in between: it
// reads the file defensively, matches it against what the venue already holds, and lists the writes.
//
// ⚠️ THE IMPORT NEVER WRITES allergens, mayContain, allergensCheckedAt, nutrition OR packIngredients.
// A new ingredient with no allergensCheckedAt is «nobody has said» (js/allergen-model.js), and that is
// the truth: an invoice line says nothing about what a product contains. Declaring it from here could
// send somebody to hospital.
//
// ⚠️ AN EXISTING SUPPLIER OR INGREDIENT IS NEVER OVERWRITTEN. The only field ever written onto one is
// the supplier's `vatNumber` (when linked) and the ingredient's article codes: `supplierCode` when it had
// none, else the file's code is added to `supplierCodes` (one ingredient, several packs — 5 Oct 2026), and its
// `invoiceName` (the description as on the invoice) when it had none — or a new one the person confirmed.
// Name, brand, category and weight stay as the owner typed them.
//
// ⚠️ A SECOND IMPORT OF THE SAME FILE WRITES NOTHING. Every price read from an invoice has the id
// `inv-<invoiceId>-<line>`; the rules refuse an update to the history, and this module drops the points
// whose id is already there, so a re-run plans no write at all.

import { splitWeight, joinWeight } from '../pack-size.js';
import { pricePatch, roundTo, packBaseOf, INGREDIENT_DRAINED_FIELDS, PRICE_UNITS } from '../price-model.js';
import { formatPatch, looseUnit } from '../pack-format.js';
import { cartonWordFor, defaultPackFor } from '../record-choices.js';
import { supplierLabel } from '../supplier-label.js';
import { normalizeVat } from '../vat-number.js';
import { sameUnitWeight } from './price-changes-model.js';
import { NOTE, LEFT_OUT } from './invoice-zip/reasons.js';

export const IMPORT_FORMAT = 'mise-invoice-import';
export const IMPORT_VERSION = 1;

// Production caps a batched write at 20 document accesses, and the price rules spend about 3 on each
// write (js/orders/category-batches.js). Five documents keeps a margin.
export const MAX_DOCS_PER_BATCH = 5;

// The caps the rules put on each text (firestore.rules), and a few of ours.
const MAX_NAME = 200;
// The rules' cap on an ingredient's `invoiceName` (the invoice description, lot blocks removed).
export const MAX_INVOICE_NAME = 1000;
export const MAX_SUPPLIER_CODE = 60;
// How many article codes (one per pack) an ingredient may remember besides its main one (the rules' cap).
export const MAX_SUPPLIER_CODES = 20;
// The rules' cap on a price point's `packLabel`.
export const MAX_PACK_LABEL = 120;
const MAX_WEIGHT = 100;
const MAX_PACK_UNIT = 40;
const MAX_VAT = 30;
const MAX_KEY = 400;
const PACK_COUNT_MAX = 10000;
// The same four decimals the card rounds a typed rate to (price-model.js RATE_DECIMALS) and six for a
// piece weight, so a point and the current price never disagree by rounding.
const RATE_DECIMALS = 4;
const PIECE_DECIMALS = 6;
const NO_VAT_PREFIX = 'NOVAT:';
// Why an ingredient comes with no price at all (invoice-zip/build-import.js): the reasons a price is «da verificare».
// A file made by the script never carries one, so an entry with no prices and none of these stays invalid.
export const PRICE_CHECK_CODES = Object.freeze([
  NOTE.EGG_QUANTITY_UNCLEAR, NOTE.PRICE_OUT_OF_SCALE, NOTE.UNATTRIBUTED_DISCOUNT, NOTE.MIXED_UNITS,
  NOTE.NO_WEIGHT_ON_INVOICE, NOTE.NO_PRICE_UNIT, NOTE.NO_PIECE_WEIGHT, NOTE.QUANTITY_ZERO_OR_NEGATIVE,
  NOTE.AMOUNT_ZERO_OR_NEGATIVE, NOTE.PRICE_UNIT_DIFFERS_FROM_INVOICE, NOTE.PRICE_UNIT_PACK_MISMATCH,
  NOTE.PRICE_UNIT_UNREADABLE, NOTE.PACK_WEIGHT_UNREADABLE, NOTE.PACK_COUNT_UNREADABLE, LEFT_OUT.NEEDS_CHECKING,
]);
const DEFAULT_LANGUAGE = 'it';

// ⚠️ A PRICE WORKED OUT FROM THE INVOICE DESCRIPTION («media») THAT MOVES THE CURRENT PRICE BY MORE THAN THIS
// SHARE (0.3 = ±30%) IS NEVER APPLIED SILENTLY: the row waits in «Price to check» for a person to confirm it.
export const AVERAGED_PRICE_JUMP_LIMIT = 0.3;
// The readings a price point may carry from the invoice reader (a «da verificare» price never reaches the file).
const TRUSTED_READINGS = ['alta', 'media'];
// The codes a row's `checkReason` takes, and what the screen asks for each.
export const CHECK_REASONS = Object.freeze({
  WEIGHT_UNREADABLE: 'weight-unreadable',
  PRICE_JUMP: 'price-jump',
  OLDER_INVOICE: 'older-invoice',
  WEIGHT_RESCALED: 'weight-rescaled',
  INVOICE_NAME_CHANGED: 'invoice-name-changed',
});

// ── Small helpers ───────────────────────────────────────────────────────────────

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A text as the rules want it: trimmed and cut to the cap. Anything that is not a string is ''.
function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max).trim();
}

const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

// A real calendar date, YYYY-MM-DD («2026-02-30» is not one).
function isRealDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// A Map, a plain object or nothing — whatever the caller built.
function lookup(source, id) {
  if (!source || id === undefined || id === null) return undefined;
  if (source instanceof Map) return source.get(id);
  return Object.prototype.hasOwnProperty.call(source, id) ? source[id] : undefined;
}

function hasKey(source, id) {
  if (!source) return false;
  if (source instanceof Map) return source.has(id);
  return Object.prototype.hasOwnProperty.call(source, id);
}

function asSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value : []);
}

// The VAT rate, through the one list the app accepts (price-model.js normalizedVatRate, not exported):
// 0/4/5/10/20/22, anything else — «not stated» — null, NEVER 0.
const vatRateOf = (value) => pricePatch({ priceUnit: 'kg', pricePerUnit: 1, vatRate: value }, '').vatRate;

// ── Normalising names and VAT numbers ────────────────────────────────────────────

// The canonical VAT number — js/vat-number.js, shared with the supplier card so a number typed without its
// «IT» still matches the one in the file. Re-exported for the screen and the tests.
export { normalizeVat };

function foldText(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// «di» only counts as a legal-form word right after sas / snc («Rossi sas di Rossi Mario»).
const SAS_DI = /(?:^| )(?:s a s|sas|s n c|snc) di(?= |$)/g;
const LEGAL_FORMS = /(?:^| )(?:s r l s|srls|s r l|srl|s p a|spa|s a p a|sapa|s a s|sas|s n c|snc|s c a r l|scarl|coop)(?= |$)/g;

// «Mulino Esempio S.r.l.» and «MULINO ESEMPIO SRL» are the same supplier.
export function normalizeSupplierName(value) {
  const folded = foldText(value);
  const bare = folded.replace(SAS_DI, ' ').replace(LEGAL_FORMS, ' ').replace(/\s+/g, ' ').trim();
  return bare || folded;
}

export function normalizeIngredientName(value) {
  return foldText(value);
}

// ── How alike two names are ──────────────────────────────────────────────────────
// 1 = equal; between 0.5 and 1 = one holds all the other's words (ignoring words under 3 letters) or
// they share at least half of their words; 0 = not alike. Takes names ALREADY normalised.
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  const shared = [...A].filter(w => B.has(w)).length;
  const jaccard = shared / (A.size + B.size - shared);
  const long = (set) => new Set([...set].filter(w => w.length >= 3));
  const LA = long(A);
  const LB = long(B);
  const contains = (big, small) => [...small].every(w => big.has(w));
  if (LA.size > 0 && LB.size > 0 && (contains(LA, LB) || contains(LB, LA))) return 0.5 + 0.5 * jaccard;
  return jaccard >= 0.5 ? jaccard : 0;
}

function bestSimilarity(fileNormalised, record, normalize) {
  return Math.max(
    similarity(fileNormalised, normalize(record?.name)),
    similarity(fileNormalised, normalize(record?.shortName)),
  );
}

// The same measure for two ingredient names that are not normalised yet (the merge tool ranks with it).
export function nameSimilarity(a, b) {
  return similarity(normalizeIngredientName(a), normalizeIngredientName(b));
}

const byLabel = (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

function rankedCandidates(scored) {
  return scored
    .sort((a, b) => b.score - a.score || byLabel(a.candidate, b.candidate))
    .map(s => s.candidate);
}

// ── Reading the file ─────────────────────────────────────────────────────────────

function parseSupplier(raw, seen) {
  const o = isObject(raw) ? raw : {};
  const key = clean(o.key, MAX_KEY);
  const name = clean(o.name, MAX_NAME);
  const noVat = key.startsWith(NO_VAT_PREFIX);
  const vatNumber = noVat ? '' : normalizeVat(o.vatNumber);
  const entry = { key, vatNumber, name };
  let invalid = null;
  if (!isObject(raw)) invalid = 'not-object';
  else if (!key || key === '__proto__') invalid = 'key-missing';
  else if (seen.has(key)) invalid = 'duplicate-key';
  else if (!name) invalid = 'name-missing';
  else if (!noVat && !vatNumber) invalid = 'vat-missing';
  else if (vatNumber.length > MAX_VAT) invalid = 'vat-too-long';
  if (key) seen.add(key);
  return invalid ? { ...entry, invalid } : entry;
}

// One price of one invoice: null when anything about it is unusable.
function parsePrice(raw) {
  if (!isObject(raw)) return null;
  const invoiceId = typeof raw.invoiceId === 'string' ? raw.invoiceId.trim() : '';
  if (!/^[0-9]{1,20}$/.test(invoiceId)) return null;
  const line = raw.line;
  if (!Number.isInteger(line) || line < 1 || line > 999999) return null;
  if (!isRealDate(raw.invoiceDate)) return null;
  const rate = positive(raw.pricePerUnit);
  const pricePerUnit = rate === null ? 0 : roundTo(rate, RATE_DECIMALS);
  if (!(pricePerUnit > 0)) return null;
  const reliability = TRUSTED_READINGS.includes(raw.reliability) ? raw.reliability : '';
  return {
    invoiceId, line, invoiceDate: raw.invoiceDate, pricePerUnit, qty: positive(raw.qty),
    ...(reliability ? { reliability } : {}),
    ...(raw.fromPack === true ? { fromPack: true } : {}),
  };
}

// Oldest first; the same day by invoice number, then line — so «the latest» is always the last.
function comparePoints(a, b) {
  if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate < b.invoiceDate ? -1 : 1;
  if (a.invoiceId.length !== b.invoiceId.length) return a.invoiceId.length - b.invoiceId.length;
  if (a.invoiceId !== b.invoiceId) return a.invoiceId < b.invoiceId ? -1 : 1;
  return a.line - b.line;
}

function parseIngredient(raw, seen) {
  const o = isObject(raw) ? raw : {};
  const key = clean(o.key, MAX_KEY);
  const priceUnit = PRICE_UNITS.includes(o.priceUnit) ? o.priceUnit : null;
  const pieceKg = positive(o.unitWeightKg);
  const unitWeightKg = priceUnit === 'pcs' && pieceKg !== null ? roundTo(pieceKg, PIECE_DECIMALS) : null;
  const rawCount = o.packCount;
  const countGiven = rawCount !== null && rawCount !== undefined && rawCount !== '';
  const packCount = Number.isInteger(rawCount) && rawCount >= 1 && rawCount <= PACK_COUNT_MAX ? rawCount : null;

  const rawPrices = Array.isArray(o.prices) ? o.prices : [];
  const parsed = rawPrices.map(parsePrice);
  const unique = new Map();
  parsed.forEach(p => { if (p && !unique.has(`${p.invoiceId}-${p.line}`)) unique.set(`${p.invoiceId}-${p.line}`, p); });
  const prices = [...unique.values()].sort(comparePoints);

  // ⚠️ `prices: []` IS LEGAL ONLY WITH A priceCheck CODE: the ingredient is wanted, its price is not.
  const priceCheck = rawPrices.length === 0 && PRICE_CHECK_CODES.includes(o.priceCheck) ? o.priceCheck : '';
  const entry = {
    key,
    supplierKey: clean(o.supplierKey, MAX_KEY),
    mergeWith: clean(o.mergeWith, MAX_NAME),
    name: clean(o.name, MAX_NAME),
    // «Nome in fattura»: only the zip import knows it; the Python .json path never carries one.
    ...(clean(o.invoiceName, MAX_INVOICE_NAME) ? { invoiceName: clean(o.invoiceName, MAX_INVOICE_NAME) } : {}),
    brand: clean(o.brand, MAX_NAME),
    category: clean(o.category, MAX_NAME),
    supplierCode: clean(o.supplierCode, MAX_SUPPLIER_CODE),
    weight: clean(o.weight, MAX_WEIGHT),
    packUnit: clean(o.packUnit, MAX_PACK_UNIT),
    packCount,
    priceUnit: priceUnit || 'kg',
    unitWeightKg,
    vatRate: vatRateOf(o.vatRate),
    prices,
    ...(priceCheck ? { priceCheck } : {}),
    ...(o.latestUnverified === true && prices.length > 0 ? { latestUnverified: true } : {}),
  };

  let invalid = null;
  if (!isObject(raw)) invalid = 'not-object';
  else if (!key || key === '__proto__') invalid = 'key-missing';
  else if (seen.has(key)) invalid = 'duplicate-key';
  else if (!entry.supplierKey) invalid = 'supplier-key-missing';
  else if (!entry.name) invalid = 'name-missing';
  else if (!priceUnit) invalid = 'price-unit';
  else if (priceUnit === 'pcs' && unitWeightKg === null) invalid = 'unit-weight-missing';
  else if (countGiven && packCount === null) invalid = 'pack-count';
  else if (rawPrices.length === 0 && !priceCheck) invalid = 'no-prices';
  else if (parsed.some(p => p === null)) invalid = 'price-invalid';
  if (key) seen.add(key);
  return invalid ? { ...entry, invalid } : entry;
}

// text → { ok: true, file } | { ok: false, error }.
// A broken FILE (not JSON, not ours, not this version, no lists) is refused whole. A broken ENTRY is kept
// with `invalid: '<reason>'`, so the screen can show it as a row that says why it was not imported —
// never dropped silently, and never the reason the other 200 lines are lost.
export function parseImportFile(text) {
  let data;
  try {
    data = JSON.parse(typeof text === 'string' ? text.replace(/^﻿/, '') : '');
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (!isObject(data)) return { ok: false, error: 'invalid' };
  if (data.format !== IMPORT_FORMAT) return { ok: false, error: 'wrong-format' };
  if (data.version !== IMPORT_VERSION) return { ok: false, error: 'wrong-version' };
  if (!Array.isArray(data.suppliers) || !Array.isArray(data.ingredients)) return { ok: false, error: 'invalid' };
  const supplierKeys = new Set();
  const ingredientKeys = new Set();
  return {
    ok: true,
    file: {
      generatedAt: clean(data.generatedAt, 64),
      suppliers: data.suppliers.map(s => parseSupplier(s, supplierKeys)),
      ingredients: data.ingredients.map(i => parseIngredient(i, ingredientKeys)),
    },
  };
}

// ── Suppliers ────────────────────────────────────────────────────────────────────

// One entry per file supplier:
//   present — exactly one existing supplier carries this VAT number;
//   maybe   — no VAT match, but one or more existing suppliers WITHOUT a VAT number look alike (or two
//             suppliers carry the same VAT number): the person decides;
//   new     — nothing like it;
//   error   — the entry is unusable (`reason`).
// ⚠️ A supplier with a DIFFERENT VAT number is never a candidate: two people with the same surname and
// two VAT numbers are two suppliers.
export function planSuppliers(fileSuppliers, existingSuppliers) {
  const existing = (existingSuppliers || []).filter(s => s && typeof s.id === 'string' && s.id);
  return (fileSuppliers || []).map(file => {
    const base = { key: file.key, vatNumber: file.vatNumber || '', name: file.name || '' };
    if (file.invalid) return { ...base, status: 'error', reason: file.invalid };

    const vat = normalizeVat(file.vatNumber);
    if (vat) {
      const sameVat = existing.filter(s => normalizeVat(s.vatNumber) === vat);
      if (sameVat.length === 1) return { ...base, status: 'present', supplierId: sameVat[0].id };
      if (sameVat.length > 1) {
        const candidates = sameVat
          .map(s => ({ id: s.id, label: supplierLabel(s) }))
          .sort(byLabel);
        return { ...base, status: 'maybe', candidates, reason: 'duplicate-vat' };
      }
    }

    const wanted = normalizeSupplierName(file.name);
    const scored = existing
      .filter(s => !normalizeVat(s.vatNumber))
      .map(s => ({ candidate: { id: s.id, label: supplierLabel(s) }, score: bestSimilarity(wanted, s, normalizeSupplierName) }))
      .filter(s => s.score > 0);
    if (scored.length > 0) return { ...base, status: 'maybe', candidates: rankedCandidates(scored) };
    return { ...base, status: 'new' };
  });
}

// What the new-supplier form saves (js/supplier-record-form.js), plus the VAT number. ⚠️ A merge write
// must be able to clear a field, so every key is present, never omitted.
function newSupplierData(entry) {
  return {
    name: entry.name,
    shortName: '',
    category: '',
    phone: '',
    email: '',
    deliveryDays: [],
    orderDays: [],
    active: true,
    vatNumber: entry.vatNumber || '',
  };
}

// plan + the person's decisions → the writes, and which file supplier maps to which supplier id.
// decisions: { [key]: { linkTo: supplierId } | { createNew: true } | { skip: true } }.
// A 'maybe' without a decision (or with a link to somebody who is not one of its candidates) is
// returned in `blocked`: the screen must not go on until every one has an answer.
// A supplier that is CREATED has no id yet: the data layer mints it, and the ingredients are planned
// again afterwards with the id in supplierIdByKey.
export function supplierWrites(plan, decisions) {
  const ops = [];
  const supplierIdByKey = {};
  const blocked = [];
  (plan || []).forEach(entry => {
    if (entry.status === 'error') return;
    if (entry.status === 'present') { supplierIdByKey[entry.key] = entry.supplierId; return; }
    const decision = isObject(decisions?.[entry.key]) ? decisions[entry.key] : {};
    if (decision.skip === true) return;
    if (entry.status === 'maybe') {
      if (typeof decision.linkTo === 'string' && (entry.candidates || []).some(c => c.id === decision.linkTo)) {
        supplierIdByKey[entry.key] = decision.linkTo;
        // The VAT number is the ONLY thing ever written onto an existing supplier. A supplier the
        // invoice gives no VAT number for has nothing to write: linking just remembers who it is.
        if (entry.vatNumber) {
          ops.push({ type: 'link-supplier', key: entry.key, supplierId: decision.linkTo, data: { vatNumber: entry.vatNumber } });
        }
        return;
      }
      if (decision.createNew !== true) { blocked.push(entry.key); return; }
    }
    ops.push({ type: 'create-supplier', key: entry.key, data: newSupplierData(entry) });
  });
  return { ops, supplierIdByKey, blocked };
}

// ── Ingredients ──────────────────────────────────────────────────────────────────

const pointId = (p) => `inv-${p.invoiceId}-${p.line}`;

const ingredientLabel = (ing) => {
  const short = typeof ing?.shortName === 'string' ? ing.shortName.trim() : '';
  return short || String(ing?.name || '');
};

const candidateOf = (ing) => ({ id: ing.id, label: ingredientLabel(ing) });

// The existing ingredients a file line may be matched with: the same supplier, never packaging,
// inactive ones included (an ingredient taken off the order list is still THE ingredient).
function poolFor(ingredients, supplierId) {
  return (ingredients || [])
    .filter(i => i && typeof i.id === 'string' && i.id && i.supplierId === supplierId && i.kind !== 'packaging')
    .sort((a, b) => a.id.localeCompare(b.id));
}

const namesOf = (ing) => [normalizeIngredientName(ing.name), normalizeIngredientName(ing.shortName)].filter(Boolean);

// ── One ingredient, several packs ────────────────────────────────────────────────

const codeOf = (ing) => (typeof ing?.supplierCode === 'string' ? ing.supplierCode.trim().toLowerCase() : '');

const compact = (text) => foldText(text).replace(/ /g, '');

// Which pack a price was paid for: the invoice's own name, plus the weight when the name does not already
// say it («Lievito» + «1 kg» → «Lievito 1 kg»). A word of the invoice, never translated.
export function packLabelOf(item) {
  const name = clean(item?.name, MAX_NAME);
  const weight = clean(item?.weight, MAX_WEIGHT);
  const label = weight && !compact(name).includes(compact(weight)) ? `${name} ${weight}` : name;
  return label.slice(0, MAX_PACK_LABEL).trim();
}

// The extra codes an ingredient holds, cleaned: texts only, trimmed, no empties, no repeats (case-blind), and
// never the main code again.
export function extraCodesOf(ing) {
  const main = codeOf(ing);
  const seen = new Set(main ? [main] : []);
  const out = [];
  (Array.isArray(ing?.supplierCodes) ? ing.supplierCodes : []).forEach(raw => {
    const code = clean(raw, MAX_SUPPLIER_CODE);
    const key = code.toLowerCase();
    if (!code || seen.has(key)) return;
    seen.add(key);
    out.push(code);
  });
  return out;
}

// Every article code the ingredient answers to, lower case.
function codesOf(ing) {
  const all = new Set(extraCodesOf(ing).map(c => c.toLowerCase()));
  const main = codeOf(ing);
  if (main) all.add(main);
  return all;
}

// The row of an ingredient that IS this existing one.
// ⚠️ THE WEIGHT THE VENUE KEEPS WINS OVER THE ONE IN THE INVOICE DESCRIPTION (the old script read the weight the
// owner had corrected in the workbook). A price per kilo or litre worked out from the pack weight written in the
// description («SACCO KG 25») is re-read with the stored weight of the ingredient, but ONLY when the file's article
// code is the ingredient's MAIN code: a code in `supplierCodes` is another pack, not a correction.
// → { factor } (the stored weight is empty, or equal to the file's: 1) | { unreadable: true } when the stored weight
// is text that cannot be read as a weight in the same unit — never a guess.
function storedWeightFactor(base, existing) {
  const mainCode = codeOf(existing);
  const isMain = mainCode !== '' && base.supplierCode !== '' && mainCode === base.supplierCode.toLowerCase();
  const fromPack = base.allPoints.some(p => p.fromPack === true);
  if (!isMain || !fromPack || (base.priceUnit !== 'kg' && base.priceUnit !== 'l')) return { factor: 1 };
  const storedText = typeof existing.weight === 'string' ? existing.weight.trim() : '';
  if (!storedText) return { factor: 1 };
  const stored = packBaseOf(storedText);
  const file = packBaseOf(base.weight);
  if (!stored || !file || !(stored.size > 0) || !(file.size > 0)
    || stored.priceUnit !== base.priceUnit || file.priceUnit !== base.priceUnit) return { unreadable: true };
  // ⚠️ THE WHOLE PACK, NOT ONE ITEM: a Cartone stores the weight of ONE item beside its packCount, and the invoice
  // price was worked out over pieces × size × count (pricing.js). «10 kg» Singola and 10 × 1 kg Cartone are the
  // same pack; comparing the item weights alone would turn 8 per kg into 80.
  const countOf = (count) => (Number.isInteger(count) && count >= 1 ? count : 1);
  const total = (size, count) => size * countOf(count);
  const factor = total(file.size, base.packCount) / total(stored.size, existing.packCount);
  // The two packs as a person reads them («10 × 1 kg», «1 kg»): the reason of a rescaled row names both.
  const label = (text, count) => (countOf(count) > 1 ? `${countOf(count)} × ${text}` : text);
  return {
    factor: Math.abs(factor - 1) <= 0.001 ? 1 : factor,
    storedLabel: label(storedText, existing.packCount),
    fileLabel: label(clean(base.weight, MAX_WEIGHT), base.packCount),
  };
}

// The point as it would have been with the stored weight: the same total over (packs × stored weight).
const rescaled = (p, factor) => (p.fromPack === true && factor !== 1
  ? {
    ...p,
    pricePerUnit: roundTo(p.pricePerUnit * factor, RATE_DECIMALS),
    ...(typeof p.qty === 'number' && p.qty > 0 ? { qty: p.qty / factor } : {}),
  }
  : p);

function matchedRow(base, existing, ctx) {
  const known = asSet(lookup(ctx.invoicePointIds, existing.id));
  const weightRead = storedWeightFactor(base, existing);
  const factor = weightRead.factor || 1;
  const allPoints = factor === 1 ? base.allPoints : base.allPoints.map(p => rescaled(p, factor));
  const newPoints = allPoints.filter(p => !known.has(p.id));
  const doc = lookup(ctx.pricesById, existing.id);
  const latest = newPoints[newPoints.length - 1];
  const stamp = typeof doc?.priceUpdatedAt === 'string' ? doc.priceUpdatedAt : '';
  // ⚠️ A price kept in ANOTHER UNIT is never replaced by one in the file's unit: a rate per kilo laid over a
  // rate per piece would silently change what every recipe costs. The new prices go to the history only.
  const storedUnit = PRICE_UNITS.includes(doc?.priceUnit) ? doc.priceUnit : null;
  const unitDiffers = newPoints.length > 0 && storedUnit !== null && storedUnit !== base.priceUnit;
  // ⚠️ THE SAME HOLDS FOR A PIECE OF ANOTHER SIZE: a per-piece price of a 5 kg sack never replaces the per-piece
  // price of a 1 kg bag (the two packs of one ingredient). Only an equal piece weight (0.1%) may update it.
  const pieceDiffers = newPoints.length > 0 && !unitDiffers && storedUnit === 'pcs' && base.priceUnit === 'pcs'
    && !sameUnitWeight(base.unitWeightKg, doc?.unitWeightKg);
  // An invoice older than the price in force only feeds the history.
  const updateCurrent = newPoints.length > 0 && !unitDiffers && !pieceDiffers && (!doc || !stamp || latest.invoiceDate > stamp.slice(0, 10));
  const status = newPoints.length === 0 ? 'unchanged' : (updateCurrent ? 'update-price' : 'history-only');
  // ⚠️ THE FILE'S CODE IS A NEW PACK OF THIS INGREDIENT when it does not answer to it yet: the main code when
  // it has none, else a place in `supplierCodes` — unless the list is full, which is said, never overwritten.
  const hasCode = codeOf(existing) !== '';
  let patchSupplierCode = null;
  let setSupplierCodes = null;
  let codesFull = false;
  if (base.supplierCode && !codesOf(existing).has(base.supplierCode.toLowerCase())) {
    if (!hasCode) patchSupplierCode = base.supplierCode;
    else if (extraCodesOf(existing).length >= MAX_SUPPLIER_CODES) codesFull = true;
    else setSupplierCodes = [...extraCodesOf(existing), base.supplierCode];
  }
  // ⚠️ A rate the file does not state never wipes one the owner did: «not stated» is null, and the stored
  // rate stays when the file says nothing.
  const vatRate = base.vatRate !== null && base.vatRate !== undefined ? base.vatRate : vatRateOf(doc?.vatRate);
  const nameRead = invoiceNameRead(base, existing);
  const priceCheck = newPoints.length === 0 ? null : checkOf({
    weightUnreadable: weightRead.unreadable === true, rescaled: factor !== 1 ? weightRead : null,
    updateCurrent, latest, base, doc, storedUnit,
  });
  // The invoice name is the last reason: a row with a price to look at is held for that first, and confirming it
  // writes the new name too (`patchInvoiceName` stays on the row).
  const check = priceCheck || (nameRead.changed
    ? { reason: CHECK_REASONS.INVOICE_NAME_CHANGED, stored: nameRead.stored, file: nameRead.file }
    : null);
  return {
    ...base,
    status,
    ingredientId: existing.id,
    allPoints,
    newPoints,
    updateCurrent,
    vatRate,
    ...(check ? {
      checkReason: check.reason,
      ...(check.date ? { checkDate: check.date } : {}),
      ...(check.stored ? { checkStored: check.stored, checkFile: check.file } : {}),
    } : {}),
    ...(unitDiffers ? { reason: 'unit-differs' } : {}),
    ...(pieceDiffers ? { reason: 'piece-differs' } : {}),
    patchSupplierCode,
    setSupplierCodes,
    patchInvoiceName: nameRead.write,
    ...(codesFull ? { codesFull: true } : {}),
  };
}

// «Nome in fattura» of a row against the ingredient it is matched with → { write, changed, stored?, file? }:
//   write   — the name to save on the ingredient, or null;
//   changed — the ingredient holds ANOTHER invoice name and the file's article code is its MAIN code: the same
//             product, renamed by the supplier. A person confirms it; it is never written silently.
// ⚠️ A file code that is one of the ingredient's EXTRA codes is another pack: its name is never compared or
// saved (it would overwrite the name of the main pack). A row a person resolved to an ingredient with a
// different invoice name leaves it alone for the same reason; an empty name is filled in.
function invoiceNameRead(base, existing) {
  const file = typeof base.invoiceName === 'string' ? base.invoiceName : '';
  const none = { write: null, changed: false };
  if (!file) return none;
  const code = base.supplierCode ? base.supplierCode.toLowerCase() : '';
  if (code && extraCodesOf(existing).some(c => c.toLowerCase() === code)) return none;
  const stored = typeof existing.invoiceName === 'string' ? existing.invoiceName.trim() : '';
  if (!stored) return { write: file, changed: false };
  if (stored === file) return none;
  const viaMainCode = code !== '' && codeOf(existing) === code;
  return viaMainCode ? { write: file, changed: true, stored, file } : none;
}

// Why a row that would write a price must wait for a person: { reason, date? } or null. Only ONE reason is given,
// the first that holds: an unreadable stored weight, a price re-read with another pack, a big move from a «media»
// reading, an older invoice's price.
function checkOf({ weightUnreadable, rescaled: rescale, updateCurrent, latest, base, doc, storedUnit }) {
  if (weightUnreadable) return { reason: CHECK_REASONS.WEIGHT_UNREADABLE };
  // ⚠️ A FACTOR OTHER THAN 1 IS NEVER APPLIED SILENTLY, whatever the status of the row (even with no price in force):
  // the card's Singola/Cartone may not describe the packaging of the invoice line at all.
  if (rescale) return { reason: CHECK_REASONS.WEIGHT_RESCALED, stored: rescale.storedLabel, file: rescale.fileLabel };
  if (!updateCurrent || !latest) return null;
  const was = typeof doc?.pricePerUnit === 'number' ? doc.pricePerUnit : null;
  // Rounded to 6 decimals first: 1.3 against 1 is 0.30000000000000004 in floating point, and +30% is not MORE than 30%.
  if (latest.reliability === 'media' && was > 0 && storedUnit === base.priceUnit
    && roundTo(Math.abs(latest.pricePerUnit - was) / was, 6) > AVERAGED_PRICE_JUMP_LIMIT) {
    return { reason: CHECK_REASONS.PRICE_JUMP };
  }
  if (base.latestUnverified === true) return { reason: CHECK_REASONS.OLDER_INVOICE, date: latest.invoiceDate };
  return null;
}

function newRow(base) {
  const latest = base.allPoints[base.allPoints.length - 1];
  const check = base.latestUnverified === true && latest ? { reason: CHECK_REASONS.OLDER_INVOICE, date: latest.invoiceDate } : null;
  return {
    ...base, status: 'new', newPoints: base.allPoints.slice(), updateCurrent: true,
    ...(check ? { checkReason: check.reason, checkDate: check.date } : {}),
  };
}

// A row that waits for a person: it carries everything needed to recompute it (resolveRow).
function undecidedRow(base, status, candidates, reason) {
  return { ...base, status, candidates, newPoints: base.allPoints.slice(), updateCurrent: false, ...(reason ? { reason } : {}) };
}

// ⚠️ A DECISION IS REMEMBERED BY THE PRICES IT LEFT BEHIND. A row the owner once resolved with «Same as X» has
// no article code to find X again by, and its name differs, so it would be asked every month. But its invoice
// points are in X's history (`inv-<invoice>-<line>`): when exactly ONE candidate already holds any of this
// row's points, that is the answer the owner gave. Two holders, or none, stay a question.
function questionOrRemembered(base, status, candidates, reason, pool, ctx) {
  const holders = candidates.filter(c => {
    const known = asSet(lookup(ctx.invoicePointIds, c.id));
    return base.allPoints.some(p => known.has(p.id));
  });
  const target = holders.length === 1 ? pool.find(i => i.id === holders[0].id) : null;
  return target ? matchedRow(base, target, ctx) : undecidedRow(base, status, candidates, reason);
}

// One row per file ingredient: { key, name, supplierId, status, ingredientId?, candidates?, newPoints,
// updateCurrent, reason?, … }. status:
//   new             — nothing like it under this supplier
//   update-price    — the same ingredient; the invoice is newer than the price in force
//   history-only    — the same ingredient; the invoice is older, so it only joins the history
//   unchanged       — the same ingredient; every point is already recorded: NOTHING to write
//   maybe-duplicate — something similar exists: a person says same / new / skip   (resolveRow)
//   choose          — «unisci con …» pointed at a name nobody has: a person picks one   (resolveRow)
//   error           — unusable entry, or its supplier is not known (`reason`)
// ctx = { supplierIdByKey, ingredients, pricesById, invoicePointIds } — see the README of this slice.
export function planIngredients(fileIngredients, ctx) {
  const context = ctx || {};
  return (fileIngredients || []).map(file => {
    const allPoints = (file.prices || []).map(p => ({ ...p, id: pointId(p) }));
    const base = {
      key: file.key,
      name: file.name || '',
      supplierId: null,
      status: 'error',
      newPoints: [],
      updateCurrent: false,
      mergeWith: file.mergeWith || '',
      supplierCode: file.supplierCode || '',
      patchSupplierCode: null,
      setSupplierCodes: null,
      patchInvoiceName: null,
      // The description as on the invoice (lot blocks removed): how an ingredient is recognised without a code.
      ...(file.invoiceName ? { invoiceName: file.invoiceName } : {}),
      // What the file says about the price: matching a stored price against it needs both (matchedRow).
      priceUnit: file.priceUnit || null,
      unitWeightKg: typeof file.unitWeightKg === 'number' ? file.unitWeightKg : null,
      vatRate: file.vatRate === undefined ? null : file.vatRate,
      allPoints,
      // The pack weight the price was worked out with, and whether the newest invoice was left out as unreliable.
      ...(file.weight ? { weight: file.weight } : {}),
      ...(file.packCount ? { packCount: file.packCount } : {}),
      ...(file.latestUnverified === true ? { latestUnverified: true } : {}),
      // Set when the file wants the ingredient but states no price for it (see PRICE_CHECK_CODES).
      priceCheck: file.priceCheck || '',
    };
    if (file.invalid) return { ...base, reason: file.invalid };
    const supplierId = lookup(context.supplierIdByKey, file.supplierKey);
    if (!hasKey(context.supplierIdByKey, file.supplierKey) || typeof supplierId !== 'string' || !supplierId) {
      return { ...base, reason: 'supplier-missing' };
    }
    const row = { ...base, supplierId };
    const pool = poolFor(context.ingredients, supplierId);

    // a. «unisci con …»: the owner named the ingredient it belongs to.
    if (row.mergeWith) {
      const wanted = normalizeIngredientName(row.mergeWith);
      const hits = pool.filter(i => namesOf(i).includes(wanted));
      if (hits.length === 1) return matchedRow(row, hits[0], context);
      const reason = hits.length === 0 ? 'merge-target-not-found' : 'merge-target-ambiguous';
      const candidates = (hits.length === 0 ? pool : hits).map(candidateOf).sort(byLabel);
      return questionOrRemembered(row, 'choose', candidates, reason, pool, context);
    }

    // b. the supplier's own article code: it survives a changed description.
    if (row.supplierCode) {
      const code = row.supplierCode.toLowerCase();
      const hits = pool.filter(i => codesOf(i).has(code));
      if (hits.length === 1) return matchedRow(row, hits[0], context);
      if (hits.length > 1) {
        return questionOrRemembered(row, 'maybe-duplicate', hits.map(candidateOf).sort(byLabel), 'code-ambiguous', pool, context);
      }
    }

    // b2. the same invoice name, character for character: the supplier's own words for the product.
    if (row.invoiceName) {
      const same = pool.filter(i => typeof i.invoiceName === 'string' && i.invoiceName.trim() === row.invoiceName);
      if (same.length === 1) {
        // ⚠️ Same rule as the name below: a different article code is another product, so it is a question.
        const known = codesOf(same[0]);
        const clash = row.supplierCode && known.size > 0 && !known.has(row.supplierCode.toLowerCase());
        if (!clash) return matchedRow(row, same[0], context);
        return questionOrRemembered(row, 'maybe-duplicate', [candidateOf(same[0])], 'code-differs', pool, context);
      }
      if (same.length > 1) {
        return questionOrRemembered(row, 'maybe-duplicate', same.map(candidateOf).sort(byLabel), 'name-ambiguous', pool, context);
      }
    }

    // c. the same name, or the same display name.
    const wanted = normalizeIngredientName(row.name);
    const named = pool.filter(i => namesOf(i).includes(wanted));
    if (named.length === 1) {
      // ⚠️ THE SAME NAME UNDER ANOTHER ARTICLE CODE IS A QUESTION, never a silent match: «farina 00» in a 25 kg
      // sack and in a 5 kg bag are two products of the same supplier, and one price must not land on the other.
      const known = codesOf(named[0]);
      const clash = row.supplierCode && known.size > 0 && !known.has(row.supplierCode.toLowerCase());
      if (!clash) return matchedRow(row, named[0], context);
      return questionOrRemembered(row, 'maybe-duplicate', [candidateOf(named[0])], 'code-differs', pool, context);
    }
    if (named.length > 1) {
      return questionOrRemembered(row, 'maybe-duplicate', named.map(candidateOf).sort(byLabel), 'name-ambiguous', pool, context);
    }

    // d. something that looks like it.
    const scored = pool
      .map(i => ({ candidate: candidateOf(i), score: bestSimilarity(wanted, i, normalizeIngredientName) }))
      .filter(s => s.score > 0);
    if (scored.length > 0) return questionOrRemembered(row, 'maybe-duplicate', rankedCandidates(scored), undefined, pool, context);

    // e. nothing.
    return newRow(row);
  });
}

// A person's answer for a 'maybe-duplicate' or 'choose' row:
//   { sameAs: ingredientId } → the row, recomputed as that ingredient;
//   { createNew: true }      → a new ingredient (never for an «unisci con …» row: the owner said which);
//   { skip: true }           → nothing is written.
// Any other row, or no usable answer, comes back unchanged.
export function resolveRow(row, decision, ctx) {
  if (!row || (row.status !== 'maybe-duplicate' && row.status !== 'choose') || !isObject(decision)) return row;
  const context = ctx || {};
  // The question has been answered: the candidates and the reason for asking go.
  const { candidates, reason, ...base } = row;
  if (decision.skip === true) return { ...base, status: 'skipped', newPoints: [], updateCurrent: false };
  if (decision.createNew === true) {
    if (row.mergeWith) return row;
    return newRow({ ...base, patchSupplierCode: null, setSupplierCodes: null, patchInvoiceName: null });
  }
  if (typeof decision.sameAs === 'string') {
    const target = poolFor(context.ingredients, row.supplierId).find(i => i.id === decision.sameAs);
    if (!target) return { ...base, status: 'error', newPoints: [], updateCurrent: false, reason: 'target-not-found' };
    return matchedRow(base, target, context);
  }
  return row;
}

// ── The writes of one row ────────────────────────────────────────────────────────

// What the card stores for «one package of weight W»: the text the weight box would give back.
function storedWeight(text) {
  const w = splitWeight(text);
  if (w.amount !== '') return joinWeight(w.amount, w.unit);
  return typeof w.legacy === 'string' ? w.legacy : '';
}

// What a NEW ingredient gets, key for key what the new card's Save builds (js/ingredient-record-form.js):
//   Singola (packCount null) — `unit` is '' (or the venue's «kg» / «l» / «pz» for a loose item with no
//                              readable weight); nothing about a carton.
//   Cartone (packCount ≥ 1)  — pack-format.js formatPatch writes packCount, packUnit and the carton word
//                              into `unit`, exactly as when a person moves Confezione to Cartone. The card
//                              refuses a carton with no word for what is inside, so the venue's default
//                              word stands in when the file has none.
// ⚠️ A Singola gets NO package word, even when the file gives one («sacco»): the card never shows it there,
// and the word only means something inside a carton («Cartone, contiene 30 × uovo»).
// ⚠️ NOTHING about allergens, nutrition or packIngredients — see the head of this file.
function newIngredientData(file, supplierId, language) {
  const weight = storedWeight(file.weight);
  const carton = file.packCount !== null && file.packCount !== undefined;
  const before = { kind: 'single', count: null, inner: '', unit: '', packUnit: '' };
  const inner = file.packUnit || (carton ? defaultPackFor(language) : '');
  const format = formatPatch(
    before,
    { kind: carton ? 'carton' : 'single', count: file.packCount, inner, cartonWord: cartonWordFor(language) },
  );
  const unit = carton
    ? format.unit
    : looseUnit({ kind: 'single', weightReadable: packBaseOf(weight) !== null, priceUnit: file.priceUnit, lang: language });
  const data = {
    name: file.name,
    shortName: '',
    supplierId,
    brand: file.brand || '',
    weight,
    category: file.category || 'Other',
    unit,
    // A Singola carries no package word, exactly like the card (it never shows one there).
    ...(carton ? format : {}),
    ...(file.supplierCode ? { supplierCode: file.supplierCode } : {}),
    ...(file.invoiceName ? { invoiceName: file.invoiceName } : {}),
    active: true,
    kind: 'ingredient',
  };
  // The ingredient keeps the retired price keys at null — what splitPriceFields does on every save.
  INGREDIENT_DRAINED_FIELDS.forEach(key => { data[key] = null; });
  return data;
}

function chunk(ops) {
  const batches = [];
  for (let i = 0; i < ops.length; i += MAX_DOCS_PER_BATCH) batches.push(ops.slice(i, i + MAX_DOCS_PER_BATCH));
  return batches;
}

// row + the file entry it came from → BATCHES of ops (each at most MAX_DOCS_PER_BATCH), in commit order.
// [] for a row that is not new / update-price / history-only — an 'unchanged' row writes nothing.
// Order inside a row: create or patch the ingredient, the current price, then the points oldest first.
// ⚠️ A NEW ingredient has no id yet: the data layer mints it and fills it into the later ops, which say
// `ingredientId: null` to show it. `nowIso` is not used — every date written is the invoice's own — it
// stays in the signature the screen was agreed with. options.language is the venue's OUTPUT language
// (market.js outputLanguage): the carton word and the loose unit are food words.
export function ingredientWrites(row, fileIngredient, nowIso, options) {
  if (!row || !fileIngredient || !['new', 'update-price', 'history-only', 'unchanged'].includes(row.status)) return [];
  const language = options?.language || DEFAULT_LANGUAGE;
  const isNew = row.status === 'new';
  const ingredientId = isNew ? null : row.ingredientId;
  // An «unchanged» row has every price in already: only a new pack code can still be written.
  const points = row.status === 'unchanged' ? [] : (row.newPoints || []);
  // The article code of a pack the ingredient did not know yet — written even when every price is already in
  // (a row that is «unchanged» still teaches the ingredient its new code, so the next file matches by it).
  const codePatch = {};
  if (!isNew && row.patchSupplierCode) codePatch.supplierCode = row.patchSupplierCode;
  if (!isNew && Array.isArray(row.setSupplierCodes)) codePatch.supplierCodes = row.setSupplierCodes;
  // The invoice name of an ingredient that had none, or one the person confirmed as renamed.
  if (!isNew && row.patchInvoiceName) codePatch.invoiceName = row.patchInvoiceName;
  const hasCodePatch = Object.keys(codePatch).length > 0;
  // A NEW ingredient the file states no price for is still created (and nothing else); a matched one has
  // nothing to write unless it learnt a code.
  if (points.length === 0 && !(isNew && row.priceCheck) && !hasCodePatch) return [];
  const ops = [];

  if (isNew) {
    ops.push({ type: 'create-ingredient', data: newIngredientData(fileIngredient, row.supplierId, language) });
  } else if (hasCodePatch) {
    ops.push({ type: 'patch-ingredient', ingredientId, data: codePatch });
  }
  const packLabel = packLabelOf(fileIngredient);
  // The article code of the pack the price was paid for: what tells a change of pack from a change of price.
  const packCode = clean(fileIngredient.supplierCode, MAX_SUPPLIER_CODE);

  const latest = points[points.length - 1];
  const pieceKg = fileIngredient.priceUnit === 'pcs' ? fileIngredient.unitWeightKg : null;
  if (row.updateCurrent && latest) {
    // pricePatch is the card's own: it nulls the retired pack keys AND the four case keys, so a stale
    // case cannot survive beside a new rate.
    const data = pricePatch(
      {
        priceUnit: fileIngredient.priceUnit,
        pricePerUnit: latest.pricePerUnit,
        unitWeightKg: pieceKg,
        // The row's rate: the file's when it states one, else the one already stored (matchedRow).
        vatRate: row.vatRate === undefined ? fileIngredient.vatRate : row.vatRate,
      },
      `${latest.invoiceDate}T12:00:00.000Z`,
    );
    ops.push({ type: 'set-current-price', ingredientId, data });
  }

  points.forEach(p => {
    ops.push({
      type: 'add-price-point',
      ingredientId,
      pointId: p.id,
      data: {
        recordedAt: `${p.invoiceDate}T12:00:00.000Z`,
        priceUnit: fileIngredient.priceUnit,
        pricePerUnit: p.pricePerUnit,
        ...(pieceKg !== null ? { unitWeightKg: pieceKg } : {}),
        supplierId: row.supplierId,
        source: 'invoice',
        invoiceId: p.invoiceId,
        invoiceDate: p.invoiceDate,
        ...(p.qty !== null && p.qty !== undefined ? { invoiceQty: p.qty } : {}),
        // Which pack this price was paid for, so a change of pack is never read as a change of price.
        ...(packLabel ? { packLabel } : {}),
        ...(packCode ? { packCode } : {}),
      },
    });
  });

  return chunk(ops);
}

// How many rows are in each status — every ingredient status is present, at 0 when none.
export function summarize(rows) {
  const counts = {
    new: 0, 'update-price': 0, 'history-only': 0, unchanged: 0, 'maybe-duplicate': 0, choose: 0, skipped: 0, error: 0,
  };
  (rows || []).forEach(row => {
    const status = row?.status || 'error';
    counts[status] = (counts[status] || 0) + 1;
  });
  return counts;
}
