// ingredientAnswers.ts — what the person answers on step 3 of «Import from invoices», as plain functions on the answers the screen
// holds (step 3e-6, part B3b; the port of the handlers inside `ingredientRow`, js/orders/invoice-import-screen.js). No React.
// Every function answers a NEW object: the screen keeps the old one until it sets the new.
//
// ⚠️ A NEW ANSWER IS A NEW PRICE (review S4): «Use this price» and «Save the new name» given to the old answer never carry over to
// another one, so answering the question or the «create / do not import» choice drops both.

import type { IngredientAnswers } from './ingredientsRun';

// A question («Same as X», «Create a new ingredient», «Skip») as the plan reads it (applyDecisions → resolveRow).
export type IngredientDecision = { readonly sameAs: string } | { readonly createNew: true } | { readonly skip: true };

export const ASK_NONE = '';
export const ASK_NEW = 'new';
export const ASK_SKIP = 'skip';
const SAME = 'same:';

export const sameValue = (id: string): string => `${SAME}${id}`;

// The option an answered question stands on.
export function questionValue(decision: unknown): string {
  const d = (decision ?? null) as { sameAs?: unknown; createNew?: unknown } | null;
  if (!d) return ASK_NONE;
  if (typeof d.sameAs === 'string' && d.sameAs) return sameValue(d.sameAs);
  return d.createNew ? ASK_NEW : ASK_SKIP;
}

export function decisionOfQuestion(value: string): IngredientDecision | null {
  if (value === ASK_NEW) return { createNew: true };
  if (value === ASK_SKIP) return { skip: true };
  if (value.startsWith(SAME) && value.length > SAME.length) return { sameAs: value.slice(SAME.length) };
  return null;
}

const without = (set: ReadonlySet<string>, key: string): Set<string> => {
  const next = new Set(set);
  next.delete(key);
  return next;
};

const withoutKey = <V,>(map: ReadonlyMap<string, V>, key: string): Map<string, V> => {
  const next = new Map(map);
  next.delete(key);
  return next;
};

// The question of a «maybe a duplicate» / «choose» row answered (null = back to «Choose…»).
export function answerQuestion(answers: IngredientAnswers, key: string, decision: IngredientDecision | null): IngredientAnswers {
  const decisions = { ...answers.decisions };
  if (decision === null) delete decisions[key];
  else decisions[key] = decision;
  return { ...answers, decisions, confirmKeys: without(answers.confirmKeys, key), renames: withoutKey(answers.renames, key) };
}

// A NEW row answered «Create» (the default) or «Do not import (remember)».
export function answerNew(answers: IngredientAnswers, key: string, forget: boolean): IngredientAnswers {
  const forgetKeys = forget ? new Set(answers.forgetKeys).add(key) : without(answers.forgetKeys, key);
  return { ...answers, forgetKeys, confirmKeys: without(answers.confirmKeys, key), renames: withoutKey(answers.renames, key) };
}

// «This price?» → «Use this price» (true) or «Leave it for now».
export function answerConfirm(answers: IngredientAnswers, key: string, use: boolean): IngredientAnswers {
  return { ...answers, confirmKeys: use ? new Set(answers.confirmKeys).add(key) : without(answers.confirmKeys, key) };
}

// «Name on the invoice» → «Save the new name» (the exact old → new pair the person saw) or «Keep the old name» (null).
export function answerRename(answers: IngredientAnswers, key: string, pair: { stored: string; file: string } | null): IngredientAnswers {
  return { ...answers, renames: pair ? new Map(answers.renames).set(key, { stored: pair.stored, file: pair.file }) : withoutKey(answers.renames, key) };
}
