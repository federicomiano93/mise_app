// rules-live-diff.mjs — reads the Firestore ruleset that is LIVE on Google and compares it
// with ./firestore.rules. Run from the repo root: `node scripts/rules-live-diff.mjs`.
//
// A rules file that exists locally has no effect until it is deployed (P5), and "the deploy
// printed success" is not proof of what is live. This is the read-back the go-live sequence
// asks for. Read-only; needs `gcloud auth login` once. The token never leaves this process
// and is never printed.
//
// ⚠️ The `x-goog-user-project` header is required: without it the Rules API answers 403.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const PROJECT = 'bakery-app-ebf90';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8', shell: true }).trim();
const headers = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT };
const api = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;
const release = await (await fetch(`${api}/releases/cloud.firestore`, { headers })).json();
if (!release.rulesetName) throw new Error('No release returned: ' + JSON.stringify(release).slice(0, 200));
const ruleset = await (await fetch(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, { headers })).json();
const live = ruleset.source.files[0].content.replace(/\r\n/g, '\n');
const local = readFileSync('firestore.rules', 'utf8').replace(/\r\n/g, '\n');
console.log(JSON.stringify({
  liveRuleset: release.rulesetName.split('/').pop(),
  releasedAt: release.updateTime,
  identicalToLocal: live === local,
  liveBytes: live.length, localBytes: local.length,
}, null, 1));
