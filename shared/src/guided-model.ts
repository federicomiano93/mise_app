// guided-model.ts — a Catalogue recipe's mixing procedure, and the maths of running it. PURE.
//
// TypeScript port of js/catalogue/guided-model.js for Mise 2. Behaviour is identical, input for input:
// guided-model.spec.ts runs every test against BOTH files and compares the export list with the js/ file
// itself; odd-inputs.spec.ts feeds both the same strange values. It is an ADAPTED port, so parity.spec.ts does
// not pair it. No `Date.now()` is read from inside: every function that cares about time is handed `nowMs`.
//
// PORTED: everything. ADAPTED: the three functions that read the interface dictionary in the original (shared/
// never imports one) — `stepRows` takes the word for a row that is gone as a 4th argument; `overdueText` and
// `progressText` take the translator as their LAST argument (`GuidedTranslate`, same keys and params).
//
// ⚠️ A STEP HAS NO ID, ON PURPOSE: nothing outside the array points at a step, reordering is moving an element,
// and a run in progress is frozen against a SNAPSHOT of the recipe. The ingredient ROWS are the opposite case:
// a step points at a row by `rid`, never by name and never by position (renaming "Flour" must not drop it from
// the step that adds it; inserting a row at the top must not make the butter step ask for the yeast).

import { baseAmounts, scaleCatalogue, unitOf, weighableTotalGrams } from './catalogue-model';

// ── Limits ───────────────────────────────────────────────────────────────────
// The rules cap the number of steps (they cannot see inside one); everything about a step's CONTENTS is capped
// here, and here only.
export const MAX_STEPS = 100;
export const MAX_STEP_TEXT = 300;
export const MAX_SPEED_TEXT = 24;
// 12 hours: long enough for an overnight biga, short enough that a mistyped number is refused rather than
// starting a countdown nobody will ever see end.
export const MAX_STEP_SECONDS = 12 * 60 * 60;
// The closing message of the finish screen: one instruction somebody reads and acts on, not a paragraph.
export const MAX_END_NOTE = 300;

export interface GuidedStep {
  text: string;
  rows: string[];
  seconds: number;
  speed: string;
}

export interface StepRow {
  rid: string;
  label: string;
  amount: number | null;
  unit: string;
  missing: boolean;
}

export type TimerState = 'idle' | 'running' | 'finished';

export type GuidedKey = 'cat.timeIsUpJust' | 'cat.timeWasUpMinutes' | 'cat.timeWasUpHours' | 'cat.progress' | 'cat.progress.inline';

// The translate function the two spoken lines need: Mise 2's `t` (whose keys are a wider union) fits.
export type GuidedTranslate = (key: GuidedKey, params?: Readonly<Record<string, string | number>>) => string;

// ── Stable ingredient row ids ────────────────────────────────────────────────

// A row's id: a trimmed string, or '' when it has none.
export function ridOf(row: unknown): string {
  const r = row as { rid?: unknown } | null | undefined;
  const rid = r && r.rid != null ? String(r.rid).trim() : '';
  return rid || '';
}

// ⚠️ THE IDS ARE RANDOM, NOT SEQUENTIAL: two phones editing the same recipe offline would each mint `r4` for a
// DIFFERENT ingredient, and whichever synced last would silently rebind the other phone's step to the wrong
// row. With random ids that collision cannot happen; the step reports its row as missing instead.
const RID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function makeRowId(random: () => number = Math.random): string {
  let out = 'r';
  for (let i = 0; i < 8; i++) out += RID_ALPHABET[Math.floor(random() * RID_ALPHABET.length)];
  return out;
}

// Every ingredient row given a `rid`, assigning one only where it is missing or would collide. Called on SAVE,
// never on read: an id minted on the way in would be different on every load and would point at nothing the
// next time. Returns a new array; the input is never mutated. Rows that already have a unique id come back
// byte-identical (the SAME objects), so a recipe nobody has touched keeps exactly the shape it has today.
export function withRowIds<T>(ingredients: readonly T[] | unknown, makeId: () => string = makeRowId): (T | (T & { rid: string }))[] {
  if (!Array.isArray(ingredients)) return [];
  const seen = new Set<string>();
  return (ingredients as T[]).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const rid = ridOf(row);
    if (rid && !seen.has(rid)) { seen.add(rid); return row; }
    // No id, or a duplicate of one already used: mint a fresh one. Looping guards against the (vanishingly
    // unlikely) case of the generator repeating itself.
    let fresh = makeId();
    while (!fresh || seen.has(fresh)) fresh = makeId();
    seen.add(fresh);
    return { ...row, rid: fresh };
  });
}

// ── Normalising a procedure ──────────────────────────────────────────────────
// Junk-safe throughout: never throws, never yields NaN, never a negative time. Anything unreadable becomes the
// harmless value, because a corrupt step must degrade into "read this and tap Done", not a broken screen.

function normalizeText(raw: unknown, max: number): string {
  return String(raw == null ? '' : raw).trim().slice(0, max);
}

export function normalizeSeconds(raw: unknown): number {
  const n = Math.floor(Number(raw));
  // ⚠️ Infinity is JUNK, not "the maximum": it falls to no timer at all.
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_STEP_SECONDS);
}

// The rows a step adds: ids only, de-duplicated, order preserved (a row named twice would be added twice).
function normalizeRows(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const rid = String(value == null ? '' : value).trim();
    if (rid && !out.includes(rid)) out.push(rid);
  }
  return out;
}

// The recipe's closing message: about the DOUGH, so it belongs to the recipe and is shown once, at the end.
export function normalizeEndNote(raw: unknown): string {
  return normalizeText(raw, MAX_END_NOTE);
}

export function normalizeStep(raw: unknown): GuidedStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { text?: unknown; rows?: unknown; seconds?: unknown; speed?: unknown };
  return {
    text: normalizeText(r.text, MAX_STEP_TEXT),
    rows: normalizeRows(r.rows),
    seconds: normalizeSeconds(r.seconds),
    speed: normalizeText(r.speed, MAX_SPEED_TEXT),
  };
}

// A step with nothing in it says nothing and cannot be acted on, so it is dropped rather than shown blank.
export function isEmptyStep(step: GuidedStep | null | undefined): boolean {
  return !!step && !step.text && !step.rows.length && !step.seconds && !step.speed;
}

export function normalizeSteps(list: unknown): GuidedStep[] {
  if (!Array.isArray(list)) return [];
  return list
    .map(normalizeStep)
    .filter((step): step is GuidedStep => !!step && !isEmptyStep(step))
    .slice(0, MAX_STEPS);
}

function stepsOf(recipe: unknown): GuidedStep[] {
  const r = recipe as { steps?: unknown } | null | undefined;
  return normalizeSteps(r && r.steps);
}

export function hasProcedure(recipe: unknown): boolean {
  return stepsOf(recipe).length > 0;
}

// ── Which ingredients the procedure accounts for ─────────────────────────────
// ⚠️ THE SAFETY NET OF THE WHOLE FEATURE. Somebody following the procedure trusts it completely, so an
// ingredient that appears in no step is an ingredient that does not go in the bowl. That failure must never be
// silent: it is computed here, once, and shown in both the editor and the run.

type LooseRow = { label?: unknown } & Record<string, unknown>;

function ingredientsOf(recipe: unknown): LooseRow[] {
  const r = recipe as { ingredients?: unknown } | null | undefined;
  return (r && Array.isArray(r.ingredients)) ? r.ingredients as LooseRow[] : [];
}

// The recipe rows no step mentions, in recipe order. Rows with no name are ignored: the editor drops them on save.
export function unassignedRows<R = LooseRow>(recipe: unknown): R[] {
  const rows = ingredientsOf(recipe);
  const used = new Set<string>();
  for (const step of stepsOf(recipe)) {
    for (const rid of step.rows) used.add(rid);
  }
  return rows.filter(row => String(row.label || '').trim() && !used.has(ridOf(row))) as unknown as R[];
}

// The ids a step points at that the recipe no longer has (a row deleted after the procedure was written), so the
// step can SAY the ingredient is gone instead of quietly showing one fewer line.
export function missingRefs(recipe: unknown): string[] {
  const known = new Set(ingredientsOf(recipe).map(ridOf).filter(Boolean));
  const out: string[] = [];
  for (const step of stepsOf(recipe)) {
    for (const rid of step.rows) if (!known.has(rid) && !out.includes(rid)) out.push(rid);
  }
  return out;
}

// ── What one step shows ──────────────────────────────────────────────────────

// The amounts for the whole recipe at the batch being made, aligned with recipe.ingredients.
// ⚠️ THIS CALLS THE CATALOGUE'S OWN scaleCatalogue / baseAmounts AND MUST GO ON DOING SO: a second scaling here
// would let the guided screen and the recipe screen disagree about how much flour goes in.
export function amountsFor(recipe: unknown, targetGrams: unknown): (number | null)[] {
  const target = Number(targetGrams);
  return (Number.isFinite(target) && target > 0 && weighableTotalGrams(recipe) > 0)
    ? scaleCatalogue(recipe, target)
    : baseAmounts(recipe);
}

// The lines one step puts on screen. `amount` is null for a 'to taste' row and for a missing one. A missing row
// keeps its place and says so — never omitted. ADAPTED: the word for it is `missingLabel`, the 4th argument.
export function stepRows(step: unknown, recipe: unknown, amounts: unknown, missingLabel: string): StepRow[] {
  const rows = ingredientsOf(recipe);
  const byRid = new Map<string, { row: LooseRow; i: number }>();
  rows.forEach((row, i) => {
    const rid = ridOf(row);
    if (rid && !byRid.has(rid)) byRid.set(rid, { row, i });
  });
  const named = (step as { rows?: unknown } | null | undefined)?.rows;
  const wanted = (step && Array.isArray(named)) ? named as string[] : [];
  return wanted.map((rid): StepRow => {
    const hit = byRid.get(rid);
    if (!hit) return { rid, label: missingLabel, amount: null, unit: '', missing: true };
    const amount = Array.isArray(amounts) ? amounts[hit.i] as number | null | undefined : null;
    return {
      rid,
      label: String(hit.row.label || '').trim(),
      amount: amount === undefined ? null : amount,
      unit: unitOf(hit.row),
      missing: false,
    };
  });
}

// ── The clock ────────────────────────────────────────────────────────────────
// ⚠️ NOTHING HERE COUNTS SECONDS. A step's timer is stored as the wall-clock instant it ENDS (`endsAt`) and
// everything is derived by comparing that to the clock: a backgrounded phone throttles or suspends the page, so a
// decrementing counter would drift or freeze. Comparing against the clock is right whatever the phone did.

export function remainingMs(endsAt: unknown, nowMs: unknown): number {
  const end = Number(endsAt);
  const now = Number(nowMs);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return 0;
  return end - now;
}

// 'idle' — no timer started; 'running' — still counting; 'finished' — it is due.
export function timerState(endsAt: unknown, nowMs: unknown): TimerState {
  const end = Number(endsAt);
  if (!Number.isFinite(end) || end <= 0) return 'idle';
  return remainingMs(end, nowMs) > 0 ? 'running' : 'finished';
}

// "04:00", or "1:05:00" once it passes an hour. Clamped at zero: a finished timer reads 00:00, never a negative.
export function formatDuration(seconds: unknown): string {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatRemaining(endsAt: unknown, nowMs: unknown): string {
  return formatDuration(remainingMs(endsAt, nowMs) / 1000);
}

// How long ago a timer ran out, said the way a person would say it. ADAPTED: the translator is the last argument.
// ⚠️ THIS EXISTS BECAUSE THE ALARM CANNOT ALWAYS RING: a suspended page makes no sound, and the app must never
// come back showing a tidy countdown as though nothing had happened.
export function overdueText(endsAt: unknown, nowMs: unknown, t: GuidedTranslate): string {
  const late = -remainingMs(endsAt, nowMs);
  if (!(late > 0)) return '';
  const mins = Math.floor(late / 60000);
  if (mins < 1) return t('cat.timeIsUpJust');
  if (mins < 60) return t('cat.timeWasUpMinutes', { n: mins });
  const hours = Math.floor(mins / 60);
  return t('cat.timeWasUpHours', { n: hours });
}

// ── Picking up an interrupted run ────────────────────────────────────────────

// 24 hours: longer than any single procedure including an overnight rest, short enough that a forgotten session
// never resurfaces as "today's dough".
export const RESUME_TTL_MS = 24 * 60 * 60 * 1000;

// Is a saved session still worth offering? It must know its recipe, hold a snapshot to run against, and be from
// the recent past. ⚠️ A CLOCK THAT HAS GONE BACKWARDS MAKES IT STALE, not fresh: "I cannot tell" must resolve to
// starting again, not to resuming a session whose timers cannot be trusted.
export function isResumable(saved: unknown, nowMs: unknown): boolean {
  if (!saved || typeof saved !== 'object') return false;
  const s = saved as { recipeId?: unknown; snapshot?: { steps?: unknown } | null; stepIndex?: unknown; startedAt?: unknown };
  if (!s.recipeId || !s.snapshot) return false;
  const steps = normalizeSteps(s.snapshot.steps);
  if (!steps.length) return false;
  const index = Number(s.stepIndex);
  if (!Number.isInteger(index) || index < 0 || index >= steps.length) return false;
  const started = Number(s.startedAt);
  const now = Number(nowMs);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return false;
  const age = now - started;
  return age >= 0 && age < RESUME_TTL_MS;
}

// "Step 4 of 9" — the line the resume offer leads with. ⚠️ TWO FORMS, AND THE CALLER SAYS WHICH (`inline`): the
// dictionary holds both cases instead of lower-casing a translated phrase. ADAPTED: the translator is last. (The
// defaulted options object keeps `length` at 2, as in the original.)
export function progressText(stepIndex: unknown, total: unknown, { inline = false }: { inline?: boolean } = {}, t: GuidedTranslate): string {
  const i = Number(stepIndex);
  const n = Number(total);
  if (!Number.isFinite(i) || !Number.isFinite(n) || n <= 0) return '';
  return t(inline ? 'cat.progress.inline' : 'cat.progress',
    { i: Math.min(Math.max(i + 1, 1), n), n });
}
