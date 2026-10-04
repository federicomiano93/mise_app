// confirm-flow.js — what a tap on a recipe's Confirm does.
//
// Pure on purpose: the two things it can do are passed in, so a test can drive both
// branches without a page. js/app.js hands it the real day picker and the real save.
//
// ⚠️ ONE ANSWER, READ AT THE TAP. `askDoughDay` is a venue switch (Settings → Calculator);
// asksDoughDay() answers «ask» for a missing, corrupt or any non-false value, so the
// day picker is never skipped by accident. Only a literal false saves for today at once.

import { asksDoughDay } from './calculator-config.js';

export function runConfirm(recipeId, { config, openDayPicker, saveToday }) {
  if (asksDoughDay(config)) {
    openDayPicker(recipeId);
    return 'asked';
  }
  saveToday(recipeId);
  return 'today';
}
