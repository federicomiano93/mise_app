// The Home's splash lifts when the APP is ready, not when the slowest resource arrives
// (speed audit, 23 Sep 2026). On the live site `load` waits for reCAPTCHA — 332 KB that
// draws nothing — so the splash covered a Home that was already usable. Driven on the
// emulator with one script held back 5 s: the splash lifted at ~1.0 s instead of the
// 4 s safety timeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/orders/boot.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '');

test('the session settling lifts the splash', () => {
  assert.match(src, /import \{ onSession \} from '\.\.\/firebase\.js';/);
  assert.match(src, /onSession\(\(session\) => \{\s*if \(session\.status !== 'loading'\) dismiss\(\);/,
    'any settled state — signed in, the sign-in form, the venue picker — is something to show');
});

test('load and the safety timeout stay as the second and third signals', () => {
  assert.match(src, /window\.addEventListener\('load', dismiss\)/);
  assert.match(src, /setTimeout\(remove, SAFETY_MS\)/);
});

test('three signals, one fade: dismiss runs once', () => {
  assert.match(src, /if \(dismissed\) return;\s*dismissed = true;/);
});
