// The preview links (.github/workflows/preview.yml) must never be able to publish the app to
// PRODUCTION's Firebase Hosting.
//
// ⚠️ WHY IT MATTERS: the live app is served by GitHub Pages, from main, behind the required
// checks. A Firebase Hosting deploy to the production project would be a SECOND live copy that
// walks past branch protection — so firebase.json's hosting is bound to a TARGET that only the
// preview project maps. A plain `firebase deploy` against bakery-app-ebf90 then stops with
// «deploy target preview not configured», instead of publishing whatever branch is checked out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const firebaseJson = JSON.parse(read('firebase.json'));
const firebaserc = JSON.parse(read('.firebaserc'));
const workflow = read('.github/workflows/preview.yml');

test('every hosting entry is bound to the "preview" target', () => {
  const hosting = [].concat(firebaseJson.hosting || []);
  assert.ok(hosting.length > 0);
  for (const entry of hosting) assert.equal(entry.target, 'preview');
});

test('only the preview project maps a hosting target, and production maps none', () => {
  assert.equal(firebaserc.projects.default, 'bakery-app-ebf90');
  assert.deepEqual(Object.keys(firebaserc.targets || {}), ['mise-app-preview']);
  assert.deepEqual(firebaserc.targets['mise-app-preview'].hosting, { preview: ['mise-app-preview'] });
});

test('the hosting upload leaves out everything that is not the app', () => {
  const ignore = [].concat(firebaseJson.hosting)[0].ignore;
  for (const pattern of ['**/.*', 'functions/**', 'tests/**', 'scripts/**', '**/*.md', 'firebase.json']) {
    assert.ok(ignore.includes(pattern), pattern);
  }
});

test('the preview workflow signs in to, and deploys to, the preview project only', () => {
  assert.doesNotMatch(workflow, /bakery-app-ebf90/);
  assert.doesNotMatch(workflow, /27778450817/, 'production\'s project number');
  for (const line of workflow.split('\n').filter((l) => /firebase (deploy|hosting:)/.test(l))) {
    assert.match(line, /--project mise-app-preview/, line.trim());
  }
  assert.match(workflow, /service_account: preview-deploy@mise-app-preview\.iam\.gserviceaccount\.com/);
});
