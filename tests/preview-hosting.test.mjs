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

// A Windows checkout turns every LF into CRLF, and the patterns below match `\n` across lines:
// read as LF so the suite passes the same on his PC as on CI.
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
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
  assert.match(workflow, /git archive --format=tar HEAD -- \\\n\s+':\(glob\)\*\.html' ':\(glob\)\*\.css' sw\.js manifest\.json qr\.png js dist icons fonts sounds \\\n\s+\| tar -x -C _site/);
  assert.doesNotMatch(workflow, /cp -r|rsync/);
  // firebase-tools follows symlinks on upload: one committed link could publish the workspace
  assert.match(workflow, /if \[ -n "\$\(find _site -type l\)" \]; then/);
});

// ⚠️ MISE 2 IS BUILT WHERE NO CREDENTIAL EXISTS. Building it installs and runs hundreds of npm
// packages; the job that deploys can mint a Google credential (`id-token: write`), so any of that
// code running there could ask for one. The build therefore lives in its own job that may only
// read the repository, and the deploy job receives the built files — never the source, never an
// install. Merging the two "to save a minute" is exactly the change these assertions refuse.
test('Mise 2 is built in a job with no Google identity, and only its built files reach the site', () => {
  const [beforePreview, fromPreview] = workflow.split('\n  preview:\n');
  const buildJob = beforePreview.slice(beforePreview.indexOf('\n  build-mise2:\n'));
  const deployJob = fromPreview.split('\n  comment:\n')[0];
  assert.match(buildJob, /permissions:\n\s+contents: read\n\s+steps:/);
  assert.doesNotMatch(buildJob, /id-token|google-github-actions|firebase/);
  assert.match(buildJob, /npm ci --ignore-scripts\n\s+working-directory: shared/);
  assert.match(buildJob, /npm ci --ignore-scripts\n\s+working-directory: app/);
  assert.match(buildJob, /npm run build -- --base=\/mise2\//);
  assert.match(buildJob, /uses: actions\/checkout@[^\n]*\n\s+with:\n\s+persist-credentials: false/);

  assert.match(deployJob, /^\s+needs: build-mise2\n/);
  // A failed Mise 2 build must never take away the current app's preview (his only check of a
  // fix before it goes live): the job runs unless cancelled, and only /mise2/ is left out.
  assert.match(deployJob, /\n {4}if: \$\{\{ !cancelled\(\) && github\.event\.pull_request\.head\.repo\.full_name == github\.repository && github\.event\.pull_request\.user\.login != 'dependabot\[bot\]' \}\}\n/);
  assert.match(deployJob, /- if: needs\.build-mise2\.result == 'success'\n\s+uses: actions\/download-artifact@/);
  assert.match(deployJob, /if \[ -d "\$RUNNER_TEMP\/mise2-site" \]; then\n\s+mv "\$RUNNER_TEMP\/mise2-site" _site\/mise2\n\s+fi/);
  assert.doesNotMatch(deployJob, /npm (install|run)\b|\bnpx\b|\bvite\b/,
    'the job holding the credential builds nothing');
  assert.equal((deployJob.match(/\bnpm ci\b/g) || []).length, 1, 'one install in the credential job');
  assert.deepEqual([...deployJob.matchAll(/npm ci[^\n]*(\n {10}[^\n]*)*\n {8}working-directory: [^\n]*/g)].map(m => m[0].replace(/\n\s+/g, ' ')),
    ['npm ci --ignore-scripts mkdir "$RUNNER_TEMP/firebase-cli" ' +
     'ln -s "$PWD/node_modules/.bin/firebase" "$RUNNER_TEMP/firebase-cli/firebase" ' +
     'echo "$RUNNER_TEMP/firebase-cli" >> "$GITHUB_PATH" working-directory: ci/firebase-tools'],
    'the one thing the credential job installs is firebase-tools from its lockfile, with no install scripts');
  assert.match(deployJob, /uses: actions\/download-artifact@[^\n]*\n\s+with:\n\s+name: mise2-site\n\s+path: \$\{\{ runner\.temp \}\}\/mise2-site/);
  // Moved in BEFORE the symlink check, so the check covers it too.
  const stage = deployJob.slice(deployJob.indexOf('Stage only the app\'s files'));
  assert.ok(stage.indexOf('mv "$RUNNER_TEMP/mise2-site" _site/mise2') > 0);
  assert.ok(stage.indexOf('mv "$RUNNER_TEMP/mise2-site" _site/mise2') < stage.indexOf('find _site -type l'));
});

test('the leak check also proves Mise 2\'s source is not served and its page is', () => {
  const check = workflow.slice(workflow.indexOf('Prove nothing internal is being served'));
  // ci/firebase-tools/ is installed in this job's workspace: the allowlist leaves it out, this proves it.
  for (const path of ['app/package.json', 'app/src/main.tsx', 'shared/package.json', 'mise2/package.json',
    'ci/firebase-tools/package.json']) {
    assert.ok(check.includes(path), path);
  }
  assert.match(check, /MISE2_BUILT: \$\{\{ needs\.build-mise2\.result == 'success' \}\}/);
  assert.match(check, /if \[ "\$MISE2_BUILT" = true \]; then\n\s+\[ "\$\(code mise2\/index\.html\)" = 200 \]/);
});

test('the PR comment gives the Mise 2 address, or says it was not built', () => {
  const commentJob = workflow.split('\n  comment:\n')[1];
  assert.match(commentJob, /^\s+needs: \[build-mise2, preview\]\n\s+if: \$\{\{ !cancelled\(\) && needs\.preview\.result == 'success' \}\}\n/);
  assert.match(commentJob, /\$FIXED_URL\/mise2\//);
  assert.match(commentJob, /non si è costruita/);
});

test('the deploy job cannot hang for hours', () => {
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /curl -s --max-time 15/);
});

// EVERY checkout, not the first one found: once a second job (build-mise2) came first in the
// file, a whole-file match was satisfied by it and stopped watching the job that holds the
// credential — the one the 30 Sep leak came from.
test('no credential is left in the workspace for anything to pick up', () => {
  const checkouts = workflow.match(/uses: actions\/checkout@[^\n]*/g) || [];
  const safe = workflow.match(/uses: actions\/checkout@[^\n]*\n\s+with:\n\s+persist-credentials: false/g) || [];
  assert.equal(checkouts.length, 2, 'build-mise2 and preview each check out once');
  assert.equal(safe.length, checkouts.length, 'every checkout must say persist-credentials: false');
  assert.match(workflow, /--json > "\$RUNNER_TEMP\/channel\.json"/);
});

test('every deploy is followed by a check that takes the channel down if anything internal answers', () => {
  const check = workflow.slice(workflow.indexOf('Prove nothing internal is being served'));
  for (const path of ['.git/config', '.github/workflows/preview.yml', 'firebase.json', 'package.json', 'gha-creds-*.json']) {
    assert.ok(check.includes(path), path);
  }
  assert.match(check, /firebase hosting:channel:delete "\$CHANNEL" --project mise-app-preview --force\n\s+exit 1/);
});

// The default is the FAKE-DATA project: a command typed without --project (a bare `firebase
// deploy`, a `firestore:delete`) then lands where nothing real lives. Production is always named
// on the command line (the go-live and firestore-rules skills, test.yml). No "prod" alias either:
// `firebase use prod` would store production as this folder's active project, which overrides
// this file for every later command.
test('only the preview project maps a hosting target; the default is the preview project, with no alias beside it', () => {
  assert.deepEqual(firebaserc.projects, { default: 'mise-app-preview' },
    'a bare firebase command must reach the fake-data project, never production');
  assert.deepEqual(Object.keys(firebaserc.targets || {}), ['mise-app-preview']);
  assert.deepEqual(firebaserc.targets['mise-app-preview'].hosting, { preview: ['mise-app-preview'] });
});

test('the workflow signs in to, and deploys to, the preview project only', () => {
  assert.doesNotMatch(workflow, /bakery-app-ebf90|27778450817/);
  for (const line of workflow.split('\n').filter((l) => /firebase (deploy|hosting:)/.test(l))) {
    assert.match(line, /--project mise-app-preview/, line.trim());
  }
  assert.match(workflow, /service_account: preview-deploy@mise-app-preview\.iam\.gserviceaccount\.com/);
  assert.match(workflow, /providers\/github-oidc\n/,
    'the PREVIEW project\'s github-provider was disabled after the 30 Sep leak (production\'s own ' +
    'github-provider, in bakery-app-ebf90, is a different one and must stay enabled)');
});

test('only the comment job may write on the PR, and it runs nothing but gh', () => {
  const [deployJob, commentJob] = workflow.split('\n  comment:\n');
  assert.doesNotMatch(deployJob, /pull-requests: write/);
  assert.match(commentJob, /permissions:\n\s+pull-requests: write\n/);
  assert.doesNotMatch(commentJob, /npm|npx|firebase|checkout/);
});

// ⚠️ ONE FIXED LINK (Federico, 3 Oct 2026: «non voglio mettere sempre le credenziali»): each PR
// channel is a new web.app subdomain, so a phone asks for the password on every PR. The same
// staged files also go to the fixed `anteprima` channel, where he signs in once per phone — and
// that upload is leak-checked exactly like the PR's, never left out of the check.
test('every deploy also refreshes the fixed «anteprima» channel, and both channels are leak-checked', () => {
  assert.match(workflow, /firebase hosting:channel:deploy anteprima --only preview --project mise-app-preview \\\r?\n\s+--expires 30d --non-interactive --json > "\$RUNNER_TEMP\/fixed\.json"/);
  assert.match(workflow, /fixed_url: \$\{\{ steps\.deploy\.outputs\.fixed_url \}\}/);
  const check = workflow.slice(workflow.indexOf('Prove nothing internal is being served'), workflow.indexOf('\n  comment:\n'));
  assert.match(check, /check "\$PR_CHANNEL" "\$PR_URL"/);
  assert.match(check, /check anteprima "\$FIXED_URL"/);
  assert.match(workflow, /\*\*Link fisso\*\*/);
  assert.doesNotMatch(workflow, /password|PREVIEW_PASSWORD/i, 'no credential is ever baked into the preview');
});
