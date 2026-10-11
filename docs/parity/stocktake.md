# Parity list — Stocktake

What Mise 2's Stocktake («Magazzino») must do because the current app does it. Built from
`tests/inventory-*.test.mjs`, `js/inventory/`, the root modules it reads (`js/price-model.js`,
`js/order-cost.js`, `js/order-unit.js`, `js/pack-size.js`, `js/currency.js`, `js/market.js`,
`js/ingredient-name.js`), `firestore.rules` (the `inventory` block and `stocktakeMayRead/Write`),
the smoke test and the release history (`v1.78.0`/`v1.79.0` «Magazzino», `v1.81.0` employees,
`v1.107.0` boxes without grouping, the case and carton prices of 30 Sep–2 Oct 2026). Each line is a
requirement; the ones marked **spec** are pinned by a test in Mise 2 (a port runs the current app's
tests against both files). Differences from the current app are listed at the end, each with its
reason.

## Who sees it

1. **Gated on the Food cost section and the Stocktake's own card**: owners and managers always;
   employees only where the venue shows them the card (`staffShownCards.inventory`). The rules
   decide every read and write (`cardAccess(lid, 'foodcost', 'inventory')`). **spec** (visibility)
2. **An employee counts and sees no money**: no value, no pack-weight box, no price in any note, no
   «What it cost», no closing or reopening, no «Carry forward» (it reads last month, which is
   closed, and an employee may not read a closed month). «From the orders» stays.
3. **An employee may read only an open month holding no frozen prices** (`allow get`), and never
   list months. A month the rules refuse to an employee shows «This month cannot be opened here: it
   is closed, or the Stocktake is no longer shown to employees. Owners and managers still see it.»
   with the month arrows still there (they are the way to a month that can be opened). A refusal is
   not repainted away by a later ingredient update.
4. **Who is looking is known before anything that is money is drawn**: until the session says the
   person runs the place, nothing of 2 is shown.

## Data

5. **One document per month**, `locations/{lid}/inventory/{YYYY-MM}`, the id pinned to its `month`
   field. Maps keyed by ingredient id: `opening`, `purchased`, `closing`, `packKg`, `names`,
   `unitPrice`; strings `closedAt`, `createdAt`, `updatedAt`; `bakery` stamped by the data layer.
   The rules refuse any other key and maps over 500 entries. **spec** (`toDocument`)
6. **Writes are merges**, never whole documents (two phones count the same evening). Clearing a box
   travels as `deleteField()` IN THE SAME WRITE as the rest, as a nested map (`{ closing: { id:
   deleteField() } }`), never a dotted path: an ingredient id may contain a dot. **spec**
7. **An empty box is not a zero.** A missing count is «not counted», everywhere: no consumption, no
   cost, never a full consumption. `purchased` is the one exception: missing means none bought.
   **spec**
8. **A typed count**: a comma is a decimal point; negative and junk are refused (not clamped); three
   decimals; zero is a real answer. **spec** (`readCount`)
9. **Never deleted, by anybody.** A month closed by mistake is reopened (`closedAt` back to `''`).
10. **Reading is forgiving** (`normalizeMonth`): every map present; junk values dropped; frozen
    names trimmed and cut to 200 characters; the id from `month`, else the document id. **spec**
11. **The month in the address**, so a phone that locks and reloads comes back to the month being
    counted. With no month in it, the current one (LOCAL clock: half past midnight on the 1st is the
    new month). **spec** (`monthKey`)
12. **Months move with arrows**: the month before always; the month after only up to the current
    one. Leaving a month first hands what is still unsent to Firestore — and never waits for the
    server to answer (no signal in a storeroom). **spec** (`shiftMonth`)
13. **One live listener on the month on screen**, one on `ingredients`, one on `ingredient-prices`
    (that one fails quietly: an employee may not read prices, a venue may have none). Nothing is
    drawn from the ingredients until they have arrived; a price arriving later re-values the rows.
    Stream failure on the month: «Live updates interrupted — reopen the page to reconnect.» for
    whoever runs the place, the sentence of 3 for an employee.
14. **A price on the ingredient document itself is never used**, only `ingredient-prices`
    (`withPrices`). **spec**
15. **Local copy** `inventory-{lid}-{YYYY-MM}` (the current app's key and shape, `toDocument`),
    written on every change, painted before the network answers, and never laid over something
    newer (a snapshot already arrived, or a count already typed). Not under `KEEP_PREFIXES`: a
    venue switch wipes it. **spec**

## Saving a count

16. **Local-first and NEVER rolled back.** The number stays on screen and in the local copy; a
    refused or failed write says «Not saved online yet. The count is safe on this phone and goes up
    on its own.» and the unsent change waits to go with the next save. **spec**
17. **Sent 700ms after the last change**, as ONE write (a count and a cleared box beside it never
    half-land); exactly one write in the air at a time. Before leaving the page or the section,
    everything waiting is sent. **spec**
18. **The outbox** (`inventory-outbox`): a write is taken out of «waiting» before it is sent; a
    snapshot arriving mid-write never takes the number back; a failed write goes back behind
    anything typed since (the newer answer for a box wins, a failed removal never resurrects a
    number, a failed number never undoes an emptying). **spec**
19. **Nothing the screen does waits for a server.** Closing, reopening and changing month wait at
    most 1.2 seconds for the whole sequence (one deadline, not one per write), then carry on: an
    offline write is already safe in the browser's database. A write nobody waits for still reports
    its failure and never throws loose. **spec**
20. **A closed month refuses every change in the store**, whatever the screen drew: counts, the
    purchases fill-in and carry forward. The rules cannot tell a count from the reopening write, so
    the app is the only guard. **spec**

## The list

21. **Summary**: «Counted» / «{counted} of {total}» (count boxes filled, not products that exist; a
    zero counts; no products is not finished) and the note «A box left empty means “not counted
    yet”, never zero.» — on a closed month «This month is closed: its figures no longer change.»
    **spec** (`progressOf`)
22. **The rows are the month's products** (`productsOfMonth`): an open month lists the venue's
    active, named ingredients (packaging included); a closed month lists what was frozen into it
    plus every id carrying a count, under its FROZEN name; a closed month with nothing recorded
    shows the live list. **spec**
23. **Grouped by category** in the venue's alphabetical order, no category (or `Other`) last as «No
    category»; rows by display name. A category arriving late re-files the row.
24. **Each row**: the name (`shortName` else `name`, then the pack text; «Product with no name») as
    a button opening the product, «Open {name}»; under it «Had {had} · bought {bought} · used
    {used}», or «No opening figure yet», or «Not counted yet» (marked as to-do); on the right the
    count box «How many of {name} are left» and the unit (`unit`, else «packs»). The row is not a
    button around a box.
25. **The count box**: text with the decimal keyboard (never `type=number`: it refuses a comma), no
    autocomplete, «next» on the keyboard; committed when it changes (leaving it or Enter). It never
    shows a thousands separator (a grouped «1.234,5» cannot be read back). **spec** (count box)
26. **Typing never rebuilds the list**: rows keep their place and the box being reached for stays;
    the box being typed into is never written into while it has the focus. **spec**
27. **Search** «Search a product» (name, short name, brand, category; accents and case folded) and
    the «Still to count» toggle (pressed state). A row counted while the toggle is on STAYS until the
    next search or toggle. Nothing found: «Nothing matches.»; no products at all: «No products yet» /
    «They come from Ingredients & suppliers.» (no add button: products come from Suppliers).
28. **Two fill-in actions above the list, open months only**: «Carry forward» (whoever runs the
    place) and «From the orders».
29. **Carry forward** asks «Carry last month’s counts forward?» / «The opening figures for this
    month become what was left at the end of {month}. Anything already typed here is overwritten.»
    → copies the previous month's closings into this month's openings (only counted rows) and says
    «{n} opening figure(s) carried forward.», «There is nothing to carry forward from that month.»,
    or «Could not read that month — check the connection and try again.» — three answers, never two.
    **spec**
30. **From the orders** reads the month's `orders-history` ONCE (`date` ≥ the 1st, < the next 1st;
    never written to; the retired weekly record belongs to no month). Ordered minus lines ticked
    missing, added up per product, in the card's unit (a package line on a carton is converted by
    `packCount`, else a stored case of packages; anything else is left out and named). Answers: «Could
    not read the orders — write in what you bought by hand.»; «No orders recorded in {month}.»; if
    nothing could be counted but some lines were in another unit, only that sentence, in a dialog;
    otherwise «Fill in what was bought?» with the long caution, «Fill them in» → the purchases map is
    REPLACED (what the orders no longer account for is cleared) → «{n} product(s) filled in from the
    orders.», then the other-unit sentence in a dialog if there is one. **spec**
31. **Bottom actions** (whoever runs the place, on the list only): «What it cost» and «Close the
    month», which on a closed month reads «Reopen the month» (drawn quieter).
32. **Close the month** asks «Close the month?» with «The figures for {month} stay as they are…» or,
    when products are uncounted, «{n} product(s) have not been counted, so {month} will have no
    answer for them…». Then: everything waiting is sent; the NEXT month is written first (`opening` =
    the counted closings, `packKg` carried); then this month gets `closedAt`, the frozen `names` (as
    the screens show them), `unitPrice` (what ONE counted unit cost, where known) and `packKg`. Says
    «Month closed. {month} is open, with what was left as its opening.» and records the action
    `month-closed`. **spec** (`carryOver`)
33. **Reopen** asks «Reopen this month?» / «You will be able to correct its figures again. Note that
    the month after it does NOT change…» → `closedAt: ''`. The next month is not touched.
34. **A closed month looks closed** everywhere at once: boxes not typable, no fill-in actions, the
    closed note — even when that answer arrives after the first paint.

## One product

35. **The answer at the top**: «Used this month», the number with its unit or «—»; when unknown
    «Count what is left and this answers itself.» or «Say how many there were when the month opened
    and this answers itself.»; otherwise «Had {had} · bought {bought} · left {left}», the money (or
    why there is none: «no price entered» / «pack weight unknown» / «no price recorded when the month
    closed») for whoever runs the place, and when negative «There is more here than you started with
    plus everything you bought. One of the three numbers is wrong.» — negative is shown, never
    clamped. **spec** (`consumption`, `lineValue`)
36. **Three boxes** with labels and hints: opening («Written once. From next month the app carries
    it forward from what was left.»), purchased («Left empty it counts as none bought.» — shown empty
    when absent, never a 0 nobody typed), closing («Half a pack is 0.5.»).
37. **The pack weight box** «How many kg one pack is» (whoever runs the place, not for a product
    priced by the piece or by the case): the typed weight beats the pack text; the placeholder is the
    weight read from the pack text (none on a closed month). It travels to the next month.
38. **The pack note** says what the money rests on: by the case («Priced by the case: {price} per
    {unit}» or «…set the order unit to pcs, case or kg to value it»), by the piece («…about {price}
    each — no weight needed.» / «…but no price has been entered.»), by weight («One pack is read as
    {kg} kg[, and costs about {price}].», «No weight can be read from “{text}”…», «This product has no
    pack size…»); on a closed month only what was frozen («One of these was worth about {price} when
    the month was closed.» / «Nothing was recorded…»). A rate is never shown as 0.00.
39. Under the boxes, «A box left empty means “not counted yet”, never zero.»

## What it cost

40. **«What the month cost»**: «Cost of what was used», the total, «Worked out from {counted}
    product(s) you counted[, of which {n} have no value yet].»; rows most expensive first, rows with
    no value last with the quantity and why; empty «Nothing has been counted yet, so there is nothing
    to cost.»; and the caveat that it is an estimate, not an accounting record. **spec** (`monthCost`)
41. **An open month is valued at today's prices; a closed one only at what it froze** — never
    today's price, never the live pack text; a product deleted after the close still costs what it
    cost. **spec**
42. **The value of one counted unit** (`packPrice`): by weight, rate × pack kilos; by the piece, the
    rate (a carton of pieces: the carton through `unitCost`, refused when it cannot be priced); by
    the case, `unitCost` of the order unit (six decimals). The carton multiplies a simple weight by
    `packCount`, never a «6x1kg» or a typed weight. **spec**

## Money and numbers

43. **Money follows the venue's COUNTRY**: the symbol and the layout (`£1234.56` in the UK, `1.234,56
    €` in Italy), whatever the interface language; an unknown country falls back to `£` and the
    historical layout. Nothing is ever converted. **spec** (currency, market)
44. **Quantities follow the interface language** (`3,5` in Italian), except kilos printed on the same
    line as a price, which take the price's layout. Month names come from the platform, in the
    interface language; none is written in the code.

## Everywhere

45. Interface words follow the interface language; product names are what people typed.
46. Usage record: the list, one product, «What it cost» and the refused-month sentence are separate
    screens; closing a month is the action `month-closed`.
47. A part that fails to draw never stops the data: one part failing leaves the others working.

## Differences from the current app, on purpose

- **Tablet**: from 1000px wide the list stays on the left and the product (or «What it cost») opens
  on the right, beside it; with nothing chosen the right side says «Tap a product to see its
  figures.». On a phone each is its own screen, as today.
- **Changing month does not reload the page.** The address changes at once and the new month is
  watched; what was still unsent for the old month has already been handed to Firestore.
- **One product and «What it cost» have addresses** (`/stocktake/<month>/product/<id>`,
  `/stocktake/<month>/cost`), so a reload comes back to them. Opened by address by an employee,
  «What it cost» is not available.
- **The boxes wait for the month's first answer** (live, or the device's own offline copy, which
  answers at once without signal; a failed stream also counts): until it comes a box cannot be typed
  into, so a count can never be written into a month that turns out to be closed. The list waits for
  the ingredients' first answer with «Loading…» instead of flashing «No products yet».
- **A product's boxes follow the live month while they do not have the focus** (a colleague's count
  appears), as the list's boxes already do. The box being typed into is never written into.
- **The list's boxes never show a thousands separator, after an update too.** The current app writes
  an updated count back WITH grouping into a box that does not have the focus (`updateRows()` uses
  `num()`), so «1,234» edited to «1,235» is read as 1.235 — the v1.107.0 defect on its second path.
  Fixed separately in the current app.
- **Text a count box cannot read is refused, and the box shows the saved number again** («5 kg»,
  «1/2», «-2» typed over a saved 5 leave the 5 in place). The current app hands any changed text to
  `setCount`, whose `readCount` turns it into «nothing said», which REMOVES the count: junk typed
  over a saved number deleted it. A box emptied on purpose (nothing in it, blanks included) still
  removes the count. Covers the list's boxes, the product's three and the pack-weight box.
- **Enter in a count box moves to the next row's box**, which is what the keyboard's «next» promises.
- **Messages** are announced in a status region that exists before it changes, instead of a toast.
- **The other-unit sentence** is a dialog with one button, «OK», as the current app's alert.
