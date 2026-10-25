// No package runs code while it installs in a CI job that can hold a Google credential, and
// nothing is installed once it does (P11).
//
// The sign-in step (google-github-actions/auth) writes a short-lived credential into the
// workspace and exports GOOGLE_APPLICATION_CREDENTIALS. An install script can read that file —
// in deploy-functions, a credential to the LIVE project — and one that ran BEFORE the sign-in
// could leave a process behind that waits for it. So the protection is `--ignore-scripts` on
// every install in those jobs; installing everything first only helps. Until October 2026 both
// jobs installed firebase-tools after the sign-in, globally, with no lockfile and with install
// scripts on, and deploy-functions ran its `npm ci` after the sign-in too.
//
// A review found the first version of this file blind to several edits (a comment that cut a
// job short, a quoted `uses:`, `npm rebuild`, an action after the sign-in): every case below
// was checked against a mutated copy of the workflows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Read as LF: a Windows checkout turns every LF into CRLF and the patterns span lines.
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const files = readdirSync(new URL('../.github/workflows/', import.meta.url)).filter((f) => /\.ya?ml$/.test(f));

// Comment lines removed: a comment may NAME an install without running one.
const code = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
const SIGN_IN = /^\s*(- )?uses:\s*['"]?google-github-actions\/auth@/;
const ID_TOKEN = /\bid-token:\s*['"]?write\b/;
const PACKAGE_TOOL = /\b(npm|npx|yarn|pnpm|pnpx|bun|bunx|pip|pip3|pipx|corepack|node-gyp|gem|cargo)\b/;

// Every job, by name: from its header to the NEXT JOB HEADER, so everything after `jobs:` belongs
// to some job — a comment at the jobs' indent inside a job cannot cut it short and hide the rest.
function parse(file) {
  const yaml = read(`.github/workflows/${file}`);
  const jobsLine = yaml.match(/^jobs:[ \t]*(#.*)?$/m);
  assert.ok(jobsLine, `${file}: no top-level "jobs:" line — has the workflow changed shape?`);
  const body = yaml.slice(jobsLine.index + jobsLine[0].length);
  const headers = [...body.matchAll(/^ {2}(['"]?)([A-Za-z0-9_-]+)\1:[ \t]*(#.*)?$/gm)];
  assert.ok(headers.length > 0, `${file}: no job found at two spaces under "jobs:"`);
  assert.equal(code(body.slice(0, headers[0].index)).trim(), '', `${file}: something under "jobs:" is not a job`);
  return {
    file,
    yaml,
    beforeJobs: yaml.slice(0, jobsLine.index),
    jobs: headers.map((h, i) => ({
      id: `${file}: ${h[2]}`,
      text: body.slice(h.index, i + 1 < headers.length ? headers[i + 1].index : body.length),
    })),
  };
}

const workflows = files.map(parse);
const lines = (text) => code(text).split('\n');
const signingJobs = workflows.flatMap((w) => w.jobs)
  .filter((job) => lines(job.text).some((line) => SIGN_IN.test(line) || ID_TOKEN.test(line)));

test('no workflow grants a Google identity outside a job', () => {
  for (const w of workflows) {
    assert.ok(!lines(w.beforeJobs).some((line) => SIGN_IN.test(line) || ID_TOKEN.test(line)),
      `${w.file}: a workflow-level id-token or sign-in reaches EVERY job`);
  }
});

// The two deploy jobs run firebase-tools, so they install it (the rules below). The job that
// deletes a closed PR's preview channel needs nothing but curl, so it installs NOTHING — a
// stricter rule than `--ignore-scripts`, with its own test at the end.
const DEPLOY_JOBS = ['preview.yml: preview', 'test.yml: deploy-functions'];
const INSTALL_NOTHING = ['preview.yml: delete-channel'];
const deployJobs = signingJobs.filter((job) => DEPLOY_JOBS.includes(job.id));

// A guard on the guard: a new job that can sign in to Google must be looked at here, not slip past.
test('the jobs that can sign in to Google are exactly the two deploy jobs and the channel cleanup', () => {
  assert.deepEqual(signingJobs.map((job) => job.id).sort(), [...DEPLOY_JOBS, ...INSTALL_NOTHING].sort());
});

test('each signs in once, and after the sign-in nothing is installed and no action runs', () => {
  for (const job of signingJobs) {
    const all = lines(job.text);
    assert.equal(all.filter((line) => SIGN_IN.test(line)).length, 1, `${job.id}: one sign-in step`);
    assert.equal(all.filter((line) => ID_TOKEN.test(line)).length, 1, `${job.id}: one id-token permission`);
    const after = all.slice(all.findIndex((line) => SIGN_IN.test(line)) + 1);
    assert.deepEqual(after.filter((line) => PACKAGE_TOOL.test(line)), [], `${job.id}: a package tool after the sign-in`);
    // An action is installed code too, run with the credential in the environment.
    assert.deepEqual(after.filter((line) => /^\s*(- )?uses:/.test(line)), [], `${job.id}: an action after the sign-in`);
  }
});

test('every install in the deploy jobs is npm ci / npm install with --ignore-scripts', () => {
  for (const job of deployJobs) {
    const tools = lines(job.text).filter((line) => PACKAGE_TOOL.test(line) && !/\bnpm audit\b/.test(line));
    assert.ok(tools.length > 0, `${job.id}: installs nothing — has the job changed shape?`);
    for (const line of tools) {
      assert.match(line, /\bnpm (ci|install)\b.*\s--ignore-scripts\b/, `${job.id}: ${line.trim()}`);
    }
  }
});

test('firebase-tools is installed in its own step before the sign-in', () => {
  for (const job of deployJobs) {
    const body = code(job.text);
    const step = body.match(/\n {6}- name: [^\n]+\n {8}run: npm install --global --ignore-scripts firebase-tools@\d+\.\d+\.\d+\n/);
    assert.ok(step, `${job.id}: no step of its own installing firebase-tools with --ignore-scripts`);
    assert.ok(step.index < body.search(/\n\s*(- )?uses:\s*['"]?google-github-actions\/auth@/),
      `${job.id}: firebase-tools must be installed BEFORE the sign-in`);
  }
});

// The `rules` job installs it the same way on every push, which is what proves the emulator still
// runs without install scripts — so every firebase-tools line, anywhere, is that one install.
test('every firebase-tools line, in every workflow, is the one pinned install with no install scripts', () => {
  const found = workflows.flatMap((w) =>
    lines(w.yaml).filter((line) => /\bfirebase-tools\b/.test(line) && !/^\s*(- )?name:/.test(line))
      .map((line) => ({ file: w.file, line: line.trim() })));
  assert.equal(found.length, 3, 'rules, deploy-functions and preview each install firebase-tools once');
  const versions = new Set();
  for (const { file, line } of found) {
    const m = line.match(/^(?:- )?run: npm install --global --ignore-scripts firebase-tools@(\d+\.\d+\.\d+)$/);
    assert.ok(m, `${file}: ${line}`);
    versions.add(m[1]);
  }
  assert.equal(versions.size, 1, `one firebase-tools version everywhere, found ${[...versions].join(', ')}`);
  // The emulator jars are cached against the same pinned version.
  assert.match(read('.github/workflows/test.yml'), new RegExp(`key: firebase-emulators-${[...versions][0].replace(/\./g, '\\.')}\\n`));
});

// It holds a credential to the preview project only for one HTTP call, so it needs no package and
// no action besides the sign-in: none may creep in (a checkout to run `firebase` would bring both).
test('the channel cleanup installs nothing and runs no action but the sign-in', () => {
  const cleanup = signingJobs.filter((job) => INSTALL_NOTHING.includes(job.id));
  assert.equal(cleanup.length, INSTALL_NOTHING.length);
  for (const job of cleanup) {
    const all = lines(job.text);
    assert.deepEqual(all.filter((line) => PACKAGE_TOOL.test(line) || /\bfirebase\b/.test(line)), [],
      `${job.id}: installs or runs a package`);
    assert.deepEqual(all.filter((line) => /^\s*(- )?uses:/.test(line)).map((line) => line.trim()),
      ['uses: google-github-actions/auth@v2'], `${job.id}: the sign-in is its only action`);
  }
});
