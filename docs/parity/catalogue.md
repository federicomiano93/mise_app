# Parity list — Recipe catalogue («Ricettario»), allergens, labels and printing

What Mise 2's Recipe catalogue must do because the current app does it. Built from `catalogue.html`,
`label-print.css`, everything in `js/catalogue/` (`catalogue-main`, `-list`, `-detail`, `-editor`, `-settings`,
`-store`, `-model`, `firebase-catalogue`, `firebase-photo`, `photo-capture`, `photo-model`, `search-box`,
`tablet`, `zoom-steps`, `ingredient-picker`, `ingredient-suggest`, `import-to-calculator`, `allergen-sheet`,
`recipe-allergen-model`, `recipe-label-model`, `recipe-cost-model`, `label-view`, `label-print`,
`label-template-model`, `label-zpl`, `print-transports`, `guided-model`, `-editor`, `-run`, `-alarm`), the root
modules it reads (`js/allergen-model.js`, `js/market.js`, `js/venue-features.js`, `js/print-queue-model.js`,
`js/recipe-link.js`, `js/photo-model.js`, `js/records.js` `mayEditRecords`, `js/push.js` and `js/wake-lock.js`
for the mixing timer), `js/allergen-match.js` and `js/allergen-terms.js` (read, but they belong to Orders — item
20), `print-agent/`, `functions/recipe-photo.js` / `recipe-photo-model.js` / `setRecipePhoto` in
`functions/onboarding.js`, `firestore.rules` (`recipes`, `config/labels`, `print-jobs`, `print-agents`,
`ingredients`, `suppliers`, `push-timers`), the data model, the `i18n-labels` and `smoke-test` skills, and these
tests: `catalogue-model`, `catalogue-no-money`, `catalogue-reorder`, `catalogue-tablet-split`,
`catalogue-editor-delete-label`, `allergen-model`, `allergen-sheet`, `recipe-allergen-model`,
`recipe-label-model`, `recipe-declaration`, `recipe-weights`, `recipe-unit-text`, `recipe-cost-model`,
`label-template-model`, `label-zpl`, `label-print`, `print-single-label`, `print-queue-model`, `print-agent`,
`print-agent-config`, `guided-model`, `market`, `venue-features`, `i18n-label-separation`,
`field-label-tokens`, `recipe-photo-model`, `recipe-photo-handler`, `photo-image-model`, `photo-timeouts`,
`foodcost-from-recipe`, `link-suggestions`, `store-notify-guarded`, `local-data`, `usage-events`,
`copie-allineate`. Each line is a requirement; the ones marked **spec** are pinned by a current test (a port
runs that test against both files, or re-states it as a behaviour test where the original reads source text).
Nothing in this list is decided for Mise 2 — the things that need a decision are in «Questions for the main
session», things found while reading are in «Findings», and a proposed split into steps is at the end.

⚠️ **This is the health-critical section.** An allergen mistake can send somebody to hospital, and a printed
label is a legal document. Where this list says «byte-identical», it means it: the words, their order, the
millimetres and the ZPL characters (items 62–80 and «What proves byte-identity»).

## Who sees it, who may do what

1. **Gated on the Catalogue section and its card** (`body data-section="catalogue" data-card="catalogue"`,
   `catalogue.html:79`): any member of a venue whose `sections.catalogue` is on, employees included, unless the
   owner hid the card. Home pushes for the card are `employeePush` (`shared/src/home-cards.ts:53`). In Mise 2
   the section is `recipes` at `/recipes` (`app/src/shell/sections.ts`, gate `{ recipes → catalogue }` in
   `session/visibility.ts:24`).
2. **Rules** (`firestore.rules:2044-2125`): `recipes` is READ by `member && (catalogue on || foodcost on)`
   (Food cost reads them to cost a product) and CREATED/UPDATED by `canUse(catalogue)`; `config/labels` is READ
   by `member && catalogue on` and WRITTEN by `canManage(catalogue)` (`:1376`); `print-jobs` and `print-agents`
   are read and written by `canUse(catalogue)` (`:1455`, `:1538`); `ingredients` and `suppliers` are READ by
   `canReadOrdersData` (orders OR catalogue OR foodcost on, `:374`) — the Catalogue never writes them.
3. **Employees do almost everything**: view, scale, create and edit recipes, write and run a mixing procedure,
   read the allergen sheet, make and print labels, read a recipe from a photograph (if the venue has it on).
   There is deliberately NO role gate on the allergen sheet or on printing — «the person at the counter» is the
   audience (`catalogue-main.js:160-181`, `firestore.rules:1446-1454`).
4. **`canManage` (owner AND manager, never `isOwner`) only**: deleting a recipe (button in the detail screen,
   `catalogue-detail.js:604`, and in the editor, `catalogue-editor.js:570`; the rule `canManage(catalogue)` at
   `firestore.rules:2125`), the Settings button and everything on that screen (`catalogue-main.js:173`;
   `config/labels` write rule), switching the photo reader on or off (the `setRecipePhoto` callable refuses
   anybody else, `functions/onboarding.js:969-989`), retiring a print-agent document (`firestore.rules:1554`).
   The button is **absent**, never disabled; hiding is courtesy, the server refuses regardless.
5. **Who is looking is asked every time a control is drawn**, never captured: `canManage`, `location`, the
   printer heartbeat and the photo switch are read at paint time (`catalogue-main.js:173`, `:426-433`, `:550`;
   the session arrives after the first paint and an open recipe is rebuilt whole when it lands, `:943-973`).
6. **`showAllergens` switched off hides**: the footer «Allergen sheet» button (`catalogue-main.js:181`), the
   recipe's allergen card (and with it the only way to a label, `catalogue-detail.js:253`), the declaration
   card (`:155`) and the label screen itself («No label can be made … turn allergens back on», belt and braces,
   `label-view.js:128`). It is `!== false` (item 61). ⚠️ **The allergen sheet screen itself does not check the
   switch** — only its button is hidden. In Mise 2, where every screen has an address, the sheet's route must
   check it too (item 60, Findings D). **spec** (`recipe-declaration.test.mjs`, `venue-features.test.mjs`)
7. **Doors to other sections are drawn only for whoever the other section lets in**, each judged by the shared
   rule the other page's gate uses: «Open in Food cost» by `mayOpenFoodCost` (section AND card, `recipe-link.js:83`),
   «Go to Orders» by `mayOpenOrders` (`:69`), «Import into the Calculator» by `isSectionAllowed(location,
   'calculator')` (`catalogue-detail.js:594`), «+ Create "…" as an ingredient» by `mayEditRecords` (orders
   section AND the suppliers card, `js/records.js:27`). A door to a page that would bounce its user Home is worse
   than no door. **spec** (`foodcost-from-recipe.test.mjs`)
8. **A venue switch wipes every local copy of this section** (none of its keys is in `KEEP_PREFIXES`,
   `js/local-data.js`): the next venue never sees the previous one's recipes, ingredients, paper size or a
   mixing session in progress. **spec** (`local-data.test.mjs` names `catalogue-recipes` and `catalogue-usage`)

## Data — what is read and what is written

9. **`locations/{lid}/recipes/{id}`**, one document per recipe, id made on the phone (`newRecipeId`,
   `firebase-catalogue.js:61`) so a new recipe appears at once and offline. Read as a whole-collection live
   listener, attached only while the page is open (never at boot, P14; `watchRecipes`, `:76`).
10. **The rules' closed key list for a recipe** (`firestore.rules:2050`): `bakery, name, ingredients, lossPct,
    steps, endNote, rawGrams, cookedGrams, netWeightG, shelfLifeDays`. `name` 1–199 chars; `ingredients` ≤ 300
    rows; `steps` ≤ 100; `endNote` ≤ 300; `lossPct` 0–99; `rawGrams`/`cookedGrams` 0–10 000 000;
    `netWeightG` > 0 and ≤ 10 000 000; `shelfLifeDays` 0–3650. The rules cannot look inside a list, so the
    shape of a row or a step is guaranteed by the client (`catalogue-model.js`, `guided-model.js`) only.
    **`lossPct`, `rawGrams` and `cookedGrams` stay in the whitelist for good** — Food cost writes them (item
    11), and a save that merges over them must still pass.
11. **A recipe save is `setDoc(…, { merge: true })` of a hand-listed set of fields** (`catalogue-store.js:332-386`):
    `name`, `ingredients` (with a `rid` minted on every row that lacks one — item 24), `steps` (written even when
    EMPTY, or a deleted procedure would live on), `endNote` (same), `netWeightG`, `shelfLifeDays` (a number, or
    `null` which `saveRecipeDoc` turns into `deleteField()` — the rules refuse a stored null and a merge never
    removes a key it is not sent, `firebase-catalogue.js:211-221`), plus the `bakery` stamp. Fields are listed
    by hand because spreading would send `id` and be refused. ⚠️ **It NEVER writes `lossPct`, `rawGrams` or
    `cookedGrams`** (13 Sep 2026): Food cost's weighing on a product line owns them, and a copy read before the
    weighing and saved after would silently undo it. The local copy keeps the three from the previous version
    (`:377-379`). **spec** (`recipe-weights.test.mjs`: «the catalogue no longer writes the loss», «the store still
    lists every field by hand», «writes the label fields», «an emptied label box is REMOVED»)
12. **Delete** is `deleteDoc`, local-first with rollback (item 88). It does not touch Calculator copies,
    Food cost products that point at the recipe, or mixing sessions in progress (items 96-97, Findings G).
13. **Ingredients and suppliers are watched read-only** while the page is open (`watchIngredients`, `:105`;
    `watchSuppliers`, `:128`): the ingredient list is what a recipe row links to and where its allergen
    declaration is read; suppliers only so the chooser can tell two similar articles apart (`supplierLabel`).
    A failure of either is **deliberately quiet** (`catalogue-store.js:109-133`): a venue without Orders has
    none, and every linked row then reads «not declared», which is the honest answer. ⚠️ **No prices**: the
    ingredient listener strips `PRICE_FIELDS` from every document (`firebase-catalogue.js:120`) and the Catalogue
    never reads `ingredient-prices` (13 Sep 2026), so no price sits in this section's local copy.
    **spec** (`catalogue-no-money.test.mjs`)
14. **`locations/{lid}/config/labels`** — the paper, the printer and the optional blocks, one small document,
    watched (`watchLabelConfig`, `:158`), written by `setDoc(…, { merge: true })` with the `bakery` stamp
    (`saveLabelConfig`, `:170`). It is NOT reachable through the general `config/{doc}` block (`doc != 'labels'`,
    `firestore.rules:1582-1588`) — a Calculator employee must not be able to write it. A missing document is not
    an error: `normalizeLabelProfile(null)` answers the defaults (item 70). Closed key list (`:1376-1432`):
    `bakery, widthMm, heightMm, marginMm, baseFontMm, dpi, printerLanguage, showDate, showWeight, showStorage,
    showBusiness, dateKind, storageText, businessName, businessAddress`; width/height 20–300, margin 0–20, base
    font 1–20, dpi ∈ {203, 300}, printerLanguage ∈ {os, zpl}, dateKind ∈ {useBy, bestBefore}, texts ≤ 200;
    delete is `false` (turning a setting off is a write).
15. **`locations/{lid}/print-jobs`** — a label waiting for the shop computer: `{ bakery, status: 'queued',
    payload (the ZPL, 1–20 000 chars, no `~`), copies 1–99, createdAt (ISO string), createdBy: uid }`, created by
    `addDoc` (`queuePrintJob`, `firebase-catalogue.js:187`) with the job built by `buildJob`
    (`print-queue-model.js:49`). **NOT local-first**: it throws if the network does (pretending a job was
    queued is somebody standing at a printer that will never move, `catalogue-store.js:169-190`). The agent
    (not the app) claims, completes and deletes jobs. **spec** (`print-queue-model.test.mjs`)
16. **`locations/{lid}/print-agents/{id}`** — the shop computer's heartbeat (`{ bakery, lastSeenAt, printer?,
    version? }`), watched (`watchPrintAgents`, `:200`) so the screen says «printer ready» BEFORE anybody taps.
    ⚠️ **Never cached to localStorage** (`catalogue-store.js:52-56`): a heartbeat is a statement about right now.
    A failure leaves `[]` = «nothing is listening».
17. **The Calculator's `config/calculator`** is read once before a delete (to warn, `getCalculatorConfig`,
    `:232`) and written in a transaction by the import (item 82). It is the only write outside this section's own
    collections.
18. **Cloud Functions**: `readRecipeFromPhotos` (item 102) and `setRecipePhoto` (item 4). `ANTHROPIC_API_KEY` is
    a server secret; nothing in the browser holds it.
19. **No Firebase Storage anywhere**: «photo» in this section means *reading a recipe from a photograph*, not
    storing pictures. Photographs are shrunk on the phone, sent as base64 to the callable and thrown away — no
    Storage path, no Storage rule exists (`grep` of `js/`, `functions/`).
20. **Allergen DECLARATIONS are typed in Orders, not here** (`js/ingredient-record-form.js`). The Catalogue only
    READS `ingredients/{id}.allergens`, `.mayContain`, `.allergensCheckedAt`, `.nutrition`. `js/allergen-match.js`
    and `js/allergen-terms.js` (reading a pack's ingredient list to PROPOSE ticks) are imported by that form
    only. They belong to the Orders step; the rule they carry is restated here because every reader of this list
    must know it: **a pack's ingredient list only pre-ticks boxes and NEVER writes `allergensCheckedAt`**, so a
    proposal is inert (`js/allergen-model.js:123-130` reads «ticks without a stamp» as `unknown`) and still blocks
    every label until a person confirms. **spec** (`allergen-match.test.mjs`, `allergen-model.test.mjs`)

## Data — local copies the current app shares (same origin, same keys, same shapes)

21. **Eight keys**, all outside `KEEP_PREFIXES` (so all wiped on sign-out and venue switch, item 8). Both app
    versions read each other's copy, so a Mise 2 that writes them must write the same shapes:

    | Key | Shape | Notes |
    |---|---|---|
    | `catalogue-recipes` | JSON array of NORMALISED recipes `{ id, name, ingredients:[{label, grams, unit, kind?, refId?, rid?}], lossPct, steps?, endNote?, rawGrams?, cookedGrams?, netWeightG?, shelfLifeDays? }` | painted before the network answers; rewritten on every snapshot and local save. `js/whats-new-boot.js:35` uses it as a «this app has been used on this device» footprint, so something must keep writing it |
    | `catalogue-ingredients` | JSON array of ingredient documents (`{ id, … }`, price keys stripped), read back into an id → document map | `catalogue-store.js:275-289` |
    | `catalogue-suppliers` | JSON array of supplier documents, same treatment | |
    | `catalogue-label-config` | the raw `config/labels` document, or the key REMOVED when there is none | cached because a phone that lost the network must still know the paper size (`:42-46`) |
    | `catalogue-usage` | `{ recipeId: openCount }` | per device, «most used first»; pruned to existing recipes on every snapshot |
    | `catalogue-scaled` | `{ recipeId: { target: grams, ts: ms } }` | a calculated batch stays shown until Clear or 12 h (`SCALED_TTL_MS`); pruned |
    | `catalogue-guided-run` | `{ recipeId, snapshot:{ name, ingredients, steps, endNote, targetGrams }, stepIndex, endsAt, startedAt }` | the mixing session in progress (item 96) |
    | `mise.catZoomStep` | one digit `0`–`5` | the full-screen recipe's text size on this device; corrupt/out of range reads as the default (step 1), never an extreme |

    Every read tolerates corrupt JSON and unavailable storage (empty/default, no throw); every write swallows a
    full or blocked storage (the in-memory copy still works). **spec** (`catalogue-model.test.mjs`
    `isScaledEntryFresh`, `guided-model.test.mjs` `isResumable`, `calculator-work-view.test.mjs` for the zoom
    step's twin key)
22. **Nothing is written to these keys for money, ever** — and `localStorage` holds no price (item 13).

## The recipe model — reading, saving, units, scaling

23. **A recipe** from arbitrary input (`normalizeCatalogueRecipe`, `catalogue-model.js:132`): `null` only for
    non-objects; `name` trimmed (empty is kept — the editor blocks it); `ingredients` rebuilt row by row;
    `lossPct` always present (0 default, 0–99 cap — the cap is load-bearing: the yield is a divisor, 100 would
    cost Infinity per kilo); `steps` and `endNote` present only when non-empty («absent rather than empty» so
    untouched recipes stay byte-identical); `rawGrams`, `cookedGrams`, `netWeightG` present only when > 0;
    `shelfLifeDays` present only when a real number 0…3650 (**absent is NOT zero**: 0 days prints today's date
    as a use-by). **spec** (`catalogue-model.test.mjs`, `recipe-weights.test.mjs`)
24. **A row** (`normalizeIngredient`, `:80`): `{ label (trimmed; the old field `name` is read as `label`),
    grams (finite and ≥ 0, else 0), unit (one of the 12, else `g`) }` plus `kind`/`refId` when linked and `rid`
    when it has one. ⚠️ **Every field the editor does not own is carried through** (the row is spread in the
    editor's working copy and in `cleanWorking`): a recipe opened to fix a typo must not come back without its
    links or its row ids. **spec** (`recipe-cost-model.test.mjs` «normalising keeps links»; `guided-model.test.mjs`
    «a row id survives the trip in from the database»)
25. **Units**: `g kg mg ml cl dl l pcs tsp tbsp pinch «to taste»`; weight and volume are *weighable* (volume at
    1 ml = 1 g); pieces, spoons, pinch and «to taste» are not, and stay out of the weight total. A missing unit
    reads as grams. ⚠️ **The stored unit is an identifier** (`DATA_WORDS`), never translated; a person reads
    `unitText(unit)` (`cat.unitText.*`), metric symbols pass through. **spec** (`recipe-unit-text.test.mjs`,
    `catalogue-model.test.mjs`)
26. **The two links** (`linkOf`, `:118`): `kind` ∈ `ingredient` | `recipe` (default `ingredient`), `refId` the
    target's id; a row with no `refId` is unlinked, a junk link is no link. A link to another recipe makes a
    **sub-recipe**; cycles and depth (`MAX_RECIPE_DEPTH = 4`) are caught by every walker (items 45, 63).
27. **Scaling** (`scaleCatalogue`, `baseAmounts`, `:521-547`): pro-rata on the WEIGHABLE total. All-grams recipes
    are exact-sum rounded (the residual goes to the largest row); mixed units round each row in its own unit;
    «to taste» rows have no number (`null`); an empty recipe, a non-positive target or no weighable mass gives
    zeros (never NaN). **spec** (`catalogue-model.test.mjs`)
28. **A typed batch is checked before it is applied** (`batchWarning`, `:580`): over 100 kg, or over 50× the
    recipe as written, gets a louder title and a warning sentence (one whole sentence per case, never three
    fragments); the confirm ALWAYS spells the amount both ways («17500 g (17.5 kg)»). Never a hard block.
    **spec** (`catalogue-model.test.mjs` «THE INCIDENT — a tonne-scale total»)
29. **The batch box takes GRAMS**, not kilos (the old kilo box once produced a 17.5-tonne batch). Empty or 0 =
    back to the base recipe. A calculated batch is remembered per recipe on this device for 12 h (item 21).
30. **Editor validation** (`findInvalidRecipe`, `:624`): the first problem is `name` (blank), `ingredients` (no
    row with a name), then `weight` (every named row is 0). Save is blocked, the first bad field is revealed and
    focused (P20, `revealField`), and a sentence says which (`cat.pleaseEnterARecipe`, `cat.addAtLeastOne`,
    `cat.enterAnAmountFor`). **spec** (`catalogue-model.test.mjs`)

## The list and the recipe screen

31. **The list** (`catalogue-list.js`): one search box (case-insensitive substring on the NAME, debounced 140 ms,
    the stored query updated on every keystroke) above name-only cards, **most-opened first** (the per-device
    `catalogue-usage` counter, ties by name, `localeCompare`). A search that matches nothing is a small line
    («No recipe matches your search»); a catalogue with NO recipes is the empty state with its own «Add a
    recipe» button (the header «+» does the same). ⚠️ The search box is mounted ONCE and only the cards are
    repainted — a data snapshot landing mid-keystroke must never wipe the text or the keyboard.
    **spec** (`catalogue-model.test.mjs` `sortByUsage`, `filterByName`)
32. **Opening a recipe bumps its counter** (not when the app redraws it — `force`), keeps the list's query and
    scroll, and hands the screen a copy that **follows the live data** (item 36).
33. **The recipe screen, top to bottom** (`catalogue-detail.js:655-679`): the ingredient list card (a tap anywhere
    opens it full screen) · the batch card · the Food cost card (only for whoever may open it) · the allergen
    card · the declaration card · the «Procedure» card (mixing steps) · then, below the fold, «Import into the
    Calculator» with its one-line hint, and the low-key Delete (`canManage` only). Every block is a card with a
    static heading — **never a fold for an ANSWER** (an answer behind a tap is an answer nobody reads).
34. **The ingredient list** shows each row's label and `number + unit` in two aligned columns (numbers
    right-aligned), no thousands separator whatever the language (Findings F); whole numbers except kg and l (3
    decimals), dl (2) and cl (1) — one gram or millilitre — written with the language's decimal mark («1,846 kg»;
    `roundInUnit` + `amountNumber`, the current app's PR #361, 14 Oct 2026); «to taste» rows with no number, and a
    **Total** of the weighable rows in whole grams. The batch card is **hidden when nothing is weighable** (all pieces / to-taste).
35. **Full screen** (`cat-ing-list--zoom`): a tap or Enter/Space on the list toggles a CSS overlay (not the
    Fullscreen API — iOS refuses it); × and Escape close it; the page behind is locked (`cat-zoom-lock`); a −/+
    pair steps the text through six sizes (`ZOOM_SCALES = 0.8, 1, 1.2, 1.45, 1.75, 2.1`, default step 1) kept in
    `mise.catZoomStep`, and **sizing the text never closes the view** (the buttons stop their own click and
    Enter/Space; Tab and Escape still reach the dialog). The step buttons use `aria-disabled`, never `disabled`
    (a button that disables under the finger drops focus). The step is re-read from storage each time the view
    opens. **spec** (`calculator-work-view.test.mjs` S5 for the arithmetic, `copie-allineate.test.mjs` pins that
    `js/zoom-steps.js` and `js/catalogue/zoom-steps.js` are byte copies)
35a. **Export (PDF / Excel)** on the recipe screen (`js/catalogue/catalogue-detail.js`, `exportModelOf`; Mise 2:
    `recipes/recipeExportModel.ts`): a full-width secondary button in the Ingredients card UNDER the table (never
    inside it — the table is tapped as a whole), hidden when the recipe has no ingredients. The model is the very
    amounts the table drew (base or scaled): each row in its own unit as the screen spells it, `factor` the grams
    in one unit (0 for pieces, spoons, a pinch, «to taste»), kg and l keeping their decimals in the file exactly as
    the screen writes them («0,727 kg» in Italian), the total the rounded Total of the card or 0. Same dialog as
    the Calculator's (item 85a of its list). **spec** (`catalogue-export-model.test.mjs`)
36. **An open recipe follows the data** (`followOpenRecipe`, `catalogue-main.js:328`): deleted elsewhere → back to
    the list with «Recipe deleted.»; changed elsewhere → redrawn in place with the same scroll and **the focus
    left where it is** (`quietFocus`) — a person typing in the search box beside it must not lose the keyboard.
    The pencil always edits the CURRENT stored recipe, never the copy on screen (a save is a merge of name,
    ingredients and steps; a stale copy would overwrite a colleague's correction). **spec**
    (`catalogue-tablet-split.test.mjs`)
37. **The usage counts are FROZEN while a recipe is open beside the list** (tablet), so a snapshot never re-sorts
    rows under a finger; fresh counts apply the next time the list is shown.
38. **Tablet split** (`TABLET_QUERY = (min-width: 900px) and (min-height: 600px), (min-width: 1000px)`,
    `tablet.js`): list on the left, recipe on the right, **for the list and a recipe only**; every other route
    leaves the split and is exactly its phone self. The list stays alive (not re-rendered) when another recipe
    is opened — only the open row is re-marked (`aria-current`). The pane has its own light head: the recipe's
    name centred and Edit; no Back. With nothing open the right side says «Pick a recipe …»
    (`cat.split.empty.*`), worded at paint time and again on a language change. Crossing the width re-lays out
    the list and a recipe only, never an editor. Tapping the recipe that is already open does nothing.
    **spec** (`catalogue-tablet-split.test.mjs`, source-text tests: restate as behaviour tests)
39. **A recipe named by an address opens** (`catalogue.html#recipe=<id>`, Back from Food cost, item 85): only
    after the session is ready, only over the list, waits for the recipe to arrive, **gives up after 5 s counted
    from the session** and forgets the address (one-shot: a reload never reopens it).
40. **Header**: title is the section name on the list, the recipe's name on a recipe; Home only on the list, Back
    elsewhere; «+» only on the list; Edit only on a recipe (hidden while mixing — it rebuilds the rows); the
    footer bar (Allergen sheet · Settings) only on the list. ⚠️ `data-i18n` is removed from the title/sub the
    first time a screen names them — otherwise the venue's language arriving a moment later re-wrote the title
    to «Recipes» (`catalogue-main.js:133-146`; a React title never has the problem).
41. **A search box on the allergen sheet is ITS OWN** (`sheetQuery`), not the list's: «which do I cook» and «what
    is a customer asking about» must not carry text into each other (`:85-89`).

## Allergens — the part that can hurt somebody

42. **Three states, not two, told apart ONLY by `allergensCheckedAt`** (`allergenState`,
    `js/allergen-model.js:123`): no stamp → `unknown` («nobody has said»), whatever the list holds; a stamp and an
    empty list → `none` («checked: none of the 14»); a stamp and a list → `listed` («checked: contains these»).
    `isDeclared` = not `unknown` and is **the only function allowed to answer «safe to build a label from»**
    (`:141`). An empty list on its own means nothing. **spec** (`allergen-model.test.mjs`
    «AN INGREDIENT NOBODY HAS CHECKED IS NEVER "ALLERGEN-FREE"»)
43. **The fourteen**, with the SPECIFIC cereal and nut named (`gluten-wheat`, `gluten-rye`, `gluten-barley`,
    `gluten-oats`, `gluten-spelt`, `gluten-kamut`, `nuts-almond` … `nuts-macadamia`, `peanuts` separate from tree
    nuts, `celery`, `crustaceans`, `eggs`, `fish`, `lupin`, `milk`, `molluscs`, `mustard`, `sesame`, `soybeans`,
    `sulphites`); unknown codes are DROPPED, never passed through; order is canonical so two identical
    ingredients give identical lists. **`mayContain` is never merged into `allergens`** and is dropped when the
    thing is already contained. Already ported (`shared/src/allergen-model.ts`, paired in `parity.spec.ts`).
    **spec** (`allergen-model.test.mjs`)
44. **Nutrition**: seven values (`kj, kcal, fat, saturates, carbs, sugars, protein, salt` — salt, never sodium;
    both energy units). **0 is a real value and `null` is not**; a table is complete only when ALL are present
    (`hasFullNutrition`); a missing/unreadable value stays `null`, an absurd one is capped. **spec**
    (`allergen-model.test.mjs` «ZERO IS A REAL VALUE AND null IS NOT»)
45. **A recipe's allergens are gathered by walking its rows** (`recipeAllergens`,
    `recipe-allergen-model.js:100`), and **the result carries `complete`**:
    - an unlinked named row, a link to a deleted ingredient, an ingredient with state `unknown`, a link to a
      missing recipe, a cycle, nesting past 4 levels, or an INCOMPLETE sub-recipe → `complete = false`; an
      incomplete sub-recipe contributes NOTHING (taking its known allergens while ignoring its gaps is how doubt
      disappears one level up);
    - **an unweighable row is NOT an excuse** — a pinch of mustard is mustard (unlike the cost model);
    - a blank half-typed row (no label) is not a gap; a recipe with no rows at all is incomplete (nobody said
      «contains none»);
    - `allergens` sorted (`localeCompare`); `mayContain` drops what is already contained; `gaps` are the named
      undeclared rows in recipe order, with a reason each. Two rows may use the same sub-recipe (the branch set
      is COPIED down, never shared).
    - ⚠️ **`complete === false` ⇒ NOTHING may be printed, sent or presented as a declaration**; the known list
      may only appear as «so far we know …», explicitly not an answer.
    **spec** (`recipe-allergen-model.test.mjs`, 37 cases)
46. **`canLabel(result)` is the one function every label asks** (`:186`); `rowState(result)` gives the four
    states `declared-listed`, `declared-none`, `nothing-yet`, `not-declared` — and a missing or junk result
    answers `not-declared`, never the clean-looking one. `rowIsBlocked` = `not-declared` or `nothing-yet`.
    ⚠️ **No screen may decide this with its own ifs** (`allergen-sheet.test.mjs` «the row states come from the
    model»). **spec** (`recipe-allergen-model.test.mjs`, `allergen-sheet.test.mjs`)
47. **The recipe's allergen card** (`allergenPanel`, `catalogue-detail.js:242`):
    - absent when `showAllergens` is off; absent (silent) for a brand-new recipe with no rows;
    - **incomplete**: head «Allergens · not declared» (a state WORD, never colour alone, P18); folded body with
      one sentence («{n} ingredient(s) is/are not declared — no label can be made»), the first 8 gaps as
      `label — reason` plus «and N more», and what IS known so far marked as NOT an answer;
    - **complete**: head «declared»; **outside the fold**, always visible, the list of allergens in the country's
      words or «None of the 14» (interface text — a sentence about the recipe); folded: the traces line, the
      caveat («From the suppliers' specifications. It does not cover what your own kitchen may add.») and the
      button «Make a label» (exists only when there is a label to make);
    - it opens CLOSED every time, and **the answer is never behind a tap** — only the job folds away;
    - the seven reasons are dictionary keys resolved when drawn (`cat.alg.reason.*`), never frozen constants.
    **spec** (`recipe-allergen-model.test.mjs`, `recipe-declaration.test.mjs`)
48. **The declaration card** (`declarationPanel`, `:148`): hidden when allergens are off; incomplete → ONE line
    pointing at the allergen card and **no send buttons at all** (a half declaration must never be sendable);
    complete → the ingredient list heaviest-first with the allergen-bearing rows in bold+underline INSIDE the
    list, a «Contains: …» line, a «May contain: …» line, the caveat, then **Copy** and one **Send** arrow (the
    shared send sheet; no named WhatsApp/Email buttons). The sent/copied text is `declarationText(label, lang,
    { withNutrition: false })` — a message leaves the table out (some mail clients drop a body past ~2000
    characters). The card is rebuilt with the others on every snapshot. **spec** (`recipe-declaration.test.mjs`)
49. **The allergen sheet** (`allergen-sheet.js`) — the screen at the counter. Top to bottom: **the law card**
    («What the law requires here»: the fourteen groups in the venue's COUNTRY's words, the specific cereals and
    nuts folded, a sentence that the names follow the country) · where things stand («{n} of {total} recipes
    declared», a sentence about the rest) · a search · the **work lists** · every recipe with its pill · the
    caveat (outside any repaint). Facts that must not change:
    - **No country → no list**, a warning instead — never a quiet fall back to the UK (`canPrintLabel`);
    - the law card is rebuilt only when the COUNTRY changes, so a refresh never slams its fold shut;
    - the search is by recipe NAME ONLY, deliberately: with nothing declared, searching «nuts» returns zero and
      an empty result on an allergen search reads as «nothing here contains nuts»;
    - the counts describe the WHOLE catalogue, never the filtered slice;
    - **blocked recipes first**, then declared, each by name; a blocked row NAMES NO ALLERGEN AT ALL (a red row
      printing «Milk, Wheat» reads as the answer, and the missing row could hold the hazelnuts); the state is a
      word («Declared» / «Not declared»), never colour alone; `declared-none` reads «None of the 14»;
      `nothing-yet` reads «Nothing in it yet» (not «0 ingredients to sort out»);
    - the work lists (hidden while searching, capped at 6, «and N more»): **«Link these rows first»** (unlinked
      row labels, counted by NAME with `unlinkedRowNames`) then **«Then declare these»** (undeclared linked
      ingredients, busiest first, through sub-recipes, a deleted ingredient is NOT a job, `blockingIngredients`);
      linking comes before declaring because a declaration cannot reach a recipe that does not point at it;
    - `refresh(recipes, ingredients, recipesById)` repaints summary, work lists and rows, never the search box;
      the sheet is **redrawn when the session lands** (the law card needs the country) and rebuilt on a language
      change.
    **spec** (`allergen-sheet.test.mjs`, `recipe-allergen-model.test.mjs`)
50. **Tapping a row of the sheet opens that recipe** (and counts as an open for the usage counter).
51. **Caveats are never dropped**: the allergen card (inside the fold), the declaration card, the sheet (outside
    any repaint) and the label screen all say the data is the SUPPLIER'S specification and cannot cover the
    venue's own kitchen. A screen that implies otherwise is worse than one that says nothing.

## Language — food words follow the COUNTRY, tapping words follow the interface

52. **Two languages, two files** (`i18n-labels` skill): the interface language (`t()`, from the venue's
    `language`) for what a person taps and reads; the OUTPUT language (`outputLanguage(location)`, from the
    venue's `country`, `js/market.js:57`) for every word that names a FOOD — allergens, nutrients, the label's
    own words. It is the law (Reg. 1169/2011: the language where the food is SOLD), not a preference. `GB → en`,
    `IT → it`; **any other or missing country gives `null`** and `canPrintLabel` is false.
53. **The label vocabulary** (`market.js:132-300`, not yet in `shared/src/market.ts`): `LABEL_WORDS` (`contains`,
    `mayContain`, `ingredients`, `nutrition`, `typicalValues`, `per100g`, `noneOfThe14`, `netWeight`, `useBy`,
    `bestBefore`, `storage`, plus Orders' order-title words), `ALLERGEN_IT` (all 26 codes), `NUTRIENT_IT`,
    `GROUP_HEADING` (only `gluten` and `nuts`; the other twelve are named by their own code's word), and the
    functions `labelWord`, `allergenName`, `allergenWordIt`, `nutrientWordIt`, `allergenGroupName`,
    `allergenGroupCodes`, `nutrientName`. **Fallbacks point at the English word, never at a blank** («Hazelnut» on
    an Italian label still tells somebody with a nut allergy what is in the food). `labelWord('useBy')` and
    `('bestBefore')` are two entries, never one with a qualifier. **spec** (`market.test.mjs`)
54. **The rule, per call**: `const lang = outputLanguage(location)` assigned **inside the drawing function**
    (never at module load — no venue is open then, `lang` would be `null` for the life of the page and every
    name would fall back to English in silence), and every `allergenName(code, lang)` / `labelWord(key, lang)` /
    `nutrientName(n, lang)` passes it as the last argument. The `location` is read fresh on every open (a country
    set from another phone reaches the screen without a reload). **spec** (`i18n-label-separation.test.mjs`,
    `recipe-declaration.test.mjs` «the card asks the COUNTRY for its language, and cannot be given one»)
55. **Label files never touch the interface language**: `currentLanguage`, `setLanguage`, `languageFromTag`,
    `interfaceLanguage` may not appear in any of `market.js`, `recipe-label-model.js`, `label-view.js`,
    `allergen-sheet.js`, `catalogue-detail.js`, `label-template-model.js`, `ingredient-record-form.js`; the pure
    ones (`market`, `recipe-label-model`, `label-template-model`) may not import the dictionary at all. A file
    that asks for a label word AND holds `t` is a label file and must be on the list. **spec**
    (`i18n-label-separation.test.mjs`, 10 tests) — Mise 2 needs its own guard over its TypeScript (Questions 12).
56. **The screen around a label is interface text, the words on it are the country's**: «Copy», the caveat, the
    sentence explaining why no label can be made, «Ingredient names are the ones you typed …» and «This label is
    produced in {language} because this business sells in {country}» (language/country names from the
    dictionary: `language.{lang}.inSentence`, `country.{GB|IT}.in`) are `t()`; «Ingredients:», «Contains:», the
    allergen and nutrient names are `market`. **Ingredient names are NOT translated** — an Italian venue must
    type Italian names or a label reads «Contiene: Wheat» (the screen says so). **spec** (`market.test.mjs`,
    `recipe-declaration.test.mjs`)
57. **The amounts in a recipe and the guided run are formatted `en-GB` whatever the language** (no thousands
    separator); the label's net weight and date are formatted in the COUNTRY's locale (`en-GB` / `it-IT`).
    Words in sentences with a number take the plural form from the dictionary (`{n}`, never `{count}`, never
    `n === 1 ?`).
58. **Every `t()` is called when drawing**, never in a module constant: the keys-not-phrases tables
    (`ALLERGEN_REASON_TEXT`, `SHOW_KEYS`, `TRANSPORTS[].labelKey`, `BY_KEY` in `photo-model.js`) hold KEYS and the
    screen resolves them (the v1.57.0 defect: fourteen constants rendered English for weeks). In React this is
    automatic; the **specs** (`frozen-phrases.test.mjs`, `recipe-declaration.test.mjs`) become «renders Italian
    on an Italian venue».
59. **About 330 interface keys** are this section's (`cat.*` ≈ 257, `label.*` ≈ 61, plus `settings.cat.photo`,
    `aria.editRecipe`, `section.catalogue`, `country.*.in`, `language.*.inSentence`): both languages, whole
    sentences, plurals as `{one, other}`, Italian house style (informal *tu*, «Vuoi eliminare …?»). Mise 2's
    typed `en.ts`/`it.ts` makes a missing key a build error.
60. **Everything addressed by a route must re-check its own gate** (a new requirement of Mise 2, see item 6):
    `/recipes/allergens` checks `showAllergens`; `/recipes/<id>/label` checks `showAllergens`, a known country
    and a complete declaration (the current label screen already does — keep that belt); `/recipes/settings`
    checks `canManage`; `/recipes/photo` checks `recipePhoto === true` (item 100); `/recipes/<id>/edit` of an
    unknown id says so. «A gate on a door is a gate on everything later put behind it.»
61. **`showAllergens` and `showNutrition` default ON**, read as `!== false` (`js/venue-features.js:35-52`): a
    document that has never heard of the keys, one that failed to load and one carrying a corrupt value all
    answer ON — the other direction would let a typo remove the part of the app that can send somebody to
    hospital. Only a literal `false` turns them off. They are display switches, never data switches (nothing
    is deleted; ticks, stamps and nutrition come back when switched on). **`recipePhoto` costs money and
    defaults OFF**: only a literal `true` counts (`catalogue-main.js:550`, `functions/recipe-photo-model.js:420`).
    `feedbackToClaude` is the same shape (off unless `true`). Not yet in `shared/` — `venue-features` is a pure
    file with zero imports. **spec** (`venue-features.test.mjs`)

## Labels — what is printed

62. **The chain**: recipe + ingredient table → `recipeAllergens` (the gate) → `flattenIngredients` →
    `buildLabel` → `resolveLabel` (layout and font size) → either `buildSheet` (the HTML paper, os-print road)
    or `toZpl` (the printer's own language, agent and clipboard roads). **Every function in this chain is a
    byte-identity target** (list in «What proves byte-identity»).
63. **The ingredient list** (`flattenIngredients`, `recipe-label-model.js:44`): only LINKED rows with a weighable
    unit and a weight > 0; **sub-recipes are FLATTENED, not named** (a row pointing at another recipe
    contributes that recipe's own rows scaled by `grams / weighable total of the sub-recipe`); **the same
    ingredient used twice is ONE line, summed** (keyed by ingredient id); sorted **DESCENDING by weight** (the
    law, not a preference), ties by name (`localeCompare`) so two runs give the same label; the printed name is
    `ingredient.name` (the invoice name), falling back to the English literal `Unnamed ingredient`; cycles and
    depth 4 end the walk. ⚠️ A row that is not weighable (a pinch, «to taste») or has no weight is **listed at
    0 g AFTER the weighed ones, by name** (PR #354, 13 Oct 2026 — it used to be left out while its allergens
    reached «Contains», Findings C); nutrition and the «no-ingredients» refusal still look at weighed rows only. **spec**
    (`recipe-label-model.test.mjs`)
64. **`buildLabel(recipe, tables, { shows })`** (`:155`): `{ ok:false, reason:'not-declared', gaps }` when
    `canLabel` is false (**the one gate**, asked once at the top), `{ ok:false, reason:'no-ingredients' }` when
    nothing weighable remains; otherwise `{ ok, shows, name, ingredients:[{id,name,grams,allergens,emphasise}],
    allergens, mayContain, nutrition, nutritionMissing }`. `shows` ∈ `allergens | nutrition | both` (anything
    else → `both`) decides what is WORKED OUT: asking for allergens only does not compute nutrition, so an
    ingredient without a nutrition table cannot block an allergen label. ⚠️ A nutrition-only label still needs the
    full allergen declaration. **spec** (`recipe-label-model.test.mjs`)
65. **Nutrition per 100 g of the FINISHED food** (`nutritionPer100g`, `:104`): the sum over the flattened
    weighable linked rows divided by `grams × (1 − lossPct/100)`; ONE ingredient without a full table → NO table
    at all (null), never a partial sum; rounding: energy whole, salt two decimals, others one; `yieldGrams` and
    `lossPct` ride along. The loss is the recipe's stored `lossPct` (Food cost writes it, item 11). **spec**
    (`recipe-label-model.test.mjs` «PER 100 g OF THE FINISHED FOOD»)
66. **The text builders** (`ingredientLine`: allergen rows in CAPITALS, comma-joined; `containsLine` and
    `mayContainLine`: `«{word}: {names joined by ", "}»`, empty when there are none, never «Contains: nothing»;
    `declarationText(label, lang, { withNutrition })`: name, `Ingredients: … .`, contains, may-contain and — when
    asked — `Typical values per 100 g:` then one two-space-indented row per nutrient `name: value unit`).
    `lang` defaults to `'en'` so a forgetful caller prints what the app always printed, rather than nothing.
    **spec** (`recipe-label-model.test.mjs`, `recipe-declaration.test.mjs`)
67. **One builder for every hand-over of the text**: the recipe card's Send/Copy and the label screen's
    Copy/Send call the same `declarationText` (the label screen WITH the nutrition table, the recipe card
    without). Three places assembling it is three texts that can disagree about what is in somebody's food.
68. **The label screen** (`label-view.js`), in order: a three-way switch (Allergens · Nutrition · Both, session
    only — `labelShows` lives in `catalogue-main.js`, not stored) · the **paper preview** at its real
    millimetres · its note · the «does not fit» sentence · the readable **card** (name, `Ingredients: …`
    with allergens bold+underlined, Contains, May contain, the nutrition table or the sentence that it cannot be
    worked out, «Values are on the finished weight (−{n}%)» when the loss > 0) · the language note · the caveat
    («Check this before it goes on food») · the action row: **Print · Copy · Send · status**. The screen
    refuses, with a title and one sentence each, when: allergens are off, the country is unknown/unsupported, the
    recipe is not fully declared (`{n} ingredient(s) is/are not declared …`), or nothing has a weight (a recipe with no rows at all says that too — the current app says «0 ingredients are
    not declared»; Mise 2 fix, 25 Oct 2026). If the
    paper cannot be laid out (`resolved.ok` false) it falls back to card + caveat + Copy + Send (**no paper is
    not no screen**).
69. **The preview and the print are the SAME NODE** built by the same function at the same millimetre size
    (`buildSheet`, `label-print.js:38`), so they cannot disagree. The sheet is `widthMm × heightMm` with
    `padding: marginMm`, `font-size: fontMm mm`, `line-height`, one `<p class="lab-sheet-block lab-sheet-{role}">`
    per block with `font-size: {scale}em` and `margin-bottom: {gap}em` (last block 0); the ingredients block is
    `prefix` + one `<span class="lab-sheet-ing [lab-sheet-ing--allergen]">` per ingredient joined by `, ` and a
    closing `.`. Scales come from the MODEL (`BLOCK_SCALE`), never the stylesheet. ⚠️ **Run-time class names**:
    `lab-sheet-${block.role}` over the eight roles (`name, ingredients, contains, mayContain, netWeight, date,
    storage, business`), `lab-sheet-ing--allergen`, `lab-print--${sizeId}`, `lab-switch-btn--on` — a «no file
    names this class» check would delete printed-label rules with every test green. **spec**
    (`label-print.test.mjs`, 32 tests)
70. **The profile** (`normalizeLabelProfile`, `label-template-model.js:152`): defaults are the SAFE ones —
    76 × 51 mm, margin 2.5, base font 2.6 mm, 203 dpi, printer `os`, **every full-label block OFF and empty**
    (`showDate/Weight/Storage/Business === true` only; the allergen switches take the opposite direction),
    `dateKind: 'useBy'` (the stricter statement). A measurement outside its range or of the wrong type (a boolean
    is NOT a number — `Number(true)` is 1) falls back to the default; unknown printer language/dpi falls back;
    texts are trimmed and cut to 200. Sizes: presets `p76x51`, `p57x32`, `p102x76`; any other pair is custom
    (20–300 mm). **spec** (`label-template-model.test.mjs`)
71. **The blocks and their order** (`blocksFor`, `:255`) — the order a label is read in, not a preference:
    name · ingredients (`prefix` = `labelWord('ingredients') + ': '`, parts with `emphasise`) · contains ·
    mayContain · netWeight · date · storage · business. The full-label blocks print only when their switch is on
    AND there is a value (**a switch with nothing behind it prints nothing, not a heading**): net weight
    (`netWeightText`: grams under a kilo as a whole number, kilos to one decimal, in the country's locale — «1,2
    kg» in Italy, a decimal point read as a thousands separator is a label claiming a thousand times the weight),
    date (`«{useBy|bestBefore word} {dd/mm/yyyy}»`, four-digit year, country locale), storage
    (`«Storage: {text}»`), business (`«name, address»` — one block; half an address is printed rather than
    nothing). **spec** (`label-template-model.test.mjs`)
72. **The date is worked out from the day it is PRINTED** (`useByDate(shelfLifeDays, new Date())`), never stored
    on the recipe; a missing shelf life gives NO date (never today's), 0…3650 are valid, booleans/blank/junk are
    «nobody said». The label screen recomputes it on every paint. The device's clock and time zone decide «today».
    **spec** (`label-template-model.test.mjs`)
73. **The legal floor** (`minFontMm`, `resolveLabel`, `:242`, `:392`): the regulation measures x-height — 1.2 mm,
    0.9 mm when the label is under 80 cm² — and the font floor is `xHeight / 0.52` (rounded to 0.01); the layout
    starts at `max(baseFontMm, floor)` (never above what the venue chose, never below the floor) and steps down
    by 0.05 mm while the text does not fit and stays at or above the floor. **Text is shrunk to the floor and
    below that the answer is «this will not fit» — never a list with its end missing.** `fits: false` is a
    warning, not a refusal: the caller still has something to draw (the person sees the problem). The fit here
    is an ESTIMATE (`linesFor`: average glyph 0.52 em, line height 1.28, block gap 0.45 em, greedy word wrap, a
    word longer than the line breaks inside itself). **spec** (`label-template-model.test.mjs`)
74. **The measurement is the gate, the estimate is not** (`fitSheet`, `label-print.js:117`): the browser renders
    the sheet in the document, reads `scrollHeight − clientHeight > 1 px` as an overflow, steps the font down by
    0.05 mm to the floor and reports `{ fits, measured }`. ⚠️ **A sheet that is not in the document measures
    zero, which reads as «fits» — so an UNMEASURED sheet never reads as fitting and the Print button stays
    disabled** until `mounted()` has measured it. The stylesheet clips (`overflow: hidden`) so an overflow is
    detectable. The preview is then scaled DOWN (`fitPreviewWidth`, transform `scale(f)` from `top center`,
    up to three passes because a vertical scrollbar changes the width) when the phone is narrower than the paper
    — and says «actual size» only when it is telling the truth. **spec** (`label-print.test.mjs`)
75. **Emphasis depends on the printer**: `bold` (+ underline in CSS) for the OS dialog; **CAPITALS** for a ZPL
    printer, which has no bold inside a wrapped paragraph — the preview obeys the same mode (what is on screen
    is what comes out). Capitals are wider, so the fit estimate measures the emphasised text.
    **spec** (`label-template-model.test.mjs`, `label-zpl.test.mjs`)
76. **ZPL** (`toZpl`, `label-zpl.js:108`) — `^XA`, **`^CI28` first** (UTF-8: without it «Può contenere» prints as
    «PuÃ² contenere»), `^PW`/`^LL` in dots (`203 dpi = 8 dots/mm`, `300 dpi = 11.811`), `^LH0,0`, `^LT0`, then per
    block `^FO x,y` · `^A0N,h,h` · `^FB width,maxLines,0,L,0` · `^FH` · `^FD{escaped}^FS`, an optional
    `^PQ n` (copies > 1 only, capped at 99), `^XZ`, lines joined by `\n`, ending with `\n`. `^`, `~` and `_`
    in a product's text are written as `_5E`, `_7E`, `_5F` (an ingredient called «Aroma ~ naturale» would
    otherwise end the label early). **`^FB` is given MORE lines than the text needs** (`lines + 2`, ZPL ceiling
    9999) because a field block that has too few DROPS the rest on the printer in silence — overflow is the
    lesser harm. The ZPL width estimate uses its own glyph width (0.58 em, errs wide). `zplFits` /
    `zplHeightMm` is never less cautious than the screen's. Nothing is generated for a label that was not built
    (`''`). **spec** (`label-zpl.test.mjs`, 20 tests)
77. **The roads to a printer** (`print-transports.js`), in OFFER ORDER: **`agent`** (queue the ZPL for the shop
    computer; needs a fresh heartbeat), **`os-print`** (`window.print()` of an off-screen `#labelPrint` host, a
    direct child of `<body>>`, removed on `afterprint`, never called `.preview-overlay`), **`zpl-clipboard`** (copy
    the ZPL — clipboard only, never the share sheet, never a file download). `roadsFor(resolved, { printerReady })`
    keeps a road only if the venue's printer can read its renderer (`html` roads only when `printerLanguage !==
    'zpl'`; `zpl` roads only when it IS `zpl` AND `zplFits`) and the agent road only while the computer answers.
    `availableTransports` asks `available()` AT PAINT TIME (a function, never a value frozen at import; a road
    whose `available()` throws is absent). `whyNoRoad` tells **«too big for the printer»** from **«no device can
    reach a printer»** (they send people to fix different things). **spec** (`label-print.test.mjs`)
78. **The Print button says what it will do** (`label.print.viaAgent` «Print», `…viaSystem` «Print dialog»,
    `…zplCopy` «Copy the printer code»), is **disabled, not hidden**, while the sheet is unmeasured, does not
    fit, or no road exists, goes dead while the job is in flight (two taps is two labels), and reports:
    agent → **«Sent to the shop computer — it prints it»** or «Could not send it — try again» (**«sent», never
    «printed»** — raw bytes to a printer come back with nothing); zpl clipboard → «Copied — paste it onto the
    printer on the shop computer» / «Copy failed»; the OS dialog is its own receipt. **A fallback road may
    replace the road, never the explanation**: «The shop computer is not answering …» is shown even when «copy
    the printer code» is available. The four sentences are told apart: doesn't fit (with the paper size and the
    sentence that nothing is ever shortened), shop computer silent, no road on this device. A successful send
    fires the usage action `label-printed`. There is NO copies box — a label is one copy (`queue(zpl, copies)` is
    called with 1). **spec** (`label-print.test.mjs`)
79. **The queue and the agent** (`print-queue-model.js`, shared by the app and `print-agent/agent.mjs`): states
    `queued → claimed → done | failed`, nothing else (a claimed job is NEVER put back — the paper may already be
    out); `MAX_JOB_CHARS = 20 000`; `MAX_COPIES = 99`; `buildJob` refuses empty text, an oversize job, no author
    or no venue (null — «print before a location is open» is impossible, not unlikely) and clamps copies;
    `isSingleLabel` is the agent's gate (**exactly one `^XA…^XZ`, no `~` anywhere, only the 14 commands the app
    writes** — `XA XZ CI PW LL LH LT FO A0 FB FH FD FS PQ` — and at most one `^PQ` of 1…99); `printerPresence`
    (heartbeat every 4 min, **stale after three missed beats**, a never-written or future-dated beat counts as
    ABSENT); `expiredJobs` and `nextJob` (oldest first by `createdAt`, nothing older than 24 h is printed).
    ⚠️ **The agent runs from a checkout of this repository and IMPORTS `js/print-queue-model.js` and reads
    `js/firebase-target.js` as text — no copy exists, and none may** (`tests/print-agent.test.mjs:19`,
    `print-agent-config.test.mjs`). Whatever Mise 2 does at the switch, **those two files must stay in the
    repository**, and a ported `shared/src/print-queue-model.ts` must be pinned against the `js/` file, not
    replace it. **spec** (`print-queue-model.test.mjs`, `print-single-label.test.mjs`, `print-agent.test.mjs`)
80. **Printing needs the stylesheet** (`label-print.css`): black on white (a thermal printer burns a dot or it
    does not — no tokens for the sheet), `.lab-sheet { box-sizing: border-box; overflow: hidden;
    overflow-wrap: anywhere; font-family: var(--font-round) }`, names and the Contains line bold, `.lab-sheet-ing
    --allergen` bold + underline, **`@page` rules** (`size: auto; margin: 0` plus named pages `p76x51`,
    `p57x32`, `p102x76` that a `lab-print--{id} .lab-sheet { page: … }` rule selects — a custom size falls
    through to `auto`), and in `@media print` ONE derived rule `body > *:not(#labelPrint) { display: none
    !important }` (a list of class names would go stale on an output nobody previews) plus
    `print-color-adjust: exact` on the allergen emphasis. **No inline `style="…"` string and no `<style>` block**
    anywhere (CSP `style-src 'self'`): every variable value goes through the CSSOM. **spec**
    (`label-print.test.mjs`)

## Label settings (the Settings screen of this section)

81. **«Settings» (owner/manager only)** is three cards, every control saving on the tap (`catalogue-settings.js`):
    (1) **Read recipes from a photo** switch (item 100); (2) **Label printing**: the paper (presets as segments +
    «Custom» with width and height boxes in mm, 20–300), the printer (`os` / `zpl`), the resolution (203/300 dpi,
    **only when the printer is `zpl`** — through the OS dialog the driver owns it), the date switch and, when on,
    **which date** (use by / best before, with the sentence that they are not interchangeable); (3) **What else
    goes on the label** (for food sold elsewhere): net weight, storage (+ text), business (+ name, address) with
    a hint when a switch has nothing behind it. A setup note says the first print comes out the wrong size until
    the driver and print window are set. Rules that must hold:
    - **a custom size is saved when the field is LEFT (`change`, never `input`) and width + height are ONE
      write** (350 ms settle) — typing «102» must not save 1, then 10; two writes in flight once left the old
      height behind;
    - free-typed lines save on leaving the field, never per keystroke;
    - **all writes are queued in order** (each `.catch` before the next) — two saves close together are two
      independent `setDoc(merge)` with no ordering guarantee, and the old height came back;
    - the screen changes first and **rolls back with «Could not save — the change has been put back»** if the
      database refuses, and the store rolls its own copy back too (`catalogue-store.js:206-218`): a paper size
      that looks saved and was not is a label that prints wrong tomorrow;
    - a box is shown only when the block that prints it is on; text boxes are not rewritten under a focused caret.
    The two label boxes in the recipe editor (net weight in g, shelf life in days) appear only when the profile
    has `showWeight` / `showDate` on, with a note, and an emptied box is a removal (item 11).

## Links with other sections

82. **Import into the Calculator** (`import-to-calculator.js`, `catalogue-model.js:641-706`): copies a recipe into
    `config/calculator.recipes[]` as an INDEPENDENT pro-rata recipe `{ id: 'cat-' + recipe.id, name, logic:
    'total', ingredients: [{label, grams: round(weighable grams)}], visible: false }`. A confirm first; **«nothing
    to import» when no row is weighable**; the rows that cannot come (pieces, spoons, pinch, «to taste») are named
    in the confirm. Re-importing **updates in place** (matched by `cat-<id>`), keeping the tab's `order`,
    `visible`, `logic` and `trayWeight`; otherwise appended. The write is a **transaction** (`runTransaction`,
    `firebase-catalogue.js:250`): read the raw config, `normalizeConfig`, merge, **`configRev + 1`**, re-normalise
    (which carries `configModel`), stamp `bakery` in the data layer — so a concurrent Calculator save notices and
    preserves the imported recipe (the Calculator's `reconcileConfigWrite`, already in Mise 2's save path).
    Success toasts «added» / «updated»; failure `permission-denied` → `calc.notSavedOutOfDate`, anything else →
    `cat.importFailedCheckYour`. The copy and the original are independent (nothing links them afterwards).
    **spec** (`catalogue-model.test.mjs`, `calculator-trays.test.mjs`)
83. **Delete warns when the recipe was imported** (`confirmAndDelete`, `catalogue-main.js:814`): the check is
    `findCalculatorImport(config, id)` on a one-off read of `config/calculator`, **raced against 2.5 s** (a slow
    or offline read never blocks a delete; any error = «not linked»); the confirm is `danger`, the message adds
    «It was imported into the Calculator; that copy stays». It does NOT warn about Food cost products or tabs
    linked by `catalogueId` (Findings G). **spec** (`catalogue-model.test.mjs` `findCalculatorImport`)
84. **The Calculator's other link — `catalogueId` on a recipe tab — is the Calculator's.** It reads this
    collection's recipe live, one by one, by id; `ridOf`/`withRowIds` (already in `shared/guided-model.ts`) stamp a
    `rid` on every row of a recipe a tab links to. What this section owes that link: **a row's `rid` is stable —
    a save never drops or regenerates it** (item 24), ids are random (never sequential: two phones offline would
    each mint `r4`), and deleting or renaming a recipe leaves the tab saying «cannot be read» rather than guessing.
85. **«Open in Food cost»** (`foodCostPanel`, `catalogue-detail.js:120`): a card (only for whoever may open Food
    cost) with a one-line note and a button that goes to `foodcost.html#recipe=<id>` (a FRAGMENT, never `?recipe=`
    — the service worker looks pages up by exact request, and offline a query string finds nothing). Food cost
    decides what opens: the one product that uses the recipe; several → the list narrowed to them; none → a NEW
    unsaved product with the recipe on its first line (`productsUsingRecipe`, `draftFromRecipe`, already in
    `shared/foodcost-model.ts`). Its Back returns to `catalogue.html#recipe=<id>` — one level up, where the tap
    came from — by `location.replace`, never `href`. **This is the link `docs/parity/foodcost.md` deferred to
    this step**: Mise 2 needs the address in BOTH directions, the recipe's card here and Food cost's «came from a
    recipe» entry and Back. **spec** (`foodcost-from-recipe.test.mjs`)
86. **«Go to Orders»** (header shortcut, list and recipe only, `mayOpenOrders`): `orders.html#from=catalogue` or
    `#from=recipe:<id>`; Orders reads it with the strict `catalogueOriginFromHash` and offers the way back. Depends on Orders
    (not built in Mise 2) — Questions 9.
87. **A missing ingredient can be created from a recipe row** (`+ Create "…" as an ingredient`, only where
    `mayEditRecords`): the same card «Ingredients & suppliers» uses opens above the editor, nothing typed is lost,
    and the row is linked to the new ingredient once it is saved (a `packaging` result is refused). Depends on
    Orders — Questions 9. **Built in T15** (step 3e): the last row of the suggestions (after «See all», it may be the only
    one) and the last button of the chooser, `cat.createIngredient`, shown only for a typed name no ingredient holds (the
    set the chooser offers) and where `mayEditRecords`; the card is `records/IngredientCard` in a dialog (a full screen
    below 700px) opened by `suppliers/CreateIngredientOverlay`; decisions O1–O5 in `docs/parity/suppliers.md`, T15.

## The editor

88. **Editing works on a copy** (P20): a working copy of the recipe with every row spread (`{ ...i, unit }`),
    nothing touches the stored recipe until **Save**. Save lives in the header (one Save, prominent); Delete is
    small and low-key at the bottom, `canManage` only, absent for a new recipe. Save is checked first
    (item 30), then confirmed («Save recipe?»), then **local-first**: the list updates at once and the
    Firestore write follows; a REJECTED write rolls the optimistic change back and shows «Couldn't save “{name}”
    — check your connection.» (`catalogue-store.js:380-384`). After a successful save: toast
    «Recipe saved» / «Recipe added», usage action `recipe-saved`, **back to the list**.
89. **Leaving with unsaved edits asks** (`Discard changes?` — Discard (danger) / Cancel), through every way out
    (Back, the browser's Back, the rail) — a draft read from a photo STARTS dirty. The screen holds `markBusy()`
    while dirty (Mise 2 rule). A new recipe starts empty with placeholders (P20): name, one empty row `g`.
90. **Rows**: name · amount · unit (a native `<select>` with the 12 units, words from `unitText`, own chevron) ·
    remove (trash). **«To taste» hides the amount box but never clears the number** (switching back gives it
    back; `ingredientGrams` is 0 for non-weighable units so a total/cost/label cannot move). The last remaining
    row is emptied, not removed. A live **Total** (weighable grams) with a note «{n} ingredient(s) not weighed»
    (dictionary plural). Amounts accept decimals (`step any`).
91. **Linking a row** — under each name, as it is typed: a short suggestion list of ingredients (and recipes)
    (`suggestLinks`: ≥ 2 characters, ≤ 5 shown, ranked starts-with → word-start → inside, ingredients BEFORE
    recipes, names only never the supplier, `total` so «See all (n)» can open the full chooser already searching
    what was typed, a «+ Create "…"» row only when allowed and no ingredient of exactly that name exists), and a
    link line («→ name · weight · supplier» / «Link to an ingredient» / «An ingredient that no longer exists» /
    «→ name · Recipe»). The full-screen chooser (`openLinkPicker` over `linkOptions`) has Ingredients and
    Recipes sections, a «Remove the link» row only when there IS a link, and three answers that must not be
    confused: **chosen / link removed (`null`) / dismissed (`undefined` — cancel must not clear a link)**.
    Deactivated ingredients and `kind: 'packaging'` are never offered; a recipe is not offered to itself
    (`excludeRecipeId`). **A person's pick SETS the row's name to the linked item's display name** (9 Oct 2026,
    reversing 13 Sep) — but only when the pick CHANGES the link; re-picking the same one never undoes a name
    typed since; removing a link keeps the name; saved recipes are not renamed on opening. After a pick the
    focus moves to that row's amount. **spec** (`catalogue-model.test.mjs`, `link-suggestions.test.mjs`
    for the shared suggest list, `recipe-weights.test.mjs`)
92. **Reordering the rows** is a MODE («Reorder» / «Done»), not a grip on every row (at 296 px a row already holds
    four controls): in it each row is grip + name + amount; drag (held 200 ms on touch) or arrow keys; the SAME
    row objects move (`moveRow`) so a row keeps its link and its `rid` — **reordering never unhooks a mixing
    step**; focus returns to the grip that moved; Save with a row to fix leaves the mode first so the bad field
    can be shown; no new row while reordering. **spec** (`catalogue-reorder.test.mjs`)
93. **«Fill from a photo»** appears only on a NEW recipe, only when `recipePhoto === true`, last on the page. It
    asks first if anything was typed («replace what you typed?»); the typed copy travels with the navigation and
    comes back if the read is abandoned (Back from the photo screen returns to the editor once, the one-shot
    consumed at once).

## Guided mixing (steps editor, run, resume, alarm)

94. **A procedure** is `steps: [{ text, rows: [rid…], seconds, speed }]` stored ON the recipe (`guided-model.js`):
    ≤ 100 steps (the rules cap the count; the contents are capped here only), text ≤ 300, speed ≤ 24 chars,
    seconds ≤ 12 h, `endNote` ≤ 300; junk never gives NaN or a negative time; an entirely empty step is dropped;
    a row named twice in one step is added once. **A step points at a row by its `rid`, never by name and
    never by position** (renaming Flour must not drop it from the step; inserting a row at the top must not make
    the butter step ask for the yeast). **`unassignedRows`** — rows named in no step — is the safety net of the
    whole feature and is shown while writing AND at the end of a run (a warning, not a block: dusting flour is
    legitimate); **`missingRefs`** — a step naming a row since deleted — is shown as «no longer in the recipe»,
    never silently dropped. **spec** (`guided-model.test.mjs`, 50+ cases)
95. **The steps editor** (`guided-editor.js`): working copy, header Save with a confirm (`saveStepsFor` / `noProcedureFor`
    — saving an empty procedure is allowed and deletes it), leave guard, **the ingredients are saved with the
    steps** (the `rid`s have to be minted and stored alongside the steps that reference them; labels, amounts and
    units are copied through untouched). Per step: text, tick boxes over the recipe's own rows (ticking, not
    typing — a typed name would be a copy free to drift), minutes + seconds as two boxes (not one «4.5»),
    mixer speed, move up / move down / remove (confirmed). Summary line, "every ingredient is in a step" / the
    warning, the closing message in a textarea at the BOTTOM (where it appears when run). After Save: toast
    «Procedure saved» and the recipe opens; usage action `procedure-saved`.
96. **The run** (`guided-run.js`) — the screen with hands in dough: ONE instruction at a time, amounts big enough
    to read from a step back, a countdown that is right whatever the phone did. ⚠️ **Nothing counts seconds**:
    a timer is stored as the wall-clock instant it ENDS (`endsAt`) and everything is derived by comparing it with
    the clock (a throttled or suspended tab would drift); the 250 ms interval only repaints; coming back repaints
    at once (`visibilitychange`). `timerState` is `idle | running | finished` (no fourth); `formatDuration` is
    `mm:ss` / `h:mm:ss`, a finished timer reads `00:00`, a part-second left rounds up; coming back late says how
    late («Time was up 5 min ago»). The run works against a **FROZEN SNAPSHOT** taken on Start (name,
    ingredients, steps, end note, target) — a recipe edited on another phone must not change amounts under
    somebody's hands. The amounts are `amountsFor(snapshot, target)` = the recipe screen's own `scaleCatalogue` /
    `baseAmounts` (a second implementation would be two doughs). Controls: Start the timer / Skip the timer /
    +1 min / Done early / Step done / Done — finish; a speed CHANGE between steps is announced once (flash) and
    the badge lasts the step; the first step after a resume announces nothing (`null` = «we do not know»). The
    finish card: «Dough finished», the closing message, and every row no step mentioned. Leaving mid-dough
    asks («Leave the guided mix? You are on step 3 of 9») and KEEPS the session either way.
97. **Resume** (`isResumable`, `RESUME_TTL_MS` = 24 h): the saved session (`catalogue-guided-run`) is offered
    ONCE per page load from the list («Carry on mixing? … part-way through», Carry on / Not now — «Not now» keeps
    it) and as a «Resume — step N of M» button on the recipe. Refused when: no recipe id/snapshot, no steps, a
    step number outside the procedure (refused, not clamped), a non-finite time, **a clock that went backwards
    (age < 0 = stale, not fresh)**, older than 24 h, or the recipe has since been deleted. A resume against a
    session that aged out says «That mix is no longer available — start it again.» and clears it — never a silent
    fresh run. Finishing clears the session. **spec** (`guided-model.test.mjs`)
98. **The alarm** (`guided-alarm.js`): a FILE (`sounds/alarm.wav`, 1 s, looped; not a `data:` URI — blocked by
    the CSP — and not Web Audio, which iOS silences with the ring switch), **authorised at the tap that starts
    the timer** (played muted for an instant), rung once per step when it ends, stopped after 60 s, with a
    vibration pattern repeated while it rings (Android only), and **never the only signal** (the screen is lit by
    the wake lock, the card turns). `isRinging()` exists so the alarm can be proved. The screen is kept awake
    while the run is open (`js/wake-lock.js`, counted by owner, re-requested when the page becomes visible).
    The `.guided-run` marker holds back a compulsory update reload while a mix is on screen
    (`js/update-gate.js:62`) — in Mise 2 that is `markBusy()`.
99. **The phone notification** (`js/push.js`): at Start of a timed step the run books a `push-timers/{recipeId-
    startedAt-stepIndex}` document (the server, `scheduleTimerPush`, sends the FCM message at `fireAt`),
    **never waited on** (a Start button that hangs on the network while a mixer runs costs the dough), cancelled
    by MARKING `active: false` (not deleting) when the step is finished, skipped or left, and cancelled
    immediately if the step ended while the booking was in flight. A line under the card tells the truth about
    THIS phone — «It will also send a notification», an offer to enable it, or why not (blocked / not installed /
    iPhone-in-Safari) with the honest instruction to keep the screen open. Not in Mise 2 yet — Questions 6.

## Reading a recipe from a photograph

100. **Opt-in per venue, default OFF, owner/manager switch** (item 61, 4, 81): `recipePhoto === true` on
     `locations/{lid}`, thrown through the `setRecipePhoto` callable after a confirm that **says what it costs**
     (`cat.photo.turnOnBody`); the phone's copy of the venue document is refreshed from the server
     (`refreshVenueFromServer`) and the switch's state is held locally until the next load. The result toast uses
     the server's own words when it has any.
101. **The screen** (`photo-capture.js`): up to 5 photographs (`MAX_PHOTOS`), `accept image/jpeg,png,webp`,
     `capture="environment"`; each file is decoded with `createImageBitmap(file, { imageOrientation:
     'from-image' })` (the EXIF flag — ignored, the reader gets a photograph lying on its side and answers with
     confident nonsense, no error anywhere), drawn on a canvas **at most 1568 px on the long edge, never
     upscaled**, JPEG 0.82, **quality drops to 0.7 before size does** if over 2 MB; thumbnails use the data URL
     (CSP `img-src 'self' data:`; no `blob:`); HEIC from the library is «cannot read that format — use the
     camera». Payload checks run on the phone too (`payloadProblem`: ≤ 5 images, ≤ 2 MB each, ≤ 6 MB total).
     **It is the ONLY screen that cannot work offline** and says so (`navigator.onLine === false` → «No connection.
     The photo has not been sent»); it marks itself busy while the call is in flight (`.cat-photo-busy`: a
     reload would throw away a paid read).
102. **The call** (`readRecipeFromPhotos`, `us-central1`, **client timeout 120 s which must stay ≥ the
     function's own 120 s**, or the phone abandons a call that is already paid for — `photo-timeouts.test.mjs`):
     the `locationId` is read AFTER `sessionReady` at call time, never passed in. **Costs**: model
     `claude-sonnet-5`, about 1.4 p per read (3318 input + 280 output tokens measured), `maxInstances 10`,
     daily allowance **40 images per person and 150 per venue**, **charged before the reader is called and never
     refunded** (a refund path is a way to read for free by making the call fail), secret `ANTHROPIC_API_KEY`, a
     spend limit set on the key itself outside the repo. The server checks sign-in, membership, `sections.catalogue`
     on and `recipePhoto === true`; employees may use it, the SWITCH is owner/manager. Server caps mirror the
     rules (name ≤ 199, ≤ 300 rows, label ≤ 120, amount ≤ 1 000 000, units only the 12). **spec**
     (`recipe-photo-model.test.mjs`, `recipe-photo-handler.test.mjs`, `photo-image-model.test.mjs`,
     `photo-timeouts.test.mjs`)
103. **NOTHING IS SAVED BY A READ**: the answer becomes a **draft** opened in the ordinary editor as a working
     copy that waits for the same Save and the same «Save these changes?» as a recipe typed by hand (100 g read as
     1000 g looks exactly like a number somebody typed). The draft carries no oven loss; `netWeightG`/`shelfLifeDays`
     only when present; a capped list (> 300 rows) toasts «only the first rows were read». «Nothing found», «the
     reader refused», «too long» are NOT failures (the call worked) and each has its own sentence; only «no
     connection» may mention the connection. All 19 codes (16 distinct sentences) are in `photo-model.js` `BY_KEY`.

## Offline, local-first, errors and accessibility

104. **Everything paints from the local copies first** (item 21) and works offline, except the photo reader and
     the print queue (which say so). **A subscriber that throws never stops the data**: the store's notify
     callback is `guarded(…)`. **spec** (`store-notify-guarded.test.mjs`)
105. **A live-sync failure is a toast**: «Live sync interrupted — recipes may be out of date.» (the recipes
     listener only; ingredients, suppliers, label config and agents fail quietly, items 13, 14, 16).
106. **One part failing never takes the screen down** (P17): the list and the detail are separate parts; a
     recipe that cannot be drawn is skipped, not fatal; the allergen sheet shows the other rows.
107. **Error and status sentences that must exist in both languages** (key → English, from `js/i18n.js`):
     `cat.pleaseEnterARecipe` «Please enter a recipe name.» · `cat.addAtLeastOne` «Add at least one ingredient
     with a name.» · `cat.enterAnAmountFor` «Enter an amount for at least one ingredient.» ·
     `cat.couldNotSaveRecipe` «Couldn’t save “{name}” — check your connection.» · `cat.couldnTDeleteThe`
     «Couldn’t delete the recipe — check your connection.» · `cat.recipeDeleted` «Recipe deleted.» ·
     `cat.nothingToImport` «This recipe has no weight-based ingredients, so there’s nothing to import.» ·
     `cat.importFailedCheckYour` «Import failed — check your connection and try again.» ·
     `cat.liveSyncInterruptedRecipes` · `cat.thatMixIsNo` «That mix is no longer available — start it again.» ·
     `cat.alg.notDeclaredCount` · `cat.decl.blocked` «Not ready yet — some ingredients are still to be declared.
     The allergen card above says which.» · `label.blocked` «No label can be made» (+ `.noWeights`,
     `.allergensOff`, `.notDeclared`, `.noCountry`) · `label.print.queued` / `queueFailed` / `printerOffline` /
     `tooBig` / `noRoad` / `zplCopied` · `label.settings.saveFailed` · the 16 `cat.photo.err.*`. (Full set:
     ≈ 330 keys; the specs `catalogue-whole-sentences`-style key walkers become typed in Mise 2.)
108. **Accessibility** (P18): headings are real (`h3` for the cards — never a button that opens nothing); icon-only
     buttons carry a translated `aria-label`; the full-screen view is a button with `aria-pressed`, named by its
     state; the allergen head is a disclosure button (`aria-expanded`); states are words; segments are
     `aria-pressed` groups with names; switches are `role="switch"`; focus goes into a new view; **focus stays
     where it is on a live redraw**; destructive and confirm dialogs are the app's own. Contrast: the label card
     and the sheet are black on white by design; screen chrome uses tokens.

## What proves byte-identity — and what cannot be proved by a test

109. **The functions that produce PRINTED OR SENT bytes, and the test that pins each today:**

     | Function (file) | Output | Pinned by |
     |---|---|---|
     | `allergenName`, `allergenGroupName`, `allergenGroupCodes`, `nutrientName`, `labelWord` + tables (`market.js`) | every food word | `market.test.mjs` |
     | `ALLERGENS`, `normalizeAllergens`, `isDeclared`, `normalizeNutrition`, `hasFullNutrition` (`allergen-model.js`, **already ported & paired**) | codes, states | `allergen-model.test.mjs` |
     | `recipeAllergens`, `canLabel`, `rowState` (`recipe-allergen-model.js`) | the gate and the lists | `recipe-allergen-model.test.mjs` |
     | `flattenIngredients`, `nutritionPer100g`, `buildLabel` (`recipe-label-model.js`) | the ingredient order, the emphasised rows, the nutrition numbers | `recipe-label-model.test.mjs` |
     | `ingredientLine`, `containsLine`, `mayContainLine`, `declarationText` | the copied/sent text | `recipe-label-model.test.mjs`, `recipe-declaration.test.mjs` |
     | `normalizeLabelProfile`, `blocksFor`/`resolveLabel`, `blockText`, `netWeightText`, `useByDate`, `dateText`, `minFontMm`, `emphasisFor`, `emphasised` (`label-template-model.js`) | the blocks, the font size, the weight and date text | `label-template-model.test.mjs` |
     | `buildSheet` (`label-print.js`) | the HTML paper (OS dialog road) | `label-print.test.mjs` (reads source), + `label-print.css` |
     | `toZpl`, `escapeZpl`, `linesNeeded`, `zplHeightMm`, `zplFits`, `dotsPerMm` (`label-zpl.js`) | the ZPL string | `label-zpl.test.mjs` |
     | `buildJob`, `isSingleLabel`, `printerPresence`, `nextJob`, `expiredJobs` (`print-queue-model.js`) | the `print-jobs` document, the agent's gate | `print-queue-model.test.mjs`, `print-single-label.test.mjs`, `print-agent.test.mjs` |

110. **How Mise 2 proves it** (proposed, Questions 11):
     - **(a) Pure code, run against both files.** Every function above is ported to `shared/src/` with the usual
       `describe.each([ts, js])` spec and `parity.spec.ts` / `odd-inputs.spec.ts` entries, and `describe.each`
       also over a **fixture corpus** shared by the whole chain: ≥ 12 recipes (flat, sub-recipe, duplicated
       ingredient, a pinch row, «to taste», an `unknown` ingredient, a cycle, depth 5, a recipe with
       `lossPct`, with `netWeightG` / `shelfLifeDays`, every nutrition combination) × both countries (`GB`, `IT`,
       and one unsupported) × `shows` × three profiles (default, 57×32 + zpl 300 dpi, 102×76 + all full-label
       blocks on) × a fixed `madeOn` date and a fixed locale. For each combination the spec runs
       `buildLabel → resolveLabel → blockText → toZpl → declarationText → buildJob` through the `js/` file and the
       port and asserts **strict string/JSON equality**.
     - **(b) A committed golden file** generated ONCE from the `js/` originals
       (`shared/src/fixtures/label-golden.json`, produced by a script that is kept next to it), compared on every
       run, so the ported code stays pinned after the `js/` files are deleted at the switch.
     - **(c) The HTML sheet**: the printed sheet's markup is compared as `outerHTML` (jsdom), current `buildSheet`
       output against Mise 2's component, for the corpus. For that to be byte-equal **the sheet's class names and
       its stylesheet must NOT go through CSS modules** (hashed names would differ): the paper's CSS and `@page`
       rules stay a plain global file with the same class names (`lab-sheet`, `lab-sheet-block`,
       `lab-sheet-{role}`, `lab-sheet-ing`, `lab-sheet-ing--allergen`, `lab-print--{id}`, `#labelPrint`), and
       the variable values still go through the CSSOM (React's `style` prop) — `css-modules.spec.ts` needs an
       explicit, commented exception for that one file.
     - **(d) The measurement gate** (`fitSheet`, `fitPreviewWidth`) is browser-only (jsdom has no layout): port it
       taking the measurement as an injected function and unit-test the loop; the real answer is checked by one
       driven check (below).
     - **(e) A Mise 2 label-separation guard** equivalent to `i18n-label-separation.test.mjs` over the TypeScript:
       label modules may not import the interface-language hook's language/locale, the pure ones may not import
       the dictionary, every file that calls a label-word function is on the list, and the call that reads
       `outputLanguage(...)` exists in each drawing function.
     - **(f) Dates and numbers**: `Intl` output for `it-IT` / `en-GB` is part of the corpus (Node's full ICU); the
       spec fixes the clock instead of reading it.
111. **What no test can prove** — to be driven by the main session and by Federico's own eyes: the real browser's
     line breaks and `scrollHeight` (the fit gate) at the three preset papers, in English and Italian; the paper
     that comes out of a real Zebra (the ZPL has only ever been read, not executed, by tests); the OS print dialog
     honouring `@page` on his actual driver; that the installed agent claims a job written by Mise 2 and prints
     it (end-to-end on the shop computer, once, before the switch). The Playwright suite can compare a Mise 2
     label screen with the current app's at 76×51, 57×32 and 102×76 (measured `fits` and `fontMm` equal), which
     is the closest to automation that exists.

## Findings — things found while reading, not decided (the main session decides)

A. **Nutrition is never printed.** `blocksFor` has no nutrition block, so neither the HTML sheet nor the ZPL
   carries the table; it appears only in the on-screen card and the copied text. The «Allergens · Nutrition ·
   Both» switch changes the card and the text, not the paper. Parity keeps it; say it to Federico.
B. **`showNutrition` is never read by the Catalogue.** The label switch still offers Nutrition/Both (default
   `both`) on a venue that switched nutrition off in Orders, and the card then says the table cannot be worked out.
C. **(FIXED in both apps, PR #354, 13 Oct 2026 — kept for the record.) A weightless allergen row is missing from the printed ingredient list but present in «Contains».**
   `recipeAllergens` counts every row (a pinch of mustard is mustard), `flattenIngredients` skips rows that are
   not weighable or have no weight. So a recipe with «mustard, a pinch» prints `Contains: Mustard` with mustard
   absent from `Ingredients: …`. The law asks for every ingredient. **Health-related** — recommend telling
   Federico and fixing it in the CURRENT app first (e.g. list such rows after the weighed ones), then porting.
D. **The allergen sheet is not gated by `showAllergens`** — only its button is hidden. Harmless today (no other
   door); with addressable screens it would be reachable by typing the address (item 60).
E. **The guided editor has English literals** that the dictionary does not carry: `Step {n} instruction`,
   `Step {n} minutes/seconds/speed`, `Remove step {n}`, `e.g. 1`, `min`, `sec`; and `flattenIngredients` falls back
   to the English `Unnamed ingredient`. Mise 2 translates the first set (no risk); the label fallback is a label
   word and needs a decision (print the Italian word on an Italian venue).
F. **Recipe amounts are always formatted `en-GB`** (no grouping) whatever the language. Kept (a baker reads
   «1000», not «1.000»); the label's net weight and date, which follow the country, are different on purpose.
G. **Deleting a recipe warns only about a Calculator import**, not about a tab linked by `catalogueId`, a Food
   cost product line pointing at it, or a mixing session in progress. Food cost then shows the line as missing.
H. **The printed ingredient name is `ingredient.name`** (the invoice name), while every on-screen list uses the
   display name (`shortName`) — deliberate (`recipe-allergen-model.js:244`), but it means a label can carry a
   supplier's invoice wording.
I. **The label's date uses the DEVICE's clock and time zone**; a tablet with a wrong clock prints a wrong use-by.
J. **The copies count is always 1**: `queueLabelJob(payload, copies = 1)` and `^PQ` exist, but no screen asks.

## Questions for the main session

1. **Addresses, Back and the usage names.** Proposed routes (the first segment of an id can never be a reserved
   word — Firestore auto ids are 20 characters; a spec pins it): `/recipes` list · `/recipes/<id>` recipe ·
   `/recipes/<id>/edit` · `/recipes/new` · `/recipes/<id>/label` · `/recipes/<id>/steps` (write the procedure)
   · `/recipes/<id>/mix` (the run) · `/recipes/allergens` · `/recipes/settings` · `/recipes/photo`; the full
   screen, the link chooser and all confirmations stay dialogs. **Back goes ONE level up** (label → recipe,
   steps → recipe, run → recipe), P20 — the current app always returns to the LIST (`handleBack`), a change of
   result. Usage `mise:screen` names: `''`, `detail`, `editor`, `label`, `allergens`, `settings`, `photo`,
   `steps`, `run` as today, prefixed `m2:` by the existing mechanism. **Recommend yes to all of it.**
2. **Footer bar and tablet.** The current phone footer holds «Allergen sheet» and «Settings». Recommend: on a
   phone, the same two buttons at the foot of the list; on a tablet (≥ 1000 px, `SPLIT_QUERY`) list left and
   recipe right as in Food cost, with the same two buttons under the list; every other screen is full width.
   (The current 900×600 split query is replaced by the app's one 1000 px query — a lab tablet held upright
   gets the phone layout, as everywhere else.)
3. **Full screen and hold-to-zoom.** Recommend the Calculator's decision: a native `<dialog>` with −/+ and the
   six steps, sharing the component with the Calculator (a `storageKey` prop) and keeping `mise.catZoomStep`;
   hold-to-zoom stays unported.
4. **`showNutrition` on the label (Findings B) and nutrition on the paper (A).** Options: (a) parity — port
   exactly, raise A/B with Federico as separate current-app fixes; (b) hide the Nutrition choice when
   `showNutrition === false` in Mise 2 only. **Recommend (a)**; a label is not a place to differ from the
   current app silently.
5. **The weightless allergen row (Findings C).** Options: (a) port as is and pin the quirk with a test that
   names it; (b) fix both apps first (a current-app PR), then port the fixed behaviour. It is a health defect:
   **recommend (b)** — Federico's call — and (a) only if he wants to leave it.
6. **The mixing timer's phone notification, wake lock and sound.** Mise 2 has none of the push client, the wake
   lock or the alarm. Options: (a) port wake lock + sound + vibration in the guided slice and leave the
   notification booking (`push-timers`, FCM) to the step that ports the push client (Settings), the run showing
   the honest «keep this screen open» line until then; (b) port the push client inside this step. **Recommend
   (a)**; the notification must come back before the switch (it is a parity item, 99).
7. **Reading a recipe from a photograph in this step?** It is opt-in, default off, costs about 1.4 p a read and
   needs the callable and the key already in production. Options: (a) last slice of 3d; (b) defer to after the
   switch. **Recommend (a)** (nothing in Mise 2 is deferred past the switch, and the code is self-contained).
8. **Local copies.** Recommend Mise 2 reads and writes the SAME keys with the SAME shapes (item 21) so a phone
   moving between the two apps opens warm, as the Calculator and Food cost already do — except that the
   Catalogue's recipes are stored NORMALISED, so Mise 2's normaliser must be the ported one, byte for byte.
   Alternative: own `m2-` keys (cold start on every switch of app). **Recommend the shared keys.**
9. **Doors to sections that do not exist yet** (Orders, Ingredients & suppliers): the header «Go to Orders»
   shortcut and «+ Create “…” as an ingredient» on a recipe row. Options: (a) absent until those steps, tracked
   in a «Not built yet, needed before the switch» list as the Calculator's was; (b) link to the current app's
   pages. **Recommend (a).** The same goes for the allergen DECLARATION screens (items 20) — not here.
10. **Which recipes can be linked from the editor's row picker when Orders is off** (a venue with a catalogue and
    no Orders has no ingredient list): parity says the picker then offers recipes only and the link line says
    «an ingredient that no longer exists». Keep as is? **Recommend keep** (honest).
11. **How byte-identity is proved** (items 109–111): recommend (a)–(f) as written, including the golden file and
    the explicit CSS-modules exception for the paper's stylesheet. The alternative — CSS modules for the sheet and
    comparing only the ZPL and the text — would leave the HTML paper unproven. **Recommend the global
    stylesheet.**
12. **A Mise 2 label-separation guard** (item 55). Options: (a) a spec over the TypeScript sources (as the
    current test); (b) an ESLint rule. **Recommend (a)** — no new tooling; it runs in `npm test`.
13. **Where the Catalogue's data layer lives.** Recommend `app/src/recipes/` (the section id and path are
    `recipes`), one source file per collection group as in the Calculator (`recipesSource.ts` for recipes /
    ingredients / suppliers / `config/labels` / `print-*`), and the Calculator's and Food cost's recipe readers
    left alone (they read one document, or a map, for their own purposes).
14. **Delete warns more?** (Findings G.) Recommend parity in 3d-6, with a note to Federico; extending the
    warning to Food cost products is a result-changing decision.
15. **Copies.** No copies box exists (Findings J). Recommend not adding one.

## Proposed slices

Step 3d is about 11 000 lines of code plus ≈ 330 dictionary keys in two languages. Each sub-step ends in
something that works alone on the preview, on its own branch and PR (stacked), the most-used and riskiest first.
Everything goes through `backend.firestore()`; the section is lazy-loaded (`SECTION_SCREENS.recipes`); local
copies use the existing keys; every screen has an address and holds `markBusy()` while it has unsaved edits.
A slice that ports a label-word-using file also adds its entry to the Mise 2 separation guard (item 55) in the
SAME PR.

### 3d-1 — Looking at recipes: the list and the recipe screen

- **Works alone**: open the Recipe catalogue, search, most-opened first, open a recipe (phone: its own screen;
  tablet: list left, recipe right), see the ingredient list with units, set a batch in grams (confirm, warning for
  an absurd one, remembered 12 h, Clear), full screen with text size, follow live changes and deletion, a
  recipe named by its address. No editing, no allergens yet (the allergen/declaration cards arrive in 3d-2; the
  footer buttons are present but disabled-and-absent per gate until their slice).
- **Source**: `catalogue.html` (shape), `catalogue-main.js` (list/detail routing, wanted recipe, follow/redraw,
  tablet), `catalogue-list.js`, `catalogue-detail.js` (ingredients, batch, full screen — not the three cards),
  `search-box.js`, `tablet.js`, `catalogue-store.js` (recipes, usage, scaled, cache), `firebase-catalogue.js`
  (`watchRecipes`), `zoom-steps.js`.
- **Tests to port**: `catalogue-model` (normalisers, units, scaling, base amounts, batch warning, formatWeight,
  `isScaledEntryFresh`, `sortByUsage`, `filterByName`), `recipe-unit-text`, `catalogue-tablet-split` (as behaviour
  tests: list stays alive, open row marked, frozen usage, quiet focus on live redraw, pencil edits the stored
  copy), `store-notify-guarded`, `local-data` (keys wiped on venue switch), new specs for the routes, the one-shot
  `#recipe` link replacement and the full-screen dialog.
- **Firestore**: watch `recipes` (whole collection, only while the section is open). Nothing written.
- **Shared ports**: finish `catalogue-model.ts` (`normalizeCatalogueRecipe(s)`, `normalizeShelfLifeDays`,
  `MAX_SHELF_LIFE_DAYS`, `labelFieldsOf`, `sortByUsage`, `filterByName`, `scaleCatalogue`, `baseAmounts`,
  `formatWeight`, `batchWarning` taking the two sentences/translator as arguments, `isScaledEntryFresh`,
  `SCALED_TTL_MS`, `unitText` as a typed key map) — still a PARTIAL port with the header updated.
- **App**: generalise `calculator/RecipeFullScreen` + `zoomStorage` (a `storageKey`) and `calculator/clipboard.ts`
  into `ui/` (or reuse as is); `shell/sectionScreens.ts` + `shell/sections.ts` (`recipesScreenName`).
- **Size M.**

### 3d-2 — Allergens: the recipe's card, the declaration, the allergen sheet

- **Works alone**: the recipe screen gains the allergen card (incomplete → job list; complete → the answer outside
  the fold), the declaration card (Copy / Send), «Open in Food cost» stays for 3d-7; the footer/list button opens
  the **Allergen sheet** (law card, counts, search, work lists, blocked-first rows). Gated by `showAllergens`
  at every address (item 60) and by the country.
- **Source**: `recipe-allergen-model.js`, `allergen-sheet.js`, `catalogue-detail.js` (`allergenPanel`,
  `declarationPanel`, `reasonLabel`), `recipe-label-model.js` (ONLY `flattenIngredients`, `buildLabel`,
  `containsLine`, `mayContainLine`, `declarationText`, `ingredientLine` — needed by the declaration; the nutrition
  maths comes with them since `buildLabel` computes it), `js/market.js` label vocabulary, `js/venue-features.js`,
  `watchIngredients`/`watchSuppliers` + their cache keys, `send-sheet` (exists).
- **Tests to port (run against both files)**: `recipe-allergen-model` (all 37), `recipe-label-model`,
  `recipe-declaration` (as behaviour tests: Italian venue + English interface prints Italian food words and
  English chrome; undeclared recipe has no send button; allergens off removes the cards; message leaves the
  table out), `allergen-sheet` (as behaviour tests), `market` (vocabulary, groups, fallbacks, no country),
  `venue-features`, `i18n-label-separation` (new TS guard), `catalogue-no-money` (no money, no
  `ingredient-prices`).
- **Firestore**: watch `ingredients` and `suppliers` (read-only, quiet failure). Nothing written.
- **Shared ports**: `recipe-allergen-model.ts` (full), `recipe-label-model.ts` (full, `lang` defaulting to
  `'en'`), `venue-features.ts` (full), the rest of `market.ts` (label vocabulary + tables, header updated),
  `ingredient-kind`/`ingredient-name` already there; `allergen-model.ts` already there. `parity.spec.ts` and
  `odd-inputs.spec.ts` entries; the fixture corpus (item 110a) is created HERE and extended by 3d-3/3d-4.
- **Size M** (the heaviest to test; do not shorten it).

### 3d-3 — Labels on screen, and printing through the system dialog

- **Works alone**: «Make a label» opens the label screen: the three-way switch, the real-size preview that is
  measured and scaled down on a narrow phone, the readable card, the nutrition table, the language/caveat notes,
  Copy, Send, and **Print through the operating system's dialog** with the three preset `@page` sizes; every
  refusal sentence; the paper size read from `config/labels` (read-only here — the current app or 3d-5 sets it).
- **Source**: `label-view.js`, `label-print.js`, `label-template-model.js`, `label-print.css`,
  `print-transports.js` (the `os-print` road and `roadsFor`/`whyNoRoad` only), `normalizeLabelProfile`,
  `watchLabelConfig` + `catalogue-label-config`.
- **Tests to port**: `label-template-model` (all), `label-print` (rewritten as behaviour tests: unmeasured sheet
  never fits, Print disabled until measured, host removed on `afterprint`, no inline style string, `@page` per
  preset), `market` (label screen refusals), new `outerHTML` comparison against `buildSheet` (item 110c).
- **Firestore**: watch `config/labels`. Nothing written.
- **Shared ports**: `label-template-model.ts` (full); `label-print` split into a pure `label-sheet.ts`
  (`sheetModel(resolved, fontMm)` — the data the markup is made of) and a React component; the global
  `label-print.css`.
- **Size M.**

### 3d-4 — Printing through the shop computer: ZPL, the queue, the printer's presence

- **Works alone**: for a venue whose printer is `zpl`: the agent road queues the label (`print-jobs`) while the
  shop computer's heartbeat is fresh (status line «Sent to the shop computer — it prints it»), the clipboard road
  copies the printer code, every «why no road» sentence; the same Print button, now with all three roads.
- **Source**: `label-zpl.js`, `print-transports.js` (agent and clipboard roads), `print-queue-model.js`,
  `catalogue-store.js` (`queueLabelJob`, `printerReady`, `printAgents`), `firebase-catalogue.js`
  (`queuePrintJob`, `watchPrintAgents`), `print-agent/` (UNCHANGED — read to keep the job shape).
- **Tests to port**: `label-zpl` (all 20), `print-queue-model`, `print-single-label`, `label-print` (roads,
  «sent not printed», fallback never replaces the explanation), golden-file comparison of `toZpl`/`buildJob`.
  **Plus one driven check by the main session**: a job written by Mise 2 on the preview emulator is claimed by
  `print-agent` (`--emulator` mode) and passes `isSingleLabel`.
- **Firestore**: create `print-jobs`; watch `print-agents`.
- **Shared ports**: `label-zpl.ts`, `print-queue-model.ts` (pinned against `js/print-queue-model.js`, which STAYS
  — the agent imports it), transports as pure `roadsFor`/`whyNoRoad` over an injected capability set.
- **Stubs to replace (left by 3d-3)**: replace the `zplFits: () => true` stub and the `printerReady: false` stub in
  `LabelScreen.tsx` — a spec must fail while either stub remains. The guard is already written as an `it.todo` in
  `RecipesSection.label.spec.tsx` («3d-4: …»): turn it into a real spec in this step (it reads `LabelScreen.tsx` as text and
  refuses both stub shapes, and a drawn screen with a fresh heartbeat must show a working agent road).
- **Size S.**

### 3d-5 — Settings: the paper, the printer and what else goes on the label

- **Works alone**: Settings (owner/manager only, absent for others, address checks the role): paper presets +
  custom size, printer language, dpi, date + which date, net weight, storage, business; queued ordered writes,
  rollback and the «put back» sentence; the photo switch row is added in 3d-9.
- **Source**: `catalogue-settings.js`, `saveLabelProfile`/`saveLabelConfig`, `firestore.rules` `config/labels`.
- **Tests to port**: `label-template-model` (profile normalisation, sizes, defaults), new specs for the write
  queue (two quick saves land in order; a rejected save restores both copies), custom size is ONE write on leave.
- **Firestore**: write `config/labels` (merge). Nothing else.
- **Shared ports**: none new (the model exists from 3d-3); the constants `LABEL_SIZES`, `DPI_CHOICES`,
  `PRINTER_LANGUAGES`, `DATE_KINDS` are exported.
- **Size S.**

### 3d-6 — Writing recipes: create, edit, reorder, link, delete

- **Works alone**: «+» new recipe (empty, placeholders), the editor with name, rows (amount, unit, remove),
  the link suggestions and the full chooser, reorder mode (React Aria drag-and-drop with a keyboard path, as the
  Calculator's clients), the label fields (net weight, shelf life — only when the profile prints them), required
  fields revealed and focused, Save with confirm, local-first save with rollback, leave guard, Delete (owner/
  manager, with the Calculator-import warning raced against 2.5 s), «Recipe saved/added/deleted».
- **Source**: `catalogue-editor.js`, `ingredient-picker.js`, `ingredient-suggest.js`, `catalogue-store.js`
  (`saveRecipe`, `deleteRecipe`, upsert/remove local, rollback), `firebase-catalogue.js` (`saveRecipeDoc`,
  `removeRecipeDoc`, `newRecipeId`, `getCalculatorConfig`), `catalogue-model.js` (the rest: `linkOptions`,
  `linkedItemName`, `isSameLink`, `applyLink`, `moveRow`, `findInvalidRecipe`).
- **Tests to port**: `catalogue-model` (validation, links, moveRow), `catalogue-reorder`,
  `catalogue-editor-delete-label`, `recipe-weights` (what the store writes and never writes; absent not zero;
  emptied box removed), `link-suggestions` (the shared suggest list's rules), `recipe-cost-model` «normalising
  keeps links», `guided-model` `withRowIds` on save; rules checks (`firestore-rules` skill) that a Mise 2 save
  passes the `recipes` whitelist including after Food cost wrote `lossPct`.
- **Firestore**: write/delete `recipes` (merge, hand-listed fields); read `config/calculator` once (delete).
  Rules unchanged.
- **Shared ports**: the rest of `catalogue-model.ts` (still partial: the Calculator-import functions come in
  3d-7).
- **Size M.**

### 3d-7 — Links to other sections: the Calculator, Food cost

- **Works alone**: «Import into the Calculator» (confirm, naming rows that cannot come, add/update in place by
  `cat-<id>`, transaction with `configRev + 1`); the **«Open in Food cost» card** and the **return trip** — both
  directions of `#recipe=` become Mise 2 addresses (the Food cost side — an entry `…/food-cost?recipe=<id>`
  choosing product/list/new draft and its Back to `/recipes/<id>` — completes the item `docs/parity/foodcost.md`
  deferred to 3d). The Orders shortcut and ingredient creation stay absent (Questions 9).
- **Source**: `import-to-calculator.js`, `catalogue-model.js` (`toCalculatorRecipe`, `nonWeighableLabels`,
  `mergeImportedRecipe`, `importFailureKey`, `findCalculatorImport`), `updateConfigInTransaction`,
  `js/recipe-link.js`, `js/foodcost/foodcost-main.js` (settleRecipeLink, handleBack — read only).
- **Tests to port**: the `catalogue-model` import tests, `foodcost-from-recipe`, `calculator-trays` (import and
  `trayWeight` preservation), a spec that the transaction writes `configModel`, `configRev + 1` and `bakery`.
- **Firestore**: `config/calculator` (transaction, closed key list, `configModel` = this build's number);
  reads `products` for the Food cost half (already there).
- **Shared ports**: the remaining `catalogue-model.ts` import functions; `recipe-link.ts` (`mayOpenFoodCost`,
  `mayOpenOrders`, `foodCostHref`-equivalents as route builders, `recipeIdFromHash` kept for old addresses).
- **Size S.**

#### Slice A built (15 Oct 2026): the recipe side and the shared ports

- **Built:** `toCalculatorRecipe`, `nonWeighableLabels`, `mergeImportedRecipe` and `importFailureKey` in `shared/catalogue-model.ts`
  (every case against the port and the `js/` original; the re-import keeps order, visibility, logic and `trayWeight`);
  `shared/recipe-link.ts` (partial: `mayOpenFoodCost`, `mayOpenOrders`, `recipeIdFromHash`; new: `foodCostForRecipePath`,
  `recipeAddress`, `recipeIdParam`, `FROM_RECIPE_LINK`). `RecipesSource.importIntoCalculator` is ONE transaction on
  `config/calculator` (merge into the document as the server holds it NOW, `configRev` + 1, `configModel` and the venue
  stamped after the spread; not local-first: offline it rejects and the screen says so); the store counts the recipe as used
  on success only. The recipe screen draws, in this order: ingredients · batch · **Food cost card** (only for whoever
  `mayOpenFoodCost` lets in) · allergens · declaration · Export · **Import into Calculator** with its hint (only where the
  venue uses the Calculator: a write, judged by the section alone) · the owner's small Delete icon.
- **On purpose, different:** the confirm's two sentences are two paragraphs (the current app joins them with a blank line); a
  venue with no document yet gets no Food cost card (the door says no) while the section gate shows everything — the one
  documented difference, pinned in `recipes/foodcostDoor.spec.ts`, which proves the door agrees with `visibleSectionIds` over a
  grid of venues.
- **Specs:** `catalogue-model.spec.ts`, `recipe-link.spec.ts`, `odd-inputs.spec.ts` (shared); `recipesSource.spec.ts` (the
  transaction: stamps, revision, a concurrent change kept, a retry written from the second document, a re-import in place),
  `recipesStore.spec.ts`, `foodcostDoor.spec.ts`, `RecipesSection.links.spec.tsx` (the card, the order of the page, the
  question, both failure sentences, a second tap ignored, usage on success only).
- **Slice B** (Food cost's side) is below.

#### Slice B built (17 Oct 2026): Food cost's side

- **Back counts the depth (fix):** the state key `recipeDepth` says how many entries sit between this one and the recipe (the recipe's push = 1, every push inside Food cost +1, a replace keeps it), and the list's Back is `navigate(-depth)`, so on the split a product, its history or a lateral move beside the narrowed list never leaves a second recipe entry. No depth (a typed address or a new tab; a reload keeps it) still replaces with the recipe.
- **Built:** the addresses (`foodcostPath.ts`): `/food-cost?recipe=<id>` is the ENTRY, `/food-cost?using=<id>` the list narrowed to
  the products made with the recipe, `/food-cost/product/<id>?recipe=<id>` and `?using=<id>`, `/food-cost/new?recipe=<id>`; a
  product's history keeps whichever query its product had. `RecipeEntry` draws only «Loading…» and REPLACES itself, once, with: the
  only product made with the recipe; or the narrowed list (several); or a new product drafted from the recipe (none: its name and
  the recipe on the first line, no number invented); or the plain list (no such recipe). It decides on the SERVER's word (the
  products answered from the server and the recipe known, or the recipes answered too), or after `COPY_WAIT_MS` (1.2 s), or at once
  with no signal. The narrowed list has its own bar: Back, the title «Products with “<name>”» (or «Products with this recipe» for a
  recipe with no name) and «Show all», which replaces the address with the plain list (a product open beside it stays open). A
  product picked from the narrowed list keeps `?using=`; on the split the column stays narrowed beside it, on a phone its Back is
  the narrowed list. A draft opened too early gives way: while nothing has been typed it hands over to the entry when a product made
  with the recipe turns up (saving it would be a duplicate with a margin history of its own); once the person has typed, it stays.
  Back to the recipe steps back by the recipe depth (see the first bullet: `-depth` entries, the state carried through the
  entry's replace); with no depth in the state (an address typed, or a new tab: the browser keeps `history.state` across a
  reload, so a reload alone does not lose it) the screen REPLACES itself with the recipe. A product or a draft with typing on it
  asks the discard question first.
- **On purpose, different:** the current app showed TWO pages for the recipe per trip; here the history after the trip is exactly
  what it was before it (the entry is replaced, Back is `-depth`, the recipe is never pushed). The narrowed list is an address
  (`?using=`), so the browser's Back and a reload keep it.
- **Specs:** `FoodcostSection.recipe.spec.tsx` (the entry: one product, several, none, an unknown recipe; the waiting — only the
  phone's copy, the server's answer, `COPY_WAIT_MS` with fake timers, no signal, recipes late; the Italian title, an empty name,
  the focus), `FoodcostSection.recipeBack.spec.tsx` (Back to the recipe from the product, the narrowed list and a draft, with and
  without typing; Back with no state; a product picked from the narrowed list on a phone and on the split; «Show all» beside a
  product; the margin history keeping the query; the draft giving way and not giving way), `FoodcostSection.recipeTrip.spec.tsx`
  (the whole trip through both sections: the recipe's button, Food cost, Back, the history as it was),
  `FoodcostSection.recipe.strict.spec.tsx` (StrictMode: one move), and `testing/recipeLinkHelpers.ts` (`entriesBehind` walks a
  memory history back to count its entries, so ask it last). The `decided` guard in `RecipeEntry` is not pinned by behaviour: the
  effect runs only when the wait is over, so StrictMode never doubles it; the spec counts the moves instead.

#### Slice B, after review (17 Oct 2026): the fixes

- **«Show all» keeps the focus:** its replace carries no `keepFocus` (`withoutKeepFocus` in `foodcostNav.ts`), so the page puts the
  focus on its heading «Food cost» (alone, or with a product open beside), instead of letting it drop to `<body>>` with the button.
- **Back from Food cost brings the recipe back as it was left:** the «Open in Food cost» button writes the place down through
  `useRecipeReturn` (`remember(id, 'cost')`) like the label and the editor do, and the focus returns to that button and the scroll to
  where it was. Food cost is another section, so the recipes section is unmounted meanwhile: for this origin only, the place is also
  kept in `recipeReturn.ts` (`carryPlace`) and picked up by the next recipes screen that appears by a Back (a POP). The scroll is put
  back when the card draws and again after the shell's own reset (a microtask in an effect), because the shell resets its scroll
  area when the section changes.
- **A rotation phone → split keeps the way back:** with a recipe depth known and `?using=` set, the narrowed list is ALWAYS the entry
  at depth 1, so a screen's Back to it is `-(depth - 1)` when the depth is 2 or more (`useLeave`'s `narrowed` argument), whatever the
  replaced entry's state says about where it came from. Before, the product's Back after a history had been replaced on the split
  replaced the narrowed list with itself, and the list's Back then pushed a second recipe entry.
- **Import's busy marker outlives the screen:** `markBusy` is taken before the write and released in its `finally`, not when the
  component goes away, so leaving the recipe mid-write does not let the app reload itself under the transaction. While it runs the
  button is `aria-busy` and `aria-disabled` (not `disabled`: the keyboard's focus stays on it) and looks asleep.
- **Pinned:** a dirty product beside the narrowed list, on the split: the list's Back asks the discard question, Cancel keeps the product
  and the typing, Discard lands on the recipe with no second entry (`FoodcostSection.recipeFixes.spec.tsx`).

#### Left as the current app

- Importing into a Calculator that already holds 200 recipes is refused by the rules, and `importFailureKey` reads that refusal as
  «this app is out of date» (the same in the current app). Not fixed here.

### 3d-8 — Mixing procedures: write steps, run a mix, resume, alarm

- **Works alone**: the Procedure card («Write the mixing steps» / «Guided mixing», «Resume — step N of M»,
  «Start again», step count and timers total, the «not in any step» warning, «Edit the steps»); the steps editor
  (working copy, tick the rows, minutes + seconds, speed, move/remove, closing message, Save with confirm, leave
  guard); the run (one step at a time, frozen snapshot, wall-clock timers, +1 min, done early, speed change
  announced, finish card with missed rows, leave asks and keeps the session); the resume offer on the list; wake
  lock, alarm sound and vibration (the notification booking stays out — Questions 6).
- **Source**: `guided-editor.js`, `guided-run.js`, `guided-alarm.js`, `guided-model.js` (the rest),
  `js/wake-lock.js`, `sounds/alarm.wav`, `catalogue-detail.js` (`guidedPanel`), `catalogue-main.js`
  (`offerResume`, `openRun`, `resumeGuided`, `guidedSessionFor`).
- **Tests to port**: `guided-model` (all, against both files), `catalogue-reorder` (rid survives), new behaviour
  specs: the countdown with a fake clock including a backgrounded tab and a clock moved backwards, the alarm
  once per step, resume refused when stale/deleted, leave keeps the session; the keyboard path of the editor.
- **Firestore**: writes `recipes` through the 3d-6 save (steps, endNote, ingredients with `rid`s).
- **Shared ports**: the rest of `guided-model.ts` (`normalizeSteps`, `normalizeEndNote`, `amountsFor`, `stepRows`,
  `unassignedRows`, `missingRefs`, `timerState`, `remainingMs`, `formatDuration`, `formatRemaining`,
  `overdueText`/`progressText` with the translator as an argument, `isResumable`, limits); `zoom-steps.ts` is done.
- **Size M.**
- **Slice A as built** (the Procedure card and the steps editor): the card sits after the declaration and before Export; the
  editor is `/recipes/<id>/steps` (usage screen `recipes-steps`, one level below the recipe, the right-hand pane on the split;
  Back and Save return to the recipe with no second entry for it, the focus on the card's button). Anyone who sees the section
  may write steps. Differences from the current app, all on purpose: the ids are stored only when a row had none (the store's
  `saveProcedure`, not a rewrite of every row); the editor's accessible names are translated (`cat.stepInstruction`,
  `cat.stepMinutes`, `cat.stepSeconds`, `cat.stepSpeed`, `cat.removeStepN`) and so are «min», «sec» and the speed's example; the
  focus follows a moved step's arrow, a removed step lands on the next remove button; a Save for a recipe deleted meanwhile says
  «This recipe no longer exists.» and keeps the typing. `cat.notInAnyStep` is the CARD's «Not in any step: {list}» (the current
  dictionary defines the key twice and the run-end text wins there, so the card never shows its list); slice B's finish card
  needs its own key. Slice B: Resume / Guided mixing / Start again on the card (the place is marked in `ProcedureCard.tsx`),
  the run, the alarm (built, below).
- **Slice B built** (the guided mix: the run, resume, the alarm, the wake lock): `/recipes/<id>/mix` (usage screen `recipes-run`), full
  width at every width, one level below the recipe (Back returns to it with no second entry, the focus on the card's first mix
  button, the scroll where it was). Items 94, 96, 97 and 98 are done; item 99 (the phone notification) is NOT: the line under the
  controls says «Keep this screen open» (with or without a wake lock), and no push code exists. Differences from the current app, all on
  purpose: (1) **a mix starts reload-safe**: the card's button writes the saved session (snapshot of the recipe as shown, with the batch the
  recipe page is scaled to) and THEN opens the run, and the run always goes on from the stored session, so a reload mid-mix resumes at the
  stored step and never restarts (the current app keeps the live run in memory and loses a fresh one on reload); a typed address with
  no session for the recipe replaces itself with the recipe, a stale one is cleared with «That mix is no longer available — start it
  again.»; (2) **no notification** (above); (3) the step heading takes the focus at every new step and the finish card at the end; a speed
  change and «Time is up» are said once by always-mounted quiet live regions, never the countdown; (4) the finish card's warning has its
  own key, `cat.notInAnyStepCheck` (the current dictionary's duplicated `cat.notInAnyStep`); (5) `cat.stepDone` is «Done» / «Fatto» as in the current dictionary (not «Step done»); (6) «Carry on» from the list pushes the recipe and then the run, so Back is the
  recipe and then the list; (7) the countdown repaints while the timer is up too, so «Time was up N minutes ago» stays true; (8) the
  recipe is looked for in the phone's copy first and the mix only called stale once the server has answered (or after the copy wait
  with no signal). Shared with the current app: the session key and shape, `alarm.wav` (copied to `app/src/recipes/`), every word
  (copied key for key). Specs: `guidedSession`, `guidedRunModel`, `guidedAlarm`, `wakeLock`, `guidedRunCss`, `RecipesSection.run` (51 cases
  with a faked clock, Audio, vibrate and wake lock) and `RecipesSection.run.strict`.

### 3d-9 — Reading a recipe from a photograph (and its switch)

- **Works alone**: the owner/manager switch in Settings (confirm that says what it costs, server-side write),
  the camera screen (≤ 5 photos, shrink, thumbnails, remove, read, the busy state, the offline sentence), the
  draft opening in the editor, Back returning to the typed copy, every error sentence.
- **Source**: `photo-capture.js`, `firebase-photo.js`, `photo-model.js` (catalogue + `js/photo-model.js`),
  `togglePhoto`/`photoIsOn`/`backToEditor` in `catalogue-main.js`, `functions/recipe-photo*.js` (server — unchanged).
- **Tests to port**: `photo-image-model`, `recipe-photo-model`, `recipe-photo-handler`, `photo-timeouts`
  (client 120 s ≥ server 120 s, kept as a spec reading the TS constant and `functions/recipe-photo.js`), the
  16-sentence walk of `photo-model` `BY_KEY` against both dictionaries.
- **Firestore**: none from the client; callables `readRecipeFromPhotos`, `setRecipePhoto` (functions emulator on
  localhost — `connectFunctionsEmulator`, or the real, paid function would be called from a «local» page).
- **Shared ports**: `photo-model.ts` (sizes, `fitWithin`, `base64Of`, `mediaTypeOf`, `approxBytes`,
  `payloadProblem`, `errorKey`, `answerKey`) — Orders' pack-photo reuses it later.
- **Size S.**
- **3d-9 as built** (items 4, 61, 81, 93, 100–103 are done). Shared: `photo-model.ts` is a FULL port (paired in `parity.spec.ts`,
  `odd-inputs.spec.ts`), `catalogue-photo-model.ts` holds the Catalogue's table of the 19 codes (`CATALOGUE_PHOTO_KEYS`) and the two
  lookups, named `photoErrorKey` / `noRecipeKey` like the original's (not paired: it also exports the table); `photoKeys.spec.ts` in the
  app walks all 19 codes (16 sentences) against `en.ts` and `it.ts` and checks that only «offline» speaks of the connection.
  Screens: (1) **the switch** is the first card of the label Settings (`PhotoCard` in `LabelSettings.tsx`, heading «Photos» /
  «Foto» = `settings.cat.photo`, then the row `cat.photo.setting` + `cat.photo.settingNote`); it shows ONLY a literal
  `recipePhoto === true` from the session, asks first with the cost sentence, calls `setRecipePhoto`, reads the venue again
  (`refreshLocation`), holds the new value until the session shows it, and says «Reading from a photo is on/off.» through the
  section's status message; a refusal says the server's own words unless they are empty or «internal», and the switch stays;
  the row is `aria-busy` and ignores taps while the call is in the air, and `markBusy` is held by the call even if Settings is
  left. (2) **«Fill this in from a photo»** is the last thing in the NEW-recipe editor, only for a venue with the reader on; with
  something typed it asks («Start from a photo?»). The typed copy is written into the navigation state of the editor's own history
  entry (replaced, same address) and taken off again as soon as the form has read it, so Back from the photo screen — the button or
  the phone's gesture — brings it back once. (3) **The photo screen** is `/recipes/photo` (usage screen `recipes-photo`, the right-hand
  pane on the split); a venue without the reader sends a typed address to the list (a replace). Photographs are shrunk in
  `photoImage.ts`; thumbnails come from the data URL; offline says so and makes no call; the read holds `markBusy` until the call
  settles, even if the screen is left. (4) **A read saves nothing**: the draft becomes the working copy of the new-recipe editor
  (`workingFromDraft`: name, rows, `netWeightG` / `shelfLifeDays` only when present, no oven loss), which STARTS DIRTY. The photo
  screen steps back onto the editor's entry (`navigate(-1)`), so the history holds ONE editor entry holding the draft; a move cannot
  carry a state, so the draft is handed over in `photoCarry.ts` for the editor that mounts next (looked at while drawing, taken off in
  an effect, so StrictMode cannot eat it). Opened by its address (no editor behind) the read replaces the photo screen with the
  editor. Differences from the current app, on purpose: (a) «Read the recipe» is drawn disabled with no photo, not hidden; (b) the
  picker is a real, focusable file input inside a button-looking label (the current app clicks a hidden one from a button); (c) an
  answer that lands after the screen was left opens nothing (the current app opens the editor whatever the person is doing);
  (d) a browser without `createImageBitmap` says «That photo could not be prepared» rather than blaming the format; (e) leaving the
  photo screen while a read is in the air is not asked about: the read still settles and is dropped; (f) the editor takes the focus on
  its title after a read (and on the photo button after Back); (g) `cat.photo.entry`, `cat.photo.on` and `cat.photo.off` are not
  carried (unused in the current app's screens). Specs: `photoImage`, `photoCarry`, `photoKeys`, `editorModel` (draft and restore),
  `RecipesSection.photoSwitch`, `RecipesSection.photo`, `RecipesSection.photo.strict`.

## Already ported / to port

**Already in `shared/src` (do not port again; extend only where listed):**

| File | What it covers | Still to add for the Catalogue |
|---|---|---|
| `allergen-model.ts` | **Full port, paired** (`ALLERGENS`, `normalizeAllergens`, `allergenState`, `checkedAt`, `isDeclared`, `normalizeMayContain`, `NUTRIENTS`, `normalizeNutrition`, `hasFullNutrition`, `missingNutrients`, `buildAllergenFields`, groups) | nothing |
| `market.ts` | PARTIAL: `COUNTRIES`, `countryOf`, `outputLanguage`, `canPrintLabel`, currency and money layout | **the whole label vocabulary**: `LABEL_WORDS`, `ALLERGEN_IT`, `NUTRIENT_IT`, `GROUP_HEADING`, `labelWord`, `allergenName`, `allergenWordIt`, `nutrientWordIt`, `allergenGroupName`, `allergenGroupCodes`, `nutrientName` (its header already says so) |
| `catalogue-model.ts` | PARTIAL: units (`CATALOGUE_UNITS`, `unitOf`, `isWeighableUnit`, `ingredientGrams`, `weighableTotalGrams`), `ROW_KINDS`/`linkOf`, oven loss (`MAX_LOSS_PCT`, `normalizeLossPct`, `MAX_WEIGHT_G`, `normalizeWeight`, `weightLoss`), `normalizeSearchText`, `suggestLinks` | `normalizeCatalogueRecipe(s)`, `normalizeShelfLifeDays`, `MAX_SHELF_LIFE_DAYS`, `labelFieldsOf`, `sortByUsage`, `filterByName`, `linkOptions` (export), `linkedItemName`, `isSameLink`, `applyLink`, `moveRow`, `scaleCatalogue`, `baseAmounts`, `MAX_SANE_*`, `formatWeight`, `batchWarning`, `SCALED_TTL_MS`, `isScaledEntryFresh`, `findInvalidRecipe`, `toCalculatorRecipe`, `nonWeighableLabels`, `mergeImportedRecipe`, `importFailureKey`, `findCalculatorImport`, `unitText` (as a typed key map) |
| `recipe-cost-model.ts` | PARTIAL: `costRecipe`, `MAX_RECIPE_DEPTH` (the allergen and label walkers import the depth constant from here) | nothing (no money in this section — `catalogue-no-money`) |
| `guided-model.ts` | PARTIAL: `ridOf`, `makeRowId`, `withRowIds` | everything else (3d-8; limits, normalisers, `unassignedRows`, `missingRefs`, `amountsFor`, `stepRows`, the clock functions, `isResumable`, `progressText`, `overdueText`) |
| `zoom-steps.ts` | PARTIAL: arithmetic (`ZOOM_SCALES`, `clampStep`, `parseStep`, `stepBy`, `canStep`, `scaleOf`) | nothing in `shared/`; the storage + buttons are app code (`calculator/zoomStorage.ts`, `RecipeFullScreen.tsx` — add a key parameter) |
| `ingredient-name.ts`, `ingredient-kind.ts` | `ingredientDisplayName`, `isPackaging` | nothing |
| `sections.ts`, `home-cards.ts`, `local-data.ts`, `usage-model.ts`, `error-model.ts`, `push-model.ts` | gates, card visibility, `KEEP_PREFIXES`, usage record, errors, timer-doc builders | `push-model.ts` is only for 3d-8's notification half (deferred) |
| `foodcost-model.ts` | `productsUsingRecipe`, `draftFromRecipe` (Food cost's half of the recipe link) | nothing |

**App code already usable**: `ui/SendSheet` (`useSendSheet`), `ui/Dialog`, `ui/useConfirm`, `ui/useAlert`,
`ui/Button`, `ui/FormBar`, `ui/StatusMessage`, `ui/split` (`SPLIT_QUERY`), `session/busy` (`markBusy`),
`shell/scrollArea` (`useOwnScrollArea`), `calculator/clipboard.ts` (`copyToClipboard`; move to `ui/`),
`calculator/RecipeFullScreen.tsx` + `zoomStorage.ts`, `calculator/CataloguePicker.tsx` and the Calculator's
catalogue readers in `calculatorSource.ts` (`watchCatalogueRecipe`, `listCatalogueRecipes`, `stampRowIds` — the
link from the Calculator side is DONE; do not duplicate), `foodcost/foodcostSource.ts` (`watchRecipes`,
`saveRecipeLoss` — the weighing write that item 11 protects), React Aria's drag-and-drop (as in
`calculator/ClientList.tsx`), `shell/sections.ts` (the `recipes` section and its gate already exist; the screen
does not: `SectionPlaceholder`).

**Not ported at all (to port, with the slice that needs it):** `venue-features` (3d-2), `recipe-allergen-model`
(3d-2), `recipe-label-model` (3d-2), `label-template-model` (3d-3), the sheet markup + `label-print.css` (3d-3),
`recipe-link` (3d-7), `photo-model`
(3d-9), the push client and `wake-lock` (3d-8 for the lock; the notification half is deferred — Questions 6).
`label-zpl` and `print-queue-model` are ported (3d-4 slice 1: `shared/src/label-zpl.ts`, `print-queue-model.ts`, each
pinned byte for byte against its `js/` original over the label corpus; `js/print-queue-model.js` STAYS — the agent
imports it); the screen wiring is slice 2.

**Out of this step, noted so they are not lost:** the allergen DECLARATION forms and `allergen-match` /
`allergen-terms` (Orders, item 20); `supplier-label` as a shared port (a private copy sits in
`catalogue-model.ts`; Orders will need the real one); `confirm-dialog.js` (the app has `useConfirm`); `dom.js`;
`print-agent/` itself (a Node program on the shop computer — nothing to port, **but its two imports from `js/`
must survive the cleanup at the switch**: `js/print-queue-model.js` and `js/firebase-target.js`, item 79).

## Decisions taken for the night run (13 Oct 2026, nobody awake — each the recommended option)

- **Step 3d is split into the nine stacked sub-steps above**, one PR each, in that order; 3d-1 is built on
  `feature/mise2-catalogue` (PR base `feature/mise2-calculator-client-orders`), each next one on its own branch.
- Questions 1–4 and 6–15: the recommended answer as written. In short: addresses under `/recipes`, Back one level
  up; footer buttons at the foot of the list, split at the app's 1000 px query; full screen shares the
  Calculator's dialog with its own key `mise.catZoomStep`; nutrition/`showNutrition` ported exactly (Findings A/B
  reported to Federico); mixing alarm without the phone notification until the push client is ported (before the
  switch); the photo reader is the last slice; shared local keys; doors to Orders/Suppliers absent until those
  steps; byte-identity proved by (a)–(f) with the global stylesheet for the paper; a spec as the label-separation
  guard; data layer in `app/src/recipes/`; delete warns as today; no copies box.
- **Question 5 (the weightless allergen row, Findings C): RESOLVED 13 Oct 2026 — fixed in the current app
  (PR #354, `v1.125.6`) and ported the same way on the 3d-2 branch; the specs and label-golden.json now pin the
  fixed behaviour.** The original night decision, kept for the record: ported AS IS for now and pinned by a spec that names
  the quirk. Fixing it changes what is printed on a label — a result Federico decides — and the night run may
  not open current-app fixes. It is reported to him as a health item to fix in the CURRENT app first; Mise 2
  follows the fixed behaviour in the same slice that ports the label (3d-2/3d-3), so the two apps never print
  differently.

## Step 3d-1 as built (13 Oct 2026) — differences from the current app, on purpose

The list and the recipe screen are in (`app/src/recipes/`, section `recipes`, lazy-loaded). Read-only: nothing
is written to Firestore except the per-device memories of items 21 (`catalogue-usage`, `catalogue-scaled`,
`mise.catZoomStep`). What differs from the current app, and why:

- **Addresses.** `/recipes` is the list and `/recipes/<id>` a recipe (the id percent-encoded and split before it
  is decoded). `catalogue.html#recipe=<id>` is replaced by the address itself, so the one-shot link and its 5 s
  patience are gone: an address names a recipe for as long as it is in the bar, and waits for the SERVER's first
  answer (or a dead stream) before saying `This recipe no longer exists.` (`recipes.notFound`, new in Mise 2;
  the current app has no such sentence). A recipe found in the local copy opens at once. `new`, `allergens`,
  `settings` and `photo` are reserved for later steps and are not read as recipe ids; any other address (for
  example `/recipes/<id>/edit`, which does not exist yet) goes back to the list.
- **Back goes one level up.** On a phone Back from a recipe returns to the list keeping the search text and the
  place in the list, and hands the focus back to the row that opened it. The current app always returns to the
  list; here an address opened with nothing behind it replaces itself with the list. On the split the recipe's
  bar keeps its Back (as Food cost does) and it empties the right-hand side; the current app's pane had none.
- **The split is the app's one query, `(min-width: 1000px)`.** The current app's `(min-width: 900px) and
  (min-height: 600px), (min-width: 1000px)` is replaced, as everywhere else: a lab tablet held upright gets the
  phone layout. The list stays mounted when another recipe is opened (only the open row is `aria-current`),
  tapping the open recipe does nothing (no count, no new history entry), and the prompt is not drawn beside
  `No recipes yet`.
- **The order is frozen while a recipe is open beside the list** (item 37), including a recipe opened by its
  address: the counts that were current when the recipe opened stay in charge of the order until the list is
  shown alone again or the split is left. On a phone the list is hidden while a recipe is open, so it simply
  shows the fresh counts on Back.
- **No «+» in the header, no «Add a recipe» button, no footer buttons yet.** The empty state keeps its title and
  its line (`No recipes yet` and `Add your first recipe: …`) but no button: creating recipes arrives in step
  3d-6. «Allergen sheet» arrives in 3d-2 and «Settings» in 3d-5. The Edit pencil, Delete, Import, and the
  allergen, declaration, Food cost and procedure cards are all later steps; the recipe screen has the ingredient
  list and the batch card only.
- **The ingredient list is a table, with a button to open it full screen.** The current app makes the whole list
  one `role="button"` with an `aria-label`, which hides the rows from a screen reader. Here the rows are a
  readable table (label, number, unit), a tap anywhere on it opens the full screen as before, and a real button
  in the card's head (`View recipe full screen`) is the way in for a keyboard and a screen reader (the pattern of
  the Calculator's result card). The look is the same: numbers right-aligned in one column, units in another,
  whole numbers with no thousands separator whatever the language (Findings F), `to taste` with no number.
- **Full screen is the Calculator's dialog.** `ui/RecipeFullScreen` and `ui/zoomStorage` now take a storage
  key: the Calculator keeps `mise.calcZoomStep`, the catalogue uses `mise.catZoomStep`. A native modal
  `<dialog>`, six sizes, `aria-disabled` steps, Escape and × close it and the focus returns to the button.
  Unlike the Calculator's, it is NOT closed when the recipe changes elsewhere: it is redrawn from the live
  recipe, so the numbers on it can never be stale. Its words (`Exit full screen`, `Text size`…) are the
  Calculator's `calc.*` keys, whose wording is the same.
- **Hold-to-zoom stays unported** (Questions 3).
- **The batch card follows the current app to the letter**: grams only, Calculate opens a confirm that spells the
  amount both ways (`17500 g (17.5 kg)`), over 100 kg or over 50 times the recipe gets the louder title and a
  whole warning sentence (never a block), empty or 0 returns to the base recipe, Clear forgets the batch, 12 h
  memory per device. The unit words in the amounts come from `unitTextKey` and the dictionary; the metric
  symbols are shown as they are.
- **Usage record.** Two screens: `recipes` (the list) and `recipes-detail` (a recipe, beside the list or alone),
  in place of the current app's `''` and `detail`; the `m2:` prefix is added by the existing mechanism.
- **Live data.** A recipe deleted elsewhere returns to the list and says `Recipe deleted.`; one changed elsewhere
  is redrawn in place (the typed batch, the scroll and the focus stay); the dead stream says `Live sync
  interrupted — recipes may be out of date.` in the status line, as Food cost does for its products.

Still to do from the 3d-1 list: the one-shot `#recipe=` of the current app is not needed (an address does it);
the footer buttons and the `+` are listed under their own steps above.

## Step 3d-2 as built (13 Oct 2026) — differences from the current app, on purpose

The recipe screen has its allergen card and its declaration card, and the Allergen sheet is in
(`app/src/recipes/AllergenCard.tsx`, `DeclarationCard.tsx`, `AllergenSheet.tsx`). Nothing is written to Firestore. Every
verdict is the shared model's (`rowState` over `recipeAllergens`, `rowIsBlocked`, `buildLabel`): no screen decides an
allergen state with an `if` of its own. What differs from the current app, and why:

- **A «checking» state, new in Mise 2.** The current app paints the allergen verdict from its own copy of the ingredients.
  Mise 2 draws nothing about allergens until the ingredients have arrived (`ingredientsLoaded` in the store): the allergen
  card, the declaration card and the sheet say `Checking the allergens…` (`recipes.allergensChecking`, new key; Italian
  `Sto controllando gli allergeni…`), with no verdict, no count, no work list, no state word and no Copy or Send. Without
  it a cold phone would flash «not declared» on every recipe, which is a wrong answer however safe. A refused ingredients
  stream ends the wait (the store's quiet failure), so linked rows then read «not declared» — the honest answer — and the
  declaration card says its one line. A recipe with no rows has no allergen card in either state.
  *Review fixes:* (a) **the wait cannot end offline** on a phone with nothing stored, so after ten seconds
  (`useStillWaiting`, the timer is cleared on unmount) the cards and the sheet add a line under the checking text,
  `recipes.allergensStillWaiting` — EN «Still waiting for the ingredient list — the allergens can’t be checked until it
  arrives. Are you offline?», IT «Sto ancora aspettando l’elenco degli ingredienti: finché non arriva non posso controllare
  gli allergeni. Sei offline?»; still no verdict and no buttons. (b) **An ingredient list that could never be read** (the
  store's `ingredientsUnreadable`: the stream failed and nothing was ever held) would make every per-row reason untrue
  («linked to an ingredient that no longer exists»), so the allergen card replaces the reasons list with
  `cat.alg.unreadable` — EN «The ingredient list could not be read, so the allergens cannot be checked.», IT «Non riesco a
  leggere l’elenco degli ingredienti, quindi non posso controllare gli allergeni.» — the head still says «not declared»
  (from the model), the declaration card keeps its blocked line, and the sheet shows the line above the rows and hides the
  work lists (they would be empty or wrong).
- **The venue document is not live in Mise 2.** `session.location` is read once when the venue opens, so allergens being
  switched off (or a country being set) on another phone is seen after a reload, like the rest of Mise 2 — the current app
  redraws from its own snapshot. The cards and the sheet still read it on every render.
- **The allergen card.** Absent when allergens are off and for a recipe with no rows. Incomplete: the head reads
  «Allergens · not declared» (the state is a WORD in the button), folded body with the sentence, the first eight rows as
  `label — reason`, «and N more» and what is known so far marked NOT an answer. Complete: «fully declared» in the head and
  the allergens (or «None of the 14») OUTSIDE the fold; folded: the traces, the caveat. Both heads are real `h3`s holding
  the disclosure button (`aria-expanded`, `aria-controls`); it opens CLOSED for every recipe opened, keeps its state
  through a live redraw of the same recipe, and the focus stays where it is. **No «Make a label» button yet**: the label
  screen is step 3d-3, which adds the button to the folded body of a complete card.
- **The declaration card.** Hidden when allergens are off, and for a recipe with no rows (as the allergen card is). **No
  country, no declaration (review fix):** when `canPrintLabel(location)` is false — no country, an unsupported one such as FR,
  or a venue document that did not load — the card says ONE line, the current app's `label.blocked.noCountry`
  (copied key for key), and has no Copy and no Send: a declaration is never produced in a fallback language. A declared
  recipe with nothing weighable (`label.reason === 'no-ingredients'`) says the current app's `label.blocked.noWeights`
  («This recipe has no ingredients with a weight.») instead of «still to be declared», still with no buttons. One line and no
  Copy or Send when the label cannot be built.
  Otherwise the list heaviest first with the allergen rows in a `<strong>` (bold and underlined), `Contains:`, `May contain:`,
  the caveat, Copy and one Send (`ui/SendSheet`); what is copied and sent is exactly
  `declarationText(label, lang, { withNutrition: false })`, built by the same `buildLabel(recipe, tables)` call as the
  current card. «Copied» and «Could not copy…» are a live region that exists before it speaks. `copyToClipboard` moved from
  `calculator/` to `ui/` so two features share it without importing each other.
- **Order on the recipe screen:** ingredients · batch · allergens · declaration (since 3d-7 slice A the Food cost card sits
  before the allergens, and Import into Calculator after Export). Since 3d-8 slice A the Procedure card follows the declaration, before Export.
- **The Allergen sheet is `/recipes/allergens`** and `allergens` is no longer a reserved-and-unknown word. It re-checks its
  own gate (item 60): with allergens off the address goes to `/recipes` by replacing itself, also when the switch is thrown
  while the sheet is open. The door is an «Allergen sheet» button at the FOOT of the list (only when allergens are on); Back
  from the sheet is one level up (the list, the focus on the door), or a replace of the list when the sheet was opened by its
  address. The usage record names it `recipes-allergens`. On the split it is drawn in the right-hand pane, the list staying
  beside it (the least change to the frame); a row tapped in the sheet opens its recipe as a NEW entry on both layouts, so
  Back returns to the sheet with the focus on that row. There is no Home button of its own: the shell puts none on a screen
  one level down.
- **The sheet's content** is the current app's, top to bottom: the law card (the fourteen groups in the COUNTRY's words
  outside the fold, the cereals and nuts folded, the sentence naming the country; no country → a warning and no list, never
  the UK), where things stand (counts over the whole catalogue, never the filtered slice), a search of its own by recipe
  NAME only, the work lists (hidden while searching, capped at six with «and N more», linking before declaring, a deleted
  ingredient is not a job), every recipe blocked first then declared, each by name, and the caveat outside everything that
  repaints. **With no country the on-screen allergen card and the sheet's rows still show the names (in English), as the
  current app does on purpose** — the on-screen reading at the counter; only what is copied or sent, and the law card's
  list, refuse without a country. «Every recipe can be labelled.» and the sentence about the rest appear only once the server
  has answered or the live stream has broken (`recipesFromServer || streamBroken`): a cold phone's first, cached answer can
  hold only a few recipes; the counts themselves are always shown. A blocked row names no allergen. The wording is the current app's key for key: the pills read «fully declared» /
  «not declared» (the plan's «Declared» was shorthand). Tapping a row counts as an open for «most opened first».
- **Small differences:** the sheet's search filters on every keystroke (the current app debounces 140 ms), and its text is
  forgotten when the sheet is left (the current app keeps `sheetQuery` for the session); with no recipes the count reads «0 of
  0 recipes fully declared» and the line «Every recipe can be labelled.» is left out (it would be vacuous); Italian `cat.alg.andMore`
  one-form reads `…e {n} altro` so both languages carry `{n}`, as the catalogue spec demands.
- **The label-separation guard** (`app/src/label-separation.spec.ts`, parity items 54, 55 and 110e): every app file that calls a
  label-word function (`allergenName`, `allergenGroupName`, `allergenGroupCodes`, `labelWord`, `nutrientName`,
  `containsLine`, `mayContainLine`, `declarationText`, `ingredientLine`) is on an explicit list, holds
  `const lang = outputLanguage(…)`, passes that `lang` to every call, and never touches the interface language (`useT().lang`,
  `locale`, the i18n context, the loaders). *Review hardening:* the three fixed-language word functions (`allergenLabel`,
  `allergenWordIt`, `nutrientWordIt`) are found anywhere and refused in a label file; a file that imports a VALUE from
  `market`, `recipe-label-model` or `allergen-model` must be on the list unless every name is on a justified allowlist (codes,
  predicates, normalizers — `ALLERGENS`, `NUTRIENTS`, `buildLabel` and the other word-carrying exports are not); `import * as`,
  `export *`, `import()` and `as` renames of those modules are forbidden everywhere; in a label file `lang` is declared once
  per scope from `outputLanguage(` and never assigned, destructured or taken as a parameter; and every runtime export of the
  three modules must be classified, so a new one forces a decision. Each rule has a self-test on an inline source. It was proved once by mutation (the `outputLanguage` call removed, and
  `useT().lang` handed to `allergenName`: both fail, naming the file).
- **Built in 3d-3 (slice B):** «Make a label» (in the fold of a complete card, shown exactly when the current app shows it — the
  country is NOT asked at the door, the label screen refuses a venue with no country by itself) and the label screen at
  `/recipes/<id>/label`, with Print through the system's dialog. Differences from the current app, all on purpose: the ingredients
  must have arrived before any verdict (a neutral «checking» line before it); the paper must be KNOWN (`labelConfigKnown`) before
  anything is laid out, with one new sentence (`label.preview.paperUnknown`) and Print off until then; «actual size» is claimed only
  after a real measurement; the sheet is NEVER measured in the fallback typeface (Print stays off until Manrope is ready, and a face that cannot load says so with `label.preview.fontMissing`); the print host is built at print time with its own React root and leaves after `afterprint` AND the person's next pointer or key (driven on the lab tablet, 13 Oct 2026: Android fires `afterprint` before its print screen lays the page out, and the CURRENT app offers a BLANK page there), never with the screen; the print CSS is scoped (`body:has(> #labelPrint)`, a named `labcustom` page) because Mise 2 loads it for the whole app; the sheet is set in Manrope (copied fonts), so
  the fit is the same in both apps; the switch is kept for the section. Not here: ZPL, the shop computer's queue and the
  clipboard road — they came in 3d-4 (below), which replaced the two stubs this step left in `LabelScreen.tsx`.
- **Left for 3d-6:** the pencil that the work list's sentence about linking
  rows mentions (`cat.aRecipeRowHas` is the current app's wording and points at a screen Mise 2 does not have yet).

## Step 3d-4 as built (14 Oct 2026) — differences from the current app, on purpose

- **Built:** `print-agents` is watched while the section is open (quiet on failure, kept in memory only — never in
  storage: a heartbeat is a statement about right now) and `print-jobs` is written with `addDoc`, awaited and NOT local-first
  (a failure rejects and the screen says «Could not send it — try again»). The label screen now offers all three roads
  through the shared `roadsFor`/`whyNoRoad`: the agent (queue a job while the heartbeat is fresh; the status says «sent», never
  «printed»), the system's dialog, and the printer code on the clipboard; the button carries the first road's words, is dead while a send is in
  flight, and a «not answering» sentence stays visible even when the clipboard fallback is the button. The job is built by the ported
  `buildJob` with the session's uid and the open venue and has exactly the keys `firestore.rules` allows. The two stubs 3d-3 left
  in `LabelScreen.tsx` (`zplFits` answering yes, `printerReady` fixed off) are gone and `RecipesSection.label.spec.tsx` reads the file
  to keep them gone.
- **On purpose, NEW in Mise 2:** the screen re-judges the heartbeat **every 30 s while it is open** (`usePresenceClock`,
  `PRESENCE_RECHECK_MS`, only for a Zebra venue, cleared on leaving). The current app judges it only when the screen is redrawn, so a
  shop computer switched off while a label is open keeps being offered «Print» until something redraws. Here, within 30 s the
  button stops offering the queue and the «not answering» sentence appears with no tap; a fresh heartbeat still updates at once through
  the watch.
- **On purpose, NEW in Mise 2 (review fixes, 14 Oct 2026):**
  - the in-flight guard applies to the **agent road only**: a send that never lands (offline phone, `addDoc` never resolves, no
    timeout — parity) no longer kills the «Copy the printer code» fallback once the heartbeat goes stale;
  - a send that lands after the road changed **does not put its answer back** (the last answer goes when the road changes);
  - the heartbeat is **re-judged at tap time**: a beat that went stale with no clock tick yet (a phone woken from sleep) queues
    nothing and the screen re-reads the clock at once, showing the true road and «not answering»; the clock also re-reads when the
    page becomes visible again.
- **Found by driving the screen, fixed:** Print has a row of its own, full width; and the last answer is cleared when the road changes.
- **Driven check DONE (14 Oct 2026):** on the local emulator the real `print-agent/agent.mjs` in emulator mode claimed a job written by
  Mise 2 and sent it to a fake TCP printer; it was one label and `isSingleLabel` accepted it.
- **Out of this step, a known defect of the CURRENT app:** `print-agent/agent.mjs` writes the payload as `'binary'` (latin1) while the
  label declares `^CI28` (UTF-8), so accented letters reach the printer wrong. A separate fix to the current app.
- **Found while testing, not a difference:** `userEvent.setup()` installs a clipboard on `navigator`, so a spec for a device with no
  clipboard has to remove it after rendering (the screen asks at draw time).

## Step 3d-5 as built (15 Oct 2026) — differences from the current app, on purpose

- **Built:** the label Settings at `/recipes/settings` (usage screen `recipes-settings`), a door «Settings» at the foot of the list
  after the Allergen sheet's, drawn only for `canManage`; an employee who types the address is sent to the list. Two cards in the
  current app's order, the setup note under them; every control saves on the tap through `saveLabelProfile`. The photo switch row
  is NOT here: it comes in 3d-9.
- **On purpose, NEW in Mise 2:** the writes are **not chained** behind each other. The current app chains them (a queue of
  promises); here each one is issued at once, in the order of the taps, because Firestore commits one client's writes in the order
  they were made and keeps unsent ones in its own persistent queue across an offline reload, whereas a chain would hold the later
  ones in memory where such a reload loses them. A refused save puts back only ITS OWN keys (to the values just before it), except
  a key a later save has set since.
- **On purpose, NEW in Mise 2:** the size group is a true single choice, so «Custom size» is the chosen one while its two boxes are
  open (the current app kept the preset pressed beside it); a preset tapped while a custom size waits its 350 ms cancels that write;
  a size is written as ONE write only after focus has left BOTH boxes (moving from Width to Height arms nothing, and focus or typing
  in either stops the 350 ms timer), and the boxes stay open while somebody is in them; an empty box, text that is no number or a
  value outside 20–300 mm writes nothing, puts both boxes back to the saved size and says so (`label.settings.sizeRange`, new in
  Mise 2) until the next valid size (the current app read an empty box as 0 and sent it to the rules); a size still waiting is
  written at once when the page is hidden (`visibilitychange`, `pagehide`).
- **On purpose, NEW in Mise 2:** a refusal puts a key back to the most recent earlier patch on it that was not itself refused,
  else to the confirmed value before the first patch in the air, so two refused saves on one key never bring back a refused value.
- **On purpose, NEW in Mise 2:** a box still holding typing, or a custom size still waiting, is written when the screen goes
  (the store's write outlives the screen) and the app is held busy (`markBusy`) meanwhile. A refusal after the screen has gone is
  said through the section's status message.

## Step 3d-6 as built (15 Oct 2026), slice A1 — differences from the current app, on purpose

Slice A1 is everything of the editor except linking a row to an ingredient (the suggestion list under a name, the link line and
the chooser: slice A2) and reordering the rows (slice B). The row component has a slot under its line for the first.

- **Built:** the editor at `/recipes/new` and `/recipes/<id>/edit` (usage screen `recipes-editor` for both), a working copy
  with every row spread, the rows (name, amount, unit menu of the 12 units, bin), the live Total and the not-weighed note, the
  two label boxes (only when the label profile prints them), the three checks, Save with its question, the leave guard, and the
  delete in two places.
- **On purpose, different addresses:** the current app has no addresses; here a new recipe is `/recipes/new` and an editor is
  `/recipes/<id>/edit`, one level below the list and the recipe. Back from a new recipe returns to the list with the focus on the
  button that opened it; Back from an editor returns to the recipe with the focus on «Edit» and the scroll where it was; an editor
  opened by its address replaces itself with the recipe.
- **On purpose, different places:** «New recipe» is a button at the TOP of the list (the current app has a «+» in its header) —
  beside the search box from 1000px, under it on a phone, for everybody who sees the section, also over «No recipes yet». «Edit» is
  the one action on the recipe's bar (Lucide pencil and the word), for everybody who sees the section. The delete is, for
  `canManage` only (absent for everybody else and for a new recipe): a low-key «Delete recipe» button at the bottom of the editor,
  and a small icon-only button at the very END of the recipe page, after Export.
- **On purpose, NEW in Mise 2:** the name box takes at most 199 characters (the rules refuse 200 and more; the current app finds out at the
  database, after the screen has left, because the save is local-first).
- **On purpose, NEW in Mise 2:** a save does NOT send `steps` or `endNote` (their editor is step 3d-8), so a merge leaves them exactly
  as stored. The current app rewrites them on every save from the copy it read. The oven loss and the two weighings stay unsent as
  before (Food cost owns them).
- **On purpose, NEW in Mise 2:** the editor of an existing recipe opens on the server's word, or after 1.2 s (at once when the phone is
  offline) with what the phone holds, like the Food cost editor — it copies the recipe once and Save writes it whole, so a copy a week
  old must not be saved over another phone's changes when the server can still answer. The current app opens at once.
- **On purpose, NEW in Mise 2:** the Total is the sum of the rows that will be SAVED (a row with no name is dropped on save, so it is
  not counted); the current app also counted an amount typed before its name.
- **On purpose, NEW in Mise 2:** a net weight or a shelf life the person has not touched goes through as stored (a net weight of 12.5 g
  is not rounded to 13 by saving a recipe whose box is hidden or untouched).
- **On purpose, NEW in Mise 2:** the delete goes back to the list with «Recipe deleted.» said exactly once. The recipe screen already
  says it when an open recipe disappears (deleted on another phone); a delete made on this phone marks its recipe first
  (`recipeDeletions.ts`), so that one stays quiet and does not step back a second time. From the page it steps back as the page's Back
  does (one entry); from the editor it replaces the editor with the list, the focus on the search box.
- **Same as the current app, kept:** Save returns to the LIST, not to the recipe; «to taste» hides the amount but keeps the number;
  an emptied shelf life leaves the key out; the Calculator warning is raced against 2.5 s; a recipe deleted on another phone while being
  edited is created again by Save.
- **Not built, by design, until its step:** «+ Create … as an ingredient» (Orders is not built), the photo reader's «Fill from a photo»
  (3d-9), the mixing procedure (3d-8).

### Slice A2 (item 91), as built

- **Built:** the suggestion list under a name, the link line and the chooser, ported as the current app has them (no price, pick renames only when the link changes, three answers, focus to the row's amount); the list is a hook in the page's flow (swallows pointerdown, never picks by itself) and the name box is a `combobox`. **On purpose, different:** no «+ Create … as an ingredient» row, in the list or the chooser (Orders is not built); the suggestion and chooser meta join with a real space for screen readers; `cat.searchAnIngredient` has no ellipsis (the current dictionary defines it twice, the later wins); `supplierLabel` is now exported from `shared/catalogue-model`.

### Slice B (item 92), as built

- **Built:** reordering is a MODE, as in the current app. A button «Reorder» / «Done» (`aria-pressed`) at the end of the ingredients head, present only with two or more rows. In the mode the rows are drawn by `ReorderRows.tsx` (a React Aria `GridList`, the Calculator's client list pattern): the name («(no name)» when empty), the amount (the number and the unit word, the word alone for «to taste» or an empty amount) and the grip; no boxes, no bin, no link line, no «Add ingredient»; the hint sits under the head and describes the list. The Total, the not-weighed note, the label fields and the delete stay. A move goes through the editor's `edit()` (dirty, `markBusy`, the leave guard), toggling the mode does not. The moves are `editorModel.moveWorkingRow` / `stepWorkingRow` / `dropWorkingRow` over the shared `moveRow`: the SAME `EditRow` objects move, so a row keeps its link and its `rid` (a guided mixing step points at a row by `rid`). Nothing new is saved, only the order of `ingredients`.
- **Both keyboards work:** React Aria's own (focus the grip, Enter, the arrows, Enter) and ArrowUp / ArrowDown on a grip, which move the row one place (nothing happens at the ends). ⚠️ The direct arrows are caught by a capture handler on a wrapper ABOVE the list, not on the grip: a grid row takes ArrowUp and ArrowDown in its own capture handler and re-sends them to the list, so a handler on the grip never hears them.
- **On purpose, different:** leaving the mode with «Done» puts the focus on that button, explicitly (a tap does not focus a button on Safari, and the focus would fall from a vanished grip to the page); the current app focuses the first name box, which pops the phone's keyboard. Entering the mode focuses the first grip; after every move or drop the focus is on the moved grip, set after the render.
- **Every grip is a Tab stop**, as in the current app: Tab / Shift+Tab on a grip with a neighbour focuses it (caught in the capture phase above the list; at the first and last grip the key goes on and the focus leaves the list), and a focus that lands on a row is handed to that row's grip. The hint describes the LIST, not the grips, so React Aria's own «start dragging» description stays on each grip (set by hand on the grid, because the list's drop handling wipes a prop passed to it).
- **On purpose, different:** on touch the drag starts with the browser's native long-press (React Aria), not the current app's 200 ms hold.
- **Same as the current app (parity):** the button changes its label and carries `aria-pressed`; a move by the arrows is not announced.
- **On purpose, different — the grip is at the END of the row**, in the bin's place (the current app and the Calculator's clients put it at the start). The right side of a reorder row is the Total row's geometry (the 116px cell with the number right-aligned in 52px, the unit word after it, then the grip as wide as the Total's spacer), so every number ends on the Total's right edge and the name keeps the width it has while editing. With the grip at the start, the drive showed «Acqu / a» and «Malt / o» broken on a 296px phone.
- **Save while reordering with a problem:** the mode is left first, the bad box is marked and takes the cursor AFTER the ordinary rows have been drawn (their boxes do not exist in the mode), and the sentence is said as before. Save with no problem saves from the mode and writes the new order.
- **Driven on the emulator** (15 Oct 2026, IT, owner, 1024/360/296, «Pane di Miano»): the mode, the first grip focused, ArrowDown, React Aria's keyboard drag, «Fine», Save — the saved order is the screen's and every row kept its link and its `rid` (Food cost's loss untouched); Save with no amount from the mode; toggling alone asks nothing on Back. axe clean, nothing sideways, no console error (driver `algprobe/mise-drive/drive-mise2-recipe-reorder.mjs`). ⚠️ **NOT driven: a mouse or finger drag.** Headless Edge never started a native drag on these rows (not with synthetic drag events, nor with the DevTools drag interception that works on a plain draggable element); the keyboard drag goes through the same `onReorder`. A finger on the lab tablet and a phone must try it before the switch — the same is true of the Calculator's client list, never dragged by a pointer either.

### Review fixes and the drive (15 Oct 2026)

- **Leaving after Save or Delete:** from an editor reached list → recipe → Modifica, Save and Delete step back TWO entries, so the
  phone's Back afterwards leaves the catalogue instead of reopening the recipe (or a «no longer exists» page); an editor opened by its
  address replaces itself with the list as before. The «no longer exists» screen's Back goes to the list.
- **An editor opened from the phone's copy** (after 1.2 s, or offline) is copied AGAIN when the server's first answer differs and
  nothing has been typed; with typing it is kept, as the current app keeps it.
- **296 px:** the editor's side padding is 4px on a phone and, under 340px, the unit menu (and the Total's cell) is 8px narrower, so the
  ingredient name keeps about 90px («Farina 0», «Sale fino» fit). A long unit word («pizzico») is cut short, as it was already.
- **Driven on the emulator** (IT, owner, 1024/360/296, and the English employee): new recipe with a link picked from the suggestions,
  edit of a recipe Food cost has weighed (the loss stays 12), the leave question, delete from the page's icon: every check passed, axe
  clean, no console error. `tests/rules/firestore-rules-check.mjs`: 1059 checks passed, including the Mise 2 save shape.

## Tablet notes 16 Oct 2026 — Duplicate, linked Import (owner's decision, 18 Oct 2026) — differences from the current app, on purpose

Two changes to the recipe page, both asked for after the owner tried the tablet. The current app has neither.

- **«Duplicate» (Lucide `Copy`).** A new action at the END of the recipe page, in this order: Export, Import (where the venue uses the
  Calculator), **Duplicate with its hint**, then the small Delete icon, which stays the very last. Shown with the gate of «New recipe»
  in the list (`canManage`): absent, not disabled, for an employee. It opens the ordinary NEW-recipe editor (`/recipes/new`) filled in
  from the recipe and **dirty**, using the hand-over the photo reader uses (`photoCarry.handOver`, now with an origin, `'photo'` or
  `'duplicate'`); the focus goes to the editor's title. Nothing is saved until Save; Back asks before discarding, and Back and
  Discard step back ONE level, to the ORIGINAL recipe (history back), the focus on its Duplicate button (`recipeReturn`, origin
  `duplicate`); a Save goes to the list with the new row focused, like any new recipe (P20). A second tap before the editor has
  opened pushes no second entry. The hint is tied to the button (`aria-describedby`), as Import's is.
  - **What the copy takes:** the name «{name} (copy)» / «{name} (copia)» (the original's end is cut when the whole would pass the
    name box's 199), every ingredient row as it is (`rid` and link included, so the procedure's steps still point at their rows), the
    pack weight, the shelf life, the procedure (steps and closing message).
  - **What it must never take:** the original's `id` (⚠️ `workingFrom` puts it in `rest`, and a copy that kept it would overwrite the
    original: `editorModel.duplicateWorking` builds `rest` from a whitelist, and a spec proves no `id` survives `cleanWorking`), the
    venue stamp, the oven loss and the two weighings (Food cost's, measured on the original's products).
  - **Saving** a new recipe now sends `steps` and `endNote` in the same create, shaped as the steps editor shapes them, with each step's
    rows cut down to the rows that exist in what is saved. An existing recipe's save still never sends them (`KEPT_FIELDS`). The rules
    already accept both on a create (a rules check was added).
- **«Import into Calculator» now LINKS instead of copying.** The Calculator tab it makes (or refreshes) carries `catalogueId`, so the
  Calculator reads the recipe live and every change in the Catalogue changes its doughs. The weighable rows are still written as the
  tab's own `ingredients`: the leftover copy the tab shows if someone later picks «own» in the Calculator's source box.
  - **The tab that already stands for the recipe is reused WHOLE**: the first tab linked to it (`catalogueId`, however it got linked),
    else the old copy `cat-<id>` if it is still unlinked. Only `catalogueId` and the leftover `ingredients` change; its id, name,
    order, visibility, logic, tray weight, leavening and percentages stay. A tab already linked to this recipe is not touched at all:
    nothing is written, no revision bump, and the page says «already linked». A tab linked to ANOTHER recipe is never hijacked, even
    under the id `cat-<id>`: the new tab then takes `cat-<id>-2`, `-3`… (never a duplicate id).
  - **⚠️ The unweighable-row rule.** A linked tab with ANY row that is not weighable (pieces, spoons, «to taste», or 0 g) calculates
    nothing (`resolveRecipe`, problem `unweighable`, decided 1 Aug 2026). So BEFORE the question the page asks that very function: a
    recipe with no rows says «nothing to import» (as before); one with a row the Calculator cannot follow says, in the section's status
    line, one of the two sentences below naming the row — no question, no write. This replaces the current app's «these rows will be left out» note, which would now leave a recipe that cannot calculate.
  - **⚠️ Kilos.** `resolveRecipe` accepted `kg` as weighable but read the `grams` field without the unit's factor, so «1 kg» of flour
    was calculated as 1 g: a dough a thousand times too light, with no warning. FIXED IN MISE 2 ONLY: `shared/calculator-recipe-source`
    now reads a `kg` row as grams × 1000 (the one intended difference from `js/calculator-recipe-source.js`, whose fix for the live
    app is a separate change), so a recipe with kilos is accepted by the import. What the import refuses is exactly what
    `resolveRecipe` refuses (`catalogue-model.calculatorRefusal` asks it): pieces, spoons, «to taste», millilitres, litres… («The row
    “X” is not by weight… write it in grams or kilos») and a row with no amount, 0 g («The row “X” has no amount… write how many grams»).
  - **The delete warning tells the two cases apart** (`store.calculatorImportOf` now answers `'linked' | 'copy' | null`): a linked tab
    says «The Calculator uses it: afterwards that tab cannot calculate until you pick another recipe for it.»; an old unlinked copy
    keeps the current sentence («that copy will stay»).
  - New wording (EN / IT) for the question, the hint under the button and the two done messages (linked / was already there and now
    follows); the old «copy» keys are gone. `shared/catalogue-model`'s import functions now differ from `js/catalogue/catalogue-model.js`
    on purpose, so their new tests run against the port only (the tests that still hold for both stay in the paired block).

## Recipe categories and the archive (slice «3d-9 categories», 25 Oct 2026) — NEW IN MISE 2, differences from the current app

Federico's request (23 Oct 2026): «dividere per categorie le ricette, tipo ricette stagionali; finita la stagione le voglio poter
archiviare per snellire la lista». Decided 24 Oct 2026 (memory `piano-mise-2`, «✅ DECIDED»): ONE category per recipe from a fixed
list per venue, edited in the Catalogue Settings like ingredient categories; archive and restore by owner + manager; «Archiviate (N)»
folded at the foot of the list; an archived recipe stays linked everywhere (Calculator, labels, Food cost keep working) but is left out
of the pickers for NEW links. **Size M, one PR.** The current app has neither: it shows archived recipes in its normal list and ignores
the category (its merge saves keep both fields).

**Data** (`firestore.rules`, rules check cases «recipe shelf»; the logic is `shared/src/recipe-shelf.ts`, new, not paired):
- `recipes/{id}.category` — the word, 1–100 characters; «no category» is NO field (a removal). A word taken off the list reads as
  «no category» and comes back if the word is put back — so deleting a category writes no recipe.
- `recipes/{id}.archived` — only `true` is stored; a restore removes it. The rules ask `canManage(catalogue)` only when the state
  MOVES, so an employee still saves an archived recipe. A save never sends the flag (the store keeps it); archiving is its own
  merge of the flag alone (`store.setArchived`), local-first with rollback (`recipe-not-archived`).
- `config/labels.recipeCategories` — the venue's list (≤ 100 words, ≤ 40 characters each in the box), written whole through the
  label profile's local-first write (`store.saveRecipeCategories`); no extra read: every recipe screen already watches the document.
- The store keeps both recipe fields beside the shared normaliser's shape (`labelTexts.normalizeStoredRecipe`), and they reach the
  `catalogue-recipes` copy; the current app's normaliser drops them from its copy, which is harmless (the database keeps them).

**What changes on screen — the choices taken for him (each the recommended option; listed first in the PR):**
1. **The list is grouped under the category headings**, alphabetical in the interface language, «Senza categoria» last; inside a
   group the order stays «most used first». With no category in use the list looks exactly as before (no headings). A search runs
   over every group; a heading with no match disappears.
2. **«Archiviate (N)»** is a folded group after the groups, before the Allergen sheet and Settings doors, for EVERYBODY (an employee may
   open an archived recipe to print its label). It opens by itself when a search finds a recipe inside it or the recipe open beside
   the list is archived, and stays as the person left it otherwise.
3. **The category is chosen in the recipe editor**, a menu under the name («Nessuna categoria» first, then the list), drawn only when
   the venue has at least one category; whoever may edit a recipe may choose. The editor sends the category only when the choice
   MOVED, so a recipe whose word left the list is not stripped of it by an unrelated save. «Duplica» copies the category, never the
   archive.
4. **The list of categories lives in the Catalogue Settings** (owner + manager), a card «Categorie delle ricette»: a box + «Aggiungi»
   (refused: empty, over 40 characters, already there whatever the case, 100 words), and each word with a small low-key bin that asks
   first, saying how many recipes go back to «Senza categoria» (and that they come back if the word is added again). No rename, no
   manual order (alphabetical).
5. **«Archivia»** is a button at the end of the recipe page, after «Duplica» and before the Delete icon, owner + manager only, with a
   one-line hint; it asks first («Archiviare “{name}”?», the consequence in one sentence). After it the page STAYS open with the
   archived banner (one tap to undo), and says «Ricetta archiviata.».
6. **An archived recipe's page** starts with a banner «Archiviata» and one sentence (out of the list and of the choices for new links;
   Calculator, labels and Food cost keep working); owner + manager get «Ripristina» in it, which does not ask (nothing is lost) and
   says «Ricetta ripristinata.». Everything else on the page works, except **«Importa nel Calcolatore», hidden** (it makes a NEW link).
7. **The pickers for NEW links leave archived recipes out**: the recipe editor's suggestions and chooser (a sub-recipe), the
   Calculator's «link to a Catalogue recipe» chooser, Food cost's recipe chooser. What already points at an archived recipe keeps
   naming it and working (it is read by id).
8. **The Allergen sheet keeps listing archived recipes** (health first: a customer may ask about something still on the shelf).

Not in this slice: renaming a category, a category on the recipe page itself, filtering by tapping a heading.

## Image labels 1b — the «with logo» label printed through the shop computer (26 Oct 2026) — NEW IN MISE 2, differences from the current app

Step 1b of the image labels (memory `piano-etichette-immagine`; 1a = PR #394 engine + PR #395 screen). The «with logo» label
(80 × 60 mm, drawn as an image, `^GFA` Z64) goes through the SAME queue (`print-jobs`) and the SAME program
(`print-agent/agent.mjs`) as the standard Zebra label, so one tap on the tablet, a phone or the home PC prints it on the
Zebra attached to the home PC. The current app has no image label, so everything here is new. **Size S–M, one PR.**

**The agent's half** (`js/print-queue-model.js`, which the agent imports, and its port `shared/src/print-queue-model.ts`, kept
in step by the cross-check spec):
- `LABEL_COMMANDS` gains `GF`, `PO` and `PR`. Each is accepted only in the one shape the app writes: `^GFA,<n>,<n>,<n>,:Z64:<base64>:<crc>`
  (never hex, never binary, never a stored graphic), `^PON` / `^POI`, `^PR` with digits only. Still no tilde anywhere.
- The darkness (the owner's script starts with `~SD28`) belongs to the computer the printer hangs off, NEVER to a job: a new
  optional `printer.darkness` (0–30) in the agent's own settings file; when set, the agent sends `~SD<nn>` before EVERY job. A
  Zebra keeps the darkness until it is switched off, so text labels printed after an image label get it too — said in the README.
  The example settings show 28. Agent version 1.1.0; a 1.0.x agent refuses an image job as «not a single label».

**The queue and the rules:** no new job field (the copies are the job's `copies` AND the `^PQ` inside the payload, as for the
standard label). The payload limit stays 20 000 characters: measured on the golden corpus, the densest printable label is far under it
(the spec pins the margin). Rules unchanged; new rules cases: an image job is allowed, a job of exactly 20 000 characters is allowed,
a job carrying the darkness `~SD28` is denied, a `darkness` key is denied.

**The screen** (`ImageLabelBody.tsx`; the decision is `shared/src/image-label-print.ts`, new, not paired):
1. **Which road «Stampa» takes is decided by the shop computer's heartbeat, not by the venue's printer setting** (that card is
   hidden for the logo model, and the image label is a Zebra label by construction). A computer answering with an agent ≥ 1.1.0 →
   «Stampa» queues the job, with «Stampante pronta» above the button. Computers that reported once but none answering now → «il
   computer del negozio non risponde» and the button becomes «Finestra di stampa» (this device's print dialog, as in 1a). A
   computer answering with an older agent → «il programma di stampa va aggiornato», same fallback. No computer ever reported → as
   in 1a: «Stampa» opens the print dialog and no line is shown. The heartbeat is judged against a clock that moves every 30 s and
   again at the tap, exactly like the standard label.
2. **The Copies box now counts for the queued job too**, not only for the printer code; its note says so when the road is the
   shop computer.
3. The tap says only «sent», never «printed»; a second tap while one is on its way does nothing; a refused write says so and keeps
   the screen. Copy ZPL stays as the fallback, unchanged.
4. Before queueing, the app checks the job with the agent's own `isSingleLabel`: a job the agent would refuse is never queued.
