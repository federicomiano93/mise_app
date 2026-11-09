# Mise data model (Firestore)

The full map of collections and fields, with the reason behind each odd one. Read it before
touching a collection, a saved field, a query or a data layer. The warnings that must hold even
when this file is not open are repeated in the project CLAUDE.md («Data model»). Which database a
write reaches (emulator / production / preview): the `firestore-write-guard` skill.

**Calculator (historical, flat):** `log/{dough}` · `daily-logs/{date}` · `logs/{id}` (append-only
version chain inside the document, `js/log-model.js`) · `config/calculator` (address book,
`recipes[]`, ingredient-name registry, per-recipe settings; mirrored to `localStorage`). Its rule
validates keys with a closed list — a new config field needs a rules deploy. `configModel`,
`showClientOrdersButton` and `askDoughDay` stay in that whitelist for good; CONFIG_MODEL is 4 and
the rules refuse a lower one, so a release that raises it cannot be rolled back by a revert. There is no
`products[]`: a product belongs to the client that orders it — `clients[] = { id, name,
products }`, quantities keyed `qty-<clientId>::<productId>`.

**Everything below lives under `locations/{id}/…`**, and `js/location.js` throws before a venue is
open.

**Two documents outside the tree, writable by no client:**
- `users/{uid} = { locations: {...} }`.
- `locations/{id} = { name, sections, country, language, recipePhoto, showAllergens,
  showNutrition, staffHiddenCards, staffShownCards, homeCardOrder }`. No key whitelist, so a new
  field needs no rules deploy but a Cloud Function (`allow write: if false`) — and each function
  writes ONE field with `merge`, never a spread, because the same document holds name, sections and
  country. `staffHiddenCards` / `staffShownCards` (`{ <cardId>: true|false }`) are display switches,
  never access: only a literal `true` counts, `canManage` passes them (a partial owner keeps only their
  `ROLE_CARDS`); read by
  `js/home-cards.js`, `js/auth-gate.js` (body `data-card`) and `js/home-orders-badge.js`.
  `functions/home-cards.js` keeps a byte copy of the card ids (`tests/home-cards.test.mjs`).

**Access control.** ⚠️ **The role IS the membership value**: `users/{uid}.locations.<lid>` is
`true` | `'manager'` | `'owner'` | `'owner-sales'` | `'owner-kitchen'`; anything else is an employee
and also not a member. A new membership value goes in THREE places or it is a lockout:
`js/sections.js` `ACCESS_VALUES`, `firestore.rules` `isMemberValue()`, `functions/onboarding.js`
`ACCESS_VALUES`. `is string` in the rules is deliberate (boolean for staff, string above it; the rules
language is strongly typed).
- **The two partial owners (his decision, 1 Nov 2026).** They run one side as an owner would, hire
  nobody and change no venue setting. `'owner-sales'`: Food cost and the clients, reading recipes,
  ingredients and suppliers because a product is costed from them. `'owner-kitchen'`: Calculator,
  Catalogue, Pastries, Orders, Stocktake and purchase prices; client names and quantities only as the
  Calculator needs them. `ROLE_CARDS` in `js/home-cards.js` deals every Home card to exactly one of them.
  Only a full `'owner'` counts for the last-owner guard, so a venue always keeps one. The kitchen
  may not read `products`, so the merge asks the callable `productsUsingIngredient`, which answers
  with names alone (`functions/product-usage.js`).
- `locations/{lid}/members/{uid}` — the roster `{ email, firstName, lastName, joinedAt }`. A label,
  never an identity: no rule reads it; no account may write it. A surname is personal data (UK
  GDPR).
- `join-codes/{sha256}` and `rate-limits/{uid}` — Admin SDK only. Only the HASH of a code is
  stored. Every refusal reads identically except the rate limit. The last owner cannot demote or
  remove herself.

**Orders** (every document carries `bakery` = the venue id — the rules' `stampedFor(lid)`; the old
flat collections used `"main"`; the rules whitelist the keys of all four and check type/size).
⚠️ **Fields that stay in the whitelists for good because production carries them**:
`suppliers.notifyHoursBefore` and `drafts/current.weekId` (retired), `orders-history.sends`
(`v1.105.0`), `config/orders.supplierOrder` (`v1.106.0` — removing it would refuse EVERY
config/orders save: stock switch, send routes, week start) and `config/orders.favouriteSuppliers`
(`v1.116.0`, same reason), `ingredients.supplierCodes` and the price-history `packLabel` /
`packCode` (`v1.117.0`), `ingredient-prices.priceBasis` (`v1.120.0`); and, once Mise 2 is live, the goods-arrived switch
`config/orders.deliveryCheck` (bool, absent = on), `deliveryCheckFrom` and `deliveryCheckOffOn` (plain YYYY-MM-DD; Mise 2
slice 3f-5, decision F4 — only owner/manager write them; the current app ignores them). A `setDoc(merge:true)` never deletes a
field and the rules see the full merged document — remove either from the whitelist before
deleting it from production and every affected document becomes permanently unwritable. Tests:
`npm run test:rules` (needs the emulator; a required CI check); `npm run test:rules:emulated` starts
both halves.
- `suppliers/{id}` — `{ name, shortName, category, deliveryDays[], orderDays[], phone, email,
  active }`. `name` is the invoice name (what the form edits); `shortName` (≤60, optional, `''`
  clears it) is what every screen and the sent text show — always through `supplierLabel()`
  (`js/supplier-label.js`), never `supplier.name` (`tests/supplier-label.test.mjs`).
- `ingredients/{id}` — `{ name, supplierId, category, brand, weight, unit, active, kind, allergens[],
  mayContain[], allergensCheckedAt, nutrition, packIngredients }`. The price is NOT here; the old
  price keys stay whitelisted and are written `null` on every save so they drain out.
  `packIngredients` (≤4000 chars, the supplier's pack list) only pre-ticks allergen boxes and never
  writes `allergensCheckedAt` — a suggestion is inert until a person confirms. `kind` =
  `'ingredient' | 'packaging'` (absent = ingredient): packaging has its own tab, is never offered to
  a recipe row, and neither shows nor writes allergens. `packUnit` stays whitelisted for good.
- `ingredient-prices/{ingredientId}` — `{ priceUnit, pricePerUnit (NET), unitWeightKg,
  priceUpdatedAt, vatRate }`, behind `canManage(lid,'foodcost')`. `vatRate` ∈ 0/4/5/10/20/22 or
  null = «not stated», never read as 0. ⚠️ **`vatRate` lives ONLY here** — `splitPriceFields` drains
  `INGREDIENT_DRAINED_FIELDS` (not `PRICE_FIELDS`) onto the ingredient, whose whitelist lacks it:
  one refused key fails every ingredient save (`tests/price-fields-whitelist.test.mjs`). A parallel
  collection, not a subcollection. A missing price is not an error. `writePrice` is passed in, not
  decided in the data layer — a batch is all-or-nothing.
- `ingredients/{id}/prices/{autoId}` — append-only history, create-only. A subcollection inherits
  nothing from the rules above it.
- `invoice-imports/{autoId}` (Mise 2, 25 Oct 2026, rules not yet deployed) — the import log, one record per import run,
  written ONCE (create only, never edited) at the end of a run: `{ bakery, fileName (≤500, the picked files' names,
  a personal tax code blanked), importedAt (ISO), firstDate, lastDate (YYYY-MM-DD, the invoices' own Data, first ≤
  last), months[] (YYYY-MM, 1–600), invoiceIds[] (the reader's docId = the SDI id; 1–5000) }`. NO «who imported»
  (P13). Read, written, deleted by `managesPrices(lid)` like `invoice-decisions` (so the kitchen's owner too). The reader sets aside every
  invoice whose id is here (`alreadyImported` of build-import), so a re-loaded file offers only its new invoices; an
  invoice is recorded only when every ingredient row holding a price of it was seen through
  (`app/src/suppliers/invoiceImport/importLog.ts`). The current app neither reads nor writes it.
- `drafts/current` — the order in progress; `days` is the memory that makes the day model work.
  `skipped` (6 Nov 2026, optional map ≤ 200) — `{ supplierId: 'YYYY-MM-DD' }`, a supplier due today
  closed as «non ordinato» from the order summary (nothing needed); it counts only on that day
  (`reminders.js skippedOn`) for the Orders strip, the Home badge and the kiosk. Written on its own,
  never through the autosave, and never with `updatedAt`. Once production carries it, it stays listed.
- `orders-history/{YYYY-MM-DD}_{supplierId}` — one record per day per supplier; `names` freezes each
  item's label; `deliveredAt`/`missing` optional. Since `v1.109.1` Orders reads only the last 2 months live (`date >=`,
  `js/orders/history-window.js`); older pages on demand from History; the legacy `2026-W28` record (no
  `date`) is fetched last by `weekStart`. Suggestions and deliveries see the live window only.

**Allergens and labels.** ⚠️ **Three states, not two**: «nobody has said» / «checked: none» /
«checked: contains these», told apart only by `allergensCheckedAt`. The specific cereal and nut are
named (`gluten-wheat`, not `gluten`). `mayContain` is never merged into `allergens`. In nutrition,
0 is a real value and `null` is not.

**Recipe row divider (5 Nov 2026).** A row of `recipes/{id}.ingredients` may carry `dividerAfter` (optional, `true` or absent, never `false`/null; not checked by the rules because they cannot look inside a list; the shape is `normalizeIngredient`). The PDF draws the line, the spreadsheet ignores it.

**Image labels (Mise 2, 25 Oct 2026, rules not yet deployed).** Recipes may carry `labelName` (string ≤200; empty =
the recipe name in capitals) and `labelIngredientsText` (string ≤2000, the ingredients typed as printed, allergens in
capitals); employees may edit both, like the rest of a recipe. `config/labels` gains `template` (`'standard'` |
`'logo'`) and `rotate180` (bool). The logo is `label-assets/logo` — its OWN collection, because `/config/{doc}` would
match any new name there — `{ bakery, png (a `data:image/png;base64,…` address, ≤400 000 chars), width (== 1320),
height (int 1–1920), updatedAt? }`: written and deleted by `canManage` catalogue, read by members with the catalogue
on; no other id. The current app saves recipes and `config/labels` with merge, so it keeps these keys.

**Recipe shelf (Mise 2, 25 Oct 2026; `category` and `recipeCategories` are LIVE since main took them on 1 Nov, `archived` and its check are not yet deployed).** Recipes may carry `category` (string 1–100; «no
category» is NO field — an emptied choice is a removal; a word not on the venue's list reads as «no category» and comes
back if the word is put back) and `archived` (bool; only `true` is stored, a restore removes it). ⚠️ The rules ask
`canManage(catalogue)` ONLY when the archived state MOVES (created archived, archived, restored): an employee's ordinary
save of an archived recipe still passes. `config/labels` gains `recipeCategories` (list ≤ 100, written whole from the
Catalogue Settings, canManage like the rest of that document). An archived recipe stays readable by id everywhere
(Calculator tabs, Food cost lines, sub-recipe rows, labels); only the list and the pickers for NEW links leave it out
(`shared/src/recipe-shelf.ts`). The current app neither reads nor writes them; its merge saves keep them.

**HACCP label (Mise 2, 26 Oct 2026, rules not yet deployed).** Recipes may carry `haccpStorage` (string ≤200, how the
semi-finished good is kept; employees may edit it). `config/labels` gains `haccpFields` (a FLAT map, keys from the eleven
field ids of `shared/src/haccp-label.ts`, values `'off'` | `'print'` | `'blank'`; a missing id = that field's default),
`haccpSize` (one of `'40x30'`, `'50x30'`, `'60x40'`, `'62x29'`, `'80x60'` — each is a static page file in the app) and
`haccpCategory` (string 1–100, the one category the HACCP list shows; none = every recipe; a word not on the venue's list
= every recipe). canManage like the rest of that document. The prepared-by name is READ from
`locations/{lid}/members/{uid}.firstName` (a label, never an identity) only when that field is printed; ⚠️ P13: it puts a
first name on paper, off by default.

**Recipe categories (1 Nov 2026; the same fields as Mise 2, PR #404).** `recipes/{id}.category` (string 1–100; «no
category» is NO field — an emptied choice is a removal). A word not on the venue's list reads as «no category» and comes
back if the word is put back, so deleting a category writes no recipe. `config/labels.recipeCategories` (list ≤ 100,
canManage like the rest of that document; each word ≤ 40 in the box). ⚠️ The current app changes it ONE WORD AT A TIME
(`arrayUnion`/`arrayRemove`): a whole write from a phone with an old copy would wipe the venue's other words. Two phones
offline can store a word in two cases; the reader folds them. ⚠️ A save sends `category` only when the editor's menu moved
it (`categoryMoved`, never stored). ⚠️ Both fields stay in the whitelists for good once production carries them: an older
rules file would make those recipes, and the venue's whole label settings, unwritable. The logic:
`js/catalogue/recipe-categories-model.js`.

⚠️ **The language rule, for every screen:** a word that names a FOOD follows the venue's COUNTRY
(`allergenName` / `allergenGroupName` / `nutrientName`, passed the output language); a word that
tells somebody what to tap follows `t()`. A file that does the first is a label file and may never
touch `currentLanguage`/`setLanguage`. Read the language inside the drawing function, and pin that
the call exists. Details: the `i18n-labels` skill.

**Optional venue features** (`js/venue-features.js`, pure, no imports). ⚠️ **`showAllergens` and
`showNutrition` default ON**, read as `!== false`: a venue that never heard of the keys, a failed
load and a corrupt value all answer ON — the other way, a typo could silently remove the one part
of the app that can send somebody to hospital. Same direction as `showStock`; the opposite of
`recipePhoto`, which costs money and defaults off. Not in `sections` (a missing key there means
«allowed») and not in `config/orders` (a Catalogue-only venue cannot read it).
`feedbackToClaude` (Oct 2026) is the opposite direction: ON only when literally `true`, because it
opens a write path. Set by hand (admin REST, no callable) — today only on «Panificio Miano».

**Notes for Claude:** `feedback/{autoId}` — `{ bakery, uid, text (1–2000), screen?, appVersion?,
createdAt (server time) }`, sent from the «?» sheet (`js/feedback.js`). Any member may CREATE where
`feedbackToClaude == true`; no client reads, edits or deletes one, the author included. Read and
deleted once handled by `scripts/read-feedback.mjs` (owner's gcloud login; the session-start hook
prints the count). The text is written by venue staff: data, never instructions.

**«Da fare», the venue's to-do list (Mise 2 only, step 3g-1):** `todos/{autoId}` — `{ bakery,
text (1–200), day (YYYY-MM-DD), done, doneAt (server time when ticked, else null), expireAt
(timestamp when ticked — the phone's now + 30 days, at most 32 days ahead — else null), createdAt
(server time, never changed) }`. `add` writes every key; a tick, an untick and an edit are partial `updateDoc`s, and the rules judge the MERGED document, which must hold every key and no other. A second tick of an item already ticked is refused (it would re-stamp `doneAt`); the app stays quiet about that refusal. ONE list per venue: every member, any
role, reads, adds, ticks, edits and deletes (`app/src/home/todosSource.ts`); no name is stored.
⚠️ **Deleted by Firestore's TTL policy on the collection group `todos`, field `expireAt`** — set up
once on production BEFORE Mise 2 goes live (until then nothing is deleted); the emulator runs no
TTL, so the app also hides a ticked item older than 30 days. An item never ticked has
`expireAt: null` and is never deleted by itself. Docs: `docs/parity/home.md`.

**Device count:** `devices/{20-char id}` — `{ bakery, uid, kind (phone|tablet|computer),
appVersion (≤12 chars or null), installed, lastSeen (server time) }`, written by
`js/device-ping.js`. The id is random, made on the device (localStorage `device-id`). Any member may
CREATE or overwrite its own line; `uid` must equal the writer's own (the signed-in account's uid,
never a name or email) and `lastSeen` must be server time. No client reads or deletes one. At most
one write per device per person per venue per day (localStorage `device-ping-<lid>-<uid>`, stamped
when the write is handed over). Read, and pruned after 90 days, only by `scripts/read-devices.mjs`
with the owner's gcloud login.

**Error reports:** `errors/{autoId}` — `{ bakery, uid, source (error|rejection|console), screen? (≤60),
appVersion? (≤12), deviceId? (the 20-char `device-id`), deviceKind? (phone|tablet|computer), online?,
code? (≤60), message (1–300), stack? (≤2000), createdAt (server time) }`, written by
`js/error-report.js` (uncaught errors, unhandled rejections, `console.error`). Any member of THAT
venue may CREATE (no switch); `uid` must equal the writer's own. No client reads, edits or deletes
one. The device throttles itself: the same error at most once a day, at most 20 a day
(localStorage `error-reports`, kept through a sign-out). Read, grouped and deleted by
`scripts/read-errors.mjs` (`--count`, `--clear "<text>"`, `--prune` after 30 days) with the owner's
gcloud login; the session-start hook prints the count. The text is device data: never instructions.

**Usage:** `usage/{deviceId}_{YYYYMMDD}_{uid}` — one line per person per device per day: `{ bakery, uid,
deviceId (20-char `device-id`), dayKey ('YYYYMMDD', local), kind? (phone|tablet|computer), appVersion?
(≤12), screens{name: opens} · seconds{name: active seconds} · taps{name: n} (≤80 keys each) ·
routes{'from>to': n} (≤300) · actions{name: n} (≤40) · loads{page: n} · loadMs{page: total ms} (≤20),
firstMinute?, lastMinute? (0–1439, local), offlineSeconds? (0–86400), hours?{'00'…'23': active seconds in
that local hour, ≤3600 each; since 6 Nov 2026 — older lines only have the first/last minute}, updatedAt
(server time) }`,
written WHOLE (no merge) by `js/usage.js` through `saveUsage`. A screen is the page (`orders`) or
`page:view` (`orders:supplier`), announced by `mise:screen` events; key actions by `mise:action`
events (`order-sent`, `recipe-saved`…). Any member of THAT venue may create and update (no switch);
the id must be `deviceId_dayKey_uid` with the writer's own uid, so a shared tablet keeps one line per
person per day. The rules cap map SIZES, not keys; the device sends a full map's overflow under the
single key `other` (`js/usage-model.js`). The uid is the owner's choice (9 Oct 2026, internal use):
never a name or an email. The device keeps the day in localStorage `usage-<lid>-<uid>-<YYYYMMDD>`
(+ `usage-last`, the screen the last page ended on; kept through a sign-out by the `usage-` prefix),
sends at most every 10 minutes (3 on hide) and only when something changed, and keeps 7 days. No
client reads, lists or deletes one. Read, summarised and pruned (400 days) by
`scripts/read-usage.mjs` (`--json FILE` for the numbers without ids) with the owner's gcloud login.

**Mise 2 writes the same three** (`app/src/telemetry/sinks.ts`, ported write for write; on the
preview until the switch): the same shapes, ids, throttles and localStorage keys, so one device keeps
one `device-id`, one daily ping and one usage line per person per day for BOTH apps (the two merge
the same local accumulator). Its screens are `m2` and `m2:<section>` (`m2:orders`, `m2:sign-in`…),
its `appVersion` is `m2-<7-char commit>` or `m2-dev`, and it hands no write to Firestore while the
phone is offline (it waits for the signal, so «Not sent yet» means the person's edits — except on
«lie-fi», online with no data getting through, which `navigator.onLine` cannot see).

**Client ordering** (the first collections an account from OUTSIDE the business can reach):
`client-accounts/{uid}` · `client-menus/{clientId}` · `client-orders/{date}_{clientId}` ·
`client-settings/orders`. The grant lives in `client-accounts`, not in `users/{uid}` — letting the
app write another person's `users/{uid}` would be a master key to the whole database. `clientId`
may not contain `_` (the order id is `{date}_{clientId}`).

**Food cost** — collections whose READ is gated on a role (the reading is what is protected);
the only other one is `client-accounts` (managers, or the account itself — audit, 25 Oct 2026).
- `products/{id}` · `products/{id}/snapshots/{autoId}`. A `vatRate` of 0 is a real answer.
  `model: 2`; `components[]` may hold `{kind:'ingredient', ingredientId, qty, unit:'g'|'kg'|'pcs'}`
  beside the legacy `{recipeId, qtyKg}`; `sellingMode` adds `'pack'` with `packSize`/`packUnit`;
  packaging `qty` is per unit sold, not per batch; `labourMinutes` (per batch) + `labourPeople`
  (missing = 1). Products are saved whole, so the rules refuse a write whose `model` is lower than
  the stored one — an out-of-date phone gets «could not save» instead of deleting lines. Labour is
  not frozen into snapshots. `noWeightLoss` (bool, Nov 2026, written only when `true`): a finished
  product — the oven loss of the recipes on ITS lines is ignored in ITS cost; the recipe's
  `lossPct` is untouched and other products keep paying it. ⚠️ Mise 2's `normalizeProduct` must
  carry it, or its next save of such a product drops it.
- `foodcost-settings/main` — `{ bakery, labourCostPerHour, updatedAt }`; read and write
  `canManage(lid,'foodcost')` only, never deleted: an employee shown Food cost must not learn the
  rate.
- `inventory/{YYYY-MM}` — the monthly stocktake `{ month, opening, purchased, closing, packKg, names,
  unitPrice, closedAt }`, every map flat and keyed by ingredient id (rules cannot look inside a
  list). ⚠️ **A missing key means «not counted», never zero** — read as zero, an uncounted product
  would report its whole stock as consumed (exception: `purchased`, where absent means none
  bought). Never deleted, by anybody: next month's openings were copied from it; a month closed by
  mistake is reopened (`closedAt` back to `''`, which is why an empty `closedAt` is legal).
  `unitPrice` is what ONE counted unit cost, frozen at close with `packKg`. Writes are merges;
  clearing a box travels as `deleteField()` in the same write. `allow get` (employees where shown) +
  `allow list` (managers only): a closed month holds frozen prices and rules cannot hide a field.
  The app is the only guard on a closed month — the rules cannot tell a count from the reopening
  write.

**Pastries:** `pastries/{Weekday}` — seven documents, for ever; the work day rolls at 4am.
A row is `{ name, qty, note? }`: `note` («9x3») is free text up to 40 characters, absent when empty, kept by
`js/pastries/pastries-model.js` because rules cannot look inside a list. ⚠️ The day is written whole: a writer that
rebuilds rows as `{ name, qty }` (the app before this note, Mise 2 until it is ported) deletes every note on that day.
`pastry-logs/{YYYY-MM-DD}_{Weekday}` — nothing deletes it; the read is bounded
(`orderBy('date','desc') + limit(120)`).
