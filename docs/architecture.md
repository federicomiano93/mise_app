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
| Vite | 8.3.1 | build target `chrome107, edge107, firefox104, safari16`: the lab tablet (SM-T550, Chrome 119) and iPhone Safari 16.4 |
| React Aria Components | 1.21.1 | accessible controls (focus, keyboard, screen readers) without writing them |
| react-router | 8.4.0 | hash routing (`#/orders`), because GitHub Pages cannot rewrite deep links |
| lucide-react | 1.48.0 | the icon set of the design |
| Firebase | 12.19.0 | the same SDK as the current app (see above) |
| Vitest + Testing Library + jsdom | — | specs |
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
  date, connection), `Page` (one h1, the tab title, focus on navigation), the placeholders, More,
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
  `recipesPath.ts`: `/recipes`, `/recipes/<id>` and (3d-2) `/recipes/allergens` and (3d-3) `/recipes/<id>/label`; `new`, `settings` and `photo` are reserved for
  later steps. The usage record names four screens, `recipes`, `recipes-detail`, `recipes-allergens` and `recipes-label`. `recipesNav.ts` and
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
is a React portal into `document.body` (`#labelPrint`, removed by the `afterprint` listener); the zebra (ZPL), the shop computer's
queue and the other roads arrive in 3d-4. The usage record names the screen `recipes-label` and the action `label-printed`. Every allergen verdict is the shared model's; `label-separation.spec.ts` (in `app/src`)
  pins that a screen that prints a food word asks the venue's country and never the interface language. `ui/RecipeFullScreen` and `ui/zoomStorage` are shared with the Calculator
  and take a storage key (`mise.calcZoomStep` / `mise.catZoomStep`).
- `ui/` — the shared controls: `Button`, `Dialog` and `useConfirm` (a question that waits for an
  answer; never the browser's `confirm()`), `StatusMessage` (one short message at a time, in a
  live region that exists before it speaks), `FormBar` (Back, title, the one primary action: the
  top of an editor), `useMediaQuery` (only for attributes that must agree with a stylesheet's
  media query; layout is always CSS).
- `settings/` — the Settings page (today: the Account card).
- `styles/` — `tokens.css` (every colour, size, radius, shadow) and `base.css`.
- `testing/` — `renderApp`, the fake session store and other spec helpers.

## `shared/src`

Pure logic only, no DOM types. Each module is a PORT of a `js/` file, and its spec runs every test
against BOTH files (`describe.each` over the TypeScript port and the `js/` original), so the two
apps cannot drift apart while both are live. `parity.spec.ts` compares the full ports export by
export (names, constants, frozen-ness, function names and arity); a partial port (`membership`,
`location-id`, `pastries-model`, `recipe-allergen-model`, `price-model`, `inventory-value`, `catalogue-model`, `recipe-cost-model`, `foodcost-model`) is not paired and its spec says why, and
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
vat-rates, ingredient-kind, product-limits, vat-guide, foodcost-weighing,
calculator-dough-math, calculator-recipe-source, calculator-order-text, calculator-order-prefill (adapted: `prefillNote` takes the translate function as an argument, so it is not paired), client-order-model (adapted: `orderRows` takes the deleted-product word as an argument, so it is not paired), client-order-history (adapted: `linesLabel` and `emptyWords` take the translate function as an argument, so it is not paired), calculator-recipe-text (one documented difference: the line
`Flour uniqua blue`, one venue's data, is written like every other), confirm-flow, log-time,
calculator-config (partial: the read side; leaves out the save path `reconcileConfigWrite` / `saveFailureKey` and
`orderPrefillLabel`; `formatGrams` and `normalizeConfig` take the language as an argument), log-model (partial: the
write half, `workDayIndex` and `typedTotalOf`; leaves out the list and edit half, the legacy migration and `dayLabel`;
`buildLogText` takes its two words as an argument), guided-model (partial: `ridOf` only), zoom-steps (partial: the
arithmetic; leaves out the storage and DOM halves), calculator-tab-keys (new in Mise 2, no original: the
`localStorage` keys of a Calculator tab and the stale-tab and lock decisions, pinned against the current app's
source),
recipe-allergen-model (partial: everything but `incompleteText`, which uses the dictionary — the app says it from `result.gaps.length`; `blockingIngredients` takes the word for an unknown ingredient as a third argument), price-model (partial: the reading half, not the writing half or the dictionary lookups),
inventory-value (partial: everything but `formatTotal`, which reads the money from a module variable;
the app writes money with `formatMoney(value, money)` of `price-model`), currency (adapted, stateless),
catalogue-model (partial: only what Food cost reads — the unit table, the row link, the oven loss and the link
suggestions; it leaves out the recipe normalisers, the kg scaling, the Calculator import and `unitText` /
`batchWarning`, which use the dictionary), recipe-cost-model (partial: `costRecipe` and its constants; it leaves
out `costReasonLabel` and `partialCostText`, which use the dictionary — the app resolves `COST_REASON_TEXT`
through its own typed i18n), foodcost-model (partial: everything but `blockerText`, which uses the dictionary —
the app resolves `BLOCKER_TEXT` likewise). A partial port keeps, in its header, the list of what it leaves out.

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
