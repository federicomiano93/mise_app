import { describe, expect, it } from 'vitest';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import type { GuidedStep } from '@mise/shared/guided-model';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';
import { EXTRA_MS, addMinute, advance, alarmDue, controlsFor, lineOf, missedLines, rung, runFrom, sessionOf, snapshotAmounts, startTimer, stepLines, timerOf } from './guidedRunModel';
import { snapshotOf } from './guidedSession';

const t = (key: MessageKey): string => {
  const message = en[key];
  return typeof message === 'string' ? message : message.other;
};

const step = (fields: Partial<GuidedStep> = {}): GuidedStep => ({ text: 'Mix', rows: [], seconds: 0, speed: '', ...fields });
const NOW = 1_800_000_000_000;

describe('picking a run up', () => {
  it('starts at the stored step with the stored timer, and announces nothing', () => {
    expect(runFrom({ stepIndex: 2, endsAt: NOW + 5000 })).toEqual({ index: 2, endsAt: NOW + 5000, alarmedFor: 0, speedChanged: false, finished: false });
  });

  it('reads a missing or junk timer as none', () => {
    expect(runFrom({ stepIndex: 0, endsAt: 0 }).endsAt).toBe(0);
    expect(runFrom({ stepIndex: 0, endsAt: -4 }).endsAt).toBe(0);
    expect(runFrom({ stepIndex: 0, endsAt: Number.NaN }).endsAt).toBe(0);
  });
});

describe('the timer', () => {
  const base = runFrom({ stepIndex: 0, endsAt: 0 });

  it('starts as the instant it ends, never as a count', () => {
    const started = startTimer(base, step({ seconds: 90 }), NOW);
    expect(started.endsAt).toBe(NOW + 90_000);
    expect(timerOf(started, NOW)).toBe('running');
    expect(timerOf(started, NOW + 89_999)).toBe('running');
    expect(timerOf(started, NOW + 90_000)).toBe('finished');
  });

  it('does not start for a step with no timer', () => {
    expect(startTimer(base, step({ seconds: 0 }), NOW)).toBe(base);
  });

  it('adds a minute to the end, only while a timer is set', () => {
    const started = startTimer(base, step({ seconds: 10 }), NOW);
    expect(addMinute(started).endsAt).toBe(NOW + 10_000 + EXTRA_MS);
    expect(addMinute(base)).toBe(base);
  });

  it('is idle until started, running, then finished', () => {
    expect(timerOf(base, NOW)).toBe('idle');
  });
});

describe('moving on', () => {
  const steps = [step({ speed: '1' }), step({ speed: '1' }), step({ speed: '2' }), step({ speed: '' })];

  it('goes to the next step with no timer and no ring owed', () => {
    const running = { ...runFrom({ stepIndex: 0, endsAt: NOW + 1000 }), alarmedFor: NOW + 1000 };
    const next = advance(running, steps);
    expect(next).toMatchObject({ index: 1, endsAt: 0, alarmedFor: 0, finished: false });
  });

  it('⚠️ marks a change of speed against the step just left, and only a change', () => {
    expect(advance(runFrom({ stepIndex: 0, endsAt: 0 }), steps).speedChanged).toBe(false);
    expect(advance(runFrom({ stepIndex: 1, endsAt: 0 }), steps).speedChanged).toBe(true);
    expect(advance(runFrom({ stepIndex: 2, endsAt: 0 }), steps).speedChanged).toBe(true);
  });

  it('finishes after the last step', () => {
    const last = advance(runFrom({ stepIndex: 3, endsAt: NOW + 5 }), steps);
    expect(last).toMatchObject({ finished: true, endsAt: 0 });
    expect(advance(last, steps)).toBe(last);
  });

  it('a run of one step finishes at once', () => {
    expect(advance(runFrom({ stepIndex: 0, endsAt: 0 }), [step()]).finished).toBe(true);
  });
});

describe('the alarm', () => {
  const steps = [step({ seconds: 10 }), step()];

  it('is due once the timer is up, and once only per timer', () => {
    const started = startTimer(runFrom({ stepIndex: 0, endsAt: 0 }), steps[0]!, NOW);
    expect(alarmDue(started, NOW + 9_999)).toBe(false);
    expect(alarmDue(started, NOW + 10_000)).toBe(true);
    const after = rung(started);
    expect(alarmDue(after, NOW + 20_000)).toBe(false);
  });

  it('is due again for a timer that was extended and ran out again', () => {
    const after = rung(startTimer(runFrom({ stepIndex: 0, endsAt: 0 }), steps[0]!, NOW));
    const extended = addMinute({ ...after, endsAt: after.endsAt });
    expect(alarmDue(extended, NOW + 10_000 + EXTRA_MS)).toBe(true);
  });

  it('is due for a session picked up on a timer that ran out while the app was closed', () => {
    expect(alarmDue(runFrom({ stepIndex: 0, endsAt: NOW - 1000 }), NOW)).toBe(true);
  });

  it('is never due with no timer, or after the end', () => {
    expect(alarmDue(runFrom({ stepIndex: 0, endsAt: 0 }), NOW)).toBe(false);
    expect(alarmDue({ ...runFrom({ stepIndex: 0, endsAt: NOW - 1 }), finished: true }, NOW)).toBe(false);
  });

  it('⚠️ a clock moved backwards puts the end back in the future: running again, not due', () => {
    const started = startTimer(runFrom({ stepIndex: 0, endsAt: 0 }), steps[0]!, NOW);
    expect(timerOf(started, NOW - 600_000)).toBe('running');
    expect(alarmDue(started, NOW - 600_000)).toBe(false);
  });
});

describe('which buttons a step shows', () => {
  const steps = [step({ seconds: 60 }), step(), step({ seconds: 30 })];
  const at = (index: number, endsAt = 0) => runFrom({ stepIndex: index, endsAt });

  it('Start the timer for a timed step whose timer has not begun', () => {
    expect(controlsFor(steps[0]!, at(0), steps, NOW)).toBe('start-timer');
  });
  it('waiting while it runs', () => {
    expect(controlsFor(steps[0]!, at(0, NOW + 5000), steps, NOW)).toBe('running');
  });
  it('Step done when the timer is up (the last step: Done — finish)', () => {
    expect(controlsFor(steps[0]!, at(0, NOW - 1), steps, NOW)).toBe('step-done');
    expect(controlsFor(steps[2]!, at(2, NOW - 1), steps, NOW)).toBe('done-finish');
  });
  it('Step done for a step with no timer', () => {
    expect(controlsFor(steps[1]!, at(1), steps, NOW)).toBe('step-done');
  });
  it('Done — finish on a last step with no timer', () => {
    expect(controlsFor(step(), at(0), [step()], NOW)).toBe('done-finish');
  });
});

describe('what the screen writes', () => {
  const recipe: CatalogueRecipe = {
    id: 'r', name: 'Pizza', lossPct: 0, endNote: '',
    ingredients: [
      { label: 'Flour', grams: 1000, unit: 'g', rid: 'rf' },
      { label: 'Salt', grams: 0, unit: 'to taste', rid: 'rs' },
      { label: 'Eggs', grams: 2, unit: 'pcs', rid: 're' },
      { label: 'Yeast', grams: 10, unit: 'g', rid: 'ry' },
    ],
    steps: [{ text: 'Mix', rows: ['rf', 'rs', 'gone'], seconds: 0, speed: '' }],
  };
  const snapshot = snapshotOf(recipe, 2000);

  it('scales the rows with the recipe screen’s own scaling', () => {
    const amounts = snapshotAmounts(snapshot);
    const lines = stepLines(snapshot.steps[0]!, snapshot, amounts, t, 'en');
    expect(lines.map(line => [line.label, line.num, line.unit, line.missing])).toEqual([
      ['Flour', '1980', 'g', false],
      ['Salt', '', 'to taste', false],
      ['No longer in the recipe', '', '', true],
    ]);
  });

  it('uses the base amounts when the batch is 0', () => {
    const base = snapshotOf(recipe, 0);
    const lines = stepLines(base.steps[0]!, base, snapshotAmounts(base), t, 'en');
    expect(lines[0]).toMatchObject({ label: 'Flour', num: '1000', unit: 'g' });
  });

  it('writes the decimal mark of the interface language', () => {
    const kilo: CatalogueRecipe = { id: 'k', name: 'K', lossPct: 0, ingredients: [{ label: 'Flour', grams: 1500, unit: 'kg', rid: 'rf' }], steps: [{ text: 'x', rows: ['rf'], seconds: 0, speed: '' }] };
    const snap = snapshotOf(kilo, 0);
    const line = (locale: string) => lineOf(
      { rid: 'rf', label: 'Flour', amount: 1.5, unit: 'kg', missing: false }, t, locale,
    );
    expect(line('en').num).toBe('1.5');
    expect(line('it').num).toBe('1,5');
    expect(snap.steps).toHaveLength(1);
  });

  it('lists the rows no step mentioned, with their amounts', () => {
    const amounts = snapshotAmounts(snapshot);
    const missed = missedLines(snapshot, amounts, t, 'en');
    expect(missed.map(line => [line.label, line.num, line.unit])).toEqual([
      ['Eggs', '4', 'pcs'],
      ['Yeast', '20', 'g'],
    ]);
  });

  it('keeps the session in the stored shape', () => {
    const state = runFrom({ stepIndex: 1, endsAt: NOW + 10 });
    expect(sessionOf(state, 'r', snapshot, NOW - 5)).toEqual({ recipeId: 'r', snapshot, stepIndex: 1, endsAt: NOW + 10, startedAt: NOW - 5 });
  });
});
