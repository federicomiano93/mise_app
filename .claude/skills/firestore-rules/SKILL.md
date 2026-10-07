---
name: firestore-rules
description: How to change Firestore security rules or the data shape they guard in Mise, plus the full data model (every collection and field). Use BEFORE editing firestore.rules, adding a Firestore collection, adding/renaming/retiring a field the app saves, adding a key to a locations/{lid} or users/{uid} document, adding a membership role, or changing who may read or delete something; also before writing a Firestore query or a feature's data layer. Covers the venue boundary, roles, the read budget, the retired-field trap, the tests, and the rules-first deploy with read-back.
---

# Firestore rules — Mise

`firestore.rules` is the ONLY real security in this app (P2): hidden buttons are courtesy.
It is long and heavily commented — **read the comment above the block you touch**; most of
them record a bug that already happened once.

The full data model — every collection and field, with the reason behind each odd one — is
`data-model.md` beside this file. Read it before changing a collection, a saved field or a query.

## The shape — three separate questions

| Question | Helper | Default when data is missing |
|---|---|---|
| May this account open this venue at all? (boundary between businesses) | `member(lid)` | **deny** |
| Does this venue use this part of the app? | `sectionOn(lid, name)` | **allow** (only an explicit `false` turns a section off) |
| Is this document well formed? | the field rules of the block | — |

- `canUse(lid, section)` = `member` + `sectionOn` — what ordinary daily work needs.
- `canManage(lid, section)` = `canUse` + role is `'owner'` or `'manager'`. Among others it
  guards DELETING suppliers, ingredients, recipes, products, client menus; WRITING
  `config/orders`, `config/labels`, `ingredient-prices`, `client-accounts`; and even
  READING `foodcost-settings`. Always read the block itself — it is not only a delete gate. ⚠️ Two tiers only: hiring lives in
  `functions/onboarding.js`, never in the rules.
- `cardAccess(lid, section, card)` → `'manage' | 'staff' | 'none'` — the MONEY screens
  (Food cost, Magazzino). An employee gets `'staff'` only where the venue set
  `staffShownCards.<card> == true` (literal `true`).
- Client ordering accounts are NEVER a `member()` — they have no `users/{uid}`; their grant
  is `locations/{lid}/client-accounts/{uid}` (`isOrderClient`). Keep it that way: never let
  the app write another person's `users/{uid}` — that would be a master key.
- Kept open to every member ON PURPOSE (people correct their own work): `logs`, `log`,
  `orders-history`, `client-orders`, `pastry-logs`, and `config/calculator`.

**The membership value IS the role**: `users/{uid}.locations.<lid>` = `true` (employee) |
`'manager'` | `'owner'`. ⚠️ `is string` before comparing (a boolean vs a string is a type
error). ⚠️ **A new membership value goes in THREE places or it is a lockout:**
`js/sections.js` `locationsOf()`, `firestore.rules` `member()` (and `cardAccess`),
`functions/onboarding.js` `accessValue()`.

## Documents no client may write

- `users/{uid}`, `locations/{lid}`, `locations/{lid}/members/{uid}`, `join-codes`,
  `rate-limits*`, `admins` → `allow write: if false`. `members/{uid}` is a label, never an
  identity — no rule may read it to decide anything.
- **A new field on `locations/{lid}` needs a Cloud Function, not a rule.** ⚠️ A callable runs
  with full server rights and SKIPS the rules — **its own checks are the only lock**. Copy
  `setStaffCard` in `functions/onboarding.js`, all four parts:
  1. `const uid = requireAuth(request);` then validate every input — `locationId` against
     `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`, the value's type and allowed set — BEFORE any path
     is built from it.
  2. **The role check:** `const access = await accessValue(uid, locationId);` and refuse
     with `permission-denied` unless `access` is `'owner'` or `'manager'` (only `'owner'` for
     anything about people). Without it any signed-in account can change ANY venue.
  3. Write **ONE field with `{ merge: true }`**, never a spread (the document also holds the
     name, sections and country).
  4. **Add it to the `export { … } from './onboarding.js'` list in `functions/index.js`** —
     a callable missing there is never deployed and the app gets a bare «internal» error.
  Plus a test like `tests/home-cards.test.mjs` (which pins the export and the role check),
  and a reading side (e.g. `js/venue-features.js`) whose default for a missing key is the
  SAFE one.
  `deploy-functions` publishes it on the merge — confirm it ran (`go-live`).

## Changing a collection — the checklist

1. **Find how the app writes it.** `setDoc(…, { merge: true })` → the rules see the FULL
   MERGED document: list every key production ever carried, require NOTHING. Whole-document
   writes (e.g. `logs`, `products`) may require keys.
2. **New collection:** inside `match /locations/{lid}`, ABOVE the default-deny. Pattern:
   ```
   match /things/{id} {
     allow read: if canUse(lid, 'orders');
     allow create, update: if canUse(lid, 'orders')
       && stampedFor(lid)                                  // bakery == lid
       && request.resource.data.keys().hasOnly(['bakery', 'name', 'active'])
       && (!('name' in request.resource.data)
           || (request.resource.data.name is string && request.resource.data.name.size() <= 200))
       && (!('active' in request.resource.data) || request.resource.data.active is bool);
     allow delete: if canManage(lid, 'orders');           // or false, or canUse — decide why
   }
   ```
   A subcollection **inherits nothing** from the document above it — write its own block.
3. **New field:** add it to `hasOnly([...])` AND validate type + size (strings `<= N`, lists
   `.size() <= N`, enums with `in [...]`). Maps judged by the rules must be FLAT and keyed by
   id — rules cannot look inside a list.
4. **⚠️ Retiring a field: NEVER remove it from a whitelist while production still carries
   it.** Every affected document becomes permanently unwritable. Drain first (the app writes
   `null` on every save), check production, only then remove. Still whitelisted for that
   reason: `suppliers.notifyHoursBefore`, `drafts/current.weekId`, the price keys and
   `packPrice`/`packSize` on `ingredients`. ⚠️ `vatRate` lives ONLY on `ingredient-prices`
   (`tests/price-fields-whitelist.test.mjs`).
5. **`config/calculator` validates keys with a CLOSED list** — a new config field needs a
   rules change + deploy, or every Calculator save fails.
6. **`allow read` also answers collection QUERIES, where `resource == null`.** A rule that
   judges `resource.data` must split `allow get` from `allow list` (see `inventory`).
7. **Count the reads.** Firestore allows 10 document accesses per rule evaluation, counted
   by CALL (the same doc twice = 2). Today: `canManage` ≈ 3, `cardAccess` = 2. Use one
   `get()` bound with `let`, never `exists()` + `get()`. `tests/rules-read-budget.test.mjs`
   pins the shapes — update it with intent, never to make it pass. A budget crash and a
   refusal are both 403, so the rules suite alone cannot see it.
8. **Refusal messages:** the app must turn `permission-denied` into a friendly message
   (P17); a refused save must never lose the typed data (P20).

## Test

- `npm run test:rules:emulated` — starts a FRESH emulator (`demo-theitalianclub`) and runs
  `tests/rules/firestore-rules-check.mjs`. Add cases for: the new shape, every LEGACY shape
  production holds, an employee, a manager, a member of ANOTHER venue, signed out.
- Then **break the new rule on purpose** and watch a case go red — a suite that passes
  whatever the rules say is worthless.
- ⚠️ With an emulator already running (`npm run test:rules`), **restart it after every rules
  edit** — its «Rules updated» did not always reach the project and it judged the OLD file.
- `npm test` too: it holds the read-budget and whitelist shape tests.

## Deploy — rules FIRST, then the merge

- If the new app version SENDS a key the live rules do not know, **deploy the rules BEFORE
  merging** — otherwise every phone that updates gets «could not save». Rules that only
  ADD optional keys are safe to deploy early (old phones never send them).
- ⚠️⚠️ **Deploy only from a branch that contains the latest `main`.** The deploy publishes
  the WHOLE file: from a branch cut before another rules change went live, it silently
  UNDOES that change. So: `git fetch` → `node scripts/rules-live-diff.mjs origin/main` →
  `identical: true` (live = main; if `false`, find out why — an early add-only deploy from
  another open PR means this branch must carry that PR's rules too; anything unexplained,
  stop) → `git merge origin/main` into the branch, push, checks green again → `git diff
  origin/main -- firestore.rules` shows ONLY this PR's change → deploy from a CLEAN
  checkout (the read-back reads the working tree, uncommitted edits included).
- `firebase deploy --only firestore:rules --project bakery-app-ebf90` from the repo root (the
  harness asks Federico — expected). Always name the project: a bare deploy goes wherever
  `.firebaserc` or a stored `firebase use` points. **Three warnings are normal, for ever:**
  `Invalid type. Received one of [null]. Expected one of [map].` — in `member()`,
  `cardAccess()` and `orderClientOf()`. A FOURTH warning, or one elsewhere, is new: stop and
  read it.
- **Read it back:** `node scripts/rules-live-diff.mjs` → `identical: true` against the
  branch file; after the merge, `node scripts/rules-live-diff.mjs origin/main` → `true`
  again. «Deploy succeeded» is not proof (P5). Say the ruleset id in the release notes.
- ⚠️ **Never «roll back» by deploying an older rules file.** While the new version was live,
  phones saved its new keys into real documents; an older whitelist refuses every later save
  of those documents — the retired-field trap. A rules fix is a NEW change that still lists
  every key production may now carry. Reverting an app release that changed the rules must
  keep the live `firestore.rules` on main (`go-live` → roll back).
- ⚠️ **A change that RAISES a version the rules refuse to lower** (products' `model`) **or
  makes a key REQUIRED** on a whole-document write cannot be rolled back by reverting the
  app: documents saved since would refuse the old app. Say so in the PR, before it ships.
- Part of the release sequence in the `go-live` skill.

## Never

- `allow read, write: if true`, or any rule without `member()`/`signedIn()`.
- Remove or weaken the trailing `match /{document=**} { allow read, write: if false; }`.
- Let a client write `users/{uid}`, `locations/{lid}` or `members/{uid}`.
- Remove a key from a whitelist that production still carries.
- Add a name to `canReadOrdersData`'s OR before every venue that must not have it has that
  section explicitly `false` (a missing section reads as ON).
- Switch on App Check enforcement anywhere (no client sends a token since PR #212).
