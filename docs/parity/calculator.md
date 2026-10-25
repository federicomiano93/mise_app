# Parity list — Calculator

What Mise 2's Calculator must do because the current app does it. Built from `calculator.html`,
`js/app.js`, `js/calc.js`, `js/calc-fullscreen.js`, `js/calculator-*.js` (config, config-store,
dough-math, recipe-source, catalogue-link, recipe-text, order-text, order-prefill, render, settings,
whatsapp-settings, client-orders, confirm, icons), `js/recipes.js`, `js/log*.js`, `js/whatsapp.js`,
`js/confirm-flow.js`, `js/result-place.js`, `js/send-sheet.js`, `js/share.js`, `js/zoom-steps.js`,
`js/hold-to-zoom.js`, the client-ordering modules it hosts (`js/client-order-model.js`,
`js/client-order-history.js`, `js/client-orders-data.js`), `tests/calc*.test.mjs`,
`tests/calculator-*.test.mjs`, `tests/dough-math.test.mjs`, `tests/dynamic-recipes.test.mjs`,
`tests/unified-scaler.test.mjs`, `tests/config-reconcile.test.mjs`, `tests/header-save-*.test.mjs`,
`tests/log-*.test.mjs`, `tests/order-prefill.test.mjs`, `tests/client-order-*.test.mjs`,
`tests/model-ceiling.test.mjs`, `firestore.rules` (`config/{doc}`, `logs`, `client-accounts`,
`client-menus`, `client-orders`, `client-settings`), the data model, the smoke test and the code
comments' own history (13 Aug 2026: the empty default config; 14 Aug: recipes linked to the
Catalogue; 4 Oct: trays logics, the Recipes accordion, `configModel`; 5 Oct: `askDoughDay`, the
full-screen recipe). Each line is a requirement; the ones marked **spec** are pinned by a current
test (a port runs that test against both files). Nothing in this list is decided for Mise 2 — the
things that need a decision are in «Questions for the main session», and a proposed split into
steps is at the end.

## Who sees it, who may do what

1. **Gated on the Calculator section and its card** (`body data-section="calculator"
   data-card="calculator"`): any member of a venue whose `sections.calculator` is on, employees
   included, unless the owner hid the card (`staffHiddenCards.calculator`). Home pushes for this card
   are `employeePush`. The rules decide every read and write (`canUse(lid, 'calculator')`).
2. **Employees do the whole job**: they confirm doughs, edit clients, products and recipes, change the
   switches and the WhatsApp lists. `config/calculator` is deliberately writable by any member of the
   section (`firestore.rules` `config/{doc}`: `member(lid) && sectionOn(lid, 'calculator')`, while
   `config/orders` needs `canManage`). Tightening it would show as a bare permission error.
3. **Minting or revoking a client's ordering link is `canManage` only** (owner and manager, not just
   owner): `client-accounts` create/update/delete are `canManage(lid, 'calculator')`. For anybody
   else the Clients editor says «this client cannot order» instead of drawing a button the database
   would refuse (`calculator-settings.js` `orderingLinkField`).
4. **Who is looking is read before those buttons are drawn** (`currentSession().canManage`): until the
   session answers, the make/revoke buttons are absent.
5. **A venue switch wipes the Calculator's local copies** (none of its keys is in `KEEP_PREFIXES`);
   a refused or never-answered load must never leave one venue's address book on screen in another.

## Data — `config/calculator`

6. **One document, `locations/{lid}/config/calculator`**, written WHOLE inside a transaction
   (`saveCalculatorConfig`, `js/firebase.js:1119`): `{ ...config, recipes, configRev, configModel:
   CONFIG_MODEL, bakery }`. `bakery` is the open venue's id, stamped by the data layer.
7. **The rules' closed key list**: `bakery, configRev, clients, recipes, ingredients, configModel,
   showClientOrdersButton, askDoughDay, whatsappLists, whatsappClients, extraDough, divisorIncluded,
   logVisibility, logRetentionHours, logRetentionByDough, orderPrefillWindow` (plus the Orders keys that
   share the block and the retired `products, groups, focaccia, brioche, sourdough, market`). Limits:
   `clients` ≤ 200, `recipes` ≤ 200, `ingredients` ≤ 1000. **Never write another key.** (`config/labels`
   is NOT reachable through this block: `doc != 'labels'`.)
8. **`configModel` is always this build's own number, never `max(stored, own)`**: `CONFIG_MODEL = 4`
   (`js/calculator-config.js:65`). The rules refuse a lower number than the stored one and a number
   above 4, so a release that raises it cannot be rolled back by a revert. 1 = before the field, 2 =
   `showClientOrdersButton`, 3 = trays logics + `trayWeight`, 4 = `askDoughDay`. **spec**
   (`calculator-recipes-accordion.test.mjs`, `calculator-trays.test.mjs`, `model-ceiling.test.mjs`)
9. **`configModel`, `showClientOrdersButton` and `askDoughDay` stay in the whitelist for good** —
   production documents carry them; removing one makes every affected document unwritable. Same for the
   retired keys above.
10. **The optimistic-concurrency revision**: `configRev` is kept across load/edit/save; on write, if the
    server's revision differs from the one the config was loaded with, every `cat-*` recipe the server has
    and the config lacks is preserved (a Catalogue import that landed meanwhile); the next revision is
    always server + 1. A normal recipe delete is untouched when nobody else wrote. **spec**
    (`config-reconcile.test.mjs`)
11. **Reading is forgiving and never throws** (`normalizeConfig`). Missing or junk input → the empty
    default; rebuilt from a FIXED key list; every name trimmed BEFORE the fallback (`Product`, `Client`,
    `Recipe`, `Ingredient`, `Order`); duplicate ids dropped (first wins); a product whose recipe no longer
    exists is re-homed onto the first recipe, never lost. **spec** (`calculator-config.test.mjs`)
12. **The default config is EMPTY** (`clients: [], recipes: []`, 13 Aug 2026): no venue's recipes are ever
    shown as sample data. The switches' defaults are not business data and stay: `logRetentionHours` 24,
    `orderPrefillWindow` `'both'`, `showClientOrdersButton` true, `askDoughDay` true. **spec**
    (`calculator-empty-state.test.mjs`)
13. **Three older shapes still load**: per-tab `{focaccia, brioche, sourdough, market}`, and the shared
    catalogue shape (top-level `products[]` + `clients[].items[]`, checked FIRST because those documents
    also carry a stale `clients[].products`). A current document is read by `clients[].products`. The id of
    a migrated product is preserved even when two clients share it (divisor ticks, WhatsApp lists, saved
    log rows and typed quantities all key by it). **spec** (`calculator-config.test.mjs`)
14. **A client** is `{ id, name, products[] }`; **a product** belongs to the client that orders it:
    `{ id, name, recipeId, weight, kind, crate, active }`. Weight is clamped 1…5000 g (`clampWeight`,
    non-numeric → 1). `kind` is `number` | `dropdown` | `kg`; the retired `ciabatta` → `dropdown` and
    `panini` → `number`, anything else → `number`; the old field name `dough` is read as `recipeId`.
    `crate` is `{ show, perBox }` with `perBox` clamped 1…1000, default 20. **`active` missing means
    ACTIVE** (a default of paused would empty every tab at once). **spec**
15. **A paused product leaves the calculator entirely** — no row, no dough, no divisor, no log. One
    place decides it (`getTabProducts`); every consumer builds its rows from there. Saving the Clients
    editor removes the typed quantity (`qty-…`) of every paused product, or it would reappear inside a real
    dough the day the product is switched back on.
16. **A recipe** is `{ id, name, logic, ingredients[{key,label,grams}], trayWeight, leaveningKey,
    leaveningDefaultPct, showLeavening, baselinePct, order, visible, catalogueId?, leaveningRid? }`.
    `logic` is one of `orders | total | both | trays | traysTotal` (unknown → `orders`); ingredient keys are
    unique inside the recipe (a clash gets `-<index>`), made from the label when missing; `visible` missing
    = shown; `showLeavening` missing = shown; `baselinePct` falls back to the default % when a leavening is
    designated. **`trayWeight` is kept on every recipe whatever the logic**, so switching away and back
    loses nothing. **spec** (`dynamic-recipes.test.mjs`, `calculator-trays.test.mjs`)
17. **`catalogueId` and `leaveningRid` survive the normaliser**, which runs on every save, on the live
    stream and on the cached copy (it once dropped them: found 4 Oct 2026). **spec**
    (`calculator-link-persists.test.mjs`)
18. **No recipes is a real answer**: an empty list stays empty. It is never refilled with sample recipes.
19. **Per-recipe maps** (`extraDough`, `logVisibility`, `logRetentionByDough`, `divisorIncluded`) are
    rebuilt with an entry for EVERY recipe id: extra dough and log visibility default to shown unless
    literally `false`; log retention is 24 or 48 hours (anything else → the legacy global, then 24);
    `divisorIncluded` holds product ids pruned to ones that still exist in that recipe. **spec**
20. **The ingredient-name registry** (`ingredients[]`) is every saved name plus every label a recipe uses,
    de-duplicated case-insensitively; it feeds the autocomplete in the recipe editor.
21. **WhatsApp data**: `whatsappLists[] = { id, title, clients[{ clientId, products[], extras[] }] }` and
    `whatsappClients[] = { id, name, products[], extras[] }`. References to a deleted client or product
    are pruned on read; a direct client with no name, no product and no free line is dropped. **Free lines**
    (`extras[] = { id, name }`, at most 50 per entry, id prefixed `wx-` and made unique inside the entry)
    exist only in the message — they can never reach the dough, never be pruned, and the order form always
    leaves them at 0. **spec** (`calculator-config.test.mjs`)
22. **`orderPrefillWindow`** is `both | yesterday | today`; an unknown value reads as `both` (the widest
    window, so a corrupt setting never hides a day's work).
23. **`showClientOrdersButton` and `askDoughDay` read as ON unless a literal `false`** (a typo must never
    remove the only door to the clients' orders, or the day question). **spec**
    (`calculator-recipes-accordion.test.mjs`)

## Data — dough logs (`logs`)

24. **Each confirmed dough is its own document**, `locations/{lid}/logs/{id}`, id `log-<uuid>` (fallback
    `log-<time36>-<random>`): `{ id, bakery, dough, recipeId, forDay, origin, createdAtMs, versions[] }`.
    The rules refuse any other key; `dough` ≤ 200 chars; `forDay` `today | tomorrow`; `origin`
    `calculator | manual`; `createdAtMs` a number; **`versions` ≤ 100** (a document dies at 1 MB; at the
    cap every further write is refused, so the screen must say so rather than fail silently).
25. **The chain is append-only**: an edit appends a version, a restore appends a COPY of an old one
    tagged `kind: 'restore'` with `restoredFrom` and fresh author/time; nothing is ever truncated. A version
    is `{ calculatedBy, at{date,time}, kind: create|edit|restore, items[], occasional[], sheet, text,
    recipe }`. **spec** (`log-model.test.mjs`)
26. **`bakery` is the real venue id**, stamped by the data layer. `createLog` writes `bakery: 'main'` and
    `saveLogDoc` overwrites it — Mise 2 must stamp it itself and never rely on that placeholder (known
    trap, `log-model.js`).
27. **Logs are watched for the last 30 days only** (`where('createdAtMs','>=', now − 30 d)`,
    `js/firebase.js:956`, single-field range, no composite index): unbounded it would re-read the whole
    history on every opening (P14). Documents without `createdAtMs` are excluded and are already invisible.
28. **The old `log/{dough}` collection is read once to migrate**: if `logs` has no document (a `limit(1)`
    read), the old records become single-version logs marked `legacy: true` with their text kept verbatim;
    guarded by `logs-migrated-v1` in localStorage and idempotent. A legacy log shows its saved text only.
    **spec** (`log-model.test.mjs`)
29. **A log keeps what it was made with**: each version carries `recipe` (a frozen snapshot — name, logic,
    ingredients, leavening key/default/baseline, and `trayWeight` for a trays recipe only) and the sheet
    stores `trays` and `trayWeight_g`. Editing a log uses THAT recipe, never today's; a log with no
    snapshot falls back to the current recipe so it stays editable. **spec**
    (`log-edit-rows.test.mjs`, `calculator-trays.test.mjs`)
30. **A saved log can gain a row but never lose or rewrite one** (`editRows`): the saved lines come
    first, verbatim; the products that exist today and were not in it follow at quantity 0; a deleted
    product's line stays. **spec** (`log-edit-rows.test.mjs`)

## Data — local copies the current app shares (same origin, same keys, same shapes)

31. **`calculator-config`** — the normalised config as JSON, painted before the network answers; written on
    every snapshot and every local save. **`logs-cache`** — the array of log documents. **`logs-migrated-v1`**
    — `'1'`. Both app versions read each other's copy, so the shapes must match exactly. (`whats-new-boot.js`
    also uses `calculator-config` and `logs-cache` as «this app has been used on this device» footprints, so
    something must keep writing them.)
32. **Per recipe, one key each** (`<rid>` is the recipe id; `<qtyId>` is `<clientId>::<productId>`):
    `qty-<qtyId>` (the typed quantity, as the box shows it), `param-<rid>` (leavening %), `total-<rid>`
    (typed total, g), `trays-<rid>`, `extra-<rid>`, `extra-unit-<rid>` (`g`|`kg`), `touched-<rid>`
    (`Date.now()` as text), `revealed-<rid>` (`'1'`), `lock-<rid>` (`{"locked":bool,"logId":string|null}`).
    The `::` separator cannot occur in generated ids. **`touched-` is written in exactly the places the tab
    persists something** — written anywhere else, a used tab is wiped as if untouched, written nowhere, a
    stale tab survives.
33. **`mise.calcZoomStep`** — a single digit `0`–`5`, the full-screen recipe's text size on this device.
    Corrupt or out of range reads as the default (step 1), never an extreme. **spec**
    (`calculator-work-view.test.mjs` S5)
34. **Forgetting a tab's state is one function** used by both «Reset all fields» and the new-work-day
    sweep: revealed, lock, every quantity, param, total, trays, extra, extra-unit, touched. **The lock
    MUST go with the numbers**: otherwise tomorrow's first Confirm would UPDATE yesterday's log with today's
    dough.

## The screen and its parts

35. **Tabs from the config**: the visible recipes (`visible !== false`), in `order`, at most 4
    (`MAX_VISIBLE_RECIPES`). **Two or more** are tab buttons; **exactly one** is drawn as a plain title (an
    `h2`, no button, nothing to focus) because a lone tab would switch to the screen you are on. The tab bar
    scrolls away with the page. **spec** (`calculator-work-view.test.mjs` S4)
36. **Three states of an empty Calculator, three sentences** (`calculatorEmptyReason`): `loading` (no
    visible recipe and the server has not answered — NO button, so nobody writes a recipe that exists),
    `no-recipes` («add a recipe», opens the recipe editor), `hidden-recipes` («choose which to show»). A
    visible recipe wins even before the server answers. The tone is neutral (the dashed empty-state card),
    never a warning. **spec** (`calculator-empty-state.test.mjs`)
37. **The server's answer includes «there is no document»**: the first snapshot notifies the screen even
    when the document does not exist, or a brand-new venue would sit on «Loading» for ever. A later null
    does not re-render. (the guarded callback is pinned by `store-notify-guarded.test.mjs`)
38. **A recipe panel is laid out by its logic**: `orders` → leavening knob (if shown), Orders cards, Extra
    dough, Confirm/Edit, result; `total` → «Total dough (g)»; `both` → knob, Orders, total, extra; `trays` →
    «Number of trays» with a live «= N g»; `traysTotal` → trays and total. The boxes of the param rows
    (leavening, trays, total) end on the same right edge — no unit span after them. **spec**
    (`calculator-work-view.test.mjs` S3)
39. **Orders cards**: one card per client, in address-book order, with a row per product — the name and
    `(<weight>g)` on the left, the quantity and `pz` (or `kg`) on the right; a `kg` row shows no weight. The
    same product ordered by two clients is two independent boxes. With no products on a recipe, a quiet hint
    («no products in this tab») stands in place of the cards — true for no clients, no products on this
    recipe, or all paused.
40. **Quantity widgets**: `number` → numeric input (`inputmode` numeric, min 0); `kg` → decimal input, step
    0.5; `dropdown` → a select of 0, 20, 40, 60, 80, 100. Tapping a `0` or an empty box clears it; a box
    left empty or non-numeric goes back to `0` and recalculates; a non-zero value is selected on focus.
41. **The leavening knob** shows only for `orders`/`both` recipes that designate a leavening AND have
    `showLeavening` on; its label is the leavening ingredient's own name. Its range follows the default %:
    ≥ 5 → 5…40 step 1; ≥ 1 → 0.1…6 step 0.1; else 0.1…3 step 0.05. A trays or total recipe never shows it,
    whatever the flag. The knob is saved per phone (`param-<rid>`) — without that, a reload rebuilds the
    panel at the recipe's default % while the quantities survive, and the sheet shows less yeast than the
    one that was confirmed. An empty knob on blur restores the recipe's default. **spec**
    (`calculator-trays.test.mjs`)
42. **Extra dough** (orders/both only): a free amount in `g` or `kg` (kg is the default unit) added on top;
    negative or non-numeric → 0, capped at 500 kg (`EXTRA_MAX_G`). It can be switched off per recipe
    (Settings → Extra dough). **spec**
43. **Trays** are WHOLE trays, 0…10 000. On `change` a fraction is replaced in the box by the whole number
    the maths used (the box says what was computed); while typing an empty box is left alone. «= 5,000 g»
    sits BESIDE the label (linked with `aria-describedby`, polite live), not inside it, so the field's name
    never changes. **spec** (`calculator-trays.test.mjs`)
44. **Tray weight**: whole grams, 50…100 000, default 1000; a stored value under 50 reads as 1000 (never
    «1 g per tray» — a typed 1.2 was almost surely kilos). The recipe editor refuses an empty or too-light
    weight on Save. **spec**
45. **The target (raw grams) by logic** (`computeRecipeTarget`): `orders` Σ qty×weight + extra; `total` the
    typed total only; `both` Σ + typed + extra; `trays` trays × tray weight; `traysTotal` that + typed. Every
    input is coerced — never NaN, never negative. **spec** (`calculator-config.test.mjs`,
    `calculator-trays.test.mjs`)
46. **Nothing to make hides the result** (target ≤ 0): the result card is hidden and Confirm/Edit follow
    `ready`. Confirm shows when the target > 0 and the tab is unlocked; Edit when > 0 and locked; neither
    otherwise.
47. **The scaling** (`scaleRecipe`): with a designated leavening and a baseline %, the leavening is brought
    to its share for the chosen %, then the whole recipe is scaled to the target; otherwise pure pro-rata.
    **The rounded integers always sum EXACTLY to `Math.round(target)`**: the ±1–2 g residue goes to the
    largest ingredient. `total` and trays recipes neutralise the leavening. **spec** (`dough-math.test.mjs`,
    `unified-scaler.test.mjs`, `dynamic-recipes.test.mjs`)
48. **A tab that cannot be calculated refuses, it never bakes nothing**: a linked recipe that is missing
    (deleted, or not loaded), empty, or has a row that is a pinch, a piece or to taste (`unweighable`, which
    NAMES the row) shows no number and says why. There is no fallback to the tab's own leftover ingredients.
    «Still loading» and «gone» are different sentences (`null` is stored as a real answer). **spec**
    (`calculator-recipe-source.test.mjs`)
49. **Recipe source** (`resolveRecipe`): an unlinked tab uses its own ingredients; a linked tab uses the
    Catalogue recipe's rows, keyed by the row's own `rid` (never the name, never the position) and weighable
    only if the unit is `g`/`gr`/`kg`/empty and the grams > 0; the leavening is `leaveningRid` matched
    against those keys. A linked recipe whose leavening row is gone still calculates, but the knob says so
    (`leaveningLost`). Every screen goes through `effectiveRecipe`, and **the dough is SAVED from what the
    screen shows** (`recipeToSave`/`sheetRecipe`), never from the leftover copy. **spec**
    (`calculator-recipe-source.test.mjs`, `log-linked-recipe.test.mjs`)
50. **Linked recipes are watched ONE BY ONE** (`watchCatalogueRecipe`, a listener per distinct
    `catalogueId`, stopped when nothing points at it any more) — never the whole collection (500+ reads per
    opening, P14). A failed listener answers `null`. The tabs repaint when one arrives.
51. **The result card**: header «Dough – <name>», a badge «<N> g raw», a full-screen button; one row per
    ingredient (`<name>` … `<round g> g`); a separator; «Total dough <N> g»; Copy and Send; the divisor box
    and the crate boxes. Ingredient grams are rounded integers.
52. **The divisor box** (display only, never touches the recipe or the log): the products ticked in
    Settings → Divisor, summed (qty × weight) over the clients that order them, ÷ a 0…4 select = grams per
    crate; hidden when nothing ticked has a quantity; `splitDough` never gives NaN or a negative. The
    select is NOT locked by Confirm (it is a display split, useful exactly after the dough is made). **spec**
53. **Crate boxes** (display only): per product with `crate.show` and a quantity > 0 — the crate count
    (`qty ÷ perBox`, one decimal), «crates» pluralised by the dictionary, and «<perBox × weight> g each box».
54. **Confirm / Edit lock**: Confirm saves the log (below), shows the result and locks every number box and
    select of the tab (except the divisor); Confirm becomes Edit. **Edit asks first**, then unlocks (keeping
    the link to the log), hides the result so it cannot change live, and drops `revealed`. The recipe sheet
    and the log are independent: the result stays visible AND editable after the first Confirm.
55. **Where the result sits follows whether it is shown**: confirmed → the FIRST thing in the panel (above
    the entries), by MOVING the node (keyboard and reading order = visual order, never CSS `order`); not
    shown → just before «Reset all fields». The first reveal scrolls to the top. The «fields cleared» note
    stays above the result. **spec** (`calculator-work-view.test.mjs` S4)
56. **Reset all fields** (confirmed, danger): every number box → 0, the knob → the recipe's default %, the
    selects → 0 / `kg`, and all of that tab's remembered state is forgotten (see 34).
57. **A new work day empties yesterday's numbers**: the day rolls at **4 am** (`workDayIndex`, built from
    Y/M/D parts so a clock change does not shift it). Tabs last used on an earlier work day are cleared
    BEFORE restoring on first paint, and again when the app comes back to the foreground
    (`visibilitychange`) — never while it is on screen. A quiet line «fields cleared, this is a new day» is
    shown ONLY for a tab that was actually cleared, for 12 s, and survives re-renders in that time.
58. **A config change from another phone rebuilds the screen**: tabs, panels, restores, recalculates; the
    active tab is kept if still valid, else the first recipe, else the empty panel — **never the Log with
    a blank tab bar**. A full-screen recipe open at that moment is CLOSED (it is a copy of the old grams).

## Confirming a dough (the log write)

59. **Confirm asks «today or tomorrow?» unless `askDoughDay` is a literal `false`**; off, it saves for today
    at once (the same save the Today button makes). The two paths are one pure function. **spec**
    (`calculator-work-view.test.mjs` S1)
60. **Create or update**: a tab confirms into the SAME log until Reset drops the link; if the linked log no
    longer exists (deleted), a new one is made (`confirmTarget`). An update appends an `edit` version and may
    move the log to the other day. **spec** (`log-confirm-link.test.mjs`)
61. **What is saved**: the sheet (`buildSheet`) built from the recipe the screen shows, the items (one line
    per client×product with qty, weight, kind, crate — zero lines included), the extra dough, the typed
    total, the trays, the leavening %, the divisor (included ids + the chosen n), the grouped text
    (`buildLogText`: client headers, `name: qty pz|kg`, «Extra dough»), the frozen recipe, and the time
    (`logTimestamp`: `{date: "Monday 09 June", time: "2:05 PM"}`, 12-hour with AM/PM, in English whatever
    the language). **spec** (`log-model.test.mjs`, `log-time.test.mjs`, `calculator-trays.test.mjs`)
62. **A sheet records**: `dough`, `recipeId`, `param` (the leavening % line, only for orders/both),
    `total_g`, `extra_g`, `typed_g` (total/both only), the ingredient grams, the divisor, the crates, and
    for trays `trays` + `trayWeight_g`. A bad tray count gives a zero dough, never NaN. **spec**
63. **Confirm refuses when the screen refuses**: a linked recipe that cannot be read raises the same
    sentence in a dialog and saves nothing — never a dough of zeros.
64. **Local-first**: the log is applied to memory and `logs-cache` at once, the tab is revealed and locked
    at once, and the write follows; a sync failure is logged and never undoes the local change or blocks
    the screen. (Contrast with the config: 66.)
65. **Usage record**: `mise:action` `dough-confirmed` on Confirm; screens announced as `mise:screen` `log`,
    `settings`, `log-history`, `''`.

## Saving the configuration

66. **A config save is local-first, but a refused write is taken back**: memory, cache and the screen change
    at once; if the write fails and nothing newer has replaced it, the local copy goes back to the server's
    and the person is told (`permission-denied` → «this device is out of date», anything else → «check your
    connection»). The screen keeps its edits and stays dirty so Save is available again. **spec**
    (`calculator-save-failure.test.mjs`)
67. **Nothing leaves the device before the server has answered once** (`serverAnswered`): until then a save
    is kept local and the person is told so in plain words. «There is no document» counts as an answer, so a
    brand-new venue can save its first client. Without this guard the empty/sample config would overwrite a
    venue's real address book after a failed load.
68. **Every caller goes through `saveConfigOrSay`** (resolves true when stored or kept local with its own
    explanation; false after saying why). A switch passes `onFail` to put itself back. **spec**
69. **Saving republishes the clients' ordering menus** only when some client's PUBLISHED product list would
    read differently (`menusWouldChange`); best-effort, and a failure never fails the config save. A save
    touching only recipes, WhatsApp lists or log settings costs no menu read. (`client-menus/{clientId}`.)
70. **A save in flight disables the header Save, ignores a second tap, and makes Back/Home wait**
    (`createSaveGuard`). Required fields are checked before the confirm: block, jump to and mark the empty one.
    **spec** (`header-save-calculator.test.mjs`)

## Settings

71. **The Settings hub** (footer): Clients, WhatsApp, Client ordering, Recipes, Extra dough, Divisor, Dough
    history; two venue-wide switches on it (the bottom-bar Orders button, and «ask which day»). Each row
    opens its own screen and Back returns to the hub. **spec** (smoke test; `header-save-calculator.test.mjs`)
72. **The two switches save on the tap** (no Save + confirm) with a «Saved ✓» tag for 2 s; a refused write
    puts the switch back and says why; no tag when the save stayed local. The Orders-footer button follows
    `showClientOrdersButton`; the banner announcing a new client order does NOT. **spec**
    (`calculator-recipes-accordion.test.mjs`, `calculator-work-view.test.mjs` S1)
73. **Clients editor**: a list (drag to reorder, long-press 200 ms on touch; the order is saved with the
    client list) → a client (name, delete icon, products, ordering link) → products. An empty address book
    shows one line saying what a client is FOR above Add and Save. A new item starts empty; leaving a new,
    empty client/recipe asks «discard this new …?». Working copy only; Save + confirm commits. Required:
    every client and product needs a name (the first invalid one is opened and marked). **spec**
    (`header-save-calculator.test.mjs`)
74. **A product card**: name, recipe (a select over the working recipes), weight (g), type (`number` |
    `dropdown`; a legacy `kg` product shows «kg» and no type/crate options), «crate box» toggle that reveals
    the pieces-per-crate box only when ticked, an Active toggle, and a small low-key delete icon alone at the
    bottom right; a paused product shows a «paused» tag. Pause instead of delete is the way to keep a
    product's settings.
75. **Ordering link** (per client, only when nothing is unsaved — otherwise «save your changes first»):
    create (→ `client-accounts/{uid}` with a `linkToken`, via `createOrderingLink`), copy, replace
    (confirmed, names the consequence), turn off (confirmed; `revokeOrderingLink`). The share text uses the
    VENUE's name (`currentSession().name`), never the product's. The clipboard write is raced against 2 s
    and, if the clock wins, the link is spelled out in a dialog. `clientId` may not contain `_`.
76. **Recipes editor**: the list is an accordion (one row open at a time, `aria-expanded`/`aria-controls`),
    each row showing «<logic> · N ingredients · shown|hidden». The open row holds a «how it calculates»
    select (five logics) with the sentence for the CHOSEN one under it, the tray-weight field (only for the
    two tray logics), a «show in the calculator» switch, and «Edit recipe». **spec**
    (`calculator-recipes-accordion.test.mjs`)
77. **At most 4 recipes shown**: turning a fifth ON alerts and the switch goes back OFF; adding a recipe
    when four are shown asks first and creates it hidden. A recipe still used by products cannot be deleted
    (the alert says how many); delete is confirmed. **spec**
78. **Recipe detail**: name, source (own ingredients | a Catalogue recipe), ingredient rows (name with
    autocomplete from the registry, grams with one decimal, remove), «add ingredient», and for orders/both
    ONE leavening box: which ingredient (a select whose first option is «nothing rises» — a real answer),
    the starting %, and «show the adjust knob». Every ingredient needs a name; at least one is required unless
    the recipe is linked. The percentage stays because it is the value every phone STARTS from (the knob is
    per phone). Typing an ingredient name updates the leavening select without a re-render (focus must not be
    lost). Back from a fresh empty recipe asks to discard it; the list returns focus to the row edited.
79. **Linking a recipe to the Catalogue**: the Catalogue's recipes are listed ONCE when the editor opens
    (never on boot); choosing one first stamps a stable row id on every Catalogue row
    (`stampRecipeRowIds`, a merge write of `ingredients` on `recipes/{id}`, idempotent via `withRowIds`),
    then sets `catalogueId` and clears `leaveningRid` (it must be chosen again); a failed stamp alerts and
    links nothing. A linked recipe's ingredients are READ-ONLY in the Calculator («edited in the Catalogue»).
    Unlinking deletes `catalogueId` and `leaveningRid` and leaves the tab with nothing, not a stale copy.
80. **Extra dough** and **Divisor** settings: Extra = one switch per recipe (working copy, Save, disabled
    until something changed); Divisor = pick a recipe, then tick its products (each ticked product splits
    across every client ordering it), «untick all», Save. **Log settings**: one card per recipe with the
    products named, a «keep logs visible» switch and a 24 h / 48 h select; display-only (logs are always kept).
81. **Leaving a Settings screen with unsaved edits asks** to discard (Discard/Cancel, async-awaited); a
    refused save leaves the screen as it was.

## Sharing and sending

82. **Copy the recipe** puts `buildRecipeText` on the clipboard: the title UPPERCASE + two spaces +
    `<total/1000, one decimal> kg`; a 22-hyphen separator; one line per ingredient, `(name + ':').padEnd(11)
    + grams.padStart(5) + ' g'`; `''` when there are no rows. The button reads «Copied» (or «Copy failed»)
    for 2 s. **The clipboard is raced against a 2 s clock** (a write can hang forever). **spec**
    (`calc-recipe-text.test.mjs`)
83. **Send the recipe (the arrow)** opens ONE sheet asking which road — WhatsApp or email — never names a
    brand on the button. WhatsApp = `wa.me/?text=<encoded>` with NO recipient; email = `mailto:?subject=…&body=…`
    (both encoded; it OPENS the mail app, it does not send, and the sheet says so). Both open with
    `noopener`; the sheet closes BEFORE the road is taken. An empty text never opens the sheet. The sheet is a
    modal dialog: Escape/backdrop/Cancel close it, Tab stays inside, focus returns. **spec**
    (`one-send-arrow.test.mjs`)
84. **Full-screen recipe**: a CSS overlay (NOT the Fullscreen API, which iOS refuses), a labelled modal
    dialog showing only the rows and the total, large. Opened by the visible button, a tap on the ingredient
    list or on the total line — never by Copy/Send. Closes with ×, Escape and a re-render; not with the
    browser's Back (no overlay of this page pushes history). Focus moves in and returns to the opener (never
    to a detached node); Tab cycles ×, −, +; the page cannot scroll behind it. **spec**
    (`calculator-work-view.test.mjs` S5)
85. **Text size − / +** in the full-screen view: six steps (×0.8, 1, 1.2, 1.45, 1.75, 2.1), default step 1,
    `aria-disabled` (never `disabled`) at the ends, clamped, remembered per device; taps and keys on the pair
    never reach the view behind; works with a throwing storage. **spec** (`calculator-work-view.test.mjs` S5)

## Market orders (WhatsApp) and client orders

86. **The header send arrow** sends a market order: no lists and no direct clients → an alert; exactly one
    item → straight into its order form; otherwise a picker (lists first, then direct clients).
87. **The order form**: a section per client entry, a row per chosen product (and free line), numeric boxes
    named `wa-<entryIndex>-<productId>` (namespaced so they never collide with the Calculator's own boxes);
    focus clears a `0`, blur restores it. «Clear all» (confirmed, danger) zeroes ONLY these boxes, addressed
    by id, and sits beside the prefill note — not in the footer, where it would be a mis-tap from Send.
88. **The prefill** fills the form from the logs (`prefillFromLogs`): the NEWEST log in the window that names
    a (client, product) decides it — **a zero in the newest log is an answer** and stops the search; only
    values above zero are offered. Windows: `both` = today and yesterday, `today`, `yesterday` (yesterday
    ONLY). Work days (4 am), not midnight. A missing or unreadable clock offers nothing. **The sentence above
    the form names the window actually used, or says nothing was found** — it is the condition that makes
    auto-filling honest. **spec** (`order-prefill.test.mjs`)
89. **The message** (`buildOrderMessage`): `*<title>*\n\n` then, per section, `*<client>*\n` (only when
    `multi`) + `- <name>: <qty>` lines, sections joined by a blank line. A client with nothing above zero
    produces NO section. With more than one client holding quantities, a «who is this for» picker offers
    everything together (the list's title, client headings) or one client (that client's own name, no
    heading); with one, it goes straight to the road sheet; with none, «no orders to share». The modal closes
    before the road opens. **spec** (`calculator-order-text.test.mjs`)
90. **The WhatsApp lists editor** (Settings → WhatsApp): Level 0 lists and direct clients (delete applied
    at once, confirmed); Level 1 a list (name + a card per client; choose an address-book client to add);
    Level 2 a client's products and free lines; Level 3 add to the message (this client's own products, then
    everyone else's, then a box for a name in neither). Each item is saved from ITS OWN detail screen; the top
    has no Save and re-reads the saved config; products show by unique name. The prefill-window setting lives
    here.
91. **Client orders banner**: above the tabs, lit only for orders never used or CHANGED since they were used
    («N orders changed» is louder); it goes quiet when the job is done. A permanent door sits in the footer
    (Log · Orders · Settings — three buttons exactly; a fourth wrapped by 3 px once).
92. **Orders received screen**: «still coming» (soonest day first, then longest waiting) and «history»
    (15-day windows read on demand, never watched, capped at 200). A card shows the client (the LIVE name
    wins), the day («Tomorrow · Tuesday 11 August»), how long ago it arrived, a **late-arrival note** when
    it arrived after the cutoff (shown, never refused — the rules only keep a coarse floor), the lines (a
    product the client no longer has is marked missing), the client's note, and a button whose label differs
    for new / used / changed. **spec** (`client-order-model.test.mjs`, `client-order-history.test.mjs`)
93. **Putting an order into the calculator is inspect-then-apply and never silent**: products the order does
    not mention are set to ZERO (a leftover is a wrong number); a confirmed (locked) tab does not move and
    the dialog says so; any field already holding a different number is listed «old → new» in a danger
    confirm. Applied values are written to `qty-…`, the tab recalculates once and is stamped `touched`.
    Afterwards the order is marked applied (`appliedAt`/`appliedFor`); a failure to record it is REPORTED.
    **spec** (`client-order-model.test.mjs` `calculatorPatch`)
94. **Ordering deadline** (`client-settings/orders`, `{ bakery, cutoff, updatedAt }`): `HH:MM` 24-hour or
    `''` (no deadline, a real answer); a missing document reads as the default `16:00` on this side (the
    client page reads it the other way, on purpose). Saved with a confirm; an invalid time is refused.
95. **Client-ordering collections**: `client-menus/{clientId}` (written by the bakery, `canUse`; delete
    `canManage`), `client-accounts/{uid}` (`canManage`), `client-orders/{date}_{clientId}` (read, update,
    delete `canUse`; a client reads/writes only its own), `client-settings/orders` (`canUse`). The client
    page itself (`js/client-orders/`) is a separate app and not in this list.

## Language, money, accessibility

96. **Interface words follow the interface language** (`t()`), looked up when DRAWING, never at module
    level (a module-level `t()` froze the empty-state in the default language). Recipe, client, product and
    ingredient names are what people typed. The Calculator speaks whole sentences, never assembled
    fragments. **spec** (`calculator-whole-sentences.test.mjs`, `no-hardcoded-english.test.mjs`)
97. **The three day words** have two forms each (`day.today` / `day.today.inSentence`): a label that starts
    and one inside a phrase — never `.toLowerCase()`. The log badge names the day the dough was MADE and adds
    the day it is FOR when they differ («Yesterday for today»); its colour follows the day it is FOR
    (`dayLabel`, counted in work days, so a dough made at 23:30 and read at 00:30 is still «Today»). **spec** (`log-model.test.mjs`)
98. **Grams are grouped in the interface language** (`formatGrams`: «5,000» / «5.000»), including four-digit
    numbers that Italian `Intl` would not group by default. **spec** (`calculator-trays.test.mjs`)
99. **Accessibility**: every box has a real `<label>`; selects have `aria-label`s; switches are
    `role="switch"`; the destructive icon has a name; the tab/title distinction is real; focus returns to the
    row/head that was left; required fields are revealed and focused; confirm and alert dialogs are the app's
    (`confirmDialog`/`alertDialog`), never the browser's; icons are inline SVG, never emoji. Contrast:
    brand text on the tint ≥ 4.5:1; solid green is for ACTIONS only (Confirm, day buttons, header Save, −/+),
    selected states are a frame, never a solid fill. **spec** (`calculator-work-view.test.mjs` S6)

## The Dough history (log screens)

100. **The list** (footer «Log»): the visible logs, newest first (`createdAtMs`, then id), each card showing
     the dough, the day badge, the date and time, «by <name>» if set, `vN edited` when edited, and the order
     (grouped by client, zero lines omitted; a trays dough shows «5 trays × 1,000 g» and the grams typed on
     top; extra dough). A log older than its window, or of a recipe switched off, is HIDDEN (display only —
     never deleted). The empty state distinguishes «nothing saved yet» from «all hidden by the settings».
     **spec** (`log-visibility.test.mjs`)
101. **The retention window is counted from the END OF THE WORK DAY THE DOUGH IS FOR**, not from when it was
     written, plus 24 or 48 h (per recipe): a dough made at 09:00 for tomorrow must not vanish at 09:00
     tomorrow. The log is matched by `recipeId`, falling back to the dough name for migrated logs; a missing
     visibility key counts as visible. **spec**
102. **Open a log read-only** (tap the card): header, order, then the sheet rebuilt from the stored snapshot
     in the same classes as the live result card (ingredients, total, divisor with a static n, crates).
103. **Add a log by hand** (header «Add log»): choose a recipe (required), «today / tomorrow» (required —
     missing marks the buttons red with an alert line and scrolls to it), trays / typed total / quantities
     by the recipe's logic (every product at 0), confirm, Save → a NEW log with `origin: 'manual'`, the
     recipe's default leavening %, no extra. Only a manual log shows an **Edit** button on the list.
     `mise:action` `log-added`. **spec** (`calculator-trays.test.mjs`)
104. **Edit a manual log** (confirm first): a «calculated by» name (optional, trimmed), quantity rows from
     `editRows`, and for a trays dough the trays and (traysTotal) the grams typed on top, at the tray weight
     the dough was MADE with. Saving appends an `edit` version that keeps leavening %, extra, divisor n and the
     typed total of the previous version (`typedTotalOf` — `both` logs once lost it, silently lowering every
     ingredient) and recomputes the sheet with the frozen recipe. A calculator log is edited only from the
     Calculator (Edit → Confirm). `mise:action` `log-edited`. **spec** (`log-typed-total.test.mjs`)
105. **Version history**: every version newest first (`vN · created|edited|restored from vM · current`,
     author, time); open one read-only; **restore** (confirmed) appends a copy on top and never truncates.
     A log that vanished shows «log not found». **spec** (`log-model.test.mjs`)
106. **Delete a log** is a small trash icon, confirmed with the dough's name; the deletion is local-first
     (memory, cache, then the server).

## Offline, local-first and errors

107. **Everything paints from the local copies first** (`calculator-config`, `logs-cache`, the `qty-…` family)
     and works offline; the listeners then update them. A listener that never starts logs the reason and does
     NOT call the callback (calling it would count as the server's answer, see 67).
108. **A store's subscriber that throws never stops the data**: the callback is guarded
     (`guarded(...)`) — a failure in a redraw must not stop a recipe from being stored. **spec**
     (`store-notify-guarded.test.mjs`)
109. **A part that fails to draw never takes the page down** (P17): one bad recipe, product or log is skipped,
     never fatal.
110. **Reads per opening** are deliberately few: the config document, `logs` (30 days), one document per
     linked recipe, and the two client-order streams; the Catalogue list and past orders are read only on
     demand.

## Questions for the main session

- **Overlays vs addresses.** The current app opens every screen as an overlay on one page (recipe editor,
  Settings and its seven sub-screens, Log view/edit/add/history, orders received, ordering deadline, the
  WhatsApp lists editor, the order form, the pickers). Mise 2's other sections give each screen an address
  (`/food-cost/product/<id>` …). Which Calculator screens get an address (suggested: the tab/recipe
  `/calculator/<recipeId>`, `/calculator/log[/<id>[/history|/edit]]`, `/calculator/settings/<screen>`,
  `/calculator/orders`), and which stay dialogs (day picker, order form, pickers, full screen)? The
  `mise:screen` names for the usage record depend on it.
- **The footer bar** (Log · Orders · Settings, exactly three) and the header (Back, send arrow, Home) are the
  current phone chrome. On a tablet-first shell, do the Log, Orders and Settings become a side list/detail
  split as in Food cost (list left, detail right) or tabs inside the Calculator?
- **Tablet layout**: today a single centred 620 px column, with a confirmed tab keeping its greyed fields AND
  the result in one column (`calculator-tablet.test.mjs`). Mise 2 can show quantities left and the recipe
  right on a wide screen. Wanted? (Changes what the kitchen sees; the DOM-order rule in 55 still applies.)
- **Full screen**: keep the CSS overlay with − / + (a native `<dialog>` is the natural form), or also offer a
  real browser fullscreen where available? Keep `mise.calcZoomStep` as is (it shares the origin)?
- **Hold-to-zoom** (`js/hold-to-zoom.js`: two-finger magnifier on the whole `<body>`, up to 3×, springs back
  on release; it also turns the browser's pinch-zoom off on pages that load it, calculator included). Port it
  to the Mise 2 shell for all sections, only for the Calculator, or drop it for the browser's own pinch?
- **Kiosk.** Nothing in `js/kiosk*.js` is Calculator-specific, but a focused number box and any open
  `…-modal.visible` hold back the kiosk's reloads and rest. The Mise 2 shell's kiosk must treat the
  Calculator's boxes and dialogs as «busy», or a lab tablet will reload mid-typing. Decide when the kiosk is
  ported; no Calculator work needed beyond keeping boxes as ordinary inputs and dialogs as `.app-dialog-backdrop`/
  `dialog`.
- **Sortable.** The Clients list is reordered with vendored `sortable.esm.js` (200 ms long-press on touch).
  Mise 2 has no drag-and-drop yet: use a small maintained library (React Aria's drag-and-drop is already a
  dependency) or buttons to move up/down (P19: propose the proven approach, with a keyboard path)?
- **A hardcoded ingredient name.** `buildRecipeText` splits `Flour uniqua blue` onto two lines (a legacy
  layout for one venue's ingredient; pinned by `calc-recipe-text.test.mjs`). Port it as-is for byte-for-byte
  text parity, or drop it (it is business data in code)?
- **Moving a recipe to the Catalogue.** `calculator-recipe-source.js` imports `ridOf`/`withRowIds` from
  `js/catalogue/guided-model.js`, and linking writes into the Catalogue's `recipes/{id}`. Mise 2 has no
  Catalogue yet (step 3d). Should the Calculator step (a) port only those two helpers into `shared/`, or (b)
  ship with linking read-only (tabs already linked work; the link picker and the stamp come with 3d)? The
  `import-to-calculator.js` direction (Catalogue → Calculator `cat-*` recipes) belongs to 3d either way.
- **Unlinked recipes with their own ingredients**: the current app still lets a tab carry its own
  ingredients. Keep that in the editor, or make new recipes Catalogue-linked only (existing own-ingredient
  tabs still calculate)? This changes what the Recipes screen offers.
- **Legacy migration** (`readOldLogsOnce`, `logs-migrated-v1`): all the data is already migrated in
  production. Port it for parity (cost: one `limit(1)` read when the flag is absent) or leave it to the
  current app until the switch?
- **The `kg` product kind** is legacy (not creatable any more, still readable and drawn). Keep reading and
  drawing it, yes (data is in production), but is its row in the editor needed?
- **The 4-recipe limit** and the three-button footer exist because of phone widths. Keep the limit on a
  tablet-first app? It is part of the data rules the editor enforces (not the database).
- **Sending of the recipe and of an order** shares one road sheet with Orders (`send-sheet.js`). Does Mise 2
  build it once as a shared dialog in `app/src/ui/` now (Orders is not ported), and is `mailto:` still wanted?
- **The log's `bakery: 'main'` placeholder and the `Calculator` timestamp in English** (`logTimestamp` writes
  «Monday 09 June», «2:05 PM» into the document whatever the language): keep the stored text identical for
  parity (both apps read each other's logs), or store an ISO time and format on screen? The first is safer
  until the switch.
- **Who may delete a log**: any member of the section can (rules `canUse`). Keep, or restrict to
  owner/manager? That would be a rules change — a result-changing decision.

## Proposed slices

Step 3c is large (about 13 000 lines of code, 14 000 counting the client-ordering modules). Each sub-step
ends with something that works alone, on its own branch and PR. They reuse one another's pure modules, so the
order below matters. Everything goes through `backend.firestore()`; sections are lazy-loaded; local copies
use the existing keys, so the current app and Mise 2 keep working side by side.

**Already in `shared/src` (do not port again):** `sections` (incl. `calculator`), `home-cards`, `market`,
`currency`, `price-model`, `catalogue-model` (units, `isWeighableUnit`, `ingredientGrams`, loss weighings;
NOT the row-id helpers `ridOf`/`withRowIds` or the Calculator import functions), `recipe-cost-model`,
`ingredient-name`, `local-data` (`KEEP_PREFIXES`), `same-data`, `error-model`, `device-model`, `usage-model`,
`membership`, `location-id`, `pastries-model` (has its own `DAY_START_HOUR = 4` and a work-day function — the
Calculator's `workDayIndex` is NOT there), `pastries-log-model`, `pastries-lock`, `join-code`, `push-model`.
**Not there yet, to port:** `calculator-config` (pure part), `calculator-dough-math`,
`calculator-recipe-source`, `calculator-recipe-text`, `calculator-order-text`, `calculator-order-prefill`,
`confirm-flow`, `log-model`, `log-time`, `client-order-model`, `client-order-history`, `zoom-steps`,
`catalogue/guided-model` (`ridOf`, `withRowIds`). The `t()`-using functions (`orderPrefillLabel`,
`formatGrams`, `dayLabel`, `prefillNote`, `buildLogText`'s fallbacks) take the language/dictionary as an
argument, as the Food cost ports did.

### 3c-1 — The calculator itself (the work view)

**Slice A (done):** items 35–45, 46–53 and 55 (not-confirmed placement), 57 and 58 — the tabs, the empty
states, the entries by logic, the scaled recipe, divisor and crates, the new-work-day sweep.

**Slice B (done):** 54 and 55 (revealed, the lock, the recipe first once confirmed), 56 (Reset), 59–64
(Confirm, Edit, the version saved, the refusal, local-first), 65 (`dough-confirmed`; the screen names `log`,
`settings` and `log-history` come with their own steps), 82–85 (Copy, Send, full screen, text size). Not done
on purpose: the legacy log migration (stays in the current app), the empty states' buttons (3c-2).

- **Works alone**: open the Calculator, see the tabs from the existing config, type quantities / a total /
  trays, see the scaled result, divisor and crates, Confirm (day picker or straight), lock/Edit, Reset, the
  new-work-day sweep, full screen with text size, Copy and Send the recipe. Settings are read-only here
  (the empty-state button and the footer door lead to «set up in the current app» until 3c-2).
- **Source**: `js/app.js`, `calc.js`, `calc-fullscreen.js`, `calculator-render.js`, `result-place.js`,
  `confirm-flow.js`, `calculator-config.js` (read/normalise/target/divisor/crate/trays/empty reason),
  `calculator-config-store.js` (watch + cache + `serverAnswered`; the save half comes in 3c-2),
  `calculator-dough-math.js`, `calculator-recipe-source.js`, `calculator-catalogue-link.js`,
  `calculator-recipe-text.js`, `send-sheet.js`, `share.js`, `zoom-steps.js`, and from `log*.js` only the
  WRITE half Confirm needs (`log-model` `buildSheet`/`buildLogText`/`recipeSnapshot`/`createLog`/`addVersion`/
  `confirmTarget`/`setForDay`/`workDayIndex`, `log-time`, `log-store` create/append + `logs-cache`).
- **Tests to port (run against both)**: `dough-math`, `unified-scaler`, `dynamic-recipes`,
  `calculator-config` (normalise, targets, divisor, crate, free lines), `calculator-trays` (pure parts),
  `calculator-empty-state`, `calculator-recipe-source`, `calculator-link-persists`, `calc-recipe-text`,
  `log-confirm-link`, `log-linked-recipe`, `log-typed-total`, `log-model` (sheet/lifecycle),
  `log-time`, `calculator-work-view` (S1, S4, S5 behaviours), `model-ceiling`, `store-notify-guarded`;
  new Mise 2 specs for the tab state keys (32) and the work-day sweep (57).
- **Firestore**: read `config/calculator`; read `recipes/{id}` one by one (linked); create/update `logs/{id}`;
  read the last 30 days of `logs` (Confirm's «does my linked log still exist» needs it).
- **Shared ports**: calculator-config (pure), dough-math, recipe-source (+ `ridOf` from guided-model),
  recipe-text, confirm-flow, log-model (write half + `workDayIndex`), log-time, zoom-steps.
- **Size M.**

### 3c-2 — Settings and the editors (writing the configuration)

- **Works alone**: Settings hub with the two switches, Clients editor (products, crate, pause, reorder),
  Recipes editor (accordion, logics, tray weight, leavening box, Catalogue link picker), Extra dough,
  Divisor, Log settings; the save path with the transaction, `configRev` reconcile, `CONFIG_MODEL` and the
  failure sentences. The empty Calculator's «Add a recipe» now works.
- **Source**: `calculator-settings.js` (hub, Clients, Extra, Divisor — minus the ordering-link field),
  `recipes.js`, `log-settings.js`, `calculator-confirm.js`, `calculator-icons.js`, `save-guard.js`,
  `reveal-field.js`, the save half of `calculator-config-store.js`, `saveCalculatorConfig`/
  `getCatalogueRecipesOnce`/`stampRecipeRowIds` from `js/firebase.js`, vendored sortable (or its
  replacement, see Questions).
- **Tests**: `config-reconcile`, `calculator-save-failure`, `calculator-recipes-accordion`,
  `header-save-calculator`, `header-save-*`, `calculator-trays` (editor parts), `calculator-config`
  (editing helpers, `reconcileConfigWrite`, `saveFailureKey`), `model-ceiling`, `log-visibility`
  (settings half); `calculator-whole-sentences` (the strings of these screens).
- **Firestore**: write `config/calculator` (transaction, closed key list); read `recipes` once; merge-write
  `ingredients` on `recipes/{id}` (the stamp — the only write outside the Calculator's own collections).
- **Shared ports**: `reconcileConfigWrite`, `saveFailureKey`, `CONFIG_MODEL`, the editing-side constants
  (`WEIGHT_*`, `LOGICS`, `MAX_VISIBLE_RECIPES`, `*_TRAY_*`), `withRowIds`.
- **Size M.** (If 3d is not ready, ship the picker read-only per the Questions.)

### 3c-3 — The Dough history (the log screens)

- **Works alone**: the Log list with retention/visibility, read-only view, version history and restore,
  manual add, edit of a manual log, delete, and the legacy migration if kept.
- **Source**: `log.js` (list/card/view/delete), `log-view.js`, `log-add.js`, `log-edit.js`, `log-qty.js`,
  the rest of `log-model.js` (`filterVisibleLogs`, `dayLabel`, `sortLogs`, `editRows`, `typedTotalOf`,
  `traysEditState`, `traysSheetRecipe`, `restoreVersion`, `migrateOldLogs`), the delete/restore half of
  `log-store.js`.
- **Tests**: `log-model`, `log-visibility`, `log-edit-rows`, `log-typed-total`, `log-time`,
  `calculator-trays` (add/edit/«= N g»), the Log parts of `calculator-save-failure` («Dough history» word).
- **Firestore**: `logs` (read 30 days, create/update/delete); `log/{dough}` read once (legacy).
- **Shared ports**: the remaining `log-model` functions.
- **Size S–M.**

### 3c-4 — Market orders and client orders

- **Works alone**: the header send arrow and order form (WhatsApp lists, direct clients, free lines,
  prefill from the logs, who-is-this-for), the WhatsApp lists editor, the orders-received banner/screen/
  history, applying an order to the quantity fields, the deadline setting, and the ordering-link field in
  the Clients editor (+ republishing menus on save). Likely two PRs: **4a** market orders (`whatsapp.js`,
  `calculator-whatsapp-settings.js`, `calculator-order-text.js`, `calculator-order-prefill.js`;
  tests `calculator-order-text`, `order-prefill`, `one-send-arrow`, the WhatsApp parts of
  `calculator-config`) and **4b** client orders (`calculator-client-orders.js`, `client-orders-data.js`,
  `client-order-model.js`, `client-order-history.js`, the ordering-link field of `calculator-settings.js`;
  tests `client-order-model`, `client-order-history`).
- **Firestore**: `config/calculator` (lists), `logs` (read), `client-menus` (write), `client-accounts`
  (write, `canManage`), `client-orders` (watch upcoming, past on demand, update `appliedAt`/`appliedFor`),
  `client-settings/orders` (watch, write).
- **Shared ports**: `calculator-order-text`, `calculator-order-prefill`, `client-order-model`,
  `client-order-history`.
- **Size M (L if 4a and 4b are one PR — keep them apart).**

## Decisions taken for the night run (12 Oct 2026, nobody awake — each the recommended option)

- **Step 3c is split into four stacked sub-steps**, one PR each, in the order above: 3c-1 the work view
  (`feature/mise2-calculator`), 3c-2 Settings and editors, 3c-3 the Dough history, 3c-4 orders (4a/4b).
- **Addresses**: the work view is `/calculator`, a tab is `/calculator/<recipeId>` (Back and a shared
  link land on the same tab); Log, Orders and Settings get their own addresses in their sub-steps; the
  day picker, the full screen and the pickers stay dialogs.
- **Tablet (≥1000px)**: quantities on the left, the scaled recipe on the right (the section split every
  other Mise 2 section uses); a phone keeps one column with the result after the boxes.
- **Full screen**: a native dialog with − / +, the text size kept in `mise.calcZoomStep` (shared key).
- **Hold-to-zoom is not ported**: the browser's own pinch-zoom stays on in Mise 2.
- **Kiosk «busy»** is decided when the kiosk is ported (3g); boxes stay ordinary inputs, dialogs native.
- **`Flour uniqua blue` is not special-cased**: it is one venue's data in code (global rule: no business
  data hardcoded); the line is written like every other ingredient.
- **Catalogue linking**: in 3c-1 linked tabs calculate from their catalogue recipe (read-only); the link
  picker and the row-id stamp come with 3c-2 (`ridOf`/`withRowIds` ported then).
- **The legacy `log/{dough}` migration stays in the current app** (production is migrated).
- **The log document keeps the current app's stored text** (English timestamp, same fields) so both apps
  read each other's logs until the switch; the `bakery` stamp is the real venue id. The two words of the
  text («Extra dough: », «Occasional client») follow the INTERFACE language at the moment of saving, like
  the current app's `js/log-model.js` (an Italian venue stores «Impasto extra: »); the timestamp stays English.
- A tablet left on the Calculator across 4 am does not sweep (never while on screen), so Edit → Confirm next
  morning updates yesterday's log — same as the current app; left as is.
- **Who may delete a log**: unchanged (rules not touched).

## Step 3c-2 as built (12 Oct 2026) — differences from the current app, on purpose

- **Editors and Save wait for the SERVER's answer**, not for any answer: the current app counts the browser's own
  database as the answer (`serverAnswered`), which Mise 2's addressable editors would turn into «save yesterday's
  copy». Offline an editor stays on «Loading…» (a configuration save is a transaction and needs the server anyway);
  the hub's two switches are disabled until then.
- **While a configuration save is in the air** the stream's older document is held, not shown, and a successful save
  gives the copy the revision it was written as (the current app hears no metadata changes, so it never needed it).
- **The row-id stamp** reads the Catalogue recipe as the server holds it, in a transaction, and writes only when a
  row lacked an id; the current app writes back the list read when its picker opened (fix for the current app
  proposed separately). The picker reads the Catalogue from the server only.
- **Save is disabled until something changed** (the current app's Clients and Recipes Save is always pressable);
  after a successful save every editor returns to the level above (P20).
- **Deleting a product asks first** (the current app removes it at once); every delete icon names what it deletes.
- **The browser's Back / the rail while a save is in the air** are refused silently until it settles (no «unsaved
  changes» false alarm).
- **Leavening on a linked recipe** is chosen among the Catalogue's rows (`leaveningRid`); the current app looked it up
  among the recipe's own leftover rows, so the choice did nothing.
- **The pieces-per-crate box** has a visible label instead of the hardcoded «pz».
- **Dough history settings** name a product ordered by two clients once.
- **Not built yet, needed before the switch:** the ordering link on a client (75) and republishing the clients'
  ordering menus on save (69) — both with 3c-4b; the WhatsApp and Client ordering rows of the hub (3c-4).

## Step 3c-3 as built, slice C1 (12 Oct 2026) — differences from the current app, on purpose

- **The list card has no action buttons.** History, Edit (manual logs only) and Delete live on the log's own screen, one
  level down; the whole card is the one button that opens it (the current app's card carries three small buttons under
  its body). Items 100 and 105 and 106 still hold, one tap further.
- **The Dough history is a place of its own** with a button beside Settings at the top of the work view (the current app
  reached it from the footer «Log»), and each screen has an address: `/calculator/log`, `/log/<id>`,
  `/log/<id>/history[/<n>]`, `/log/new`, `/log/<id>/edit`. Back and a link sent to a colleague land on the same screen.
- **On a tablet (≥1000px) the list stays on the left** and the log, its history or a version opens on the right; with
  nothing open the right side says «Tap a dough to see it». The current app opened full-screen overlays.
- **«Add dough» sits at the top of the list** (the current app's «+ Add dough» was below it): a new item starts at the top
  (P20). The plus is an icon.
- **Joined strings are single messages:** «v2 · edited», «Calculated by <name>», «<name> · occasional», «current» — the current
  app builds them from pieces (` (edited)`, `Calculated by: `, `  ·  occasional`, ` · current`).
- **Delete (item 106) and Restore (item 105) return to the screen above by stepping back** (or by replacing the entry when
  the screen was opened by its address), the title of the list or of the history taking the focus; they never pile a
  duplicate entry on the history.
- **A log that is being deleted stays on screen until the screen is left**, so «Dough not found.» never flashes over it.
- **The sheet is drawn with the interface language's number format** (`1,200 g`, `1.200 g` in Italian), where the current
  app wrote the raw number.
- **The day badge's colours come from the Mise 2 tokens** (green today, amber tomorrow, muted once passed), each tint with
  its own ink at 4.5:1 or better.
- **A delete the database refuses brings the log back and says so** (the current app left it hidden until a reload).
- **Edit and Restore refuse at 100 versions**, saying so; the current app does not check, and the rules would refuse the write later.
- **A new version is ADDED to the server's chain** (`updateDoc` + `arrayUnion`), never written over it: another phone's version is kept, and a dough deleted elsewhere is refused («not saved»), never recreated.
- **The Delete and Restore questions have titles** (the current app's were a bare sentence).
- **Same as the current app:** the day badge and the retention hiding are computed when the screen is drawn (no timer), and Restore keeps the restored version's author.
- **Add log and Edit log are slice C2** (below).

## Step 3c-3 as built, slice C2 (12 Oct 2026) — differences from the current app, on purpose

- **Edit dough opens with NO pre-question.** The current app asks «Edit this dough?» before the editor opens; Mise 2's
  screen works on a copy, writes nothing until Save and asks before it is left with edits, so the question protected
  nothing (item 104).
- **Save is disabled until something changed** on Edit (the current app's is always pressable) and, on Add, until a recipe is
  picked (item 103). Leaving either with edits asks the discard question; Add with nothing picked leaves without one.
- **After a saved Add the screen returns to the list** (the current app closed the overlay onto wherever it was opened from,
  which is the same place); the Add button takes the focus back. After a saved Edit the log's own screen takes it.
- **«Choose Today or Tomorrow first»** is an alert line above the two buttons and the buttons turn red, the focus goes to
  the first (the current app scrolled to it); the recipe and the day are buttons, the one picked framed and tinted.
- **Picking the recipe already picked does nothing** (the current app reloaded it, wiping what was typed); picking another
  starts over, as before.
- **A log the Calculator made has no Edit screen:** its edit address shows the log. A log that is deleted elsewhere while
  it is open keeps the screen and what was typed, and says «Dough not found.» at Save instead of saving.
- **A refused Add, Edit or Restore is said** (the database refused it, or the log is gone). (A refused Add has already closed its screen when the refusal arrives, so it is said on the list.)
- **The save question of Edit warns when another phone changed the dough meanwhile:** «This dough was changed on another phone while you were editing. Saving puts your quantities on top.» above the usual question; the new version goes after theirs.
- **A recipe deleted elsewhere while Add is open** clears the choice (Save waits again); if it goes while the question is open, Save says the recipe cannot be read and writes nothing.
- **The order's extra-dough line uses the interface number format** (`1,200 g` / `1.200 g`).
- **Same as the current app:** a manual Add with every field at 0 saves an empty dough.
- **The empty hint of Edit says «No products in this dough.»** (the current app's «in this category» used the old word).
- Typed numbers are clamped at 0 and never NaN; a `dropdown` product whose saved quantity is not 0…100 keeps that value in
  its select.

## Step 3c-4a as built, slice B (12 Oct 2026) — differences from the current app, on purpose

- **The door is a «Send order» button beside Dough history and Settings** at the top of the work view (and of the empty states
  that show doors), with a send icon (the current app: an arrow in the header). It opens a dialog, not an address; when the
  whole errand is over (picker, form, «Send to», road sheet, a notice) the focus goes back to it.
- **Closing an order whose quantities were changed by hand asks first** («Discard this order?» — Discard / Keep), by Cancel,
  Escape, the backdrop or a navigation (the browser's or Android's Back, the rail, a link — a router blocker: Discard lets it
  through and ends the errand, Keep cancels it); the current app closed the order and lost it. Changed means a box says a different NUMBER than the form
  opened with (the prefill alone is no change; tapping a 0 and leaving it is none; Clear all counts when it cleared something).
  An untouched form closes at once (and a navigation goes through). Known limit: when another phone hides the open recipe and the
  work view is replaced by a redirect, the form goes with it without asking. While such quantities are held the session is busy (`markBusy`), so an update does not throw
  the order away. Sending is not discarding: no question.
- **When the saved doughs have not arrived yet** the form says so («The saved doughs have not arrived yet — type the
  quantities.») instead of «Nothing logged…», and offers no number. The current app read an empty list as «nothing logged».
- **A copy that is not fresh never passes for fresh.** If the logs have arrived only from this device's own copy (not yet from the
  server) and nothing could be filled, the form says «The saved doughs have not arrived yet» (not «Nothing logged…», which may be
  false); if some quantities were filled, the usual note is followed by a second sentence in the warning style («Fresh data has not
  arrived yet: these numbers come from this device’s copy — check them before sending.»). Judged once, when the form opens.
- **The prefill is worked out once, when the form opens**, and never again: a log arriving while somebody types changes no box.
- **The form is a dialog** (pickers and form stay dialogs, night-run decision): wide (640px) in the middle from 1000px, a
  full-width sheet on the bottom edge on a phone; it scrolls inside, the title and Cancel / Send stay in view. The note and
  «Clear all» sit side by side at the top, not in the footer.
- **«Send to» sits on top of the form**, which stays open under it: Cancel there goes back to the form with every quantity as it
  was. Choosing a row closes the form before the road sheet opens (the current app also kept the form under the question).
- **The box of a product is named «Product, Client»** when the form has several clients (the visible label is the product; the name
  starts with it); with one client the label is the name.
- **The picker's group labels are real groups** («Lists», «Clients»), each row a button with a chevron; a list is named by its title
  (an untitled list already reads as the venue's default title after `normalizeConfig`, so «Untitled list» is only a fallback).
- **Free lines and products are listed as the list holds them** (products, then free lines), each with its own box starting at 0.
- **Not done on purpose:** the usage record names no dialog (the dialogs of Mise 2 report no screen name); the WhatsApp lists
  editor and the Client ordering rows of the hub are slice C / 3c-4b.

- **On a phone the three doors share one row** (Dough history, Settings, Send order), each an equal column with its icon above the word; under 340px two columns, the third door on a second row. With three doors the wrapped buttons had stacked into three rows above the tabs.

## Step 3c-4a as built, slice C (12 Oct 2026) — differences from the current app, on purpose

- **Every screen has an address**, under `/calculator/settings/whatsapp`: the top; `list/<id>` (Level 1); `list/<id>/add` (the
  client chooser, 1b); `list/<id>/client/<clientId>` (a client's products and free lines, Level 2; entries are keyed by the
  client, which is unique inside a list); `…/client/<clientId>/add` (Level 3); `direct/<id>` and `direct/<id>/add`. `list/new` and
  `direct/new` make a fresh empty item and replace themselves with its address (the work view's «Add a recipe» does the same).
  An id the working copy lacks goes back to the top (or to the list, for a client); an unknown address goes to the hub. The
  usage record names all of them `settings`. The hub's WhatsApp door is a row beside Clients (the current app: a row of its own
  in the same list).
- **Save writes ONLY the edited item over the LATEST configuration** (the item with the same id is replaced in its place, a new
  one — or one deleted on another phone meanwhile, which the person has just saved on purpose — is added at the end). The current
  app wrote back its WHOLE working copy of the configuration, taken when the top screen was drawn, and so undid another phone's
  change to any other list, client or key. The delete from the top and the prefill window do the same: one id removed, one key
  changed, on the latest configuration. Another phone's change survives once it has reached this phone; a change still on its way
  (or held while this phone's own save is in the air) can be overwritten, as in every Calculator settings editor — a server-side
  merge is left for later.
- **Save is disabled until something changed** (the current app's is always pressable), and after a successful save it returns to
  the TOP from however deep the person is, in one step (every screen the editor pushes carries its depth in the navigation state),
  leaving no trail of list/client/picker screens in the history (P20). When the item's own screen was opened by a typed or
  bookmarked address, the state also says so (`typedRoot`): Save steps back to that screen and then replaces it with the top.
- **The discard question** is the router's blocker, so the browser's Back and the rail ask too, not only the bar's Back (the
  current app asked on its own Back only). Back from the chooser, a client's lines or a picker steps up and asks nothing: the edits
  stay in the working copy. A way out while a save is in the air is refused silently. The session is busy (`markBusy`) while edits
  are unsaved.
- **Every icon names what it removes** («Delete list Monday market», «Remove Cafe Roma from the list», «Remove product Focaccia
  tray», «Remove extra line 2»); the current app's names were the same for every row. The keys `calc.deleteList`,
  `calc.removeClientFromList` and `calc.removeLine` are replaced by `calc.deleteListNamed`, `calc.removeClientNamed` and
  `calc.removeLineN`; `calc.removeProductNamed` and `calc.deleteClientNamed` already existed. The top's rows are a list of cards
  (a button that opens and a button that deletes), not a bare box beside an icon.
- **«{name}’s products» is translated** (`calc.clientsProducts`, «Prodotti di {name}» in Italian). The current app hardcoded the
  English `${client.name}’s products` in this heading whatever the interface language — a bug of the current app, to be fixed there
  when convenient.
- **A blank name** sends the person to the screen that has the field (a refusal on a client's lines steps back to the list), says
  the sentence, and puts the focus in the marked field once the sentence has been read.
- **A free line's id is settled when the configuration is saved** (same as the current app, which does not recompute it as the
  name is typed either). A new line has no id until it is saved; the store's normaliser
  (`normalizeConfig`, which every save goes through) then gives it `wx-<slug>`, unique inside the entry, and drops a blank one
  (max 50). A line that already has an id keeps it when renamed. The box is named «Extra line N»; an Enter in the typing box of
  Level 3 adds the line like the button.
- **«Products to send» shows only products that still exist** and the empty sentence is shown when none of them does (the current
  app counted the stored ids, so an entry whose products were all deleted showed an empty list without the sentence).
- **The prefill window** is a labelled box on the top, described by its explanation; while its write is in the air it is disabled,
  and a refused write puts it back (the store already takes the change back; the box follows the store).
- **Known limit:** a refused delete or prefill-window write, after the person has left the WhatsApp top screen, is put back in the
  data but not said.
- **Not done on purpose:** the Client ordering row of the hub (3c-4b), the Home shortcut on the top (the current app's overlay had a
  Home button on it; Mise 2's rail is always there).

## Step 3c-4b as built, slice C1 (13 Oct 2026) — differences from the current app, on purpose

The clients' own orders, the bakery's side: items 91 to 93 above. The deadline editor, the hub's Client ordering row and the
ordering link on a client are slice C2.

- **Orders received is two addresses, not an overlay**: `/calculator/orders` (still coming) and `/calculator/orders/history`.
  `orders` as the first segment always means this screen (like `log` and `settings`: a recipe whose id is literally `orders` has
  no tab address of its own); an unknown address under it goes to `/calculator/orders`. The usage record names both
  `client-orders`. Back steps up to the work view, and REPLACES a typed address.
- **The view switch is two links** («Still coming» / «History», `aria-current="page"` on the current one), each the address of its
  view, so a reload and a shared link land on the same one. Choosing one REPLACES the entry (a lateral move, like picking a tab):
  Back leaves Orders received in one step rather than walking back through the views. The current app's two buttons kept the
  view in a variable. The history's window is back at 15 days whenever the screen is left (as the current app, which kept it for
  the page's life only until the next open).
- **The door «Client orders» replaces the footer button** (called «Orders» when C1 was built; C2 renamed it, see its section), at the top of the work view and of the empty states that show doors, beside
  Log, Settings and Send order (the current app: the bottom bar, which held exactly three). It shows unless the configuration's
  `showClientOrdersButton` is a literal false. It is a button that opens the address, like its three siblings, and Back gives it
  the focus back. On a phone FOUR doors are two columns of two (all one width); three keep one row, and two columns under 340px;
  from 700px all share one row.
- **The banner is a real link** (the current app: a button), the whole banner with a chevron, and it goes quiet when nothing needs
  attention. It follows no switch (item 91): hiding the Orders door never hides the alarm. It is drawn on the work view only, not
  on the empty states (the current app drew it above whatever was open). Back gives the focus back to the banner.
- **Three more states for the list of orders still coming**, because «nothing» had three meanings: «Loading…» before any answer;
  «The orders could not be loaded. Check your connection.» when the stream died (the current app showed «nothing for today» and an
  empty banner); «The orders have not arrived yet.» when an EMPTY answer came from this phone's own copy only, before the server
  has spoken (the current app could not tell it from a real empty). Two new keys, `calc.clientOrders.failed` and
  `calc.clientOrders.notArrived`. Orders dated before today (a tablet left open across midnight) are dropped by the screen itself,
  and the date is checked every minute.
- **Putting an order in lands on the work view, on the tab of the first recipe (in tab order) that received a number**, by
  REPLACING the Orders received entry (the current app closed its overlay on the tab already open). The writes are the ones typing
  makes: the text under `qty-<clientId>::<productId>` and `touched-<rid>` of each tab, through the tab memory, so each tab
  recalculates from what it reads. Only after the numbers are in is the order marked used (local-first); a refusal that arrives
  later is SAID (`calc.clientOrders.notRecorded`) on whatever Calculator screen is open — first as a 2.6 s status message, since
  C2 as an ALERT DIALOG like the current app (see the C2 section).
- **The question has a title and a list.** Without a clash the title is the question itself («Put Cafe Roma's order in the
  calculator?»; the current app's dialog had no title); with clashes the title is «This will replace what is typed», the OK button
  is a danger button, and the rows are a real list «Focaccia tray: 3 → 5» (the current app printed them in one text block). The
  line about confirmed tabs comes under the list. `useConfirm` gained an optional `body` for it.
- **«Every tab is confirmed» is decided on the rows**, not on the number of recipe names: the current app compared the count of
  locked recipe names with the count of rows, so a confirmed recipe holding two of the client's products was not seen as «all
  locked».
- **A product with a box on a hidden recipe tab counts as having none**, as the current app's inspect did (it looked at the
  boxes drawn, which were the visible tabs).
- **Headings**: Orders received has its title as the level-2 heading under the section's h1, so the history's day headings are
  level 3 and a card's client name level 3 (level 4 inside a day). The current app's overlay had no heading structure.
- **The history's «Show older» keeps the orders on screen while the wider window is read** (the button is disabled meanwhile), so
  the focus is not dropped; the current app redrew the whole screen as «Loading…».
- **The client's name, the cards and the times** use the interface language: the day in its locale, «Sent 20 min ago» in its words,
  quantities in its number format. The current app used the same locale tag for the day and plain digits for the quantities.
- **Not done on purpose:** the Home button of the current app's overlay (Mise 2's rail is always there). The deadline editor, the
  hub's Client ordering row and the ordering link on a client are slice C2.

## Step 3c-4b as built, slice C2 (13 Oct 2026) — differences from the current app, on purpose

The deadline editor, the hub's Client ordering row and the ordering link on a client: items 71 (the hub row), 75 and 94 above.

- **The hub row «Client ordering»** (sub-line «When orders sent from a client's own link close») sits beside the WhatsApp door and
  opens `/calculator/settings/ordering`, one level down, like every other Settings screen: the usage record calls it
  `settings`, Back gives the focus back to the row, and a typed address is REPLACED on the way out.
- **The deadline editor is a form like the others**: a Back/Save bar, a working copy, a Save that stays disabled until the box
  differs from what it opened with, the discard question on every way out (the router's blocker, so the rail asks too), the busy
  marker while edits are unsaved. The current app's overlay had a Save that was always enabled and no discard question.
- **It waits for the SERVER's answer** (`cutoffFromServer`) before it copies the deadline, and says «Loading…» until then: the
  browser's own database answers at once with whatever this phone last saw, and saving that back would undo another phone's
  change. The current app copied whatever it held. Offline, the editor therefore stays on «Loading…» (the config editors do too).
- **A «No deadline» button** under the box clears it (and puts the focus back in the box), because the native time box is hard to
  clear on some phones. The sentence about the consequence nobody guesses (with a deadline, today can never be ordered for) is
  kept under the box.
- **The save is local-first and returns at once** (P20): the question («Close orders at 19:30 the day before?» or, with the box
  empty, «Remove the deadline?»), then the deadline is handed to the browser's own database and the screen steps back to the hub.
  A refusal that arrives later is SAID as the status message «Not saved: check the connection and try again.» with the old
  deadline back on screen. The current app waited for the answer, kept the screen open and alerted. A value that is not a time
  (only possible in a browser without a native time box) is refused with «That is not a time…» and nothing is written.
- **The ordering link is a labelled group «Ordering link» under the client's products.** While the Clients editor holds ANY
  unsaved change (a client added and never saved included) it shows only «Save your changes first…», because a link publishes the
  products AS SAVED. The links are read when the client's screen opens and again when the editor's save completes.
- **A failed read of the links is its own state**: «The ordering links could not be read. Check your connection and open this
  client again.» with NO Create button (new key `calc.orderingLink.failed`). The current app logged the failure and offered to
  create a link, which would mint a second account for a client whose link works and cut it off. While the read is in the air
  the group says «Loading…».
- **A client whose id is not a valid order client id** (`isValidOrderClientId`) is never offered Create (the store would refuse),
  and gets the «cannot order» sentence. A grant with no secret cannot be shown: no Copy or Send, only Replace.
- **Who sees what** (changed in BOTH apps by the audit of 25 Oct 2026 — the link's secret is the ordering account's password):
  the whole group, Copy link and Send included, only where `canManage`; the links are not even read for anybody else, who gets
  one sentence (`calc.orderingLinkManagersOnly`), and the rules refuse them the read. Deliberate difference: with unsaved
  edits the current app tells an employee «Save your changes first» (its dirty check runs first), Mise 2 the managers-only
  sentence (its role check runs first) — neither shows a link. Send opens the shared «which road» sheet (WhatsApp or the mail app, no recipient) with the client's name as
  the subject and the VENUE's name in the text («us» when the venue has none).
- **The link points at the site root's `order.html`** even when the app is served from `/mise2/` (`orderingLinkFor` steps out of
  the folder), because the client's page stays where it is until its own port (step 3h).
- **«Copy this link…» spells the link out in its own paragraph** (selectable, breaking anywhere) when the clipboard does not take
  it or the 2 s clock wins; the dialogs are the app's own, never the browser's.
- **«Turn off ordering» is a quiet button** in the danger ink, below the other buttons, with the full 48 px target.
- **`applied-not-recorded` is now an alert dialog** that stays until it is dismissed (the current app used an alert), not the
  2.6 s status message C1 shipped: it is the warning that the app will no longer notice the client changing the order.
  `cutoff-not-saved` stays a status message.
- **The Calculator's door says «Client orders»** (Italian «Ordini ricevuti»), not «Orders», which sat confusingly beside
  «Send order». New key `calc.clientOrders.door`. The current app's footer button said «Orders». In Italian the door is NOT
  «Ordini dei clienti»: that is the hub row's name (`ui.clientOrdering`, the deadline), and the door opens the screen of the
  orders RECEIVED, so the two never read the same.
- **A deadline that was never saved is said, and can be saved as shown.** With no `client-settings/orders` document the bakery
  is shown the default 16:00 while the clients' page reads NO deadline (any day, today included). The editor then says, above the
  box, «No deadline has been saved yet: until you save one, clients can order for any day, today included.» (new key
  `calc.cutoff.notSaved`, warning tone), and Save is enabled WITHOUT a change so the 16:00 shown can be saved as it is (the usual
  question follows). The current app showed 16:00 as if it were in force.
