// price-changes-model.js — «Variazioni prezzi»: how a supplier's price moved between two invoices.
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

import { weekStart } from './work-week.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Dates (UTC arithmetic: a calendar day has no time zone) ──────────────────────────────────────

function parseDay(iso) {
  if (typeof iso !== 'string' || !DAY_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return Number.isNaN(ms) ? null : ms;
}

function isoOf(ms) {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(iso, days) {
  const ms = parseDay(iso);
  return ms === null ? '' : isoOf(ms + days * 86400000);
}

// ── Building the changes of ONE ingredient ───────────────────────────────────────────────────────

// invoice ids are digit strings that may be longer than a safe integer: compare by length, then text.
function compareDigits(a, b) {
  const x = String(a).replace(/^0+(?=\d)/, '');
  const y = String(b).replace(/^0+(?=\d)/, '');
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

function usable(point) {
  if (!point || typeof point !== 'object') return false;
  if (point.invoiceId === undefined || point.invoiceId === null || point.invoiceId === '') return false;
  if (!Number.isInteger(point.line) || point.line < 1) return false;
  if (parseDay(point.invoiceDate) === null) return false;
  const price = point.pricePerUnit;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false;
  return typeof point.priceUnit === 'string' && point.priceUnit !== '';
}

// ⚠️ TWO PER-PIECE PRICES ARE COMPARABLE ONLY WHEN THE PIECE IS THE SAME: the price of a piece of a 5 kg sack and
// of a 1 kg bag are not one price that moved. Both weights must be there and within 0.1% of each other; a missing
// weight is «not the same», never «equal» (refuse, don't guess).
export function sameUnitWeight(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number' || !(a > 0) || !(b > 0)) return false;
  return Math.abs(a - b) / Math.max(a, b) <= 0.001;
}

const codeKey = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

// `ingredient`: { id, supplierId, name }. `points`: { invoiceId, line, invoiceDate, pricePerUnit, priceUnit,
// unitWeightKg?, packCode?, pack? } in any order, possibly twice. Returns the documents to write (without
// `bakery` and `recordedAt`, which the writer stamps), each with its `id`.
// ⚠️ A PACK IS KNOWN BY ITS ARTICLE CODE, never by how a label is worded: oldPack / newPack are written only when
// both points carry a code and the two differ. A per-piece step across two piece sizes restarts the chain.
export function changesFromPoints(ingredient, points, { minPct = 0.5 } = {}) {
  const seen = new Set();
  const clean = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!usable(point)) continue;
    const key = `${String(point.invoiceId)}#${point.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ ...point, invoiceId: String(point.invoiceId) });
  }
  clean.sort((a, b) =>
    (a.invoiceDate < b.invoiceDate ? -1 : a.invoiceDate > b.invoiceDate ? 1 : 0)
    || compareDigits(a.invoiceId, b.invoiceId)
    || a.line - b.line);

  const out = [];
  for (let i = 1; i < clean.length; i += 1) {
    const prev = clean[i - 1];
    const next = clean[i];
    if (prev.priceUnit !== next.priceUnit) continue;
    if (next.priceUnit === 'pcs' && !sameUnitWeight(prev.unitWeightKg, next.unitWeightKg)) continue;
    if (next.pricePerUnit === prev.pricePerUnit) continue;
    const pct = Math.round(((next.pricePerUnit - prev.pricePerUnit) / prev.pricePerUnit) * 10000) / 100;
    if (!Number.isFinite(pct) || Math.abs(pct) < minPct) continue;
    const change = {
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
export function periodOf(kind, isoDate, weekStartsOn) {
  if (parseDay(isoDate) === null) return { kind: kind === 'week' ? 'week' : 'month', from: '', to: '' };
  if (kind === 'week') {
    const from = weekStart(isoDate, weekStartsOn);
    return { kind: 'week', from, to: addDays(from, 6) };
  }
  const [y, m] = isoDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { kind: 'month', from: `${String(y).padStart(4, '0')}-${mm}-01`, to: `${String(y).padStart(4, '0')}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

export function shiftPeriod(period, step, weekStartsOn) {
  if (!period || !period.from) return period;
  if (period.kind === 'week') {
    return periodOf('week', addDays(period.from, 7 * step), weekStartsOn);
  }
  const [y, m] = period.from.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1 + step, 1));
  return periodOf('month', isoOf(moved.getTime()), weekStartsOn);
}

export function periodContains(period, isoDate) {
  return Boolean(period && period.from) && isoDate >= period.from && isoDate <= period.to;
}

// «settembre 2026» / «29 set – 5 ott 2026». `language` is the INTERFACE language ('it' | 'en'): a date is
// read by the person reading the screen around it.
export function periodLabel(period, language) {
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

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' });

// Biggest rise first; biggest drop first. Anything with a non-finite pct is left out (never NaN).
export function summarize(changes) {
  const list = (Array.isArray(changes) ? changes : []).filter(c => c && Number.isFinite(c.pct) && c.pct !== 0);
  const increases = list.filter(c => c.pct > 0).sort((a, b) => b.pct - a.pct || byName(a, b));
  const decreases = list.filter(c => c.pct < 0).sort((a, b) => a.pct - b.pct || byName(a, b));
  return {
    increases,
    decreases,
    counts: { increases: increases.length, decreases: decreases.length, total: increases.length + decreases.length },
  };
}
