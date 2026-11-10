# Parity list — Food cost

What Mise 2's Food cost must do because the current app does it. Built from
`tests/foodcost-*.test.mjs`, `tests/recipe-cost-model.test.mjs`, `tests/line-unit-cost.test.mjs`,
`js/foodcost/` (model, store, data layer, list, editor, settings, weighing, VAT guide, product
limits), the root modules it reads (`js/vat-rates.js`, `js/ingredient-kind.js`,
`js/ingredient-name.js`, `js/price-model.js`, `js/recipe-link.js`) and the catalogue's pure models
it borrows (`js/catalogue/recipe-cost-model.js`, `js/catalogue/catalogue-model.js`),
`firestore.rules` (`products`, `products/{id}/snapshots`, `foodcost-settings`, `recipes`,
`ingredient-prices`, `cardAccess`), the smoke test and the release history (13 Sep 2026: ingredient
lines, packs, labour, suggested price, production cost, weighing on the product, the VAT guide;
14 Sep: the save limits; 29 Sep: Italian VAT menu and the tablet split). Each line is a
requirement; the ones marked **spec** are pinned by a test in Mise 2 (a port runs the current app's
tests against both files). Differences from the current app are listed at the end, each with its
reason.

## Who sees it

1. **Gated on the Food cost section and its own card**: owners and managers always; employees only
   where the venue shows them the card (`staffShownCards.foodcost`). The rules decide every read and
   write (`cardAccess(lid, 'foodcost', 'foodcost')`). **spec** (visibility)
2. **An employee shown Food cost reads and writes products and their margin history** (his choice,
   «tutto il Food cost»), but never deletes a product: Delete is drawn only for whoever runs the
   place (`canManage`, not `isOwner` — a manager runs the place).
3. **The hourly labour cost is a wage figure: only whoever runs the place reads, writes or is shown
   it.** `foodcost-settings/main` is read only for them (an employee's listener would be refused);
   the rate is never written to the phone's storage; Settings is drawn only for them; every labour
   money figure is absent for anybody else. The MINUTES and PEOPLE on a product are not money and
   are shown to whoever edits it. **spec**
4. **Who is looking is known before Settings or Delete is drawn**: until the session answers,
   neither appears.

## Data

5. **Products**, `locations/{lid}/products/{id}`, written WHOLE (a merge would keep a removed line
   alive), the fields listed by hand (spreading would send `id` and be refused): `name`,
   `components`, `packaging`, `sellingMode`, `piecesPerBatch`, `packSize`, `packUnit`,
   `sellingPrice`, `vatRate`, `foodCostTarget`, `labourMinutes`, `labourPeople`, `model`, and
   `bakery` stamped by the data layer. **spec** (`toProductDocument`)
6. **Every save carries `model: 2`** (`PRODUCT_MODEL`): the rules refuse a save without it over a
   product that has it, so an old phone cannot delete ingredient lines and packs in silence.
   **spec**
7. **A new product's id is made on the phone** before the write, so it appears at once, offline
   too; the write uses THAT id, never a second one minted by the data layer.
8. **A margin point is appended in the SAME batch as the product** (`products/{id}/snapshots/{auto}`):
   both land or neither. Only when the change is worth recording (price, VAT, way of selling,
   pieces, pack, composition — a reordered list is not a change; a rename is not) or a weighing was
   typed, and only when there is a real food cost to record. The snapshot freezes the VAT rate and
   the price of every ingredient behind the answer, through the recipes. **spec**
   (`snapshotWorthTaking`, `productSnapshot`)
9. **A weighing typed on a recipe line is written onto the RECIPE**: three fields (`lossPct`,
   `rawGrams`, `cookedGrams`) with `updateDoc` (a deleted recipe fails instead of coming back
   nameless) and the `bakery` stamp; ONE write per recipe, never inside the product's batch (the
   rules' read budget). A refused weighing puts back only what it changed, and only if nothing newer
   has landed (`restoreAfterRefusal`); a field the recipe did not have is removed, never set to 0.
   **spec**
10. **The weighing boxes are offered only where the venue's catalogue is on** (`sections.catalogue`
    explicitly `true`, as the current `canWriteRecipes()`): a venue with Food cost on and the
    catalogue off can read its recipes but not write them.
11. **Deleting a product** (whoever runs the place, confirmed) removes it locally at once; a
    refused delete puts it back and says «Couldn’t delete the product».
12. **Local-first** (P20): a save shows at once and the editor returns to the list; a REFUSED write
    rolls back (the old product, or the new one removed) and names the product. Offline a write
    waits, it never fails.
13. **Three live listeners while the section is open**: `products` (a failure says «Live updates
    interrupted…»), `recipes` and `ingredients`+`ingredient-prices` (both QUIET on failure: they
    belong to other sections, and an unpriced line already says so). Nothing is emitted from the
    ingredients until they have arrived (the prices can land first). A price on the ingredient
    document itself is never used, only `ingredient-prices` (`withPrices`). **spec**
14. **The labour rate is watched only for whoever runs the place**, after the session says so. Saved
    as a MERGE `{ labourCostPerHour, updatedAt, bakery }` (null clears it); the document is never
    deleted. Local-first: a refused save puts the old rate back and says «Couldn’t save».
15. **Local copies** `foodcost-products`, `foodcost-recipes`, `foodcost-ingredients` (the current
    app's keys and shapes), painted before the network answers; a venue switch wipes them (not in
    `KEEP_PREFIXES`). The labour rate is never stored.
16. **Reading is forgiving** (`normalizeProduct`): missing stays missing (null, never 0 — «no VAT
    chosen» and «zero-rated» are different answers); junk lines dropped; a recipe line keeps its
    old shape `{recipeId, qtyKg}` exactly; an ingredient line `{kind:'ingredient', ingredientId,
    qty, unit}`; packaging `{ingredientId, qtyPcs}`. **spec**
17. **The margin history is read on demand**, never watched: newest first, ordered by the
    `recordedAt` FIELD (never by id), at most 30. Failure says «Couldn’t load the history».

## The maths

18. **A product is a batch**: kilos of recipes, ingredients added straight to it (grams, kilos or
    pieces) and packaging counted PER UNIT SOLD. **spec**
19. **A recipe costs per kilo of what comes OUT of it** (`costRecipe`): a priced row adds cost and
    weight, an unpriced row neither and makes it partial; the oven loss divides the yield; sub-recipes
    up to 4 deep; a cycle or a missing sub-recipe is named. **spec**
20. **An ingredient line** (`ingredientLineCost`): by weight at the price per kilo; in pieces at the
    price each, or at the piece weight × price per kilo; an unpriced line adds no weight either and
    says why (no price / no piece weight / no piece price). **spec**
21. **Packaging adds cost, never weight**, and only what is bought by the piece; anything else is
    named, not guessed. **spec**
22. **Sold by the piece, by weight, or by the pack** (a weight or a number of pieces). There is no
    default. **spec**
23. **The production cost answers with no price and no VAT** (`productionCost`): the batch, the
    cost per unit once the units are known, never «£0.00» (no line priced = no box at all), and
    «partly priced» whenever a line is missing — the cost is then too LOW. **spec**
24. **The food cost is worked out on the NET price**: the selling price is typed GROSS (the number
    on the label) and the VAT is taken out; a VAT rate of 0 is a real answer. **spec**
25. **Production cost and food cost divide by the SAME number**, in every way of selling. **spec**
26. **The traffic light**: green up to the target, amber up to a tenth above, red beyond; no target,
    no colour. Shown as a dot AND a word. **spec**
27. **What is missing is a checklist**, all of it, in the order a person fills it in; never a 0%.
    **spec** (`costProduct` blockers)
28. **Labour** = minutes × people (empty = 1) × the hourly rate, per batch, divided like the
    materials; never inside the food cost %, shown beside it («Labour X% · everything Y%»). No time
    or no rate = no labour figure, never zero. **spec**
29. **The suggested price** puts the food cost exactly at the target, VAT added back, ROUNDED UP to
    the cent (floating dust ignored); none without the unit cost, the VAT rate and a target; «Use
    this price» fills the price; when the price already equals it, «This is the price in use». A
    partly priced product says the price that hits the target is higher. **spec**

## The list

30. **Worst food cost first**; products that cannot be costed LAST, by name; junk never throws.
    **spec** (`sortByMargin`)
31. **Each row**: the name (or «Untitled product»), the food cost % (or «—»), the dot, and ONE line:
    status · cost · margin, or the first thing still missing.
32. **Empty**: «No products yet», a line on what a product is, and a button that adds one.
33. **«+» adds a product** (the list's one way to add, beside the empty state's button).

## The product

34. **One page, not a wizard**: the production cost and the food cost answer at the top, live; the
    name; «Made of» (recipe and ingredient lines, then the weighings LAST); packaging (with «per
    piece / per pack / per kg» said once there is a line); labour (minutes, people, a note; «set the
    hourly cost in Settings» only to whoever can); how it is sold (mode, pack size + unit, pieces per
    batch — each shown only when it means something); VAT (the COUNTRY's menu + «another rate» + the
    guide); food cost target; selling price with the venue's currency in the label; the suggested
    price; margin history and Delete, small and low-key.
35. **No money in «Made of»**: neither under a recipe line nor in the chooser. A line says only what
    stops it being costed («not priced», «partly priced», «no longer exists»). Packaging lines show
    the price each and the line total.
36. **The chooser is a search screen**, not a menu: recipes first while the product is made of
    nothing, then «a recipe or an ingredient»; ingredients offered are never packaging, packaging
    offered is only packaging (`isPackaging`), inactive and nameless items are left out; packaging
    priced another way is shown but flagged. A line's name opens the chooser again to point it at
    something else of its kind. A line just added puts the focus in its quantity.
37. **The name suggests recipes** while «Made of» is empty (2+ characters, 5 at most, «See all»): a
    tap names the product after the recipe, puts the recipe first, and says when other products
    already use it.
38. **Typing a quantity never rebuilds the row it is typed in**; it refreshes that line's note and
    the answers.
39. **The weighings**: one raw/cooked pair per RECIPE on the product (named when there are several),
    the raw box following the recipe's total until typed, the cooked box empty unless weighed;
    «loses X%», «not weighed yet», warnings for cooked heavier and capped; «changes N other
    products» said the moment it is true; the box under the finger is never rewritten. **spec**
    (`foodcost-weighing`)
40. **VAT**: the venue's COUNTRY's rates (GB 20/5/0, IT 22/10/4; unknown → GB); a stored rate the
    menu lacks opens in «another rate», unchanged; switching to «another rate» shows the rate that
    will be saved. **spec** (`vatSelection`, `vatRatesFor`)
41. **The VAT guide** (country's law, food words in the COUNTRY's language, interface words in the
    interface language): opens with «your accountant confirms», the rates highest first with their
    items, notes, sources and the day checked; «Use X%» on a rate puts it through the same rule as
    the menu; a group that says nothing takes that rate offers no button. **spec** (`vat-guide`)
42. **Save**: the name is the one required field (blocked, highlighted, «Please enter a product
    name.»); a number the rules would refuse stops the save BEFORE the question, names the box and
    highlights it; a value in a box that is not shown is cleared, not asked about; then «Save
    product? / Save these changes?»; then «Product saved.» / «Product added.» and the list.
    **spec** (`firstInvalidNumber`)
43. **Leaving with changes asks «Discard changes?»**, whatever the way out. A product opened and
    left untouched asks nothing.
44. **A product changed elsewhere never replaces the working copy**; the lines and the answers pick
    up new recipes and prices as they arrive (a line is never stuck on «no longer exists» for a
    recipe that was merely late). A product deleted elsewhere while open and untouched closes with
    «Product deleted».

## Settings

45. **One number, the hourly labour cost**, in the venue's currency: empty clears it; 0 or over
    10,000 is refused BEFORE the question («between 0 and 10,000»); «Save the hourly labour cost?»;
    «Saved»; leaving with a changed number asks first. **spec** (`labourRateAllowed`)

## Margin history

46. **Each point**: the food cost %, «cost X · price Y · VAT Z%», the date; and the note that a point
    exists only where somebody changed something (ingredient prices drifting leave no mark).
    Nothing yet: its own sentence.

## Money and numbers

47. **Money follows the venue's COUNTRY** (symbol and layout), whatever the interface language;
    nothing is converted. A cost per unit keeps more decimals (`formatRate`), a total two
    (`formatMoney`). **spec** (currency, market)
48. **Dates and numbers follow the interface language.**

## Everywhere

49. Interface words follow the interface language; product, recipe and ingredient names are what
    people typed; the VAT guide's items follow the COUNTRY.
50. Usage record: the list, a product, its history and Settings are separate screens; a save is the
    action `foodcost-saved`.
51. A part that fails to draw never stops the data.

## Differences from the current app, on purpose

- **Addresses**: a product, a new product, its margin history and Settings each have one
  (`/food-cost/product/<id>`, `/food-cost/new`, `/food-cost/product/<id>/history`,
  `/food-cost/settings`), so a reload comes back to them. A product address waits for the products'
  first answer before opening its copy (the editor-copies-too-early trap of the Pastries).
- **Tablet**: from 1000px the list stays on the left and the product, its history or Settings opens
  on the right; with nothing chosen the right side says «Tap a product to see its figures.». On a
  phone each is its own screen, as today.
- **Opened from a recipe** (`#recipe=<id>`) waits for step 3d: Mise 2 has no catalogue yet, so
  nothing can link here. The model half (`productsUsingRecipe`, `draftFromRecipe`) is ported now;
  the address and its Back to the recipe come with the catalogue.
- **Messages** are announced in a status region that exists before it changes, instead of a toast.
- **The chooser and the VAT guide are dialogs** (focus kept inside, Esc closes), not overlays drawn
  over the page.

## «Finished product, no weight loss» as built (8 Nov 2026)

Port of the current app's step 1 switch (`bb1e0ede`, item 4 of `docs/mise2-port-owed.md`). Before it a Mise 2 save of a product
(a WHOLE write) removed the flag and the recipes' oven loss started counting again.
- `noWeightLoss` is read only as a literal `true` (`normalizeProduct`) and written only when true; switching it off removes the key.
- The cost of a recipe line lays the recipe's own loss aside for that product alone (`batchTotals`); the recipe keeps its number.
- The product form shows the switch, with its hint, only while the product has a recipe line. While it is on no weighing box is
  drawn, nothing typed earlier is written onto the recipes, and the live figures are the lossless ones. Toggling it on a saved
  product records a margin point. A finished product is not counted in «it changes N other products too» (`otherProductsUsing`).
- Still owed (section E of the checklist): the per-kilo block, the per-line rate and the read view, which also honour the flag in
  the current app.

## Recipe line in grams as built (8 Nov 2026)

Port of the current app's #488 (`a7f4c75d`, item 27 of `docs/mise2-port-owed.md`), with the g/kg select on recipe lines it needs
from step 1 (#455, item 21). On 8 Nov 2026 production had 16 «Made of» lines in 11 products with grams typed into a box that
opened on kilos: every one of those costs ×1000.
- A recipe line OPENS IN GRAMS, every time (3.233 kg reads «3233»), and offers g or kg (`KILO_LINE_UNITS`); it is still stored as
  `qtyKg`, in kilos, six decimals at most (`shared/src/line-quantity.ts`, a full port, paired). The unit lives only in the working
  copy (`productEditorModel.ts`: a recipe line has `unit`, and `recipeLineKg` is its only way to kilos); it is never saved.
- Switching the unit KEEPS THE TYPED NUMBER and changes what it means (522 g → 522 kg): the stored kilos change and the form is
  dirty. On an empty box nothing changes, so nothing is marked and Back asks nothing (the current app's `kilos === entry.qtyKg`).
- A line asking for more than 20 whole batches of its recipe (`tooMuchOfRecipe`, `wholeRecipeKg`: the weighable rows less the
  oven loss) gets a note, FIRST under the line: «{qty}, but the recipe makes {whole}: did you mean {grams}?», the three weights
  through `fcWeight` (two decimals, the venue's layout; `shared/src/fc-number.ts` ports only `fcNumber` and `fcWeight`). It never
  blocks Save. A recipe of pieces only never warns.
- The quantity box of a recipe line is named «Quantity» like the current app's (it was «Kilos»; `fc.aria.kilos` is gone).
- Differences, on purpose: Mise 2's other notes under a recipe line stay as they were (no price / partly priced; the current app's
  per-line money is item 26). The box keeps Mise 2's width (the current app's `9ch` width is item 21's, deferred). A typed comma is
  a decimal mark (Mise 2's `readQty`); the current app's number box takes no comma.
- Not ported (deferred until after the switch): the rest of item 21 (empty raw box, kept wrong weighings in red, wider boxes) and
  items 22–26 and 28.

## Weighing units and two decimals as built (10 Nov 2026)

Items 21 and 28 of `docs/mise2-port-owed.md` (current app `df7e6313` and `151ea191`), branch `feature/mise2-next-foodcost-units`. This
SUPERSEDES the "not ported" lines of the two sections above (the empty raw box, the kept wrong weighings in red and the wider boxes are
now in; items 22-26 are still not).

**Item 21: the weighing boxes.**
- `shared/src/foodcost-weighing.ts` is a full port again and paired in `parity.spec.ts` (the item-21 `PORT OWED` keys are gone, also from
  `odd-inputs.spec.ts`). The raw box no longer follows the recipe's ingredient total (`rawTyped` and `rawShown` are gone): both boxes open
  EMPTY unless the recipe was weighed, and a loss is worked out only when BOTH weights hold a number. One box alone says
  `fc.lossNeedBoth`. A cooked weight above the raw one is KEPT: `readWeighing` returns `keepsOnly: true` and a patch with only
  `rawGrams` and `cookedGrams` - no `lossPct` at all, because this phone's copy of the loss could overwrite another phone's weighing.
  `weighingsChangeCost` is true only for a patch that moves the cost, so a kept pair records no margin point. An untouched kept pair
  opens red again with its numbers in the boxes.
  `restoreAfterRefusal` rolls back only the fields the patch carried; `otherProductsUsing` does not count finished products.
- `foodcostSource.saveRecipeLoss` leaves `lossPct` out of the `updateDoc` when the patch has none (never `undefined`: `updateDoc`
  throws on it); `RecipeLossPatch.lossPct` is optional. No rules change: the three keys were already allowed one by one.
- `WeighingPair.tsx`: placeholder `0` in both boxes; the cooked box is framed in red and `aria-invalid` while its warning stands (both
  warnings, "cooked heavier" and "capped", are about the cooked weight); the warning text is `--danger-ink` (above 4.5:1 on the card,
  pinned in `foodcostCss.spec.ts`); the sentences go through `weighingParams`, so the percentage reads "12,00%".
- `ProductForm.tsx` Save: a wrong weighing never blocks. It focuses the cooked box (`reveal`), says `fc.checkWeighing`, and the usual
  question becomes `fc.saveWithWeightWarnings` (one paragraph per line, "Save anyway?"); one tap on Save keeps the numbers as typed.
  The margin point is taken for `snapshotWorthTaking || weighingsChangeCost || a changed noWeightLoss`. A finished product has no
  boxes, so no warnings and no patches.
- Boxes: `LineRow.module.css .qty` is `calc(9ch + 2 * var(--s3) + 3px)` (it was 120px) and `WeighingPair.module.css .input` has
  `min-width: calc(9ch + 2 * var(--s2) + 3px)` with `--s2` padding; the pair wraps under itself rather than cut a weight. The current
  app's `-webkit-appearance` rules for spin buttons are not needed: Mise 2's boxes are `type="text"`.

**Item 28: two decimals.**
- `shared/src/fc-number.ts` is a full, ADAPTED port: `fcNumber`, `fcMoney`, `fcWeight`, `weighingParams`, each handed the venue's
  `Money` as the last argument (the original reads `js/currency.js`). So it is not paired; `fc-number.spec.ts` runs each export against
  both files in Italy, Britain and a layout without grouping.
- Drawn through it, in the venue's layout and not the interface language's: the list row (`productRowModel.ts`: "40,00%", "0,20 €",
  `percentText` now takes the `Money`), the answer panel (production cost, whole batch, materials/labour split, total, food cost, net
  price, margin, the labour line "120,00% ... 140,00%"), the suggested price and its basis (VAT and target as percentages), the
  weighing sentences, the margin history (percentage, cost, price, VAT) and its date line unchanged, the chooser's "price each", and the
  packaging note under a line ("£0.25 each · £0.50"). A real cost under a cent reads "< 0,01 €", never "0,00 €". Totals stay exact.
- `price-model` is untouched: the Suppliers and the Stocktake keep their decimals (pinned in `fc-number.spec.ts`).
- The VAT menu's option words (`fc.vat.standard` with its rate) are menu labels, not figures; they are not changed, as in the current app.
- Specs: existing ones updated for the new text (`FoodcostSection.*.spec.tsx`, `productRowModel.spec.ts`); new
  `FoodcostSection.twoDecimals.spec.tsx` (list row, answer, labour line, suggested price, weighing sentence, packaging note in
  Italy and Britain), the weighing cases in `FoodcostSection.editor.lines.spec.tsx` (empty boxes, one box alone, red box, kept pair
  Save with the question and no `lossPct`, no margin point) and `foodcostSource.spec.ts`.

**Differences from the current app, on purpose or by necessity**
- Mise 2 draws the percentage of the VAT/target basis and the history with the venue's layout through the same `fcNumber`; the current
  app does exactly that, so no difference there. The difference is the Save question: Mise 2's `useConfirm` takes paragraphs, so the
  dictionary text with its `\n` is split into paragraphs instead of one multi-line string.
- The packaging note is Mise 2's own (the current app draws a line-cost view instead, item 26). It now uses `fcMoney`; item 26 will
  replace it.
- `foodcost-model.js`'s marker in `odd-inputs.spec.ts` named items 26 and 28; the commit of item 28 never touched that file (the
  changes are the preview model, "Which?" and the money guard), so the marker now says items 24 and 26.

**Still owed (later slices, they must use `fc-number` from the first day):** (the list preview, 24, and the read sections with the card
layout, 25, are built: see the sections at the end), the cost on every line and "Which?" (26), and the kilos in the "create from the
recipe book" dialog (29, `from-recipes-view`).

## Cost per 1 kg as built (10 Nov 2026)

Item 22 of `docs/mise2-port-owed.md` (current app `574a0e3c`, `f0735d88`, `9af66dd5`; the figures as `151ea191` draws them). Branch
`feature/mise2-next-foodcost-per-kg`.

- **The model**: `shared/src/per-kg-model.ts` is a FULL port of `js/foodcost/per-kg-model.js` (`costPerKg`, `PER_KG_REASONS`, plus the types
  `PerKgRow`, `PerKgResult`, `PerKgReason`), paired in `parity.spec.ts` and run against both files by `per-kg-model.spec.ts` (the 19
  tests of `tests/foodcost-per-kg.test.mjs`, each against its own `foodcost-model`, plus a row-by-row comparison of the two on fourteen
  products). It reuses `foodcost-model`, `recipe-cost-model`, `catalogue-model`, `price-model` and `ingredient-name`; no calculation is copied.
  The total is the card's own cost (`productionCost`'s batch cost over the batch kilos), never a second sum.
- **The block**: `app/src/foodcost/PerKgBlock.tsx` + `PerKgBlock.module.css`, drawn in `ProductForm.tsx` right under the answer panel
  (production cost, food cost) and above the name: the current app puts it after the answer in the results card, and Mise 2's answer panel is
  the top of the page. Never inside «Made of». A native `<details>` with its `<summary>` (keyboard and screen reader for free): «Cost per
  1 kg» and the figure; closed by default. It is ONE element that stays mounted, `hidden` while there is no total (nothing costed, nothing
  weighed, never «0,00»), so it keeps open/closed through every repaint and a focused summary keeps its focus while the figures follow the
  boxes typed on the card. A fault in `costPerKg` hides the block and nothing else (P17).
- **Inside**: one line per ingredient (flour in the dough and in the cream is one line): its name, what the line costs, then `weight · price
  per kilo` (`1,25 kg · 2,00 € / kg`), or for pieces `10,00 pz · 0,25 € al pezzo`; a line not counted has no cost and says why
  («nessun prezzo, non conteggiato», «non pesato…», «ricetta senza prezzo…», «manca il peso di un pezzo…», «manca il prezzo al pezzo…»). The
  total «Totale per 1 kg», then the notes: «Alcune righe non sono conteggiate: il costo di 1 kg non è ancora esatto.» (neutral, never «more»: the
  kilo can read too HIGH as well as too low), «Confezione non conteggiata: scegli come si vende.», and the oven-loss note when the weights pass 1 kg.
- **Two decimals from the first day**: every figure goes through `fc-number` with the venue's `Money` (`fcMoney`, `fcWeight`, `fcNumber`); a
  weight under a kilo is in grams (`19,61 g`), from a kilo in kilos; a real cost under a cent reads «< 0,01 €». Rows and total are both in cents, so
  the rows may differ from the total by a cent (accepted, 8 Nov 2026).
- **Texts**: eleven keys `fc.perKg.title`, `.total`, `.pieces`, `.noPrice`, `.notWeighed`, `.noRecipe`, `.noPieceWeight`, `.noPiecePrice`, `.partial`,
  `.packagingLeftOut`, `.lossNote` in `en.ts` and `it.ts`, word for word from `js/i18n.js`; the price each reuses `sup.perEach` (the current app's
  `price.perEach`, same text).
- **Specs**: `FoodcostSection.perKg.spec.tsx` (position, closed by default, the rows, hidden while nothing is costed and back on the first line,
  the unpriced row and its neutral note, live following with the open state kept, packaging by the kilo and left out, the oven-loss note, Italy).

**Differences from the current app, on purpose or by necessity**
- The current app pins the block by reading the editor's source (`tests/foodcost-per-kg-screen.test.mjs`); Mise 2 pins what the screen DOES. The
  one-element, never-rebuilt-summary rule is kept by React's identity instead of by `replaceChildren`.
- The look is Mise 2's own (tokens, `--sunken` ground like the answer panels, a lucide chevron), not `foodcost.css`.
- `odd-inputs.spec.ts` marks `costPerKg` as PORT OWED together with `productionCost`: the original lets a null table through, the port's
  `batchTotals` throws. Items 24 and 26 port that change; remove the key then.
- The read-first card (item 25, built later the same day) draws this block once, in its «Calculated costs» card, in the read view and in the form
  alike (the same component, `PerKgBlock`; no second implementation). The current app does the same: its summary at the top has no per-kilo block, so
  "a second time" meant "also in the read view".

## List search and product preview as built (10 Nov 2026)

Item 24 of `docs/mise2-port-owed.md` (current app PR #482: `beb1adfd`, `e81a2617`, `39f192ac`; the figures as `151ea191` draws them). Branch
`feature/mise2-next-foodcost-preview`. This is the FIRST half of the current app's preview: the eight-figure panel. The four-figure summary with
«Details» (`39080577`), the margin moved under the cost (`56b2c90c`) and the read-first card (`18679a38`, `d491c7ca`, `f8770132`) are item 25;
the cost on every line and «Which?» (#485) are item 26.

- **The model** (`shared/src/foodcost-model.ts`, paired against `js/` in `foodcost-model.spec.ts` and `odd-inputs.spec.ts`): `suggestedNetPrice` (the
  price WITHOUT VAT, rounded up to the cent on its own), `productPreview` (the eight figures from `productionCost`, `costProduct` and the two
  suggested prices: nothing is added up a second time), `nameMatches` (accents, capitals and outer spaces do not count; nothing typed matches
  everything) and two more blockers, `no-target` and `no-packaging-price`, whose keys `fc.preview.needTarget` / `fc.preview.needPackagingPrice` sit in
  `BLOCKER_TEXT`. `normalizeSearchText` is the catalogue's own. An unpriced box is unknown, never «0,00 €» (`39f192ac`): its figure is `null` and the line
  to fix is named. The original also returns `unpriced` (the «Which?» list, item 26): the port does not, and the specs compare every other field.
- **The search**: `FoodcostList.tsx`, a `type="search"` box (name «Search products», 48px) between the buttons and the rows, drawn only once the list has
  products. It filters AFTER `sortByMargin`, so the rows that stay keep the worst-first order; nothing is debounced (the sort is memoised, the filter is a
  string compare). The box is a controlled input in a part that stays mounted, so a data update never replaces it or the text; the text lives in the list,
  which stays mounted while a product is open on a phone, so Back finds the same search. «No product name contains “x”.» is a small line in a `role="status"`
  region that is there before it speaks. Applies to the list narrowed to a recipe's products too.
- **When the preview appears**: below 1000px (`SPLIT_QUERY`, the section's own split), a tap on a row opens `ProductPreviewDialog` (the app's `Dialog`: focus kept
  inside, Escape and a press on the backdrop close it) instead of the card; its main button «Open the card» does what the tap did before, «Close» (or Escape)
  returns the focus to the row. From 1000px the card opens beside the list as it always did (the pane IS the preview there). The preview is over by itself when
  the page moves on (Back, the tablet turned to the split). On a phone the products of a narrowed list behave the same.
- **The panel** (`PreviewPanel.tsx`): price (VAT included, as typed), raw materials, packaging («None» without a line), labour (only when the figure exists, which
  needs the hourly rate only whoever runs the place is sent), total cost, food cost against its target (the percentages through `fcNumber`), margin («before
  labour» when the labour row is there), ideal price with VAT and without, «For a 25,00% food cost.», the partial warning, and «Still missing:» with the blockers.
  Every money figure is `fcMoney` in the venue's layout, unknown is «—». Caption «Summary per piece / per kg / per pack» is the dialog's description.
- **Texts**: twenty-three keys `fc.search`, `fc.searchNone`, `fc.preview.*` in `en.ts` and `it.ts`, worded as the current app had them when the preview shipped
  (`e81a2617` with the Italian names of `39f192ac`: «Imballaggio», «Lavoro»). `39080577` later changed them for the four-figure summary: it ADDED `fc.preview.cost`,
  `.ideal`, `.idealSub` and `.details`, DELETED `.total`, `.idealGross`, `.idealNet` and `.idealBasis`, and ⚠️ REWORDED `fc.preview.price` under the same key
  («Selling price» / «Prezzo di vendita», without «(VAT incl.)»): **DONE by item 25 (10 Nov 2026), all three, the rewording included** — see the last section. No test
  compares `app/src/i18n` with `js/i18n.js`, so the keys were checked by hand against the current dictionary.
- **Specs**: `FoodcostSection.preview.spec.tsx` (the search: names, order, the empty line, no box without products, the same box through a data update, the text
  through a product and Back; the dialog: figures, open the card, close and its focus, Escape, a price that arrives, a product deleted, the tablet turned; the
  split opens the card; dashes and the checklist, no target, no VAT, an unpriced and a priced box, a partial product; labour for a manager; Italy; the net ideal price in the
  suggested-price box of the card, with and without a VAT rate, and not without a target). Existing specs
  that tap a row on a PHONE now press «Open the card» first (`list`, `recipeBack`, `recipeFixes`, `recipeTrip`, `scroll`, `strict`): that is the ported behaviour.

**Differences from the current app, on purpose or by necessity**
- The light is a dot AND a word (the list's rule, P18): the status word («On target») follows the food cost line; the current app draws the dot alone.
- The dialog focuses itself, not a button: the current app focused the last button and had to scroll its box back to the top; here a tall preview simply opens at
  its top.
- The figures follow the data while the dialog is open (computed on every draw), and a product deleted elsewhere closes it saying «Product deleted.» — the current
  app froze the figures and said «Product deleted» only on «Open the card».
- The caption is the dialog's description, not a separate line.
- **The top of the card**: the current app drew the same panel as a summary above the card (`e81a2617`). Mise 2's top of the product already says the production
  cost, the food cost with the net price and the margin, and the suggested price with VAT; the one figure it lacked was the ideal price WITHOUT VAT, which now
  sat in the suggested-price box (a single line, also when no VAT rate is chosen yet). **Superseded by item 25**: the card's top is now the four-figure summary (which says the
  net price underneath the ideal price) and the suggested-price box has no net row, as in the current app.
- `productPreview`'s `partial`, `missing` and the null-tables gap of `batchTotals` (item 26) still differ from the original on a null table: `productPreview` joins
  `productionCost` and `costProduct` in the `PORT OWED` keys of `odd-inputs.spec.ts`, now naming item 26 only.

## Read-first card and four-figure summary as built (10 Nov 2026)

Item 25 of `docs/mise2-port-owed.md` (current app `39080577`, `56b2c90c`, `18679a38`, `d491c7ca`, `f8770132`, #484 `08d00ba9`; every figure as `151ea191` draws it).
Branch `feature/mise2-next-foodcost-card`, on top of item 24. NOT in this slice: item 26 (#485: the cost on every «Made of» line, «No price», «Which?»).

**What opens, and how the two views switch** (`ProductEditor.tsx` decides, once per product on screen; the choice never changes under somebody's fingers when data arrives):
- **An existing product with something costed** (the model's batch cost is not null: `summaryShows`) opens to READ: `ProductRead.tsx`.
- **A NEW product, and an existing one with nothing costed yet**, open straight in the FORM (the current app's `mode: 'auto'`: there is nothing to read). Back from such a
  form is what it always was (leave).
- **The pencil** (an icon button named «Edit product» / «Modifica il prodotto», in the bar where Save is in the form) mounts the form on a fresh copy of the stored product.
  **Back** from a form opened by the pencil returns to the read view after the usual «Discard changes?» question, asked only if something was typed (`onBackToRead`); the next Back leaves.
- **Save** (after its usual question) returns to the read view of the SAVED product: `onSaved`. For an existing product the address does not change. For a NEW one the new-product
  entry is REPLACED by the product's own address (`/food-cost/product/<id>`), so Back goes to the list (not to an empty form) and a reload comes back to the product. A product
  saved this way is read even with nothing costed, as the current app forces it, and its box starts open (`justSaved`).
- **Addresses chosen**: read and form share the product's address. The current app keeps the mode in the page, not in the address, and so does Mise 2: nothing in `foodcostPath.ts`
  changed. The consequence: the phone's own back gesture (the browser's Back) from a form opened by the pencil goes to the list, one level further than the Back button; typed edits
  are still protected (the router's blocker asks first), nothing is lost silently.
- **Focus**: to the new view's own title (the bar's h2) after the pencil, after Save and after Back from the form, never to the page.
- **Tablet**: from 1000px the same `ProductEditor` sits beside the list; a row opens the READ view, the pencil edits it there, Save returns to read there. Picking another product
  while one is in READ shows the other; while a form has typed edits the blocker asks, as before.
- **The read view follows the STORED product, live** (`f8770132`): it holds nothing typed, so a price, a recipe or the product itself changing elsewhere redraws it with no copy and
  no question; the open/closed state of «Full card» survives. A product deleted elsewhere says «Product deleted.» and leaves, on a phone and on the split alike. A form keeps its copy
  (never replaced), as before.
- **Margin history asks before dropping typed edits (#484)**: Mise 2 already did. The history is another address, so the router's blocker (`shouldBlock`, any move to another
  pathname while dirty) asks «Discard changes?» first; «Cancel» stays in the form with everything typed, «Discard» goes on. Pinned in `FoodcostSection.readMode.spec.tsx`. The read view is never dirty and
  asks nothing. (On the split the history also replaces the product, so the same question comes there, where the current app keeps its editor alive instead: Mise 2 asks, the current app does
  not need to. Safe, and not changed.)

**Review fixes (10 Nov 2026)**
- A NEW product made from a recipe keeps the recipe in its address once saved (`/food-cost/product/<id>?recipe=<rid>`), so Back from its read view goes to the recipe in one step, as the current app's `entryEditor`/`fromRecipe` do.
- A first save the database refuses is not 'Product deleted.'. The store keeps the state of a NEW product's first save only (`firstSave(id)`: 'sending' while in the air, 'refused' after a refusal; cleared by the save's success and by a delete; an existing product's refused save is never flagged, it rolls back, so a later remote delete is still announced). 'Refused': the read view, the form and `ProductEditor` leave to the list without saying it was deleted — the store's «… wasn't saved» stays (the current app also ends at the list). 'Sending': they WAIT (Loading / the read view stays) so the next snapshot can put the product back; a stale snapshot never bounces the person off a product that was saved. Not specced: the guard in `ProductEditor`'s `gone` for a product never drawn while 'sending' (needs a snapshot between the save and the new address).
- Read to form, form to read and Save each put the scroll back at the top (the phone's page, or the split's right-hand side; the list keeps its place), through `ScrollTopContext` provided by the section — the address does not change in those moves, so the section's own reset never saw them.
- «Full card» opens when a product stops being costed while it is read (`openNow`, current app `refreshRead`); a person who closed it while a summary showed is not argued with.
- `justSaved` is cleared whenever the id on screen changes to anything but the product just saved (another product, New, the list), so on the split a product saved with nothing costed opens to its form again later.
- Specs: `FoodcostSection.readFixes.spec.tsx`.

**The summary** (`PreviewPanel.tsx`, shared by the phone's dialog and the top of the card through `ProductSummary.tsx`): five rows in sight — selling price, cost (materials and
packaging, plus the work where there is a figure), margin (the app's margin: net price less materials and packaging; «before labour» where a labour row exists), food cost against
its target (a dot AND a word), ideal price — with the same price without VAT and its target underneath («0,80 € senza IVA, per un food cost del 25,00%»); raw materials, packaging and labour
behind a closed «Details» (a real button with `aria-expanded`, not `<details>`: the dialog's focus trap walks buttons). The card's summary is drawn only while something is costed (never a
frame of dashes), keeps «Details» open across repaints (`ProductSummary` stays mounted), shows the caption line («Summary per piece») and leaves out «Still missing:» (the answer panel below
has the checklist), except one line when there is no target. The dialog keeps its title, its description (the caption) and the checklist.
Every figure goes through `fc-number`; the suggested-price box lost the net-price row item 24 had put there (the current app's has none; the summary says it).

**«Full card»** (`FullCard.tsx`): ONE box under the summary holding six framed cards in the order they are filled in, results last — Product (name, how it is sold, pack, pieces), Made of (the lines
and, under the sub-heading «Weight and oven loss», the switch and the weighings), Packaging, Work time, Price (VAT, target, price, suggested price), Calculated costs (production cost, food cost,
«Cost per 1 kg»). History and Delete follow, low-key, in both views. Read: a native `<details>`, closed until pressed — open from the start only when there is no summary above it (decided once,
at mount). Form: the same box with a plain label, never collapsible, so a field Save checks can never sit hidden inside a closed box. Only the box's own chevron turns.
This moved the form's old layout: the answer panel and «Cost per 1 kg» used to be at the very top, above the name, and «How it is sold» held the sale mode, the pack, the pieces, the VAT, the target and
the price; now the summary is at the top and the answer panel is the last card.

**The read sections** (`ReadSections.tsx`, words in `readText.ts`): a description list per card (label left in muted ink, value right). Nothing in it is a control. A missing value is «Not set»
(«Non inserito») in muted text, never «0» or «0,00 €» (a price of 0 is «Not set»; a VAT of 0 is a real «0,00%»). Quantities: a recipe line through `fcWeight` («12,50 g», «1,25 kg»), an ingredient
and a pack through `amountText` («2,50 kg», pieces as «3,00 pz» / «3.00 pcs» — never «pezzi» after a 1), minutes and people as the person typed them («7,5»), percentages and money through `fcNumber` /
`fcMoney`. Each line carries the name and the note the form shows under it (`lineName`, `lineNote`: «This recipe is not priced yet», «no longer exists», the packaging's price each and total — item 26
will replace the packaging note). The weighings show raw and cooked grams, the sentence the form shows, and the red warning of a wrong pair (cooked heavier), with the cooked value in red;
«Finished product — no weight loss» replaces the pair. The labour sentence («Set the hourly labour cost in Settings…») is said only to whoever can set the rate. «Nothing yet» («Ancora niente»)
for an empty list.

**Texts** (`en.ts` / `it.ts`, word for word from the current `js/i18n.js`):
- ADDED `fc.preview.cost` Cost / Costo, `fc.preview.ideal` Ideal price / Prezzo ideale, `fc.preview.idealSub` «{net} without VAT, for a {target}% food cost» / «{net} senza IVA, per un food cost del {target}%»,
  `fc.preview.details` Details / Dettagli; `fc.fullCard` Full card / Scheda completa, `fc.editProduct` Edit product / Modifica il prodotto, `fc.section.product` Product / Prodotto,
  `fc.section.weighing` Weight and oven loss / Peso e calo in cottura, `fc.section.price` Price / Prezzo, `fc.section.results` Calculated costs / Costi calcolati, `fc.notSet` Not set / Non inserito,
  `fc.read.nothingYet` Nothing yet / Ancora niente.
- DELETED `fc.preview.total`, `fc.preview.idealGross`, `fc.preview.idealNet`, `fc.preview.idealBasis`.
- REWORDED `fc.preview.price` under the same key: «Selling price» / «Prezzo di vendita» (was «… (VAT incl.)» / «… (IVA inclusa)»).
- `fc.howItIsSold` is no longer drawn (the section it titled is split between Product and Price); the key stays in the dictionaries, as in the current app.

**Specs**: new `FoodcostSection.readMode.spec.tsx` (which view opens; the pencil, Back, Save and the focus; the new product's address; the six cards in order in both views; the box's details
behaviour; no control in the read view; «Not set»; two decimals and the venue's layout in Italy; pieces; the weighing pair and its warning; the line notes; the labour hint; «Cost per 1 kg» once;
the suggested price without its button; the read view following the store, the deletion on phone and split; the tablet; the history guard and Delete), new `readText.spec.ts`, and the summary tests
rewritten in `FoodcostSection.preview.spec.tsx` (the dialog's five figures and «Details», dashes, the checklist, Italy; the card's summary: its rows, no VAT, partial, no target, «Details» kept open,
not drawn while nothing is costed). Existing specs changed for the ported behaviour (a costed product now opens to read, so they press the pencil first through
`intoForm()` in `testing/foodcostEditorFixtures.ts`): `editor`, `editor.lines`, `editor.vat`, `perKg`, `perKgFault`, `archivedRecipes`, `recipeBack`, `recipeFixes`, `product`.

**Differences from the current app, on purpose or by necessity**
- The mode lives in the page's state, not in a function-level `activeEditor`; the read view and the form are two components (`ProductRead`, `ProductForm`) under `ProductEditor`, which owns the choice.
- The pencil and Save are the bar's buttons on a phone and on the split alike (the current app builds a second bar for the tablet's pane).
- The look is Mise 2's own (tokens, `--sunken` ground for the cards and the summary, lucide icons), not `foodcost.css`.
- The summary row of the food cost keeps the dot AND the word (item 24's rule); the current app's dot is alone.
- The old form kept the answer panel and «Cost per 1 kg» at the very top; the current app, after #483, puts them in the last card. Mise 2 now does the same.
- A weight in the oven-loss pair reads «1000.00 g» (two decimals, grouping per the venue's layout), as `fcNumber` writes every plain number.
- The phone's own back gesture from a pencil form goes to the list, not to the read view (see above).
- The read-or-form choice is made when the product first appears. If a product's recipes and prices have not arrived at that moment (a reload straight at a product address), a costed product can
  open in the form; the current app has the same race. The pencil/Back path is unaffected.

## Line costs and «Which?» as built (10 Nov 2026)

Item 26 of `docs/mise2-port-owed.md` (current-app PR #485: `02839278`, `ec896ccf`, `b38e34cb`; #490's two decimals already in `line-cost.js`). Branch
`feature/mise2-next-foodcost-line-costs`, cut from the read-first card (item 25).

**Ported**
- `shared/src/foodcost-model.ts`: `componentLineCost`, `packagingLineCost`, `unpricedParts`, `unpricedReasonText`; `batchTotals` and `packagingPerUnit` now cost each line through the first two,
  exactly as the original (ONE place a line is costed: the card's money and the batch total cannot disagree). This also closes the old gap where a null table made the port's `batchTotals` throw:
  `batchTotals`, `productionCost`, `costProduct`, `sortByMargin`, `productPreview` and `costPerKg` agree with the original on every odd input again (the `PORT_OWED` set of `odd-inputs.spec.ts` is
  empty). `productPreview` gains `unpriced` (the «Which?» list). `productionCost` itself did not change in #485.
- `app/src/foodcost/lineCost.ts` (`lineCostView`): `{ text, noPrice }`, every figure through `fcMoney`. Drawn in its own element above the note under every «Made of» line (recipe and
  ingredient) and every packaging line, in the form (`LineRow.tsx`, `lineMoney()` in `lineNotes.ts`, caught to «no money» on a fault like the summary) and in the read view (`ReadSections.tsx`).
  `lineNote` is #485's: a recipe says only «Only part of this recipe has a price», an ingredient never repeats «no price», a packaging item says only «Priced by weight…» (the old
  «each · money» note is gone). «— No price» is the money line's, so the note that said the same is left out. The look: `.cost` in `LineRow.module.css` and `ReadSections.module.css`
  (muted `--ink-2`, `--fs-sm`, wraps).
- «Which?» in `PreviewPanel.tsx`, under the partial warning: a bare `Button` with `aria-expanded` / `aria-controls`, a ≥ 44px target (`--hit`), closed by default, each item the name plus
  «reason» or «reason in “recipe”». The card (`ProductSummary.tsx`) keeps its open state across redraws like «Details»; the phone dialog (`ProductPreviewDialog.tsx`) lets the panel keep its own. #485 put the
  list nowhere else (the answer panel does not list it).
- i18n: sixteen keys in `en.ts` / `it.ts` worded as `js/i18n.js` today (`fc.preview.which`, `fc.unpriced.*`, `fc.line.perKg/each/withAmount/notExact/noPrice`), plus the nine the recipe-row reasons
  of «Which?» need and Mise 2 did not have: `cat.cost.*` (eight) and `cat.notWeighedPiecesSpoons` (the catalogue's `COST_REASON_TEXT`, which `costReasonLabel` looks up in the original).

**Differences from the current app**
- ADAPTED, as `price-model.ts`: the translator is the LAST argument of `unpricedParts(product, tables, t)`, `productPreview(product, tables, t)` and `unpricedReasonText(reason, t)`. The app hands in
  `foodcostTranslate(t)` (`foodcostWords.ts`), which only narrows the type; `foodcostWords.spec.ts` asks for every key in both languages. `costReasonLabel` is NOT ported: `unpricedReasonText`
  looks `COST_REASON_TEXT` up itself (the same keys, the same words under the same dictionary). The arity check of `foodcost-model.spec.ts` lets these three take one more argument.
- `UNPRICED_REASON_TEXT` stays module-private, like the original's (the names-equal check pins the exports).
- `lineCostView(t, money, entry, kind, tables, options)`: translator and money first (the app's convention), and it also reads a Map of ingredients; the original reads a plain object.
- The ingredient line's money is no longer refreshed by hand on every keystroke (the original's `refreshLive`): React draws it from the working copy.
- `.note[data-kind="packaging"]` (muted colour for the old «each · money» note) is gone: the packaging note is now a warning like the others.
- Item 22's `PerKgBlock` and `per-kg-model.ts` were already in step with #485's per-kg change (a comment only).

**Specs**: `shared/src/foodcost-line-costs.spec.ts` (the model half of `tests/foodcost-line-costs.test.mjs`, both files), the preview test of `foodcost-model.spec.ts` compares `unpriced` too, the
`odd-inputs.spec.ts` entries for the four new functions and the rewired `batchTotals` / `productPreview`; `app/src/foodcost/lineCost.spec.ts`, `foodcostWords.spec.ts`,
`FoodcostSection.lineCosts.spec.tsx` (the form, the read view, «Which?» on the card, in the dialog, by click and keyboard, redraws), the CSS spec, and four existing specs reworded for the new notes
(`editor.lines`, `readMode`, `twoDecimals`).

## Narrowed list on the split as built (item 23, 10 Nov 2026)

- Current app 35b1f3e0 (#478): a recipe used by several products opens, on a tablet or PC, the product the narrowed list shows first beside it; a phone keeps
  the narrowed list. Mise 2: `RecipeEntry.tsx` decides it once, on the server's word, and REPLACES the entry with `/food-cost/product/<id>?using=<recipe>` when
  the split query matches (the list ranks with `sortByMargin`, so the same product is on top), else `/food-cost?using=<recipe>` as before. It waits for the
  recipes and ingredients first (an emulator drive found the first tap ranking with empty tables, by name), not for the labour rate (it never enters the
  food cost %); the source passes the ingredients on only once their prices have answered too (`foodcostSource.ts`); known and harmless: a local copy answers at once, with yesterday's prices.
  That product sits at depth 1 and not «from the list»: its own Back / Save / Delete replace it with the narrowed list CARRYING the depth (`useLeave`,
  code review), so the list's Back still reaches the recipe in one step, by a POP. Spec: `FoodcostSection.recipe.spec.tsx`, «on the split, opens the product the narrowed list shows first beside it».
- Back landing on the recipe's Food cost card (35b1f3e0's `&at=foodcost`) needs nothing here: the recipe screen restores its place on a POP from Food cost
  (`recipes/recipeReturn.ts`, origin 'cost').
