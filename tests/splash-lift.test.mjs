// The Home's splash lifts when the APP is ready, not when the slowest resource arrives
// (speed audit, 23 Sep 2026). On the live site `load` waited for reCAPTCHA (removed 26 Sep
// 2026) — 332 KB that drew nothing — so the splash covered a Home that was already usable. Driven on the
// emulator with one script held back 5 s: the splash lifted at ~1.0 s instead of the
// 4 s safety timeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/orders/boot.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '');

test('the session settling lifts the splash', () => {
  assert.match(src, /import\('\.\.\/firebase\.js'\)/);
  assert.match(src, /onSession\(\(session\) => \{\s*if \(session\.status !== 'loading'\) dismiss\(\);/,
    'any settled state — signed in, the sign-in form, the venue picker — is something to show');
});

test('⚠️ firebase.js is loaded dynamically, so the failsafe survives the SDK failing to load', () => {
  assert.doesNotMatch(src, /^import .* from '\.\.\/firebase\.js';/m,
    'a static import makes the whole script — failsafe included — depend on the SDK loading');
  const failsafeAt = src.indexOf('setTimeout(remove, SAFETY_MS)');
  const importAt = src.indexOf("import('../firebase.js')");
  assert.ok(failsafeAt !== -1 && failsafeAt < importAt, 'the failsafe must be armed before firebase.js is asked for');
});

test('load and the safety timeout stay as the second and third signals', () => {
  assert.match(src, /window\.addEventListener\('load', dismiss\)/);
  assert.match(src, /setTimeout\(remove, SAFETY_MS\)/);
});

test('three signals, one fade: dismiss runs once', () => {
  assert.match(src, /if \(dismissed\) return;\s*dismissed = true;/);
});

// ── The failsafe's new home (10 Oct 2026) ───────────────────────────────────────────────────
// ⚠️ Bundling made every module of the page wait for the Firebase SDK, which the bundle imports at
// the top: with the SDK unloadable NO module runs, boot.js and its 4 s failsafe included, and the
// Home stayed on the logo for ever. The assertions above still pass on the unchanged source of
// boot.js, so the guarantee is pinned where it now lives: the classic, import-free splash-init.js.

const init = readFileSync(new URL('../js/splash-init.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('⚠️ splash-init.js is a classic script in the <head> of the Home, so no module or SDK can hold it up', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<script src="js\/splash-init\.js"><\/script>/, 'a plain <script src>, in the head');
  assert.doesNotMatch(head, /<script[^>]*type="module"[^>]*splash-init/);
  assert.doesNotMatch(head, /<script[^>]*(defer|async)[^>]*splash-init/);
});

test('⚠️ it depends on nothing: no import, no export, no await, nothing from another file', () => {
  assert.doesNotMatch(init, /^\s*(import|export)\b/m);
  assert.doesNotMatch(init, /\bimport\s*\(|\bawait\b|\brequire\(/);
});

test('⚠️ it arms a 4 s timer that hides and then removes #splash, only when the splash is going to show', () => {
  assert.match(init, /setTimeout\(function \(\) \{\s*var splash = document\.getElementById\('splash'\);\s*if \(!splash\) return;/);
  assert.match(init, /splash\.classList\.add\('splash--hide'\)/);
  assert.match(init, /\}, 4000\);/);
  assert.match(init, /\}, 500\);/);
  // The no-splash path returns before the timer is armed.
  const guard = init.indexOf('if (!showsSplash');
  assert.ok(guard > -1 && guard < init.indexOf('}, 4000);'));
});

test('boot.js and splash-init.js lift the splash the same way, so whichever fires first wins', () => {
  assert.match(src, /splash\.classList\.add\('splash--hide'\)/);
  assert.match(src, /setTimeout\(\(\) => splash\.remove\(\), 500\)/);
  assert.match(src, /const SAFETY_MS = 4000/);
});

test('⚠️ executed: with nothing else loaded, the splash is hidden at 4 s and removed 0.5 s later', async () => {
  const vm = await import('node:vm');
  const raw = readFileSync(new URL('../js/splash-init.js', import.meta.url), 'utf8');
  const run = (stored) => {
    const timers = [];
    const classes = new Set();
    const splashClasses = new Set();
    let removed = false;
    const splash = { classList: { add: c => splashClasses.add(c) }, parentNode: { removeChild: () => { removed = true; } } };
    const store = new Map(stored ? [['splashShown', '1']] : []);
    vm.runInNewContext(raw, {
      sessionStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) },
      document: { documentElement: { classList: { add: c => classes.add(c) } }, getElementById: id => (id === 'splash' ? splash : null) },
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
    });
    return { timers, classes, splashClasses, wasRemoved: () => removed };
  };

  const first = run(false);
  assert.deepEqual(first.timers.map(t => t.ms), [4000], 'one timer, 4 s');
  assert.ok(!first.classes.has('no-splash'));
  first.timers[0].fn();
  assert.ok(first.splashClasses.has('splash--hide'), 'faded at 4 s');
  assert.equal(first.wasRemoved(), false);
  assert.deepEqual(first.timers.map(t => t.ms), [4000, 500]);
  first.timers[1].fn();
  assert.equal(first.wasRemoved(), true, 'and taken out of the page after the fade');

  const later = run(true);
  assert.ok(later.classes.has('no-splash'), 'a return to the Home never shows it');
  assert.deepEqual(later.timers, [], 'and arms nothing');
});
