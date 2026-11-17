// The vulnerability gate on Mise 2's npm trees (scripts/audit-vite-trees.mjs): the judge of CI's
// firebase-tools gate (tests/audit-ci-firebase-tools.test.mjs covers its rules) with its own list.
//
// ⚠️ WHY IT EXISTS: on 17 Nov 2026 picomatch's advisory was raised to cover every version with no fix,
// and plain `npm audit --audit-level=high` in shared/ and app/ turned every PR and push red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../scripts/audit-ci-firebase-tools.mjs';
import { main, ALLOWED_VITE, TREES } from '../scripts/audit-vite-trees.mjs';

const advisory = (id, severity, cwe, title = 'an advisory') =>
  ({ source: 1, name: 'pkg', dependency: 'pkg', title, url: `https://github.com/advisories/${id}`, severity, cwe, range: '*' });
const report = (vulnerabilities) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: { vulnerabilities: {}, dependencies: { prod: 30, dev: 400, optional: 20, peer: 0, peerOptional: 0, total: 430 } },
});
// Today's shared/ and app/ trees: picomatch through vite, vitest and tinyglobby.
const today = () => ({
  picomatch: { severity: 'high', via: [advisory('GHSA-fc5q-39xc-vjpf', 'high', ['CWE-1333'])] },
  tinyglobby: { severity: 'high', via: ['picomatch'] },
  fdir: { severity: 'high', via: ['picomatch'] },
});
const fake = (body) => () => ({ stdout: JSON.stringify(body), stderr: '' });
const quiet = () => {};

test('today\'s trees pass, accepting only picomatch', () => {
  const v = judge(report(today()), ALLOWED_VITE);
  assert.equal(v.ok, true, v.problems.join('\n'));
  assert.deepEqual(v.accepted, ['GHSA-fc5q-39xc-vjpf']);
  for (const tree of TREES) assert.equal(main(tree, fake(report(today())), quiet, quiet), 0, tree);
});

test('any other high or critical still fails, and malicious code fails at any severity', () => {
  for (const extra of [
    { y: { severity: 'high', via: [advisory('GHSA-2222-3333-4444', 'high', ['CWE-400'])] } },
    { y: { severity: 'critical', via: [advisory('GHSA-2222-3333-4444', 'critical', [])] } },
    { y: { severity: 'low', via: [advisory('GHSA-aaaa-bbbb-cccc', 'low', ['CWE-506'])] } },
  ]) {
    assert.equal(main('app', fake(report({ ...today(), ...extra })), quiet, quiet), 1, JSON.stringify(extra));
  }
  // The firebase-tools list does not leak in: its uuid entry would read «not reported» here, and it is not asked for.
  assert.equal(judge(report(today()), ALLOWED_VITE).problems.length, 0);
});

test('when picomatch is fixed (or the audit saw nothing) the entry fails as stale, so it cannot outlive the fix', () => {
  const lines = [];
  assert.equal(main('shared', fake(report({})), quiet, (l) => lines.push(l)), 1);
  assert.match(lines.join('\n'), /::error::shared: GHSA-fc5q-39xc-vjpf was not reported/);
});

test('picomatch re-rated critical fails again, so somebody looks', () => {
  const tree = today();
  tree.picomatch.via[0].severity = 'critical';
  assert.equal(main('app', fake(report(tree)), quiet, quiet), 1);
});

test('the script refuses to run without naming a known tree', () => {
  for (const bad of [undefined, '', 'functions', '../ci/firebase-tools']) {
    const lines = [];
    assert.equal(main(bad, fake(report(today())), quiet, (l) => lines.push(l)), 1, String(bad));
    assert.match(lines[0], /name the tree to check, one of shared, app/);
  }
});

test('the list is exactly the measured advisory, with its severity and its reason', () => {
  assert.deepEqual([...ALLOWED_VITE.keys()], ['GHSA-fc5q-39xc-vjpf']);
  for (const [id, { upTo, why }] of ALLOWED_VITE) {
    assert.equal(upTo, 'high', id);
    assert.ok(why.length > 60, `${id}: say why it cannot hurt and cannot be fixed`);
  }
});
