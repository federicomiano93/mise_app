// audit-ci-firebase-tools.mjs — the vulnerability gate on CI's own firebase-tools
// (ci/firebase-tools/package-lock.json), run by the `test` job: `node scripts/audit-ci-firebase-tools.mjs`.
// Exit code 1 on any problem; deploy-functions needs `test`, so a problem here stops the deploy.
//
// ⚠️ WHY NOT PLAIN `npm audit --audit-level=…`. Neither level works for this tree:
// - `high` is red for ever: firebase-tools' own tree carries two HIGH advisories that no
//   firebase-tools release fixes (ALLOWED below; measured 11 Oct 2026 up to 15.33.0, whatever
//   `npm audit` says about "fix available via firebase-tools@15.33.0" — that release has the same
//   dependency ranges).
// - `critical` misses the very thing this lockfile is for. A HIJACKED package is not published
//   as critical: debug@4.4.2 and color-convert@3.1.1 (the September 2025 account takeover —
//   GHSA-4x49-vf9v-38px, GHSA-pxx3-g568-hxr4) are HIGH, CWE-506 «embedded malicious code», and
//   this tree carries both families one patch later.
// So: ANY advisory marked CWE-506 fails, whatever its severity; any HIGH or CRITICAL fails unless
// it is one of the two named below. A new high therefore turns CI red until somebody looks at it.
//
// It only knows what has been REPORTED. The lockfile itself is the protection; this catches a
// locked version that is reported as bad after it was locked. Dependabot reports every level.
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Each entry: the advisory, why it cannot hurt CI, and why it cannot be fixed. Re-measure on every
// firebase-tools raise; remove an entry the moment its advisory is gone from the tree.
export const ALLOWED = new Map([
  ['GHSA-c475-qrg2-pj4r', 'basic-ftp: slow parsing of a hostile FTP directory listing. Reached only through ' +
    'proxy-agent → pac-proxy-agent → get-uri, i.e. an ftp:// proxy setting CI does not have; get-uri ' +
    '(even 8.0.1) requires basic-ftp ^5, the fix is 6.2.1.'],
  ['GHSA-vfj7-8cjw-p6xm', 'braces: stack exhaustion on deeply nested brace patterns, via chokidar 3 (file ' +
    'watching). CI writes the patterns itself; no fixed braces release exists.'],
]);

const MALICIOUS = 'CWE-506';
const BLOCKING = new Set(['high', 'critical']);
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
      else if (BLOCKING.has(via.severity) && !ALLOWED.has(id)) problems.add(label);
      else if (BLOCKING.has(via.severity)) accepted.add(id);
    }
  }
  return { ok: problems.size === 0, problems: [...problems], accepted: [...accepted] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = fileURLToPath(new URL('../ci/firebase-tools/', import.meta.url));
  // `npm audit` exits 1 whenever it finds anything, so its exit code says nothing here: the
  // verdict is judge()'s. One fixed command string through a shell: npm is a .cmd on Windows.
  const run = spawnSync('npm audit --json', { cwd: dir, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(run.stdout); } catch { report = null; }
  const { ok, problems, accepted } = judge(report);
  for (const id of accepted) console.log(`accepted (scripts/audit-ci-firebase-tools.mjs ALLOWED): ${id}`);
  if (ok) {
    console.log('ci/firebase-tools: no malicious-code advisory, no high or critical beyond the accepted ones.');
  } else {
    for (const p of problems) console.error(`::error::ci/firebase-tools: ${p}`);
    if (!report) console.error(run.stderr);
    process.exit(1);
  }
}
