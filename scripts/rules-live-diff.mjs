// rules-live-diff.mjs — reads the Firestore ruleset that is LIVE on Google and compares it
// with a rules file. Run from the repo root:
//
//   node scripts/rules-live-diff.mjs              → against ./firestore.rules (this checkout)
//   node scripts/rules-live-diff.mjs origin/main  → against firestore.rules at that git ref
//
// A rules file that exists locally has no effect until it is deployed (P5), and "the deploy
// printed success" is not proof of what is live. This is the read-back the go-live sequence
// asks for. Exit code 1 when the two differ, so it can gate a step.
//
// ⚠️ Compare against `origin/main` BEFORE deploying from a branch: `false` there means the
// live rules hold something main does not (or the other way round), and deploying the
// branch's whole file would silently undo it.
//
// Read-only; needs `gcloud auth login` once. The token never leaves this process and is
// never printed. ⚠️ The `x-goog-user-project` header is required: without it the Rules API
// answers 403.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROJECT = 'bakery-app-ebf90';
const ref = process.argv[2];

// A git ref is passed as ONE argument to git, never through a shell.
function rulesAt(gitRef) {
  if (!gitRef) return readFileSync('firestore.rules', 'utf8');
  if (!/^[\w./-]{1,100}$/.test(gitRef)) throw new Error('That does not look like a git ref.');
  return execFileSync('git', ['show', `${gitRef}:firestore.rules`], { encoding: 'utf8' });
}

function accessToken() {
  // A fixed command string: on Windows gcloud is a .cmd, which only a shell can start.
  const out = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
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

const headers = { Authorization: `Bearer ${accessToken()}`, 'x-goog-user-project': PROJECT };
const api = 'https://firebaserules.googleapis.com/v1';
const release = await getJson(`${api}/projects/${PROJECT}/releases/cloud.firestore`, headers);
const ruleset = await getJson(`${api}/${release.rulesetName}`, headers);

const normalise = text => text.replace(/\r\n/g, '\n');
const live = normalise(ruleset.source?.files?.[0]?.content ?? '');
const expected = normalise(rulesAt(ref));
const identical = live === expected;

console.log(JSON.stringify({
  liveRuleset: release.rulesetName.split('/').pop(),
  releasedAt: release.updateTime,
  comparedWith: ref ? `${ref}:firestore.rules` : './firestore.rules',
  identical,
  liveBytes: live.length, expectedBytes: expected.length,
}, null, 1));
if (!identical) process.exitCode = 1;
