# CI's firebase-tools, locked

The copy of firebase-tools that GitHub Actions runs — the `rules` job (the emulator),
`deploy-functions` (the LIVE project) and the preview job — installed with
`npm ci --ignore-scripts` from `package-lock.json` here, before any Google sign-in.

**Why a lockfile:** firebase-tools ships no `npm-shrinkwrap.json`, so a global
`npm install firebase-tools@x` resolved its ~670 packages afresh on every run. A hijacked new
version of any of them would have run during `firebase deploy` with the production credential.
Here every version and its integrity hash are fixed; a new one arrives only through a reviewed PR.

Nothing in this folder reaches a phone: the preview stages `_site/` from an allowlist that does not
name `ci/`, and its leak check proves `ci/firebase-tools/package.json` is not served.

## Raising the version

Deliberately, never as a side effect. In this folder:

```
npm install --save-dev --package-lock-only --before=<a date at least 7 days ago> firebase-tools@<new>
```

`--before` is a cooldown: a version hijacked in the last few days is usually caught before it gets
in. Then, in the same PR: the emulator cache key in `.github/workflows/test.yml`
(`firebase-emulators-<version>`, pinned by `tests/ci-install-before-sign-in.test.mjs`), and the rules
suite run locally with the new binary:

```
ci/firebase-tools/node_modules/.bin/firebase emulators:exec --only auth,firestore --project demo-theitalianclub "npm run test:rules"
```

(from the repo root, after `npm ci --ignore-scripts` in this folder; `node_modules/` is gitignored). The `test` job audits this lockfile at
`--audit-level=critical` — why not `high` is written beside that step.
