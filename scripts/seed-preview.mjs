// seed-preview.mjs — puts the emulator's fake demo world into the PREVIEW Firebase project, so a
// pull request's preview link (.github/workflows/preview.yml) opens on something to try.
// Run from anywhere: `node scripts/seed-preview.mjs`. Re-runnable: documents are overwritten,
// existing accounts are found and their password reset to the one printed at the end.
//
// ⚠️⚠️ IT CAN REACH ONE PROJECT ONLY, AND IT IS NOT PRODUCTION. The project id is a constant
// below, not an argument or an environment variable, so no typo and no inherited variable can
// point it at bakery-app-ebf90. The data is tests/rules/seed-emulator.mjs's — fake venues,
// fake suppliers, `*@club.test` accounts.
//
// ⚠️ THE PASSWORD IS NOT THE EMULATOR'S. The emulator's `club1234` is in this public repo, and
// the preview is on a public address; so the preview accounts get their own password — the
// PREVIEW_PASSWORD environment variable if set, otherwise a fresh random one — printed once
// at the end, and never written into the repo.
//
// Needs `gcloud auth login` (an account that owns the preview project) and Email/Password
// sign-in switched on in that project (Firebase console → Authentication), which the
// command line cannot do on the free plan.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { useBackend, seedDemoWorld } from '../tests/rules/seed-emulator.mjs';

const PROJECT = 'mise-app-preview';
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const ACCOUNTS = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;

function accessToken() {
  try {
    // A fixed command string: on Windows gcloud is a .cmd, which only a shell can start.
    const out = execSync('gcloud auth print-access-token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
    if (/^[\w.\-~+/]+=*$/.test(out)) return out;
  } catch { /* reported below */ }
  throw new Error('gcloud could not print an access token — run `gcloud auth login`.');
}

const token = accessToken();
const headers = async () => ({
  Authorization: `Bearer ${token}`,
  'x-goog-user-project': PROJECT,
  'Content-Type': 'application/json',
});
const password = process.env.PREVIEW_PASSWORD || randomBytes(9).toString('base64url');

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: await headers(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

// Create the account, or find the existing one and give it this run's password.
async function previewAccount(email) {
  const created = await post(ACCOUNTS, { email, password, emailVerified: true });
  if (created.ok && created.json.localId) return created.json.localId;
  const message = created.json.error?.message || '';
  if (/CONFIGURATION_NOT_FOUND|OPERATION_NOT_ALLOWED/.test(message)) {
    throw new Error('Email/Password sign-in is not switched on in the preview project yet '
      + '(Firebase console → mise-app-preview → Authentication → Get started → Email/Password).');
  }
  if (!/EMAIL_EXISTS|DUPLICATE_EMAIL/.test(message)) {
    throw new Error(`Could not create ${email}: ${message || 'no message'}`);
  }
  const found = await post(`${ACCOUNTS}:lookup`, { email: [email] });
  const uid = found.json.users?.[0]?.localId;
  if (!uid) throw new Error(`Could not find the existing account ${email}.`);
  const updated = await post(`${ACCOUNTS}:update`, { localId: uid, password });
  if (!updated.ok) throw new Error(`Could not reset the password of ${email}.`);
  return uid;
}

useBackend({
  docUrl: (path) => `${FIRESTORE}/${path}`,
  headers,
  account: (email) => previewAccount(email),
});

await seedDemoWorld();

console.log(`Seeded the PREVIEW project (${PROJECT}) with the fake demo world.
Sign in on a preview link with any of the *@club.test accounts listed in
tests/rules/seed-emulator.mjs — for example owner@club.test (every venue) or
staff@club.test (an employee) — and this password: ${password}`);
