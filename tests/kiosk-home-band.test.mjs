// The Home's kiosk band (Rest / Exit) and the «rest now» event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  kioskBandVisible, shouldRestNow, wakeArmDelay, REST_NOW_GUARD_MS, exitRefused, EXIT_CHECK_MS,
  serializeKioskSettings,
} from '../js/kiosk-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

test('the band is shown only where kiosk mode is on, and survives garbage', () => {
  assert.equal(kioskBandVisible(null), false);
  assert.equal(kioskBandVisible('not json'), false);
  assert.equal(kioskBandVisible(serializeKioskSettings(null, { enabled: false })), false);
  assert.equal(kioskBandVisible(serializeKioskSettings(null, { enabled: true })), true);
});

test('the band follows the setting live: both change events re-render it', () => {
  const src = read('js/home-kiosk-band.js');
  assert.match(src, /addEventListener\('kiosk-settings-changed', render\)/);
  assert.match(src, /addEventListener\('storage'/);
  assert.match(src, /host\.hidden = !kioskBandVisible\(readStored\(\)\)/);
  // Not tied to a role: the module never looks at the session.
  assert.doesNotMatch(src, /canManage|onSession|firebase/);
  const html = read('index.html');
  assert.match(html, /<div id="home-kiosk-band"[^>]* hidden><\/div>\s*<div id="home-reminder">/);
  assert.match(html, /<script type="module" src="js\/home-kiosk-band\.js"><\/script>/);
});

test('rest-now enters rest only when enabled, signed in and not already covered', () => {
  assert.equal(shouldRestNow({ enabled: true, signedIn: true, state: 'active' }), true);
  assert.equal(shouldRestNow({ enabled: false, signedIn: true, state: 'active' }), false);
  assert.equal(shouldRestNow({ enabled: true, signedIn: false, state: 'active' }), false);
  assert.equal(shouldRestNow({ enabled: true, signedIn: true, state: 'rest' }), false);
  assert.equal(shouldRestNow({ enabled: true, signedIn: true, state: 'night' }), false);
  assert.equal(shouldRestNow(), false);
  const src = read('js/kiosk.js');
  assert.match(src, /addEventListener\('kiosk-rest-now', restNow\)/);
  assert.match(src, /shouldRestNow\(\{ enabled: !!\(settings && settings\.enabled\), signedIn: started && isSignedIn\(\), state \}\)/);
});

test('the tap that raised the cover cannot wake it: the waking tap is armed after a pause', () => {
  const now = 1_000_000;
  assert.equal(wakeArmDelay(now + REST_NOW_GUARD_MS, now), REST_NOW_GUARD_MS);
  assert.equal(wakeArmDelay(now + 100, now), 100);
  assert.equal(wakeArmDelay(now - 1, now), 0);      // a cover raised by idleness arms at once
  assert.equal(wakeArmDelay(0, now), 0);
  const src = read('js/kiosk.js');
  assert.match(src, /wakeGuardUntil = Date\.now\(\) \+ REST_NOW_GUARD_MS;\s*enter\('rest'\)/);
  assert.match(src, /const delay = wakeArmDelay\(wakeGuardUntil, Date\.now\(\)\)/);
  // The pending arming is cancelled if the cover goes away first.
  assert.match(src, /function hideRest\(\) \{\s*if \(armTimer !== null\)/);
});

test('Exit: closing refused means the page is still visible after the pause', () => {
  assert.equal(EXIT_CHECK_MS, 500);
  assert.equal(exitRefused({ visibilityState: 'visible', closed: false }), true);
  assert.equal(exitRefused({ visibilityState: 'hidden', closed: false }), false);
  assert.equal(exitRefused({ visibilityState: 'visible', closed: true }), false);
  const src = read('js/home-kiosk-band.js');
  assert.match(src, /window\.close\(\)/);
  assert.match(src, /alertDialog\(t\('kiosk\.home\.cannotClose'\)\)/);
  // Kiosk mode stays on: the band never writes the setting.
  assert.doesNotMatch(src, /setItem|serializeKioskSettings/);
});

test('both buttons are flex icon + text, at least 44px, with tokens only', () => {
  const css = read('orders.css');
  const start = css.indexOf('.home-kiosk-btn {');
  const rule = css.slice(start, css.indexOf('}', start));
  assert.match(rule, /min-height: 44px/);
  assert.match(rule, /display: flex/);
  assert.match(rule, /align-items: center/);
  assert.doesNotMatch(css.slice(css.indexOf('.home-kiosk-band {')), /#[0-9a-fA-F]{3,6}\b/);
  const src = read('js/home-kiosk-band.js');
  assert.match(src, /'stroke-width': '2'/);
  assert.match(src, /viewBox: '0 0 24 24'/);
});

test('the kiosk words exist in both languages', () => {
  const i18n = read('js/i18n.js');
  for (const key of ['kiosk.home.rest', 'kiosk.home.exit', 'kiosk.home.cannotClose', 'kiosk.home.aria']) {
    assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} in EN and IT`);
  }
  assert.ok(i18n.includes(`'kiosk.home.rest': 'Rest',`));
  assert.ok(i18n.includes(`'kiosk.home.rest': 'Riposo',`));
  assert.ok(i18n.includes(`'kiosk.home.exit': 'Exit',`));
  assert.ok(i18n.includes(`'kiosk.home.exit': 'Esci',`));
  assert.ok(i18n.includes(`"This tablet doesn’t let the app close itself. To close it, open the recent-apps view and swipe Mise away."`));
  assert.ok(i18n.includes(`"Questo tablet non permette all’app di chiudersi da sola. Per chiuderla tocca il tasto delle app recenti e scorri via Mise."`));
});
