// The preview links (.github/workflows/preview.yml): what they publish, and where.
//
// ⚠️ TWO FAILURES, BOTH PAID FOR OR NEARLY:
// 1. Publishing the WORKSPACE instead of the app. The first version uploaded the checkout folder
//    — `.git/config` with the job's token and the `gha-creds-*.json` file the Google sign-in
//    writes there — onto a public address (30 Sep 2026, caught by review, channel deleted and the
//    trust replaced). A test that only checked the ignore LIST passed while it happened, so this
//    one checks the shape that makes it impossible: git-archive an allowlist into `_site/`.
// 2. Publishing to PRODUCTION's Firebase Hosting — a second live copy past branch protection. So
//    hosting is bound to a target only the preview project maps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const firebaseJson = JSON.parse(read('firebase.json'));
const firebaserc = JSON.parse(read('.firebaserc'));
const workflow = read('.github/workflows/preview.yml');
const hosting = [].concat(firebaseJson.hosting || []);

test('hosting publishes the staged _site folder, bound to the "preview" target', () => {
  assert.equal(hosting.length, 1);
  assert.equal(hosting[0].target, 'preview');
  assert.equal(hosting[0].public, '_site', 'never "." — that is the workspace, secrets included');
  for (const pattern of ['**/.*', '**/.*/**', 'gha-creds-*.json']) {
    assert.ok(hosting[0].ignore.includes(pattern), pattern);
  }
  assert.match(read('.gitignore'), /^_site\/$/m);
});

test('_site is built from git by an allowlist, never copied from the workspace', () => {
  assert.match(workflow, /git archive --format=tar HEAD -- \\\n\s+':\(glob\)\*\.html' ':\(glob\)\*\.css' sw\.js manifest\.json qr\.png js icons fonts sounds \\\n\s+\| tar -x -C _site/);
  assert.doesNotMatch(workflow, /cp -r|rsync/);
});

test('no credential is left in the workspace for anything to pick up', () => {
  assert.match(workflow, /uses: actions\/checkout@v5\n\s+with:\n\s+persist-credentials: false/);
  assert.match(workflow, /--json > "\$RUNNER_TEMP\/channel\.json"/);
});

test('every deploy is followed by a check that takes the channel down if anything internal answers', () => {
  const check = workflow.slice(workflow.indexOf('Prove nothing internal is being served'));
  for (const path of ['.git/config', '.github/workflows/preview.yml', 'firebase.json', 'package.json', 'gha-creds-*.json']) {
    assert.ok(check.includes(path), path);
  }
  assert.match(check, /firebase hosting:channel:delete "\$CHANNEL" --project mise-app-preview --force\n\s+exit 1/);
});

test('only the preview project maps a hosting target; production maps none and has no alias beside it', () => {
  assert.deepEqual(firebaserc.projects, { default: 'bakery-app-ebf90' },
    'a "preview" alias would let `firebase use preview` send a production rules deploy to the wrong project');
  assert.deepEqual(Object.keys(firebaserc.targets || {}), ['mise-app-preview']);
  assert.deepEqual(firebaserc.targets['mise-app-preview'].hosting, { preview: ['mise-app-preview'] });
});

test('the workflow signs in to, and deploys to, the preview project only', () => {
  assert.doesNotMatch(workflow, /bakery-app-ebf90|27778450817/);
  for (const line of workflow.split('\n').filter((l) => /firebase (deploy|hosting:)/.test(l))) {
    assert.match(line, /--project mise-app-preview/, line.trim());
  }
  assert.match(workflow, /service_account: preview-deploy@mise-app-preview\.iam\.gserviceaccount\.com/);
  assert.match(workflow, /providers\/github-oidc\n/, 'github-provider was disabled after the 30 Sep leak');
});

test('only the comment job may write on the PR, and it runs nothing but gh', () => {
  const [deployJob, commentJob] = workflow.split('\n  comment:\n');
  assert.doesNotMatch(deployJob, /pull-requests: write/);
  assert.match(commentJob, /permissions:\n\s+pull-requests: write\n/);
  assert.doesNotMatch(commentJob, /npm|npx|firebase|checkout/);
});
