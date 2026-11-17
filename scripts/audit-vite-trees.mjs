// audit-vite-trees.mjs — the vulnerability gate on Mise 2's two npm trees, run by the `mise2` job:
// `node scripts/audit-vite-trees.mjs shared` and `node scripts/audit-vite-trees.mjs app`. Exit code 1
// on any problem.
//
// ⚠️ WHY NOT PLAIN `npm audit --audit-level=high` ANY MORE (17 Nov 2026). picomatch's advisory
// GHSA-fc5q-39xc-vjpf was raised that day to cover EVERY version, with no fix published, and both
// trees carry picomatch through vite and vitest. Plain `npm audit` has no way to accept one advisory,
// so every PR and every push to main turned red with nothing anyone could change. This uses the same
// judge as CI's firebase-tools gate (scripts/audit-ci-firebase-tools.mjs, which says why each rule is
// there): malicious code fails at any severity, any OTHER high or critical fails, an accepted advisory
// re-rated higher fails, and an accepted advisory that stops being reported fails too — so the entry
// below cannot outlive the fix, and an audit that looked at nothing cannot read as clean.
import { pathToFileURL } from 'node:url';
import { main as auditMain, runNpmAudit } from './audit-ci-firebase-tools.mjs';

export const TREES = ['shared', 'app'];

// Both trees take picomatch from the same vite/vitest versions, so one list serves both. Remove the
// entry when the lockfiles move to a fixed picomatch (the gate fails until then: «stale — remove it»).
// ⚠️ With the list empty, only `dependencies.total > 0` proves the audit looked: then name a moderate
// still in the trees (as the firebase-tools list does with uuid), or say plainly that it is gone.
export const ALLOWED_VITE = new Map([
  ['GHSA-fc5q-39xc-vjpf', { upTo: 'high', why: 'picomatch <= 4.0.7: ReDoS when a glob PATTERN repeats a single-branch ' +
    'extglob. vite and vitest only build patterns from their own code and our config files (file globs, never text from ' +
    'a person or the network), and picomatch runs only in the build and the tests on Node, never in the app on a phone. No patched ' +
    'version exists (advisory raised to cover every version on 17 Nov 2026).' }],
]);

// Returns the exit code, so the tests can drive it with a fake npm.
export function main(tree, run = () => runNpmAudit(tree), out = console.log, err = console.error) {
  if (!TREES.includes(tree)) {
    err(`::error::audit-vite-trees: name the tree to check, one of ${TREES.join(', ')} (got ${JSON.stringify(tree)})`);
    return 1;
  }
  return auditMain(run, out, err, { tree, allowed: ALLOWED_VITE, listedIn: 'scripts/audit-vite-trees.mjs ALLOWED_VITE' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv[2]);
