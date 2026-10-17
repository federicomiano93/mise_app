import { describe, expect, it } from 'vitest';
import {
  MAX_STEPS, addStep, canAddStep, clampInt, moveStep, procedureOf, removeStep, rowCheck, secondsFromBoxes, setEndNote, setStepRow,
  setStepSpeed, setStepText, setStepTime, stepsWorkingFrom, tickableRows, timeBoxes, totalSeconds,
} from './stepsEditorModel';
import type { StepsWorking } from './stepsEditorModel';

const RECIPE = {
  ingredients: [
    { label: 'Flour', grams: 1000, unit: 'g' as const, rid: 'rf' },
    { label: 'Water', grams: 700, unit: 'g' as const },
    { label: '', grams: 5, unit: 'g' as const },
  ],
  steps: [
    { text: 'Mix', rows: ['rf', 'rf'], seconds: 90, speed: '1' },
    { text: '', rows: [], seconds: 0, speed: '' },
    { text: 'Rest', rows: [], seconds: 600, speed: '' },
  ],
  endNote: '  24 degrees ',
};

const fresh = (): StepsWorking => stepsWorkingFrom(RECIPE);

describe('the working copy', () => {
  it('mints a row id into the COPY and leaves the recipe’s rows alone', () => {
    const working = fresh();
    expect(working.rows[0]).toBe(RECIPE.ingredients[0]);
    expect(working.rows[1]?.rid).toMatch(/^r[a-z0-9]{8}$/);
    expect(RECIPE.ingredients[1]).not.toHaveProperty('rid');
  });

  it('reads the steps as the normaliser does, each with a rows array of its own and a key', () => {
    const working = fresh();
    expect(working.steps.map(({ text, rows, seconds, speed }) => ({ text, rows, seconds, speed }))).toEqual([
      { text: 'Mix', rows: ['rf'], seconds: 90, speed: '1' },
      { text: 'Rest', rows: [], seconds: 600, speed: '' },
    ]);
    expect(new Set(working.steps.map(step => step.key)).size).toBe(2);
    expect(working.steps[0]?.rows).not.toBe(RECIPE.steps[0]?.rows);
    expect(working.endNote).toBe('24 degrees');
  });

  it('copes with a recipe that has no procedure at all', () => {
    const working = stepsWorkingFrom({ ingredients: [], steps: undefined, endNote: undefined });
    expect(working.steps).toEqual([]);
    expect(working.endNote).toBe('');
    expect(working.rows).toEqual([]);
  });
});

describe('the timer boxes', () => {
  it('clamp: junk, a negative and a fraction read as 0 or whole numbers, never NaN', () => {
    expect(clampInt('abc', 59)).toBe(0);
    expect(clampInt('', 59)).toBe(0);
    expect(clampInt('-3', 59)).toBe(0);
    expect(clampInt('4.9', 59)).toBe(4);
    expect(clampInt('75', 59)).toBe(59);
    expect(clampInt(Infinity, 59)).toBe(0);
  });

  it('turn minutes and seconds into seconds, capped at twelve hours', () => {
    expect(secondsFromBoxes('4', '30')).toBe(270);
    expect(secondsFromBoxes('', '45')).toBe(45);
    expect(secondsFromBoxes('x', '-1')).toBe(0);
    expect(secondsFromBoxes('9999', '99')).toBe(43200);
    expect(secondsFromBoxes('720', '59')).toBe(43200);
  });

  it('show empty for a zero', () => {
    expect(timeBoxes(0)).toEqual({ minutes: '', seconds: '' });
    expect(timeBoxes(270)).toEqual({ minutes: '4', seconds: '30' });
    expect(timeBoxes(45)).toEqual({ minutes: '', seconds: '45' });
    expect(timeBoxes(120)).toEqual({ minutes: '2', seconds: '' });
  });
});

describe('editing a step', () => {
  it('changes the text, the speed and the time of that step only, and hands back the same object when nothing changes', () => {
    const working = fresh();
    const [first, second] = working.steps;
    const typed = setStepText(working, first!.key, 'Knead');
    expect(typed.steps[0]?.text).toBe('Knead');
    expect(typed.steps[1]).toBe(second);
    expect(setStepText(typed, first!.key, 'Knead')).toBe(typed);
    expect(setStepSpeed(working, second!.key, '2').steps[1]?.speed).toBe('2');
    expect(setStepTime(working, first!.key, '2', '5').steps[0]?.seconds).toBe(125);
    expect(setStepTime(working, first!.key, '1', '30')).toBe(working);
    expect(setStepText(working, 999, 'x')).toBe(working);
  });

  it('ticks a row once and unticks it', () => {
    const working = fresh();
    const key = working.steps[1]!.key;
    const rid = working.rows[1]!.rid as string;
    const ticked = setStepRow(working, key, rid, true);
    expect(ticked.steps[1]?.rows).toEqual([rid]);
    expect(setStepRow(ticked, key, rid, true)).toBe(ticked);
    expect(setStepRow(ticked, key, rid, false).steps[1]?.rows).toEqual([]);
    expect(setStepRow(working, key, rid, false)).toBe(working);
  });

  it('keeps the closing message', () => {
    const working = fresh();
    expect(setEndNote(working, 'Done').endNote).toBe('Done');
    expect(setEndNote(working, working.endNote)).toBe(working);
  });
});

describe('adding, moving and removing steps', () => {
  it('adds an empty step at the end with a new key', () => {
    const working = fresh();
    const added = addStep(working);
    expect(added.steps).toHaveLength(3);
    expect(added.steps[2]).toMatchObject({ text: '', rows: [], seconds: 0, speed: '' });
    expect(new Set(added.steps.map(step => step.key)).size).toBe(3);
  });

  it('adds nothing at the cap', () => {
    let working = stepsWorkingFrom({ ingredients: [], steps: [] });
    for (let i = 0; i < MAX_STEPS + 5; i += 1) working = addStep(working);
    expect(working.steps).toHaveLength(MAX_STEPS);
    expect(canAddStep(working)).toBe(false);
    expect(addStep(working)).toBe(working);
  });

  it('moves a step by one place and not past either end', () => {
    const working = fresh();
    const [a, b] = working.steps;
    const down = moveStep(working, a!.key, 1);
    expect(down.steps.map(step => step.key)).toEqual([b!.key, a!.key]);
    expect(moveStep(down, a!.key, 1)).toBe(down);
    expect(moveStep(working, a!.key, -1)).toBe(working);
    expect(moveStep(down, a!.key, -1).steps.map(step => step.key)).toEqual([a!.key, b!.key]);
    expect(moveStep(working, 999, 1)).toBe(working);
  });

  it('removes a step by its key', () => {
    const working = fresh();
    const gone = removeStep(working, working.steps[0]!.key);
    expect(gone.steps.map(step => step.text)).toEqual(['Rest']);
    expect(removeStep(gone, 999)).toBe(gone);
  });
});

describe('the check over the rows', () => {
  it('says nothing is written yet when there are no steps', () => {
    expect(rowCheck(stepsWorkingFrom({ ingredients: RECIPE.ingredients, steps: [] }))).toEqual({ kind: 'no-steps' });
  });

  it('lists the named rows that no step has, and ignores a row with no name', () => {
    expect(rowCheck(fresh())).toEqual({ kind: 'missing', labels: ['Water'] });
  });

  it('says every ingredient is in when each named row is ticked somewhere', () => {
    const working = fresh();
    const ticked = setStepRow(working, working.steps[1]!.key, working.rows[1]!.rid as string, true);
    expect(rowCheck(ticked)).toEqual({ kind: 'all-in' });
  });

  it('counts a freshly added, still empty step as a step', () => {
    const empty = addStep(stepsWorkingFrom({ ingredients: RECIPE.ingredients, steps: [] }));
    expect(rowCheck(empty)).toEqual({ kind: 'missing', labels: ['Flour', 'Water'] });
  });
});

describe('the figures and what is saved', () => {
  it('adds the timers up', () => {
    expect(totalSeconds(fresh())).toBe(690);
  });

  it('offers a tick box for each row that has a name and an id', () => {
    expect(tickableRows(fresh()).map(row => row.label)).toEqual(['Flour', 'Water']);
    expect(tickableRows(fresh()).map(row => row.index)).toEqual([0, 1]);
  });

  it('hands the store the clean steps (no key, no empty step), the trimmed message and the rows with their ids', () => {
    const working = addStep(fresh());
    const saved = procedureOf(working);
    expect(saved.steps).toEqual([
      { text: 'Mix', rows: ['rf'], seconds: 90, speed: '1' },
      { text: 'Rest', rows: [], seconds: 600, speed: '' },
    ]);
    expect(saved.endNote).toBe('24 degrees');
    expect(saved.rows).toBe(working.rows);
    expect(procedureOf(stepsWorkingFrom({ ingredients: [], steps: [{ text: '  ' }] })).steps).toEqual([]);
  });
});
