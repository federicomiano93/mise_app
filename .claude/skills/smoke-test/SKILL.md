---
name: smoke-test
description: The gates a Mise change must pass before a PR is opened or merged — automated tests, Firestore rules checks, service-worker fingerprints, the ui-check measurements, driving the changed feature on the emulator at phone and tablet width, and a short core-flow checklist per section. Use before merging, before opening a PR, whenever Federico says "smoke test", "check before publishing" or "is it ready", and before calling any branch finished. It reports what ran and what did not; whether a screen reads well is only Federico, on a phone.
---

# Smoke test — the gates before a PR or a merge

Federico reviews the APP, not the code, so these gates are the net in front of him.
`main` accepts only a pull request whose two required GitHub checks, `test` and
`rules`, are green (`enforce_admins: true`: nobody merges past a red one). A merge IS
going live — the release sequence is the `go-live` skill, not repeated here.

Run the gates in order; a change skips a gate only when it cannot affect it, and the
Report at the end says which were skipped and why.

## Gate 1 — automated tests (always)

Delegate to the `test-runner` agent (it runs `npm test` and reports totals plus
failures only). `npm test` is `node --test`: over 3,000 tests across logic, i18n,
the service worker, contrast, rules SHAPE and the byte-copied files.
- Red = STOP. Fix it, or report that the plan was wrong; never weaken a test.
- ⚠️ Never `node --test tests/` (a directory argument is read as a module) and never
  send the output into the repository — pipe it, or use the helpers folder.
- ⚠️ `npm test` does NOT run `tests/rules/*.mjs`. Passing it says nothing about Gate 2.

## Gate 2 — Firestore rules checks (when rules or the data shape changed)

Needed when `firestore.rules` changed, or anything it validates: a new, renamed or
retired field the app saves (every collection has a closed key whitelist), a new
collection, a membership value.
- `npm run test:rules:emulated` — ~770 checks against the emulator; needs Java, starts
  and stops the emulator itself, project `demo-theitalianclub` (offline, cannot reach
  production). Also a required GitHub check.
- ⚠️ A rules change is deployed BEFORE the app that needs it, and read back — see
  `firestore-rules`. Never weaken a rule to make a check pass.

## Gate 3 — service-worker fingerprints (when a precached file changed)

Any `*.html`, stylesheet, file under `js/`, icon or `manifest.json`: run
`node scripts/sw-hashes.mjs` LAST (see `bump-sw`). A file added or renamed goes into
`ASSETS` first. Then re-run Gate 1: `tests/sw-asset-hashes.test.mjs` fails until the
script has run, and it fingerprints the files as they are at that moment.

## Gate 4 — ui-check (when a screen, a stylesheet, tokens.css or a label changed)

Run the `ui-check` skill: axe-core, touch targets, sideways scroll, clipped text, icon
alignment and off-centre titles, 17 screens at 296px, 360px and tablet, in English
(`manager@club.test`) AND Italian (`miano@club.test` — the longer words are what
overflows). Open the screenshot before acting on a finding. Its "known decisions" list
is reported once, never reopened. Skip only when no pixel can have moved.

## Gate 5 — drive the CHANGED feature in the real app (when any behaviour or screen changed)

Emulator only (`drive-app` has the how; `firestore-write-guard` the why):
```bash
firebase emulators:start --only auth,firestore --project bakery-app-ebf90
FIREBASE_PROJECT_ID=bakery-app-ebf90 node tests/rules/seed-emulator.mjs
python -m http.server <fresh-port> --bind 127.0.0.1
```
- ⚠️ Only a `localhost` URL writes to the emulator; ANY other hostname is PRODUCTION.
  The console must print "LOCAL EMULATOR mode".
- Widths: phone 360px and 296×668, and tablet 1180×820 (the split layouts start at
  900px wide and 600px tall, OR at 1000px wide whatever the height). A screen with a
  text box in a split: also 1024×420 — a landscape tablet with its keyboard open must
  stay on two columns with the same box focused (`algprobe/mise-drive/drive-tablet-keyboard.mjs`).
  Both languages if any text changed.
- Walk the change's own path, then its EMPTY state, an ERROR (a refused save) and the
  longest real text. No console errors — no JS error, no `permission-denied`.

## Gate 6 — core flows (one line per section; a shared file touched → all of them)

A change in one feature must not silently break another. Shared files
(`js/i18n.js`, `tokens.css`, `auth-gate.js`, `firebase.js`, `sw.js`, `js/pages/run-in-order.js`,
`scripts/build-bundles.mjs` + `scripts/bundle-lib.mjs` (every page's bundle), the byte-copied
`dom.js` / `confirm-dialog.js`) → run every line; otherwise the touched section plus Home.
Sign in with a ONE-venue account. Labels are English, with the Italian in brackets.

- **Home** (`index.html`): one card per section the venue uses (Calculator, Recipe
  catalogue, Orders, Ingredients & suppliers, Pastries, Food cost, Stocktake); each opens
  its page and Back returns. Food cost and Stocktake: owner/manager, and staff only where
  the owner switched them on.
- **Calculator** (`calculator.html`): no seeded venue has a recipe, so make one through
  the app — the empty Calculator's "Add a recipe", or Settings (Impostazioni) → Recipes →
  "+ Add recipe" (+ Aggiungi ricetta); a name, one named ingredient, logic "You type how
  many kilos of dough to make" (needs no client), Save, confirm. On its tab type the total →
  **Confirm** (Conferma) → "Save this dough for:" → **Today** (Oggi) → the dough appears,
  inputs lock, Confirm becomes **Edit** (Modifica) → footer **Log** (Registro) shows the
  entry with date and time → trash icon "Delete log" → **Delete** (Elimina) → it is gone.
- **Orders** (`orders.html`): tap a supplier → its order opens full screen → type a
  quantity in a row → wait a second → **reload the page, tap the same supplier again: the quantity is still there** (the draft saves
  0.8 s after typing — never lose the user's work) → the supplier row shows the count → **Order placed** (Ordine fatto,
  disabled until something is typed) → confirmation screen → **Order placed** → the rows
  clear and the order waits on **Incoming** (In arrivo). Tablet and owner/manager: the
  order total with VAT appears under the rows once prices are entered.
- **Ingredients & suppliers** (`suppliers.html`): open a supplier or ingredient, type in a
  field, tap Back → "Discard changes?" (Scartare le modifiche?); Cancel keeps the typing,
  **Discard** (Scarta) leaves.
- **Recipe catalogue** (`catalogue.html`): open a recipe → type grams in the weight box →
  **Calculate** (Calcola) → "Calculate <recipe> for <amount>?" → **Calculate** → amounts
  rescale and the Total equals the typed grams → **Clear — back to base recipe** restores.
- **Food cost** (`foodcost.html`): the list shows each product's cost and margin; open
  one; **New product** (+) then Save with no name → "Please enter a product name."; with a
  name → **Save** → "Save product?" → **Save** → "Product saved."
- **Stocktake / Magazzino** (`inventory.html`): type a count in a product row ("How many
  of <name> are left") → the "Counted" summary moves; **Close the month** (Chiudi il mese)
  → the month reads Closed and the boxes lock; **Reopen the month** (Riapri il mese) undoes it.
- **Pastries** (`pastries.html`): pick a day → pencil "Edit this day" → **Add pastry**,
  name and number → Save → "<day> saved." → **Confirm** (Conferma) → "Confirm <day>?" →
  Confirm → "<day> recorded.", the "Confirmed" mark and Edit appear; footer **Records**
  (Registri) lists it. ⚠️ The work day rolls at 4am.
- **Settings**: Orders → Settings: flip a switch → "Saved ✓" (Salvato ✓) beside it, and it
  is still set after a reload. Calculator → Settings: every row (Clients, WhatsApp, Client
  ordering, Recipes, Extra dough, Divisor, Log) opens its screen and Back returns.

## Report (always end with this)

State plainly, gate by gate: ran (with the totals), or skipped (and why — "no
stylesheet changed" is a reason, "no time" is not). List anything that failed or was
not driven. Then say: **the automated gates measure and cannot judge whether a screen
reads well — that is Federico's, on his phone**, and name the screens he should open.

## Never

- Never open a PR or call a branch ready with a red Gate 1 or Gate 2.
- Never drive the app on a non-localhost URL to "just check" — that is production.
- Never merge: going live is Federico's choice of hour (`go-live`).
