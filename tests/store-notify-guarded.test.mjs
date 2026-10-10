// The stores' screen-refresh callback goes through guarded() (safety net, step 0).
//
// Seven stores keep ONE module-level `notify` and call it bare, in the middle of a live
// Firestore listener and — in catalogue-store.js upsertLocal — BEFORE the network write. A
// throw from a screen's refresh escaped into the store: the listener died half-way and a
// recipe could fail to reach the database at all. The fix is one line per store: the callback
// is wrapped when it is handed over, so every call site is covered without being touched.
//
// These files load the Firebase SDK from a CDN and cannot run in node, so the wiring is
// pinned as source text (the executed behaviour is tests/guard.test.mjs). Each check first
// proves it found what it is looking for — a pattern that matches nothing passes any change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const STORES = [
  { file: 'js/catalogue/catalogue-store.js', label: 'Catalogue: screen refresh' },
  { file: 'js/foodcost/foodcost-store.js', label: 'Food cost: screen refresh' },
  { file: 'js/inventory/inventory-store.js', label: 'Inventory: screen refresh' },
  { file: 'js/log-store.js', label: 'Calculator log: screen refresh' },
  { file: 'js/pastries/pastries-store.js', label: 'Pastries: screen refresh' },
  { file: 'js/pastries/pastries-logs-store.js', label: 'Pastries log: screen refresh' },
  { file: 'js/calculator-config-store.js', label: 'Calculator config: screen refresh' },
];

test('the check lists the seven stores that keep a module-level notify', () => {
  assert.equal(STORES.length, 7);
  for (const { file } of STORES) {
    assert.ok(existsSync(join(ROOT, file)), `${file} is gone — update this test`);
    assert.match(read(file), /^let notify = null;/m, `${file} no longer declares a module-level notify`);
  }
});

for (const { file, label } of STORES) {
  test(`${file}: the screen's callback is stored through guarded()`, () => {
    const src = read(file);
    const assignments = src.match(/^\s*notify = .*$/gm) || [];
    assert.equal(assignments.length, 1, `exactly one assignment to notify expected in ${file}: ${assignments.join(' | ')}`);
    assert.equal(assignments[0].trim(), `notify = guarded('${label}', onUpdate);`);
    assert.ok(!/\? onUpdate : null/.test(src), 'the bare `? onUpdate : null` form must be gone');
  });

  test(`${file}: imports guarded from js/guard.js`, () => {
    const src = read(file);
    const imports = src.match(/^import \{ guarded \} from '([^']+)';$/gm) || [];
    assert.equal(imports.length, 1, `exactly one import of guarded expected in ${file}`);
    const spec = /from '([^']+)'/.exec(imports[0])[1];
    assert.equal(
      resolve(ROOT, dirname(file), spec),
      resolve(ROOT, 'js/guard.js'),
      `${file} imports guarded from the wrong place: ${spec}`,
    );
  });
}

test('⚠ inventory-store: announce() goes through the same guarded notify', () => {
  const src = read('js/inventory/inventory-store.js');
  assert.match(src, /function announce\(\) \{\n  if \(notify\) notify\(\);\n\}/);
  assert.ok(!/\bonUpdate\(/.test(src), 'the screen callback must never be called directly, only through notify');
});

test('⚠ catalogue-store: upsertLocal still calls notify before the network write — the reason for the guard', () => {
  const src = read('js/catalogue/catalogue-store.js');
  const upsert = /function upsertLocal\(recipe\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(upsert, 'upsertLocal not found — update this test');
  assert.match(upsert[0], /if \(notify\) notify\(recipes\);/);
  // saveRecipe() calls upsertLocal() ahead of saveRecipeDoc(): if notify could throw, the
  // write would never be reached. The guard is what makes that order safe.
  assert.ok(src.indexOf('upsertLocal({ ...kept, id, ...data });') < src.indexOf('saveRecipeDoc(id, data)'));
});

test('js/guard.js imports nothing, so any module can use it', () => {
  const src = read('js/guard.js');
  assert.ok(!/^\s*import\b/m.test(src));
  assert.match(src, /export function guarded\(label, fn\)/);
});

test('⚠ js/firebase.js: onSession() guards its first, immediate call like setSession() guards the rest', () => {
  const src = read('js/firebase.js');
  const onSession = /export function onSession\(callback\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(onSession, 'onSession not found — update this test');
  assert.match(
    onSession[0],
    /try \{ callback\(session\); \} catch \(err\) \{ console\.error\('Session listener failed:', err\); \}/,
  );
  assert.ok(!/^\s*callback\(session\);/m.test(onSession[0]), 'a bare callback(session) must not come back');
  assert.match(onSession[0], /return \(\) => sessionListeners\.delete\(callback\);/);
  // setSession() wraps the later calls with the same message: both stay.
  assert.equal((src.match(/Session listener failed:/g) || []).length, 2);
});

test('⚠ js/i18n.js: setLanguage() reports a failing listener instead of swallowing it', () => {
  const src = read('js/i18n.js');
  const setLanguage = /export function setLanguage\(lang\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(setLanguage, 'setLanguage not found — update this test');
  assert.match(setLanguage[0], /catch \(err\) \{ console\.error\('Language listener failed:', err\); \}/);
  assert.ok(!/catch \{/.test(setLanguage[0]), 'an empty `catch {` hides the error from the reporter');
});
