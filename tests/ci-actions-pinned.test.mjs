// Every GitHub Action this repository runs is pinned to a commit (P11).
//
// ⚠️ A TAG IS A POINTER ITS OWNER CAN MOVE. `actions/checkout@v5` means «whatever the
// actions/checkout repository calls v5 today»: whoever controls that repository can point it at
// new code, and the next run executes it — in deploy-functions beside production's deploy
// credential, in preview beside the preview project's. A full commit SHA cannot be moved. The
// version stays as a trailing comment, which Dependabot reads and rewrites together with the SHA.
//
// ⚠️ AND THE PINS MUST NOT AGE IN SILENCE: GitHub raises no Dependabot alert for an action pinned
// to a SHA, so .github/dependabot.yml's monthly pull request is what brings in a fixed version.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Read as LF: a Windows checkout turns every LF into CRLF and some patterns span lines.
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const workflows = readdirSync(new URL('../.github/workflows/', import.meta.url))
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: read(`.github/workflows/${f}`) }));

// `owner/repo` (or `owner/repo/sub/path`), `@`, 40 hex characters, ` # v1.2.3`.
const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;
const USES = /^\s*(?:- )?uses:\s*(.*?)\s*$/;

// Every `uses:` that is not a comment — a step's or a job's (reusable workflows), with or without
// the step's leading dash.
const uses = workflows.flatMap(({ file, text }) => text.split('\n').flatMap((line, i) => {
  if (/^\s*#/.test(line) || !/\buses:/.test(line)) return [];
  const m = line.match(USES);
  return [{ where: `${file}:${i + 1}`, line, value: m ? m[1] : null }];
}));

test('the scan sees both workflows and every action in them', () => {
  assert.deepEqual(workflows.map((w) => w.file).sort(), ['preview.yml', 'test.yml']);
  // 19 on 11 Oct 2026; far fewer would mean the scan stopped seeing them, not that they left.
  assert.ok(uses.length >= 15, `only ${uses.length} uses: lines found`);
  for (const u of uses) {
    assert.ok(u.value, `${u.where}: a uses: this scan cannot read — write it as \`uses: owner/repo@sha # vX.Y.Z\`: ${u.line.trim()}`);
  }
});

test('every action is pinned to a full commit SHA, with its version beside it', () => {
  for (const u of uses) {
    // A local action is this repository's own code, already pinned by the checkout.
    if (u.value.startsWith('./')) continue;
    assert.match(u.value, PINNED, `${u.where}: pin it to the commit its release tag points to, ` +
      `e.g. \`git ls-remote --tags https://github.com/<owner>/<repo>\` (the ^{} line) — got ${u.value}`);
  }
});

// The jobs holding a credential run exactly what the credential-free jobs ran and passed with —
// a hand edit or a half-applied bump cannot leave one job on another commit.
test('one action, one commit: every job runs the same version of it', () => {
  const seen = new Map();
  for (const u of uses) {
    if (u.value.startsWith('./')) continue;
    const [name, ref] = u.value.split('@');
    if (!seen.has(name)) seen.set(name, new Map());
    seen.get(name).set(ref, u.where);
  }
  for (const [name, refs] of seen) {
    assert.equal(refs.size, 1, `${name} is pinned to ${refs.size} different commits: ${[...refs].map(([r, w]) => `${w} → ${r}`).join('; ')}`);
  }
});

test('Dependabot keeps the pinned actions current, once a month, a week after each release', () => {
  const config = read('.github/dependabot.yml');
  assert.match(config, /^version: 2$/m);
  assert.match(config, /- package-ecosystem: github-actions\n\s+directory: \/\n\s+schedule:\n\s+interval: monthly\n/,
    'without it no alert ever arrives for a pinned action');
  assert.match(config, /\n\s+cooldown:\n\s+default-days: 7\n/);
  assert.match(config, /update-types:\n\s+- version-update:semver-major\n/,
    'a major version is a task of its own, never part of the monthly bump');
});

// Its pull requests only move the actions: nothing to show on a phone, and an action version
// nobody has reviewed must not run in the job that can mint the preview credential.
test('Dependabot\'s pull requests get no preview', () => {
  const preview = workflows.find((w) => w.file === 'preview.yml').text;
  const notDependabot = "github.event.pull_request.user.login != 'dependabot[bot]'";
  for (const job of ['build-mise2', 'preview']) {
    const body = preview.slice(preview.indexOf(`\n  ${job}:\n`));
    const ifLine = body.split('\n').find((l) => /^ {4}if: /.test(l));
    assert.ok(ifLine && ifLine.includes(notDependabot), `${job}: ${ifLine}`);
  }
});
