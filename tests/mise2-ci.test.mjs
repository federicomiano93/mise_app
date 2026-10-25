// Mise 2's CI job and its supply chain (P11).
//
// Mise 2 is the one part of this project that installs hundreds of npm packages. What makes
// that acceptable is a handful of lines that are easy to "simplify" away: the job may only
// read the repository, no package may run code while it installs, every version is written
// down exactly, and every package comes from the npm registry. Each line here pins one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Read as LF: a Windows checkout turns every LF into CRLF and the patterns span lines.
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('.github/workflows/test.yml');

function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `test.yml has no ${name} job`);
  // Up to the next line at the jobs' own indent — the next job, or the comment above it.
  const next = workflow.slice(start + 1).search(/\n {2}\S/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

test('the mise2 job may only read the repository, and holds no credential', () => {
  const mise2 = job('mise2');
  assert.match(mise2, /\n {4}permissions:\n {6}contents: read\n {4}steps:/);
  assert.doesNotMatch(mise2, /id-token|google-github-actions|firebase|secrets\./);
  assert.match(mise2, /uses: actions\/checkout@[^\n]*\n\s+with:\n\s+persist-credentials: false/);
});

test('the mise2 job installs from the lockfiles with no install scripts, then checks everything', () => {
  const mise2 = job('mise2');
  const installs = [...mise2.matchAll(/npm (ci|install)[^\n]*\n\s+working-directory: (\w+)/g)].map(m => `${m[0].split('\n')[0].trim()} @ ${m[2]}`);
  assert.deepEqual(installs, ['npm ci --ignore-scripts @ shared', 'npm ci --ignore-scripts @ app']);
  for (const dir of ['shared', 'app']) {
    for (const step of ['npm run typecheck', 'npm test', 'npm audit --audit-level=high']) {
      assert.match(mise2, new RegExp(`run: ${step}\\n\\s+working-directory: ${dir}\\n`), `${step} in ${dir}`);
    }
  }
  assert.match(mise2, /run: npm run build\n\s+working-directory: app\n/);
});

test('the live deploy still waits on the current app\'s two checks, and only on them', () => {
  assert.match(job('deploy-functions'), /\n {4}needs: \[test, rules\]\n/);
});

test('no Mise 2 package may run code at install, and new versions are saved exactly', () => {
  for (const dir of ['app', 'shared']) {
    const npmrc = read(`${dir}/.npmrc`);
    assert.match(npmrc, /^ignore-scripts=true$/m, `${dir}/.npmrc`);
    assert.match(npmrc, /^save-exact=true$/m, `${dir}/.npmrc`);
  }
});

test('every Mise 2 dependency is pinned exactly and comes from the npm registry', () => {
  for (const dir of ['app', 'shared']) {
    const pkg = JSON.parse(read(`${dir}/package.json`));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(Object.keys(deps).length > 0, `${dir} declares no dependencies — has the layout moved?`);
    for (const [name, version] of Object.entries(deps)) {
      if (name === '@mise/shared') { assert.equal(version, 'file:../shared'); continue; }
      assert.match(version, /^\d+\.\d+\.\d+$/, `${dir}: ${name}@${version} is a range, not a version`);
    }
    const lock = JSON.parse(read(`${dir}/package-lock.json`));
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path || entry.link || !entry.resolved) continue;
      assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, `${dir}: ${path}`);
      assert.match(entry.integrity || '', /^sha512-/, `${dir}: ${path} has no sha512 integrity`);
    }
  }
});
