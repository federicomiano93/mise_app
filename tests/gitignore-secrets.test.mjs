// .gitignore keeps server-level credentials out of a PUBLIC repository (P1).
//
// ⚠️ WHY GIT ITSELF IS ASKED, NOT THE FILE READ AS TEXT. A line can be present and still not
// work — `.env` matches only the bare name, so `.env.local` was committable until 22 Oct 2026
// with the line in place. `git check-ignore` answers with git's own matching, negations
// included, for paths that do not have to exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --no-index: a tracked file of the same name must not hide a broken pattern.
const ignored = path =>
  spawnSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT }).status === 0;

test('every kind of credential file is ignored, at the root and in a subfolder', () => {
  for (const path of [
    '.env', '.env.local', '.env.production', 'functions/.env', 'functions/.env.local',
    '.secret.local', 'functions/.secret.local',
    'key.pem', 'server.key', 'cert.p12', 'cert.pfx', 'functions/private.pem',
    'bakery-app-ebf90-firebase-adminsdk-ab12c-0123456789.json',
    'functions/mise-app-preview-firebase-adminsdk-x.json',
    'service-account.json', 'serviceAccount.json', 'serviceAccountKey.json',
    'gha-creds-0123456789abcdef.json',
    'print-agent/print-agent.json', 'invoice-import/config.json',
  ]) {
    assert.ok(ignored(path), `${path} must be ignored`);
  }
});

test('the files the app and its examples need are NOT ignored', () => {
  for (const path of [
    '.env.example', 'js/firebase.js', 'js/firebase.example.js',
    'print-agent/print-agent.example.json', 'invoice-import/config.example.json',
    'package.json', 'functions/package.json', 'firebase.json', 'manifest.json',
  ]) {
    assert.ok(!ignored(path), `${path} must stay committable`);
  }
});
