import { describe, expect, it } from 'vitest';
import { NO_ANSWERS } from './ingredientsRun';
import {
  ASK_NEW, ASK_NONE, ASK_SKIP, answerConfirm, answerNew, answerQuestion, answerRename, decisionOfQuestion, questionValue, sameValue,
} from './ingredientAnswers';

// What the person answers on step 3 of «Import from invoices», as functions on the answers (part B3b, slice 1).
//
// PORTS (tests/invoice-import-review.test.mjs): «S4 · a new answer clears the “Use this price” of the row, so a confirmation never
// reaches another price» (the screen's half: the two handlers that delete the confirmation and the rename; the model's half is
// in shared/), and the select values of the original's question («same:<id>», «new», «skip»).

const PAIR = { stored: 'Farina vecchia', file: 'Farina nuova' };

describe('the question select', () => {
  it('maps every answer to its option and back', () => {
    expect(questionValue(undefined)).toBe(ASK_NONE);
    expect(questionValue({ sameAs: 'ing-1' })).toBe(sameValue('ing-1'));
    expect(questionValue({ createNew: true })).toBe(ASK_NEW);
    expect(questionValue({ skip: true })).toBe(ASK_SKIP);
    expect(decisionOfQuestion(ASK_NONE)).toBeNull();
    expect(decisionOfQuestion(ASK_NEW)).toEqual({ createNew: true });
    expect(decisionOfQuestion(ASK_SKIP)).toEqual({ skip: true });
    expect(decisionOfQuestion(sameValue('ing-1'))).toEqual({ sameAs: 'ing-1' });
    expect(decisionOfQuestion('same:')).toBeNull();
    expect(decisionOfQuestion('anything else')).toBeNull();
  });
});

describe('S4 · a new answer is a new price', () => {
  const confirmed = answerRename(answerConfirm(NO_ANSWERS, 'k', true), 'k', PAIR);

  it('answering the question drops the confirmation and the rename of that row, and only of that row', () => {
    const other = answerConfirm(confirmed, 'other', true);
    const next = answerQuestion(other, 'k', { sameAs: 'ing-2' });
    expect(next.decisions).toEqual({ k: { sameAs: 'ing-2' } });
    expect(next.confirmKeys.has('k')).toBe(false);
    expect(next.renames.has('k')).toBe(false);
    expect(next.confirmKeys.has('other')).toBe(true);
  });

  it('going back to «Choose…» forgets the answer and the confirmation too', () => {
    const next = answerQuestion(answerQuestion(confirmed, 'k', { skip: true }), 'k', null);
    expect(next.decisions).toEqual({});
    expect(next.confirmKeys.size).toBe(0);
  });

  it('answering «create / do not import» drops them as well', () => {
    const forgotten = answerNew(confirmed, 'k', true);
    expect(forgotten.forgetKeys.has('k')).toBe(true);
    expect(forgotten.confirmKeys.has('k')).toBe(false);
    expect(forgotten.renames.has('k')).toBe(false);
    expect(answerNew(forgotten, 'k', false).forgetKeys.has('k')).toBe(false);
  });

  it('«Use this price» and «Save the new name» are each their own choice and do not touch the other', () => {
    const used = answerConfirm(NO_ANSWERS, 'k', true);
    expect(used.confirmKeys.has('k')).toBe(true);
    expect(used.renames.size).toBe(0);
    const renamed = answerRename(used, 'k', PAIR);
    expect(renamed.renames.get('k')).toEqual(PAIR);
    expect(renamed.confirmKeys.has('k')).toBe(true);
    expect(answerRename(renamed, 'k', null).renames.size).toBe(0);
    expect(answerConfirm(renamed, 'k', false).confirmKeys.has('k')).toBe(false);
  });

  it('never changes the answers it was given', () => {
    const before = answerConfirm(NO_ANSWERS, 'k', true);
    answerQuestion(before, 'k', { skip: true });
    answerNew(before, 'k', true);
    expect(before.confirmKeys.has('k')).toBe(true);
    expect(before.decisions).toEqual({});
    expect(NO_ANSWERS.confirmKeys.size).toBe(0);
  });
});
