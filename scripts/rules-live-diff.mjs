// rules-live-diff.mjs — reads the Firestore ruleset that is LIVE on Google and compares it
// with a rules file:
//
//   node scripts/rules-live-diff.mjs              → against this checkout's firestore.rules
//   node scripts/rules-live-diff.mjs origin/main  → against firestore.rules at that git ref
//
// A rules file that exists locally has no effect until it is deployed (P5), and "the deploy
// printed success" is not proof of what is live. This is the read-back the go-live sequence
// asks for. Exit code 1 when the two differ, so it can gate a step.
//
// ⚠️ Compare against `origin/main` BEFORE deploying from a branch: a deploy publishes the
// WHOLE file, so a branch missing a rules change that is already live would undo it.
// ⚠️ Without a ref it reads the WORKING TREE, uncommitted edits included — deploy and read
// back from a clean checkout.
//
// Read-only; needs `gcloud auth login` once. The token never leaves this process and is
// never printed. ⚠️ The `x-goog-user-project` header is required: without it the Rules API
// answers 403.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const PROJECT = 'bakery-app-ebf90';
const REPO = fileURLToPath(new URL('..', import.meta.url));
const ref = process.argv[2];

// Checked BEFORE any network call. No leading dash (git would read it as an option), no
// `..` range, and passed to git as ONE argument, never through a shell.
if (ref !== undefined && (!/^\w[\w./-]{0,99}$/.test(ref) || ref.includes('..'))) {
  throw new Error('That does not look like a git ref.');
}

function expectedRules() {
  if (ref === undefined) return readFileSync(join(REPO, 'firestore.rules'), 'utf8');
  return execFileSync('git', ['show', '--end-of-options', `${ref}:firestore.rules`], { cwd: REPO, encoding: 'utf8' });
}

function accessToken() {
  let out;
  try {
    // A fixed command string: on Windows gcloud is a .cmd, which only a shell can start.
    // stdout is captured and never reaches an error message.
    out = execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  } catch {
    throw new Error('gcloud could not print an access token — run `gcloud auth login`.');
  }
  // Refuse anything that is not a bare token, so an unexpected line can never end up quoted
  // inside an error message about a malformed header.
  if (!/^[\w.\-~+/]+=*$/.test(out)) throw new Error('gcloud did not return a bare access token — run `gcloud auth login`.');
  return out;
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Rules API ${res.status}: ${body.error?.message || 'no message'}`);
  return body;
}

const expected = expectedRules().replace(/\r\n/g, '\n');
const headers = { Authorization: `Bearer ${accessToken()}`, 'x-goog-user-project': PROJECT };
const api = 'https://firebaserules.googleapis.com/v1';
const release = await getJson(`${api}/projects/${PROJECT}/releases/cloud.firestore`, headers);
const ruleset = await getJson(`${api}/${release.rulesetName}`, headers);
const live = (ruleset.source?.files?.[0]?.content ?? '').replace(/\r\n/g, '\n');
const identical = live === expected;

console.log(JSON.stringify({
  liveRuleset: release.rulesetName.split('/').pop(),
  releasedAt: release.updateTime,
  comparedWith: ref ? `${ref}:firestore.rules` : 'firestore.rules (working tree)',
  identical,
  liveBytes: live.length, expectedBytes: expected.length,
}, null, 1));
if (!identical) process.exitCode = 1;
