// build-version.ts — the release stamp that every error report, device line and usage line from
// Mise 2 carries as `appVersion`.
//
// Run by vite.config.ts when the config loads (a build, the dev server, Vitest), never shipped.
//
// ⚠️ AT MOST 12 CHARACTERS. firestore.rules refuses an appVersion longer than that on all three
// telemetry lines, and a line the rules refuse for good is never delivered. «m2-» plus seven
// hex digits is 10; the fallback is 6.
// ⚠️ NEVER THROWS. A checkout without git (a zip, a CI step that copied only app/) still builds;
// it is stamped «m2-dev» instead of failing the build.

import { execFileSync } from 'node:child_process';

export const DEV_VERSION = 'm2-dev';
const SHA_LENGTH = 7;

function gitShortSha(): string {
  return execFileSync('git', ['rev-parse', `--short=${SHA_LENGTH}`, 'HEAD'], {
    encoding: 'utf8',
    // git's own complaint («not a git repository») is not a build warning worth printing.
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  });
}

// `readSha` exists so the fallbacks can be tested without breaking git.
export function miseVersion(readSha: () => string = gitShortSha): string {
  try {
    // `--short=7` is a minimum: git lengthens the id when seven digits would be ambiguous. Cut
    // it back, so the stamp is always the same length.
    const sha = readSha().trim().slice(0, SHA_LENGTH);
    return /^[0-9a-f]{7}$/.test(sha) ? `m2-${sha}` : DEV_VERSION;
  } catch {
    return DEV_VERSION;
  }
}
