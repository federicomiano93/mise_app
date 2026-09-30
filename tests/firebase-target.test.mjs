// Which Firebase project a page talks to (js/firebase-target.js).
//
// ⚠️⚠️ THE TWO FAILURES THIS PINS ARE NOT SYMMETRICAL. A preview page given the PRODUCTION
// config would let somebody trying a pull request save real orders into a real bakery. The
// live site given the PREVIEW config would show every phone an empty test database. Both are
// silent — the app works perfectly in either case — so both directions are asserted here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  configForHost, isPreviewHost, PRODUCTION_CONFIG, PREVIEW_CONFIG, PREVIEW_PROJECT_ID,
} from '../js/firebase-target.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('the live site, localhost and anything unknown get PRODUCTION — as before', () => {
  for (const host of [
    'federicomiano93.github.io', 'localhost', '127.0.0.1', '::1', '[::1]', '',
    'bakery-app-ebf90.web.app', 'bakery-app-ebf90.firebaseapp.com', 'example.com',
  ]) {
    assert.equal(configForHost(host), PRODUCTION_CONFIG, host);
    assert.equal(configForHost(host).projectId, 'bakery-app-ebf90', host);
  }
  assert.equal(configForHost(undefined), PRODUCTION_CONFIG);
});

test('⚠️ every preview host gets the PREVIEW project, never production', () => {
  for (const host of [
    'mise-app-preview.web.app',
    'mise-app-preview.firebaseapp.com',
    'mise-app-preview--pr242-3k9x1a2b.web.app',
    'MISE-APP-PREVIEW--PR7-ABC.WEB.APP',
  ]) {
    assert.equal(isPreviewHost(host), true, host);
    assert.equal(configForHost(host), PREVIEW_CONFIG, host);
    assert.equal(configForHost(host).projectId, PREVIEW_PROJECT_ID, host);
  }
});

test('look-alike hosts are not the preview', () => {
  for (const host of [
    'mise-app-preview.web.app.evil.example',
    'evil-mise-app-preview.web.app',
    'mise-app-preview-pr1.web.app',
    'mise-app-preview--.web.app',
    'x.mise-app-preview.firebaseapp.com',
  ]) {
    assert.equal(isPreviewHost(host), false, host);
  }
});

test('the two configs name different projects, and each is internally consistent', () => {
  assert.notEqual(PRODUCTION_CONFIG.projectId, PREVIEW_CONFIG.projectId);
  assert.notEqual(PRODUCTION_CONFIG.apiKey, PREVIEW_CONFIG.apiKey);
  for (const cfg of [PRODUCTION_CONFIG, PREVIEW_CONFIG]) {
    assert.equal(cfg.authDomain, `${cfg.projectId}.firebaseapp.com`);
    assert.ok(cfg.appId.startsWith(`1:${cfg.messagingSenderId}:web:`));
    assert.ok(Object.isFrozen(cfg));
  }
});

test('js/firebase.js takes its config from the hostname, and names no project itself', () => {
  const src = read('js/firebase.js');
  assert.match(src, /export const firebaseConfig = configForHost\(location\.hostname\);/);
  assert.match(src, /import \{ configForHost, isPreviewHost \} from '\.\/firebase-target\.js';/);
  assert.doesNotMatch(src, /apiKey:\s*"AIza/, 'a literal key in firebase.js would bypass the hostname switch');
});

test('every page marks a preview with the ribbon, from the gate every page loads', () => {
  assert.match(read('js/auth-gate.js'), /if \(isPreview\) showPreviewRibbon\(\);/);
  assert.match(read('tokens.css'), /\.preview-ribbon\s*\{[^}]*pointer-events:\s*none/);
});
