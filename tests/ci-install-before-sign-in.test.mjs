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
// And every version comes from a lockfile. firebase-tools ships no npm-shrinkwrap.json, so the
// global `npm install firebase-tools@x` resolved its ~670 packages afresh on every run, and a
// hijacked new patch of any of them would have RUN during the deploy, credential in hand. Since
// October 2026 CI installs it from ci/firebase-tools/package-lock.json (`npm ci`), and the
// checks at the end of this file pin that folder.
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

// A guard on the guard: a new job that can sign in to Google must be looked at here, not slip past.
test('the jobs that can sign in to Google are exactly the two deploy jobs', () => {
  assert.deepEqual(signingJobs.map((job) => job.id).sort(), ['preview.yml: preview', 'test.yml: deploy-functions']);
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

test('every install in those jobs is npm ci / npm install with --ignore-scripts', () => {
  for (const job of signingJobs) {
    const tools = lines(job.text).filter((line) => PACKAGE_TOOL.test(line) && !/\bnpm audit\b/.test(line));
    assert.ok(tools.length > 0, `${job.id}: installs nothing — has the job changed shape?`);
    for (const line of tools) {
      assert.match(line, /\bnpm (ci|install)\b.*\s--ignore-scripts\b/, `${job.id}: ${line.trim()}`);
    }
  }
});

// The one way CI gets firebase-tools: a step of its own that installs the locked tree with no
// install scripts and puts ONLY the `firebase` command on PATH for the steps after it — never the
// whole node_modules/.bin, whose other names would sit ahead of the system's commands.
const LOCKED_INSTALL = new RegExp([
  '\\n {6}- name: [^\\n]+',
  ' {8}run: \\|',
  ' {10}npm ci --ignore-scripts',
  ' {10}mkdir -p "\\$RUNNER_TEMP/firebase-cli"',
  ' {10}ln -s "\\$PWD/node_modules/\\.bin/firebase" "\\$RUNNER_TEMP/firebase-cli/firebase"',
  ' {10}echo "\\$RUNNER_TEMP/firebase-cli" >> "\\$GITHUB_PATH"',
  ' {8}working-directory: ci/firebase-tools\\n',
].join('\\n'), 'g');
// A step that RUNS the CLI (not a path or a cache key that merely names firebase-tools).
const RUNS_FIREBASE = /(^|[\s;&|(])firebase\s/m;

test('firebase-tools is installed from its lockfile in its own step before the sign-in', () => {
  for (const job of signingJobs) {
    const body = code(job.text);
    const steps = [...body.matchAll(LOCKED_INSTALL)];
    assert.equal(steps.length, 1, `${job.id}: no step of its own installing firebase-tools from ci/firebase-tools`);
    assert.ok(steps[0].index < body.search(/\n\s*(- )?uses:\s*['"]?google-github-actions\/auth@/),
      `${job.id}: firebase-tools must be installed BEFORE the sign-in`);
  }
});

// The `rules` job installs it the same way on every push, which is what proves the emulator still
// runs from the locked tree without install scripts — so every job that runs `firebase` has that
// one install, before its first use, and nothing anywhere gets firebase-tools another way.
test('every job that runs firebase installs it from the lockfile first, and nothing installs it another way', () => {
  const users = workflows.flatMap((w) => w.jobs).filter((job) => RUNS_FIREBASE.test(code(job.text)));
  assert.deepEqual(users.map((job) => job.id).sort(),
    ['preview.yml: preview', 'test.yml: deploy-functions', 'test.yml: rules']);
  for (const job of users) {
    const body = code(job.text);
    const steps = [...body.matchAll(LOCKED_INSTALL)];
    assert.equal(steps.length, 1, `${job.id}: installs firebase-tools from ci/firebase-tools once`);
    assert.ok(steps[0].index < body.search(RUNS_FIREBASE), `${job.id}: runs firebase before installing it`);
  }
  for (const w of workflows) {
    const all = code(w.yaml);
    assert.doesNotMatch(all, /firebase-tools@/, `${w.file}: firebase-tools by version, outside its lockfile`);
    assert.doesNotMatch(all, /\b(npx|pnpx|bunx|npm (exec|x))\b[^\n]*\bfirebase/, `${w.file}: fetches firebase-tools with no lockfile`);
    assert.doesNotMatch(all, /\bnpm\b[^\n]*\s(-g|--global|--location[= ]global)\b/, `${w.file}: a global install has no lockfile`);
    assert.doesNotMatch(all, /node_modules\/\.bin["']? >> ["']?\$GITHUB_PATH/, `${w.file}: a whole .bin folder on PATH`);
  }
});

// ── ci/firebase-tools/: the lockfile itself ──────────────────────────────────────────────────
const LOCK_DIR = 'ci/firebase-tools';
const pkg = JSON.parse(read(`${LOCK_DIR}/package.json`));
const lock = JSON.parse(read(`${LOCK_DIR}/package-lock.json`));
const version = pkg.devDependencies?.['firebase-tools'];

test('the folder pins exactly one package, firebase-tools, at an exact version, with no install scripts', () => {
  assert.equal(pkg.private, true, 'never publishable');
  assert.deepEqual(Object.keys(pkg.devDependencies), ['firebase-tools']);
  assert.equal(pkg.dependencies, undefined, 'a tool, nothing ships: devDependencies only');
  assert.equal(pkg.scripts, undefined, 'no lifecycle script of its own');
  assert.match(version, /^\d+\.\d+\.\d+$/, 'an exact version, never a range');
  const npmrc = read(`${LOCK_DIR}/.npmrc`);
  assert.match(npmrc, /^ignore-scripts=true$/m);
  assert.match(npmrc, /^save-exact=true$/m);
});

// `npm ci` refuses a lockfile that disagrees with package.json — but only in CI, after the push.
test('the lockfile matches package.json, and every package comes from the npm registry with its hash', () => {
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, pkg.name);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  assert.equal(lock.packages['node_modules/firebase-tools']?.version, version);
  const entries = Object.entries(lock.packages).filter(([path]) => path !== '');
  assert.ok(entries.length > 500, `only ${entries.length} packages — is this the whole tree?`);
  for (const [path, entry] of entries) {
    assert.ok(path.startsWith('node_modules/') && !entry.link, `${path}: not a registry package`);
    // `npm install --package-lock-only` once left one behind; `npm prune` removes it.
    assert.ok(!entry.extraneous, `${path}: extraneous — nothing depends on it`);
    assert.match(entry.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, `${path}: ${entry.resolved}`);
    assert.match(entry.integrity ?? '', /^sha512-/, `${path}: no sha512 integrity hash`);
  }
});

test('the emulator cache key follows the locked version', () => {
  assert.match(read('.github/workflows/test.yml'), new RegExp(`\\n {10}key: firebase-emulators-${version.replace(/\./g, '\\.')}\\n`));
});

// Its own gate, not `npm audit --audit-level=…` (why: scripts/audit-ci-firebase-tools.mjs and
// tests/audit-ci-firebase-tools.test.mjs). The WHOLE step is pinned, line by line: an `if:` or a
// `continue-on-error:` slipped into it would keep the step and drop the gate.
test('the test job runs the firebase-tools gate, unconditionally, so deploy-functions cannot run past it', () => {
  const testYml = workflows.find((w) => w.file === 'test.yml');
  const testJob = code(testYml.jobs.find((job) => job.id === 'test.yml: test').text);
  const start = testJob.indexOf("\n      - name: Vulnerability check of CI's firebase-tools (P11)\n");
  assert.ok(start >= 0, 'no firebase-tools vulnerability step in the test job');
  const next = testJob.slice(start + 1).search(/\n {6}- /);
  const step = (next < 0 ? testJob.slice(start + 1) : testJob.slice(start + 1, start + 1 + next))
    .split('\n').filter((line) => line.trim() !== '');
  assert.deepEqual(step.map((line) => line.trim()),
    ["- name: Vulnerability check of CI's firebase-tools (P11)", 'run: node scripts/audit-ci-firebase-tools.mjs']);
  // Nor at the job's level.
  assert.doesNotMatch(testJob, /^ {4}(if|continue-on-error):/m);
  const deploy = testYml.jobs.find((job) => job.id === 'test.yml: deploy-functions');
  assert.match(deploy.text, /\n {4}needs: \[test, rules\]\n/);
});
