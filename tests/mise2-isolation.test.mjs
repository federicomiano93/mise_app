// Mise 2 (app/ + shared/) lives in the same repository as the current app for months, until
// the switch. These checks keep the two out of each other's way.
//
// ⚠️ 1. THE ROOT `npm test` IS `node --test` WITH NO ARGUMENTS: it runs every file anywhere in
// the repo whose name matches Node's default patterns — and on recent Node that includes
// TypeScript files. A Mise 2 spec named `x.test.ts` would be picked up by the CURRENT app's
// suite, which installs nothing and would fail on the first `import 'vitest'`. Mise 2's specs
// are therefore `*.spec.ts(x)`, and nothing under app/ or shared/ may look like a Node test.
//
// ⚠️ 2. THE ROOT PACKAGE STAYS THE CURRENT APP'S. A root `workspaces` entry would pull React and
// Vite into the root lockfile, the root `npm audit` and every `npm install` at the root.
//
// ⚠️ 3. GITHUB PAGES BUILDS THIS REPOSITORY WITH JEKYLL (the "legacy" build, from main's root),
// which renders Markdown and runs Liquid over it. A `{{` or `{%` in a Markdown file — JSX's
// `style={{…}}` in a code sample is enough — fails the whole Pages build, and the live app
// silently stops updating while every check is green. Mise 2 brings docs and React code
// samples, so this rule starts now.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every file under `dir`, skipping what is never committed or never served.
function files(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === '_site') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else out.push(full.slice(ROOT.length + 1).replace(/\\/g, '/'));
  }
  return out;
}

// Node's default test-file patterns (node:test docs), with every extension Node may treat as a
// test — JavaScript and TypeScript alike.
const EXT = '(c|m)?(j|t)sx?';
const NODE_TEST_FILE = new RegExp(
  `(^|/)(test|test-[^/]*|[^/]*[._-]test)\\.${EXT}$|(^|/)test/.*\\.${EXT}$`);

test('the pattern recognises what node --test would run, and spares Mise 2\'s specs', () => {
  for (const hit of ['a/x.test.ts', 'a/x-test.mjs', 'a/x_test.js', 'a/test-x.tsx', 'a/test.ts', 'a/test/setup.ts']) {
    assert.match(hit, NODE_TEST_FILE, hit);
  }
  for (const miss of ['a/x.spec.ts', 'a/x.spec.tsx', 'a/testing/setup.ts', 'a/latest.ts', 'a/contest.ts']) {
    assert.doesNotMatch(miss, NODE_TEST_FILE, miss);
  }
});

test('⚠️ nothing in app/ or shared/ would be run by the current app\'s `node --test`', () => {
  const found = [...files(join(ROOT, 'app')), ...files(join(ROOT, 'shared'))];
  assert.ok(found.some(f => f === 'app/package.json') && found.some(f => f === 'shared/package.json'),
    'Mise 2\'s folders were not found — has the layout moved? Then this check moves with it');
  assert.deepEqual(found.filter(f => NODE_TEST_FILE.test(f)), [],
    'name Mise 2 specs *.spec.ts / *.spec.tsx, and keep them out of folders named test/');
});

test('the root package stays the current app\'s: no workspaces, no Mise 2 packages', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.workspaces, undefined);
  assert.deepEqual(Object.keys(pkg.dependencies || {}), []);
  const lock = readFileSync(join(ROOT, 'package-lock.json'), 'utf8');
  for (const name of ['react', 'vite', 'vitest', 'typescript', '@mise/shared']) {
    assert.ok(!lock.includes(`"node_modules/${name}"`), `${name} is in the ROOT lockfile`);
  }
});

// The COMMITTED files only (what Pages builds): the local notes beside the code are gitignored
// and never reach Pages. Dot-folders are skipped because Jekyll skips them.
test('⚠️ no Markdown file GitHub Pages builds carries a Liquid tag', () => {
  const committed = execFileSync('git', ['ls-files', '-z', '--', '*.md', '*.markdown'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  assert.ok(committed.includes('README.md'), 'git ls-files found no Markdown — is this a checkout?');
  const offenders = committed
    .filter(f => !f.split('/').some(part => part.startsWith('.')))
    .filter(f => /\{\{|\{%/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(offenders, [],
    'Jekyll would fail the whole Pages build on these: keep {{ and {% out of Markdown');
});
