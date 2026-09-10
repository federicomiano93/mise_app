// The Node version the Cloud Functions run on.
//
// ⚠️⚠️ THIS IS THE ONE OBLIGATION IN THIS PROJECT WITH A HARD DATE. Google
// decommissions a runtime on a published day, and after it no functions deploy
// succeeds at all — not the one that needed the new runtime, ANY of them. The
// deploy had been warning on every run since 10 Aug 2026 and the note lived in a
// document nobody re-reads.
//
// A warning in a log is not a reminder. This is: the day the pinned runtime
// reaches its decommission date, the test goes red on every push and says so,
// months before the deploy would have started failing.
//
// ⚠️ IT IS NOT "USE THE NEWEST". Firebase supports a small set of runtimes and
// picking one it does not offer fails the deploy immediately. The list below is
// what Firebase actually accepts, with the date Google published for each.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'functions', 'package.json'), 'utf8'));

// Runtime → the day Google stops accepting deploys on it.
const DECOMMISSION = {
  18: '2025-10-30',
  20: '2026-10-30',
  22: '2027-10-30',
};

test('the functions runtime is one Firebase actually offers', () => {
  const node = String(pkg.engines && pkg.engines.node);
  assert.ok(DECOMMISSION[node],
    `Node ${node} is not a runtime Firebase offers — the deploy would fail outright`);
});

// ⚠️ SIX MONTHS, NOT ON THE DAY. A test that goes red the morning deploys stop
// working is a test that tells you at the worst possible moment.
test('the runtime is not within six months of being decommissioned', () => {
  const node = String(pkg.engines && pkg.engines.node);
  const ends = new Date(`${DECOMMISSION[node]}T00:00:00Z`).getTime();
  const sixMonths = 183 * 24 * 60 * 60 * 1000;
  assert.ok(Date.now() < ends - sixMonths,
    `Node ${node} is decommissioned on ${DECOMMISSION[node]}. Raise functions/package.json `
    + 'now — after that date NO functions deploy succeeds, not just this one.');
});

// ── And the CI that tests it ─────────────────────────────────────────────────
//
// ⚠️ THE COUPLING WAS A COMMENT, AND A COMMENT IS NOT A FASTENER. The workflow
// says, in prose, "move them when functions/package.json moves, not before" —
// which is the right instruction and has nothing enforcing it. When the test
// above goes red six months before a decommission and somebody raises
// package.json, nothing makes the three `node-version:` lines follow. The
// symptom of them drifting apart is not a failure: it is CI quietly testing the
// server code on a runtime nobody deploys it to, plus an EBADENGINE warning in
// the deploy's npm ci that everybody has learnt to scroll past. That exact state
// existed from August to 10 Sep 2026.
//
// The same commit that closed it added a test for the SDK's find-and-replace
// risk and none for this one, which is why this is here.
test('every CI job runs the Node version the functions are deployed on', () => {
  const dir = join(ROOT, '.github', 'workflows');
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0, 'no workflow files found — has CI moved?');

  const node = String(pkg.engines && pkg.engines.node);
  const wrong = [];
  let found = 0;

  for (const file of files) {
    const yaml = readFileSync(join(dir, file), 'utf8');
    for (const m of yaml.matchAll(/node-version:\s*'?([\d.]+)'?/g)) {
      found += 1;
      if (m[1] !== node) wrong.push(`${file}: node-version ${m[1]}`);
    }
  }

  // A guard on the guard: if the workflows stop pinning a version at all, this
  // test must be rewritten, not silently pass on an empty list.
  assert.ok(found >= 3,
    `expected every CI job to pin a Node version, found ${found} — if the workflows ` +
    'changed shape, this check changes with them');

  assert.deepEqual(wrong, [],
    `functions/package.json deploys on Node ${node}. A job on anything else tests the ` +
    'server code on a runtime nobody runs it on, and the deploy\'s npm ci warns ' +
    'EBADENGINE on every run. Move them together.');
});
