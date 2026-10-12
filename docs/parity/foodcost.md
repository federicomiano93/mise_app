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
    10,000 is refused BEFORE the question («between 0 and 10,000»); «Save Food cost settings?»;
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
