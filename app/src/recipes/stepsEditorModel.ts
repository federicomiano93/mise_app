import { MAX_END_NOTE, MAX_SPEED_TEXT, MAX_STEPS, MAX_STEP_TEXT, normalizeEndNote, normalizeSeconds, normalizeSteps, ridOf, unassignedRows, withRowIds } from '@mise/shared/guided-model';
import type { GuidedStep } from '@mise/shared/guided-model';
import type { CatalogueRecipe, CatalogueRow } from '@mise/shared/catalogue-model';

// The pure half of the mixing steps editor (a port of the working-copy part of js/catalogue/guided-editor.js). Everything
// here takes a working copy and returns a new one; a function that changes nothing returns the very same object, so the
// screen can tell «nothing happened» from «something changed» with ===.

// A step in the working copy. `key` is the screen's own handle (React's key, and what a focus is owed to): a step has no id
// in the database ON PURPOSE (guided-model.ts), so this one is never saved.
export type EditStep = GuidedStep & { readonly key: number };

export type StepsWorking = {
  // The recipe's rows WITH their ids, minted into this copy once (withRowIds): each tick box names one of them.
  readonly rows: readonly CatalogueRow[];
  readonly steps: readonly EditStep[];
  readonly endNote: string;
  readonly nextKey: number;
};

export { MAX_END_NOTE, MAX_SPEED_TEXT, MAX_STEPS, MAX_STEP_TEXT };

// The copy a person works on, taken ONCE from the recipe: its rows (ids minted into the copy, never into the recipe), its
// steps as the normaliser reads them (each with a rows array of its own) and its closing message.
export function stepsWorkingFrom(recipe: Pick<CatalogueRecipe, 'ingredients' | 'steps' | 'endNote'>): StepsWorking {
  const steps = normalizeSteps(recipe.steps).map((step, index): EditStep => ({ ...step, rows: step.rows.slice(), key: index + 1 }));
  return {
    rows: withRowIds(recipe.ingredients) as CatalogueRow[],
    steps,
    endNote: normalizeEndNote(recipe.endNote),
    nextKey: steps.length + 1,
  };
}

// «4», «30»: a box's text as a whole number between 0 and `max`. Junk, a negative and a fraction are never NaN: they read as 0
// (the original's clampInt).
export function clampInt(value: unknown, max: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
}

export const MAX_MINUTES = 720;
export const MAX_SECONDS_PART = 59;

// The two timer boxes' text for a step's seconds: a box with nothing in it shows empty rather than 0.
export function timeBoxes(seconds: number): { minutes: string; seconds: string } {
  const whole = normalizeSeconds(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return { minutes: minutes > 0 ? String(minutes) : '', seconds: rest > 0 ? String(rest) : '' };
}

// The seconds the two boxes' texts stand for.
export function secondsFromBoxes(minutes: unknown, seconds: unknown): number {
  return normalizeSeconds(clampInt(minutes, MAX_MINUTES) * 60 + clampInt(seconds, MAX_SECONDS_PART));
}

function mapStep(working: StepsWorking, key: number, change: (step: EditStep) => EditStep): StepsWorking {
  let touched = false;
  const steps = working.steps.map(step => {
    if (step.key !== key) return step;
    const next = change(step);
    if (next !== step) touched = true;
    return next;
  });
  return touched ? { ...working, steps } : working;
}

export const setStepText = (working: StepsWorking, key: number, text: string): StepsWorking =>
  mapStep(working, key, step => (step.text === text ? step : { ...step, text }));

export const setStepSpeed = (working: StepsWorking, key: number, speed: string): StepsWorking =>
  mapStep(working, key, step => (step.speed === speed ? step : { ...step, speed }));

export function setStepTime(working: StepsWorking, key: number, minutes: unknown, seconds: unknown): StepsWorking {
  const total = secondsFromBoxes(minutes, seconds);
  return mapStep(working, key, step => (step.seconds === total ? step : { ...step, seconds: total }));
}

// Ticking adds the row once (a row named twice would be added twice); unticking takes it away.
export function setStepRow(working: StepsWorking, key: number, rid: string, on: boolean): StepsWorking {
  return mapStep(working, key, step => {
    if (on) return step.rows.includes(rid) ? step : { ...step, rows: [...step.rows, rid] };
    return step.rows.includes(rid) ? { ...step, rows: step.rows.filter(other => other !== rid) } : step;
  });
}

export const setEndNote = (working: StepsWorking, endNote: string): StepsWorking =>
  working.endNote === endNote ? working : { ...working, endNote };

export const canAddStep = (working: StepsWorking): boolean => working.steps.length < MAX_STEPS;

// A new empty step at the end. At the cap nothing is added (the screen says why).
export function addStep(working: StepsWorking): StepsWorking {
  if (!canAddStep(working)) return working;
  const step: EditStep = { key: working.nextKey, text: '', rows: [], seconds: 0, speed: '' };
  return { ...working, steps: [...working.steps, step], nextKey: working.nextKey + 1 };
}

export function moveStep(working: StepsWorking, key: number, delta: -1 | 1): StepsWorking {
  const from = working.steps.findIndex(step => step.key === key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= working.steps.length) return working;
  const steps = working.steps.slice();
  const [moved] = steps.splice(from, 1);
  if (moved) steps.splice(to, 0, moved);
  return { ...working, steps };
}

export function removeStep(working: StepsWorking, key: number): StepsWorking {
  if (!working.steps.some(step => step.key === key)) return working;
  return { ...working, steps: working.steps.filter(step => step.key !== key) };
}

// What the screen says under the summary line.
export type RowCheck =
  | { readonly kind: 'no-steps' }
  | { readonly kind: 'all-in' }
  | { readonly kind: 'missing'; readonly labels: readonly string[] };

// The safety net of the whole feature (guided-model.unassignedRows): a named row in no step. Read at every draw, so it
// follows a box as it is ticked. A WARNING, never a block (dusting flour is legitimate).
export function rowCheck(working: StepsWorking): RowCheck {
  if (working.steps.length === 0) return { kind: 'no-steps' };
  const missed = unassignedRows<CatalogueRow>({ ingredients: working.rows, steps: working.steps });
  if (missed.length === 0) return { kind: 'all-in' };
  return { kind: 'missing', labels: missed.map(row => row.label) };
}

export const totalSeconds = (working: StepsWorking): number => working.steps.reduce((sum, step) => sum + step.seconds, 0);

// The rows a tick box can name: those with a label and an id (every row has one in the copy).
export const tickableRows = (working: StepsWorking): readonly { readonly index: number; readonly rid: string; readonly label: string }[] =>
  working.rows.flatMap((row, index) => {
    const rid = ridOf(row);
    const label = String(row.label || '').trim();
    return rid !== '' && label !== '' ? [{ index, rid, label }] : [];
  });

// What Save hands the store: the steps as the normaliser reads them (an empty step is dropped) and the closing message.
export function procedureOf(working: StepsWorking): { steps: GuidedStep[]; endNote: string; rows: readonly Readonly<Record<string, unknown>>[] } {
  return {
    steps: normalizeSteps(working.steps.map(({ key: _key, ...step }) => step)),
    endNote: normalizeEndNote(working.endNote),
    // The very rows of the copy, handed to the store as the plain records it reads (a row is an interface here).
    rows: working.rows as unknown as readonly Readonly<Record<string, unknown>>[],
  };
}
