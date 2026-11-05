// log-model.ts — the WRITE half of the production log's data model: what Confirm builds and appends. PURE: no
// DOM, no Firebase, no storage.
//
// TypeScript PARTIAL port of js/log-model.js for Mise 2. Behaviour is identical, input for input, for
// everything ported: log-model.spec.ts (and the specs of log-confirm-link, log-linked-recipe and
// calculator-trays) run every test against BOTH files and compare each ported export with the js/ file itself;
// odd-inputs.spec.ts feeds both the same strange values. It is NOT paired in parity.spec.ts, because of what
// is left out.
//
// PORTED (everything a Confirm needs): `FOR_DAYS`, `buildSheet`, `buildLogText`, `recipeSnapshot`,
// `createLog`, `latestVersion`, `addVersion`, `setForDay`, `confirmTarget`, `DAY_START_HOUR`,
// `workDayIndex` and `typedTotalOf` (an edit keeps the typed total of the dough that was made, so the
// Calculator's re-calculation reads it; ported with its spec ahead of the rest of the edit half).
//
// LEFT OUT, for step 3c-3 (the Dough history): the list and edit half — `traysEditState`, `traysSheetRecipe`,
// `editRows`, `restoreVersion`, `migrateOldRecord` / `migrateOldLogs` (the legacy migration
// stays in the current app), `filterVisibleLogs`, `dayLabel` (it looks words up in the interface dictionary,
// `t()`) and `sortLogs`.
//
// `buildLogText` looks two words up with `t()` in the original. They come in as its fourth argument, read by
// the caller when drawing; the defaults are the English words, which is what the original answers when the
// interface is English.
//
// ⚠️ THE STORED DOCUMENT MUST STAY BYTE-IDENTICAL TO THE CURRENT APP'S. The current app and Mise 2 read each
// other's logs until the switch, so: the `text` is written in the author's interface language (the caller
// passes the words), the timestamps are the English ones of log-time.ts, and `createLog` still writes the
// placeholder `bakery: 'main'` — the data layer stamps the real venue id over it (Mise 2 must do that itself;
// it may never rely on the placeholder: `locations/{lid}/logs/{id}.bakery` is the open venue's id).
//
// THE MODEL
// Each log is its OWN document, so two logs of the same dough on the same day no longer overwrite each other.
// A log keeps an APPEND-ONLY chain of versions: editing never destroys the previous version, and restoring an
// old version appends a copy on top — the chain is never truncated or overwritten. The latest version is
// simply the last element.
//
//   log = { id, bakery, dough, recipeId, forDay: 'today'|'tomorrow', origin: 'calculator'|'manual',
//           createdAtMs, versions: [ version, ... ] }
//   version = { calculatedBy, at: { date, time }, kind: 'create'|'edit'|'restore', restoredFrom?,
//               items: [ line, ... ], occasional: [ occ, ... ], sheet, legacy?, text, recipe }
//   line = { id, name, clientName, qty, weightG, kind, crate, source }
//   occ  = { name, products: [ { name, qty, weightG, unit } ] }

import { scaleRecipe } from './calculator-dough-math';
import {
  recipeSpec, usesTrays, isProRata, normalizeTrays, normalizeTrayWeight, traysGrams,
} from './calculator-config';
import type { Crate } from './calculator-config';

export const FOR_DAYS: ForDay[] = ['today', 'tomorrow'];

export type ForDay = 'today' | 'tomorrow';

// The two words `buildLogText` writes into the text (`calc.occasionalClient`, `calc.extraDough`).
export interface LogTextWords {
  occasionalClient: string;
  extraDough: string;
}

export interface LogLine {
  id?: unknown;
  name?: unknown;
  clientName?: unknown;
  qty?: unknown;
  weightG?: unknown;
  kind?: unknown;
  crate?: Partial<Crate> | null;
}

export interface OccasionalClient {
  name?: unknown;
  products?: { name?: unknown; qty?: unknown; weightG?: unknown; unit?: unknown }[];
}

export interface SheetDivisor {
  names: unknown[];
  total: number;
  n: number;
  result: number;
}

export interface SheetCrate {
  name: unknown;
  count: number;
  eachBoxG: number;
}

// The calculator-sheet snapshot a version stores.
export interface LogSheet {
  dough: string;
  recipeId: unknown;
  param: { label: string; value: number } | null;
  total_g: number;
  extra_g: number;
  typed_g?: number;
  ingredients: { name: unknown; grams: number }[];
  divisor: SheetDivisor | null;
  crates: SheetCrate[];
  trays?: number;
  trayWeight_g?: number;
}

export interface LogVersion {
  calculatedBy?: unknown;
  at?: { date: string; time: string };
  kind?: 'create' | 'edit' | 'restore';
  restoredFrom?: number;
  items?: LogLine[];
  occasional?: OccasionalClient[];
  sheet?: LogSheet | null;
  legacy?: boolean;
  text?: string;
  recipe?: RecipeSnapshot | null;
  [extra: string]: unknown;
}

export interface Log {
  id: string;
  bakery: string;
  dough: string;
  recipeId: string;
  forDay: ForDay;
  origin: 'calculator' | 'manual';
  createdAtMs: number;
  versions: LogVersion[];
  [extra: string]: unknown;
}

export interface RecipeSnapshot {
  id: string;
  name: string;
  logic: string;
  trayWeight?: number;
  ingredients: { key: string; label: string; grams: number }[];
  leaveningKey: string | null;
  leaveningDefaultPct: number;
  baselinePct: number | null;
}

// Deep clone of plain data (no functions/dates), used to keep callers from mutating shared version objects
// when appending or restoring.
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// A recipe's display name for a log. Any non-empty string is kept (recipes are arbitrary, no fixed enum);
// blank falls back to a generic label.
function safeDough(d: unknown): string { const s = String(d == null ? '' : d).trim(); return s || 'Recipe'; }
function safeForDay(d: unknown): ForDay { return (FOR_DAYS as unknown[]).includes(d) ? d as ForDay : 'today'; }

// ── Sheet math (pure) ─────────────────────────────────────────────────────────
// Build the calculator-sheet snapshot from a flat list of order lines, the recipe and the dough parameter.
// `recipe` is the CONFIG recipe (id, name, logic, ingredients[{key,label,grams}], leaveningKey,
// leaveningDefaultPct, baselinePct, trayWeight). The target is computed by the recipe's logic (orders →
// items + extra; total → typed total; both → items + total + extra; trays → trays × tray weight; traysTotal →
// that + typed total), then the recipe is scaled to it with the unified scaleRecipe — so the stored sheet is
// faithful and independent of any later config change.
//   items:   [{ id, name, clientName, qty, weightG, kind, crate }]
//   divisor: { includedIds: [...], n: 0..4 }  (optional, display-only crate split)
//   trays:   whole trays for the 'trays' / 'traysTotal' logics; the tray weight is the recipe's own, and BOTH
//            are stored on the sheet (`trays`, `trayWeight_g`) so the log keeps what it was made with even if
//            the recipe's tray weight changes later.
export interface BuildSheetInput {
  recipe?: unknown;
  items?: unknown;
  extraGrams?: unknown;
  totalInput?: unknown;
  trays?: unknown;
  leaveningPct?: unknown;
  divisor?: { includedIds?: unknown; n?: unknown } | null;
}

export function buildSheet(
  { recipe, items, extraGrams = 0, totalInput = 0, trays = 0, leaveningPct, divisor }: BuildSheetInput,
): LogSheet {
  const rec = recipe as {
    logic?: string; trayWeight?: unknown; ingredients?: unknown; leaveningDefaultPct?: unknown; leaveningKey?: string;
    name?: unknown; id?: unknown;
  } | null | undefined;
  const lines = (Array.isArray(items) ? items : []) as LogLine[];
  const productsTotal = lines.reduce((s, it) => s + num(it.qty) * num(it.weightG), 0);
  const extra = Math.max(0, num(extraGrams));
  const typed = Math.max(0, num(totalInput));
  const logic = (rec && rec.logic) || 'orders';
  const trayCount = usesTrays(logic) ? normalizeTrays(trays) : 0;
  const trayWeight = normalizeTrayWeight(rec && rec.trayWeight);
  const total = logic === 'total' ? typed
    : logic === 'trays' ? traysGrams(rec, trayCount)
    : logic === 'traysTotal' ? traysGrams(rec, trayCount) + typed
    : logic === 'both' ? (productsTotal + typed + extra)
    : (productsTotal + extra);

  const recipeIngs = (rec && Array.isArray(rec.ingredients)) ? rec.ingredients as { key?: string; label?: unknown; grams?: unknown }[] : [];
  const pct = Number.isFinite(Number(leaveningPct)) ? Number(leaveningPct) : (rec ? num(rec.leaveningDefaultPct) : 0);
  const spec = recipeSpec(rec || {});
  if (isProRata(logic)) spec.leaveningKey = null; // pure pro-rata
  let amounts: number[] = [];
  if (total > 0 && recipeIngs.length) amounts = scaleRecipe(spec, total, pct);
  const ingredients = recipeIngs.map((ing, i) => ({ name: ing.label, grams: Math.round(num(amounts[i])) }));

  // The parameter line shown on the sheet: the leavening % when the recipe uses one.
  let paramOut: { label: string; value: number } | null = null;
  if (rec && rec.leaveningKey && (logic === 'orders' || logic === 'both')) {
    const lev = recipeIngs.find(g => g.key === rec.leaveningKey);
    paramOut = { label: (lev ? lev.label : 'Leavening') + ' %', value: pct };
  }

  // Divisor (display-only): sum the included lines that have a quantity, then split.
  let divisorOut: SheetDivisor | null = null;
  if (divisor && Array.isArray(divisor.includedIds) && divisor.includedIds.length) {
    const incl = lines.filter(it => (divisor.includedIds as unknown[]).includes(it.id) && num(it.qty) > 0);
    if (incl.length) {
      const dTotal = incl.reduce((s, it) => s + num(it.qty) * num(it.weightG), 0);
      const dnames: unknown[] = [];
      for (const it of incl) if (!dnames.includes(it.name)) dnames.push(it.name);
      const n = Math.max(0, Math.round(num(divisor.n)));
      divisorOut = { names: dnames, total: Math.round(dTotal), n, result: n > 0 ? Math.round(dTotal / n) : 0 };
    }
  }

  // Crate boxes (display-only): one per line that opted in and has a quantity.
  const crates: SheetCrate[] = [];
  for (const it of lines) {
    const qty = num(it.qty);
    if (qty <= 0 || !it.crate || !it.crate.show) continue;
    const perBox = num(it.crate.perBox);
    if (perBox <= 0) continue;
    crates.push({ name: it.name, count: Math.round((qty / perBox) * 10) / 10, eachBoxG: Math.round(perBox * num(it.weightG)) });
  }

  const sheet: LogSheet = {
    dough: rec ? safeDough(rec.name) : 'Recipe',
    recipeId: rec ? rec.id : '',
    param: paramOut,
    total_g: Math.round(total),
    extra_g: Math.round(extra),
    // The typed part of the target, kept so an edit can read it back exactly. Only for the logics that use a
    // typed total.
    ...(logic === 'total' || logic === 'both' ? { typed_g: Math.round(typed) } : {}),
    ingredients,
    divisor: divisorOut,
    crates,
  };
  // Only a trays dough carries these; a sheet saved with another logic stays as it was.
  if (usesTrays(logic)) { sheet.trays = trayCount; sheet.trayWeight_g = trayWeight; }
  return sheet;
}

// Human-readable grouped text (client header + indented product lines + extra), matching the old log text so
// sharing/preview keep the same look. `words` are the two interface words it writes (see the header).
export function buildLogText(
  items: unknown,
  occasional: unknown,
  extra: unknown,
  words: LogTextWords = { occasionalClient: 'Occasional client', extraDough: 'Extra dough: ' },
): string {
  const lines: string[] = [];
  const byClient = new Map<string, string[]>();
  const order: string[] = [];
  for (const it of ((items || []) as LogLine[])) {
    if (num(it.qty) <= 0) continue;
    const key = (it.clientName || 'Client') as string;
    if (!byClient.has(key)) { byClient.set(key, []); order.push(key); }
    (byClient.get(key) as string[]).push('  ' + it.name + ': ' + num(it.qty) + (it.kind === 'kg' ? ' kg' : ' pz'));
  }
  for (const key of order) {
    lines.push(key + ':');
    lines.push(...(byClient.get(key) as string[]));
  }
  for (const occ of ((occasional || []) as OccasionalClient[])) {
    const prods = (occ.products || []).filter(p => num(p.qty) > 0);
    if (!prods.length) continue;
    lines.push((occ.name || words.occasionalClient) + ':');
    for (const p of prods) lines.push('  ' + p.name + ': ' + num(p.qty) + (p.unit === 'kg' ? ' kg' : ' pz'));
  }
  const ex = extra as { grams?: unknown; value?: unknown; unit?: unknown } | null | undefined;
  if (ex && num(ex.grams) > 0) {
    lines.push(words.extraDough + (ex.value != null ? ex.value : num(ex.grams)) + ' ' + (ex.unit || 'g'));
  }
  return lines.join('\n');
}

// ── Freezing what a log was made with ─────────────────────────────────────────

// A compact copy of the recipe a log was calculated with, stored on the version so a later edit rebuilds the
// sheet with the doses of THAT day rather than today's.
//
// ⚠️ These are exactly the fields buildSheet and recipeSpec read. If buildSheet ever starts reading another
// one, add it here too or the freeze quietly loses a piece.
export function recipeSnapshot(recipe: unknown): RecipeSnapshot | null {
  if (!recipe || typeof recipe !== 'object') return null;
  const r = recipe as {
    id?: unknown; name?: unknown; logic?: string; trayWeight?: unknown; ingredients?: unknown; leaveningKey?: string;
    leaveningDefaultPct?: unknown; baselinePct?: unknown;
  };
  const baseline = Number(r.baselinePct);
  return {
    id: String(r.id || ''),
    name: safeDough(r.name),
    logic: r.logic || 'orders',
    // Only a trays recipe has a tray weight worth freezing; the other snapshots keep their shape.
    ...(usesTrays(r.logic) ? { trayWeight: normalizeTrayWeight(r.trayWeight) } : {}),
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients as { key?: unknown; label?: unknown; grams?: unknown }[] : [])
      .map(ing => ({ key: String(ing.key || ''), label: String(ing.label || ''), grams: num(ing.grams) })),
    leaveningKey: r.leaveningKey || null,
    leaveningDefaultPct: num(r.leaveningDefaultPct),
    baselinePct: Number.isFinite(baseline) ? baseline : null,
  };
}

// ── Log lifecycle (append-only) ───────────────────────────────────────────────

export interface NewLog {
  id: unknown;
  dough?: unknown;
  recipeId?: unknown;
  forDay?: unknown;
  version: LogVersion;
  createdAtMs?: unknown;
  origin?: unknown;
}

// A brand-new log with its first version. Each Confirm makes a NEW log — it never overwrites an existing one.
export function createLog({ id, dough, recipeId, forDay, version, createdAtMs, origin }: NewLog): Log {
  return {
    id: String(id),
    bakery: 'main',
    dough: safeDough(dough),
    recipeId: String(recipeId || ''),
    forDay: safeForDay(forDay),
    origin: origin === 'manual' ? 'manual' : 'calculator',
    createdAtMs: num(createdAtMs),
    versions: [clone(version)],
  };
}

// The typed total a saved version was made with, for a re-calculation (an edit changes quantities only and must
// keep this part). New sheets carry typed_g. The derivation below exists ONLY for 'both' sheets saved before
// typed_g: the typed part is what is left of total_g after the product lines (occasional ones included) and the
// extra. For 'total' the sheet's total_g IS the typed amount.
export function typedTotalOf(recipe: unknown, version: unknown): number {
  const logic = (recipe && (recipe as { logic?: string }).logic) || 'orders';
  const v = version as { sheet?: Record<string, unknown> | null; items?: LogLine[]; occasional?: OccasionalClient[] } | null | undefined;
  const sheet = (v && v.sheet) || null;
  if (!v || !sheet || (logic !== 'total' && logic !== 'both')) return 0;
  if (logic === 'total') return Math.max(0, num(sheet.total_g));
  if (Number.isFinite(Number(sheet.typed_g)) && sheet.typed_g !== null && sheet.typed_g !== '') return Math.max(0, num(sheet.typed_g));
  let products = 0;
  for (const it of (v.items || [])) products += num(it.qty) * num(it.weightG);
  for (const o of (v.occasional || [])) {
    for (const p of (o.products || [])) products += num(p.qty) * num(p.weightG);
  }
  return Math.max(0, Math.round(num(sheet.total_g) - products - num(sheet.extra_g)));
}

// The latest (current) version of a log — the last element of the append-only chain.
export function latestVersion(log: unknown): LogVersion | null {
  const l = log as { versions?: unknown } | null | undefined;
  const vs = l && Array.isArray(l.versions) ? l.versions as LogVersion[] : [];
  return vs.length ? vs[vs.length - 1] as LogVersion : null;
}

// Append a new version (an edit). Returns a NEW log object; the previous versions are preserved untouched —
// nothing is ever deleted.
export function addVersion(log: Log, version: LogVersion): Log {
  const next = clone(log);
  if (!Array.isArray(next.versions)) next.versions = [];
  next.versions.push(clone(version));
  return next;
}

// Change a log's target day (today/tomorrow) without touching its version history. Used when an edit
// re-confirms and the user picks a different Today/Tomorrow. Returns a NEW log object (pure); an invalid day
// keeps the existing one.
export function setForDay(log: Log, forDay: unknown): Log {
  const next = clone(log);
  next.forDay = (FOR_DAYS as unknown[]).includes(forDay) ? forDay as ForDay : next.forDay;
  return next;
}

// Decide whether a calculator Confirm should CREATE a new log or UPDATE an existing one. A tab confirms into
// the SAME log until Reset clears the link; if the linked log no longer exists (e.g. it was deleted), fall
// back to creating a fresh one.
export function confirmTarget({ linkedId, linkedExists }: { linkedId?: unknown; linkedExists?: unknown }): 'update' | 'create' {
  return (linkedId && linkedExists) ? 'update' : 'create';
}

// ── The work day (shared by the retention window and the new-day sweep) ───────
// A bakery's day does not end at midnight: a dough calculated at 23:30 and looked at again at 00:30 is the
// same night's work. So the day rolls over at 4am.
export const DAY_START_HOUR = 4;

// Which work day a moment belongs to, as a comparable integer.
// ⚠️ Built from the Y/M/D components rather than by dividing the timestamp: on the day the clocks change a
// day lasts 23 or 25 hours, and dividing shifts the date by one.
export function workDayIndex(ms: unknown): number {
  const d = new Date(num(ms));
  d.setHours(d.getHours() - DAY_START_HOUR);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
