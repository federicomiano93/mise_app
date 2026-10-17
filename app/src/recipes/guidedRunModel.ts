import { unitOf } from '@mise/shared/catalogue-model';
import type { CatalogueRow } from '@mise/shared/catalogue-model';
import { amountsFor, stepRows, timerState, unassignedRows } from '@mise/shared/guided-model';
import type { GuidedStep, StepRow, TimerState } from '@mise/shared/guided-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { amountNumber, unitWord } from './recipeAmounts';
import type { GuidedSession, GuidedSnapshot } from './guidedSession';

// The guided mix's state, with no React in it (the pure half of js/catalogue/guided-run.js).
//
// ⚠️ NOTHING HERE COUNTS SECONDS. A step's timer is the wall-clock instant it ENDS (`endsAt`); everything — running,
// finished, how long ago — is a comparison with the clock handed in as `now`. A backgrounded phone throttles or freezes the
// page, so a decrementing counter would come back showing a time that never happened.

type Translate = (key: MessageKey, params?: MessageParams) => string;

// What «+1 min» adds.
export const EXTRA_MS = 60 * 1000;
// How often the screen repaints the clock. It only repaints: the time is read from the clock each time.
export const TICK_MS = 250;

export interface RunState {
  // The step being done, 0-based, inside the snapshot's steps.
  readonly index: number;
  // The instant the running timer ends; 0 when none is running.
  readonly endsAt: number;
  // The timer the alarm has already sounded for, so it rings once per step and not once per repaint.
  readonly alarmedFor: number;
  // ⚠️ WHETHER *THIS* STEP CHANGED GEAR, REMEMBERED FOR THE WHOLE STEP — not just for the paint that announced it, or the
  // badge would vanish at the exact moment the timer runs out and somebody picks the phone up to look at it. The FLASH is
  // once (the badge is drawn anew with each step); the mark lasts as long as the step does.
  readonly speedChanged: boolean;
  readonly finished: boolean;
}

// A run picking up a saved session: the stored step and the stored timer. ⚠️ NOTHING IS ANNOUNCED: «we do not know what
// came before» is not «the same», and shouting «it changed!» about a step nobody saw is the same failure as an alarm that
// rings for nothing.
export function runFrom(session: Pick<GuidedSession, 'stepIndex' | 'endsAt'>): RunState {
  const endsAt = Number(session.endsAt);
  return { index: Number(session.stepIndex), endsAt: endsAt > 0 ? endsAt : 0, alarmedFor: 0, speedChanged: false, finished: false };
}

export function timerOf(state: RunState, now: number): TimerState {
  return timerState(state.endsAt, now);
}

// «Start the timer»: the timer of the step on screen begins now. Nothing for a step with no timer.
export function startTimer(state: RunState, step: GuidedStep, now: number): RunState {
  if (state.finished || step.seconds <= 0) return state;
  return { ...state, endsAt: now + step.seconds * 1000, alarmedFor: 0 };
}

// «+1 min» while a timer runs.
export function addMinute(state: RunState): RunState {
  if (state.finished || state.endsAt <= 0) return state;
  return { ...state, endsAt: state.endsAt + EXTRA_MS };
}

// «Step done», «Skip the timer», «Done early» and «Done — finish»: on to the next step, or the end. ⚠️ THE SPEED IS COMPARED
// WITH THE STEP JUST LEFT, which this run saw — it is the previous step's own, never a guess.
export function advance(state: RunState, steps: readonly GuidedStep[]): RunState {
  if (state.finished) return state;
  if (state.index >= steps.length - 1) return { ...state, endsAt: 0, alarmedFor: 0, speedChanged: false, finished: true };
  const before = steps[state.index];
  const after = steps[state.index + 1];
  return {
    index: state.index + 1,
    endsAt: 0,
    alarmedFor: 0,
    speedChanged: before !== undefined && after !== undefined && before.speed !== after.speed,
    finished: false,
  };
}

// The tick found the timer finished and has not yet rung for it: the alarm is due.
export function alarmDue(state: RunState, now: number): boolean {
  return !state.finished && timerState(state.endsAt, now) === 'finished' && state.endsAt !== state.alarmedFor;
}

export function rung(state: RunState): RunState {
  return state.alarmedFor === state.endsAt ? state : { ...state, alarmedFor: state.endsAt };
}

// What is saved after every change (nothing once the mix is finished: the session is cleared then).
export function sessionOf(state: RunState, recipeId: string, snapshot: GuidedSnapshot, startedAt: number): GuidedSession {
  return { recipeId, snapshot, stepIndex: state.index, endsAt: state.endsAt, startedAt };
}

export type Controls = 'start-timer' | 'running' | 'step-done' | 'done-finish';

// Which buttons the step shows. A step with a timer: not started → Start the timer (+ Skip the timer), running → the wait
// (+ +1 min and Done early); a timer that is up, or no timer at all, → Step done — and on the last step, Done — finish.
export function controlsFor(step: GuidedStep, state: RunState, steps: readonly GuidedStep[], now: number): Controls {
  const timer = timerOf(state, now);
  if (step.seconds > 0 && timer === 'idle') return 'start-timer';
  if (timer === 'running') return 'running';
  return state.index >= steps.length - 1 ? 'done-finish' : 'step-done';
}

// One ingredient line as it is drawn: name left, number and unit right. A «to taste» row has no number and says the words; a
// row whose ingredient has been deleted keeps its place and says so, with no number and no unit (dropping it would show a
// step with one fewer ingredient than it was written with, and nothing would say why).
export interface RunLine {
  readonly key: string;
  readonly label: string;
  readonly num: string;
  readonly unit: string;
  readonly missing: boolean;
}

export function lineOf(row: StepRow, t: Translate, locale: string): RunLine {
  return {
    key: row.rid,
    label: row.label,
    num: row.amount === null ? '' : amountNumber(row.amount, row.unit, locale),
    unit: row.missing ? '' : row.amount === null ? unitWord(t, 'to taste') : unitWord(t, row.unit),
    missing: row.missing,
  };
}

// The amounts of the whole snapshot at the batch it was started with: the recipe screen's own scaling (shared amountsFor).
export function snapshotAmounts(snapshot: GuidedSnapshot): (number | null)[] {
  return amountsFor(snapshot, snapshot.targetGrams);
}

// The lines of one step.
export function stepLines(step: GuidedStep, snapshot: GuidedSnapshot, amounts: readonly (number | null)[], t: Translate, locale: string): RunLine[] {
  return stepRows(step, snapshot, amounts, t('cat.noLongerInThe')).map(row => lineOf(row, t, locale));
}

// The rows no step ever mentioned, with their amounts: the end of the run's warning (the safety net of the whole feature).
export function missedLines(snapshot: GuidedSnapshot, amounts: readonly (number | null)[], t: Translate, locale: string): RunLine[] {
  return unassignedRows<CatalogueRow>(snapshot).map((row, order) => {
    const amount = amounts[snapshot.ingredients.indexOf(row)] ?? null;
    return {
      key: `${row.rid ?? ''}:${order}`,
      label: row.label,
      num: amount === null ? '' : amountNumber(amount, unitOf(row), locale),
      unit: amount === null ? unitWord(t, 'to taste') : unitWord(t, unitOf(row)),
      missing: false,
    };
  });
}
