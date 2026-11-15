// Which Firebase project a page talks to, run against BOTH implementations: the TypeScript port in
// shared/ and js/firebase-target.js, which the live app uses today. Ported from
// tests/firebase-target.test.mjs (the behaviour tests only).
//
// NOT PORTED — the three tests that read source files as text, which are about the current app's
// files and stay in the root suite: «js/firebase.js takes its config from the hostname», «no file
// but firebase-target.js holds a Firebase key», and «every page marks a preview with the ribbon».
//
// ⚠️⚠️ THE TWO FAILURES THIS PINS ARE NOT SYMMETRICAL. A preview page given the PRODUCTION config
// would let somebody trying a pull request save real orders into a real bakery. The live site
// given the PREVIEW config would show every phone an empty test database. Both are silent in the
// sense that the app "works", so both directions are asserted — and production is an ALLOWLIST, so
// any host nobody thought of lands on the harmless side. The two apps share one origin, so they
// must also agree with each other, input for input.

import { describe, expect, test } from 'vitest';
import * as ported from './firebase-target';
import * as legacyJs from '../../js/firebase-target.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('the live site and localhost get PRODUCTION — and nothing else does', () => {
    for (const host of ['federicomiano93.github.io', 'FEDERICOMIANO93.GITHUB.IO', 'federicomiano93.github.io.',
      'localhost', '127.0.0.1', '::1', '[::1]']) {
      expect(m.configForHost(host), host).toBe(m.PRODUCTION_CONFIG);
      expect(m.isPreviewHost(host), host).toBe(false);
    }
    expect([...m.PRODUCTION_HOSTS].sort()).toStrictEqual(
      ['127.0.0.1', '::1', '[::1]', 'federicomiano93.github.io', 'localhost'].sort());
    // ^ a new production host is a decision: add it here only with the reason
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
      expect(m.configForHost(host), host).toBe(m.PREVIEW_CONFIG);
      expect(m.configForHost(host).projectId, host).toBe(m.PREVIEW_PROJECT_ID);
    }
  });

  test('any host nobody listed lands on the preview (the harmless side)', () => {
    for (const host of ['192.168.1.20', 'abc.ngrok.app', 'bakery-app-ebf90.web.app', 'example.com',
      'federicomiano93.github.io.evil.example', 'github.io', '', undefined,
      // ⚠️ the emulator switch compares these exactly, so a dotted spelling would reach
      // production WITHOUT being diverted to the emulator
      'localhost.', '127.0.0.1.']) {
      expect(m.configForHost(host), String(host)).toBe(m.PREVIEW_CONFIG);
    }
  });

  test('the two configs name different projects, and each is internally consistent', () => {
    expect(m.PRODUCTION_CONFIG.projectId).not.toBe(m.PREVIEW_CONFIG.projectId);
    expect(m.PRODUCTION_CONFIG.apiKey).not.toBe(m.PREVIEW_CONFIG.apiKey);
    for (const cfg of [m.PRODUCTION_CONFIG, m.PREVIEW_CONFIG]) {
      expect(cfg.authDomain).toBe(`${cfg.projectId}.firebaseapp.com`);
      expect(cfg.appId.startsWith(`1:${cfg.messagingSenderId}:web:`)).toBe(true);
      expect(Object.isFrozen(cfg)).toBe(true);
    }
  });

  // Added: the table of hosts the owner asked to be pinned one by one. `true` means «preview» —
  // the harmless side. Only the live site (with or without the trailing dot, in any case) and the
  // exact local names are production.
  test('isPreviewHost answers for each host that matters', () => {
    const TABLE: readonly (readonly [unknown, boolean])[] = [
      ['federicomiano93.github.io', false],
      ['federicomiano93.github.io.', false],
      ['localhost', false],
      ['localhost.', true],
      ['127.0.0.1', false],
      ['[::1]', false],
      ['mise-app-preview--pr-1-abc.web.app', true],
      ['192.168.1.5', true],
      ['', true],
      [undefined, true],
    ];
    for (const [host, preview] of TABLE) {
      expect(m.isPreviewHost(host), String(host)).toBe(preview);
    }
  });

  test('a missing or non-text hostname is the preview, never production', () => {
    for (const host of [null, undefined, '', 0, false, NaN, {}, []]) {
      expect(m.isPreviewHost(host), String(host)).toBe(true);
    }
  });

  // The production names only forgive a trailing dot on the LIVE site, and nothing forgives a port,
  // a scheme, a path or a neighbouring name: each of those is a different address.
  test('near misses of a production host are the preview', () => {
    for (const host of ['federicomiano93.github.io:443', 'https://federicomiano93.github.io', 'federicomiano93.github.io/mise_app',
      'www.federicomiano93.github.io', 'federicomiano93.github.io..', 'x.federicomiano93.github.io', 'localhost:3000', 'LOCALHOST.',
      '::1.', '0.0.0.0', '127.0.0.2', ' localhost', 'localhost ', 'local host']) {
      expect(m.isPreviewHost(host), host).toBe(true);
      expect(m.configForHost(host), host).toBe(m.PREVIEW_CONFIG);
    }
  });

  test('production is exactly the live host and the local names, and the preview project id is fixed', () => {
    expect(m.LIVE_HOST).toBe('federicomiano93.github.io');
    expect([...m.LOCAL_HOSTS]).toStrictEqual(['localhost', '127.0.0.1', '::1', '[::1]']);
    expect([...m.PRODUCTION_HOSTS]).toStrictEqual([m.LIVE_HOST, ...m.LOCAL_HOSTS]);
    expect(m.PREVIEW_PROJECT_ID).toBe('mise-app-preview');
    expect(m.PRODUCTION_CONFIG.projectId).toBe('bakery-app-ebf90');
    expect(Object.isFrozen(m.LOCAL_HOSTS)).toBe(true);
    expect(Object.isFrozen(m.PRODUCTION_HOSTS)).toBe(true);
  });
});
