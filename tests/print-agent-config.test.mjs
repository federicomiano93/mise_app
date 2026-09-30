// The label-printing program on the shop computer reads PRODUCTION's config out of the app.
//
// ⚠️ PAID FOR IN REVIEW, NOT YET IN THE SHOP: when the config moved from js/firebase.js into
// js/firebase-target.js (the preview project, 30 Sep 2026), print-agent/agent.mjs was still
// searching js/firebase.js by text. Every test stayed green; the first `git pull` on the shop
// PC would have closed the program at start and no label would have printed. And it must read
// PRODUCTION by name: it has no web address, so the hostname switch would give it the preview.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAppConfig } from '../print-agent/agent.mjs';
import { PRODUCTION_CONFIG } from '../js/firebase-target.js';

test('the print agent finds production\'s key and project, and never the preview\'s', () => {
  const cfg = readAppConfig();
  assert.equal(cfg.projectId, 'bakery-app-ebf90');
  assert.equal(cfg.projectId, PRODUCTION_CONFIG.projectId);
  assert.equal(cfg.apiKey, PRODUCTION_CONFIG.apiKey);
});
