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

// Every line that is not a comment and names `uses` as a key — a step's or a job's (reusable
// workflows), with or without the step's dash, and in the spellings YAML also accepts (`"uses":`,
// `uses :`). Only the plain spelling is read; any other is refused below rather than skipped.
const uses = workflows.flatMap(({ file, text }) => text.split('\n').flatMap((line, i) => {
  if (/^\s*#/.test(line) || !/\buses['"]?\s*:/.test(line)) return [];
  const m = line.match(USES);
  return [{ where: `${file}:${i + 1}`, line, value: m ? m[1] : null }];
}));

test('the scan sees both workflows and every action in them', () => {
  // A new workflow is scanned too; these two hold the credentials and must never drop out.
  for (const file of ['preview.yml', 'test.yml']) {
    assert.ok(workflows.some((w) => w.file === file), `.github/workflows/${file} is gone — has the layout moved?`);
  }
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

// A hand edit or a half-applied bump cannot leave one job on another commit: an action shared with
// the credential-free jobs runs in the credential jobs exactly as it ran and passed there.
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

// It only moves the actions: nothing to show on a phone, and it would take over the fixed
// `anteprima` link every month. Dependabot's npm security pull requests keep their preview.
test('the monthly actions pull request gets no preview, and nothing else is left out', () => {
  const preview = workflows.find((w) => w.file === 'preview.yml').text;
  const sameRepo = 'github.event.pull_request.head.repo.full_name == github.repository';
  const notActionsBump = "!startsWith(github.head_ref, 'dependabot/github_actions/')";
  const expected = {
    'build-mise2': `    if: ${sameRepo} && ${notActionsBump}`,
    preview: `    if: \${{ !cancelled() && ${sameRepo} && ${notActionsBump} }}`,
  };
  for (const [job, line] of Object.entries(expected)) {
    const start = preview.indexOf(`\n  ${job}:\n`);
    assert.ok(start > 0, `preview.yml has no ${job} job`);
    // This job only: up to the next line at the jobs' own indent.
    const rest = preview.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}\S/);
    const body = next < 0 ? rest : rest.slice(0, next + 1);
    assert.deepEqual(body.split('\n').filter((l) => /^ {4}if:/.test(l)), [line], job);
  }
});
