# Mise 2: current-app changes still owed (ports) — step 2 of the go-live plan

Written 8 Nov 2026 when `main` (v1.144.1) was merged into `feature/mise2-release`. Every item is a change the CURRENT
app made on `main` since the Mise 2 stack forked from it (6bee00d7, v1.125.14, 24 Oct 2026) that Mise 2 does not have
yet. Tick an item off here when its port lands. Method: the 40 first-parent merges on main since the fork and the
commits behind them, checked against `app/src` and `shared/src` (evidence for «none» is a grep for the key identifiers);
memory notes and `docs/parity/` read by grep. Sizes: S = a short session, M = one session.

**The machine-checked half.** Where a spec compares a port with its `js/` original, the comparisons main broke are
EXPECTED failures (`test.fails`) carrying the marker `PORT OWED (release branch, 8 Nov 2026)` — 56 of them on 8 Nov:
the `PORT_OWED` sets in `shared/src/parity.spec.ts` (sections, inventory-model, foodcost-weighing,
calculator-recipe-source, log-time, records, invoice-zip/classify, reminders) and `shared/src/odd-inputs.spec.ts`, plus
single tests in the per-module specs and `app/src/suppliers/invoiceImport/buildImport.spec.ts`. Each fails again by itself
once its port lands: remove the marker then. `tests/mise2-port-owed.test.mjs` prints how many are left on every root
`npm test` and FAILS the switch (a Mise 2 service worker, or `MISE2_SWITCH=1`) while any is left. Modules no spec pairs
(pastries-model, price-model, the recipe book, usage) have no marker: those items below come from reading diffs.

## Switch checklist

`tests/mise2-port-owed.test.mjs` FAILS the switch build while any line below is unticked (`- [ ]`). Tick a line
(`- [x]`) when its port lands, or when Federico decides to ship without it (write his decision beside it). The numbers
point at the items below, which say what and where.

Data loss first:
- [ ] 1. Pastries row notes and «Copy day» (a Mise 2 day save erases the notes) — the notes are ported (8 Nov, no longer erased); «Copy day» still owed
- [x] 2. Recipe categories written one word at a time (arrayUnion / arrayRemove), never the whole list — ported 8 Nov (PR into the release branch, `feature/mise2-port-data-loss`)
- [x] 4. Food cost `noWeightLoss` kept by a Mise 2 product save — ported 8 Nov with the switch (`feature/mise2-port-data-loss`)
- [ ] 6. Orders draft journal and corrections in flight (F-15, F-16)
- [ ] 3. `drafts/current.skipped` and «Order done» / «Close as not ordered»
- [x] 5. Usage `hours` kept by Mise 2's usage write — already on this branch through PR #473 (`e1a4639d`), found on 8 Nov:
      the tick files the seconds under the hour (`addHour`), the stored day keeps them across both apps' commits and the
      payload carries them (`app/src/telemetry/usage.spec.ts`, «the hours reach the stored day and the line…»)
- [ ] 7. Stocktake «Close month» guard moved into shared/ (`LIST_STATUS`, wording)

Roles, Orders, Suppliers:
- [ ] 8-11. Partial owners (owner-sales, owner-kitchen): sections, records, price gate, Clients page, weighing door
- [ ] 12. «Order today» tag in both supplier lists
- [ ] 16. Suppliers empty-flash, scroll and focus fixes, «hand-made» mark (verify)
- [ ] 18. Invoice import: goods counted in pieces priced per piece
- [ ] 20. Piece weight typed in grams

Food cost, Recipe book, Calculator:
- [ ] 21-22, 24-28. Food cost steps 1, 2, 4, A, B, recipe line in grams, two decimals
- [ ] 23. Food cost recipe link with several products (check)
- [ ] 29. Create products from the recipe book
- [ ] 30. Crossed-out euro on rows Food cost cannot price
- [ ] 31. Recipe book renamed-row warning
- [ ] 32. Recipe row menu, full screen from a button, Back from Orders keeps the quantity
- [ ] 36-40. Calculator: reorder, «Add a recipe» from the book, litres and ml, dough history dates, cached «no config»
- [ ] 44. Chrome 101 visible height (check on the lab tablet)
- [ ] 47. `order-sent` usage statistic

Before the switch, not ports:
- [ ] Every shop computer running the Zebra print agent pulled and restarted (agent 1.1.0) BEFORE the switch: the branch's
      `js/catalogue/label-zpl.js` adds `^PON` to every standard label, which agent 1.0.1 refuses («not a single label made
      by the app»). No venue printing through the Zebra queue = nothing to do; say which.
- [ ] Rules deployed from a branch that contains the latest main (`firestore-rules` skill), read back identical
- [ ] The switch PR's CI runs the root suite with `MISE2_SWITCH=1`
- [ ] TTL policy on `todos.expireAt` (his OK), CSP (functions host, `https://www.gov.uk`)
- [ ] `feature/mise2-3g-2` (Settings: holidays, app language, sections for staff) finished and merged, or his OK to ship without
- [ ] His OK on what the switch leaves out until later: staff and join screens, kiosk, reminder notifications, `order.html` kept as it is

## A. Data-loss risks (port BEFORE the switch)

1. **Pastries row notes + «Copy day»** — PR #446 (v1.133.0), also `ae7a415a` (a discarded copy must not leave a recorded day locked).
   DATA LOSS: YES. `pastries/{Weekday}.items[]` is `{name, qty, note?}` (note ≤ 40 chars, key absent when empty, also frozen in
   `pastry-logs`). Mise 2 rebuilds rows as `{name, qty}` (`app/src/pastries/editorModel.ts:26,31`) and writes the day whole,
   so the first save erases every note of that day. Mise 2: NONE (`MAX_ITEM_NOTE_LENGTH`, `cleanItemNote`, `otherWeekdays` absent from
   `shared/src/pastries-model.ts`; no copy-day UI). Files: `shared/src/pastries-model.ts` (+ `pastries-log-model.ts` for the frozen note),
   `app/src/pastries/{editorModel,DayPanel,pastriesStore,PastriesSection}.tsx/ts`, i18n en/it, `docs/parity/pastries.md`. Size M.
   Minimum safe fix if time is short: carry `note` through the editor model untouched (S) and port the UI after.
2. **Recipe categories written whole** — PR #429 (v1.129.1) + `889a2ab0` («one word at a time»).
   DATA LOSS: YES, across phones. Main writes `config/labels.recipeCategories` with `arrayUnion(word)` / `arrayRemove(...words)`
   (`js/catalogue/firebase-catalogue.js:178-186`), so a phone with a stale copy cannot wipe the venue's list. Mise 2 writes the
   WHOLE list: `app/src/recipes/recipesStore.ts:875` `saveLabelProfile({ recipeCategories: normalizeRecipeCategories(list) })`
   (comment in `shared/src/recipe-shelf.ts:16` says «written whole»). Mise 2: PARTIAL (screens done; the write is wrong).
   Also to confirm: the current app's «category answers on a venue with no label settings» fix (`febb0092`). Files:
   `app/src/recipes/recipesStore.ts`, its source (a `labelsSource`-style fs wrapper needing arrayUnion/arrayRemove + fake), specs. Size S.
   Already matched in Mise 2: `category` is sent only when the editor's menu moved it (`recipesStore.ts:103,717`), `archived` never sent by a save.
3. **`drafts/current.skipped`** — PR #470 (in release #487, v1.143.0) + `f65d5c73` (rules).
   DATA LOSS: LOW / probably no, unverified by a run. Shape `skipped: { supplierId: 'YYYY-MM-DD' }`. Rules already on the branch
   (`firestore.rules:1273,1295`). Mise 2's draft write is a partial-map merge (`ordersSource.ts:278-280`, `setDoc(..., {merge:true})`), so
   `skipped` survives a normal save. Risks left: any whole-document `set` of the draft, or the draft being deleted and recreated, would drop it.
   Mise 2: NONE as a feature (no `skipped` read or write; «Order done» / «Close as not ordered» absent, `closeOffer` and `skippedOn` absent from
   `shared/src/reminders.ts`, parity marked PORT OWED). Consequence: suppliers closed as «not ordered» on a phone still on the current app look due
   again in Mise 2 (strip, Home badge, kiosk lines). Files: `shared/src/reminders.ts` (closeOffer, dueTodayIds, skippedOn), `app/src/orders/{ordersSource,
   draftSync,OrdersContext,SupplierSummaryScreen}`, i18n, `docs/parity/orders.md`. Size M. Note: change in the order-summary UX
   (#470 buttons) is the visible part.
4. **Food cost product `noWeightLoss`** — `bb1e0ede` (step 1, PR #455 in #487), rules `firestore.rules:2589,2635`.
   DATA LOSS: YES. Mise 2 saves a product WHOLE (`app/src/foodcost/foodcostSource.ts:236`, «WHOLE, NOT MERGED») and has no `noWeightLoss`
   field (grep: no hit in app/ or shared/), so the first Mise 2 save of a product flagged «Finished product, no weight loss» removes the flag
   and the recipes' oven loss starts counting again (changes the cost). Mise 2: NONE. Files: `shared/src/foodcost-model.ts`,
   `app/src/foodcost/{productEditorModel,ProductForm,WeighingPair}.tsx`, source + store round trip. Size S (carry the field) + switch UI (S).
5. **Usage record `hours`** — DONE: it came into this branch with PR #473 (`e1a4639d`, step 1); the description below was
   written before that was noticed. PR #472 (v1.139.x), `97d6beae`. DATA LOSS: minor (statistics only). `app/src/telemetry/sinks.ts:122-125`
   writes the day's usage doc with a whole `setDoc`, so a device that opened both apps in a day loses `hours` for that day. Mise 2: NONE in
   `app/src/telemetry/usage.ts` (the shared model `shared/src/usage-model.ts` already knows `hours`). Files: `app/src/telemetry/usage.ts`,
   `sinks.ts`, specs. Size S. (Memory note says Mise 2 telemetry uses its own `m2-…` versions: keep that.)
6. **Draft journal and corrections in flight (Orders)** — PRs #436 (`e3a12e49`, `f1da219c`, `eff23069`) and #444 (`345b94ce`, `d7eeea6a`,
   `2dc0c071`), #410 (`2edd1a01`, `478b4767`). DATA LOSS: YES in the sense of a typed quantity lost or reverted (reload before the write
   lands; 5,0,5 ending on 5/0). Parity doc says «to port before the switch»: `docs/parity/orders.md` F-15, F-16 (lines 551-576). Mise 2:
   NONE for the journal (`orders-draft-claims` / `visibilitychange` flush absent; `draftSync.ts` has `inAir`/`flights` from earlier work but not
   the #444 rules). Files: `app/src/orders/draftSync.ts` (+ a localStorage journal module), specs from `tests/draft-claims.test.mjs`,
   `tests/draft-journal.test.mjs`. Size M.
7. **Stocktake «Close month» guard** — PR #442/#440 (`6538e1db`, `2e4ee2a1`, `5df661d3`). Core data fix ported on the stack (PR #443,
   `app/src/stocktake/stocktakeModel.ts` has `withoutEmptyMaps`, `monthReady`). Mise 2: PARTIAL. Owed: move both plus `LIST_STATUS` /
   `listStatus` into `shared/src/inventory-model.ts` (parity marked PORT OWED: inventory-model), the «No products» wording only when both answers prove
   it, and check `5df661d3` (a failed price read keeps the prices already received). No data at risk if the guard is intact. Size S.

## B. Roles and access (partial owners): rules already live, Mise 2 UI blind

8. **Partial owners step 4** (`owner-sales`, `owner-kitchen`) — PRs #430 #432 #449 (v1.129.0, v1.132.0, v1.134.0).
   DATA LOSS: no, but LOCK-OUT: no. Mise 2 does not know the values (`shared/src/sections.ts` lacks `OWNER_SALES`, `OWNER_KITCHEN`,
   `NOT_FOR_ROLE`, `pageWhenRefused`, `roleHasCard`/`ROLE_CARDS` named exports differ; `records.mayEditRecords` takes 2 args, main 3 with `role`;
   parity marked PORT OWED: sections, records). A sales or kitchen owner would be treated as a plain role or refused on every screen. Rules are on the
   branch. Mise 2: NONE (only `shared/src/home-cards.ts` and `away-model.ts` came over in `d73b3a9e`). Files: `shared/src/{sections,membership,
   records}.ts`, `app/src/session/visibility.ts`, section gates, Home cards. Size M.
9. **Orders price gate** — card pseudo-name `prices` (`cardAccess(lid,'foodcost','prices')`). `app/src/orders/OrdersContext.tsx` still asks Food
   cost: a kitchen owner would simply miss the money (flagged in piano-mise-2). Part of item 8. Size S.
10. **Clients page (#449, `a694100e`, `clients.html`)** — page for the sales owner: only `clients` is sent; the editor lives in the Calculator
    settings of Mise 2 already (`app/src/calculator/ClientsEditor.tsx`). Mise 2: NONE as a role-only page/route; whole-document calculator
    save by a sales owner would be refused by rules (`writesCalculatorConfig`: only `clients`, `configModel`, `configRev`, `whatsappClients`).
    Needs `saveCalculatorClients`-style narrow write, read-only received orders, waiting-orders badge, push switch door. Size M.
11. **Weighing door for the sales owner** (`weighsRecipeLoss`: update only `lossPct/rawGrams/cookedGrams` on a recipe) — Mise 2 weighing saves must
    send only those keys for that role. Mise 2: NONE (check `WeighingPair` save). Size S, part of 8.

## C. Orders

12. **Suppliers «Order today» tag** — #474 (in #487). `dueTodayIds` (`js/orders/reminders.js:80`) missing in `shared/src/reminders.ts`
    (parity marked PORT OWED: reminders). Both supplier lists (Orders and Suppliers), needs today's orders and the draft `skipped`, redraw only when the lit set
    changes, midnight re-check. Mise 2: NONE. Depends on item 3. Files: `shared/src/reminders.ts`, `app/src/orders/IngredientsList`, `SuppliersList.tsx`. Size S.
13. **Order summary «Order done» / «Close as not ordered»** — #470, see item 3.
14. **History door in the bottom bar** — #454 (`f29b20e4`). Mise 2 has an `onHistory` door and a parity section «History beside the gear (3 Nov)»:
    DONE (`docs/parity/orders.md:1377`).
15. **List copy** (#448, `mayWriteCopy`, `6e94be64`, `7d7b2d95`, `f8c36eee`) — DONE: `shared/src/list-copy.ts`, `app/src/orders/useListCopy.ts`
    (stack PR #447, memory «port ... guard on server answer and open venue» in parity «List copy as built»).
16. **Suppliers: «no ingredients» only on the server's word** (#439, `da029b17`), **rows stay put while prices land** (#438, `76be75d1`),
    **switch an ingredient off from its row, fold unused, mark hand-made** (`4de37fec`, `89fad957`, `d2dad140`, `c20f812b`, `a9e55262`,
    `2bd4e58e`, `c2b95402`) — «Not in use» group DONE in Orders (`564980cd`, branch `feature/mise2-ingredient-not-in-use`); NOT verified: the
    empty-flash fixes, the scroll/focus keep on Deactivate/Reactivate, «hand-made» mark, the card stopping resending `active`. Size S (verification).
17. **Update gate held on invoice import / Pastries editor** (`7fe1b955`, `2ae76d58`) — N/A until Mise 2 has a service worker (step 5): remember
    `markBusy()` in every editor (already in piano-mise-2).

## D. Suppliers / invoice import

18. **Invoice import: goods counted in pieces priced per piece** — `6f2173fe`, `70040086` (fix/invoice-import-per-piece, in #487).
    DATA LOSS: no (price docs unchanged), but WRONG PRICES on new imports: cornetti priced «per kilo of 50 bags». `docs/parity/suppliers.md:880`
    «TO PORT». Mise 2: NONE (`MAX_PIECE_G`, `piecesOf` absent from `shared/src/invoice-zip/classify.ts`; parity marked PORT OWED: invoice-zip/classify). Needs
    `classify`, `products` (`proposeParams`, `proposePackWord`, `pieceWordFor`), `pricing`, `parsePack` («2000x4g» count first),
    `shared/src/invoice-import-model.ts`, plus `invoice-import/*.py` is shared server code (already on branch). Specs listed in the parity doc. Size M.
19. **#435 ready-made food, carton weights, free goods, returns, VAT from the newest paid line** — DONE (`bd79eb57`, PR #437).
    Still owed from memory: the wrong cartons already saved (a data script, not a port).
20. **Piece weight typed in grams** — #489 (`aa28e3f7`): «Peso di un pezzo» typed in grams, stored in kilos (`gramsOfKg`, `kgTextOfGrams`,
    «55,» and «,5» converted). Mise 2: NONE (`app/src/records/{priceCardModel,legacyPriceModel}.ts`, `PriceSection.tsx`, `LegacyPriceSection.tsx`, en/it
    still kilos). DATA LOSS: no, but a number typed in grams by someone used to the new screen is read as kilos by Mise 2 (50 g -> 50 kg). Also
    one-off at go-live: «Uova in vassoi» (Miano) holds 50 kg, shows 50000 g. Size S.

## E. Food cost (his Food-cost exception, steps 1-6, all in v1.140.0-v1.144.1)

Mise 2 Food cost on the branch predates all of it: no `fc-number`, `per-kg-model`, `line-cost`, `preview-view`, `line-quantity`, `from-recipes`
equivalents (grep in app/ and shared/ finds none). Parity: foodcost-weighing marked PORT OWED (`weighingsChangeCost`). Files for all: `shared/src/
foodcost-model.ts`, `foodcost-weighing.ts`, new shared per-kg and line-cost models, `app/src/foodcost/*`, i18n, `docs/parity/foodcost.md`.

21. **Step 1 weighing units** (#455, `df7e6313`, `bb1e0ede`): g/kg select on recipe lines (stored kilos), raw box empty, loss only with both
    weights, kept wrong weighings (red), wider boxes, `noWeightLoss` switch (see item 4). Mise 2: NONE except `WeighingPair`. Size M with 22-26.
22. **Step 2 «Cost per 1 kg» block** (#462, `574a0e3c`, `f0735d88`, `9af66dd5`): `costPerKg`, sub-recipes opened, partial notes. NONE. Size S-M.
23. **Step 3 recipe link both ways** (#478, `35b1f3e0`, `942dab6e`) — Mise 2 has its own entry `?recipe=` / `?using=` design (catalogue.md
    «Back counts the depth»): treat as DONE by design; re-check that the multi-product case opens the top product on tablet/PC. Size S (check).
24. **Step 4 list preview** (#482): search bar, phone preview dialog, panel at the top of the card, eight figures, net ideal price. NONE. Size M.
25. **Step A card layout** (#483): read mode first, pencil edits, Save returns to read, four figures + «Details», margin under cost, history asks
    before dropping typed edits (#484). NONE. Size M.
26. **Step B line costs + «Which?»** (#485): cost on every «Composed of» line, «No price», «not exactly yet», «Which?» list of unpriced parts
    (card summary + phone dialog), packaging lines. NONE. Size M.
27. **Recipe line in grams** (#488, `a7f4c75d`): opens in grams, the g/kg switch keeps the typed number, warning at 20 times a batch. NONE. Size S.
28. **Two decimals everywhere on Food cost** (#490, `151ea191`): `fcNumber/fcMoney/fcWeight`, «< 0,01 €», percentages where drawn; price-model
    untouched (Fornitori/Stocktake keep 6 decimals). NONE. Size S (do together with 24-27).
29. **Create products from the recipe book** (#415, `b5cf999e`, `5f2fcb67`, `f8d54f35`, `f8e64a6a`): box and choice screen, only after the
    server says the product does not exist. NONE (`recipesWithoutProducts`, `productFromRecipe` absent). Size M.
30. **Catalogue: crossed-out euro on rows Food cost cannot price** (`ff1a2d38`, `js/catalogue/unpriced-rows.js`). NONE. Size S.
31. **Ricettario renamed-row warning** (#486, `a84fa1ab`, `94e0514e`): amber warning when a row is renamed but keeps its old link (whole-word
    match, same pick clears, announced). NONE in `app/src/recipes/`. Size S.

## F. Recipe book (Catalogue)

32. **Recipe row menu + full screen from a button + Back from Orders never strands a quantity** (#481 `70325def`, `8ed7a0ad`, `f0803349`; memory
    «MISE 2 PORT: row menu + split + «Ordina» link + wait-before-leaving + supplier status line»). Mise 2: PARTIAL (tap-to-full-screen exists in
    `RecipeView.tsx:426`; no row menu, no `row-actions-model` in shared). Size M.
33. **Grip on the right** (#476, `1b87d33a`, `5249713b`): DONE in Mise 2 by design (`docs/parity/catalogue.md:1565`, `ReorderRows.tsx`); the
    parity doc lines 92 / calculator.md 78 should say «name, amount, grip». Docs only.
34. **Recipe dividers** (#458): DONE (`bc5184d4`, `c894d3ae`, `cd6c7e4b`). **Recipe PDF lab format** (#456): DONE (`0341a5c2`, `8f19cf8f`).
35. **Recipe categories on screens**: DONE (`b2521628`, `7bd878b3`); write path owed (item 2).

## G. Calculator (29 Oct - 1 Nov fixes, PRs #424 and the release #428) — parity marked PORT OWED: calculator-recipe-source, log-time

Mise 2: NONE of the following (`catalogueChoices`, `rowsToStamp`, `showsSourceProblem`, `ingredientCount`, `localLogDate`, `localLogTime`,
`logStampText`, `isWeighableUnit` absent from shared; no reorder in `app/src/calculator`). Files: `shared/src/{calculator-recipe-source,log-time,
log-model}.ts`, `app/src/calculator/*`. Size M for the group.
36. Reorder a recipe's ingredients (`71627519`, `262efcfe`, `33a22947`) — `docs/parity/calculator.md:353` «not in Mise 2 yet».
37. «Add a recipe» offers the recipe book's recipes first (`a221c160`), linking never writes back an older copy (`56864739`, `97ac8fe3`, `e0b92090`).
38. A linked recipe with litres / ml rows calculates, 1 ml = 1 g (`e7f3dac0`, `rowGrams` rounding), a linked tab that cannot calculate says why
    (`6713adab`), problem line first and speaks once (`1342cb79`), linked recipe counts its own rows (`535bcdb2`, #424).
39. Dough history: dates in the venue's language (`021a49ff`), says how much a «from a total» dough is (`b00983dc`), opened dough shows its total once
    (`4b235f3d`), unsaved-changes question in the venue's language (`66e76c84`), labelled grams / leavening fields and Back buttons (`6c70cb38`, `7d5683b8`).
40. Calculator `config` cached «no config» never taken for the server's answer (`d3eb57f3`, `3d98a3e4`) — check Mise 2's calculator store. Size S.

## H. Smaller / verify

41. **Staff invite role-first** (#475) — belongs to the deferred staff screens (below).
42. **Join-form fixes** (`9e0a2dac`, `1a3567b9`, `ff7046a8`) — deferred with join codes.
43. **Kiosk keeps screen on** (#406) — deferred with kiosk.
44. **Tablet fits visible height on Chrome 101** (`5a3b3afb`) — Mise 2 has its own `feature/mise2-tablet-chrome101` (merged into the stack); not re-checked.
45. **`app-version` real release reported** (`bb9e5532`) — Mise 2 telemetry versions are `m2-…`: no port.
46. **Tooling only (no port)**: #480 session-start hook, #441/#340/#423 firebase-tools/node 24/CI, #379, #403, #451.
47. **Orders flag**: `order-sent` usage statistic still missing in Mise 2 (parity orders.md:1363).

## Deferred until AFTER the switch (his decision, 8 Nov; `mise2-go-live-presto.md`)

- Staff / join codes / roles screens in Mise 2 (people, invitations incl. #475 role-first invite, the join form). Until built: new people cannot join;
  existing accounts work. Keep the current staff pages reachable, or ship them as-is.
- Kiosk (and #406 keep-screen-on, the kiosk lines already in shared), reminder notifications (order reminders stop arriving, also for The Italian
  Club: warn them first), `order.html` stays served as it is (client links already sent).
- Owed before the switch but not ports: TTL policy on `todos.expireAt` (one gcloud command, his OK), rules deploy from a ruleset that contains main
  (the stack alone lacks partial-owner roles), CSP (functions host, `https://www.gov.uk`), service worker at the same path (step 5), 3-month order-list
  clean-up function (F9, separate task).

## WIP branch left out of the release branch

`feature/mise2-3g-2` (origin too), head 06e1f3dc `wip(mise2-settings): 3g-2 in progress, stopped on his request`, 13 commits + 1 WIP commit,
stacked on #477 `feature/mise2-home-todos`, NO PR. Content: Settings screen with Holidays, App language, «Sections for staff» (staffShownCards),
fixed section order, review fixes partly done (Back one level up, language reload waits for typing, session venue refreshed, focus). Left to do:
finish the review fixes, `mise2-check`, open the PR on #477. Consequence of leaving it out: Mise 2 has no screen to change the venue's holidays, app
language or which cards staff see (these can only be changed in the current app until it ships).

## Suggested order

1. Data-loss group, small first: 4 (`noWeightLoss`, S), 2 (categories write, S), 1 note-carry (S), then 1 full port, 6, 3.
2. Roles 8-11 (needed or the two role holders are locked out), then Orders 12-13.
3. Invoice per piece 18 and piece weight 20, then Food cost 21-31 as one slice (shared files overlap), then Calculator 36-40.
4. Empty the `PORT_OWED` sets of `parity.spec.ts` last: they are the proof for sections, inventory, weighing, calculator-recipe-source, log-time, records, classify, reminders.
