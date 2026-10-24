// price-changes-model.ts — «Variazioni prezzi»: how a supplier's price moved between two invoices.
//
// TypeScript port of js/orders/price-changes-model.js for Mise 2. Behaviour is identical, input for
// input: price-changes-model.spec.ts runs every test against BOTH files and parity.spec.ts compares
// their exports. The comments below are the ones the original paid for in bugs.
//
// PURE: no DOM, no Firestore, no dictionary, so every rule below is assertable (P15).
//
// A change is the step from one invoice price point of an ingredient to the NEXT one. The document is
// stamped with the NEWER invoice's date, because that is the day the owner learnt of the new price, and its
// id is derived from the invoice line, so importing the same invoice twice writes the same document
// (create-only in the rules: the second attempt is refused, never doubled).
//
// ⚠️ A CHANGE OF UNIT IS NOT A PRICE MOVE. €/kg → €/pcs compares two different things, so a unit switch
// restarts the chain instead of producing a percent that would read as a 900% rise.
// ⚠️ NEVER NaN: a point with a missing, non-numeric or non-positive price is skipped, not computed.

import { weekStart } from './work-week';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// One invoice price point of an ingredient. A point is data, so every field may be anything.
export interface PricePoint {
  invoiceId?: unknown;
  line?: unknown;
  invoiceDate?: unknown;
  pricePerUnit?: unknown;
  priceUnit?: unknown;
  unitWeightKg?: unknown;
  packCode?: unknown;
  pack?: unknown;
  [key: string]: unknown;
}

export interface PriceIngredient {
  id: string;
  supplierId?: unknown;
  name: string;
}

// The document written for one change (without `bakery` and `recordedAt`, which the writer stamps).
export interface PriceChange {
  id: string;
  ingredientId: string;
  name: string;
  priceUnit: string;
  oldPrice: number;
  newPrice: number;
  oldDate: string;
  date: string;
  invoiceId: string;
  line: number;
  pct: number;
  supplierId?: string;
  oldPack?: string;
  newPack?: string;
}

export interface Period {
  kind: string;
  from: string;
  to: string;
}

// ── Dates (UTC arithmetic: a calendar day has no time zone) ──────────────────────────────────────

function parseDay(iso: unknown): number | null {
  if (typeof iso !== 'string' || !DAY_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  return Number.isNaN(ms) ? null : ms;
}

function isoOf(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number): string {
  const ms = parseDay(iso);
  return ms === null ? '' : isoOf(ms + days * 86400000);
}

// ── Building the changes of ONE ingredient ───────────────────────────────────────────────────────

// invoice ids are digit strings that may be longer than a safe integer: compare by length, then text.
function compareDigits(a: unknown, b: unknown): number {
  const x = String(a).replace(/^0+(?=\d)/, '');
  const y = String(b).replace(/^0+(?=\d)/, '');
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

function usable(point: unknown): boolean {
  if (!point || typeof point !== 'object') return false;
  const p = point as PricePoint;
  if (p.invoiceId === undefined || p.invoiceId === null || p.invoiceId === '') return false;
  if (!Number.isInteger(p.line) || (p.line as number) < 1) return false;
  if (parseDay(p.invoiceDate) === null) return false;
  const price = p.pricePerUnit;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false;
  return typeof p.priceUnit === 'string' && p.priceUnit !== '';
}

// ⚠️ TWO PER-PIECE PRICES ARE COMPARABLE ONLY WHEN THE PIECE IS THE SAME: the price of a piece of a 5 kg sack and
// of a 1 kg bag are not one price that moved. Both weights must be there and within 0.1% of each other; a missing
// weight is «not the same», never «equal» (refuse, don't guess).
export function sameUnitWeight(a: unknown, b: unknown): boolean {
  if (typeof a !== 'number' || typeof b !== 'number' || !(a > 0) || !(b > 0)) return false;
  return Math.abs(a - b) / Math.max(a, b) <= 0.001;
}

const codeKey = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

// A point that passed `usable`, its invoice id already text.
interface CleanPoint extends PricePoint {
  invoiceId: string;
  line: number;
  invoiceDate: string;
  pricePerUnit: number;
  priceUnit: string;
}

// `ingredient`: { id, supplierId, name }. `points`: { invoiceId, line, invoiceDate, pricePerUnit, priceUnit,
// unitWeightKg?, packCode?, pack? } in any order, possibly twice. Returns the documents to write (without
// `bakery` and `recordedAt`, which the writer stamps), each with its `id`.
// ⚠️ A PACK IS KNOWN BY ITS ARTICLE CODE, never by how a label is worded: oldPack / newPack are written only when
// both points carry a code and the two differ. A per-piece step across two piece sizes restarts the chain.
export function changesFromPoints(
  ingredient: PriceIngredient,
  points?: unknown,
  { minPct = 0.5 }: { minPct?: number } = {},
): PriceChange[] {
  const seen = new Set<string>();
  const clean: CleanPoint[] = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!usable(point)) continue;
    const p = point as PricePoint;
    const key = `${String(p.invoiceId)}#${String(p.line)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ ...p, invoiceId: String(p.invoiceId) } as CleanPoint);
  }
  clean.sort((a, b) =>
    (a.invoiceDate < b.invoiceDate ? -1 : a.invoiceDate > b.invoiceDate ? 1 : 0)
    || compareDigits(a.invoiceId, b.invoiceId)
    || a.line - b.line);

  const out: PriceChange[] = [];
  for (let i = 1; i < clean.length; i += 1) {
    const prev = clean[i - 1] as CleanPoint;
    const next = clean[i] as CleanPoint;
    if (prev.priceUnit !== next.priceUnit) continue;
    if (next.priceUnit === 'pcs' && !sameUnitWeight(prev.unitWeightKg, next.unitWeightKg)) continue;
    if (next.pricePerUnit === prev.pricePerUnit) continue;
    const pct = Math.round(((next.pricePerUnit - prev.pricePerUnit) / prev.pricePerUnit) * 10000) / 100;
    if (!Number.isFinite(pct) || Math.abs(pct) < minPct) continue;
    const change: PriceChange = {
      id: `inv-${next.invoiceId}-${next.line}-${ingredient.id}`,
      ingredientId: ingredient.id,
      name: ingredient.name,
      priceUnit: next.priceUnit,
      oldPrice: prev.pricePerUnit,
      newPrice: next.pricePerUnit,
      oldDate: prev.invoiceDate,
      date: next.invoiceDate,
      invoiceId: next.invoiceId,
      line: next.line,
      pct,
    };
    if (typeof ingredient.supplierId === 'string' && ingredient.supplierId) change.supplierId = ingredient.supplierId;
    const oldCode = codeKey(prev.packCode);
    const newCode = codeKey(next.packCode);
    if (oldCode && newCode && oldCode !== newCode) {
      if (typeof prev.pack === 'string' && prev.pack) change.oldPack = prev.pack;
      if (typeof next.pack === 'string' && next.pack) change.newPack = next.pack;
    }
    out.push(change);
  }
  return out;
}

// ── Periods ──────────────────────────────────────────────────────────────────────────────────────

// The week or the calendar month that holds `isoDate`; both bounds inclusive. An unreadable date gives
// empty bounds rather than a made-up period.
export function periodOf(kind: string, isoDate: unknown, weekStartsOn?: string): Period {
  if (parseDay(isoDate) === null) return { kind: kind === 'week' ? 'week' : 'month', from: '', to: '' };
  const day = isoDate as string;
  if (kind === 'week') {
    const from = weekStart(day, weekStartsOn);
    return { kind: 'week', from, to: addDays(from, 6) };
  }
  const [y, m] = day.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { kind: 'month', from: `${String(y).padStart(4, '0')}-${mm}-01`, to: `${String(y).padStart(4, '0')}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

export function shiftPeriod(period: Period, step: number, weekStartsOn?: string): Period;
export function shiftPeriod(period: null | undefined, step: number, weekStartsOn?: string): null | undefined;
export function shiftPeriod(period: Period | null | undefined, step: number, weekStartsOn?: string): Period | null | undefined {
  if (!period || !period.from) return period;
  if (period.kind === 'week') {
    return periodOf('week', addDays(period.from, 7 * step), weekStartsOn);
  }
  const [y, m] = period.from.split('-').map(Number) as [number, number];
  const moved = new Date(Date.UTC(y, m - 1 + step, 1));
  return periodOf('month', isoOf(moved.getTime()), weekStartsOn);
}

export function periodContains(period: Period | null | undefined, isoDate: string): boolean {
  return Boolean(period && period.from) && isoDate >= (period as Period).from && isoDate <= (period as Period).to;
}

// «settembre 2026» / «29 set – 5 ott 2026». `language` is the INTERFACE language ('it' | 'en'): a date is
// read by the person reading the screen around it.
export function periodLabel(period: Period | null | undefined, language?: string): string {
  if (!period || !period.from) return '';
  const tag = language === 'it' ? 'it-IT' : 'en-GB';
  const from = parseDay(period.from);
  const to = parseDay(period.to);
  if (from === null || to === null) return '';
  if (period.kind === 'month') {
    return new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(from);
  }
  const sameYear = period.from.slice(0, 4) === period.to.slice(0, 4);
  const short = new Intl.DateTimeFormat(tag, {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC',
  });
  const full = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${short.format(from)} – ${full.format(to)}`;
}

// ── Reading them ─────────────────────────────────────────────────────────────────────────────────

interface Summarizable {
  name?: unknown;
  pct?: unknown;
}

const byName = (a: Summarizable, b: Summarizable): number =>
  String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' });

// Biggest rise first; biggest drop first. Anything with a non-finite pct is left out (never NaN).
export function summarize<T extends Summarizable>(changes?: readonly T[] | null): {
  increases: T[];
  decreases: T[];
  counts: { increases: number; decreases: number; total: number };
} {
  const list = (Array.isArray(changes) ? changes : []).filter(
    (c): c is T & { pct: number } => Boolean(c) && Number.isFinite(c.pct) && c.pct !== 0,
  );
  const increases = list.filter(c => c.pct > 0).sort((a, b) => b.pct - a.pct || byName(a, b));
  const decreases = list.filter(c => c.pct < 0).sort((a, b) => a.pct - b.pct || byName(a, b));
  return {
    increases,
    decreases,
    counts: { increases: increases.length, decreases: decreases.length, total: increases.length + decreases.length },
  };
}
