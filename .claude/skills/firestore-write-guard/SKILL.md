---
name: firestore-write-guard
description: Keep test writes off the real Mise database. Use BEFORE any action that could save to Firestore outside the unit tests — driving the app in a browser, a probe or driver script, seeding, a node script with firebase-admin, testing from a phone on the LAN, or fixing a real document — whether it saves a dough, a log, a supplier, an ingredient, a price, an order, a draft, a stocktake, settings or a product. Explains which database a write reaches and what to do when the task really is production data.
---

# Firestore write guard — Mise

There is ONE Firestore, `bakery-app-ebf90`, holding real venues (real suppliers, real
orders, real prices). Which database a write reaches is decided by the **hostname** and by
**whether the emulator is running** — never by "I'm only testing".

## The switch (`js/firebase.js`, by hostname only)

| Page served from | Emulator running? | Where writes go |
|---|---|---|
| `localhost` / `127.0.0.1` / `::1` | yes | **emulator — safe, write freely** |
| `localhost` / `127.0.0.1` / `::1` | no | **nowhere** — writes fail, production untouched, the test is INVALID |
| `federicomiano93.github.io` (the live site) | — | **PRODUCTION** |
| anything else: a PR preview link, a LAN IP (a phone on Wi-Fi), a tunnel | — | **PRODUCTION until PR #244 is live; since then the PREVIEW project** (fake data, `js/firebase-target.js`) — never the emulator, and never a valid local test |

There is no fallback and no check that the emulator is up. Confirm it: the console prints
"LOCAL EMULATOR mode", and the emulator UI answers on http://127.0.0.1:4000.

## The safe path (default for every test)

1. `firebase emulators:start --only auth,firestore --project bakery-app-ebf90`
   ⚠️ That project id, exactly: another id makes saves fail with an **evaluation error in
   `canUse()`** that looks like a broken app.
2. Seed: `FIREBASE_PROJECT_ID=bakery-app-ebf90 node tests/rules/seed-emulator.mjs`
   (production-SHAPED data incl. legacy fields, hardcoded to 127.0.0.1; test accounts are
   `*@club.test`).
3. Serve the app locally over http (never `file://`) and drive it — the `drive-app` skill
   has the ports, accounts and traps.
4. **After an emulator restart, re-seed** — it starts empty.

## Scripts are a bigger risk than the page

- The browser app obeys the rules; **a node script with `firebase-admin` BYPASSES them.**
  Without `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` (and `FIREBASE_AUTH_EMULATOR_HOST=
  127.0.0.1:9099`) set in the SAME command, an Admin SDK script writes to production with
  full power. Put the variables on the command line itself, and prefer the REST emulator
  calls `seed-emulator.mjs` uses.
- A LAN IP or tunnel to test on a phone is not a local test (production before PR #244, the
  preview project after). To try a change on a real phone, use the PR's **preview link**
  (fake data); to drive it from the PC, the phone-preview window (`drive-app`).

## When the task really IS production data

⚠️ **Only the main conversation may do this — a helper agent (`implementer`, any
sub-agent) NEVER writes to production: it stops and reports.** For the main conversation it
is allowed without stopping (global P10) — the protection is not a question to Federico:
1. **Copy first**: read the exact document(s) and save them as JSON in the session
   scratchpad, so the change can be put back by hand.
2. Write the smallest change, through the app where possible (it obeys the rules), and
   write a document the rules ACCEPT — every collection has a closed key whitelist, so an
   invented probe document gets `permission-denied` (that is the rules working).
3. Read it back.
4. Put it in the end-of-work list: which venue, which document, before → after.
⚠️ Some collections refuse deletes (`drafts/current`, `config/*`, `daily-logs`, `inventory`):
a bad write there can only be repaired by overwriting it. Never delete production data to
"clean up a test" — and never weaken `firestore.rules` to make cleanup possible.

## Exempt

- `npm test` — pure functions, never touches Firestore.
- `npm run test:rules:emulated` — its own emulator under `demo-theitalianclub`.
- Reading the live site without signing in, and `node scripts/rules-live-diff.mjs` (read-only).

## Never

- Call a write "safe" because the URL says localhost — the emulator must be confirmed up.
- Run a firebase-admin script without the emulator variables on the same command line.
- Test writes from a LAN IP or tunnel and call it local.
