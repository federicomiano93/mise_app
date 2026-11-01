// The vulnerability gate on CI's own firebase-tools (scripts/audit-ci-firebase-tools.mjs).
//
// ⚠️ ITS FIRST VERSION WAS `npm audit --audit-level=critical`, and the review caught it blind to
// the one thing it was for: the September 2025 hijacks of debug and color-convert are published as
// HIGH with CWE-506 «embedded malicious code», not critical. These reports have the shape `npm audit
// --json` printed on 11 Oct 2026; the debug@4.4.2 advisory is the real one (npm has since
// unpublished that version, so it can no longer be locked to fetch a live report).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judge, main, ALLOWED } from '../scripts/audit-ci-firebase-tools.mjs';

const advisory = (id, severity, cwe, title = 'an advisory') =>
  ({ source: 1, name: 'pkg', dependency: 'pkg', title, url: `https://github.com/advisories/${id}`, severity, cwe, range: '*' });
const report = (vulnerabilities) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: { vulnerabilities: {}, dependencies: { prod: 1, dev: 673, optional: 30, peer: 0, peerOptional: 0, total: 673 } },
});

// Today's tree, in short: the accepted high, the chain that carries it, a moderate.
const today = () => ({
  'basic-ftp': { severity: 'high', via: [advisory('GHSA-c475-qrg2-pj4r', 'high', ['CWE-1333'])] },
  'get-uri': { severity: 'high', via: ['basic-ftp'] },
  uuid: { severity: 'moderate', via: [advisory('GHSA-w5hq-g745-h8pq', 'moderate', ['CWE-787'])] },
});

test('today\'s tree passes, and says which high it accepted', () => {
  const v = judge(report(today()));
  assert.equal(v.ok, true, v.problems.join('\n'));
  assert.deepEqual(v.accepted.sort(), ['GHSA-c475-qrg2-pj4r']);
});

test('a hijacked package fails even though it is only HIGH (debug@4.4.2, September 2025)', () => {
  const v = judge(report({ ...today(), debug: { severity: 'high', via: [
    advisory('GHSA-4x49-vf9v-38px', 'high', ['CWE-506'], 'debug@4.4.2 contains malware after npm account takeover')] } }));
  assert.equal(v.ok, false);
  assert.match(v.problems.join('\n'), /MALICIOUS CODE — GHSA-4x49-vf9v-38px/);
});

test('malicious code fails at ANY severity, and the allowlist never excuses it', () => {
  for (const severity of ['low', 'moderate', 'high', 'critical']) {
    const v = judge(report({ ...today(), x: { severity, via: [advisory('GHSA-aaaa-bbbb-cccc', severity, ['CWE-506'])] } }));
    assert.deepEqual(v.problems, [`MALICIOUS CODE — GHSA-aaaa-bbbb-cccc ${severity} x: an advisory`], severity);
  }
  const tree = today();
  tree['basic-ftp'].via[0].cwe = ['CWE-1333', 'CWE-506'];
  assert.match(judge(report(tree)).problems.join('\n'), /MALICIOUS CODE — GHSA-c475-qrg2-pj4r/);
});

test('a NEW high or critical fails until somebody looks at it; a plain moderate does not', () => {
  assert.equal(judge(report({ ...today(), y: { severity: 'high', via: [advisory('GHSA-2222-3333-4444', 'high', ['CWE-400'])] } })).ok, false);
  assert.equal(judge(report({ ...today(), y: { severity: 'critical', via: [advisory('GHSA-2222-3333-4444', 'critical', [])] } })).ok, false);
  assert.equal(judge(report({ ...today(), y: { severity: 'moderate', via: [advisory('GHSA-2222-3333-4444', 'moderate', ['CWE-400'])] } })).ok, true);
});

// An advisory with no GHSA link is judged by its npm id, which no allowlist entry can match.
test('a high with no GHSA link cannot slip through the allowlist', () => {
  const v = judge(report({ ...today(), z: { severity: 'high', via: [{ source: 99, name: 'z', title: 't', url: '', severity: 'high', cwe: [] }] } }));
  assert.deepEqual(v.problems, ['99 high z: t']);
});

// The review proved it: offline mode, or dev packages omitted (firebase-tools is a devDependency),
// gives a well-formed report with NOTHING in it — which, unchecked, reads as «clean».
test('an audit that saw nothing fails: the accepted advisory must be reported every run', () => {
  const blind = judge(report({}));
  assert.equal(blind.ok, false);
  assert.equal(blind.problems.filter((p) => /was not reported: the audit checked nothing/.test(p)).length, 1);
  const tree = today();
  delete tree['basic-ftp'];
  assert.deepEqual(judge(report(tree)).problems,
    ['GHSA-c475-qrg2-pj4r was not reported: the audit checked nothing, or this ALLOWED entry is stale — remove it']);
  // Seen at a lower severity after a re-rating, it still proves the audit looked.
  const rerated = today();
  rerated['basic-ftp'].via[0].severity = 'moderate';
  assert.equal(judge(report(rerated)).ok, true);
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
    // npm said it failed, even if the rest looks complete.
    { ...report(today()), error: { code: 'EAUDITBULK', summary: 'audit endpoint returned an error' } },
  ]) {
    assert.equal(judge(bad).ok, false, JSON.stringify(bad));
  }
});

// The part that runs npm and sets the exit code, driven with a fake npm.
test('the script exits 1 on a problem, 0 on today\'s tree, and says why npm failed', () => {
  const lines = [];
  const say = (line) => lines.push(line);
  const fake = (body, stderr = '') => () => ({ stdout: typeof body === 'string' ? body : JSON.stringify(body), stderr });
  assert.equal(main(fake(report(today())), say, say), 0);
  assert.equal(main(fake(report({ ...today(), d: { severity: 'high', via: [advisory('GHSA-4x49-vf9v-38px', 'high', ['CWE-506'])] } })), say, say), 1);
  assert.equal(main(fake(report({})), say, say), 1);
  assert.equal(main(fake(''), say, say), 1);
  lines.length = 0;
  assert.equal(main(fake({ error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } }, 'npm error audit ENOLOCK'), say, say), 1);
  assert.ok(lines.includes('npm: This command requires an existing lockfile.'), lines.join('\n'));
  assert.ok(lines.includes('npm error audit ENOLOCK'));
  // Run as a script, the code main() returns is the process's — nothing else ends it.
  const source = readFileSync(new URL('../scripts/audit-ci-firebase-tools.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(source, /\nif \(process\.argv\[1\] && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href\) process\.exitCode = main\(\);\n$/);
  assert.doesNotMatch(source, /process\.exit\(/);
  // The flags that keep offline mode and an omitted dev tree from blinding it.
  assert.match(source, /'npm audit --json --include=dev --offline=false'/);
});

test('the allowlist is exactly the measured advisory, with its reason', () => {
  assert.deepEqual([...ALLOWED.keys()].sort(), ['GHSA-c475-qrg2-pj4r']);
  for (const [id, why] of ALLOWED) assert.ok(why.length > 60, `${id}: say why it cannot hurt CI and cannot be fixed`);
});
