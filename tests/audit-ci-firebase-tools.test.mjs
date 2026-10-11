// The vulnerability gate on CI's own firebase-tools (scripts/audit-ci-firebase-tools.mjs).
//
// ⚠️ ITS FIRST VERSION WAS `npm audit --audit-level=critical`, and the review caught it blind to
// the one thing it was for: the September 2025 hijacks of debug and color-convert are published as
// HIGH with CWE-506 «embedded malicious code», not critical. These reports have the shape `npm audit
// --json` printed on 11 Oct 2026; the debug@4.4.2 advisory is the real one (npm has since
// unpublished that version, so it can no longer be locked to fetch a live report).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, ALLOWED } from '../scripts/audit-ci-firebase-tools.mjs';

const advisory = (id, severity, cwe, title = 'an advisory') =>
  ({ source: 1, name: 'pkg', dependency: 'pkg', title, url: `https://github.com/advisories/${id}`, severity, cwe, range: '*' });
const report = (vulnerabilities) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: { vulnerabilities: {}, dependencies: { prod: 1, dev: 673, optional: 30, peer: 0, peerOptional: 0, total: 673 } },
});

// Today's tree, in short: the two accepted highs, the chains that carry them, a moderate.
const today = () => ({
  'basic-ftp': { severity: 'high', via: [advisory('GHSA-c475-qrg2-pj4r', 'high', ['CWE-1333'])] },
  'get-uri': { severity: 'high', via: ['basic-ftp'] },
  braces: { severity: 'high', via: [advisory('GHSA-vfj7-8cjw-p6xm', 'high', ['CWE-674'])] },
  chokidar: { severity: 'high', via: ['braces'] },
  uuid: { severity: 'moderate', via: [advisory('GHSA-w5hq-g745-h8pq', 'moderate', ['CWE-787'])] },
});

test('today\'s tree passes, and says which highs it accepted', () => {
  const v = judge(report(today()));
  assert.equal(v.ok, true, v.problems.join('\n'));
  assert.deepEqual(v.accepted.sort(), ['GHSA-c475-qrg2-pj4r', 'GHSA-vfj7-8cjw-p6xm']);
});

test('a hijacked package fails even though it is only HIGH (debug@4.4.2, September 2025)', () => {
  const v = judge(report({ ...today(), debug: { severity: 'high', via: [
    advisory('GHSA-4x49-vf9v-38px', 'high', ['CWE-506'], 'debug@4.4.2 contains malware after npm account takeover')] } }));
  assert.equal(v.ok, false);
  assert.match(v.problems.join('\n'), /MALICIOUS CODE — GHSA-4x49-vf9v-38px/);
});

test('malicious code fails at ANY severity, and the allowlist never excuses it', () => {
  for (const severity of ['low', 'moderate', 'high', 'critical']) {
    assert.equal(judge(report({ x: { severity, via: [advisory('GHSA-aaaa-bbbb-cccc', severity, ['CWE-506'])] } })).ok, false, severity);
  }
  assert.equal(judge(report({ x: { severity: 'high', via: [advisory('GHSA-vfj7-8cjw-p6xm', 'high', ['CWE-674', 'CWE-506'])] } })).ok, false);
});

test('a NEW high or critical fails until somebody looks at it; a plain moderate does not', () => {
  assert.equal(judge(report({ ...today(), y: { severity: 'high', via: [advisory('GHSA-2222-3333-4444', 'high', ['CWE-400'])] } })).ok, false);
  assert.equal(judge(report({ ...today(), y: { severity: 'critical', via: [advisory('GHSA-2222-3333-4444', 'critical', [])] } })).ok, false);
  assert.equal(judge(report({ ...today(), y: { severity: 'moderate', via: [advisory('GHSA-2222-3333-4444', 'moderate', ['CWE-400'])] } })).ok, true);
});

// An advisory with no GHSA link is judged by its npm id, which no allowlist entry can match.
test('a high with no GHSA link cannot slip through the allowlist', () => {
  const v = judge(report({ z: { severity: 'high', via: [{ source: 99, name: 'z', title: 't', url: '', severity: 'high', cwe: [] }] } }));
  assert.equal(v.ok, false);
});

test('an npm or registry failure is a failure, never «nothing found»', () => {
  for (const bad of [
    null,
    'not json',
    { error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } },
    { error: { code: 'ENOTFOUND' }, auditReportVersion: 2, vulnerabilities: {}, metadata: { dependencies: { total: 673 } } },
    { auditReportVersion: 1, advisories: {} },
    { auditReportVersion: 2, metadata: { dependencies: { total: 673 } } },
    { auditReportVersion: 2, vulnerabilities: {}, metadata: { dependencies: { total: 0 } } },
    { auditReportVersion: 2, vulnerabilities: {} },
  ]) {
    assert.equal(judge(bad).ok, false, JSON.stringify(bad));
  }
});

test('the allowlist is exactly the two measured advisories, each with its reason', () => {
  assert.deepEqual([...ALLOWED.keys()].sort(), ['GHSA-c475-qrg2-pj4r', 'GHSA-vfj7-8cjw-p6xm']);
  for (const [id, why] of ALLOWED) assert.ok(why.length > 60, `${id}: say why it cannot hurt CI and cannot be fixed`);
});
