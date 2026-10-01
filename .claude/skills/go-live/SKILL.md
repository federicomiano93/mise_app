---
name: go-live
description: The release sequence for Mise — from a green PR to a verified live app with its tag, GitHub Release and records. Use when a piece of work is finished and ready to publish, when Federico says to go live / merge / publish / «vai live» / «fai il merge», when preparing the «ready — when do you want it live?» question, or when rolling back a broken release.
---

# Going live — Mise

Merging to `main` = the app changes on every phone. It is **the only moment the work stops
for Federico**, and the question is about TIMING, not content: he picks the hour.

## 1. Before asking him (do all of it, silently)

- [ ] PR open from a feature branch; `gh pr checks <n>` → `test` and `rules` green.
- [ ] `code-reviewer` has reviewed the branch; its findings fixed or listed.
- [ ] `smoke-test` gates run; the changed screens driven on the emulator (`drive-app`).
- [ ] Precached files changed → `node scripts/sw-hashes.mjs` was run (its test is green).
- [ ] **`cd functions && npm audit --audit-level=high`** — `deploy-functions` runs on EVERY
      push to main and refuses on a high advisory, even when `functions/` did not change
      (twice on 30 Sep 2026). If it fails, fix the lockfile on its OWN branch first.
- [ ] `git fetch` → `node scripts/rules-live-diff.mjs origin/main` → `identical: true`
      (the live rules are main's). `false` → find out why before anything else: an allowed
      early deploy of add-only rules from another open PR (compare with that branch: `node
      scripts/rules-live-diff.mjs origin/<its-branch>`) means this release must include that
      PR's rules too; anything unexplained → stop and report.
- [ ] Rules changed on this branch? → it must contain the latest main (`git merge
      origin/main`, push, checks green again), `git diff origin/main -- firestore.rules`
      shows ONLY this PR's change, and decide whether they go FIRST (the app sends a key the
      live rules refuse) — see `firestore-rules`.
- [ ] Stacked PRs: every PR in the stack targets `main`; the top one carries the others —
      ONE merge of the top one, then check the lower ones show as merged.
- [ ] Draft the tag annotation (see 4) and check it for business data NOW.

- [ ] The PR's **preview link** works (the `preview` job comments it on the PR: a Firebase
      Hosting channel of `mise-app-preview`, fake data, the «Preview · test data» ribbon) — open
      it once at phone width, signed in with a `*@club.test` account.

Then ask, in Italian and plain words: *«È pronto. Contiene: … (what he will SEE, not
files). Puoi provarlo prima sul telefono qui: <preview link> (dati di prova). Quando lo vuoi
live?»* and tell him to **expect two clicks** if rules change (the harness asks for
`firebase deploy` and for the merge) — one otherwise.

## 2. At his word — no further questions

1. **Rules first** (if needed): `firebase deploy --only firestore:rules` from the up-to-date
   branch. Two warnings are normal (`member()`, `orderClientOf()`); a third → stop and read
   it. Then `node scripts/rules-live-diff.mjs` → `identical: true`.
2. **Merge**: `gh pr merge <n> --merge` (merge commits, never squash — the history reads
   PR by PR). ⚠️ Never `git push origin main`; main takes nothing without the PR.
3. **Watch main**: `gh run list --branch main --limit 3` → the push run's `test`, `rules`
   and `deploy-functions` all `success` (`gh run watch <id>`). ⚠️ On 13 Sep a push fired
   no run for 30+ minutes: if nothing appears in ~5 min, say so; Pages can be kicked by
   hand: `gh api -X POST repos/federicomiano93/mise_app/pages/builds`.
4. **Verify live** (P6), on an updated local main (`git switch main && git pull`):
   - `curl -s -o /dev/null -w "%{http_code}" https://federicomiano93.github.io/mise_app/`
     and `…/js/firebase.js` → both `200`.
   - `node scripts/verify-live-assets.mjs` → `sameRelease: true`, `problems: []`
     (right after the merge Pages may still serve the old sw.js: wait and re-run).
   - `node scripts/rules-live-diff.mjs origin/main` → `identical: true` (live rules = main).
   - `deploy-functions` success confirmed (step 3) — on EVERY release.
   - **Open the live app** in a real phone-sized browser (`drive-app` has the window and
     the console reader): the sign-in screen draws, no console errors, no 404. Signing in on production is NOT scripted (no test account exists there): the
     signed-in check is Federico's — step 6 asks him for it explicitly.
   - If the whole site 404s: Settings → Pages (a secret-scanning alert can disable it).

## 3. If it is broken — roll back, do not patch forward

- `main` is protected, so a rollback is a PR too: `git switch -c fix/revert-vX.Y.Z` →
  `git revert -m 1 <merge-sha>` → push → PR → checks → merge. Never `reset --hard`, never
  force-push. Tell Federico in one line what broke and that the previous version is back.
- ⚠️⚠️ **If the release changed `firestore.rules`, the revert must KEEP the live rules
  file:** after `git revert`, run `git checkout <merge-sha> -- firestore.rules` and commit it
  on the revert branch. Otherwise main goes back to the OLD rules while the new ones stay
  live — every later pre-check reads «live ≠ main», and the next rules deploy from main
  would publish the old whitelist (the retired-field trap below).
- ⚠️ **Never deploy an older rules file** — phones have already saved the new keys into
  real documents, and an older whitelist refuses every later save of them for ever. A
  broken rule is fixed by a NEW rules change that still lists those keys (`firestore-rules`).
- ⚠️ **A rollback is not always free for the data.** New optional keys do not bother an old
  app — but if the release RAISED a model number (products' `model`, which the rules refuse
  to lower) or made a key REQUIRED on a whole-document write, every document saved since
  refuses the old app's saves. Then do NOT roll back: patch forward with a fix PR.

## 4. Tag and Release

- Version: patch = fix · minor = feature · major = breaking. A release that changes only
  `functions/package-lock.json` is a patch with the cache unchanged.
- Annotation: subject line = what changed for the people using it; a short paragraph;
  `PR #n, cache vNNN`. ⚠️ **The repo is PUBLIC and a tag cannot be edited later** (the
  `v1.9.0` tag still carries four real supplier names): no supplier, customer or staff
  names, no prices, no emails, no venue ids.
- `git tag -a vX.Y.Z -F <annotation-file>` on the MERGE commit → `git push origin vX.Y.Z`
  → `gh release create vX.Y.Z --title "<subject>" --notes-file <annotation-file> --verify-tag --latest`.
  Annotation files go in the session scratchpad.

## 5. Records (local notes — copy each to `..\backup-note\` before editing)

- `STORICO-DEPLOY.md`: a new entry at the TOP of the release list — tag, date, PR(s), merge
  sha, cache, what changed, rules deployed first + ruleset id, live assets N/N matching,
  functions deployed, anything learnt.
- `CLAUDE.md`: the «Live on `main`» line (cache + tag) only.
- **The «Controlli di Mise» page** (URL in CLAUDE.md, «Open backlog»; shape in memory
  `pagina-controlli`): add this release's items with ONE `ArtifactData batch` — a group
  `release: "vX.Y.Z · <area>"`, `rank` = the version as a number (v1.98.0 → 9800), and per item
  one of: `prova` (what to open and try, with `device`), `scelta` (a call I took for him),
  `decidi` (a decision still his), `prima` (a warning to give BEFORE use). Every item also gets
  a `card` — the app card it belongs to, which the page filters by: `Ordini`, `Fornitori e
  ingredienti`, `Ricettario`, `Calcolatore`, `Paste`, `Food cost`, `Magazzino`, `Etichette`,
  `Tutta l'app` or `Account e sicurezza`. Italian, plain, one action per item,
  `status: "todo"`, `note: ""`. Never delete an item he has not answered.
- Delete the merged branch locally (`git branch -d`) and on GitHub if still there; GitHub
  should hold only `main` (`git fetch --prune`).

## 6. Tell him (Italian, plain)

- It is live; the page «Controlli di Mise» has what to try, in order of importance — and ask
  him to do ONE real save on the changed screen and tell you if anything says it could not
  save (the only signed-in check on production).
- ⚠️ Every phone must update (the update banner / reopen the app) — and when a change alters
  what is saved, nobody should use the new feature until their phone has updated.
- The decisions taken for him during the work, FIRST in the list (global P10).
