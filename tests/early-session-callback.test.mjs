// onSession() and onLanguageChange() answer AT ONCE when there is already something to
// say — and the session is often ready before a page's own files have finished loading,
// more so since the sign-in got faster (speed audit, 26 Sep 2026). A module that
// subscribes at the top level and only then declares a `let`/`const` the callback uses
// throws «Cannot access … before initialization» in that case: the rest of the module
// never runs and the screen stays half-built until a reload.
//
// It happened: js/catalogue/catalogue-main.js declared wantedRecipeId after its
// onSession() call, and the recipe catalogue broke on every opening where the session
// won the race. The rule this pins is the simple, safe one — every top-level
// declaration comes BEFORE the module's first top-level subscription.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function everyJsFile(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) return entry === 'vendor' ? [] : everyJsFile(abs);
    return entry.endsWith('.js') ? [abs] : [];
  });
}

const SUBSCRIBE = /^(onSession|onLanguageChange)\(/;
const DECLARE = /^(let|const) /;

test('the check finds the top-level subscriptions it is about', () => {
  const lines = readFileSync(join(ROOT, 'js/catalogue/catalogue-main.js'), 'utf8').split(/\r?\n/);
  assert.ok(lines.some(l => SUBSCRIBE.test(l)), 'catalogue-main.js no longer subscribes at the top level — update this test');
});

test('⚠⚠ no module declares a top-level let/const after its first top-level onSession/onLanguageChange', () => {
  const offenders = [];
  for (const abs of everyJsFile(join(ROOT, 'js'))) {
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    const first = lines.findIndex(l => SUBSCRIBE.test(l));
    if (first < 0) continue;
    lines.forEach((l, i) => {
      if (i > first && DECLARE.test(l)) {
        offenders.push(`${relative(ROOT, abs).split(sep).join('/')}:${i + 1} ${l.trim().slice(0, 60)}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    'declared after a subscription that can call back at once: move it above the first onSession/onLanguageChange');
});
