// Follow-up fixes to «Save in the green header» (4 Oct 2026), pinned because the owner
// cannot read the code:
//   1. a failed validation scrolls the first bad field into view and focuses it (js/reveal-field.js);
//   2. «Add log» with no Today/Tomorrow says so, above the day choice, instead of doing nothing;
//   3. every Calculator header Save runs through js/save-guard.js (disabled while in flight,
//      a second tap does nothing, Back waits).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSaveGuard } from '../js/save-guard.js';
import { revealField } from '../js/reveal-field.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

// ── 1. reveal the offending field ─────────────────────────────────────────────

function fakeNode() {
  const calls = [];
  return {
    calls,
    scrollIntoView(o) { calls.push(['scroll', o]); },
    focus(o) { calls.push(['focus', o]); },
  };
}

test('revealField scrolls to the centre, smoothly, then focuses without a second scroll', () => {
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const n = fakeNode();
  revealField(n);
  delete globalThis.window;
  assert.deepEqual(n.calls[0], ['scroll', { block: 'center', inline: 'nearest', behavior: 'smooth' }]);
  assert.deepEqual(n.calls[1], ['focus', { preventScroll: true }]);
});

test('revealField does not animate under prefers-reduced-motion', () => {
  globalThis.window = { matchMedia: (q) => ({ matches: /reduced-motion/.test(q) }) };
  const n = fakeNode();
  revealField(n);
  delete globalThis.window;
  assert.equal(n.calls[0][1].behavior, 'auto');
});

test('revealField tolerates nothing to reveal', () => {
  assert.doesNotThrow(() => revealField(null));
});

test('every editor with a header Save reveals the first bad field', () => {
  for (const f of ['js/catalogue/catalogue-editor.js', 'js/pastries/pastries-editor.js', 'js/foodcost/foodcost-editor.js']) {
    const src = read(f);
    assert.match(src, /import \{ revealField \} from '\.\.\/reveal-field\.js'/, `${f} imports revealField`);
    assert.ok(/revealField\(/.test(src), `${f} calls it`);
  }
  assert.ok(!/nameInput\.focus\(\)/.test(read('js/foodcost/foodcost-editor.js')), 'foodcost no longer bare-focuses the name');
});

test('the catalogue editor reveals EVERY problem, and highlights the amounts for «weight»', () => {
  const src = read('js/catalogue/catalogue-editor.js');
  const save = src.slice(src.indexOf('async function onSave()'), src.indexOf('async function onDelete()'));
  assert.match(save, /revealProblem\(problem\)/);
  assert.ok(!/if \(problem === 'name'\) nameInput\.focus\(\)/.test(save), 'not only the name');
  const reveal = src.slice(src.indexOf('function revealProblem'), src.indexOf('// Trim labels'));
  assert.match(reveal, /problem === 'name'/);
  assert.match(reveal, /\.cat-grm\.cat-invalid/);
  assert.match(reveal, /\.cat-lbl\.cat-invalid/);
  const validate = src.slice(src.indexOf('function validateUI'), src.indexOf('function revealProblem'));
  assert.match(validate, /'weight'/, 'amount boxes are highlighted when no ingredient has an amount');
  assert.match(validate, /\.cat-grm/);
});

test('the guided editor has no validation to reveal', () => {
  assert.ok(!/invalid/.test(read('js/catalogue/guided-editor.js')));
});

// ── 2. Add log: no day chosen ─────────────────────────────────────────────────

test('Add log says «choose a day» in both languages, near the day choice', () => {
  const dict = read('js/i18n.js');
  assert.match(dict, /'calc\.chooseDayFirst': 'Choose Today or Tomorrow first\.'/);
  assert.match(dict, /'calc\.chooseDayFirst': 'Scegli prima Oggi o Domani\.'/);
  const src = read('js/log-add.js');
  assert.match(src, /role: 'alert' \}, t\('calc\.chooseDayFirst'\)/);
  assert.match(src, /logday-choices--missing/);
  assert.match(src, /state\.dayMissing = true/);
  assert.match(src, /revealField\(document\.querySelector\('#logadd-content \.logday-choices--missing \.logday-choice'\)\)/);
  assert.match(src, /state\.forDay = d; state\.dayMissing = false/, 'choosing a day clears the message');
  assert.match(read('style.css'), /\.logday-choices--missing \.logday-choice \{ border-color: var\(--danger\)/);
});

test('Add log no longer returns silently when the day is missing', () => {
  const src = read('js/log-add.js');
  assert.ok(!/!state\.recipeId \|\| !state\.forDay\) return;/.test(src));
});

// ── 3. the in-flight guard ────────────────────────────────────────────────────

test('the guard disables the button while the write is pending and ignores a second tap', async () => {
  const btn = { disabled: false };
  const guard = createSaveGuard(() => btn);
  let release; let runs = 0;
  const first = guard.run(() => { runs++; return new Promise(r => { release = r; }); });
  assert.equal(guard.saving, true);
  assert.equal(btn.disabled, true);
  await guard.run(() => { runs++; });           // second tap
  assert.equal(runs, 1, 'the second tap did nothing');
  release('done');
  assert.equal(await first, 'done');
  assert.equal(guard.saving, false);
  assert.equal(btn.disabled, false, 'recovers after a successful save');
});

test('the guard recovers when the save throws, and to «disabled until dirty» where asked', async () => {
  const btn = { disabled: false };
  let dirty = true;
  const guard = createSaveGuard(() => btn, () => !dirty);
  await assert.rejects(guard.run(async () => { throw new Error('offline'); }), /offline/);
  assert.equal(guard.saving, false);
  assert.equal(btn.disabled, false, 'still dirty: pressable again');
  await guard.run(async () => { dirty = false; });
  assert.equal(btn.disabled, true, 'clean after the save: disabled until the next change');
});

const GUARDED = [
  // file, header Save ids, wrapper functions that must go through the guard, Back handlers that must wait
  ['js/calculator-settings.js', ['cp-save-btn', 'extra-save-btn', 'divisor-save-btn'], ['saveClients', 'saveExtra', 'saveDivisor'], ['closeClients', 'closeExtra', 'backDivisor']],
  ['js/recipes.js', ['recipe-save-btn'], ['saveRecipes'], ['closeRecipes']],
  ['js/calculator-whatsapp-settings.js', ['wa-save-btn'], ['saveDetail'], ['backWhatsapp']],
  ['js/log-settings.js', ['logsettings-save-btn'], ['saveAll'], ['closeLogSettings']],
  ['js/log-edit.js', ['logedit-save-btn'], ['save'], ['closeEdit']],
  ['js/log-add.js', ['logadd-save-btn'], ['commit'], ['close']],
];

test('every Calculator header Save runs through the save guard and its Back waits', () => {
  for (const [f, ids, saves, backs] of GUARDED) {
    const src = read(f);
    assert.match(src, /import \{ createSaveGuard \} from '\.\/save-guard\.js'/, `${f} imports the guard`);
    for (const id of ids) assert.ok(src.includes(`document.getElementById('${id}')`), `${f} guards #${id}`);
    for (const fn of saves) {
      assert.match(src, new RegExp(`function ${fn}\\(\\) \\{ return \\w+\\.run\\(do\\w+\\); \\}`), `${f}: ${fn} runs through the guard`);
    }
    for (const fn of backs) {
      const at = src.search(new RegExp(`async function ${fn}\\(`));
      assert.ok(at >= 0, `${f} has ${fn}`);
      assert.match(src.slice(at, at + 200), /\.saving\) return;/, `${f}: ${fn} waits while saving`);
    }
  }
});

test('Extra and Divisor give the button back as «disabled until dirty»', () => {
  const src = read('js/calculator-settings.js');
  assert.match(src, /createSaveGuard\(\(\) => document\.getElementById\('extra-save-btn'\), \(\) => !extraDirty\)/);
  assert.match(src, /createSaveGuard\(\(\) => document\.getElementById\('divisor-save-btn'\), \(\) => !divisorDirty\)/);
  assert.match(src, /btn\.disabled = extraSaveGuard\.saving \|\| !extraDirty/);
  assert.match(src, /btn\.disabled = divisorSaveGuard\.saving \|\| !divisorDirty/);
});

test('the new modules are precached', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes("'./js/reveal-field.js'"));
  assert.ok(sw.includes("'./js/save-guard.js'"));
});
