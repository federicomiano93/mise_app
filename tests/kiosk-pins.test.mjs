import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nextKioskState } from '../js/kiosk-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const S = { enabled: true, restMinutes: 5, nightHours: 1 };
const base = { state: 'active', now: 1e9, lastInputAt: 1e9, restSince: 0, busy: false, signedIn: true, settings: S };

test('the model asks for no wake lock when signed out, in any state', () => {
  assert.equal(nextKioskState(base).wakeLock, true);
  assert.equal(nextKioskState({ ...base, signedIn: false }).wakeLock, false);
  assert.equal(nextKioskState({ ...base, state: 'rest', restSince: base.now, signedIn: false }).wakeLock, false);
});

test('the Orders rest lines wait for the history as well as the suppliers', () => {
  const src = read('js/orders/orders-main.js');
  const at = src.indexOf("window.addEventListener('kiosk-rest-info'");
  const body = src.slice(at, src.indexOf('\ninit();', at));
  assert.match(body, /state\.loaded\.suppliers \|\| !state\.loaded\.history/);
});

test('the «What’s new» notice waits for the cover to come off, announced by kiosk.js', () => {
  const boot = read('js/whats-new-boot.js');
  assert.match(boot, /kiosk-rest/);
  assert.match(boot, /kiosk-awake/);
  assert.match(boot, /kiosk-resume/);
  const call = boot.indexOf('await afterKioskAwake(resumed)');
  assert.ok(call > boot.indexOf('await afterSignIn()'), 'after the sign-in wait');
  // Before the notice is marked as read: a notice that never opened must not be lost.
  assert.ok(call < boot.indexOf('  writeSeen(latest);'), 'before the notice is recorded as seen');
  assert.doesNotMatch(boot, /from '\.\/kiosk/);
  assert.match(read('js/kiosk.js'), /new Event\('kiosk-awake'\)/);
});

// In a row it covered «Tablet del laboratorio» at 296px (measured 4 Oct 2026); one chip on
// the card's title line, out of the flow, covers nothing and moves nothing.
test('the kiosk card has ONE «Saved ✓», on its title line and out of the flow', () => {
  const css = read('tokens.css');
  assert.match(css, /\.set-head > \.set-saved \{\s*position: absolute;/);
  const home = read('js/home-settings.js');
  assert.match(home, /section\(t\('settings\.home\.device'\), \[[^\n]*\], kioskSaved\)/);
  assert.equal((home.match(/node\('span', 'set-saved'/g) || []).length, 1);
  assert.doesNotMatch(home, /set-row--kiosk|set-block--kiosk/);
});
