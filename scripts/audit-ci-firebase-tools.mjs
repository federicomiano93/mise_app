// audit-ci-firebase-tools.mjs — the vulnerability gate on CI's own firebase-tools
// (ci/firebase-tools/package-lock.json): `node scripts/audit-ci-firebase-tools.mjs`. Run by the
// `test` job (deploy-functions needs it, so a problem here stops the deploy) and by preview.yml's
// deploy job before its install (that workflow does not wait for `test`). Exit code 1 on any problem.
//
// ⚠️ WHY NOT PLAIN `npm audit --audit-level=…`. Neither level works for this tree:
// - `high` proves nothing on a clean tree: an audit that looked at nothing also reports no high
//   (see below). And firebase-tools' own tree has carried a HIGH no release fixed before
//   (basic-ftp, until 15.34.2), so an accepted one may be needed again.
// - `critical` misses the very thing this lockfile is for. A HIJACKED package is not published
//   as critical: debug@4.4.2 and color-convert@3.1.1 (the September 2025 account takeover —
//   GHSA-4x49-vf9v-38px, GHSA-pxx3-g568-hxr4) are HIGH, CWE-506 «embedded malicious code», and
//   this tree carries both packages, at later versions.
// So: ANY advisory marked CWE-506 fails, whatever its severity; any HIGH or CRITICAL fails unless
// it is the one named below. A new high therefore turns CI red until somebody looks at it.
//
// ⚠️ AND THE ACCEPTED ADVISORY MUST BE SEEN, EVERY RUN. An audit that checked nothing
// (offline mode, dev packages omitted — firebase-tools is a devDependency — or an empty answer
// from the registry) still prints a well-formed report with zero findings: it would read «clean».
// The known finding is the proof the audit looked; when it disappears, its entry is stale
// and must go. `--include=dev --offline=false` override the settings that would blind it.
//
// It only knows what has been REPORTED. The lockfile itself is the protection; this catches a
// locked version that is reported as bad after it was locked. Dependabot reports every level.
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Each entry: the advisory, the severity it was measured at (reported any higher, it fails again:
// somebody must look), why it cannot hurt CI, and why it cannot be fixed. (braces GHSA-vfj7-8cjw-p6xm was
// removed on 23 Oct 2026, basic-ftp GHSA-c475-qrg2-pj4r on 2 Nov 2026 with firebase-tools 15.34.2: npm no
// longer reports them for this tree.) Re-measure on every firebase-tools raise; an entry whose advisory
// is gone from the tree fails the gate until removed. ⚠️ The list may not simply go empty, or nothing
// proves the audit looked: with no high left, a moderate still in the tree does that job.
export const ALLOWED = new Map([
  ['GHSA-w5hq-g745-h8pq', { upTo: 'moderate', why: 'uuid: missing bounds check when a caller passes its own buffer ' +
    'to v3/v5/v6. The tree\'s gaxios calls only v4() with no buffer, so CI never reaches it; Google\'s libraries ' +
    'decide when it goes. Named here as the finding that proves the audit looked (measured on firebase-tools ' +
    '15.34.2: no high or critical in the tree).' }],
]);

const MALICIOUS = 'CWE-506';
const BLOCKING = new Set(['high', 'critical']);
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const ghsaOf = (url) => (String(url ?? '').match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/) || [])[0];

// Pure, so the tests can feed it reports: { ok, problems: [..], accepted: [..] }.
export function judge(report) {
  // An npm or registry failure must never read as «nothing found».
  if (!report || typeof report !== 'object' || report.error || report.auditReportVersion !== 2 ||
      !report.vulnerabilities || typeof report.vulnerabilities !== 'object' ||
      !(report.metadata?.dependencies?.total > 0)) {
    return { ok: false, problems: ['not a complete npm audit report (npm or the registry failed?)'], accepted: [] };
  }
  const problems = new Set();
  const accepted = new Set();
  for (const [name, vuln] of Object.entries(report.vulnerabilities)) {
    for (const via of vuln?.via ?? []) {
      if (typeof via !== 'object' || via === null) continue; // a package name: the chain, not an advisory
      const id = ghsaOf(via.url) ?? String(via.source ?? via.url ?? 'unknown advisory');
      const label = `${id} ${via.severity} ${name}: ${via.title}`;
      if ((via.cwe ?? []).includes(MALICIOUS)) problems.add(`MALICIOUS CODE — ${label}`);
      else if (ALLOWED.has(id)) {
        accepted.add(id);
        const { upTo } = ALLOWED.get(id);
        if (SEVERITIES.indexOf(via.severity) > SEVERITIES.indexOf(upTo)) problems.add(`${label} — accepted only up to ${upTo}: look at it again`);
      } else if (BLOCKING.has(via.severity)) problems.add(label);
    }
  }
  for (const id of ALLOWED.keys()) {
    if (!accepted.has(id)) problems.add(`${id} was not reported: the audit checked nothing, or this ALLOWED entry is stale — remove it`);
  }
  return { ok: problems.size === 0, problems: [...problems], accepted: [...accepted] };
}

export function runNpmAudit() {
  const dir = fileURLToPath(new URL('../ci/firebase-tools/', import.meta.url));
  // `npm audit` exits 1 whenever it finds anything, so its exit code says nothing here: the
  // verdict is judge()'s. One fixed command string through a shell: npm is a .cmd on Windows.
  return spawnSync('npm audit --json --include=dev --offline=false',
    { cwd: dir, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
}

// Returns the exit code, so the tests can drive it with a fake npm.
export function main(run = runNpmAudit, out = console.log, err = console.error) {
  const result = run();
  let report;
  try { report = JSON.parse(result.stdout); } catch { report = null; }
  const { ok, problems, accepted } = judge(report);
  for (const id of accepted) out(`accepted (scripts/audit-ci-firebase-tools.mjs ALLOWED): ${id}`);
  if (ok) {
    out('ci/firebase-tools: no malicious-code advisory, no high or critical beyond the accepted ones.');
    return 0;
  }
  for (const p of problems) err(`::error::ci/firebase-tools: ${p}`);
  // Say WHY when npm itself failed: its error comes back as JSON, not as a crash.
  const cause = report?.error?.summary ?? report?.message;
  if (cause) err(`npm: ${cause}`);
  if (result.stderr) err(String(result.stderr).trim());
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
