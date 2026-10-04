// The app never sends you back to the Home screen after a pause (Federico, 4 Oct 2026).
//
// js/idle-reset.js replaced the page with index.html when the app came back after more than
// five minutes in the background. In practice it threw him out of an order in progress: he
// steps away from the tablet for a few minutes, comes back, and has to tap his way back to
// the supplier he was on. It is gone; the page stays where it was (orders autosave, and the
// Firestore listeners keep the data current meanwhile).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);

test('no page loads an idle reset, and the module is gone', () => {
  assert.equal(existsSync(new URL('js/idle-reset.js', ROOT)), false);
  for (const name of readdirSync(ROOT).filter(n => n.endsWith('.html'))) {
    assert.doesNotMatch(readFileSync(new URL(name, ROOT), 'utf8'), /idle-reset/, name);
  }
  assert.doesNotMatch(readFileSync(new URL('sw.js', ROOT), 'utf8'), /idle-reset/);
});
