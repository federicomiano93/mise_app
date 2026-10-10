// The stores' screen-refresh callback goes through guarded() (safety net, step 0).
//
// Eight modules keep ONE module-level `notify` and call it bare, in the middle of a live
// Firestore listener and — in catalogue-store.js upsertLocal — BEFORE the network write. A
// throw from a screen's refresh escaped into the store: the listener died half-way and a
// recipe could fail to reach the database at all. The fix is one line per module: the callback
// is wrapped when it is handed over, so every call site is covered without being touched.
// watchConfirmations() takes its callback as a parameter, not a module-level variable, and is
// wrapped once at its top for the same reason.
//
// These files load the Firebase SDK from a CDN and cannot run in node, so the wiring is
// pinned as source text (the executed behaviour is tests/guard.test.mjs). Each check first
// proves it found what it is looking for — a pattern that matches nothing passes any change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// The list is explicit on purpose: the discovery test below fails when a module declares a
// module-level `notify` that is not named here, so a ninth one cannot slip past unguarded.
// `lines` are the exact (trimmed) lines that must each appear once; every other line that
// assigns notify is a failure.
const guardedStore = (file, label) => ({
  file,
  declaration: 'let notify = null;',
  lines: [`notify = guarded('${label}', onUpdate);`],
});

const MODULES = [
  guardedStore('js/catalogue/catalogue-store.js', 'Catalogue: screen refresh'),
  guardedStore('js/foodcost/foodcost-store.js', 'Food cost: screen refresh'),
  guardedStore('js/inventory/inventory-store.js', 'Inventory: screen refresh'),
  guardedStore('js/log-store.js', 'Calculator log: screen refresh'),
  guardedStore('js/pastries/pastries-store.js', 'Pastries: screen refresh'),
  guardedStore('js/pastries/pastries-logs-store.js', 'Pastries log: screen refresh'),
  guardedStore('js/calculator-config-store.js', 'Calculator config: screen refresh'),
  {
    // Starts as a no-op, not null, and only takes the screen's function when it is one.
    file: 'js/calculator-catalogue-link.js',
    declaration: 'let notify = () => {};',
    lines: [
      "const refresh = guarded('Calculator: linked recipe refresh', onChange);",
      'if (refresh) notify = refresh;',
    ],
  },
];

function everyJsFile(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) return entry === 'vendor' ? [] : everyJsFile(abs);
    return entry.endsWith('.js') ? [abs] : [];
  });
}

test('the check lists the eight modules that keep a module-level notify', () => {
  assert.equal(MODULES.length, 8);
  for (const { file, declaration } of MODULES) {
    assert.ok(existsSync(join(ROOT, file)), `${file} is gone — update this test`);
    const declarations = read(file).split('\n').filter(l => l.startsWith('let notify'));
    assert.equal(declarations.length, 1, `${file}: exactly one module-level notify expected`);
    assert.ok(declarations[0].startsWith(declaration), `${file} declares notify differently: ${declarations[0]}`);
  }
});

test('⚠ no module under js/ declares a module-level notify that this file does not list', () => {
  const found = everyJsFile(join(ROOT, 'js'))
    .filter(abs => /^let notify\b/m.test(readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')))
    .map(abs => relative(ROOT, abs).split(sep).join('/'))
    .sort();
  assert.ok(found.length >= 8, 'the scan found fewer modules than are listed — the pattern is broken');
  assert.deepEqual(found, MODULES.map(m => m.file).sort(),
    'a module keeps a notify that is not guarded: add it to MODULES and wrap it with guarded()');
});

for (const { file, lines } of MODULES) {
  test(`${file}: the screen's callback is stored through guarded()`, () => {
    const src = read(file);
    const trimmed = src.split('\n').map(l => l.trim());
    for (const line of lines) {
      assert.equal(trimmed.filter(l => l === line).length, 1, `expected exactly once in ${file}: ${line}`);
    }
    const assigning = trimmed.filter(l => /\bnotify = /.test(l) && !l.startsWith('let notify') && !l.startsWith('//'));
    for (const l of assigning) {
      assert.ok(lines.includes(l), `${file} assigns notify in an unguarded way: ${l}`);
    }
    assert.ok(assigning.length >= 1, `${file}: no assignment to notify found`);
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
  const upsertCall = src.indexOf('upsertLocal({ ...kept, id, ...data });');
  const writeCall = src.indexOf('saveRecipeDoc(id, data)');
  assert.ok(upsertCall >= 0, 'the upsertLocal call in saveRecipe was not found — update this test');
  assert.ok(writeCall >= 0, 'the saveRecipeDoc call in saveRecipe was not found — update this test');
  assert.ok(upsertCall < writeCall);
});

test('⚠ pastries-logs-store: watchConfirmations() never calls the screen\'s repaint directly', () => {
  const src = read('js/pastries/pastries-logs-store.js');
  const watch = /export async function watchConfirmations\(workDate, onChange\) \{[\s\S]*?\n\}\n/.exec(src);
  assert.ok(watch, 'watchConfirmations not found — update this test');
  const body = watch[0];
  // The first repaint runs BEFORE the await: a throw there rejected the whole async function
  // unawaited, so the listener was never attached and lists confirmed tonight never locked.
  assert.match(body, /const paint = guarded\('Pastries log: confirmations refresh', onChange\);/);
  assert.ok(!/\bonChange\(/.test(body), 'a direct onChange() call is back');
  assert.equal((body.match(/\bpaint\(\)/g) || []).length, 4, 'the four repaints must all go through paint()');
  assert.ok(body.indexOf('const paint') < body.indexOf('await watchPastryLogsForDate'));
});

test('js/guard.js imports nothing, so any module can use it', () => {
  const src = read('js/guard.js');
  assert.ok(!/^\s*import\b/m.test(src));
  assert.match(src, /export function guarded\(label, fn\)/);
});

const ON_SESSION_GUARD =
  /try \{ callback\(session\); \} catch \(err\) \{ console\.error\('Session listener failed:', err\); \}/;

for (const file of ['js/firebase.js', 'js/firebase.example.js']) {
  test(`⚠ ${file}: onSession() guards its first, immediate call like setSession() guards the rest`, () => {
    const src = read(file);
    const onSession = /export function onSession\(callback\) \{[\s\S]*?\n\}/.exec(src);
    assert.ok(onSession, 'onSession not found — update this test');
    assert.match(onSession[0], ON_SESSION_GUARD);
    assert.ok(!/^\s*callback\(session\);/m.test(onSession[0]), 'a bare callback(session) must not come back');
    assert.match(onSession[0], /return \(\) => sessionListeners\.delete\(callback\);/);
    // setSession() wraps the later calls with the same message: both stay.
    assert.equal((src.match(/Session listener failed:/g) || []).length, 2);
  });
}

test('⚠ js/i18n.js: setLanguage() reports a failing listener instead of swallowing it', () => {
  const src = read('js/i18n.js');
  const setLanguage = /export function setLanguage\(lang\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(setLanguage, 'setLanguage not found — update this test');
  assert.match(setLanguage[0], /catch \(err\) \{ console\.error\('Language listener failed:', err\); \}/);
  assert.ok(!/catch \{/.test(setLanguage[0]), 'an empty `catch {` hides the error from the reporter');
});
