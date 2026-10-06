// selection.js — which of the products read from the invoices go into the import, and what the owner's
// answers should be remembered as. PURE: no DOM, no Firebase, no clock (`nowIso` is passed in).
//
// The owner picks the zip and looks at a summary; he must not decide product by product every month. So the
// program's own proposal (ingredient / packaging / resale, build-import.js) is the starting point and three
// kinds of memory adjust it, kept in `locations/{lid}/invoice-decisions/{sha256(key)}`:
//   • a PRODUCT decided «skip» is left out, a product decided «ingredient» is taken whatever it looks like;
//   • a SUPPLIER decided «skip» (key `supplier:<supplierKey>`) leaves out everything it sells — unless the
//     product itself was decided «ingredient», which wins;
//   • a product proposed as packaging or resale whose article code is the code of an ingredient the venue
//     already holds (same supplier, matched by VAT number) IS an ingredient — it was imported before.
// What a person ticks on the first screen (`overrides`, `supplierOverrides`) is applied at once, in memory;
// nothing is written until the import is confirmed (decisionChanges → planDecisionBatches).

import { normalizeVat } from '../../vat-number.js';
import { IMPORTED_TYPE } from './build-import.js';
import { sha256Hex } from './sha256.js';

export const MAX_LABEL = 300;          // the rules' cap on `label`
export const MAX_DECISIONS_PER_BATCH = 20;
export const DECISION_SKIP = 'skip';
export const DECISION_INGREDIENT = 'ingredient';

export const supplierDecisionKey = (supplierKey) => `supplier:${supplierKey}`;

const ids = new Map();
// The document id of a decision key: 64 lowercase hex (what the rules ask for), stable for a given key.
export function decisionId(key) {
  const text = String(key);
  let id = ids.get(text);
  if (!id) {
    id = sha256Hex(text);
    ids.set(text, id);
  }
  return id;
}

const labelOf = (text) => String(text ?? '').trim().slice(0, MAX_LABEL);
const codeOf = (text) => (typeof text === 'string' ? text.trim().toLowerCase() : '');

// [{ id, decision }] (or a Map id → decision) → Map id → 'skip' | 'ingredient'. Anything else is ignored.
export function indexDecisions(list) {
  const out = new Map();
  const entries = list instanceof Map ? [...list].map(([id, decision]) => ({ id, decision })) : (list || []);
  entries.forEach((d) => {
    const value = d && typeof d.decision === 'string' ? d.decision : '';
    if (d && typeof d.id === 'string' && /^[0-9a-f]{64}$/.test(d.id) && [DECISION_SKIP, DECISION_INGREDIENT].includes(value)) {
      out.set(d.id, value);
    }
  });
  return out;
}

// normalised VAT number → Set of the article codes of the ingredients (never packaging) the venue holds for it.
function knownCodes(suppliers, ingredients) {
  const vatBySupplier = new Map();
  (suppliers || []).forEach((s) => {
    const vat = s && normalizeVat(s.vatNumber);
    if (vat) vatBySupplier.set(s.id, vat);
  });
  const out = new Map();
  (ingredients || []).forEach((i) => {
    if (!i || i.kind === 'packaging') return;
    const vat = vatBySupplier.get(i.supplierId);
    const code = codeOf(i.supplierCode);
    if (!vat || !code) return;
    if (!out.has(vat)) out.set(vat, new Set());
    out.get(vat).add(code);
  });
  return out;
}

// built: what buildImportFromInvoices() returned.
// options: { decisions (Map id → decision, or a list), existingSuppliers, existingIngredients,
//            overrides: { [productKey]: 'ingredient' }   — ticked on the first screen,
//            supplierOverrides: { [supplierKey]: 'import' } — a skipped supplier ticked «import again» }
// → { importFile, groups, counts, byKey }
//   importFile — the v1 shape for the existing pipeline (ingredients may carry `priceCheck`).
//   groups     — notImported / skippedByYou: [{ key, name, description, supplierName, canImport, checked }],
//                skippedSuppliers: [{ key, name, products, checked }], unreadable: [{ key, name, supplierName, reason }],
//                toCheck: [{ key, name, supplierName, reason }], skippedFiles: [{ name, reason }].
//   byKey      — per product: { base, natural, ticked, included, label } (decisionChanges reads it).
export function selectImport(built, options = {}) {
  const decisions = indexDecisions(options.decisions);
  const overrides = options.overrides || {};
  const supplierOverrides = options.supplierOverrides || {};
  const known = knownCodes(options.existingSuppliers, options.existingIngredients);
  const entryByKey = new Map((built.candidates || []).map((entry) => [entry.key, entry]));

  const groups = { notImported: [], skippedByYou: [], skippedSuppliers: [], unreadable: [], toCheck: [], skippedFiles: [] };
  const byKey = new Map();
  const supplierGroup = new Map();
  const taken = [];

  for (const row of built.products || []) {
    const entry = entryByKey.get(row.key) || null;
    const stored = decisions.get(decisionId(row.key));
    const supplierStored = decisions.get(decisionId(supplierDecisionKey(row.supplierKey))) === DECISION_SKIP;
    const supplierSkipped = supplierStored && supplierOverrides[row.supplierKey] !== 'import';
    const vat = normalizeVat(row.vatNumber);
    const promoted = Boolean(entry) && Boolean(vat) && codeOf(row.supplierCode) !== ''
      && Boolean(known.get(vat)?.has(codeOf(row.supplierCode)));
    const natural = row.type === IMPORTED_TYPE || promoted;

    let base;
    if (!entry) base = row.type === IMPORTED_TYPE ? 'unreadable' : 'notImported';
    else if (stored === DECISION_INGREDIENT) base = 'import';
    else if (supplierSkipped) base = 'skippedSupplier';
    else if (stored === DECISION_SKIP) base = 'skippedByYou';
    else if (natural) base = 'import';
    else base = 'notImported';

    const ticked = overrides[row.key] === DECISION_INGREDIENT && (base === 'notImported' || base === 'skippedByYou') && Boolean(entry);
    const included = base === 'import' || ticked;
    const label = labelOf(row.description || row.name);
    byKey.set(row.key, { base, natural, ticked, included, label, canImport: Boolean(entry) });

    const item = {
      key: row.key, name: row.name, description: row.description, supplierName: row.supplierName,
      canImport: Boolean(entry), checked: ticked,
      // Why a product that cannot be turned into an ingredient is not offered (build-import.js `unreadableReason`).
      reason: entry ? '' : (row.unreadableReason || ''),
    };
    if (base === 'notImported') groups.notImported.push(item);
    else if (base === 'skippedByYou') groups.skippedByYou.push(item);
    else if (base === 'unreadable') groups.unreadable.push(item);
    if (supplierStored && entry) {
      const group = supplierGroup.get(row.supplierKey) || {
        key: row.supplierKey, name: row.supplierName, products: 0, checked: supplierOverrides[row.supplierKey] === 'import',
      };
      group.products += 1;
      supplierGroup.set(row.supplierKey, group);
    }
    if (included) taken.push({ row, entry });
  }
  groups.skippedSuppliers = [...supplierGroup.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

  const ingredients = taken.map((t) => t.entry).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const suppliers = new Map();
  taken.forEach(({ row }) => suppliers.set(row.supplierKey, { key: row.supplierKey, vatNumber: row.vatNumber, name: row.supplierName }));
  const rowOf = new Map((built.products || []).map((row) => [row.key, row]));
  ingredients.filter((i) => i.priceCheck).forEach((i) => {
    const row = rowOf.get(i.key);
    groups.toCheck.push({ key: i.key, name: i.name, supplierName: row ? row.supplierName : '', reason: i.priceCheck });
  });
  groups.skippedFiles = (built.skippedFiles || []).map((f) => ({ name: f.name, reason: f.reason }));

  const documents = built.documents || [];
  return {
    importFile: {
      format: built.importFile.format,
      version: built.importFile.version,
      generatedAt: built.importFile.generatedAt,
      suppliers: [...suppliers.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      ingredients,
    },
    groups,
    counts: {
      invoices: documents.length,
      excludedDocuments: documents.filter((d) => d.status === 'excluded').length,
      skippedFiles: groups.skippedFiles.length,
      p7m: built.p7mCount || 0,
      salesSkipped: built.salesSkipped || 0,
      suppliers: suppliers.size,
      ingredients: ingredients.length,
    },
    byKey,
  };
}

// What the owner's answers of this import should leave in the decisions collection.
//   selection         — what selectImport() returned for the state the person saw
//   decisions         — what was stored when the import started (Map id → decision, or a list)
//   overrides / supplierOverrides — the first-screen ticks (same shapes as selectImport)
//   supplierSkips     — [{ key: supplierKey, name }]  the step-2 «do not import anything from this supplier»
//   itemSkips         — [{ key: productKey, label }]  the step-3 «do not import (remember)»
// → { set: [{ id, key, decision, label }], remove: [id] }.
// ⚠️ A tick that only undoes a stored «skip» on a product the program proposes anyway REMOVES the decision rather than
// storing «ingredient»: there is nothing left to remember. A product the program would not take stays remembered.
export function decisionChanges({
  selection, decisions, overrides = {}, supplierOverrides = {}, supplierSkips = [], itemSkips = [],
}) {
  const stored = indexDecisions(decisions);
  const actions = new Map();   // id → { key, decision, label } | null (remove)
  const setTo = (key, decision, label) => actions.set(decisionId(key), { key, decision, label: labelOf(label) });
  const remove = (key) => actions.set(decisionId(key), null);

  Object.entries(overrides).forEach(([key, value]) => {
    const info = selection && selection.byKey.get(key);
    if (value !== DECISION_INGREDIENT || !info || !info.ticked) return;
    const was = stored.get(decisionId(key));
    if (info.natural) {
      if (was) remove(key);
    } else if (was !== DECISION_INGREDIENT) {
      setTo(key, DECISION_INGREDIENT, info.label);
    }
  });
  Object.entries(supplierOverrides).forEach(([supplierKey, value]) => {
    const key = supplierDecisionKey(supplierKey);
    if (value === 'import' && stored.get(decisionId(key)) === DECISION_SKIP) remove(key);
  });
  // ⚠️ PERSONAL DATA (P13): a skipped SUPPLIER is stored with its NAME as `label` (a sole trader's name is a
  // person's). It is stored only so the screen can list «skipped by you» in words, and it is kept until the person
  // ticks «import again» on that supplier and confirms (the key above is then removed); nothing expires it.
  supplierSkips.forEach((s) => setTo(supplierDecisionKey(s.key), DECISION_SKIP, s.name));
  itemSkips.forEach((s) => setTo(s.key, DECISION_SKIP, s.label));

  const set = [];
  const removed = [];
  actions.forEach((action, id) => {
    if (action) {
      if (stored.get(id) !== action.decision) set.push({ id, ...action });
    } else if (stored.has(id)) {
      removed.push(id);
    }
  });
  return { set, remove: removed };
}

// The changes → batches of at most 20 operations, each { type: 'set', id, data } or { type: 'delete', id }.
// `data` is exactly what the rules accept: { bakery, decision, label (≤300), updatedAt (ISO text) }.
export function planDecisionBatches(changes, { bakery, nowIso }) {
  const ops = [
    ...changes.set.map((c) => ({
      type: 'set', id: c.id, data: { bakery, decision: c.decision, label: labelOf(c.label), updatedAt: String(nowIso) },
    })),
    ...changes.remove.map((id) => ({ type: 'delete', id })),
  ];
  const batches = [];
  for (let i = 0; i < ops.length; i += MAX_DECISIONS_PER_BATCH) batches.push(ops.slice(i, i + MAX_DECISIONS_PER_BATCH));
  return batches;
}
