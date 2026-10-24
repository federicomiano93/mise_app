// selection.ts — which of the products read from the invoices go into the import, and what the owner's
// answers should be remembered as. PURE: no DOM, no Firebase, no clock (`nowIso` is passed in).
//
// The owner picks the zip and looks at a summary; he must not decide product by product every month. So the
// program's own proposal (ingredient / packaging / resale, build-import.ts) is the starting point and three
// kinds of memory adjust it, kept in `locations/{lid}/invoice-decisions/{sha256(key)}`:
//   • a PRODUCT decided «skip» is left out, a product decided «ingredient» is taken whatever it looks like;
//   • a SUPPLIER decided «skip» (key `supplier:<supplierKey>`) leaves out everything it sells — unless the
//     product itself was decided «ingredient», which wins;
//   • a product proposed as packaging or resale whose article code is the code of an ingredient the venue
//     already holds (same supplier, matched by VAT number) IS an ingredient — it was imported before.
// What a person ticks on the first screen (`overrides`, `supplierOverrides`) is applied at once, in memory;
// nothing is written until the import is confirmed (decisionChanges → planDecisionBatches).
//
// FULL port of js/orders/invoice-zip/selection.js: same exported names, same values, same behaviour input for
// input. Typing only differs. parity.spec.ts compares the exports.

import { normalizeVat } from '../vat-number';
import { IMPORTED_TYPE } from './build-import';
import type { ImportFile, ImportIngredient, ImportResult } from './build-import';
import { sha256Hex } from './sha256';

export const MAX_LABEL = 300;          // the rules' cap on `label`
export const MAX_DECISIONS_PER_BATCH = 20;
export const DECISION_SKIP = 'skip';
export const DECISION_INGREDIENT = 'ingredient';

export type Decision = typeof DECISION_SKIP | typeof DECISION_INGREDIENT;

export const supplierDecisionKey = (supplierKey: string): string => `supplier:${supplierKey}`;

const ids = new Map<string, string>();
// The document id of a decision key: 64 lowercase hex (what the rules ask for), stable for a given key.
export function decisionId(key: unknown): string {
  const text = String(key);
  let id = ids.get(text);
  if (!id) {
    id = sha256Hex(text);
    ids.set(text, id);
  }
  return id;
}

const labelOf = (text: unknown): string => String(text ?? '').trim().slice(0, MAX_LABEL);
const codeOf = (text: unknown): string => (typeof text === 'string' ? text.trim().toLowerCase() : '');

// A stored decision as the data layer hands it over. `unknown` fields: anything that is not well formed is ignored.
export interface DecisionEntry { id?: unknown; decision?: unknown }
export type DecisionsInput = ReadonlyMap<string, unknown> | readonly (DecisionEntry | null | undefined)[] | null | undefined;

// [{ id, decision }] (or a Map id → decision) → Map id → 'skip' | 'ingredient'. Anything else is ignored.
export function indexDecisions(list?: DecisionsInput): Map<string, Decision> {
  const out = new Map<string, Decision>();
  const entries: readonly (DecisionEntry | null | undefined)[] = list instanceof Map
    ? [...list].map(([id, decision]) => ({ id, decision }))
    : ((list || []) as readonly (DecisionEntry | null | undefined)[]);
  entries.forEach((d) => {
    const value = d && typeof d.decision === 'string' ? d.decision : '';
    if (d && typeof d.id === 'string' && /^[0-9a-f]{64}$/.test(d.id) && [DECISION_SKIP, DECISION_INGREDIENT].includes(value)) {
      out.set(d.id, value as Decision);
    }
  });
  return out;
}

// The venue's suppliers and ingredients, as far as the selection needs them.
export interface ExistingSupplier { id?: unknown; vatNumber?: unknown }
export interface ExistingIngredient { id?: unknown; supplierId?: unknown; supplierCode?: unknown; kind?: unknown }

// normalised VAT number → Set of the article codes of the ingredients (never packaging) the venue holds for it.
function knownCodes(suppliers?: readonly (ExistingSupplier | null | undefined)[] | null,
  ingredients?: readonly (ExistingIngredient | null | undefined)[] | null): Map<string, Set<string>> {
  const vatBySupplier = new Map<unknown, string>();
  (suppliers || []).forEach((s) => {
    const vat = s && normalizeVat(s.vatNumber);
    if (vat) vatBySupplier.set(s.id, vat);
  });
  const out = new Map<string, Set<string>>();
  (ingredients || []).forEach((i) => {
    if (!i || i.kind === 'packaging') return;
    const vat = vatBySupplier.get(i.supplierId);
    const code = codeOf(i.supplierCode);
    if (!vat || !code) return;
    if (!out.has(vat)) out.set(vat, new Set());
    (out.get(vat) as Set<string>).add(code);
  });
  return out;
}

export interface SelectOptions {
  decisions?: DecisionsInput;
  existingSuppliers?: readonly (ExistingSupplier | null | undefined)[] | null;
  existingIngredients?: readonly (ExistingIngredient | null | undefined)[] | null;
  overrides?: Record<string, string>;
  supplierOverrides?: Record<string, string>;
}

// A product the person can still decide about.
export interface SelectionItem {
  key: string;
  name: string;
  description: string;
  supplierName: string;
  canImport: boolean;
  checked: boolean;
  reason: string;
}

export interface SelectionByKey {
  base: string;
  natural: boolean;
  ticked: boolean;
  included: boolean;
  label: string;
  canImport: boolean;
}

export interface Selection {
  importFile: ImportFile;
  groups: {
    notImported: SelectionItem[];
    skippedByYou: SelectionItem[];
    skippedSuppliers: { key: string; name: string; products: number; checked: boolean }[];
    unreadable: SelectionItem[];
    toCheck: { key: string; name: string; supplierName: string; reason: string }[];
    skippedFiles: { name: string; reason: string }[];
  };
  counts: {
    invoices: number;
    excludedDocuments: number;
    skippedFiles: number;
    p7m: number;
    salesSkipped: number;
    suppliers: number;
    ingredients: number;
  };
  byKey: Map<string, SelectionByKey>;
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
export function selectImport(built: ImportResult, options: SelectOptions = {}): Selection {
  const decisions = indexDecisions(options.decisions);
  const overrides = options.overrides || {};
  const supplierOverrides = options.supplierOverrides || {};
  const known = knownCodes(options.existingSuppliers, options.existingIngredients);
  const entryByKey = new Map((built.candidates || []).map((entry): [string, ImportIngredient] => [entry.key, entry]));

  const groups: Selection['groups'] = {
    notImported: [], skippedByYou: [], skippedSuppliers: [], unreadable: [], toCheck: [], skippedFiles: [],
  };
  const byKey = new Map<string, SelectionByKey>();
  const supplierGroup = new Map<string, { key: string; name: string; products: number; checked: boolean }>();
  const taken: { row: ImportResult['products'][number]; entry: ImportIngredient }[] = [];

  for (const row of built.products || []) {
    const entry = entryByKey.get(row.key) || null;
    const stored = decisions.get(decisionId(row.key));
    const supplierStored = decisions.get(decisionId(supplierDecisionKey(row.supplierKey))) === DECISION_SKIP;
    const supplierSkipped = supplierStored && supplierOverrides[row.supplierKey] !== 'import';
    const vat = normalizeVat(row.vatNumber);
    const promoted = Boolean(entry) && Boolean(vat) && codeOf(row.supplierCode) !== ''
      && Boolean(known.get(vat)?.has(codeOf(row.supplierCode)));
    const natural = row.type === IMPORTED_TYPE || promoted;

    let base: string;
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

    const item: SelectionItem = {
      key: row.key, name: row.name, description: row.description, supplierName: row.supplierName,
      canImport: Boolean(entry), checked: ticked,
      // Why a product that cannot be turned into an ingredient is not offered (build-import.ts `unreadableReason`).
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
    if (included) taken.push({ row, entry: entry as ImportIngredient });
  }
  groups.skippedSuppliers = [...supplierGroup.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

  const ingredients = taken.map((t) => t.entry).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const suppliers = new Map<string, { key: string; vatNumber: string; name: string }>();
  taken.forEach(({ row }) => suppliers.set(row.supplierKey, { key: row.supplierKey, vatNumber: row.vatNumber, name: row.supplierName }));
  const rowOf = new Map((built.products || []).map((row): [string, typeof row] => [row.key, row]));
  ingredients.filter((i) => i.priceCheck).forEach((i) => {
    const row = rowOf.get(i.key);
    groups.toCheck.push({ key: i.key, name: i.name, supplierName: row ? row.supplierName : '', reason: i.priceCheck as string });
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

export interface DecisionChangeInput {
  selection: Selection | null | undefined;
  decisions?: DecisionsInput;
  overrides?: Record<string, string>;
  supplierOverrides?: Record<string, string>;
  supplierSkips?: readonly { key: string; name: unknown }[];
  itemSkips?: readonly { key: string; label: unknown }[];
}

export interface DecisionChanges {
  set: { id: string; key: string; decision: Decision; label: string }[];
  remove: string[];
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
}: DecisionChangeInput): DecisionChanges {
  const stored = indexDecisions(decisions);
  const actions = new Map<string, { key: string; decision: Decision; label: string } | null>();   // id → { key, decision, label } | null (remove)
  const setTo = (key: string, decision: Decision, label: unknown): void => {
    actions.set(decisionId(key), { key, decision, label: labelOf(label) });
  };
  const remove = (key: string): void => { actions.set(decisionId(key), null); };

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

  const set: DecisionChanges['set'] = [];
  const removed: string[] = [];
  actions.forEach((action, id) => {
    if (action) {
      if (stored.get(id) !== action.decision) set.push({ id, ...action });
    } else if (stored.has(id)) {
      removed.push(id);
    }
  });
  return { set, remove: removed };
}

// One write of a batch: exactly what the rules accept.
export type DecisionOperation =
  | { type: 'set'; id: string; data: { bakery: string; decision: Decision; label: string; updatedAt: string } }
  | { type: 'delete'; id: string };

// The changes → batches of at most 20 operations, each { type: 'set', id, data } or { type: 'delete', id }.
// `data` is exactly what the rules accept: { bakery, decision, label (≤300), updatedAt (ISO text) }.
export function planDecisionBatches(changes: DecisionChanges,
  { bakery, nowIso }: { bakery: string; nowIso: unknown }): DecisionOperation[][] {
  const ops: DecisionOperation[] = [
    ...changes.set.map((c): DecisionOperation => ({
      type: 'set', id: c.id, data: { bakery, decision: c.decision, label: labelOf(c.label), updatedAt: String(nowIso) },
    })),
    ...changes.remove.map((id): DecisionOperation => ({ type: 'delete', id })),
  ];
  const batches: DecisionOperation[][] = [];
  for (let i = 0; i < ops.length; i += MAX_DECISIONS_PER_BATCH) batches.push(ops.slice(i, i + MAX_DECISIONS_PER_BATCH));
  return batches;
}
