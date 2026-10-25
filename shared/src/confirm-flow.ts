// confirm-flow.ts — what a tap on a recipe's Confirm does. PURE: the two things it can do are passed in, so
// a test can drive both branches without a page.
//
// TypeScript FULL port of js/confirm-flow.js for Mise 2. Behaviour is identical, input for input:
// confirm-flow.spec.ts runs every test against BOTH files and parity.spec.ts compares their exports.
//
// ⚠️ ONE ANSWER, READ AT THE TAP. `askDoughDay` is a venue switch (Settings → Calculator); asksDoughDay()
// answers «ask» for a missing, corrupt or any non-false value, so the day picker is never skipped by
// accident. Only a literal false saves for today at once.

import { asksDoughDay } from './calculator-config';

export interface ConfirmFlow {
  config?: unknown;
  openDayPicker: (recipeId: string) => void;
  saveToday: (recipeId: string) => void;
}

export function runConfirm(recipeId: string, { config, openDayPicker, saveToday }: ConfirmFlow): 'asked' | 'today' {
  if (asksDoughDay(config)) {
    openDayPicker(recipeId);
    return 'asked';
  }
  saveToday(recipeId);
  return 'today';
}
