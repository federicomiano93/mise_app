# Parity list — Orders («Ordini»): the shared order, placing and sending, Incoming, History, order lists

What Mise 2's `/orders` section must do because the current app does it (step 3f of the plan). Built from
`orders.html` and everything it runs (`js/pages/orders.js`: `i18n-dom`, `auth-gate`, `sw-update`, `kiosk`, `boot` — the
splash only — `orders/orders-main`, `help-button`, `hold-to-zoom`): every file in `js/orders/` that `orders-main.js`
imports — `draft.js`, `order-day.js`, `day.js`, `archive.js`, `line-supplier.js`, `no-supplier.js`, `orders-config.js`,
`reminders.js`, `kiosk-lines.js`, `sent-check.js`, `sent-check-dialog.js`, `supplier-order.js`, `memo.js`,
`ingredients.js`, `suppliers.js`, `supplier-detail.js`, `ingredient-list.js`, `ingredient-search.js`, `suggestions.js`,
`order-text.js`, `send-routes.js`, `send-chooser.js`, `preview.js`, `supplier-picker.js`, `place-confirm.js`,
`order-image.js`, `untold-changes.js`, `untold-view.js`, `reminder-view.js`, `notifications.js`, `alert-dismissal.js`,
`holidays.js`, `holidays-it.js`, `deliveries.js`, `deliveries-view.js`, `history-window.js`, `history.js`,
`history-edit.js`, `firebase-orders.js` (the parts this page calls), `order-request-model.js`, `order-requests.js`,
`management.js`; `firestore.rules` (`drafts`, `orders-history`, `order-requests`, `config/orders`, `members`, `away`,
`fcm-tokens`); `functions/index.js` + `functions/push-model.js` (the order-list notification); the data model of the
`firestore-rules` skill (orders part); and the tests listed in «Tests read».

**Out of scope** (other steps): the Suppliers page, the ingredient card, invoice import, price changes, ingredient merge
and the pack photo (step 3e, `docs/parity/suppliers.md`); `order.html` (step 3h); the Calculator's client orders
(`notifyClientOrder`, `client-orders`); the kiosk itself (step 3g — this page only FEEDS it, item M14).

**How to read it.** Items are numbered by area: **L** = the page, the supplier list and the shared draft; **D** = the
order day; **X** = placing and sending; **H** = the order record and History; **V** = deliveries (Incoming); **R** =
reminders, the alerts bell and order lists; **M** = management, settings and the rest of the page. Each item is one
requirement with `file:line` references. `main` = `js/orders/orders-main.js`; a bare file name (`draft.js`) is in
`js/orders/`; `rules` = `firestore.rules`. Line numbers are those of commit **`e04bf993`** — every one was checked to
exist, and the ones that name an identifier were checked to sit at or near it; read the code before trusting a
number. Items marked **spec** are pinned by a current test (named after it, in `tests/`); a port runs that test
against both files, or re-states it as a behaviour spec where the original reads source text. ⚠️ marks a trap that
was paid for in a bug. «Already in Mise 2» names what exists and must be reused, not rebuilt.

Nothing in the L/D/X/H/V/R/M lists is decided for Mise 2 unless it says so. What needs deciding is in «Decisions»
(T = technical, taken with the recommended option and listed for Federico; F = his — seven of them already decided,
written as the DIFFERENCE they make), what was found while reading is in «Findings», and the split into steps is in
«Proposed slices».

⚠️ **Two parts of this section can do real harm.** (1) **The shared order is one live document for the whole venue**
(`drafts/current`): every phone types into it at once, and a careless write erases what a colleague typed a second
ago (L30–L41). (2) **Placing an order writes a record and clears the draft**: a record built from the wrong numbers,
or a clear that runs when the record failed, loses an order that was really sent to a supplier (X1–X14, H1–H12).

## Already in Mise 2 (reuse, do not rebuild)

- **The section and its gate**: `/orders` in `app/src/shell/sections.ts:46` (rail top, in the phone tab bar), gate
  section `orders` + card `orders` in `app/src/session/visibility.ts:22`; no Orders screen yet. ⚠️ Not to be confused
  with the Calculator's `orders` sub-path (`app/src/shell/sections.ts:187-188`, client orders, step 3h).
- **Readers of the same collections** (`app/src/suppliers/`): `suppliersSource.ts` watches `suppliers`, `ingredients`,
  `ingredient-prices` (the `readable` flag) and `config/orders`; `suppliersStore.ts` exposes `suppliers`,
  `ingredients` (prices laid on with `withPrices` for whoever may read them), `pricesReadable`, `storedCategories`,
  `favourites`, `configLoaded`, `weekStartsOn` (`app/src/suppliers/suppliersStore.ts:46-85`). Orders needs the same
  three streams plus `drafts/current`, `orders-history` (bounded), `order-requests` (bounded); reuse the source, do not
  open a second listener on the same documents in the same screen tree.
- **Shared ports** (`shared/src`): `order-unit` (full: `cleanUnit`, `hasUnitChoice`, `unitChoices`, `entryUnit`,
  `isDefaultUnit`, `lineUnit`, `recordUnit`, `qtyWithUnit`, `inPackages`, `addableInPackages`, `storedUnitFor`),
  `order-cost` (full: `lineUnitCost`, `orderCost`, …), `favourite-suppliers` (full), `work-week` (full: `weekStartOf`,
  `isValidWeekStart`, `weekStart`, `inCurrentWeek`, `beforeCurrentWeek`), `supplier-label` (full), `records`,
  `away-model` (full, incl. `whoWillBeTold`, `nobodyWillBeTold`, `awayNames`), `push-model` (full:
  `orderRequestNotification`, `targetPage('orderRequest') = './orders.html'`, `PUSH_KINDS`), `category-batches`;
  **partial**: `order-request-model` (only `remainingIds`), `ingredient-search` (only `normalizeText`,
  `filterSuppliers`); `catalogue-model`'s `linkOptions({ inactiveLast })` (`shared/src/catalogue-model.ts:238`, the
  `inactive` list at 271) for decision F6.
- **App pieces**: `ui/` (`Button`, `Dialog`, `useConfirm`, `useAlert`, `FormBar`, `StatusMessage`, `SettingSwitch`,
  `SendSheet`, `FoldedGroup`, `split`, `clipboard`, `wakeLock`), the list + detail split from 1000 px with its hand-back
  of the focus (`app/src/suppliers/handBack.ts`), `session/busy.ts`, `shell/scrollArea.tsx`, `session/useMoney.ts`.

## The order list: The page, who sees it, the gate

L1. **Gate = section `orders` + card `orders`.** `<body data-section="orders" data-card="orders">`
(`orders.html:79`); the auth gate sends the person Home when the section is off or the card hidden from staff (same
mechanism as the Suppliers page, `docs/parity/suppliers.md` S2). Already in Mise 2: `app/src/session/visibility.ts:22`.
L2. **No role gate on the way in.** Every member with the section types, places, sends and confirms deliveries; the
role narrows only: Settings controls (M2–M6), deleting an order list (R21), the untold banner's tap (R9), the roads
(X16). `canManageHere()` = `currentSession().canManage === true` = owner OR manager (`firebase-orders.js:476`).
L3. **The header** (`orders.html:120-146`): reorder `#orders-reorder-btn` (always drawn, disabled until the first
draw, V14), bell `#orders-alerts-btn` with its panel `#orders-alerts-panel` (`orders.html:131`, `160`; R11),
order lists `#orders-lists-btn` (hidden when `orderLists` is off, `orders.html:139`; R16), send
`#orders-wa-btn` (`orders.html:146`) — ONE arrow, Federico's choice of 14 Aug 2026 (**spec** `one-send-arrow`: no
paper plane, no WhatsApp brand mark or colour anywhere).
L4. **Tabs Order / Incoming** (`orders.html:219-231`, panels `#tab-order` 248 and `#tab-deliveries` 302), the
Incoming badge at `orders.html:230`; `setupTabs` (`main:2673`). Banner hosts above the list, in this order:
`#orders-owed` (V12), `#orders-untold` (R9), `#orders-pending` (R5), `#orders-today` (R1) (`orders.html:263-272`).
L5. **Page status line** `#orders-status` (`orders.html:189`), `setStatus` / `clearStatusIf` (`main:2726`, `2761`);
the draft-save error has its own key `DRAFT_SAVE_ERROR_KEY` (`main:2707`) so a later success clears only that message.
⚠️ `liveDataLost` (`main:2751`) is handed a function that asks `t()` at the moment the stream drops, never a string
captured at load (**spec** `live-data-lost`).
L6. **Offline bar** (`orders.html:346`, `setupOfflineIndicator` `main:2771`). Typing works offline (Firestore's cache);
placing does not (X3).
L7. **The page draws in parts**: one draw per animation frame (`scheduleRender` `main:486`), each part drawn on its own
inside a try/catch so one failing part does not stop the others (`drawPart` `main:502`), and `setRenderPaused`
(`main:492`) while an overlay owns the screen (**spec** `orders-render-scheduler`). In React this is the ordinary
render; the requirement that survives is «one broken banner never blanks the order list» (an error boundary per part,
T6).
L8. **First draw waits for the data**: suppliers, ingredients and the draft must have arrived before the empty state
(«no suppliers yet») may be shown (`renderEmptyState` `main:937`); the reorder button is enabled only after the first
draw (`orders.html:120`).
L9. **Back from the Catalogue**: `#from=` in the address puts a back link to the screen the person came from
(`setupCatalogueBack` `main:224`).

## The order list: Suppliers, search, views

L10. **The suppliers shown are the ACTIVE ones** (`active !== false`, `main:305-310`), sorted by the venue's own order
(`config/orders.supplierOrder`, `sortSuppliersByOrder` `supplier-order.js:27`; M8), plus the pseudo-supplier
«No supplier» LAST and only when something is filed under it (`orderSuppliers` `no-supplier.js:98`). **spec**
`supplier-order`, `ingredient-search`.
L11. **«No supplier»** (`NO_SUPPLIER_ID = 'no-supplier'`, no order days, `no-supplier.js:36`): an ingredient whose
supplier was deleted, or that was saved without one, is filed there (`resolveSuppliers` `no-supplier.js:82`) — never
lost. ⚠️ Nothing is reclassified until the suppliers have really arrived (otherwise every ingredient would flash under
«No supplier» on a cold start). Resolving never mutates the stored ingredient. **spec** `ingredient-search`.
L12. **The lens** (`resolveLens` `main:291`): the ingredients as Orders files them — resolved suppliers, then the
per-line overrides (`withLineSuppliers` `line-supplier.js:55`; L38). Memoised on the inputs AND the override signature
(`memoLast` `memo.js:12`, `overrideSignature` `line-supplier.js:72`), because typing mutates the entries in place
(`main:289-294`). **spec** `orders-memo`, `line-supplier`.
L13. **Inactive ingredients are not on the order screens at all** (`main:335`, `355`, `789`), but ARE included when a
supplier's order is placed or cleared (`ingredientsOf(…, { activeOnly: false })` `main:2070`, `2217`; `archive.js:54`)
so a quantity left on a product switched off since cannot survive a placed order. **spec** `orders-archive`
(«ingredientsOf hides deactivated products by default, but can list them all»). Changed by decision F6.
L14. **The supplier list** (`mountSupplierList` `suppliers.js:127`): a search box and an All / Ordering filter (a radio
group, not tabs: it filters one list, `suppliers.js:139-149`), Favourites first when the venue starred some
(`favouriteGroups`, `suppliers.js:25`), each row with its name, how many lines are filled, the next order day and a
«for later» tag when the stamp is in the future (`buildSupplierRow` `suppliers.js:237`, `paintForDay` `59`,
`supplierStats` `69`). The box and the filter are built once and only the rows repaint (`suppliers.js:17`), so typing
in the search never loses the keyboard. **spec** `orders-favourites-and-shortcut`, `orders-list-readability`.
L15. **Search** matches name, weight, brand, supplier and category, ignoring accents and capitals
(`normalizeText` `ingredient-search.js:23`, `matchesQuery` `41`, `filterSuppliers` `61`); an empty search matches
everything. **spec** `ingredient-search`.
L16. **A supplier row ALWAYS opens its screen, never toggles** (`openSupplier` `main:581`); Back (`closeSupplier`
`main:590`, `leaveSupplier` `611`) returns to the list with the focus on the row that opened it.
L17. **The flat view («by ingredient»)**: one A→Z list of every ingredient of every supplier, each row naming its
supplier (`renderFlatList` `main:915`, `flatRows` `ingredient-search.js:83`), with a letter index (`letterOf` `33`).
The view switch is a swap button in the toolbar (`setupViewSwitch` `main:1033`, `setView` `969`); the old segmented
switch at `orders.html:241-244` stays hidden. ⚠️ The view is NOT remembered between visits (`main:1029`).
L18. **«Only what I am ordering»** freezes the set of filled lines when switched on, so a line taken to 0 does not
vanish under the finger (`setOrderFilter` `main:1050`); re-entering refreshes the frozen set. **spec**
`orders-ingredient-sticky-search`.
L19. **The summary** (`openSummary` `main:815`, `renderSummary` `868`, `orderSummary` `ingredient-search.js:127`):
every filled line grouped by supplier; opened over a supplier screen with the screen below made `inert`
(`openSummaryOverSupplier` `main:830`). **spec** `orders-order-summary`.
L20. **Tablet**: list + detail side by side, the summary button per supplier row (`suppliers.js:280`), the order's money
only on a tablet AND only for whoever may read prices (`paintMoney` `main:567`, `order-cost` port). **spec**
`orders-tablet-layout`, `orders-tablet-display-pairs`, `tablet-width`, `order-cost`, `line-unit-cost`.
L21. **Sticky search head** with its height published as a CSS variable, observers ended by `destroy()`
(`ingredient-list.js:133-147`). **spec** `orders-sticky-focus-and-observers`.

## The order list: A supplier's screen and its rows

L22. **The supplier screen** (`buildSupplierDetail` `supplier-detail.js:43`): header with Back, the name and «+ add an
ingredient» (only when `mayEditRecords`, hidden — not disabled — otherwise, `supplier-detail.js:55-65`); a polite live
region announcing the day choice (`supplier-detail.js:70`); the day line (D6); the rows; «Order placed…» disabled
while nothing is filled and «Clear quantities…» (X1, X13). `renderOpenSupplier` `main:720`. **spec**
`supplier-detail-builds`.
L23. **«What they sell»**: a read-only list of the supplier's own items (without per-order overrides), opened from the
supplier screen (`openSupplierItems` `main:764`, `renderSupplierItems` `778`). **spec** `orders-supplier-items`.
L24. **Rows: one A→Z list, no category headings** (`buildIngredientList` `ingredients.js:81`), sorted by the label a
person reads (`compareByLabel` `archive.js:147`, numeric-aware). **spec** `orders-sort-by-label`.
L25. **A row** (`buildRow` `ingredients.js:132`): the name (a button that opens the ingredient card for whoever may
edit records, a plain span otherwise, same look — `ingredients.js:284-293`), the quantity box with − / + steppers
(`ingredients.js:342`), the clear × (`ingredients.js:317`), the unit select only when the card offers a choice
(`ingredients.js:265`, `paintUnitSelect` `71`), the Stock box (hidden venue-wide by M3, class `stock-field`). **spec**
`orders-ingredient-rows`, `orders-unit-choice-data`, `order-unit`.
L26. **Quantities are whole, never negative, never NaN, never Infinity** (`wholeNumber` `archive.js:29`) — Firestore
refuses a non-finite number. **spec** `orders-archive`.
L27. **The suggestion hint** «Suggested: N» once an ingredient has at least 4 past orders, averaged over the last 8
(`MIN_ORDERS`, `WINDOW_ORDERS` `suggestions.js:28-29`, `computeSuggestion` `83`), unit-aware: no hint in a non-default
unit (`ingredients.js:191-206`). The history index is memoised (`main:2428-2434`). **spec** `suggestions`,
`suggestions-index`.
L28. **Typing a Stock reading fills the suggested quantity** when the box is empty and the suggestion is active
(`ingredients.js:224-232`), and a stock-only change is saved WITHOUT restamping the day (`stockOnly`,
`ingredients.js:228-230`, `main:176`): counting shelves says nothing about which order the rows are for.
L29. **«Much more than usual»**: a quantity more than 4× the usual and 10 above it is flagged on the row and on the
place-confirm screen (`UNUSUAL_FACTOR`, `UNUSUAL_MARGIN` `suggestions.js:118-121`), recomputed on every keystroke so
correcting the digit removes it (`place-confirm.js:125-131`). The hint and the warning never show together
(`ingredients.js:189`).
L30. **Add / edit / delete an ingredient from Orders** opens the shared ingredient card (step 3e) over the page
(`openAddIngredient` `main:626`, `openEditIngredient` `687`, gated by `mayAddIngredient` `622`); deleting it also
cleans its draft row (`deleteIngredientAndDraftRow` `main:664`, `clearIngredientFromDraft` `draft.js:274`); a unit
change on the card freezes the old unit on a typed line (`freezeUnitInDraft` `draft.js:297`). Focus comes back to the
row (`restoreFocusAfterCard` `main:675`). **spec** `orders-add-ingredient`, `orders-edit-ingredient`,
`draft-freeze-unit`.

## The order list: The shared draft (`drafts/current`)

L31. **One live document per venue**: `drafts/current` = `{ entries: { <ingredientId>: { qty, stock, unit?,
supplierId? } }, days: { <supplierId>: 'YYYY-MM-DD' }, updatedAt }` (`DRAFT_ID` `draft.js:28`; rules `rules:1143-1166`:
keys `bakery, entries, days, updatedAt, weekId`, `entries` ≤ 2000, `days` ≤ 200, delete never). `weekId` is retired
and still allowed for old phones.
L32. ⚠️ **Only the keys this phone changed are sent**, through a merge write with field paths
(`changedEntries` `archive.js:227`, `changedDays` `268`, `quantityPathsFor` `191`, `saveDraftNow` `draft.js:116`).
Just looking at a supplier stores nothing; a row taken DOWN to zero is a real change; an empty field is not a change
from zero; a colleague's rows are never rewritten. **spec** `orders-archive`, `draft-override`.
L33. **Autosave debounced at 800 ms** (`SAVE_DELAY_MS` `draft.js:29`, `scheduleDraftSave` `97`), flushed before any
archive or clear (`flushDraftSave` `draft.js:162`).
L34. ⚠️ **`known` is the baseline the autosave compares with, and it is a DETACHED copy** (`draft.js:41`, `detach`
`66`): typing mutates the live objects in place, so a shared reference would make every change look already saved.
L35. ⚠️ **`pending` holds what this phone typed and has not seen confirmed** (`draft.js:55`), re-applied on top of every
snapshot (`watchDraft` `draft.js:170`, `main:2878-2903`), so a colleague's snapshot arriving mid-typing cannot erase a
digit just typed.
L36. ⚠️ **A merge write cannot delete a nested key**: `unit: ''` and `supplierId: ''` are sent on purpose to clear them,
and read back as «none» (`cleanSupplierId` `line-supplier.js:23`). **spec** `line-supplier`, `draft-override`.
L37. **A failed save is said** (the page status, L5) and retried by the next change; the typed values stay on screen
(they are in `pending`). Reporter: `setDraftSaveReporter` (`draft.js:83`).
L38. **Per-line «order from another supplier»** (`entries.<id>.supplierId`, set from Incoming, V17): the line moves to
the other supplier while it has a quantity, else back to its usual supplier (`lineSupplierId` `line-supplier.js:43`);
an override to a supplier that is gone, switched off, or the pseudo one falls back — the line never vanishes; placing
or «start again» for the other supplier clears the line AND its override (`main:2222`). **spec** `line-supplier`,
`draft-override`.
L39. **The lens is redrawn when the override signature changes** (`main:2882-2888`), never when only a number is typed.
L40. **Deleted ingredients leave the draft** (`dropDeletedIngredientFromDraft` `draft.js:268`).
L41. **`syncInputsFromState`** (`main:407`) repaints the boxes from the state after a remote snapshot WITHOUT touching
the box that has the focus.

## Order day: The day model and the day line

D1. **The rule** (`order-day.js:10-20`, `targetDayFor` `65`, `stampFor` `74`): a supplier with NO order days → today;
today is one of its order days → today; otherwise → its NEXT order day. A stamp that is today or later is kept; a stale
or missing one is recomputed. No history is needed. **spec** `order-day`.
D2. **Typing a quantity stamps the supplier's day** (`stampNow` `main:1939`, `hooks.afterChange` `main:168-189`); a
stock-only change does not (L28).
D3. **`rawDayFor`** (`main:1923`) = the stored stamp, or the local day of the draft's `updatedAt`, or today — what the
screens and reminders read (it can be in the future). **`dayForSupplier`** (`main:1927`) =
`recordDay(rawDayFor, today)`: the day an order is RECORDED under (decision F3).
D4. **`recordDay(stamp, today)`** (`order-day.js:134`): a future stamp → today; a past or today stamp → unchanged.
**spec** `order-day` («recordDay clamps a future stamp to today and leaves past and today alone»).
D5. **«For later»**: a supplier stamped for a later day is excluded from the untold-changes question and the pending
banner (`notForLater` `order-day.js:140`, `isFutureDay` `33`); its row carries a «for later» tag (L14). **spec**
`order-day`.
D6. **The day line** on a supplier screen (`buildDayLine` `supplier-detail.js:203`, a native select;
`dayInfoFor` `main:1962`; `dayChoices` `order-day.js:103`): options `today`; `past` (the stored stamp, gone by, only
while the supplier has items); `next` (the next order day, only with order days); `later` (a stored future stamp
that is not the next order day); sorted by date. ⚠️ **The line is shown only with two or more options**
(`main:1964`), so TODAY a supplier with no order days shows no line unless it has a past or later stamp. Changed by
decision F2.
D7. **Choosing a day restamps** (`setSupplierDay` `main:1988` → `restamp` `2569`); choosing `past` writes nothing; a
failed write is rolled back and the select redrawn from what is stored; the result is announced politely, focus stays
on the select.
D8. **The expected delivery** under the day line follows the day IN EFFECT: the supplier's next delivery day strictly
after the selected order day (`nextDeliveryAfter` `order-day.js:53`; owner's words at `main:1950-1954`).
D9. **Day words** (`day.js`): local dates everywhere (`parseISODate` lands on local midnight, DST-safe `addDays`),
«Today» / «Yesterday» / a spelled date with no year (`dayLabel` `day.js:108`, `spellShortDate` `88`, `spellLongDate`
`96`, `dayPhrase` `149`). ⚠️ `WEEKDAY_LONG` is DATA kept in English (`day.js:28`): it is compared with the stored
`orderDays`/`deliveryDays`; only what reaches the screen goes through the dictionary. **spec** `orders-day`,
`day-words`.

## Sending: Placing an order

X1. **«Order placed…» on a supplier screen** (`placeOrder` `main:2085`) is guarded against a double tap by a `placing`
set, disabled while nothing is filled (`supplier-detail.js:148-158`, `disablePlaceButton` `main:2320`).
X2. **The place-confirm screen** (`openPlaceConfirm` `main:2359`, `buildPlaceConfirm` `place-confirm.js:46`): a working
copy of the lines with their units FROZEN as shown; the quantity can be corrected; what today's order lists asked for
is shown beside each line when it differs (`place-confirm.js:99`); the unusual warning (L29); every line zeroed is
refused and said («nothing left to record», `place-confirm.js:156`). ⚠️ The CONFIRMED numbers are what is recorded,
never the live draft (a colleague may have typed since), a row set to 0 is recorded as 0, the caller's entries are
never mutated. **spec** `place-confirm`.
X3. **Placing is refused offline** and said (`main:2101`): a record and a clear that run in two different moments of
connectivity are how an order gets lost.
X4. **The sent-check «Did you send it?»** (`askSentCheck` `main:1811`, `sentCheckDialog` `sent-check-dialog.js:14`):
Yes / Send it now / Cancel; Escape and the backdrop = cancel, focus trapped and given back. «Send it now» only when a
road that reaches the SUPPLIER is open for this person, and it sends byte for byte the message of the send screen with
the CORRECTED numbers; after a send only the suppliers the road really reached are recorded (`suppliersToRecord`
`sent-check.js:41`, `outcomeOf` `32`). Not asked by the pending banner's «placed yesterday» path (`shouldAskSent`
`sent-check.js:12`). **spec** `order-sent-check`.
X5. **Then, in this order** (`main:2143-2191`): `flushDraftSave` → `archiveSupplier` (a transaction, H2) → forget the
rows locally (`forgetSupplierLocally` `main:2069`) → `clearSupplier` (clear only that supplier's fields,
`draft.js:220`). ⚠️ `main:2171` is the point of no return: before it a failure leaves the draft intact; after it the
record exists and a failed clear is only said, never rolled back. **spec** `place-confirm` («archiveSupplier is handed
the CONFIRMED entries, never state.entries»).
X6. **Placing clears the whole entry of every line in it**, overrides included (`draft-override`), and keeps the stock
readings of OTHER lines (`forgetQuantitiesLocally` keeps stock, `main:2214`).
X7. **Unit conflicts are refused before sending** (`refuseOnUnitConflict` `main:2022`, `unitConflictMessage` `2035`,
`unitConflicts` `archive.js:470`): today's record holds a line in one unit and the new order has it in another that
cannot be added in packages → said, nothing sent. The check is synchronous so a window opened by the send stays
inside the tap (`send-chooser.js:108-114`). **spec** `same-day-sends`.
X8. **Several suppliers at once** (`recordSuppliers` `main:1712`): the place-all screen (`openPlaceAllScreen`
`main:1880`, the supplier picker `buildSupplierPicker` `supplier-picker.js:121`), shown from 1 filled supplier in the
flat view and from 2 by supplier (`refreshPlaceAllButton` `main:1905`); each supplier recorded under its own
`dayForSupplier` (`main:1730`). **spec** `order-sent-check`.
X9. **The pending banner's answers record with `alreadySent: true` and the pinned day** (`recordPending` `main:2544`,
`placeOrder` uses `pinnedDate` at `main:2106`). R5.
X10. **Offer to record after a send** (`offerToRecordSent` `main:1701`): after the send screen sent orders, the app
asks whether to record them (the sent-check words for «already sent»).
X11. **Clear quantities** (`openClearScreen` `main:2291`, `clearQuantitiesFor` `2248`, `confirmClear` `2231`,
`clearQuantities` `draft.js:323`): a picker of suppliers, confirm, then clear quantities and keep the stock readings.
⚠️ Finding F-1 (hard-coded «Clear»).
X12. **Nothing is ever recorded for an empty order** (`supplierHasItems` `archive.js:61` counts ORDERED quantities,
not stock readings). **spec** `orders-archive`.
X13. **The «Clear quantities…» and «Order placed…» buttons under the list** (`orders.html:289`, `294`) appear only when
there is something to act on (`refreshClearAllButton` `main:2311`).
X14. **Status words name the day**: «recorded for Monday 3 Oct» via `dayPhrase` (**spec** `orders-day`: «every confirm
uses it»).

## Sending: Roads, the send screen, messages

X15. **Four roads** (`ROUTES` `send-routes.js:18`): `manager` (an order list inside the app, R16), `whatsapp` (one
message to any chat), `whatsappSupplier` (one chat per supplier), `email` (one mail per supplier). Defaults: manager
and whatsapp on, the two direct roads OFF (`DEFAULT_ROUTES` `send-routes.js:35`). **spec** `send-routes`.
X16. ⚠️ **A manager or owner keeps all four roads whatever the switches say**; an employee gets what is switched on
(`routesFor` `send-routes.js:70`). Order lists off removes the manager road for EVERYBODY (`effectiveRoutes` `83`).
The last road cannot be closed; a preference pointing at a closed road is moved; a corrupt or all-off document falls
back to the defaults (`normalizeSendRoutes` `44`, `validateRoutes` `122`). **spec** `send-routes`.
X17. **A direct road needs a contact**: no phone → no WhatsApp-to-supplier for that supplier, no email → no email; the
offer names who cannot be reached, never drops them silently (`routeAvailableFor` `send-routes.js:100`, `unreachable`
`107`, `offerFor` `send-chooser.js:36`).
X18. **With one road it asks nothing** (`send-chooser.js:79`); with none it says so (`send-chooser.js:73-77`). The
chooser lists the roads with their notes (`send-chooser.js:81-105`). Finding F-4 (no dialog semantics).
X19. **The send screen** (`openSendScreen` `main:1394`, `buildSendScreen` `preview.js:28`): pick the suppliers (nothing
preselected), see the message, the grouped/flat format switch (`supplier-picker.js:64`), send by the chosen road.
X20. **The message** (`buildOrderMessage` `order-text.js:192`): grouped by default (`GROUPED_BY_DEFAULT` `main:1301`);
a supplier heading only with several suppliers; no weight in a line unless two lines share a name (`messageLabels`
`order-text.js:103`); the title in the venue's COUNTRY language (`outputLanguage`, `orderTitle` `order-text.js:45`).
**spec** `order-text`, `order-language-callers`, `order-cost-message`.
X21. **WhatsApp**: `wa.me/?text=` for the any-chat road, `wa.me/<digits>?text=` per supplier, digits only
(`digitsOf` `send-chooser.js:357`, `whatsappUrl` `order-text.js:251`); never an empty chat (`send-chooser.js:124`).
X22. **Photo or text** for the WhatsApp roads when the browser can share a PNG (`askFormat` `send-chooser.js:291`,
`canSharePhotos` `order-image.js:169`): all pictures are drawn first, then one dialog per picture whose own tap starts
the share; Cancel / Escape sends and counts nothing (`runPhotoBatch` `send-chooser.js:230`, `photoDialog` `316`).
The picture: 1080 px wide, Manrope, ink on white (`order-image.js:18-25`, `layoutOrder` `56`). ⚠️ `navigator.share`
only for a FILE (the order picture), never for text. **spec** `order-image`, `send-chooser`, `one-send-arrow`.
X23. **Email** opens the mail app with a subject and the text (`mailto` `send-chooser.js:364`, `emailSubject`
`order-text.js:137`); the Settings note says plainly that it opens the app and does not send (`management.js:331-335`).
Finding F-3.
X24. **A per-supplier road records only a window that really opened** (`sendTexts` `send-chooser.js:194`; a blocked
pop-up is not «sent»). **spec** `order-sent-check`.
X25. **Every clipboard write is raced against a clock in ONE place** (**spec** `one-send-arrow`).

## History: The order record

H1. **One record per day and supplier**: `orders-history/<YYYY-MM-DD>_<supplierId>` (`historyDocId` `archive.js:36`).
Fields (`buildSupplierArchive` `archive.js:74`): `date, supplierId, supplierName, quantities` (qty > 0 only), `stock,
names` (each label frozen, so a deleted ingredient still reads), `units?, sends, createdAt, updatedAt`; later
`deliveredAt, missing, missingResolved` (V). Rules `rules:1173-1264`: id shape, every key whitelisted, maps capped at
500, `sends` ≤ 50.
H2. **A second order the same day ADDS to the record** in a transaction (`archiveSupplier` `draft.js:201`,
`mergeArchives` `archive.js:287`): quantities add; different units add in packages when the card says how many
(1 cartone + 2 buste = 6 buste), otherwise `orders/unit-conflict` is thrown and nothing is merged; `missing` and
`missingResolved` carry over (`carriedMissing` `361`), `deliveredAt` is DROPPED (the new goods have not arrived).
**spec** `same-day-sends`, `orders-archive`.
H3. **Each order of the day is kept apart in `sends`** (`<sendId>: { at, quantities, units? }`, `sendIdFor`
`archive.js:371`), capped at 50 (`MAX_SENDS`, `capSends` `400-401`); a record from before `sends` becomes one send at
its creation time, or with NO time if it was rewritten after creation (`sendsBefore` `383`). **spec** `same-day-sends`.
H4. **The label in a record** is the one the person read the day it was ordered (`recordedName` `archive.js:164`,
`ingredientLabel` keeps the invoice name `132`).
H5. **Legacy weekly record** (`2026-W28`, `weekStart`, no `supplierId`): exactly one exists; still read, still
editable (`isLegacyRecord` `archive.js:41`, rules `rules:1277`), never a delivery. **spec** `history-window`,
`deliveries`.
H6. **Any member with Orders may write or delete a record** (`rules:1298`): it is how a person corrects their own work.

## History: The History screen and the editor

H7. **History is a door in Settings** (Federico moved it there on 24 Aug 2026, `management.js:123-131`), an overlay
deliberately not `.preview-overlay` (`orders.html:313-330`), status line `#history-status` (`orders.html:326`).
`openHistory` `main:1222`, `renderHistory` `history.js:75`.
H8. ⚠️ **Bounded read**: the page listens only to the last 2 calendar months (`HISTORY_LIVE_MONTHS`
`history-window.js:18`, `liveHistoryStart` `23`, `watchRecentHistory` `firebase-orders.js:139`, `date >=`); older
pages of 100 on demand FROM THE SERVER, never the offline cache (`getOlderHistory` `firebase-orders.js:160`), then the
legacy record last (`getLegacyHistory` `179`); merged by id with the live copy winning (`mergeHistory`
`history-window.js:32`). Footer: button / loading / retry (`olderFooterState` `50`). **spec** `history-window`,
`history-bounded-read`, `history-wiring`.
H9. **What History shows** is the `historyDays` window (default 15, max 365; `orders-config.js:28-29`), grouped by day
(`groupHistoryByDay` `archive.js:532`); it HIDES and never deletes. Empty states tell «nothing in the window» from
«nothing at all» (`historyEmptyKind` `history-window.js:62`).
H10. **A card** (`buildOrderCard` `history.js:283`): the lines with units; with two or more sends one section each
(first, later, correction) then the day total (`sendSections` `archive.js:445`, `sendHeading` `history.js:324`).
**spec** `same-day-sends`, `history-stacking`.
H11. **Send again**: a card's «Send on WhatsApp» and a whole day's send (`sendRecord` `main:1323`,
`openSendDayScreen` `1329`, `sendMessageFor` `1309`). ⚠️ Always WhatsApp — never the chooser (`history.js:45-52`, an
open question in the code; decision F8).
H12. **The editor** (`openHistoryEditor` `main:1347`, `buildHistoryEditor` `history-edit.js:37`): change quantities,
confirm, saved WHOLE (`saveHistoryRecord` `draft.js:341`, replace) with the change added as a «correction» send
(`withCorrection` `archive.js:411`); delete with confirmation (`deleteHistoryRecord` `draft.js:345`). Not role-gated,
and the rules agree (H6). **spec** `same-day-sends` («a correction is added only to a record that already keeps
sends»).

## Deliveries: Incoming, the debt, reorder

V1. **Derived, never stored as a list**: an order is «coming» until somebody says it arrived (`isDelivered`
`deliveries.js:39`: only a real `deliveredAt` stamp counts). The app is TOLD what arrived, never deduces it from
delivery days (`rules:1218-1225`). **spec** `deliveries`.
V2. **Only the current work week** (`weekStartsOn`, M5; `pendingDeliveries` `deliveries.js:93`); due today in its own
group; expected day = the next declared delivery day AFTER the order day (`expectedDeliveryOn` `65`); a supplier with no
delivery days is shown, never hidden, with no date invented; an order whose supplier was deleted still shows. **spec**
`deliveries`.
V3. **Incoming** (`renderIncoming` `main:1089`, `renderDeliveries` `deliveries-view.js:30`, `deliveryRow` `61`), its
tab badge (`refreshDeliveriesBadge` `main:1188`).
V4. **«Did it all arrive?»** (`openArrival` `deliveries-view.js:97`): All arrived → `confirmDelivery` patches
`deliveredAt`, `missing` (replaced whole), `updatedAt` (`draft.js:367`); «Something missing» → the missing picker.
⚠️ An order that already carries missing marks goes straight to the rows (a second order the same day must not let
«everything arrived» erase what somebody said earlier, `deliveries-view.js:101-105`). Finding F-11.
V5. **The missing picker** (`openMissingPickerScreen` `deliveries-view.js:128`, Save in the header, `confirm` `194`):
every row considered arrived until ticked missing. `missing` sits BESIDE `quantities` and never edits it (the
suggestions average over quantities; the evidence of what was ordered stays, `rules:1227-1232`).
V6. **The debt banner** (`renderOwedBanner` `deliveries-view.js:577`, `unansweredBefore` `deliveries.js:240`): orders
from before this week never answered, oldest first, one at a time (`openOwed` `594`); it never goes quiet by itself.
⚠️ A Monday start moves the window and the debt together. **spec** `deliveries`.
V7. **Bounded by the live window**: deliveries see only the last 2 months of records (H8; data model note).
V8. **«Da riordinare»** (`stillToReorder` `deliveries.js:159`): missing lines not yet resolved and not yet put back.
V9. **The reorder button** in the header (`renderReorderButton` `deliveries-view.js:212`) with its count, and the
reorder screen (`openReorderScreen` `280`, `reorderCard` `366`): per line «Put back» (onto its own supplier's order,
`putBackOne` `519`, `applyReorder` `deliveries.js:216`), «Another supplier» (V10), «Resolved» (asks first, merges
`missingResolved.<id>` = now, `resolveOne` `539`, `resolveMissing` `draft.js:379`). A line that already has a quantity is
said and nothing written; no «put back» for an ingredient that is gone, switched off, or whose supplier is not active;
names fall back to those frozen in the order. The overlay is a modal dialog named by its title, focus on Back, Escape
closes, focus returns to the button (or the Order tab, never `<body>`). **spec** `reorder-list`.
V10. **«Another supplier»** (`chooseOtherSupplier` `deliveries-view.js:441`, `otherSupplierChoices` `431`): writes the
per-line override (L38) with the quantity; `incomingContext.onOtherSupplier` (`main:1136-1145`).
V11. **«Resolved» stays separate from `missing`**: the line still did not arrive, so the stocktake must still not count
it as bought (`rules:1245-1250`).

## Reminders: Banners, the bell, holidays

R1. **Today's orders** (`renderTodayOrders` `reminder-view.js:21`, `todayOrders` `reminders.js:44`): the suppliers whose
order day is today, done ones ticked (`placedOn` `26`); nothing to order → no banner. **spec** `orders-reminders`.
R2. **Deactivated suppliers and products are never nagged about** (`orders-reminders`).
R3. `renderReminders` (`main:2443`) redraws R1 and R5 together.
R4. **Pending (yesterday's unplaced order)** (`pendingSuppliers` `reminders.js:65`, `checkPendingOnce` `main:2511`):
checked ONCE per page load (latched). Stock jotted down with nothing ordered is not an unplaced order; a draft from
before the app recorded days falls back to its own timestamp; several come back oldest first; a future stamp never
fires it. **spec** `orders-reminders`, `order-day`.
R5. **The pending banner** (`renderPending` `reminder-view.js:68`) has four answers: «placed on that day» (records with
`alreadySent`, X9), «it's today's» (`keepAsToday` `main:2554`), «for the next order» (`keepForNextOrder` `2561`, only
when today is not an order day, `nextOrderOffer` `order-day.js:128`), «discard» (`discardPending` `main:2587`).
R6. **Rollback on failure**: `restamp` (`main:2569`) writes only `days.<id>`; a failure restores the stamp and says so.
R7. **Untold changes** (`untoldChanges` `untold-changes.js:140`, `renderUntoldChanges` `main:2472`): after an order list
was sent today, an ingredient ADDED or a quantity RAISED is reported (with the difference); lowered or unchanged says
nothing; a row raised AFTER it was ordered is separated. ⚠️ Silence when nothing was sent and nothing ordered today;
quiet by itself once recorded and cleared, or once the list is sent again. `confirmedEntries` is THE rule
(`untold-changes.js:89`); the highest list of the day wins (`askedToday` `46`). **spec** `untold-changes`.
R8. **Not for «for later» suppliers** (`notForLater`, D5).
R9. **The untold banner** (`renderUntold` `untold-view.js:33`): for a manager it opens the supplier; for an employee it
is plain text with a «send again» button when they may resend (`untold-view.js:40-91`).
R10. **Calendar alerts** (`computeAlerts` `notifications.js:94`): «order to place today» (grouped, each line with
when they deliver), a public holiday within 7 days (`notifications.js:120`), a holiday landing on a supplier's delivery
day within 14 days (`CONFLICT_WINDOW_DAYS` `36`, `139`). The country decides the calendar (`venueCountry`
`main:1385`); `country = null` means no calendar (`notifications.js:90-93`). **spec** `notifications`.
R11. **The bell** (`renderAlerts` `notifications.js:237`, `showAlerts` `main:1389`): the panel lists them; only
calendar alerts can be dismissed, stored per phone in `localStorage['orders-alerts-dismissed']` and pruned by date
(`alert-dismissal.js:20-94`, `DISMISSED_KEY` `80`); with everything dismissed a small pill reopens them. **spec**
`alert-dismissal`.
R12. **Browser notifications** for new alerts when permission was granted (`maybeNotify` `notifications.js:173`), and
the per-phone switch (`renderNotificationSettings` `notifications.js:293`). Findings F-6, F-7.
R13. **Holidays**: GB fetched from `https://www.gov.uk/bank-holidays.json` (CSP `orders.html:36`) and cached as
`uk-bank-holidays`, with a built-in fallback (`holidays.js:30-44`, `refreshHolidays` `110`), fetched only after auth is
ready (`main:2871-2873`); Italy computed (Easter by the Gauss/Meeus rule, `easterSunday` `holidays-it.js:64`,
`italianHolidays` `108`). **spec** `holidays`, `holidays-it`. Finding F-8.

## Reminders: Order lists and who is away

R14. **An order list** (`order-requests/<id>`): somebody sends the order INSIDE the app to whoever runs the place
(`sendListToManagers` `main:1433`, `buildOrderRequest` `order-request-model.js:70`): `date, fromUid, fromName,
quantities, units?, names, supplierOf, supplierNames, done: {}, note, createdAt, updatedAt`. Lines at 0 never reach the
manager; an empty list does not exist; names and suppliers are frozen; capped at 500 lines (`MAX_LINES` `27`), said
before the rules refuse. **spec** `order-request-model`.
R15. ⚠️ **Nobody may send a list in somebody else's name** (`rules:1324`); it is born with no ticks (`rules:1352`).
The sender is named by first + last name from the roster, else the email, else «someone», NEVER the raw uid
(`senderName` `order-request-model.js:43`; `getOwnMemberRow` `firebase-orders.js:557`, which can never stop the send,
`main:1454-1455`).
R16. **The lists button** in the header (`renderListsButton` `main:1673`) with the count of waiting lists, hidden when
`orderLists` is off.
R17. **Before sending, the away warning** (`confirmIfNobodyIsListening` `main:1488`): if everyone who would be told
is away (`getRosterOnce`, `getAwayDaysOnce` `firebase-orders.js:614-626`; `nobodyWillBeTold` in the `away-model`
port), it asks first; ANY failure → send anyway. The status then says the list went to the managers (`main:1475`).
R18. **The list of lists** (`buildRequestListScreen` `order-requests.js:75`, `requestCard` `53`): the bounded listener
of the last 120 by `createdAt` desc (`REQUEST_LIMIT` `firebase-orders.js:487`, `watchOrderRequests` `499`); the screen
shows 15 days (`REQUEST_WINDOW_DAYS` `order-request-model.js:32`, `splitRequestsByAge` `252`).
R19. **A list** (`buildRequestScreen` `order-requests.js:183`, `itemRow` `124`): grouped by supplier
(`groupRequest` `order-request-model.js:171`), each line ticked as bought (`tickRequestItem` `main:1628`,
`setOrderRequestDone` `firebase-orders.js:530`, ONE key merged at a time); what is now in the draft beside it
(`liveDifference` `231`). ⚠️ The only update the rules allow is `done` + `updatedAt` (`rules:1367`).
R20. **«Finished» is deduced from the ticks, never stored** (`isRequestDone` `order-request-model.js:142`): a tick
that is not exactly `true` does not count; a tick on a line that is gone cannot finish a list. `confirmFinish`
(`order-requests.js:286`) ticks every line.
R21. **Delete only for owner / manager** (`order-requests.js:262`, `confirmDeleteRequest` `295`; `rules:1381`): a list is
work not yet done, so deleting it means the ingredients are never bought.
R22. **The push**: `notifyOrderRequest` (`functions/index.js:445-475`) buzzes ONLY owners and managers, never the
sender, never a phone that muted order lists (`muteOrderRequests === true`), never someone away; a failed role read
means do not send (`functions/index.js:406-443`). The title names the sender and the venue (`orderRequestNotification`
`functions/push-model.js:185`); a tap lands on `./orders.html`. **spec** `order-request-notify`.

## Management: Settings of this page (`management.js`)

M1. **One Settings panel, open to everybody; each control gated on its own** (`management.js:13-18`, `isAdmin = true`
at `39`; the footer button `main:2820-2824`). Sections (`render` `management.js:97`): Order lists (boss only), The order
screen, Week start (boss only), How orders are sent (boss only), Alerts (this phone), More (History, history days,
Help). A section with no rows is not drawn (`section` `136`).
M2. **Every switch saves on the tap**, optimistic, «Saved ✓» for 2 s that survives the redraw the save causes
(`savedChip` / `markSaved` `management.js:44-72`), put back with the reason said when the write is refused
(`switchRow` `162`).
M3. **«Show the Stock box»** for every phone (`config/orders.showStock`, `buildStockSwitch` `management.js:230`):
⚠️ shown to everybody, flipped only by the owner or a manager; for everybody else it is disabled with the line «Only an
owner or a manager can change this.» (`orders.onlyOwnerOrManager`, `js/i18n.js:671`, Italian `3740`) linked by
`aria-describedby`, and stays disabled after a save attempt (`management.js:193-194`, `189`). Paid for on 13 Oct 2026:
the shared lab tablet (an employee) tapped it and it sprang back. **spec** `orders-stock-switch-locked`.
M4. **«Days of past orders»** (`buildHistoryDaysField` `management.js:344`): 1–365, saved on `change` not per keystroke,
refused (not stored) when empty or out of range, the line «older orders are never deleted»; locked for employees
the same way (`management.js:350-352`, `374`). **spec** `orders-stock-switch-locked`, `orders-config`.
M5. **Week start** (`buildWeekStart` `management.js:261`): a select of the short weekday names, value checked before
the network (`isValidWeekStart`); boss only. Decides «this week» on Incoming (V2).
M6. **Roads** (`buildSendRoutes` `management.js:303`): one switch per road (manager only while order lists are on),
the last road cannot be closed (said), judged on the roads staff REALLY have; boss only. **Order lists on/off**
(`buildOrderListsSwitch` `207`): refused when lists are an employee's only road (`listsAreTheOnlyRoad`).
M7. **Mute order lists on this phone** (`buildMuteOrderRequests` `management.js:247`; `fcm-tokens.<token>.muteOrderRequests`,
`rules:2756-2772`): silences the buzz, never the work; a property of the phone, not the person.
M8. **The supplier order** (`openSupplierOrder` `main:2662`): a drag list of the active suppliers, saved as
`config/orders.supplierOrder` (≤ 300 ids, `normalizeSupplierOrder` `supplier-order.js:14`); boss only. **spec**
`supplier-order`.
M9. **Help** door (`showHelp('orders')`, `management.js:130`).
M10. **`config/orders`** (`normalizeOrdersConfig` `orders-config.js:38`): `showStock` (only an explicit false hides),
`historyDays`, `sendRoutes`/`preferredRoute`, `orderLists` (default on), `weekStartsOn`, `supplierOrder`; read by every
member, written only by `canManage(lid, 'orders')` (`rules:1746-1747`); keys whitelisted (`rules:1750-1778`). Saved by
merge (`saveOrdersConfig` → `saveDoc` `main:2659`). **spec** `orders-config`.
M11. **Local-first config**: the last config is cached in `localStorage['orders-config']` and applied before the
snapshot (`CONFIG_KEY` `main:209`, `readCachedConfig` `211`, `applyOrdersConfig` adds the `hide-stock` class `237`,
`watchOrdersConfig` `246`).
M12. **Away days are set from Home**, not here; Orders only reads them (R17).
M13. **Hold-to-zoom and the help button** are page scripts (`js/pages/orders.js`); in Mise 2 the shell's «?» help and
«Scrivi a Claude» cover every screen (decision F7).
M14. **The page feeds the kiosk's rest screen**: on `kiosk-rest-info` it sets `detail.live = true` and pushes «to order»
and «arriving» lines from the data it already holds (`main:2992-3003`, `kioskSectionsFromData` `kiosk-lines.js:52`,
max 4 suppliers `15`) — no read, no render. So **yes, the Orders page uses kiosk lines**; the kiosk itself is step 3g,
and in Mise 2 the shared Orders data layer should answer the same question. **spec** `kiosk-rest-orders`.

## Findings — things found while reading, not decided

F-1. **Hard-coded English on the clear picker**: `actionLabel: 'Clear'` (`main:2294`) is not a dictionary key; an Italian
venue reads «Clear».
F-2. **`AHEAD_DAYS` / the horizon has no effect** in `pendingDeliveries` (`deliveries.js:123-124`: both branches push to
`coming`), although the test «the horizon is a week, and it is exported so the screen cannot disagree» exists.
F-3. **Email counts as sent without checking the window opened** (`send-chooser.js:140-142`), unlike the WhatsApp roads
(`sendTexts`, X24). A blocked pop-up records an order as sent by email.
F-4. **The road chooser dialog has no `role="dialog"`, no Escape, no focus trap** (`send-chooser.js:81-105`), unlike
`modalShell` in the same file (`254`); the `one-send-arrow` test says so («which the chooser it copies does not»).
F-5. **The flat message format sorts with `localeCompare`**, not the numeric `compareLabels` (`order-text.js:157`,
`66`): «25 kg» before «5 kg».
F-6. **English words inside alerts**: `nextDeliveryLabel` returns `'tomorrow'` or the English weekday
(`notifications.js:78-89`), poured into an Italian banner; holiday texts get the raw ISO date
(`notifications.js:133-134`) — whether the dictionary formats it was not checked.
F-7. **Browser notifications fire for dismissed alerts too**: `maybeNotify(alerts)` is called with ALL alerts, not the
visible ones (`notifications.js:279`).
F-8. **The UK fallback list stops at 2026** (`holidays.js:40-43`): offline before the first fetch in 2027, no UK
holiday is known.
F-9. **History re-sends always use WhatsApp** (`history.js:45-52`, `main:1309`), even where only email is open —
already an open question in the code (decision F8).
F-10. **`note` exists on an order list but no screen fills it** (`order-request-model.js:70-126`, rules allow 500
characters).
F-11. **Escape on «Did it all arrive?» opens the missing picker**: the dialog's cancel label is «Something missing»
(`deliveries-view.js:111-115`), so Escape — meant as «not now» — leads into marking lines missing.
F-12. **Nothing is ever deleted automatically**: order records and order lists stay for ever (P13 section).
F-13. **Deliveries and suggestions see only 2 months**: an order older than that never appears in the debt (V7), by
design but unsaid on screen.
F-14. **The road chooser counts on `overlay.remove()` before `take()`**, so a slow `beforeSend` refusal leaves no
dialog on screen while it decides (`send-chooser.js:86-88`); harmless today because the check is synchronous.

## Decisions

### For Federico (they change what a screen shows or does)

- **F1. The plan** — the slices below, their order and sizes. *Open.*
- **F2. A supplier with NO order days gets a 7-day choice — ALREADY DECIDED (difference).** Today such a supplier has
  no day line at all unless a past or later stamp exists (D6: `dayChoices` offers `today` only). In Mise 2 its day
  line always shows seven options: «Oggi», «Domani», then weekday + date for the next five days (e.g. «Sabato 31
  ott»). Choosing one stamps `days.<id>` exactly as today (D7); a future choice makes the supplier «for later» (D5)
  and the expected delivery follows it (D8). If a past stamp with items exists, its `past` option stays at the top
  (parity, T9). Suppliers WITH order days keep `dayChoices` unchanged. The pseudo-supplier «No supplier» has no order
  days and gets the 7-day choice too.
- **F3. The record date is clamped to the day the order is sent — ALREADY DECIDED (difference made explicit).**
  Precisely: an order is recorded under `recordDay(stamp, today)` (D4) — the day line's stamp if it is today or
  earlier, TODAY if the stamp is later. So: stamped «Domani» (F2) and placed now → filed under today, the day it really
  left; the stamp only said which cycle the rows were for. Stamped yesterday and placed now (the pending banner's
  «placed on that day», X9, or an order typed yesterday and never restamped) → filed under yesterday. A record is
  NEVER filed under a day that has not come yet, so a future record cannot exist, cannot appear in Incoming before it
  was sent, and cannot be added to by a second order on its «real» day. The difference from today's code: none in the
  arithmetic (`recordDay` is kept); the difference is that with F2 a future choice becomes common, and Mise 2 must say
  it on the place-confirm screen («recorded as today, Monday 26 Oct»).
- **F4. A switch to turn off the goods-arrived check — DECIDED 29 Oct 2026 (Federico chose the three recommendations
  below: per venue, owner or manager only, off hides everything; built in 3f-5).** Some venues will not answer «did it all arrive?», and the
  debt banner then never goes quiet (V6). Questions: (a) per venue or per phone? (b) who may flip it? (c) what does
  Incoming show when it is off? **Recommended**: (a) **per venue**, a new `config/orders` key (e.g. `deliveryCheck`,
  absent = ON) — it changes what everybody sees and what the kiosk shows, so a per-phone switch would leave two
  phones disagreeing about what is owed; (b) **only owner or manager**, shown to everybody and locked with «Only an
  owner or a manager can change this.» exactly like M3 (rules: one more whitelisted key under the existing
  `canManage` write, deploy rules first); (c) **off hides the Incoming tab, its badge, the debt banner and the reorder
  button, and the kiosk «arriving» lines**; the tab bar disappears (Order only); nothing is deleted, `deliveredAt` /
  `missing` already written stay; turning it back ON counts the debt only from the day it was turned on (store
  `deliveryCheckFrom: 'YYYY-MM-DD'` with it), otherwise months of unanswered orders would flood the banner the moment
  it comes back.
- **F5. The two Orders settings locked for employees — ALREADY DECIDED (parity #355, kept).** «Show the Stock box» and
  «Days of past orders» stay visible to everybody, disabled for employees with «Only an owner or a manager can change
  this.» (M3, M4; `management.js:237`, `350-352`; `tests/orders-stock-switch-locked.test.mjs`). Mise 2 builds it with
  `SettingSwitch` + a described-by line; the same pattern serves F4.
- **F6. Orders pickers show «Non in uso» items last — ALREADY DECIDED (difference).** Today an ingredient switched
  off (`ingredients.<id>.active === false`) is ABSENT from every Orders list (L13). In Mise 2 the supplier screen's
  rows, the flat view and the search show active ingredients first, then the switched-off food ingredients last,
  marked «Non in uso» — the same split `linkOptions({ inactiveLast: true })` already makes
  (`shared/src/catalogue-model.ts:238`, `271`; packaging never). They can be typed into like any row (T10). Reminders,
  untold changes and the kiosk keep ignoring them (R2) unless a quantity is typed.
- **F7. Every screen gets the shell-level «?» help and «Scrivi a Claude» — ALREADY DECIDED.** The page's own help door
  (M9) becomes the shell's help with the Orders content.
- **F8. History «send again» uses the chooser — OPEN (F-9).** Today it is always WhatsApp. **Recommended**: the same
  chooser as the send arrow, so a venue on email re-sends by email; the record is not re-recorded.
- **F9. How long Orders data is kept — OPEN (P13).** Today nothing is ever deleted (F-12). **Recommended**: keep order
  records (business records, no person in them) as today; delete order lists 12 months after they were sent with a
  scheduled clean-up — a separate S task after 3f, flagged because a scheduled function costs a little (P14).

### Technical (taken with the recommended option; listed for him at the end of each slice)

- **T1. Addresses and Back.** `/orders` (the supplier list), `/orders/flat`, `/orders/supplier/<id>`,
  `/orders/supplier/<id>/items`, `/orders/supplier/<id>/confirm`, `/orders/summary`, `/orders/place-all`,
  `/orders/clear`, `/orders/send`, `/orders/incoming`, `/orders/incoming/<recordId>` (the missing picker),
  `/orders/reorder`, `/orders/lists`, `/orders/lists/<id>`, `/orders/history`, `/orders/history/<recordId>`,
  `/orders/settings`, `/orders/settings/supplier-order`. Back goes ONE level up (P20); the split from 1000 px keeps the
  list beside the supplier.
- **T2. The draft data layer** is ported first and kept byte-compatible: the merge write of changed keys only (L32),
  the detached baseline (L34), `pending` re-applied over snapshots (L35), the empty-string clears (L36), 800 ms
  debounce + flush (L33). Parity spec: the current app's `orders-archive` and `draft-override` tests re-stated against
  the TS data layer with a fake Firestore.
- **T3. Local-first (P20)**: typing is saved to Firestore's offline cache at once and synced in the background, as
  today; placing stays refused offline (X3) — a record and a clear must happen in one connected moment.
- **T4. One listener per collection** across the Orders screen tree, shared with the Suppliers source where the
  documents are the same (P14). History stays bounded (H8); order lists stay limited to 120 (R18).
- **T5. Placing is a sequence in the data layer, not in a screen**: confirm → sent-check → flush → transaction →
  forget → clear, with the point of no return (X5) in one function, specced with a fake that fails at each step.
- **T6. One error boundary per page part** (list, banners, bell, Incoming) — the requirement behind L7.
- **T7. Fix the findings in the port, not in the current app**: F-1 (dictionary key), F-3 (email counted only when the
  window opened), F-4 (the chooser on the shared `Dialog`), F-5 (`compareLabels`), F-6 (dictionary words, formatted
  date), F-7 (notify only the visible alerts), F-11 (Escape = close, nothing marked). Each said in the slice's list.
  F-2: keep the behaviour (every pending order shown), drop the dead constant.
- **T8. Holidays**: the gov.uk fetch stays (CSP `connect-src` already allows it in the current app; Mise 2's CSP must
  add it); the fallback list is extended to 2027 when ported (F-8).
- **T9. The day line options** (F2): built by a new pure function beside `dayChoices` in the `order-day` port, with its
  own spec; `past` kept when it applies.
- **T10. A switched-off ingredient with a quantity** (F6) is ordered, placed and recorded like any other line; placing
  already includes inactive lines (L13).
- **T11. The order picture** is drawn on a canvas in the browser as today; `layoutOrder` is ported (pure), the canvas
  drawing stays a screen helper.
- **T12. Browser notifications** (R12) are kept per phone as today; push for calendar alerts is not added.
- **T13. The kiosk feed** (M14): the Orders data layer exposes `kioskSectionsFromData` over the data it holds; the
  kiosk wiring itself waits for 3g.

## Personal data (P13)

- **Order lists — the sender's name and uid.** `order-requests.fromUid` + `fromName` (first + last name from the roster,
  else the email address, `senderName` `order-request-model.js:43`) on every list. Where: `locations/<lid>/order-requests`.
  Kept: for ever (deleted only by an owner or manager, by hand, R21); the screen shows 15 days, Home reads 30.
  Finding: an email address can end up as `fromName` when a member has no name on the roster.
- **The push of an order list names the sender** (and the venue) in the notification title, on the managers' phones
  (`functions/push-model.js:185-205`). Kept: on the phone, by the operating system.
- **The roster** (`members/<uid>`: `email, firstName, lastName, joinedAt`) is READ by Orders to name the sender and to
  warn when everybody is away (`getOwnMemberRow`, `getRosterOnce`); Orders stores none of it except `fromName`.
- **Who is away** (`away/<uid>`: `uid, until, updatedAt`) — a member's holiday date, written from Home, read by Orders
  and by the push function. Kept: until overwritten (`until: ''` clears it); never deleted automatically.
- **Phones that muted order lists** (`fcm-tokens/<token>.muteOrderRequests`, with `uid`) — written from Orders
  Settings (M7). Kept: as long as the token.
- **Supplier contacts** (`suppliers.phone`, `.email`) are used to open `wa.me/<digits>` and `mailto:` — business
  contacts, but a sole trader's phone is a person's number; it travels in the address handed to WhatsApp or the mail
  app (the order text too). Nothing new is stored.
- **No person in the order record, the draft, deliveries or History**: `orders-history` and `drafts/current` carry no
  uid and no name (who placed or confirmed a delivery is not recorded). Kept: for ever, deletable by any member.
- **This phone only**: `localStorage['orders-config']`, `['orders-alerts-dismissed']`, `['uk-bank-holidays']` — no
  personal data.
- Not verified: whether Orders' usage events (the app-wide statistics) carry anything beyond screen names.

## Shared ports needed

Each a `shared/src` module, paired (its spec runs against the `js/` original and the port) unless marked; a partial port
keeps in its header the list of what it leaves out.

- **Small helpers first**: `day` (full; `WEEKDAY_LONG` stays English data, the words through the app's dictionary),
  `order-day` (full) + the new 7-day options (F2, Mise 2 only, marked so), `memo` (full, or React's `useMemo` with the
  same key — T), `supplier-order` (full), `orders-config` (full), `no-supplier` (full), `line-supplier` (full),
  `ingredient-search` (partial → full: `letterOf`, `matchesQuery`, `flatRows`, `orderSummary`), `reminders` (full),
  `sent-check` (full).
- **The record**: `archive` (full: `wholeNumber`, `historyDocId`, `isLegacyRecord`, `recordDate`, `ingredientsOf`,
  `supplierHasItems`, `buildSupplierArchive`, labels, `quantityPathsFor`, `changedEntries`, `changedDays`,
  `mergeArchives`, sends, `withCorrection`, `recordSends`, `sendSections`, `unitConflicts`, `splitHistoryByAge`,
  `groupHistoryByDay`), `history-window` (full but `createOlderLoader`, which becomes the data layer's).
- **The rest**: `suggestions` (full), `order-text` (full), `send-routes` (full), `untold-changes` (full),
  `deliveries` (full), `alert-dismissal` (full; storage injected), `holidays-it` (full), `holidays` (partial: the
  calendar lookups; the fetch and the cache are the data layer), `notifications`' `computeAlerts` + `isReminderDue`
  (partial), `order-request-model` (partial → full), `kiosk-lines` (full), `order-image`'s `layoutOrder`,
  `parseBold`, `plainLines`, `imageFileName` (partial), `send-chooser`'s `offerFor`, `sendOffers`, `digitsOf`,
  `mailto`, `settleOnce`, `afterShare` (partial).
- **Not ports** (rewritten as screens + data layer): `orders-main.js`, `draft.js` (data layer, T2), `firebase-orders.js`
  (the parts above), `suppliers.js`, `supplier-detail.js`, `ingredients.js`, `ingredient-list.js`, `preview.js`,
  `supplier-picker.js`, `place-confirm.js` (its rule, `confirmedRows`, is in `sent-check`), `sent-check-dialog.js`,
  `untold-view.js`, `reminder-view.js`, `deliveries-view.js`, `history.js`, `history-edit.js`, `order-requests.js`,
  `management.js`, the render scheduler.

## Proposed slices

Step 3f is about 12 000 lines of the current app. Eight slices, each **S or M**, each its own branch and stacked PR,
each ending in something that works alone on the preview (the current app shares the database, so what one slice does
not yet show is still there in the current app). Every slice: shared ports with specs against both files, the data
layer by the main session, the screens by the builder, driven on the emulator in English and Italian at 1024 / 360 /
296 px, axe, code review, PR.

1. **3f-1 — The order list and the shared draft (M, one session).** The person can open `/orders`, see the active
   suppliers in the venue's order with Favourites and «No supplier», search, filter «Ordering», open a supplier and
   type quantities, stock and units that every other phone sees live — saved local-first. Items L1–L16, L18,
   L22–L26, L31–L37, L40–L41, D1–D2 (the stamp only), M10–M11, F6, and L38's READ side (a line another phone moved to
   another supplier is drawn under that supplier; moving one is 3f-5's). The flat view (L17) and the summary (L19)
   moved to 3f-8 to keep this slice to one session. Ports: `orders-config`, `no-supplier`, `supplier-order`,
   `line-supplier`, `ingredient-search` (rest), `archive` (the change-detection half: `wholeNumber`, `quantityPathsFor`,
   `changedEntries`, `changedDays`, `ingredientsOf`, `supplierHasItems`), `day`, `order-day` (full). Data:
   `drafts/current` watch + merge write (rules unchanged), reuse the suppliers source. Order: specs → data layer →
   screens → drive → review.
2. **3f-2 — The day and placing an order (M).** The day line (with F2, F3), place-confirm, the sent-check (Yes /
   Cancel; «Send it now» arrives in 3f-3), the record transaction, clear quantities, place-all, the suggestion hint and
   the unusual warning. Items D3–D9, X1–X14 (not X4's send-now), H1–H4, L27–L29, L38–L39. Ports: `order-day` (rest + new
   options), `archive` (rest), `sent-check`, `suggestions`, `line-supplier`. Data: `orders-history` transaction, draft
   clears.
3. **3f-3 — Sending (M).** The send arrow, the road chooser, WhatsApp text and picture, per-supplier WhatsApp, email,
   «Send it now», the unit-conflict check, record-after-send. Items X4 (send-now), X15–X25. Ports: `order-text`,
   `send-routes`, `order-image` layout, `send-chooser` (pure half). Data: none new.
4. **3f-4 — History (M).** The History door, the live window and older pages, legacy record, send sections, send again
   (F8), the editor and delete. Items H5–H12. Ports: `history-window`. Data: bounded history read, server-only older
   pages, replace / delete.
5. **3f-5 — Incoming (M).** The Incoming tab and badge, «did it all arrive?», the missing picker, the debt banner,
   «Da riordinare» with put back / another supplier / resolved, and the goods-arrived switch (F4). Items V1–V11, L38's
   writer. Ports: `deliveries`. Data: `confirmDelivery` patch, `missingResolved` merge; rules: the F4 key (deploy rules
   first).
6. **3f-6 — Reminders and the bell (M).** Today's orders, the pending banner and its four answers, untold changes,
   calendar alerts with holidays (GB fetched, IT computed), dismissals, browser notifications. Items R1–R13. Ports:
   `reminders`, `untold-changes`, `notifications` (alerts), `alert-dismissal`, `holidays`, `holidays-it`. Data: the
   gov.uk fetch and its cache.
7. **3f-7 — Order lists (M).** Send to the manager, the away warning, the lists button, the list of lists, ticks,
   finish, delete for managers, the mute switch. Items R14–R22, M7. Ports: `order-request-model` (rest); `away-model`
   and `push-model` already there. Data: `order-requests` create / tick / delete, roster and away reads.
8. **3f-8 — Settings and the rest (S).** The Settings panel with the locks (F5), week start, roads, order lists switch,
   history days, the supplier order drag, Help (F7), the flat view's swap, the tablet summary and money, the add / edit
   ingredient doors, the kiosk feed hook (T13). Items L17 (the flat view and its swap), L19 (the summary), L20–L21, L30, M1–M9, M12–M14. Ports: `kiosk-lines`.
   Data: `config/orders` merge writes (rules unchanged).

## Tests read

Titles read for all; bodies read where I name behaviour. All under `tests/`.

### The order list and the draft

- `orders-archive.test.mjs` — whole quantities, no Infinity, only changed rows sent, looking stores nothing, zero is a
  change, stock-only is a change, day stamps, `historyDocId`, `ingredientsOf` active filter, `supplierHasItems`.
- `draft-override.test.mjs` — the per-line override in the one merge write, cleared with its quantity, placing clears it.
- `draft-freeze-unit.test.mjs` — a card's unit change freezes the old unit on typed lines.
- `line-supplier.test.mjs` — override rules, signature, fall-backs, «No supplier» lines.
- `ingredient-search.test.mjs` — «No supplier» filing, accent-free search, letters, supplier filter by name and category.
- `orders-memo.test.mjs`, `orders-render-scheduler.test.mjs` — the memoised lens and the per-part draw.
- `orders-ingredient-rows.test.mjs`, `orders-unit-choice-data.test.mjs`, `order-unit.test.mjs` — the row, the unit select.
- `orders-ingredient-sticky-search.test.mjs`, `orders-sticky-focus-and-observers.test.mjs` — sticky head, frozen filter,
  observers ended.
- `orders-favourites-and-shortcut.test.mjs`, `orders-list-readability.test.mjs`, `orders-layout.test.mjs`,
  `orders-sort-by-label.test.mjs`, `orders-order-summary.test.mjs`, `orders-supplier-items.test.mjs`,
  `supplier-detail-builds.test.mjs`, `supplier-order.test.mjs`.
- `orders-tablet-layout.test.mjs`, `orders-tablet-display-pairs.test.mjs`, `tablet-width.test.mjs`, `order-cost.test.mjs`,
  `line-unit-cost.test.mjs` — the tablet split and the money.
- `orders-add-ingredient.test.mjs`, `orders-edit-ingredient.test.mjs` — the card's doors from Orders.
- `orders-config.test.mjs` — defaults, explicit false, the history window capped, order lists default on.
- `live-data-lost.test.mjs` — the stream-lost message asks `t()` late.
- `suggestions.test.mjs`, `suggestions-index.test.mjs` — the suggestion and the unusual warning.

### The day, placing, sending

- `order-day.test.mjs` — the day rule, `stampFor`, `nextDeliveryAfter`, `recordDay`, «for later».
- `orders-day.test.mjs`, `day-words.test.mjs` — local dates, DST, «Today»/«Yesterday», spelled dates.
- `place-confirm.test.mjs` — confirmed numbers recorded, zeros, caller untouched, «asked» per supplier.
- `order-sent-check.test.mjs` — the three answers, «Send it now», only reached suppliers recorded, the dialog.
- `same-day-sends.test.mjs` — adding in packages, sends, legacy sends, History sections, corrections.
- `send-routes.test.mjs`, `send-chooser.test.mjs`, `one-send-arrow.test.mjs` — roads, the chooser, the one arrow, share
  only files, clipboard.
- `order-text.test.mjs`, `order-language-callers.test.mjs`, `order-cost-message.test.mjs`, `order-image.test.mjs`,
  `order-prefill.test.mjs` (Calculator prefill — read for the shared text rules only).

### History, Incoming, reminders, order lists, settings

- `history-window.test.mjs`, `history-bounded-read.test.mjs`, `history-wiring.test.mjs`, `history-stacking.test.mjs`.
- `deliveries.test.mjs` — the week, the debt, delivered stamps, expected days. `reorder-list.test.mjs` — the reorder
  screen, its three buttons, focus and Escape.
- `orders-reminders.test.mjs`, `untold-changes.test.mjs`, `notifications.test.mjs`, `alert-dismissal.test.mjs`,
  `holidays.test.mjs`, `holidays-it.test.mjs`.
- `order-request-model.test.mjs`, `order-request-notify.test.mjs`, `away-model.test.mjs`, `home-away.test.mjs`.
- `orders-stock-switch-locked.test.mjs` — the two locks (F5). `work-week.test.mjs` — the week start.
- `kiosk-rest-orders.test.mjs` — the page as the kiosk's live source (the other `kiosk-*` tests are step 3g).
- Cross-cutting: `run-in-order.test.mjs`, `store-notify-guarded.test.mjs`, `preconnect.test.mjs`,
  `screen-gutter.test.mjs`, `mise2-isolation.test.mjs` (no double curly brace or curly-percent in docs).

## Step 3f-1 as built — the order list and the shared draft

Items L1–L16, L18, L22–L26, L31–L37, L40–L41, D1–D2 (the stamp only), M10–M11, F6 and L38's read side. Rules unchanged: the
current app already reads `suppliers`, `ingredients`, `config/orders` and `drafts/current` and writes the draft's merge.

**Shared.** Ported in `bc7c1275`: `send-routes`, `supplier-order`, `orders-config`, `line-supplier`, `order-text`,
`ingredient-search` (full), `day` and the no-supplier helpers (adapted), `order-day` (full), `archive` (the change-detection half).

**Data.** `orders/ordersSource.ts` (four listeners while the section is on screen, one merge write; NO prices — the money line is
3f-8 and an employee must not load them), `orders/draftSync.ts` (the port of `draft.js`: changed keys only, unsent typing laid over
every snapshot, 800 ms, `flush`), `orders/ordersStore.ts`, `orders/ordersLens.ts`, `OrdersContext.tsx`; fake
`testing/fakeOrdersSource.ts`, handed out by `DataServices`.

**Screens.** `/orders` (the supplier list: search, the «Ordering» filter, Favourites, «No supplier», the count and the «for later»
tag), `/orders/supplier/<id>` (the rows: Order box with − / + and ×, the unit menu only when the card offers a choice, the Stock
box, «Not in use» folded at the foot, the «What they sell» button) and `/orders/supplier/<id>/items` (read-only). From 1000px the
supplier opens beside the list.

**Differences from the current app, on purpose (tell him):**
- O1. **Lines switched off («Not in use») are on the supplier's screen**, last, in a folded group that opens by itself when one of
  them has a quantity (F6, T10). The current app leaves them out of Orders altogether.
- O2. **Leaving the section sends unsaved typing at once** (`stop()` flushes the 800 ms pause). The current app can lose the last
  keystrokes when the page is left inside the pause.
- O3. **A box that has the focus is never rewritten by another phone**; it picks up the shared value when the finger leaves it.
- O4. **No copy of `config/orders` in this phone's storage** (T14): Firestore's offline database already answers at once.
- O5. **Moved to later slices to keep this one to a session**: the flat view (L17) and the tablet summary (L19) → 3f-8; the day
  line and placing → 3f-2; the supplier name as a door to its card → 3f-8. No progress bar.
- O6. **Back to 0 before the pause saves nothing for that line**: an empty line and 0 are the same thing (L26), so no write
  carries a zero for a line that was never saved.
- O7. **The shared order sends only the fields this phone changed, and lets go of a line put back** (`draftSync.ts`). What
  this phone claims is recomputed at every change as what differs from the server, field by field, and is what a save
  sends; a snapshot that agrees releases it (not while a write is in the air, so a refused write keeps the typing, L37).
  Quantity, unit and the «this time» supplier are ONE meaning and always travel together, `''` included (sent apart, a
  colleague switching the unit or moving the line in the same second turned «5 buste» into 5 of the card's unit); the
  stock goes on its own. After leaving the section the busy marker waits only for writes in the air, so a refused
  change cannot block the phone's self-started reloads for good.
  Three holes of the current app's `draft.js` that this closes, each able to bring back quantities of an order another
  phone had just placed: the claims only grew (a line corrected back inside the pause, or typed to the value another
  phone had just written, came back and was re-sent with the next keystroke); whole rows were sent (a stock count
  re-asserted this phone's copy of the quantity); and the waiting save kept the DAYS map of the keystroke
  (`orders-main.js` replaces `state.days` on each snapshot, so a stamp another phone's placing deleted is written back —
  the entries map is refilled in place there, so quantities are not affected by this last one). Found driving and
  reviewing 3f-1; the current-app fixes are their own branch.

**P13.** This slice stores no personal data: the draft holds no person. Order lists (3f-7) store the sender's name — flagged
before that slice is built.

## Step 3f-2 as built — the day and placing an order

Items D3–D8, X1–X3, X5–X14 (not X4's «Send it now», 3f-3), H1–H4, L27, L38–L39, and F2 and F3. Moved to **3f-2b**, to keep
this one to a session: the suggestion hint «Suggested: N», the stock filling the suggestion and the «much more than usual»
warning (L28–L29's hint side, `suggestions`). Rules unchanged: the current app already writes `orders-history` in a
transaction and clears the draft with `deleteField`. F4 (the goods-arrived switch) is not needed by this slice.

**Shared.** In `cd1a4f99`: `archive` (the rest: the supplier record, `mergeArchives`, the send ids and their cap, the unit
conflicts, `isUnitConflict`), `sent-check` (full), `untold-changes` (`confirmedEntries` only) and `order-day-choices`
(new, F2: `weekChoices`, `hasOrderDays`).

**Data** (`561174cf`). `ordersSource.ts`: `clearDraft` (dotted paths with `deleteField`), `readRecord`, `recordOrder` (a
transaction). `draftSync.ts`: `forget` (a placed or cleared line leaves the pending claims, the baseline and the shown copy
together, so no later save can bring it back). `ordersStore.ts`: `setDay`, `checkRecords`, `place`, `clearQuantities`, and
`placing` in the snapshot. One placing, in order: send the waiting typing → record what was CONFIRMED in a transaction
(adding to the same day's record) → forget the lines locally → clear them from the shared order. After the record nothing
may say «not saved»: a refused clear is said as «recorded, but the lines are still there».

**Screens** (`8356d31f`, `31b2ae15`). The day line under a supplier's bar; `/orders/supplier/<id>/confirm`, `/orders/place-all`
(the picker) and its confirm, `/orders/clear` (the picker for «Clear quantities…»).

**Differences from the current app, on purpose (tell him):**
- P1. **Suppliers without order days, and «No supplier», get seven days to choose from** (F2): Today, Tomorrow, then the
  weekday and its date. The current app offers today only. The expected delivery is under the line.
- P2. **An order stamped for a later day is recorded under today, and the confirm screen says so** (F3: «recorded as today,
  <date>»), instead of silently.
- P3. **The confirm screen stays open on Cancel at the sent-check**, with the corrected numbers, so nothing typed is lost.
  Leaving it with corrections asks «Discard the changes?» first (P20).
- P4. **A supplier already recorded leaves the confirm screen** of a place-all that failed half-way; when nothing is left the
  screen goes back by itself.
- P5. **The same day's record is read once when the confirm screen opens**, not watched live: the note «adds to the order
  already recorded» comes from that read, and the transaction adds safely whatever happened since.
- P6. **The status messages after placing stay 8 seconds** (errors and warnings), so they can be read on a tablet across the
  bench.
- P7. **The day line scrolls away; the bar and the column names stay** (the names' `top` is the bar's measured height): stuck with them, on a
  phone it took half the screen from the rows. On the confirm screen, under 480px, a name has its own line over its box.
- P8. **Italian «a Alpine Mills»**: a supplier's name takes no article, so the preposition stays plain.
- P9. **Placing never clears a line it did not record** (found in the review of 3f-2): a line that was not on the confirm
  screen and has a quantity when the record lands — a colleague typed it, or moved it here, meanwhile — stays in the order
  for next time. The current app deletes it, recorded nowhere.
- P10. **A supplier gone while the confirm screen was open is said as «NOT recorded»** (as the current app does), never
  skipped in silence; and an autosave still in the air is answered before anything is recorded, so a refused one can never
  bring a placed line back.
- P11. **The confirm screen cannot be left while the order is being recorded**: its message («NOT recorded», «recorded, but
  the lines are still there») would go with it. The result goes back to the list by itself.

**Left as in the current app** (from the review, low): a refused day choice puts the previous day back with a write of its
own, which can land over a colleague's newer day in the same second.

**P13.** This slice stores no personal data: an order record holds suppliers, ingredients, quantities and dates.

## Step 3f-2b as built — the suggestion and the unusual quantity

Items L27 (the hint itself), L28 and L29, and X2's unusual warning. Rules unchanged: the current app already reads `orders-history`
with the same query (`date >=` the window's start), allowed by `canUse(lid, 'orders')`.

**Shared.** `suggestions` (full, paired) and `history-window` (full, paired: the live window, and the paging and History foot
that 3f-4 will use).

**Data.** `ordersSource.ts`: a fifth listener, `watchRecentHistory` — the last two calendar months, as the current app.
`orders/suggester.ts` (pure): ONE engine per snapshot of the records and the cards, kept in the store's snapshot and asked by the
row, the Stock box and the confirm screen alike. `ordersStore.ts`: a Stock reading may fill the Order box (below); a fill stamps
the day like typing, a reading alone never does (L28).

**Screens.** The line under a row's name: «Suggerito: N» in the accent ink, or — taking its place, never both (L29) — «Molto più
del solito (circa N)» in the danger ink; the Order box is described by it. The confirm screen: «di solito circa N» under the row,
the box outlined, and «Controlla che non ci sia una cifra di troppo.» once above the suppliers while a row is unusual (a status
region present from the start); all recomputed on every keystroke.

**Differences from the current app, on purpose (tell him):**
- S1. **A Stock reading never overwrites a number typed by hand** (his decision, 28 Oct 2026). It fills the Order box only when the
  box is empty or still holds the suggestion of the previous reading — so typing a reading digit by digit follows it, and a
  number typed by hand stays, with the new «Suggerito: N» beside it. The current app overwrites the Order box at every reading.
- S2. **A reading that leaves the suggestion where the box already is writes no quantity and stamps no day** (the current app
  restamps the day at every reading while a suggestion is active, even when nothing changes).
- S3. **The confirm screen checks the unit the row SHOWS** (frozen when it opened), not the live line's unit.
- S4. **The warnings are read by a screen reader with the box** (`aria-describedby`); the current app's are visual only.

**Found in the review (tell him, low):**
- A reading that brings the suggestion to 0 on a line SENT HERE from its usual supplier puts the line back there (the «goes back
  at zero» rule of L23): the row leaves the screen under the finger. The current app does the same, more often.
- «A number typed by hand is never overwritten» holds on ONE tablet: a colleague's reading typed in the second before this
  tablet's number reaches theirs still fills their empty box, and the last write wins — as with any two people typing the same line.
- Fixed in the review: a history stream that dies is said on the status line («past orders», L5); the «extra digit» line is
  announced even when the screen opens with it; the read of `orders-history` is pinned as bounded (`ordersSource.history.spec.ts`,
  as the current app's `history-bounded-read` test).

**Left as in the current app:** «Suggerito: 0» shows when the shelf already holds the usual level; a supplier ordered monthly
seldom has 4 orders in the two-month window, so it seldom gets a suggestion (his trade-off of 4 Oct 2026).

**P13.** No personal data: the records hold suppliers, ingredients, quantities and dates.

## Step 3f-3 as built — sending an order

Items X4 («Send it now») and X15–X25: the send arrow, the road chooser, the message as text or picture, WhatsApp to the chat
I choose or straight to each supplier, email, the unit check at send time, and «Order sent» (record-after-send). Rules
unchanged: sending writes nothing; recording uses 3f-2's `orders-history` write.

**Shared.** `send-chooser` (partial: leaves out `chooseAndSend`, the screen) and `order-image` (partial: the layout, the colours
and the file name; leaves out the canvas, the font and the share sheet). Neither is paired in `parity.spec.ts`; each spec runs
every test against both files and compares the ported names, constants and arity with the original. `order-text` stays paired,
with one difference on purpose (F-5, below); `odd-inputs.spec.ts` compares its message with the flat list's order set aside.

**Logic.** `orders/sendFlow.ts`: the rows of a send (the list's order, a switched-off line with a quantity included — T10), the
windows of each road (matched by supplier ID, never by name), `openWindow` (answers whether a window REALLY opened), and
`takeRoad`. ⚠️ Every window opens inside a tap: the first before `takeRoad`'s first await, each further one inside the press of
its own dialog, a picture's share inside its own «Share». `ordersStore.conflictsNow`: the unit check at send time, synchronous,
from the live window of `orders-history`, never fatal. `orders/orderImage.ts`: the canvas and the share sheet.

**Screens.** The arrow «Manda» beside the search box → «Manda l'ordine» (nothing ticked at first, «Seleziona tutti i fornitori»,
«Per fornitore» / «Lista unica») → the road chooser on the shared `Dialog` (only when more than one road is open) → «Come lo
mandi?» (photo first, where the browser can share a picture) → «Ordine mandato», the confirm screen in after-send mode, whose
Back goes to the list and records nothing. The confirm screen's «Did you send it?» has a third answer, «Invialo ora».

**Decisions of this slice (his, 28 Oct 2026):**
- A. The arrow is a button with the icon and the word «Manda» / «Send».
- B. The in-app list road («manager») stays hidden until 3f-7; an employee whose only open road is that one is told no road is
  available.
- C. (F-3) An email counts as sent only when its window really opened. To check on a real phone: some mail apps open without
  the browser reporting a window.
- D. (F-4) The chooser is built on the shared `Dialog`: role, Escape, focus trap.
- E. (F-5) «Lista unica» sorts numerically («Farina 5kg» before «Farina 25kg»), fixed in the port only; `order-text.spec.ts`
  shows the one place the two files differ.
- F. The picture is drawn in Geist, Mise 2's one bundled font (the current app draws in Manrope).

**Differences from the current app, on purpose (tell him):**
- D1. **One window per tap.** A browser lets one tap open ONE window, so the current app's «email each supplier» and «WhatsApp
  straight to each supplier» reach only the first supplier on a real phone (found in the review). Mise 2 opens the first in the
  tap, then asks «Apri la chat per B (2 di 3)» for each further one, whose own «Apri» opens it; «Salta» and «Annulla» name what
  was not sent — the same pattern as the pictures. When the browser refused every window, only «Non si è aperto niente» is
  said (no second notice naming them).
- D2. **A ticked supplier the send did not reach is named** («Non inviato, ancora da fare: …»), on the send screen as after
  «Invialo ora»; the current app drops it silently.
- D3. **Nothing opened → «Non si è aperto niente»** and no record is offered (the current app offers to record a send that
  never left).
- D4. «Invialo ora» runs in a microtask after the dialog's press, as the current app: still inside the tap.

**Found in the review and fixed:** a save ending after the confirm screen had gone stepped back through the history from
wherever the person was (found driving; the screen now moves nobody once it has gone); the send screen's button locked after
a failure; focus pulled off a correctly focused button (it now goes back to «Manda» only when it was dropped on the page); a road could be taken twice by a double press; the «not reached»
sentence lost after a unit clash; tests pinning every window to its tap, the share sheet's answers, and Escape on «Did you
send it?».

**Left open (tell him):**
- «Invialo ora» is still offered on «Ordine mandato», right after a send: a second tap sends the supplier a second copy. Hiding
  it there changes what the screen offers — his call.
- The photo road to a supplier: the share sheet does not choose the chat; two suppliers with the same name get the same dialog
  title. Showing the saved number in the dialog would tell them apart.
- The send-time unit check passes in silence before the past orders have loaded once; the confirm screen's server read still
  refuses a real clash.
- To try on the tablet and an iPhone: the real share sheet, the picture, email from a real mail app, «Invialo ora» on Safari.

**Tests.** New flaky-under-load files seen in the full app run (each passes alone): Calculator logEditors, Foodcost editor,
Pastries editor.

**P13.** No new personal data: a supplier's phone and email travel only in the `wa.me` / `mailto:` link the person taps; the
picture and the logs carry no contact.

## Step 3f-4 as built — History

Items H7–H12: the door, the bounded read with older pages from the server and the legacy record, the window of `historyDays`,
the cards with their send sections, sending again (a card or a whole day), and the editor (correct, delete). Rules unchanged:
the correction and the delete write `orders-history` as the current app does (H6).

**Shared.** `archive` becomes an ADAPTED port (no longer paired): `recordedName` takes the word for a deleted ingredient as an
argument instead of reading the language; `withCorrection`, `recordSends`, `sendSections`, `splitHistoryByAge`, `countRecords`
and `groupHistoryByDay` are ported as they are. `archive.spec.ts` runs every test against both files; `odd-inputs.spec.ts`
feeds both the same odd inputs.

**Data.** `ordersSource.getOlderHistory` (`getDocsFromServer`, never the offline cache: `date < before`, newest first, 100 a
page after a cursor), `getLegacyHistory` (the records with a `weekStart`), `rewriteRecord` (one transaction: read, decide, write
or delete). `ordersStore`: the window's start is fixed once when the page starts, so the live listener and the older pages meet
exactly; `loadOlderHistory` (a second press while a page is on its way asks for nothing; a failed page keeps what was loaded
and the retry asks for the same page); `correctRecord` / `deleteRecord`, never offline, holding `markBusy` while they write; a
record in an older page (which no listener watches) is brought in step after the write. `orders/historyEdit.ts`: the editor's
rows, the record a correction writes (`correctedRecord`), and `sameOrder`.

**Logic.** `sendFlow.recordSendRows`: the rows of a recorded order sent again (the legacy record keeps its own id and the
fallback supplier name). `useSendOrder` takes `resend: true`, which skips the same-day unit check — the order was recorded
already.

**Screens.** A gear on the order list → «Impostazioni» with one door, «Ordini passati» («Mostra gli ultimi 15 giorni») →
History: the days of the window, today first, each day with two or more orders offering «Manda tutti»; the cards collapsed,
opening on the lines (with two or more sends: «Ordine · ore 9:10», «Aggiunta · ore 11:30», «Corretto · ore …», then «Totale del
giorno»), «Manda di nuovo» and «Correggi»; the days beyond `historyDays` behind «Mostra gli ordini precedenti (n)», then «Carica
ordini più vecchi» for the pages before the live window and the legacy week («Settimana intera — tutti i fornitori»). «Manda
tutti» → «Manda oggi», the send screen's body (`SendPicker`, now shared) with nothing ticked. «Correggi» → «Correggi l’ordine»:
edits on a copy, «Salva» with a confirm, Back with edits asks to discard, «Elimina questo ordine» with a confirm; after a save or
a delete, back to History. History stays mounted under the editor and the day screen, so its open cards and loaded pages are
kept; Back steps up one level at a time and hands the focus back to what opened the screen.

**Decisions of this slice (his, 29 Oct 2026):**
- A. History's door lives in a Settings screen opened from a gear on the list — where Federico moved it in the current app
  (H7). The door reads «Ordini passati» (the title of the screen it opens).
- B. (F8) «Manda di nuovo» and «Manda tutti» use the same road chooser as the send arrow, not always WhatsApp.

**Differences from the current app, on purpose (tell him):**
- E1. ⚠️ **A correction or a delete never overwrites a colleague's order.** The current app saves the edited record WHOLE: if
  another phone added a second order to that supplier after the editor opened, the save wipes it out (and a delete deletes it).
  Mise 2 checks, inside the transaction, that the stored record is still the order the editor opened (quantities, units, stock
  and sends; a delivery answer written meanwhile does not count); otherwise nothing is written and the editor says «Questo ordine
  è cambiato mentre lo correggevi…». A record deleted meanwhile is «non c’è più», and nothing is created.
- E2. A correction that leaves every line at 0 is not saved and never deletes the record: the editor says so and points to
  «Elimina questo ordine».
- E3. Correcting and deleting need the connection (they are refused at once offline, with a message): the check of E1 must read
  the server. Sending again works offline as the send arrow does.
- E4. «Salva» with nothing changed goes back to History and writes nothing (the current app adds a «Corretto» line that
  corrects nothing).

**Implementation choices (listed for him):** «Manda di nuovo» stays pressable while a send is on its way, and a second press is
ignored; the day heading reads like the order list's day line («Oggi», «ven 9 ott 2026»), the day screen's title says it in
words («Manda oggi»); a record whose supplier is unknown takes the fallback supplier name; extra messages for «nothing to send
for that order» and «you are offline: nothing was deleted».

**Found driving and in the review, fixed:** the order list's search box shrank under 44px at 296px once the gear stood beside
«Manda» (it now takes a line of its own there); «Manda di nuovo» said nothing when the browser blocked the window (now «Non si è
aperto niente», or the supplier a road could not reach is named); History counted the phone's own empty copy as loaded (offline
it said «no orders» and an editor opened by its address bounced back — it now waits for the server's first word or records in
hand); after a delete the focus landed on the deleted card's button a moment before it vanished (History's title takes it); the
Italian «changed» message read as «another phone added the order».

**Left open (tell him):**
- Leaving History with the phone's back gesture after coming back from the editor may not give the focus back to the «Ordini
  passati» door (found in the review, not confirmed; the on-screen Back does).
- A correction and a delete are checked against the rules only through the fake source; the emulator drive wrote both through
  the real rules.
- To try on the tablet: «Manda di nuovo» on WhatsApp and email from a real phone, and History offline.

**Tests.** Flaky under load in the full app run (each passes alone): RecipesSection haccpSettings, PastriesSection days,
SuppliersSection ingredient allergens.

**P13.** No new personal data: History shows what the records already hold (suppliers, ingredients, quantities, times); a
supplier's phone and email travel only in the link the person taps.

## Step 3f-5 as built — Incoming

Items V1–V11 and F4: the debt banner and the two doors on the order list, Incoming with its groups, «È arrivato da …?»,
«Cosa è arrivato?», «Da riordinare» (put back, another supplier, resolved) and the goods-arrived switch in Settings.
⚠️ **Rules changed: deploy them BEFORE Mise 2 goes live** (three new optional keys on `config/orders`; old phones never
send them, so an early deploy is safe).

**Shared.** `deliveries` is ported as it is (`isDelivered`, `shortfall`, `expectedDeliveryOn`, `pendingDeliveries`,
`resolvedOn`, `stillToReorder`, `applyReorder`, `unansweredBefore`); `deliveries.spec.ts` runs every test against both
files (except three that read the old file's source text) and the pair is in `parity.spec.ts`. New, with no original:
`delivery-check.ts` — the switch read from `config/orders` (`deliveryCheckOf`, absent = on), the patch a flip writes
(`deliveryCheckPatch`), `turningOnForgets` and `askedAbout` (no record when off; only records from `deliveryCheckFrom`
on).

**Data.** `ordersSource`: `confirmDelivery` (an `updateDoc` of `deliveredAt`, `missing` replaced whole, `updatedAt`, as
`draft.js:367`), `resolveMissing` (a merge of `missingResolved.<id>`), `mergeOrdersConfig`. `ordersStore`:
`confirmDelivery`, `resolveMissing`, `putBack`, `orderElsewhere` (the draft line written through the same local-first draft
sync as typing, the supplier's own day stamped), `setDeliveryCheck`; every outcome is `saved | refused | failed` or
`applied | skipped | gone`. Rules: `deliveryCheck` (bool), `deliveryCheckFrom` and `deliveryCheckOffOn` (a plain
`YYYY-MM-DD`) join the `config/orders` whitelist under the existing owner-or-manager write; cases in
`tests/rules/firestore-rules-check.mjs` (employee refused, manager and owner allowed, other venue refused, bad values
refused).

**Screens.** On the order list, under the day: the debt banner («1 ordine di prima di questa settimana»), then two doors,
«In arrivo» (its count of orders to confirm) and «Da riordinare (n)». «In arrivo» → the groups «Di prima di questa
settimana», «In ritardo», «Previsti oggi», «In arrivo», each order a row with its supplier and expected day; a tap asks «È
arrivato da …?» (all arrived / something missing). «Manca qualcosa» → «Cosa è arrivato?»: every line ticked as arrived,
untick what did not come, Save in the header; Back with changes asks to discard. «Da riordinare» → one card per missing
line, newest first: «Rimetti nell’ordine di …», «Ordina da un altro fornitore» (a chooser of the other active suppliers)
and «Risolto» (asks first). Settings gains «Controlla la merce arrivata» with its sentence; an employee sees it locked
with «Solo un titolare o un manager può cambiarlo.».

**Decisions of this slice (his, 29 Oct 2026 — F4):** per venue; owner or manager only (shown to everybody, locked for
employees); off hides the Incoming door and count, the debt banner, «Da riordinare» and (from 3f-8) the kiosk's arriving
lines; nothing is deleted.
- Taken for him (recommended option): turned back on, only orders from that day on are asked about (`deliveryCheckFrom`),
  and the switch asks first «Riattivare il controllo? — Gli ordini fatti prima di oggi non verranno più chiesti». ⚠️ But
  turned off and on again **the same day** (a slip of the finger) it forgets nothing and asks nothing: the day it went
  off is kept in `deliveryCheckOffOn`, and the old `deliveryCheckFrom` stays.
- Taken for him: «Da riordinare» is not reset by the switch. The lines somebody already said did not arrive are facts, not
  questions, so turned back on they are all there again; only the questions («È arrivato?», the debt) start from today.

**Differences from the current app, on purpose (tell him):**
- D1. The debt is a group of its own at the top of «In arrivo» («Di prima di questa settimana»), answered one order at a
  time like the others, instead of a chain of dialogs opened from the banner.
- D2. Escape on «È arrivato da …?» answers nothing.
- D3. Save on «Cosa è arrivato?» does not ask a second time (P20 exception, stated): the screen itself is the question,
  and it already took a tap per missing line.
- D4. «Rimetti» and «Ordina da un altro fornitore» stamp the supplier's own order day on the draft line, as typing does.
- D5. A put back that the rules refuse stays on the phone like refused typing (the draft's usual retry), never lost.
- D6. A double tap on «Rimetti» never puts back the next card: every card ignores a press for 600 ms after an action.
- D7. «Tutto arrivato» answers for the order as it is now: if a second order merged in while the question was open and
  brought «did not arrive» marks, it goes to «Cosa è arrivato?» instead of erasing them (V4, now also mid-question).
- D8. A day with a year writes the year in digits («2026», never «2.026») — fixed in `dayWords` for every screen.

**Left open (tell him):**
- ⚠️ **Coexistence:** the current app and its kiosk do not know the switch. While both apps run side by side, a venue
  that turns the check off in Mise 2 still sees «In arrivo» and the debt in the current app. The kiosk's arriving lines
  are built in 3f-8 (`kiosk-lines`), which must honour `deliveryCheck`.
- When another phone turns the switch off while a «Cosa è arrivato?» is open, the screen closes and the unsaved ticks are
  dropped (accepted: the check is off).
- A «Cosa è arrivato?» Save overwrites an answer a colleague gave meanwhile — exactly as the current app does.
- «Previsto Oggi» keeps the capital O of the current app's string.
- To try on the tablet: the whole flow with real deliveries, and the switch from an employee's account.

**P13.** No new personal data: who answered is not recorded; the three new keys are days and a yes/no.
