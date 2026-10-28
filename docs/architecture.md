# Mise 2 — architecture

Mise 2 is the rewrite of Mise as ONE tablet-first single-page app in React + TypeScript + Vite.
It lives in this repository beside the current app until the switch (step 5 of the plan), and
until then it is served only on the preview, at `<preview>/mise2/`. This file is the map: what
is where, why it is that way, and the rules a new screen must follow.

> ⚠️ GitHub Pages builds this repository with Jekyll. A double curly brace or a curly brace
> followed by a percent sign anywhere in a committed Markdown file fails the whole Pages build
> (`tests/mise2-isolation.test.mjs` pins it). Write JSX examples without them.

## The layout

| Folder | What | Package |
|---|---|---|
| `js/`, `*.html`, `*.css`, `sw.js`, `dist/` | the CURRENT app (bug fixes only until the switch) | root, zero dependencies |
| `functions/` | Cloud Functions, shared by both apps | its own |
| `shared/` | pure TypeScript logic, ported from `js/` | `@mise/shared` |
| `app/` | Mise 2 itself | `mise2-app` |
| `docs/` | this file | — |

`app/` and `shared/` are self-contained npm packages, each with its own lockfile and an `.npmrc`
that sets `ignore-scripts=true` (no package runs code at install) and `save-exact=true` (every
version written down exactly). The root `package.json` stays the current app's: no workspaces,
nothing of Mise 2 in its lockfile (`tests/mise2-isolation.test.mjs`).

## Living beside the current app

Mise 2 is served from the SAME origin as the current app. That is deliberate (one sign-in serves
both, and the switch keeps the address) and it has consequences that every change must respect:

- **One IndexedDB.** Auth's record of who is signed in and Firestore's offline cache are shared.
  The npm `firebase` package is pinned to exactly the gstatic version `js/firebase.js` loads, and
  `tests/mise2-ci.test.mjs` fails if they differ; Auth starts with `initializeAuth` and getAuth()'s
  persistence list in its order (`tests/auth-start.test.mjs` pins both apps).
- **One localStorage.** Mise 2 uses the current app's keys with the current app's meaning:
  `active-location`, `offline-cache-uid`, `device-id`, `device-ping-*`, `error-reports`, `usage-*`.
  Either app's sign-out or venue switch runs the same keep-list (`KEEP_PREFIXES`, in
  `js/local-data.js` and `shared/src/local-data.ts`) over the other's keys: a key Mise 2 must keep
  across a venue switch starts with one of those prefixes, in both files. The Stocktake's two copies
  are NOT kept: `inventory-<lid>-<YYYY-MM>` (the month as last seen) and
  `inventory-unsaved-<lid>-<YYYY-MM>` (counts typed here that the browser's own database has not
  shown back yet); the venue is in the key, so a switch wipes them and they cannot cross venues.
- **One service worker scope.** The current `sw.js` controls `/mise2/` too. Mise 2 registers no
  service worker until step 5, when it takes over at the same path and name.
- **No App Check, no reCAPTCHA** (his decision, PR #212) — in either app.
- **The preview publishes only what is allowed.** `build-mise2` (`.github/workflows/preview.yml`)
  builds Mise 2 in a job that holds no Google credential and hands the built files to the deploy
  job, which builds nothing (`tests/preview-hosting.test.mjs`).

## The stack, and why

| Piece | Version | Why |
|---|---|---|
| React | 19.3.0 | components end the stale-screen bugs of the current app |
| TypeScript | 7.0.2 (`tsc` native) | a missing translation or a wrong field is a build error |
| Vite | 8.3.4 | build target `chrome101, edge101, firefox104, safari16`: the lab tablet (SM-T550, Chrome 101 — its ceiling on Google Play) and iPhone Safari 16.4 |
| React Aria Components | 1.21.1 | accessible controls (focus, keyboard, screen readers) without writing them |
| react-router | 8.4.0 | hash routing (`#/orders`), because GitHub Pages cannot rewrite deep links |
| lucide-react | 1.48.0 | the icon set of the design |
| Firebase | 12.19.0 | the same SDK as the current app (see above) |
| jspdf | 4.2.1 | the recipe export's PDF; loaded only when someone taps Export |
| write-excel-file | 4.1.1 | the recipe export's Excel file; loaded only when someone taps Export |
| Vitest + Testing Library + jsdom | — | specs |
| fflate | 0.8.2 (runtime, `app/` only — the version the current app vendors; ⚠️ NOT 0.8.3, which walks a forged ZIP64 count: see the header of `zipRead.ts` before any upgrade) | opens the zip archives of the invoice import (`app/src/suppliers/invoiceImport/zipRead.ts`; `shared/` has no runtime dependency, so the zip reader is app code); specs also use it to unzip the .xlsx the recipe export wrote |
| Geist / Geist Mono | @fontsource-variable | bundled, so the app starts offline and no third party sees who opens it |

Preact was evaluated in step 2c and NOT adopted: React is about a fifth of the bundle, and React
Aria does not support Preact. The numbers are below.

## `app/src`, folder by folder

- `main.tsx` — loads the phone's language, creates the Firebase backend once, the session store,
  starts telemetry BEFORE the session (so an error during start-up is caught), then renders
  `AppBoundary › I18nProvider › SessionProvider › SessionGate › RouterProvider`.
- `i18n/` — typed messages without a library. `en.ts` is the source of the keys (`as const`);
  `it.ts` is typed against it, so a missing or extra Italian key fails `tsc` and therefore the
  build. `{name}` interpolation; plurals through Intl.PluralRules with the count passed as `n`
  (the current app's name); Italian is a lazy chunk loaded before the first render. Curly
  apostrophes only (a spec refuses `'`).
- `session/` — who is signed in and which venue is open. `session.ts` is the session half of
  `js/firebase.js`, decision for decision, behind an injected backend (`backend.ts`), so every trap
  is a spec with a fake backend (`session.spec.ts`). `firebaseBackend.ts` is the real one.
  `visibility.ts` decides which sections a person sees (the current app's page gate). The screens
  above a venue (sign-in, picker, no access, error) and `SessionGate` live here too.
- `shell/` — the frame: the dark rail (700px and wider), the phone tab bar, the top bar (venue,
  date, connection), `Page` (one h1, the tab title, focus on navigation; an optional `action` — ONE small control on the title line, today only Settings' «Log out», whose failure message wraps under the line), the placeholders, More,
  Not found, Not available, the offline banner.
- `errors/` — `PartBoundary` (a part that fails shows «This part didn't load / Reload», the rest
  keeps working), `RootError` and `AppBoundary` (the whole app).
- `telemetry/` — error reports, the daily device line, the usage record: ports of
  `js/error-report.js`, `js/device-ping.js`, `js/usage.js`, writing through `sinks.ts` exactly the
  shapes `firestore.rules` accepts. Screens are named `m2:<section>` and the build is stamped
  `m2-<7-char commit>`, so the owner's statistics tell the two apps apart.
- `data/` — where every section gets its data from (`DataContext`): one source factory per
  section, built once in `main.tsx` on the session's backend (`createDataServices`), so a screen
  never reaches for Firestore itself. A spec passes fakes instead (`testing/renderApp.tsx`, with
  `testing/fakePastriesSource.ts`), so no screen needs a database to be tested. A section's own
  `*Source.ts` is the only file that knows its collections' paths and shapes.
- `pastries/` — the first real section, and the pattern for the next: a source (`pastriesSource.ts`,
  the Firestore half, a port of `js/pastries/firebase-pastries.js`), a store (`pastriesStore.ts`,
  plain TypeScript with no React: the seven days, tonight's confirmations and the lock, the
  records), a context that starts it when the section opens and stops it when it closes
  (`PastriesContext.tsx`), and the screens: `PastriesSection` (the frame and the address),
  `DaysNav`, `DayPanel`, `Editor`, `Records`. `shell/sectionScreens.ts` lists it, so its code is
  fetched only when somebody opens it. Its parity list is `docs/parity/pastries.md`.
- `stocktake/` — the Stocktake («Magazzino»), the second section, built the same way: a source
  (`stocktakeSource.ts`, a port of `js/inventory/firebase-inventory.js`: one month's document, the
  ingredients, their prices, a month's orders read once), a store (`stocktakeStore.ts`: ONE month at
  a time — `openMonth()` follows the month in the address — with the outbox of `inventory-outbox`,
  local-first and never rolled back, a closed month refusing every change, and nothing typed into
  a box until the month has answered once), a context (`StocktakeContext.tsx`), and the screens:
  `StocktakeSection` (the frame, the address `/stocktake/<YYYY-MM>[/product/<id>|/cost]`, the
  split from 1000px), `MonthBar`, `CountList` with `ProductRow` and `CountBox`, `StocktakeProduct`,
  `StocktakeCost`, `MonthActions`. The money comes from the venue's country through
  `session/useMoney.ts`. Its parity list is `docs/parity/stocktake.md`.
- `foodcost/` — Food cost, the third section, built the same way: a source (`foodcostSource.ts`, a
  port of `js/foodcost/firebase-foodcost.js`: products written whole with their margin point in the
  same batch, the recipes and the ingredients with their prices read to cost a product, the hourly
  labour cost, a product's history read once), a store (`foodcostStore.ts`: local-first and never
  stuck, a refused write rolled back and said as a `FoodcostMessage`, an empty answer from the
  browser's own database not believed over a copy that had products, the labour rate watched only
  for whoever runs the place), a context (`FoodcostContext.tsx`) and the screens: `FoodcostSection`
  (the frame, the split from 1000px, the scroll it owns and the hand-back of the focus),
  `FoodcostList` with `ProductRow` (worst food cost first, the light as a dot AND a word),
  `ProductEditor` (the product's own screen: a wrapper that follows the id in the address and waits
  for the product, around `ProductForm`, keyed on the id, which copies the product once and works on
  that copy — with `ProductAnswer`, `LineRow`, `WeighingPair`, `NameSuggest`, `NumberBox`, the
  chooser `PickDialog` and the `VatGuideDialog`; the working copy's rules are in
  `productEditorModel.ts`), `MarginHistory`, `FoodcostSettings` (the hourly labour cost, only for
  whoever runs the place; it waits for the rate before it copies it). Addresses, in
  `foodcostPath.ts` (ids split before they are decoded): `/food-cost`, `/new`, `/product/<id>`,
  `/product/<id>/history`, `/settings`; anything else goes back to the list. The usage record names
  four screens: `foodcost`, `foodcost-product` (new or existing), `foodcost-history`,
  `foodcost-settings`. `foodcostNav.ts` and `handBack.ts` are this section's copies of the
  Stocktake's (a feature never imports from another feature's folder). The money comes from the
  venue's country (`session/useMoney.ts`), the percentages and dates from the interface language.
  Its parity list is `docs/parity/foodcost.md`.
  Step 3d-7 slice B opens Food cost FROM a recipe. Two more addresses, `?recipe=<id>` (the ENTRY: `RecipeEntry.tsx` draws only
  «Loading…» and REPLACES itself, once, with the only product made with the recipe, the narrowed list, a new product drafted
  from the recipe, or the plain list) and `?using=<id>` (the list narrowed to the products made with the recipe, with its own bar:
  Back, the title and «Show all»); a product and its history keep whichever query they were opened with. `copyWait.ts` is the
  wait before the entry decides on a copy only this phone holds (`COPY_WAIT_MS`). ⚠️ Back to the recipe is never a second entry
  for it: the navigation state carries `recipeDepth` (`foodcostNav.ts`: the recipe's push = 1, every push inside Food cost +1, a
  replace keeps it) and Back is `navigate(-depth)`; the narrowed list is always the entry at depth 1, so a screen's Back to it is
  `-(depth - 1)`. With no depth in the state the screen replaces itself with the recipe. The recipe side (the button, and
  `recipeReturn.ts` bringing the recipe back with its focus and scroll) is in the `recipes/` entry below.
- `calculator/` — the Calculator, the fourth section, built the same way. Step 3c-1 is in slices; after
  slice A it holds the data layer (`calculatorSource.ts`, a port of the Calculator's half of
  `js/firebase.js`; `calculatorStore.ts`: the configuration, the linked catalogue recipes watched one by
  one and the 30 days of logs, local-first, with the current app's `calculator-config` and `logs-cache`
  copies; `CalculatorContext.tsx`) and the work view: `CalculatorSection` (the frame and the address),
  `RecipeTabs` (a tab list for two to four recipes, a plain h2 for one), `RecipePanel` (a recipe's entries
  by its logic — the leavening knob, trays, total, orders, extra dough — and its scaled recipe),
  `OrderCards`, `NumberField` (the current app's number-box behaviour: a 0 empties on tap, an empty box
  comes back as 0), `ResultCard` (rows, total, divisor, crates, and the sentence of a recipe that cannot
  be calculated). Addresses, in `calculatorPath.ts` (ids split before they are decoded): `/calculator` and
  `/calculator/<recipeId>`; an unknown or hidden recipe goes to the first visible one by replacing the
  address, and picking a tab REPLACES the entry too. The usage record names one screen, `calculator`. From
  1000px the entries are on the left and the recipe on the right, sticking to the top (`RecipePanel.module.css`).
  What each tab remembers lives in the current app's own `localStorage` keys (`calculatorTabState.ts`,
  spelled by `shared/src/calculator-tab-keys.ts`): both apps read each other's numbers, `touched-<rid>` is
  written only where a number is typed or an option picked, and the new-work-day sweep (4 am) clears a stale
  tab before it is first drawn and when the app comes back to the foreground — never while it is on screen
  (`TabStateContext.tsx`). The maths is the shared ports (`calculateTab` in `calculatorResult.ts` only wires
  them). Slice B adds the rest of the work view. The recipe is shown only once the dough was confirmed
  (`revealed-<rid>`, and `lock-<rid>` `{"locked":bool,"logId":string|null}`, both the current app's keys: a
  tab confirmed there is confirmed here), and then it is the FIRST node of the panel (moved, never reordered
  with CSS), otherwise it sits just before «Reset all fields». Confirm (`runConfirm` of `shared/src/confirm-flow.ts`:
  a Today/Tomorrow dialog unless `askDoughDay` is off) builds the version in `calculatorSave.ts` from the
  recipe the screen shows (`sheetRecipe`), hands it to the store's `confirmDough`, writes `revealed` and
  `lock`, locks every box but the divisor and tells the usage record (`dough-confirmed`); a tab that cannot be
  calculated is refused in a dialog with the screen's own sentence; a full log leaves the tab open. Edit asks,
  then unlocks keeping the link; Reset asks (danger) and goes through the ONE forget function. The store's
  messages (`calculatorMessages.ts`) reach the section's `StatusMessage`. `ResultCard` also holds the
  full-screen view (`RecipeFullScreen`: a native `<dialog>`, six text sizes in `mise.calcZoomStep`), Copy
  (`clipboard.ts`, raced against 2 s) and Send (`ui/SendSheet.tsx`, the shared «which road» sheet: WhatsApp
  with no recipient, or the mail app). jsdom has no modal `<dialog>`: `testing/setup.ts` gives it
  `showModal`/`close`. Step 3c-2 adds Settings, one level below the work view: a Settings button at the top of the
  work view and of the empty states (none while «Loading…»; «Add a recipe» and «Choose which to show» beside it),
  and the addresses `/calculator/settings` (the hub, `CalculatorSettings`, with the two switches that save on the
  tap and show «Saved ✓»), `/extra`, `/divisor[/<recipeId>]`, `/log`, `/clients[/<id>]` and
  `/recipes[/<id>|/new]`; `settings` as the first segment always means Settings. The usage record names every
  address under Settings `settings` (`calculatorScreenName` in `shell/sections.ts`). Extra, Divisor and Log are each
  a `SettingsEditor` (a working copy, Save disabled until it differs, the question, the discard question through
  `useBlocker`, `markBusy` while dirty, a second tap ignored while a save is in the air); Clients
  (`ClientsEditor` › `ClientList` with a React Aria `GridList` drag-and-drop reorder, `ClientScreen`,
  `ProductCard`) and Recipes (`RecipesEditor` › `RecipeList`, an accordion, and `RecipeScreen` with `SourceBox`,
  `LeaveningBox` and the `CataloguePicker`) hold ONE working copy ABOVE their list and detail, so moving between
  them keeps the edits, and ONE blocker each (a router supports one) asking both «leave without saving?» and
  «discard this new …?». All of them save through ONE path, `useSaveConfig` (a port of `saveConfigOrSay`), and
  write over the LATEST configuration only what they own. ⚠️ They open only once the SERVER has answered
  (`configFromServer` in the store, `SettingsScreens`): the browser's own database answers at once with whatever
  this phone last saw, and a tablet reopening straight onto an editor would otherwise save yesterday's address book
  over today's; the store also sends nothing before that answer. Linking a recipe to the Catalogue stamps row ids in
  a transaction on the recipe AS THE SERVER HOLDS IT (`stampRowIds`), never on the picker's copy. Back hands the
  focus to the button that opened the screen (`handBack.ts`, a stack, because each level is a fresh screen). The
  browser's Back cannot be stopped from leaving an editor when the history entry was made by typing an address
  (React Router can only block entries it created) — in-app moves always ask. The ordering link on a
  client (`OrderingLink`, drawn by `ClientScreen`; step 3c-4b, slice C2), the republishing of the clients' ordering menus on save
  (the store's `onConfigSaved`) and the hub's Client ordering door with its deadline editor (`CutoffEditor`, at
  `/calculator/settings/ordering`) are built. The market order (3c-4a, slice B) is a third door, «Send order» (`SendOrder.tsx`: the door, the picker of
  lists and direct clients and the «Send to» question, all dialogs), and `OrderForm` (a dialog with its own scrolling body: the quantities start from
  `prefillFromLogs` worked out ONCE when it opens, or from nothing and a sentence when the logs have not arrived; closing it with hand-changed
  quantities asks and holds `markBusy`; `orderModel.ts` is its pure half). The message is `shared/src/calculator-order-text.ts`, handed to the
  shared send sheet. Its usage record names no screen of its own. Its parity list is `docs/parity/calculator.md`.

  Slice C adds the WhatsApp lists editor, a door «WhatsApp» in the hub (the lists the market order is sent from). Addresses, in
  `calculatorPath.ts`: `/calculator/settings/whatsapp` (the top: `WhatsappTop` — the prefill window, the lists and the direct
  clients, a delete icon each, no Save; both apply at once over the LATEST configuration), `/list/<id>` (`WhatsappListScreen`),
  `/list/<id>/add` (`WhatsappClientChooser`), `/list/<id>/client/<clientId>` and `/direct/<id>` (`WhatsappLinesScreen`: products
  and free lines), their `/add` pickers (`WhatsappPicker`), and `/list/new` and `/direct/new`, which make an empty item and replace
  themselves with its address. `WhatsappEditor` holds ONE working copy of THE ONE ITEM being edited (a list with its entries, or a
  direct client) above those screens, with one blocker and `markBusy` while dirty; Save writes only that item over the latest
  configuration (`whatsappModel.ts`, the pure half) and returns to the top in one step (each pushed screen carries its depth in the
  navigation state, `calculatorNav.ts`). A free line's id is settled by the store's normaliser at save, never while typing.

  Step 3c-3 adds the Dough history (slice C1), a button «Dough history» beside Settings at the top of the work view,
  one level down: `DoughHistory` (the frame: the list and the open log side by side from 1000px, one at a time on a
  phone; it OWNS THE SCROLL like the Stocktake, rule 9), `LogList` › `LogCard` (one card per log, the dough's name a
  button stretched over the card, no action buttons on it), `LogOne` (the log read-only: `LogBody` › `LogOrder` and
  `LogSheet`, which borrows `ResultCard.module.css` so the two cannot drift; History, Edit for a manual log only, and a
  small Delete icon that asks), `LogHistory` and `LogVersionScreen` (`LogHistoryScreens.tsx`: the versions newest first,
  one version drawn like the log, Restore on top), `DayBadge` + `logDay.ts` (the words of the day, tone coloured),
  `logsModel.ts` (what the list shows). Addresses, in `calculatorPath.ts`: `/calculator/log`, `/log/new`, `/log/<id>`,
  `/log/<id>/edit`, `/log/<id>/history`, `/log/<id>/history/<n>` (1-based); `log` as the first segment always means the
  Dough history. The usage record names them `log` and, for the history and a version, `log-history`. The detail's hand-back
  is scoped (`isListOpener`) because the list stays mounted beside it: a screen that appears next to a mounted one must not
  take the focus that belongs to the one that stays. A log deleted or a version restored replaces the opener on top of the
  stack with the title of the screen it lands on (`replaceTop`). A log deleted elsewhere while open shows «Dough not found.»;
  one bad card is skipped (`SkipBoundary`), never fatal.

  Slice C2 adds the two editors, drawn in the same right-hand pane: `LogAdd` (`/log/new`: a recipe, Today or Tomorrow, then
  trays / a total / quantities by the recipe's logic) and `LogEdit` (`/log/<id>/edit`, a log made by hand only; any other
  log's address goes to the log). Both are `SettingsEditor`'s form (a working copy, Save disabled until something
  changed, the question, the discard question on every way out) with its `commit` and `beforeSave` props instead of a
  configuration `build`; they share `LogQtyRows` (one card per client, as `js/log-qty.js` is shared), `LogAmountFields`
  (trays with «= N g», the typed total) and `LogEditor.module.css`. What they save is `logVersions.ts`; the sentence for a
  recipe that cannot be saved is `recipeProblemSentence`, the work view's own. Edit takes its copy ONCE, when the log is
  first on screen and the settings have answered, and reads the log again at Save for the version it appends to. After Add
  the list takes the focus back on the Add button; after Edit, the log's own screen on the Edit button.

  Step 3c-4b adds the clients' own orders, the bakery's side (slice C1; slice C2 added the deadline editor and the ordering link). The
  data layer is `clientOrdersSource.ts` (the Firestore half, a port of `js/client-orders-data.js`, including the second-app
  account that mints an ordering link) and `clientOrdersStore.ts` (plain TypeScript: the client orders and the deadline are
  watched while the Calculator is open, the deadline and «this order was used» are written local-first with a refusal said as a
  `ClientOrdersMessage`, the links are read and minted only when a client's screen asks, and the clients' menus are republished
  from the configuration store's `onConfigSaved`); `CalculatorContext` starts both stores and `useClientOrders()` reads them.
  The screens: `OrdersBanner` (the link above the tabs), the door «Client orders» in the work view's `Doors`, `OrdersReceived` (the
  frame: title, the two-link view switch, the list of orders still coming), `ClientOrderCard` (`OrderCard` with the button,
  `PastOrderCard` without), `OrdersHistory` (read on demand, «Show older»), `useApplyOrder` (inspect, ask, write through the tab
  memory, then mark used) over `clientOrdersView.ts` (the pure half). Addresses, in `calculatorPath.ts`: `/calculator/orders` and
  `/calculator/orders/history`; `orders` as the first segment always means this screen. The usage record names both
  `client-orders`. Slice C2 adds `CutoffEditor` (a `SettingsEditor` with `commit`: it copies the deadline only once
  `cutoffFromServer` is true, saves local-first through `store.saveCutoff` and steps back) and `OrderingLink` (a labelled group on
  `ClientScreen`: only a sentence while the Clients editor is dirty, a read of the links on mount and after a save, Copy and Send
  for everybody, Create/Replace/Turn off only for `canManage`, no Create when the read failed); both share
  `ClientOrdering.module.css`. `applied-not-recorded` is an alert dialog (`clientOrdersMessageDelivery`), `cutoff-not-saved` a
  status message; the work view's door is «Client orders». Its parity list is `docs/parity/calculator.md` (the section for slice C1).
- `recipes/` — the Recipe catalogue (section id `recipes`, step 3d, built in slices; its parity list is
  `docs/parity/catalogue.md`). The data layer: `recipesSource.ts` (the Firestore half, read-only so far: the
  recipes, live, while the section is open), `recipesStore.ts` (plain TypeScript: the recipes stored NORMALISED
  under the current app's `catalogue-recipes`, the open counts `catalogue-usage` and the remembered batches
  `catalogue-scaled`, an empty answer from the browser's own database not believed, counts pruned only on the
  server's word) and `RecipesContext.tsx`. Step 3d-1 adds the screens: `RecipesSection` (the frame, the split from
  1000px, the scroll it owns and the hand-back of the focus, as Food cost), `RecipesList` (the search box, mounted
  once and never redrawn by a snapshot, over the recipes most opened first; the counts that decide the ORDER are
  frozen while a recipe is open beside the list), `RecipesDetail` (the prompt, or a recipe followed live: «Loading…»
  until the server has answered, then not found; deleted elsewhere goes back to the list and says so),
  `RecipeView` (the bar and the ingredient list as a table, tapped for the full screen) and `BatchCard` (grams, the
  confirm that spells the amount both ways and raises its voice for an absurd batch, Clear, 12 h). Addresses, in
  `recipesPath.ts`: `/recipes`, `/recipes/<id>` and (3d-2) `/recipes/allergens` and (3d-3) `/recipes/<id>/label` and (3d-5) `/recipes/settings`; `new` and `photo` are reserved words (3d-9: `/recipes/photo` is the photo screen; 3d-6: `/recipes/new` and `/recipes/<id>/edit` are the editor's; 3d-8: `/recipes/<id>/steps` and `/recipes/<id>/mix`). The usage record names nine screens, `recipes`, `recipes-detail`, `recipes-allergens`, `recipes-settings`, `recipes-label`, `recipes-editor`, (3d-8) `recipes-steps` and `recipes-run`, and (3d-9) `recipes-photo`. `recipesNav.ts` and
  `handBack.ts` are this section's copies of Food cost's. Step 3d-2 adds the allergen screens: `AllergenCard` and
  `DeclarationCard` on the recipe screen (a verdict only once the store's `ingredientsLoaded`, a neutral «checking» line before
  it; Copy through `ui/clipboard` and Send through `ui/SendSheet`), `AllergenSheet` at `/recipes/allergens` (gated again by
  `allergensOn` in `RecipesSection`, door at the foot of the list, drawn in the right-hand pane on the split) and
  `allergenTables.ts` / `allergenText.ts`. Step 3d-3 adds the label: the door «Make a label» in the folded body of a COMPLETE
`AllergenCard` (it navigates, with `FROM_RECIPE`, to `/recipes/<id>/label`, one level below the recipe: Back is the browser's
Back, and a label opened by its address replaces itself with the recipe), `LabelScreen` (the switch, the four refusals, the
paper preview with its notes, `LabelCard` — the label as words —, the language note, the caveat, Print · Copy · Send; the switch
is kept for the section in `labelShows.tsx`), `LabelSheet` (the paper, drawn from the shared `sheetModel`; ⚠️ its markup is
compared byte for byte with the current app's `buildSheet()` for the whole label corpus, and its classes are plain global ones
in `label-print.css`, which is not a CSS module and sets the sheet in Manrope, the current app's face, so the fit and the paper are
the same in both apps) and `useSheetFit` (the DOM half of the measurement over the shared `fitFont` / `fitWidthFactor`: an
unmeasured sheet never fits, it is measured again on resize and when the typeface arrives). Printing through the system's dialog
is a host built at print time in `document.body` with its own React root (`printHost.tsx`: `#labelPrint` + the `lab-printing` class on `<html>` that scopes the print rule — never `:has`, the lab tablet's Chrome 101 lacks it; removed only after `afterprint` AND the next pointer or key, because Android fires `afterprint` before its print screen has laid the page out); the zebra (ZPL), the shop computer's
queue and the other roads arrive in 3d-4. The usage record names the screen `recipes-label` and the action `label-printed`. Every allergen verdict is the shared model's; `label-separation.spec.ts` (in `app/src`)
  pins that a screen that prints a food word asks the venue's country and never the interface language. `ui/RecipeFullScreen` and `ui/zoomStorage` are shared with the Calculator
  and take a storage key (`mise.calcZoomStep` / `mise.catZoomStep`).
  Step 3d-5 adds the label Settings (`LabelSettings`, `SegmentedChoice`, `/recipes/settings`, drawn like the Allergen sheet: the right-hand pane on the split, its own screen on a phone, one level below the list, Back hands the focus to its door `SETTINGS_OPENER`). The door «Settings» (Lucide `Settings`) stands at the foot of the list after the Allergen sheet's, ONLY for `canManage`; an employee who types the address is sent to the list by `RecipesSection`. Two cards (the paper and printer; what else goes on the label) save ON THE TAP, no Save button, through the store's `saveLabelProfile` and the source's `saveLabelConfig` (a merge write of `config/labels`, stamped with the venue). ⚠️ The store changes first (its copy and the current app's `catalogue-label-config` copy, announced at once) and then asks the source; the writes are NOT chained behind each other, though the current app chains them: Firestore commits one client's writes in the order they were made and keeps unsent ones in its own persistent queue across an offline reload, while a chain would hold the later changes in memory where such a reload loses them. A refused write puts back only the keys of its own patch (the values just before it), never a key a later patch set since, and rejects so the screen can say «Could not save — the change has been put back». The screen draws from `normalizeLabelProfile(labelConfig)`, so it and the label screen always agree; a text box and the two millimetre boxes keep their own typing while focused, save when left (trimmed, only if different; the size as ONE write 350 ms after focus left BOTH boxes, stopped by focus or typing in either, written at once when the page is hidden; a value that is empty or outside 20–300 mm is never sent: the saved size comes back and `label.settings.sizeRange` says why), hold `markBusy` while they differ, and are written at once if the screen goes first (the store outlives it). `ui/SettingSwitch` moved here from the Calculator for it. Step 3d-6 slice A1 writes recipes: a «New recipe» button beside (split) or under (phone) the search box, «Edit» on a recipe's bar and a delete (a low-key button in the editor, a small icon after Export on the page, `canManage` only) at `/recipes/new` and `/recipes/<id>/edit` (usage screen `recipes-editor`). `RecipeEditorScreen` waits for the recipe (the server's word, or `COPY_WAIT_MS`) and keys `RecipeEditor` on the id, which copies the recipe ONCE into the working copy of `editorModel.ts` (rows spread so links and row ids survive; the two label boxes untouched = the stored value passes through), checks with `findInvalidRecipe` (the first wrong box is marked, focused and said), asks before Save, saves local-first through `store.saveRecipe`, and leaves for the list; one `useBlocker`, `markBusy` while dirty. `useDeleteRecipe` is the ONE delete (Calculator warning raced against 2.5 s, «Recipe deleted.» said once): it marks the id in `recipeDeletions.ts` so `RecipeScreen`, which says the same sentence when a recipe vanishes, stays quiet for a delete made here. Slice A2 links a row: `LinkSuggest.tsx` (a hook: the combobox attributes for the name box and the in-flow listbox under the row, over `suggestLinks`), the link line in `IngredientRow` (text from `linkModel.ts`, no price) and `LinkDialog.tsx` (the chooser over `linkOptions`: chosen / `null` removed / closed = nothing changes); `editorModel.linkRowTo` is the ONE write of a link (applyLink on a COPY of the row), then the focus goes to that row's amount box after the render (a `requestAnimationFrame`, so it lands after the dialog has given the focus back); the name box is now a `combobox`, not a `textbox`, for tests. Slice B reorders the rows as a MODE (`Reorder` / `Done` in the ingredients head, two or more rows): `ReorderRows.tsx` draws a React Aria `GridList` of grip, name and amount, and `editorModel.moveWorkingRow` / `stepWorkingRow` / `dropWorkingRow` (over the shared `moveRow`) move the very same `EditRow` objects, so a row keeps its link and its `rid`; the arrow keys on a grip are caught in the capture phase above the list, because a grid row swallows them first. Step 3d-7 slice A links the recipe to the other sections. Import goes through the SOURCE's transaction (`importIntoCalculator`: `config/calculator` read again inside it, the recipe merged into what the server holds now, `configRev` + 1, `configModel` and the venue stamped after the spread; not local-first, so offline it rejects and the screen says so; the store counts the recipe as used on success only). The recipe page now reads: ingredients · batch · a Food cost card · allergens · declaration · Export · Import into Calculator with its hint (it LINKS the Calculator to the recipe, 18 Oct 2026, and refuses a recipe with a row the Calculator cannot follow: not by weight, or with no amount) · Duplicate with its hint (`canManage`; opens the new-recipe editor filled in from the recipe, handed over like a photo read, 18 Oct 2026) · the owner's Delete icon. The Food cost card is a DOOR, drawn only when `mayOpenFoodCost(location, canManage)` of `shared/recipe-link` says yes (the question Food cost's own gate asks; `recipes/foodcostDoor.spec.ts` pins that it agrees with `visibleSectionIds`), and its button opens `/food-cost?recipe=<id>` with the state `FROM_RECIPE_LINK`; Import is a WRITE, so it is judged by the venue's Calculator section alone: its `markBusy` is held until the store's promise settles, even if the screen is left meanwhile. Back from Food cost brings the recipe back with the focus on that button and the scroll where it was, through the same `recipeReturn.ts` as the label and the editor (origin `cost`); because Food cost is another section the place is also kept in a module variable (`carryPlace`) and taken only by a recipes screen that appears by a POP. Step 3d-8 slice A writes the mixing procedure: `ProcedureCard` (after the declaration card, before Export: «Write the mixing steps» with its hint when there are none, otherwise the step count and timers, the «not in any step» warning and «Edit the steps»; a comment at the top of that state marks where slice B puts Resume / Guided mixing / Start again) and the steps editor at `/recipes/<id>/steps` (usage screen `recipes-steps`, one level below the recipe, drawn in the right-hand pane on the split). `StepsEditorScreen` waits for the recipe exactly as `RecipeEditorScreen` does, around `StepsEditor`, which copies ONCE (`stepsEditorModel.ts`: the rows with ids minted into the copy, the steps, the closing message) and hands `store.saveProcedure` the typed values; Back and Save return to the recipe through `useLeave` with `cameFromRecipe` (no second recipe entry), and `recipeReturn` has a fourth origin, `steps`, so the recipe comes back with the focus on the card's button and the scroll where it was. Anyone who sees the section may write steps. ⚠️ `cat.notInAnyStep` is the card's «Not in any step: {list}»; the current dictionary defines the key twice and the later, list-less run-end text wins there, so the run's finish card uses its own key, `cat.notInAnyStepCheck`. Step 3d-8 slice B runs the mix at `/recipes/<id>/mix` (usage screen `recipes-run`; one level below the recipe like the steps editor: Back returns to the recipe with no second entry for it and the focus on the card's first mix button, `recipeReturn` origin `mix`). ⚠️ THE RUN IS FULL WIDTH AT EVERY WIDTH: `RecipesSection` marks the layout `data-view="run"` and the stylesheet hides the list and gives the right-hand side the whole row, so there is no list beside a mix. ⚠️ THE SAVED SESSION IS THE CURRENT APP'S, key and shape (`guidedSession.ts`: `catalogue-guided-run` = `{ recipeId, snapshot: { name, ingredients, steps, endNote, targetGrams }, stepIndex, endsAt, startedAt }`), so a mix started in one app is resumable in the other; every storage access is in a try/catch and `resumableSession` demands `isResumable` AND the recipe still held. ⚠️ A MIX STARTS RELOAD-SAFE: the card's «Guided mixing» / «Start again» WRITES a fresh session (a snapshot of the recipe as shown, with the batch the page is scaled to, 0 when none) and then navigates; «Resume — step N of M» checks `resumableSession` at the tap (stale: cleared, `cat.thatMixIsNo`, the card redraws). `GuidedRunScreen` always runs from the STORED session: with none for this recipe (an address typed) it replaces itself with the recipe; with a stale one it clears it, says so and leaves; a recipe it cannot find waits for the server (or `COPY_WAIT_MS`) before calling the mix stale, because the phone's copy can be partial. `GuidedRun` is the run against the FROZEN snapshot; `guidedRunModel.ts` is its pure state (timers are the instant they END, nothing counts seconds; the 250 ms interval only repaints and `visibilitychange` repaints at once; a change of speed is marked against the step just left and nothing is announced for the first step of a resumed mix); the shared model does the rows, amounts, clock words and resume rule. Two quiet always-mounted live regions say a speed change and «Time is up» once; the countdown is never a live region. Leaving asks (the router's blocker, Leave / Cancel) and KEEPS the session; finishing clears it and leaves without asking; `markBusy` and the wake lock are held while the mix is open and not finished. `guidedAlarm.ts` is a port of `guided-alarm.js` (`alarm.wav` imported with `?url` — a real file, never a `data:` URI —, unlocked muted at the tap that starts a timer, rung once per timer, 60 s at most, vibration repeated every 2 s, `isRinging()` for the drivers) and `ui/wakeLock.ts` of `js/wake-lock.js` (counted by owner, asked for again when the page turns visible). `ResumeOffer` asks «Carry on mixing?» at most once per app opening when the list is on screen (a module flag, set when the question is ANSWERED so StrictMode's abandoned first run cannot swallow it; «Not now» keeps the session; «Carry on» pushes the recipe and then the run, so Back is the recipe and then the list). There is NO phone notification in Mise 2 yet (parity item 99): the line under the controls is the honest one. Step 3d-9 reads a recipe from photographs (`photoSource.ts`, the two Cloud Functions behind `useDataServices().photo(locationId)`; `shared/photo-model` and `shared/catalogue-photo-model` for the sizes and the sentences). Three pieces. THE SWITCH is the first card of the label Settings (`PhotoCard` in `LabelSettings.tsx`): it shows only a literal `recipePhoto === true` from the session (`photoGate.ts`), asks with the cost sentence, calls `setRecipePhoto`, then `sessionStore.refreshLocation()`, holds the new value until the session shows it, and holds `markBusy` for the call even if Settings is left. «FILL THIS IN FROM A PHOTO» is the last thing in the NEW-recipe editor only (a venue with the reader on); the typed copy travels in the navigation state of the editor's own history entry and is taken off once read. THE PHOTO SCREEN is `/recipes/photo` (`PHOTO_PATH`, usage screen `recipes-photo`, drawn like the editor in the right-hand pane; `RecipesSection` sends a venue without the reader to the list): `PhotoScreen.tsx` (up to 5 photographs, a real file input inside a button-looking label, offline → a sentence and no call, `markBusy` held until the call settles even if the screen is left) over `photoImage.ts` (the DOM half: `createImageBitmap` with the EXIF flag, a canvas, JPEG 0.82 then 0.7). ⚠️ A READ SAVES NOTHING: the answer becomes the working copy of the new-recipe editor (`editorModel.workingFromDraft`) and the editor starts DIRTY. `photoCarry.ts` holds what travels: the typed copy (`withTypedCopy` / `typedCopyOf`, re-keyed by `restoreWorking` because a history entry can survive a reload) and the read draft (`handOver` / `peekHandover` / `forgetHandover`: a history move cannot carry a state, so the photo screen steps back onto the editor's entry and the draft is handed over in a module variable that the editor looks at while drawing and takes off in an effect — StrictMode safe). The history ends with ONE editor entry holding the draft. Details and the differences from the current app: `docs/parity/catalogue.md`, «3d-9 as built».
  Labels step 1a part 2 adds the «with logo» IMAGE label (the owner's Zebra script, 80 × 60 mm at 203 dpi, ported in the shared `label-image-*.ts`, `label-text-check.ts` and `zpl-z64.ts`). The model is two keys of `config/labels` read by `imageLabelData.ts` (`template` 'standard' | 'logo', anything else = standard; `rotate180`, ^POI unless stored false), NOT by `normalizeLabelProfile`, which stays the current app's. The recipe carries `labelName` and `labelIngredientsText`: the store normalises with the shared `normalizeCatalogueRecipe` and puts the two back (`labelTexts.ts`), a save sends them only when the editor handed them over, an emptied box is a removal (`CLEARABLE_RECIPE_FIELDS`). The logo is `label-assets/logo` (`recipesSource.watchLabelLogo` / `saveLabelLogo`, written whole / `removeLabelLogo`), watched only by the screen that shows it (`useLabelLogo.ts`) and never stored by the store; `logoUpload.prepareLogo` turns any picture into the script's logo (grey, autocontrast, ink box, 1320 wide, PNG data address). `LabelScreen` draws `ImageLabelBody.tsx` for the logo model: refusals (allergens off, no country, allergens not fully declared — the standard label's own gate —, no text, no logo, a layout that is too long, too wide or holds a character the fonts lack — never shrunk, never cut), the preview canvas that IS the printer's 640 × 480 dots (`labelCanvas.ts`, the three label typefaces loaded by `labelFonts.ts` on this screen only, the width table fetched by dynamic import), the Italian text check (errors stop Copy and Print, warnings do not; every allergen AND every trace the recipe holds must be named in capitals), copies, «Copy the printer code (ZPL)» (Z64 through `CompressionStream`, `labelDeflate.ts`; refused over `MAX_JOB_CHARS`) and Print through the same print host with an image (`openImagePrintHost`, its own page file `label-page-image.css`: 80 × 60 mm for every browser, because Chrome 101 ignores named pages). `LabelSettings` gains «Which label to print» (model + «Print turned round»), and for the logo model the Header and Logo cards in place of the paper and «what else» cards; `RecipeEditor` gains «Label with logo» (the two texts) for that model only. Driven against the script's own bitmaps on the fake corpus: every word in the same place, 0.06–0.2 % of the dots different on the glyph edges (0.75 % on the densest label), the bold fix of defect (a) on purpose.

  Image labels step 2 adds the HACCP label (`shared/haccp-label.ts`, docs/parity/catalogue.md «Image labels 2»), drawn by the SAME engine: `labelCanvas.drawElements` / `renderLayoutBitmap` take the canvas size, the «with logo» functions are thin wrappers over them. Settings gain the card `HaccpSettingsCard.tsx` (size menu, list filter, eleven three-way rows; every tap writes the whole `haccpFields` map), the recipe editor a «Storage (HACCP label)» box (only when that field is printed), and the recipe list a door for everybody to `/recipes/haccp` (`HaccpList.tsx`, drawn like the Allergen sheet; archived recipes and, when chosen, other categories left out) and `/recipes/<id>/haccp` (`HaccpLabelScreen.tsx` + `HaccpLabelBody.tsx`: the boxes of this print, the preview of the very dots, the refusals, one Print button through `openHaccpPrintHost`). The print page of each of the five sizes is a static file `label-page-haccp-<size>.css` linked and switched by `printHost.tsx` exactly like the image label's (the page CSP forbids CSS built at run time); the roster's first name for «prepared by» is read once through `store.readMember`.
  Slice «recipe categories + archive» (`docs/parity/catalogue.md`, last section) lays the list out with `shared/recipe-shelf`'s `shelveRecipes`: after the search and the usage order, one heading (`h2`) and one `<ul>` per category in the interface language's alphabetical order, «No category» last and headed only when another group is shown (no category in use = the list as it always was), and the archived recipes in a `ui/FoldedGroup` «Archived (N)» before the two doors, for everybody (open state `useFoldedOpen`, opened by a matching search or by an open archived recipe; `handBack.ts` opens a closed fold before it focuses a row). `FoldedGroup` moved here from `suppliers/` (it was `NotInUseGroup`; the caller draws the title). The editor's «Category» menu is drawn only when the venue has a category, and ⚠️ the category reaches `saveRecipe` only when the choice MOVED (`Working.category` against `categoryStart`; the stored word is kept out of `rest`), so an unrelated save never strips a word that left the list; `RecipeEditorScreen` waits for the label profile (it holds the list) before it makes the copy of an existing recipe. The Catalogue Settings' card «Recipe categories» (`RecipeCategoriesCard` in `LabelSettings.tsx`, after the photo card) adds and deletes the words through `store.saveRecipeCategories`, a refusal said in the page's status line. Archive and Restore live on the recipe page (`RecipeView.tsx`): «Archive» (owner and manager, after «Duplicate», before the Delete icon, with its hint) asks, then `store.setArchived` writes the flag alone and the page STAYS open with a calm neutral banner at its top (the focus goes to the banner's «Restore»); «Restore» asks nothing and puts the focus on the title; an employee sees the banner without the button, and «Import into Calculator» is hidden on an archived recipe (it makes a NEW link). ⚠️ The rule for the pickers is «offered = `withoutArchived`, named = the full list»: the editor's `LinkSuggest`/`LinkDialog` (the row's link line and «Remove the link» still read the full list), the Calculator's `CataloguePicker` and Food cost's `PickDialog` and `NameSuggest` leave archived recipes out, while a tab, a line or a sub-recipe row already pointing at one keeps naming and costing it by id.
- `ui/` — the shared controls: `Button`, `Dialog` and `useConfirm` (a question that waits for an
  answer; never the browser's `confirm()`), `StatusMessage` (one short message at a time, in a
  live region that exists before it speaks), `FormBar` (Back, title, the one primary action: the
  top of an editor), `SettingSwitch` (an on/off switch, shared by the Calculator's and the Recipe catalogue's Settings), `FormDialog` (a whole form in a modal above the screen that opened it; no Escape, the form asks `Discard changes?` itself), `useMediaQuery` (only for attributes that must agree with a stylesheet's
  media query; layout is always CSS).
  The recipe export (PDF / Excel) is two files here: `recipeExport.ts` (`buildPdfBlob`, `buildXlsxBlob`, the
  impure half of `js/recipe-export.js`; the pure half is `@mise/shared/recipe-export`) and `ExportSheet.tsx`
  (`useExportSheet()`, the dialog: choose, preparing, «File ready» with a real Download link, Share for the PDF
  only, the errors). The Calculator's `ResultCard` and the Recipe catalogue's `IngredientsCard` each build their
  model from the very rows they draw (`recipes/recipeExportModel.ts` for the catalogue). ⚠️ `jspdf` and
  `write-excel-file` are npm dependencies loaded ONLY by `import()` inside the two builders, so each is a chunk of
  its own that no page preloads; `recipeExport.spec.ts` fails on a static import anywhere in `app/src`. ⚠️ There is
  no service worker yet (step 5), so the FIRST export needs a connection (offline it says so); the service worker
  will have to precache those two chunks. ⚠️ jsPDF's optional dependencies (html2canvas, canvg, dompurify) are
  installed and Vite emits them as chunks (~380 KB) that are never loaded: step 5's service worker must precache
  the jsPDF and write-excel-file chunks BY NAME, never by a glob that would make every phone download those three. ⚠️ Excel is always a download: Chrome's Web Share has no Office types, so
  Share is offered for the PDF only, and only when `navigator.canShare` accepts the real file. A failure is
  reported with fixed words only (`Recipe export failed:`, the file kind, `library` or `build`), never the recipe.
- `suppliers/` — Ingredients & suppliers (section id `suppliers`, step 3e, built in slices; its parity list is
  `docs/parity/suppliers.md`). Slice A looks (the three lists and a supplier's own screen), slice B writes suppliers and adds
  Settings; 3e-2 onwards is the ingredient card, the pack photo, the invoice import. The invoice import is built end to end: the door, step 1 (the file), step 2 (the suppliers), step 3 (the ingredients: `IngredientsStep`, `ingredientsRun.ts`) and the summary (`SummaryStep`). The data layer: `suppliersSource.ts` (the
  Firestore half: suppliers, ingredients, prices, `config/orders`, and the one Cloud Function `setIngredientPanels`), `suppliersStore.ts`
  (plain TypeScript, local-first writes, `SuppliersMessage` kinds that `suppliersMessages.ts` words), `SuppliersContext.tsx`
  (started on mount, stopped on unmount, P14). Addresses, in `suppliersPath.ts`: `/suppliers` (Ingredients tab), `/suppliers/suppliers`,
  `/suppliers/packaging`, `/suppliers/supplier/<id>`, `/suppliers/supplier/<id>/edit`, `/suppliers/supplier/new` (`new` is never an id) and
  `/suppliers/settings`; the usage record names `suppliers`, `suppliers-supplier`, `suppliers-supplier-edit` and `suppliers-settings`.
  The frame (`SuppliersSection.tsx`) is the recipes' shape: the list on the left, one level down on the right from 1000px, the
  section owns the scroll, `handBack.ts` gives the focus back to the button or row that opened a screen (`NEW_OPENER`,
  `SETTINGS_OPENER`, a supplier's row, and `wantEdit`/`takeEdit` for «Edit» after the card). ⚠️ SETTINGS ARE FULL WIDTH AT EVERY
  WIDTH: the layout is marked `data-view="wide"` and the stylesheet hides the list; an employee who types the address is replaced by the
  list. `SupplierCardScreen` waits for the server (or `COPY_WAIT_MS`, `copyWait.ts`) and keys `SupplierCard` on the id, which copies the
  supplier ONCE (`supplierModel.ts`: the working copy and the exact payload of parity S82 — `shortName` as `''` when blank, weekdays as
  English keys in week order, `active` kept, `vatNumber` through `normalizeVat`), checks the one rule (a name), asks before Save, saves
  local-first through `store.saveSupplier` and leaves one level up without asking: a new supplier to the list, an existing one to the
  supplier's screen. One `useBlocker`, `markBusy` while dirty. `SupplierScreen` has «Edit», «Switch off» / «Switch on» (everybody; off
  asks) and, for `canManage`, the Delete icon through `useDeleteSupplier`, which asks (with the products sentence of decision F2),
  marks the id in `supplierDeletions.ts` so the screen's own «no longer exists» stays quiet, and says «Supplier deleted.» once.
  `SuppliersSettings` has the two panel switches (allergens asks before OFF; the Cloud Function is called through the store, then
  `sessionStore.refreshLocation()`, and the new value is held until the session shows it) and the categories card (every bin disabled
  until `configLoaded`). `copyWait.ts`, `handBack.ts`, `suppliersNav.ts` and `supplierDeletions.ts` are copies of the recipes'/Food cost's
  files: a feature never imports from another feature's folder.
  Step 3e-2 adds the ingredient card's PRODUCT DATA (no price, allergen or nutrition yet: those keys are never sent, so a merge
  leaves them as stored). Addresses, in `suppliersPath.ts`: `/suppliers/ingredient/<id>`, `/suppliers/ingredient/new`,
  `?kind=packaging` for a new packaging item and `?supplier=<id>` to start a NEW item on a supplier (never an existing one);
  `new` is never an id; the usage record names both `suppliers-ingredient`. Every ingredient and packaging row is a button
  (`ItemRow`), «New ingredient» / «New packaging» / «New supplier» stand under the search box by tab, and a supplier's screen has
  «Add ingredient» and rows that open the card. The list shown beside a card is the tab it was opened from (`fromListTab` in the
  navigation state), the Suppliers tab when opened from a supplier's screen (`fromSupplierScreen`), else the tab of its kind; Back
  is one level up and `handBack.ts` owes the focus to the row, to «New …», or (`wantOn`/`takeOn`) to the row or «Add ingredient» on
  the supplier's screen. `IngredientCardScreen` is the wrapper: it copies the item ONCE after the ingredients AND suppliers came from
  the server (or `COPY_WAIT_MS`, or offline), says «This ingredient no longer exists.» unless this phone deleted it
  (`ingredientDeletions.ts`), saves local-first with `unitChangedFrom`, and `useDeleteIngredient` counts what uses the item (the
  store's `ingredientUsage`), asks with the three sentences of decision F5 and deletes with the price document only for
  `canManage` AND the Food cost section on. «+ New supplier…» draws the supplier card (`SupplierCard` with a `host`) in a
  `ui/FormDialog` above the ingredient card.
- `records/` — cards shared by the sections that open the same record (step 3e-2 starts it with the ingredient card; the Recipe
  catalogue opens it later). `IngredientCard.tsx` is driven only by props and imports NOTHING from `suppliers/` (the supplier card in
  its dialog comes in as `renderNewSupplier`); `ingredientCardModel.ts` is its pure half (the working copy, the dirty rule, the
  refusal order, the exact payload and `unitChangedFrom`), pinned by its spec.
  Step 3e-4 adds the card's three folding sections — the pack's own ingredient list, the allergens, the nutrition (parity C98–C116) —
  as `AllergenSections.tsx`, drawn only for an ingredient, never for packaging. It is a LABEL FILE (on `LABEL_FILES` in
  `label-separation.spec.ts`): it reads the venue from the session itself, `const lang = outputLanguage(location)` once, so the allergen
  names, the group headings and the nutrient names follow the venue's COUNTRY while «has», «traces» and «I have checked…» follow `t()`.
  The two panels are read LIVE from the session (`allergensOn` / `nutritionOn`); a hidden panel is not drawn and its part of the working
  copy never changes, so nothing of it is written. All the rules are in `allergenCardModel.ts` (read its header): the working copy is
  made once at open, and a save writes the declaration (`allergens` + `mayContain` + `allergensCheckedAt`, always together), the pack
  text and the nutrition ONLY when that group differs from the item as opened — never all five keys on every save as the current app
  does — and a new ingredient writes all five. The pack text proposes after a 450 ms pause or at once on leaving the box, never on the
  first draw. The folds open closed on every open. Mise 2 has no «?» sheet yet, so ONE safety sentence («This only ticks boxes…») is
  drawn inline under the pack box; the other help text waits for the shared «?».
  Step 3e-5b adds «Not in use at the moment»: a switch at the end of the card (existing items only) on the working copy's
  `notInUse`, written as `active` by `activePatch` only when it moved. The lists of `suppliers/` put switched-off items last in the
  folded `ui/FoldedGroup` (`<details>`, once `NotInUseGroup`); `suppliers/handBack.ts` opens a closed group before it focuses one of its rows and carries the
  focus to a row redrawn in the same commit. The recipe link and Food cost's chooser offer them last (`inactiveLast`), never hidden.
  Details and the difference from the current app (which hides them): `docs/parity/suppliers.md`, «Step 3e-5b as built».
  Step 3e-7 adds «Price changes» and «Merge another pack…». `priceChanges/priceChangesSource.ts` reads `price-changes` read-only, the
  server first and the cache only as a flagged fallback (never a false «no changes»), its server read bounded; `PriceChangesScreen` is
  full width at `/suppliers/price-changes`, behind the import's gate (`useMayImport`), its weeks cut at the store's `weekStartsOn`.
  `merge/mergeSource.ts` (lazy through `lazyMergeSource.ts`) is the network-only port of `ingredient-merge-data.js`: server reads after
  `waitForPendingWrites`, refused offline, every call bounded, the usage checked again before the first write, B deleted last, a
  `MergeError` with `code` and `committed` (the honest words). `merge/MergeScreen` is one level below A's card
  (`/suppliers/ingredient/<id>/merge`), reached from the card's `onMerge` door (price writers, an existing ingredient, refused with
  unsaved edits); while it writes it holds `markBusy` and a router blocker, and a finished merge steps back onto A's card with the
  focus on its door (`MERGE_OPENER` in `handBack.ts`). Details and the differences: `docs/parity/suppliers.md`,
  «Step 3e-7 as built».
  The import log (Mise 2 only): `invoiceImport/importLog.ts` is its pure half (records, the summary and the missing months, the
  verdict «A new, B already imported», and the record a run may write — an invoice only when every row holding a price of it was seen
  through); `importSource.ts` reads `invoice-imports` from the server and writes one record per run, create-only. The reader sets the
  already-imported invoices aside before anything is built (`readInvoiceFiles(…, alreadyImported)` → the Mise-2-only option of
  `shared/invoice-zip/build-import`). The «From invoice» tag of the lists is `suppliers/invoiceTag.ts`, derived from the keys only the
  import writes (no field, no read). Details: `docs/parity/suppliers.md`, «Import log … as built».
  ⚠️ **The one exception to «a feature never imports another feature's folder»** (T15, «+ Add "…" as an ingredient»): `recipes/` may
  import `../suppliers/CreateIngredientOverlay` and NOTHING else from `suppliers/` (`RecipesSection.createIngredient.spec.tsx`
  fails on any other). The overlay draws `records/IngredientCard` hosted (`host`: no router blocker of its own, its Back handed
  to the editor through a ref) in a `FormDialog` (`phoneFull`: a card from 700px, the whole screen below). It saves through
  the **write-only Suppliers store** (`SuppliersWritesProvider`: created, never started, so it opens no listener and reads no
  price — the Catalogue loads no money); `CreateIngredientProvider` sits inside the Catalogue's `StatusMessageProvider` and
  says the store's refusals there. The ingredients and suppliers the card needs are handed in by the editor from the
  Catalogue's own store.
- `orders/` — «Orders» (section id `orders`, step 3f, built in slices; its parity list is `docs/parity/orders.md`). Slice 3f-1 is
  the supplier list and the shared order in progress. The data layer: `ordersSource.ts` (the Firestore half: four listeners —
  suppliers, ingredients WITHOUT prices, `config/orders`, `drafts/current` — and one write, a merge of the changed lines and days),
  `draftSync.ts` (the port of `js/orders/draft.js`: only the keys this phone changed are sent — quantity, unit and «this time» supplier always together — its unsent typing is laid over every
  snapshot, 800 ms pause, `flush()`), `ordersStore.ts` (plain TypeScript: `editLine` stamps the day the lines are FOR — never for a
  stock-only edit — and settles whose order a line is in; `stop()` sends a change still waiting at once), `ordersLens.ts` (pure: the
  ONE place that decides which supplier a line sits under; «Not in use» lines LAST, decision F6), `OrdersContext.tsx` (started on
  mount, stopped on unmount, P14). No localStorage copy of `config/orders` (T14). Addresses, in `ordersPath.ts`: `/orders`,
  `/orders/supplier/<id>` (`no-supplier` is a valid id) and `/orders/supplier/<id>/items`; the usage record names `orders`,
  `orders-supplier` and `orders-supplier-items`. The frame (`OrdersSection.tsx`) is the suppliers' shape: the list on the left, the
  supplier beside it from 1000px, the section owns the scroll, `handBack.ts` gives the focus back to the row, the list icon or the
  «What they sell» button that opened a screen. `OrderLine` + `NumberBox`: ⚠️ A BOX THAT HAS THE FOCUS IS NEVER OVERWRITTEN by a
  snapshot from another phone; the steppers and the × write through the box's handle. Nothing in 3f-1 is role-gated (L2). Slice 3f-2's SCREENS sit on the data layer above: `DayLine` (the «Order:» select under a supplier's bar, `dayChoices` for a supplier with order days, the new `weekChoices` for one without; the store's `setDay`), «Order placed…» / «Clear quantities…» after the rows, and the addresses `/orders/supplier/<id>/confirm`, `/orders/place-all`, `/orders/place-all/confirm` (the ticked ids travel in the navigation state; opened without them it replaces itself with the picker) and `/orders/clear` (usage screens `orders-confirm`, `orders-place-all`, `orders-place-all-confirm`, `orders-clear`). `PlaceConfirmScreen` is ONE component for one supplier and for several: it reads the day's records, refuses a unit clash BEFORE it opens (`unitConflictText.ts`), takes the working copy ONCE (`confirmCopy.ts`, never re-read from the live order), asks «Did you send the order?» (Cancel keeps the screen and the corrections) and only a Yes calls `store.place`; a supplier already recorded leaves the screen, so a later failure never records it twice. `useBlocker` covers every way out while a number was corrected. A recorded order goes back to the LIST, however far it is (`confirmState` writes `toList` into the state, `useLeaveToList` walks the history back that far). `SupplierPicker` is the tick list of both pickers; `useClearQuantities` is the one clear flow. The section wraps itself in `StatusMessageProvider` (`say(text, ms)` takes a longer time for a sentence that names what was not saved). Slice 3f-2b adds a FIFTH listener, the live window of `orders-history` (`date >=` two calendar months back, the current app's `watchRecentHistory`), and `suggester.ts`: the store keeps ONE engine per snapshot of the records and the cards in its snapshot (`suggester`), asked by the row's line («Suggested: N» / «Much more than usual (about N)», never both), by the Stock box (`fillFor`: it fills the Order box only when that is empty or still holds the previous reading's suggestion — decision 1 of 3f-2b; done inside `editLine`, never on a row ordered elsewhere) and by the confirm screen (`usualFor`, with the unit the row shows). Slice 3f-3 adds the send screens: the arrow in the list's head opens `/orders/send` (usage screen `orders-send`; `SendScreen`: nothing ticked at first, «By supplier» / «One list», `draftSendRows`), `useSendOrder` is the ONE send flow (the send screen's «Send» and the confirm screen's «Send it now»): it offers the roads (`sendOffers`, the in-app manager road filtered out until 3f-7), takes a single road in the same tick as the press and otherwise draws `RoadChooser` on the shared `Dialog`, whose road button calls `takeRoad` in its own press; `SendDialogs` holds the photo-or-text and one-picture dialogs, `useSentCheck` the three-answer «Did you send it?» (Yes / Send it now / Cancel). A send that reached suppliers opens the confirm screen with `afterSend` in the state («Order sent» / «Mark as placed», Back goes to the list). Slice 3f-4 adds Settings and History: a gear in the list's head opens `/orders/settings` (usage screen `orders-settings`; for now one door, «Past orders», until 3f-8), whose door opens `/orders/history` (`orders-history`), and from History `/orders/history/day/<date>` (`orders-history-day`, sending a whole day again) and `/orders/history/<recordId>` (`orders-history-edit`; `day` is never a record id); each is drawn in the detail pane, one level below the one before, and Back goes ONE level up. `HistoryScreen` merges the live window with the older pages (`mergeHistory`), groups the days, parks the days beyond `historyDays` behind «Show older orders» (`showingOlder` lives while the screen does and is put back when `historyDays` changes) and loads older pages on demand with the focus kept on the button; `HistoryCard` is the collapsible card (legacy weekly records are grouped by each line's current supplier). History stays MOUNTED, hidden, under the editor and the day screen, so its open cards and older days survive, and the section writes down its scroll place (`historyPlace`) when one opens and restores it on Back. «Send again» calls `useSendOrder.send` with `recordSendRows` and `resend: true` straight from the press (the same road chooser as the send arrow, no same-day unit check, nothing recorded); `SendPicker` is the picking body (ticks, format, the Send button, the pending guard) shared by `SendScreen` and `DaySendScreen`, which differ only in what follows a send that reached somebody. `HistoryEditScreen` edits a COPY taken once as `opened` (`historyEdit.ts editRows`) and writes through the store's guarded `correctRecord` / `deleteRecord`, answering `saved`, `changed`, `gone`, `empty`, `offline` and `failed`; `markBusy` and `useBlocker` hold the screen while a number differs from the copy or a write is in the air, and a result arriving after the screen went moves nobody.
- `settings/` — the Settings page (today: the Account card).
- `styles/` — `tokens.css` (every colour, size, radius, shadow) and `base.css`.
- `testing/` — `renderApp`, the fake session store and other spec helpers.

## `shared/src`

Pure logic only, no DOM types. Each module is a PORT of a `js/` file, and its spec runs every test
against BOTH files (`describe.each` over the TypeScript port and the `js/` original), so the two
apps cannot drift apart while both are live. `parity.spec.ts` compares the full ports export by
export (names, constants, frozen-ness, function names and arity); a partial port (`membership`,
`location-id`, `pastries-model`, `recipe-allergen-model`, `price-model`, `inventory-value`, `catalogue-model`, `recipe-link`, `recipe-cost-model`, `foodcost-model`) is not paired and its spec says why, and
compares what it does port with the `js/` file itself. `currency` is an ADAPTED port, also not paired:
the original keeps the venue's money in a module variable (`setCurrency`), and Mise 2 never keeps a
venue fact in a module variable, so the port is stateless (`moneyOf(symbol, layout)` returns the
`Money` that the formatting functions are handed, as `formatMoney` and `formatRate` of `price-model`
are); its spec runs each case against the `js/` module after `setCurrency` and against the port with
`moneyOf`, and demands the same text. `odd-inputs.spec.ts` feeds every export odd inputs and compares
the two. A quirk of the original that no real input can reach is
copied, not tidied, and marked where it sits: fixing it is a bug fix to BOTH files at once, and
`odd-inputs.spec.ts` fails until they agree. Today: join-code, push-model, home-cards, away-model,
allergen-model, sections, firebase-target, local-data, same-data, error-model, device-model,
usage-model, venue-features, market, recipe-label-model, membership, location-id, pastries-model, pastries-log-model, pastries-lock, pack-size,
order-unit, ingredient-name, order-cost, inventory-model, inventory-outbox, inventory-purchases,
vat-rates, ingredient-kind, product-limits, vat-guide, foodcost-weighing, photo-model (full, paired: the sizes of a photograph and `errorKey` / `answerKey`, which return message KEYS from a table the feature hands in),
catalogue-photo-model (the Catalogue's table of those keys and its two lookups `photoErrorKey` / `noRecipeKey`; not paired, it also exports the table),
calculator-dough-math, calculator-recipe-source, calculator-order-text, calculator-order-prefill (adapted: `prefillNote` takes the translate function as an argument, so it is not paired), client-order-model (adapted: `orderRows` takes the deleted-product word as an argument, so it is not paired), client-order-history (adapted: `linesLabel` and `emptyWords` take the translate function as an argument, so it is not paired), calculator-recipe-text (one documented difference: the line
`Flour uniqua blue`, one venue's data, is written like every other), confirm-flow, log-time,
calculator-config (partial: the read side; leaves out the save path `reconcileConfigWrite` / `saveFailureKey` and
`orderPrefillLabel`; `formatGrams` and `normalizeConfig` take the language as an argument), log-model (partial: the
write half, `workDayIndex` and `typedTotalOf`; leaves out the list and edit half, the legacy migration and `dayLabel`;
`buildLogText` takes its two words as an argument), guided-model (the whole model; `stepRows`, `overdueText` and `progressText` take their word / the translator as an argument), zoom-steps (partial: the
arithmetic; leaves out the storage and DOM halves), calculator-tab-keys (new in Mise 2, no original: the
`localStorage` keys of a Calculator tab and the stale-tab and lock decisions, pinned against the current app's
source),
recipe-allergen-model (partial: everything but `incompleteText`, which uses the dictionary — the app says it from `result.gaps.length`; `blockingIngredients` takes the word for an unknown ingredient as a third argument), price-model (partial: the reading half, not the writing half or the dictionary lookups),
inventory-value (partial: everything but `formatTotal`, which reads the money from a module variable;
the app writes money with `formatMoney(value, money)` of `price-model`), currency (adapted, stateless),
catalogue-model (partial: everything but `unitText`, `formatAmount` and `exportModelOf`, which use the dictionary or the screen's number; `batchWarning` takes the translator, and the Calculator import — `toCalculatorRecipe`, `nonWeighableLabels`, `mergeImportedRecipe`, `importFailureKey` — came with 3d-7; and the Mise-2-only `inactiveLast` option of `linkOptions`, `suggestLinks` and `nameTaken`, which offers a switched-off ingredient last instead of leaving it out), recipe-link (partial: `mayOpenFoodCost`, `mayOpenOrders` and `recipeIdFromHash`; it leaves out the current app's page addresses — `recipeHash`, `foodCostHref`, `recipeHref`, `ordersHref`, `catalogueOriginFromHash` — and adds, new in Mise 2 with no original, the route builders `foodCostForRecipePath` and `recipeAddress`, the reader `recipeIdParam` and the navigation marker `FROM_RECIPE_LINK`), recipe-cost-model (partial: `costRecipe` and its constants; it leaves
out `costReasonLabel` and `partialCostText`, which use the dictionary — the app resolves `COST_REASON_TEXT`
through its own typed i18n), foodcost-model (partial: everything but `blockerText`, which uses the dictionary —
the app resolves `BLOCKER_TEXT` likewise), and, for the Suppliers page (step 3e-1), supplier-label, vat-number, favourite-suppliers (its two heading keys, `orders.favourites.title` / `.others`, are data the app maps to its own words), record-choices and category-batches (all full, paired), and ingredient-search (partial: only `normalizeText` and `filterSuppliers`; it leaves out `letterOf`, `matchesQuery`, `flatRows` and `orderSummary`, the Orders list's row builders, which use order-text; not paired, its spec compares names and arity with the `js/` file). For the ingredient card's product data (step 3e-2): ingredient-edit-model (full, paired), pack-format (adapted: `formatSummary` and `formatChanged` take the translate function and the locale as arguments, so it is not paired; its spec runs them against the original after `setLanguage`, with the original's own `t` and `localeTag()` handed to the port), order-request-model (partial: only `remainingIds`) and ingredient-merge (partial until step 3e-7, FULL and paired since: `findUsage`, the month keys and the merge plan — `mergeCandidates`, `pointIdOnA`, `mergedCodes`, `planMerge`, `deletionBatches`). For the pack-list allergen reader (step 3e-4): allergen-terms (the vocabulary of the 26 allergens in both languages, word for word) and allergen-match (`readPackIngredients`, `reconcileTicks`, `splitTraces`, `tickKey`, `normaliseWithMap`), both full, paired. For the Recipe catalogue's «+ Add … as an ingredient» (T15): records (full, paired: `mayEditRecords`, `NO_SUPPLIER_ID` — who may add a supplier or an ingredient, asked identically by both sections). For the Orders section (step 3f-1, the pure core): send-routes, supplier-order, orders-config, line-supplier, order-text and order-day (all full, paired), ingredient-search (now FULL and paired: it gained `letterOf`, `matchesQuery`, `flatRows` and `orderSummary` through the ported order-text, so the earlier note that it is partial no longer holds), day (adapted: the arithmetic is identical; `spellDay`, `spellShortDate`, `spellLongDate`, `dayLabel`, `daySpoken`, `dayWhen` and `dayPhrase` take the translate function as their LAST argument, with the same keys as the original, so it is not paired), no-supplier (adapted: `noSupplier(name)` and `orderSuppliers(active, resolved, name)` are handed the pseudo-supplier's word, and the constant `NO_SUPPLIER` the original builds at import is left out; not paired) and archive (partial: `wholeNumber`, `historyDocId`, `ingredientsOf`, `supplierHasItems`, `ingredientLabel`, `ingredientDisplayLabel`, `compareByLabel`, `sortByLabel`, `quantityPathsFor`, `changedEntries`, `changedDays`; it leaves out the archive builder, the merge, `recordedName`, the sends, the unit conflicts and the history grouping, which come with slices 3f-2 and 3f-4; not paired). order-text is also on the label-word list of `label-separation.spec.ts`, because its title and headings follow the venue's country, never the screen. For the suggestion hint (step 3f-2b): suggestions (`computeSuggestion`, `indexHistoryByIngredient`, `isUnusualQuantity`, `unusualQuantities` and the two thresholds) and history-window (the live window `HISTORY_LIVE_MONTHS` / `liveHistoryStart`, and the paging and History foot that slice 3f-4 will use), both full, paired; history-window declares the one `console.error` it makes, since shared/ compiles without DOM or Node types. A partial port keeps, in its header, the list of what it leaves out.

`fixtures/label-corpus.ts` is the fixture corpus of the whole label chain (33 recipes, four venues, four values of the label's switch), run through the `js/` originals and the ports by `label-corpus.spec.ts` and compared with the committed `fixtures/label-golden.json`, written once from `js/` by `fixtures/make-label-golden.mjs` (plain node) so the ports stay pinned after `js/` is deleted; a later step (labels, ZPL) adds a field to the chain and regenerates the file. `label-separation.spec.ts` reads the source of `market`, `recipe-label-model` and `recipe-allergen-model` and fails if one imports the dictionary or `app/`, or names the interface language.

## The session

Statuses: `loading`, `signed-out`, `choose-location`, `no-access`, `error`, `ready`. The decisions,
and where each comes from:

- A leftover anonymous session is dropped, never treated as a person.
- Another person's offline copy is wiped before any read of theirs, at ANY sign-in. This is the
  one deliberate difference from the current app, which waits for the next page load: Mise 2 is
  one page that never reloads by itself.
- A cached "users/{uid} does not exist" is not trusted; a cached "admins/{uid} does not exist" is.
- One venue opens straight in; a remembered venue opens if it is still yours; otherwise the picker.
- The venue's language is loaded before the venue is shown.
- The phone's copy is checked against the server behind it; a difference reloads, at most once in
  30 seconds, and never while somebody is editing (`busy.ts`).
- Sign-out and a venue switch wipe both copies and reload; both ask first, and warn when something
  typed has not reached the server.
- It is NOT a security boundary (P2): `firestore.rules` judges every read and write.

## Rules for every new screen (step 3 onwards)

1. **Data only through the backend.** A section's data layer gets Firestore from the session's
   backend, never from `getFirestore()`: Firestore's settings are fixed by its first use.
2. **An editor marks itself busy.** Every screen that holds unsaved edits calls `markBusy()` while
   it does (`session/busy.ts`), or a self-started reload throws the typing away.
3. **Every part in a `PartBoundary`.** A list and a detail are two parts; one failing must not
   take the other down.
4. **Text through `t()`, food words through the country.** A word a person taps follows the
   interface language; a word that names a FOOD follows the venue's country (the current app's
   `i18n-labels` rule).
5. **CSS modules and tokens only.** One `Name.module.css` per component; colours, fonts, radii and
   shadows only as `var(--token)` from `tokens.css`. `css-modules.spec.ts` fails on a class a module
   does not define and on a token `tokens.css` does not define. Light theme only.
6. **Accessibility is part of done:** one `main` and one `h1` per screen, labelled navigation,
   48px targets, a visible focus ring, errors announced, live regions present before they change.
7. **Specs are `*.spec.ts(x)`, never `*.test.*`, never in a folder named `test/`**: the root
   `node --test` would run them and fail. A port runs its tests against both apps.
8. **Load sections lazily** once they are real, so the first screen stays light: a built section is
   listed in `shell/sectionScreens.ts`, which loads it on first use, behind `SectionRoute`'s gate.
9. **The shell has ONE scroll area (its `main`) and resets it to the top at every address.** That
   is right between sections and wrong inside one whose list and detail are separate addresses
   (the Stocktake: a product opened from a long list). Such a section owns the scroll with
   `useOwnScrollArea()` (`shell/scrollArea.tsx`): the shell then resets only when the SECTION
   changes (leaving an owner for another section resets as ever), and the section must handle EVERY
   move inside itself. On a phone, where the detail replaces the list: write the list's place down
   before opening the detail, restore it on Back, and put every other new screen at the top. On the
   split, where both are on screen: leave the list alone. A section that does not own the scroll
   needs nothing. Specs plant the position on the `main` element (jsdom does not scroll):
   `StocktakeSection.scroll.spec.tsx`.

## Browser floor: Chrome 101 (the lab tablet's ceiling)

The lab tablet (SM-T550) gets nothing newer than Chrome 101 from Google Play (measured over adb, 13 Oct 2026).
lightningcss lowers oklch, nesting and media ranges; it does not lower everything. The rules:

- **Hover only inside `@media (hover: hover)`** — a `:hover` look sticks after a tap on a touch screen
  (`styles/touchHover.spec.ts`).
- **Viewport heights only through `var(--vh100)`.** The token is `100vh`, switched to `100dvh` in an `@supports`
  block in `tokens.css`, and `shell/viewportHeight.ts` sets it inline on `<html>` where dvh is unknown (Chrome < 108).
  Never write a `dvh`/`svh`/`lvh` line, and never a second declaration whose value holds `var()` as a "fallback":
  such a value is thrown out at computed-value time and the property becomes its initial value, not the line above
  (measured: computed `max-height: none`). `styles/viewportUnits.spec.ts` and `styles/fallbackTrap.spec.ts` pin it.
- **A React Aria hidden input needs a positioned ancestor** (see `SettingSwitch`), or it sits at the page's origin
  and makes the page scroll.
- **No feature newer than Chrome 101 without a feature check.** `styles/chrome101.spec.ts` (with `shared/src/chrome101-tokens.ts`, which lists the CSS and JS
  tokens with the Chrome version that introduced each) fails on any of the LISTED tokens in our source, comments
  excepted. It does not scan library code (`node_modules`, `js/vendor`), and a feature that is not on the list is not
  caught: add it to the list when you meet it.

## Testing and CI

- `app/`: `npm run typecheck`, `npm test` (Vitest, jsdom), `npm run build` (`tsc` first). Vitest
  processes only `?raw` CSS (`vite.config.ts`): with every stylesheet applied, jsdom hides the
  rail, because it ignores the media query that shows it.
- `shared/`: `npm run typecheck`, `npm test`.
- CI job `mise2` (a required check on `main` since 10 Oct 2026): installs both packages with
  `npm ci --ignore-scripts`, then typecheck, specs, build and `npm audit --audit-level=high`. It may
  only read the repository and holds no credential. `deploy-functions` still waits only on `test`
  and `rules`.
- Driving it: build with `--base=/mise2/` (from Git Bash: `MSYS_NO_PATHCONV=1`, or the path is
  rewritten), serve with `vite preview`, and on localhost it talks to the emulator.

## Performance (step 2c, 11 Oct 2026)

Phone profile: 360x800, CPU slowed 6 times, slow 4G (150 ms, 1.6 Mbps down). Time until the
sign-in form is usable, on the preview's CDN, medians of 2 runs:

| | current app | Mise 2 (step 2b-3) |
|---|---|---|
| first visit | 5.85 s | 4.12 s |
| second visit | 1.26 s | 1.47 s |
| later visits | 1.56 s | 1.96 s |

Mise 2's first visit is faster (5 files instead of 18). Later visits are slower by 0.2 to 0.4 s:
the cost is running the code (about 1 s of script at that CPU), over half of it Firestore (its
file is 554 KB of about 1.1 MB: Firestore 554, React 219, Firebase Auth 97, router 93, React Aria
81, the app 67).

What step 2c changed:
- **Firestore is loaded only when it is needed** (`session/firebaseBackend.ts`): the sign-in form
  needs none of it, so it is fetched while the password is typed, or by the signed-in session's
  first read.
- **The libraries have chunks of their own** (`vite.config.ts`): a release re-downloads Mise 2's
  own ~67 KB, not the whole bundle, and the browser can keep the libraries' compiled code.
- **Preact: not adopted.** React is about a fifth of the code and React Aria does not support it.
- **The service worker of step 5** will give Mise 2 the compiled-code cache that makes the
  current app's later visits fast.

Measured locally (served by `vite preview`, emulator; 3 runs, medians):

| | before 2c | after 2c |
|---|---|---|
| first visit | 8.6 s | 3.6 s |
| later visits | 3.4 s | 2.3 s |
| sign-in until the shell | 2.6 s | 2.6 s |

On the preview's CDN after 2c, both apps measured in the same session (3 runs, medians; the PC
was busier than for the first table, so compare the two columns, not the tables):

| | current app | Mise 2 after 2c |
|---|---|---|
| first visit | 4.99 s | 3.24 s |
| second visit | 1.80 s | 2.11 s |
| later visits | 1.96 s | 1.80 s |

Mise 2 is now faster on a first visit and level afterwards; the remaining 0.3 s on a second visit
is the compiled-code cache the current app gets from its service worker, which Mise 2 gets in
step 5. Verdict of step 2c: no change of framework; go on with the sections.

## Traps already paid for

- A tab's accessible name comes from its content, never from an `aria-label` that differs from the
  words drawn (axe `label-content-name-mismatch`). Text that is only for assistive technology uses
  the one `.visually-hidden` recipe in `base.css`, never `display: none`, which would take it out of
  the name.
- A sticky bar sticks only if nothing between it and the scroll area (the shell's `main`) has an
  `overflow`; `pastries/pastriesCss.spec.ts` reads the stylesheets and pins it.
- The status message sits 65px above the phone's tab bar, a copy of the bar's height;
  `ui/statusOffset.spec.ts` adds the bar up from its own stylesheet and fails when the two drift.
- An editor that copies its data when it opens must wait for the data: opened by its address, the
  store may still hold only an empty local copy (`daysLoaded` in the Pastries store).
- A screen that blocks leaving (unsaved edits) uses the router's `useBlocker`, which covers every
  way out (Back, the browser's Back, the rail, a day picked in a list), not the Back button alone.
- On a split, the right-hand side sticks to the top of the scroll area and scrolls on its own
  (never taller than the screen less `--topbar-h`): otherwise a detail opened from far down a long
  list opens out of sight (`stocktake/StocktakeSection.module.css`).
- The focus owed to the button that opened a detail is promised when the detail OPENS, not when
  its own Back is pressed: a phone's back gesture is the browser's Back and runs no code of the
  screen it leaves (`stocktake/handBack.ts`).
- A bar stuck to the bottom of a phone takes the rows' room: at 296×668 the Stocktake's month bar
  hid every product of the first screen. Stick a bar on a phone only for the screen's primary
  action (Pastries' Confirm); secondary actions go after the list.

- Vitest empties CSS, even `?raw`, unless told otherwise.
- Git Bash rewrites `--base=/mise2/` into a Windows path.
- jsdom applies `display: none` but not the media query that undoes it.
- A CSS custom property invented in a component fails the token guard: use layout that needs none.
- React 19 logs caught render errors with `console.error`, and React Router's boundary logs them
  again: the router's `onError` keeps it to one report.
- A live region inserted already filled is not announced reliably: render it empty first.
