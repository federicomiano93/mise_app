// Which Firebase project a page talks to (js/firebase-target.js).
//
// ⚠️⚠️ THE TWO FAILURES THIS PINS ARE NOT SYMMETRICAL. A preview page given the PRODUCTION
// config would let somebody trying a pull request save real orders into a real bakery. The
// live site given the PREVIEW config would show every phone an empty test database. Both are
// silent in the sense that the app "works", so both directions are asserted — and production
// is an ALLOWLIST, so any host nobody thought of lands on the harmless side.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  configForHost, isPreviewHost, PRODUCTION_CONFIG, PREVIEW_CONFIG, PREVIEW_PROJECT_ID, PRODUCTION_HOSTS,
} from '../js/firebase-target.js';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

test('the live site and localhost get PRODUCTION — and nothing else does', () => {
  for (const host of ['federicomiano93.github.io', 'FEDERICOMIANO93.GITHUB.IO', 'federicomiano93.github.io.',
    'localhost', '127.0.0.1', '::1', '[::1]']) {
    assert.equal(configForHost(host), PRODUCTION_CONFIG, host);
    assert.equal(isPreviewHost(host), false, host);
  }
  assert.deepEqual([...PRODUCTION_HOSTS].sort(),
    ['127.0.0.1', '::1', '[::1]', 'federicomiano93.github.io', 'localhost'].sort(),
    'a new production host is a decision: add it here only with the reason');
});

test('⚠️ every preview address gets the PREVIEW project, never production', () => {
  for (const host of [
    'mise-app-preview.web.app',
    'mise-app-preview.firebaseapp.com',
    'mise-app-preview--pr-244-vd70c50d.web.app',
    'mise-app-preview--pr-244-vd70c50d.firebaseapp.com',   // the same channel on its second domain
    'mise-app-preview--pr-244-vd70c50d.web.app.',          // trailing dot
    'MISE-APP-PREVIEW--PR7-ABC.WEB.APP',
  ]) {
    assert.equal(configForHost(host), PREVIEW_CONFIG, host);
    assert.equal(configForHost(host).projectId, PREVIEW_PROJECT_ID, host);
  }
});

test('any host nobody listed lands on the preview (the harmless side)', () => {
  for (const host of ['192.168.1.20', 'abc.ngrok.app', 'bakery-app-ebf90.web.app', 'example.com',
    'federicomiano93.github.io.evil.example', 'github.io', '', undefined]) {
    assert.equal(configForHost(host), PREVIEW_CONFIG, String(host));
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
  assert.doesNotMatch(src, /AIza|bakery-app-ebf90|mise-app-preview/,
    'a key or a project id in firebase.js would bypass the hostname switch');
});

test('no file but firebase-target.js holds a Firebase key or imports a config directly', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== 'vendor') walk(full); continue; }
      if (!name.endsWith('.js') || name === 'firebase-target.js') continue;
      const src = readFileSync(full, 'utf8');
      if (/AIza[\w-]{30,}/.test(src) || /\b(PRODUCTION|PREVIEW)_CONFIG\b/.test(src)) offenders.push(full);
    }
  };
  walk(new URL('js', ROOT).pathname.replace(/^\/(\w:)/, '$1'));
  assert.deepEqual(offenders, []);
});

test('every page marks a preview with the ribbon, from the gate every page loads', () => {
  assert.match(read('js/auth-gate.js'), /if \(isPreview\) showPreviewRibbon\(\);/);
  assert.match(read('tokens.css'), /\.preview-ribbon\s*\{[^}]*pointer-events:\s*none/);
});
