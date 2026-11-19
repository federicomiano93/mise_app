# Bookings («Prenotazioni») — Mise 2

NEW IN MISE 2, no original in the current app. The owner's plan of 18 Nov 2026 (customer bookings taken at the counter tablet of
Panificio Miano, with two printable slips), in five steps: 0 the printer test on the Epson FP-81 II RT, **1 this section**, 2 prices
from Food cost through a published price list, 3 direct printing to a receipt printer, 4 a WhatsApp reminder button.

**Where it stands (18 Nov 2026, end of session)** — every step is built; nothing past step 1 is live.
- Step 1 — merged into `main` (#572).
- Step 2 — PR #573 (`feature/mise2-bookings-2`), base `main`, CI green, mergeable. ⚠️ Deploy the rules first (the `price-list`
  block), then merge.
- Step 3 — PR #576 (`feature/mise2-bookings-3`), base step 2, CI green. Waits on **step 0**: the owner's test page on the real
  Epson (preview link on the PR works for it; «Step 3 as built» below). If the printer cannot be reached from the tablet, the
  fallback is the computer of the management software (`print-agent/`), not built yet.
- Step 4 — PR #577 (`feature/mise2-bookings-4`), base step 3, review fixes pushed; GitHub's CI on its last commit not yet seen.
- Open for the owner: the language of the WhatsApp message and of the slips in a mixed-language venue; whether to record that a
  reminder was sent (a new field + rules); clearing the counter tablet's browser history (the wa.me address keeps the message).
- Merge order: 2 → 3 → 4, each retargeted to `main` once the one below is merged.

## Step 1 as built (18 Nov 2026)

Branch `feature/mise2-bookings-1`, one PR into `main`. Nothing deployed. ⚠️ Merging into `main` IS going live for the server half:
`deploy-functions` publishes the scheduled function and the `setStaffCard` that accepts `bookings` on that push. So, on the owner's
word and in this order: `firebase deploy --only firestore:rules` (add-only, safe for the current app), `firebase deploy --only
firestore:indexes` (the `bookings.date` collection-group override), check the deploy account may create Cloud Scheduler jobs (the
project's first: the Cloud Scheduler API enabled, the `github-deploy` service account allowed to manage jobs), then the merge.

**Where it is and who sees it.**
- Section `bookings`, path `/bookings`, Lucide `CalendarCheck`, right after the Home in `SECTIONS` (rail: the second item; phone: under
  «More», the five tabs are fixed). Loaded lazily (`shell/sectionScreens.ts`). Usage names `bookings`, `bookings-detail`,
  `bookings-editor` (`m2:` in front), never an id.
- Every role, employees included. Hideable from employees by «Sections for employees» like every everyday section: a new card id
  `bookings` in `STAFF_CARDS` (`js/home-cards.js`, its byte copy `functions/home-cards.js`, the port `shared/src/home-cards.ts`),
  `optIn: false`, so the server's `setStaffCard` accepts the switch. Its section `bookings` is not one of the current app's sections,
  so the current app (whose switch screen lists only the sections it knows, and whose Home has no such card) never draws it.
- A venue can switch the section off with `sections.bookings: false` on its document (console), read as the rules' `sectionOn()`
  reads it (`session/visibility.ts` `venueHasSection`: the shared port `shared/src/sections.ts` is paired with `js/sections.js`, so the
  name is not added there).
- Partial owners: **the sales owner has it, the kitchen owner does not** (bookings are customers at the counter, the sales side;
  `ROLE_CARDS`). The rules refuse the kitchen owner too (`usesBookings`).
- The rail now holds ELEVEN items for an owner: the short-window steps moved (`shell/AppShell.module.css`, `railHeight.spec.ts`):
  64px above 903px of height, 56px up to 903, 52px without the brand letter up to 815, and up to 715px 49px items with the rail's own
  padding and gaps tightened — 637px, so the lab tablet's 648px still fits with no item under 48px.

**The list** (`BookingsList`): «New booking» (the primary action), four choices — Today, Tomorrow, Later (every day after tomorrow, a
heading each), Past day (a date box limited to the last 30 days, with the sentence that bookings are kept 30 days) — then the rows of the
day by time (cancelled last, struck through): time, name, the first two products («1,5 kg Focaccia, 2 pz Panettone +1 more»), a
Pickup/Delivery tag and the status tag (To do amber, Ready green, Collected grey, Cancelled red). From 1000px the list is on the left
and the booking on the right («Pick a booking to see it here.» until one is picked); on a phone one at a time. The choice of day is the
section's own state, not the address. After a save the list opens on the booking's day with the focus on its row.
The section OWNS the scroll (architecture rule 9): on a phone a booking opens at the top and Back puts the list where it was; on the
split the list keeps its place and the booking sticks to the top of the scroll area, scrolling on its own. A booking opened from the
list, and the editor opened from the list or the booking, go back by the browser's Back; a save REPLACES the editor with the list.

**A booking** (`BookingDetail`): Back, «Booking No. 7», Edit (primary). The four statuses as a group of buttons: a tap saves it at once
(«Ready.»); Cancelled asks first. When (spelled day · time, Pickup/Delivery), Customer (name, phone as a call link, the address for a
delivery), Items (quantity, name, note), Notes, Payment (Total, Deposit, To pay, only what is known). Two print buttons, «Lab slip» /
«Foglio laboratorio» and «Customer slip» / «Biglietto cliente». A small bin at the foot: «Delete this booking?», which also says to use
it when a customer asks for their data to be deleted.

**The editor** (`BookingEditor`, P20): a working copy, nothing saved until Save; «Unsaved changes» under the title; `markBusy()` while
dirty; the router's blocker asks «Discard changes?» on every way out (Back, the browser's Back, the rail, a row of the list beside it).
A new booking starts EMPTY, with placeholders, neither Pickup nor Delivery chosen. Save checks the required fields in the order of the
form, stops at the first wrong one, puts the focus there, marks it (red box, the reason under it) and says «Check “Phone”.»; then
asks «Save this booking?» (name, day, time) and returns to the list. Fields and rules:
- Customer: Name (required, ≤80), Phone (required, ≤30, digits, spaces and + only), Pickup or delivery (required, two big radio
  choices), Delivery address (shown and required only for a delivery, ≤200; a pickup stores none).
- When: Day (required; a NEW booking cannot be for a day already gone, an existing one keeps its day), Time (required).
- Items: one row to start, «Add a product» up to 50, an × on each row when there is more than one. Product (the recipe book's names
  suggested as you type — a datalist — or free text; a name that matches a recipe exactly is linked to it and tagged «From the recipe
  book»), Quantity (above zero; whole for pieces, grams for kg), Unit (pieces / kg), a note per product (optional, ≤120). A row left
  blank is dropped; no row at all is refused («Add at least one product.»).
- Payment: Total and Deposit, both optional, typed by hand for now (step 2 computes the total), the venue's money symbol in the label,
  «12,50» or «12.50» read the same, «1.234,50» refused; «To pay» = total − deposit shown when both are typed, never below zero.
- Notes (optional, ≤500), with the visible warning «Do not write the customer’s allergies or health information here.»
- Delete (existing booking): the small bin at the foot of the form, with the same question.

**The slips** (`BookingSlips.tsx`, `slipHost.tsx`, `booking-slip.css`, `booking-slip-page.css`): printed through the browser's dialog
from a host built in `document.body` and scoped by the class `slip-printing` on `<html>` (never `:has`, Chrome 101), the label's road.
The page is 80 mm × 297 mm with 4 mm margins (72 mm of text): on a receipt printer the width is what matters, on A4 a page of A4's own
height prints at true size, a strip down the left. Black on white, no token.
- Lab slip: «LABORATORIO» and the number, spelled day · time, PICKUP/DELIVERY, the products with quantities and their notes, the
  booking's notes. **No name, no phone, no address.**
- Customer slip: the venue's name (`locations/{lid}.name`), the number (large), the customer's name, «Ritiro: 24/12/2026 09:30», the
  products, Total / Deposit / To pay (what is known), and the privacy line at the foot (to be reviewed by the owner).
- Interface words through `t()` (the venue's language); the unit word («pz» in Italy, «pcs» elsewhere), the numbers and the dates
  follow the venue's COUNTRY (`bookingWords.ts`), money through `formatMoney` with the venue's money. Product names as stored.

**The Home** (`home/BookingsTodayPart.tsx`): «Prenotazioni di oggi» / «Today’s bookings», today's bookings still to hand over (To do
or Ready) by time, «09:00 · Anna — Ready», a tap opens the booking. Not drawn when there is none, nor for somebody the venue does not
show Bookings to (nothing read). Its listener reads today's bookings only (`date == today`, at most 200). It shares the right-hand column with «Ordini da fare» (two columns from 1000px while either is drawn).

**Data** (`locations/{lid}/bookings/{autoId}`, the `firestore-rules` skill's `data-model.md`): closed whitelist, every key on every
write, `createdAt` once and `updatedAt` every write by the server, the short number given once (max + 1, back to 1 after 9999; two
devices offline at once can repeat a number — it is a label on paper, never a key). ONE listener while the section is open:
`date >= today − 30`, newest first, at most 500. Local-first: every write goes into Firestore's offline queue at once and the screen
never waits for the server; a save the server REFUSES is kept in memory and the list offers it back («A booking was not saved. Open it
to try again»); a restored save of a booking deleted on another device meanwhile is made again as a new booking. A Save writes the
booking's status as it is NOW (a status set on another device while the editor was open is never put back).

**Deletion after 30 days**: the scheduled function `deleteOldBookings` (Functions v2 `onSchedule`, `REGION`, daily at 03:17 Europe/Rome,
pages of 400, counts only in the log), the project's FIRST scheduled function (Cloud Scheduler: 3 jobs free). It needs the
collection-group field override on `bookings.date` (`firestore.indexes.json`, now named in `firebase.json`), deployed with
`firebase deploy --only firestore:indexes`; `deploy-functions` deploys only the function.

**Tests**: `bookings/bookingModel.spec.ts`, `bookingsStore.spec.ts`, `BookingsSection.spec.tsx` (list, booking, slips, editor),
`BookingsSection.visibility.spec.tsx`, `home/HomeSection.bookings.spec.tsx`, `tests/booking-cleanup.test.mjs`, the `bookings`
scenario of `tests/rules/firestore-rules-check.mjs`, `tests/rules-read-budget.test.mjs`, `tests/home-cards.test.mjs`.

**Left as they are, for the owner** (review, 18 Nov 2026): Firestore's offline copy on a device keeps a booking it has read until
the next sign-out or venue switch, even after the server deleted it at 30 days; the lab slip prints the booking's notes (free text,
which could hold a detail like a doorbell name); a UK venue whose interface is Italian prints the slip's words in Italian with units
and dates in the British way; a new booking made while the bookings stream is broken can repeat a short number.

**Not driven yet**: the emulator at 1024 / 360 / 296 in Italian and English with axe-core, the counter tablet (Chrome 101), a real
print on the Epson FP-81 II RT or any receipt printer, the scheduled function on a real project.

## Step 2 as built (18 Nov 2026) — prices from Food cost through a published price list

Branch `feature/mise2-bookings-2`, stacked on step 1. The owner's four answers (18 Nov 2026): he ticks which products go on the
list; the total is computed and the counter may type over it; the product box suggests the price list first (the recipe book no
longer); a booking already taken keeps its prices.

**Food cost — «Listino prenotazioni» / «Bookings price list»** (`foodcost/PriceListScreen.tsx`, `/food-cost/price-list`, usage name
`foodcost-price-list`): a full-width button under «New product» and Settings, for whoever runs the place only (an employee shown
Food cost has no button and is sent to the list from the address). Back · title · «Publish». A sentence (the counter sees only the
name and the selling price, VAT included, never costs or margins; nothing changes until you publish), «Never published…» or
«Published on 18 November at 10:30 · 12 products», then one tickable row per product that has a selling price and a way of selling it,
A→Z: «Focaccia — £12.00 per kg», «Panettone — £25.00 each», «Grissini — £3.50 per pack (250 g)». Ticks start from the published list
(none before the first publish). A product whose name or price changed since publishing says «Changed since publishing (the counter
still sees £22.00)». Products with no price are counted under the list; published products that lost their price are said above it.
«Not published yet» under the title while the ticks differ; `markBusy()` and «Discard changes?» on every way out. «Publish» asks
«Publish the price list?» («The counter will see N products at these prices. Bookings already taken keep their prices.») and writes
at once (local-first; a refusal is said). Figures through `fcMoney`, as everywhere in Food cost.

**Data**: `locations/{lid}/price-list/bookings` — `{ bakery, items: [{ productId, name, price (gross), per: 'piece'|'kg'|'pack',
packSize?, packUnit? }] (≤300), publishedAt (server time) }`, written WHOLE at each publish by `cardAccess(foodcost) == 'manage'`,
read by `usesBookings(lid)` or anyone Food cost lets in, never deleted (an empty list is a publish). The shape lives in
`shared/src/price-list.ts` (new in Mise 2, not paired), read by both sections, so neither imports the other.

**Bookings**: the editor watches the price list instead of the recipe book. The product box suggests its names (each with its price
as the suggestion's label); a name on the list tags the line «From the price list · £12.00 per kg», sets and locks the unit (a
kilo price in kg, a piece or a pack in pieces) and says «Comes to £18.00». A saved line left as it was (same name and unit) keeps
the price it was saved with — «Price when booked · £10.00 each unit» — or keeps having none; changing its name or unit takes
today's price. The «Total» box is optional: empty, it uses the list's sum («Leave empty to use the price list’s total: £18.00.»);
typed, it wins («Typed by hand. The price list’s total would be £18.00.»). Unpriced (free-text) lines are said: «1 product has no
price: it is not in the total.» «To pay» uses whichever total applies. A booking opened again whose stored total is its lines' own
sum shows an empty box (it keeps following the lines); a typed total (a discount) is shown. Nothing published: «No price list
published yet: type the product, and the total by hand.» Each line now stores `productId` and `unitPrice` (null without a price);
step 1's `recipeId` stays on a line whose name does not change. The booking screen and the customer slip show what each priced line
comes to; the lab slip shows no price.

**Review fixes (18 Nov 2026)**: the price-list screen opens only on the SERVER's answer («Waiting for the published list from the
server — this needs a connection.»), so a phone offline with no copy is never offered an empty list to publish over the real one;
«unsaved» (the busy marker, «Discard changes?») is only ticks the person changed, while «Not published yet» also counts a price
changed in Food cost since; two ticked products of the same name cannot be published together (the counter could book only one;
the reader also keeps only the first of two names). In the booking editor a listed product's quantity is checked in the list's unit
(the one it is written in), a saved line's unit is locked while it keeps its price (the tag, «Price when booked · £10.00 each», says
why), a total from the list over 100,000 is stopped at Save, nothing is said about the list while it is on its way, and a product box
takes names up to 200 characters. A line comes to quantity × price with a half cent rounded up. The day's heading in the list starts
with a capital (Intl writes «mercoledì»).
**Packs (the owner, 18 Nov 2026: «sì, scrivi «3 confezioni (250 g)» sui fogli»)**: a product sold by the pack is booked in packs.
The line keeps what one pack holds (`packSize`, `packUnit`, from the list, and frozen with the price once saved); the editor's unit
reads «confezioni (250 g)» (locked), and the list row, the booking and BOTH slips say «3 confezioni (250 g)» — on paper in the
venue's country's words («3 packs (250 g)» in the UK), never «3 pz».

**Tests**: `shared/src/price-list.spec.ts`, `foodcost/FoodcostSection.priceList.spec.tsx`, the priced cases of
`bookings/bookingModel.spec.ts` and `BookingsSection.spec.tsx`, the `priceList` scenario of the rules suite, `tests/rules-read-budget.test.mjs`.

**Not driven yet**: the emulator at 1024 / 360 / 296 in Italian and English, the tablet, a printed customer slip with amounts.

## Step 3 as built (18 Nov 2026) — the slips straight to the receipt printer, from the tablet

Branch `feature/mise2-bookings-3`, stacked on step 2. The owner's answers (18 Nov 2026): the Epson FP-81 II RT is on the shop's
network; both slips print on it; asked whether the software could live on the tablet, he chose «the tablet direct first» — no
computer in between, and the computer of the management software (always on) only if the tablet cannot do it.

**How**: the tablet sends the slip to the printer itself, over the network, as a NON-FISCAL document of Epson's own XML protocol for
its fiscal printers (`<printerNonFiscal>`: `beginNonFiscal`, one `printNormal` per line, `endNonFiscal`), posted to
`https://<address>/cgi-bin/fpmate.cgi`. Nothing fiscal is ever sent (no receipt, no total registered, no report): a spec says so.
Text only, 42 columns, bold through the printer's font 2. `bookings/receiptPrinter.ts` (the document, the sending, the outcome),
`bookings/slipText.ts` (the two slips as lines — the same content as the browser's slips; ⚠️ the lab slip has no name, phone,
address or price), `bookings/printWords.ts` (the outcome in words).

**Why HTTPS and a certificate**: the app is a secure page, and a secure page may not call an `http://` address. The printer answers
on `https://` with its own certificate, which each device has to accept the first time (open the printer's address, Advanced →
Proceed) — and again if the browser forgets that choice after some days.
The app's security policy (`csp-plugin.ts`) lets the page reach the printer: its `connect-src` gains `https://<address>` of the
address saved on THIS device, read by the bootstrap at load, and only when it is a private network address (10.x, 172.16–31.x,
192.168.x, optional port; `bookings/printerHost.ts`). So the page loads again after the address is saved.

**«Stampante scontrini» / «Receipt printer»** (`bookings/PrinterScreen.tsx`, `/bookings/printer`, usage name `bookings-printer`):
a button at the foot of the bookings list. Back · title · Save. A sentence, the printer's address (placeholder 192.168.1.50, hint;
anything else refused on Save, marked and said), «Plain letters only (no accents, no €)» for a printer that prints them wrong.
Save asks «Save the printer?» and loads the app again. Leaving with the address changed asks («Discard changes?»), with
`markBusy()`. With an address saved: «First print on this device» — the certificate hint, «Open the printer (192.168.1.50)» (new
tab) and «Print a test page», whose outcome is said under it. A setting of the device (`localStorage`: `bookings-printer-host`,
`bookings-printer-plain`), not of the venue: every device that prints sets it for itself.

**Printing from a booking**: with a printer set on the device, «Lab slip» and «Customer slip» send to it: «Sending to the printer…»,
then «Printed ✓». When it does not print, «Not printed» says why (not reachable or certificate not accepted, no answer in 15 s, the
printer said no — with Epson's code when it gave one) and offers «Print through the browser», the dialog of step 1. With no printer
set, the browser's dialog as before.

**Step 0 — the test on the real printer (the owner, on the tablet)**: Prenotazioni → «Stampante scontrini» → the printer's address
(the same as the till's; on the printer's own setup slip, or in the router) → Salva → «Apri la stampante» and accept the
certificate → back, «Stampa una prova». Check on paper: accents and €, the bold line, the row of 42 digits whole. Wrong letters:
tick «Solo lettere semplici». A digit row cut or wrapped: the width is not 42 (tell me the count). «Non è stato possibile
raggiungere la stampante» with the certificate accepted: this printer does not answer a page on `https://`, or the browser blocks it — then the route is the computer of
the management software (`print-agent/`), to be built only then.

**Review fixes (18 Nov 2026)**: a send still running when the person opens another booking says its outcome on the section's
status line («Lab slip, booking No. 4: not printed. … Open the booking again to print it.»), since the dialog went with the
booking; the other slip's button waits while one is sending, and «Sending to the printer…» stays up for the whole 15 s. An address
with a leading zero (192.168.001.050) is refused: a browser reads it as octal, another machine. «Plain letters only» is applied to
each piece BEFORE the line is laid out, so «EUR» never pushes a price onto a line of its own; «£» becomes «GBP», other accented
letters lose the accent («ç» → «c», «ß» → «ss»). Control characters in a note are dropped (XML refuses them). The address box opens
the keyboard with dots (an iPhone's decimal pad in Italian has only a comma). A timeout says the slip may have printed anyway. The
certificate may have to be accepted again after some days (the browser's choice): the hint says so.

**Tests**: `bookings/receiptPrinter.spec.ts`, `bookings/slipText.spec.ts`, `bookings/PrinterScreen.spec.tsx` (the screen and the
direct print from a booking, with a fake printer), the printer case of `src/csp.spec.ts`.

**Not verified (no printer here)**: that the FP-81 II RT answers this XML on `https://` from a browser (its web service and its
cross-origin answer), the font numbers for normal and bold, 42 columns at its default font, how it prints UTF-8 accents and €, and
whether a newer Chrome asks a permission for the local network the first time. Every device keeps its own printer: signing out or a
browser that clears its data forgets it.

## Step 4 as built (18 Nov 2026) — the WhatsApp reminder

Branch `feature/mise2-bookings-4`, stacked on step 3. The plan's last step, «a WhatsApp reminder button», built without a server:
the app writes the message and WhatsApp on the device sends it, from the shop's own number, once the person at the counter has read
it.

**On the booking** (`bookings/BookingDetail.tsx`): under the customer's phone, «Promemoria WhatsApp» / «WhatsApp reminder», with
the line «Opens WhatsApp with the message ready: check it, then send it.» It is a link to `https://wa.me/<number>?text=…` in a
new tab — WhatsApp (the app, or WhatsApp Web) opens on the customer's chat. Shown only while the order is still to come (to do,
ready, of today or a day ahead), and only for a phone WhatsApp can open.

**The number** (`bookings/reminderText.ts`, `whatsappNumber`): digits only, with the country code. A number typed with «+» or
«00» keeps its own; one typed without gets the VENUE's country code (Italy 39, every digit kept; the UK 44, its leading 0 dropped).
The venue's own code typed without «+» («39 333 …», 12 digits; «44 7700 …») is not added twice, and a UK 0 written after +44
(«+44 07700 …») is dropped (never Italy's: «+39 06 …» keeps it).
Fewer than 8 or more than 15 digits, or a venue with no country: no button.

**The message** (`reminderMessage`), in the interface's language like the slips, the date and the money in the venue's country's
way:

    Ciao Anna Finta,
    ti ricordiamo il ritiro della tua prenotazione N. 4 da Panificio Miano:
    giovedì 24 dicembre alle 09:30

    • 1,5 kg Focaccia
    • 3 confezioni (250 g) Grissini

    Da pagare: 32,50 €
    A presto!

A delivery says «ti ricordiamo la consegna della tua prenotazione …:» and adds «Indirizzo: …». «Da pagare» is the total less the deposit, or the total when no deposit
was taken; nothing when it is all paid or there is no total. The booking's notes and the line notes are NOT in it (they are for the
lab); no price per line.

**Privacy**: the phone and the name go to WhatsApp only when the person taps and sends, to the customer themselves, about this
order (the use the slip's privacy line names). The app stores nothing about the reminder and logs nothing. ⚠️ The browser does:
the wa.me address carries the message (name, order, a delivery's address), so it stays in the tablet's browser history (Chrome
keeps about 90 days, beyond the booking's 30) and is synced if Chrome sync is on. Clearing the history, or a profile without sync
on the counter tablet, is the owner's choice.

**Tests**: `bookings/reminderText.spec.ts`, the reminder cases of `bookings/BookingsSection.spec.tsx`.

**Left for the owner**: the words follow the INTERFACE's language (as the slips) while the date, the units and the money follow
the venue's country — a venue whose screens are in another language than its customers' would send a mixed message («Hello Anna,
… giovedì 24 dicembre at 09:30»). Not the case at Panificio Miano (Italian screens, Italian venue).

**Not verified**: WhatsApp opening on the counter tablet (it needs WhatsApp or WhatsApp Business installed, or it opens WhatsApp
Web in the browser), a number from abroad typed without «+» (it gets the venue's code, wrongly), a landline (WhatsApp says the
number is not on WhatsApp). Not recorded: whether a reminder was sent (it would need a new field in the booking and a rules change).


## The rebuild, step 1 as built (18 Nov 2026) — the bookings settings

Branch `feature/mise2-bookings-settings` (cut from step 4), a PR into `main`. The owner redesigned the section on his tablet for his
real use (24 December, many bookings, fixed time slots, pickup only, no phone): four steps, each its own PR. Step 1 is the settings,
the data, the rules and the form obeying the settings; the form's new layout (step 2), the list, calendar, booking page and Home
(step 3) and the per-piece slips (step 4) come later.

**The settings document** `locations/{lid}/config/bookings` (`bookings/bookingSettings.ts`): `askPhone`, `whatsappReminder`,
`modes` ('both' | 'pickup' | 'delivery'), `slotFirst` / `slotLast` ('HH:MM'), `slotMinutes` (30/60/120), `slotLimit` (1–999,
absent = no limit), `perPieceSlips`, `extras` (≤ 40 words of ≤ 40). Every field optional; a missing or wrong one is today's form
(phone asked, reminder on, both modes, the exact time, per-piece slips on, no extras), so the other venues see no change. Read by
everybody who takes bookings; written by whoever manages them (owner, manager, the sales side's owner — the rules'
`managesBookings`). Written with merge; cleared slots and limit are deleted fields. With the phone off, the reminder is stored off.

**The screen** «Impostazioni prenotazioni» (`/bookings/settings`, `bookings/BookingSettingsScreen.tsx`), behind «Impostazioni»
under «Stampante scontrini» at the foot of the list, for whoever manages bookings only (anybody else typing the address is sent to
the list). The owner's layout: groups CLIENTE, RITIRO E CONSEGNA, FASCE ORARIE, PRODOTTI, separated by a thin line, titles in the
small uppercase legend style; names 17px semibold; every control at the same right edge, selects and inputs 160px; each
explanation behind a round «?» that opens a tinted box under the row. It opens only on the SERVER's answer (settings, products,
published list), works on a copy, asks before leaving with changes, and one Save (after a question) writes the settings and —
when the products changed — publishes the list.

**The products** moved here from Food cost («Listino prenotazioni» is gone from Food cost: screen, button and address). One card
per Food cost product with a selling price (ticked = blue border, tinted), its price line, a star (favourite), «Chiedi per pezzo»
(hidden while «Biglietti per pezzo» is off), and for a ticked product «✎ Pesi: …» (kilo products only; a dialog of chips, «es. 3
kg o 800 g», a bare number up to 50 is kilos and above it grams) and «✎ Si può togliere: …» (a dialog of ticks, PRE-FILLED from the
ingredient rows of the product's recipes — its recipe lines and the recipe it was made from — until the owner chooses; a product
with no recipe gets an empty list and a field to add by hand). The products without a selling price are named under the cards,
one line each. A published product whose name or price changed in Food cost is said («salva per aggiornare il banco»). Whoever
manages bookings but cannot manage Food cost (a venue with Food cost off) sees the published list read only, with the line «I
prodotti li cambia solo chi gestisce il Food cost.». The items gain `favourite`, `perPiece`, `weights` (kg), `removable`
(`shared/src/price-list.ts`; each read on its own, a wrong one as if unset).

**The form obeys** (`bookings/BookingEditor.tsx`): no phone box where the phone is not asked (and the booking page shows neither
the phone nor the reminder); one mode only → no choice, «✓ Ritiro» / «✓ Consegna» under the day and time (a delivery always needs
the address; an old booking in the other mode keeps the choice); slots → «Fascia oraria», «Scegli la fascia» then «09:00–10:00 ·
ancora 3», «… · piena» disabled, no «ancora» without a limit; saving writes `time` = start, `slotEnd` = end. The places are the
limit less the day's bookings in that slot (an old exact-time booking counts in the slot it falls in), cancelled ones aside, the
booking being edited counted once; a booking already in a slot keeps it even when the slot shows full. ⚠️ Counted on the device
(the owner accepted it): two tablets taking the last place at the same moment can go one over. An old booking whose exact time is
on no slot shows that time as its own choice («09:40 (come prenotato)»). «Nuova prenotazione» starts on the day the list shows
(today or tomorrow; a past day or «Più avanti» give no day). The list and the booking page still show the slot's start time only
(step 3 redraws them).

**Choices made for the owner**, to hear about: the last slot is CUT SHORT when the hours do not divide (08:00–12:30 in hours ends
with 12:00–12:30), never run past closing; the sales side's owner may change the settings too (bookings are their side, as
`canManage` gives a partial owner their own side's settings); the weights and removable lines show only on ticked products.

**Tests**: `bookingSettings.spec.ts`, `settingsProducts.spec.ts`, `bookingModel.spec.ts` (phone optional, slots, full slot,
counted once, kept time), `BookingSettingsScreen.spec.tsx`, `BookingsSection.settings.spec.tsx`, `shared/src/price-list.spec.ts`,
and the rules suite (`bookingSettings`, the bookings cases for phone '' and `slotEnd`).

**Review fixes (PR #578, 18 Nov 2026).** The slot is shown wherever a booking's time is (`bookingTimeLabel`: «10:00–12:00», or the
time alone without `slotEnd`) — slips, receipt text, WhatsApp reminder («tra le 10:00 e le 12:00»), booking page, list, Home. The
settings screen keeps its header bar (title + Back to the list) while waiting or failed. Text left in an add box (weights, left-out
ingredient, «Da aggiungere») is never silently lost: «Fatto» adds it first or stays open with the error; in the extras box it is an
unsaved change and Save adds it or blocks with the error. A refused save (`permission-denied`) says the permission is gone instead
of «controlla la connessione». A Save that changed one of `slotFirst` / `slotLast` / `slotMinutes` writes all three. The line-name
limit is 200 (`LIMITS.lineName`), not 120. Specs: `BookingSettingsScreen.review.spec.tsx` and the model, slip and reminder specs.

## Rebuild step 2 — as built (19 Nov 2026): the form's layout and the product window

Branch `feature/mise2-bookings-form`, a PR stacked on step 1 (#578, `feature/mise2-bookings-settings`). Built from the mockups the
owner approved on the tablet. The list, calendar, booking page and Home (step 3) and the per-piece slips (step 4) are not touched.

**The layout** (`BookingEditor.tsx`, `BookingsSection.tsx`). On the split (from 1000px) the open form — new or edit — takes the
WHOLE width: the list column is hidden (`fullForm` on the layout) and Back brings it back; the list's scroll place, lost while it
was hidden, is put back as the form closes (`BookingsSection.scroll.spec.tsx`). The phone is unchanged (one pane). Order: «Nome
cliente» (the label itself 20px bold; «Cliente» stays as a screen-reader-only legend) → the phone only where the venue asks for it →
«Giorno» | «Fascia oraria» side by side, labels 20px bold, stacked below 520px («Quando» screen-reader only) → one mode only: the
grey 15px line «✓ Ritiro» / «✓ Consegna», no box, not a control; both modes: the two choices → the address for a delivery →
Prodotti → Pagamento (the total still follows the cards while nothing is typed in it) → Note.

**The cards** (`ProductCard.tsx`): two per row from 700px, one on a phone. A black numbered circle (22px, renumbered on delete),
the name bold with «· 1,5 kg» (or the pack's size), a small red bin (44px target, «Togli <name>»), − / N / + (44px, + filled blue, −
off at 1; N can also be typed), the
bold line total, and the line's note. A removed card hands the focus to the card now in its place, or to «Aggiungi un prodotto».

**The product window** (`ProductPicker.tsx`, pure half `productPickerModel.ts`): a modal, one product per opening, «n di N» (N = the steps this product really asks) and a back
arrow from step 2. 1 «Scegli il prodotto»: the favourites as tiles (3 a row on the tablet, 2 on a phone) with their price, then
«Cerca tra tutti i prodotti» (every word typed, over the whole list) and «Aggiungi “…” (fuori listino)» for a name typed freely —
the old form's free text. With no favourite the search opens at once. 2 «Scegli il peso»: the item's weights, each with price per
kg × weight to the cent (`weightPrice`, half a cent up as `lineAmount`), and «Altro peso…» (a box read by step 1's `parseWeight`:
«1,5», «800 g», «3 kg»; refused with step 1's own message). 3 «Modifiche», layout D: «Nella ricetta» tiles with a round − (red tint,
struck through: «senza X») and + (blue tint: «+ X»), exclusive, pressed again to clear; a divider; «Da aggiungere» (the venue's
extras) with only a + ; the grey line under them says the note or «Nessuna modifica». «Aggiungi» closes it and adds ONE card, qty
1, the weight, the price, the note pre-filled and still editable. Escape and «Annulla» add nothing.

**The data.** A booking line may carry `weightKg` (> 0, ≤ 50 = `MAX_WEIGHT_KG`, the price list's own bound): the weight of ONE
piece; `unit` stays 'pcs', `qty` is the pieces, `unitPrice` the price of one such piece, frozen like every price. Read as none when
wrong (`weightStorable`), never written when wrong, checked by `firstProblem`. A saved weighed line stays frozen while its name, unit
and weight are unchanged. Old lines have no key and open and save exactly as stored (spec). The weight is said everywhere a line's
quantity is (`lineQtyText`: «3 pz (1,5 kg)»), so the booking page, both slips, the receipt text and the reminder never lose it.
A new booking starts with no card (the window adds them); Save with none says «Add at least one product» on «Aggiungi un prodotto».

**The rules.** Only the comment of `match /bookings/{id}` changes (the line shape now names `weightKg`). ⚠️ Rules cannot look inside
the `lines` list, so a wrong `weightKg` is NOT refused by the server — the app's model is the only check, as for every other key of a
line. The rules suite pins that weighed lines are accepted and, honestly, that a 0 / negative / too big / text `weightKg` is not
judged there. No deploy is needed for this step (a comment); deploying it is harmless.

**Choices made for the owner, to hear about:**
- A kilo product with NO weights set still gets step 2 (only «Altro peso…»): otherwise the counter could not say how much.
- A name typed freely also gets step 2, with «Senza peso (a pezzi)» first: the old form let free text be booked in kilos.
- «Nella ricetta» shows the product's `removable` only. When it was never chosen (null) the group is hidden: the form does not read
  the recipes (an employee at the counter may not be allowed to), so no recipe fallback.
- The note box is 44px tall, not the mockup's 40px: the app's touch-target floor.
- N on the stepper can be typed as well as stepped (30 panettoni are not 30 taps).
- An old line of kilos (before weights) keeps its card in kilos, «kg» after its number and «… al kg» as its price.

**Tests**: `productPickerModel.spec.ts` (favourites, search, free name, which steps, −/+ exclusive, extras, the note, «3 pz (1,5 kg)»),
`BookingsSection.form.spec.tsx` (the order, the big labels, the full-width layout, «✓ Ritiro», the window's three steps, «Altro
peso», a free name with and without weight, Escape, no product, the stepper, renumbering, Italian), `bookingModel.spec.ts` (the
weighed line: picked, priced, written, read back frozen, old lines unchanged, wrong weights), the editor specs moved to the window
(`BookingsSection.spec.tsx`, `.settings.spec.tsx`, test helper `testing/bookingForm.ts`), the scroll spec, and the rules suite
(1637 checks). Driven in Chromium on the emulator, IT (miano@club.test) and EN (manager@club.test) at 1024, 360 and 296: the form,
each window step and the cards, axe-core, sideways scroll, targets, clipped text, focus kept in the window — 186/186. With ANY modal
open axe flags the shell's scrolling `main` (`scrollable-region-focusable`); the app's existing «Scartare le modifiche?» dialog does
the same, so it is app-wide and not this step's. Not done: the real SM-T550 tablet.

**Review fixes (19 Nov 2026).** The note the window writes is printed on both slips, so its words follow the venue's COUNTRY
(`changeWords` in `bookingWords.ts`: «senza cipolla» in Italy whatever the screen's language), as the slips' units do. The card's
bin and the window's back arrow are 48px (`--hit`); the round − / + stay the approved 44px. Adding the 50th product (the limit)
gives the focus to the new card, as «Aggiungi» disappears. Enter in the search takes only the product whose name is exactly the one
typed (or the typed name when nothing matches), never the only partial match. A weighed price that rounds to 0,00 is no price
(stored as 0 it would read back as none). On the split, a scroll event caused by the form opening (the reset to the top, the area
clamped as the list hides) is no longer taken for the list's place: checked in Chromium, list scrolled to 900px → form → Back →
900px. Still for the owner: a product's name is not edited on its
card (remove and add again, at today's price).

**Step 2 review fixes (19 Nov 2026).** The line note limit is 300 (was 120, cut silently): the window refuses a longer note
with a message instead of cutting it. The card decides kg vs pieces with `effectiveUnit` (the list's unit when the product is
listed), the same as the save. `parseWeight` also reads «gr», «hg», «etto», «etti». The counter counts only the steps this
product asks («1 di 2»). Favourites that arrive after the window opened replace the search unless something was typed. The
card shows only the bold line total, no price of one (the owner's choice on the tablet, 19 Nov 2026).

**Owner's changes on the tablet (19 Nov 2026).** No «Pagamento» title: «Totale (€)» stands out on its own (big label, large bold
value), and when left empty the list's total shows in grey inside the box, following the products; a typed number replaces it and
the line under it says what the list would have given. No field says «facoltativo» any more (bookings form; the Calculator's
«Calcolato da» placeholder is just «Nome»). The notes box no longer carries the line «Non scrivere qui allergie o informazioni
sulla salute del cliente.» — taken away at the owner's request (the line at the top of this file describes the old form).

## Rebuild step 3 — as built (19 Nov 2026): the calendar list, the booking page, the Home card

Branch `feature/mise2-bookings-list`, a PR stacked on step 2 (`feature/mise2-bookings-form`). Built from the mockups the owner
approved on the tablet, for 24 December: many bookings, each picked up in a time slot, ticked off at the counter. No saved field,
no rules change: the status values stay as stored (`todo`, `ready`, `collected`, `cancelled`).

**The list** (`BookingsList.tsx`, `BookingsCalendar.tsx`, `BookingLines.tsx`; left column on the split, the whole screen on a
phone). The Today / Tomorrow / Later / Past day buttons are gone: a month calendar — the month's name between ‹ and › (44px), the
weekdays Monday first from `Intl` (L M M G V S D, M T W T F S S), 44px-tall day cells, today ringed, the picked day filled with
the accent, an orange badge with the day's bookings, cancelled ones NOT counted (`dayCounts`). One Tab stop for the month (the
picked day), the arrows move between its days, Enter or Space picks; a table, so each day is heard with its weekday column, and its
name is the full date and the count in hidden text (no aria-label). It opens on today; tapping a day lists that day under it. A
«Cerca per nome» box at the top of the day's card filters its rows as you type, case and accents folded (`foldForSearch`,
`dayRows`). Each row: the slot box on the left (the start big and blue, the end small under it; an exact time alone), the
customer's name (the row's link, its `::after` stretched over the row), the products one per line with a black numbered circle,
the quantity in normal weight and the name in bold («3 pz (1,5 kg)» for a weighed line, step 2's `lineQtyText`), the mode tag, and
at the bottom right «✓ Ritirata»: one tap, no question, sets `collected` (name and products greyed and crossed out, the button
becomes «Annulla», which sets `todo`). A cancelled row has no button, an «Annullata» tag and is crossed out. «Nuova prenotazione»
pre-fills «Giorno» with the picked day.

**The data** (`bookingsSource.ts`, `bookingsStore.ts`). The listener reads ONE calendar month — `date >= 'YYYY-MM-01'`,
`date < ` the next month's 1st, by date, at most `READ_LIMIT` = 1500 — instead of «30 days back and every later day, newest first,
at most 500». A new month is a new query (`store.watchMonth`), the old one dropped first; the store's snapshot carries the month its
items cover, so another month's bookings never stand in while the new one loads. Single-field range and order: the automatic index,
no `firestore.indexes.json` change. A month long gone reads empty (the scheduled deletion 30 days after the day). While a form is
open the listener follows the FORM's days (`useReportFormDay`): the day typed — so a slot's free places and the next short number
are counted on the month the booking is for — and, for an existing booking, the day it is stored on, in ONE query from the first
month to the last (`watchMonth(first, through)`), so a booking moved to another month is still found (its status now; a refused
move opened again UPDATES it instead of making a copy: the refused save keeps `storedDate`). Save waits («Un attimo…») while that
month is loading; when only this device's copy has answered for it (offline, a month never opened here: the snapshot's
`confirmed`), the save question adds that the places and the number could not be checked. A booking opened by its address in a
month the listener does not hold (a typed or shared link) has its day read once (`source.dayOf`, one `getDoc`) and the section
opens that month. A tap on a status is laid over the listener's copy until the server answers, so the row changes on the tap
itself; a refusal takes it off — the row is back as the listener has it — and the section says «Non salvato: la prenotazione è
tornata com’era» (or the no-permission words); an EARLIER tap refused after a later one says the plain «non salvato». Back from a
booking puts the focus on its row.

**No «Da fare» / «Pronta» anywhere** (`STATUS_WORD`): a booking is open, Ritirata or Annullata; a stored `todo` or `ready` both read
as open (`isOpen`). The cancel question no longer says «puoi rimetterla “Da fare”».

**The booking page** (`BookingDetail.tsx`) takes the whole width on the split, as the form (the list hidden; Back brings it back
where it was). Its h1 is the CUSTOMER'S NAME (`FormBar level={1}`, the page drawing no title of its own: `Page ownHeading`; the
browser tab keeps «Prenotazioni»), «Prenotazione N. x» small and grey under it, Edit the pencil alone (named «Modifica»). Status:
«Ritirata» / «Annullata» only; a tap on the one on returns the booking to `todo`; «Annullata» still asks first. «Quando» says the
day and the slot. No «Cliente» group when the venue does not ask for the phone and none is stored; a stored phone is shown (with the
WhatsApp reminder only where the settings turn it on); a delivery shows its address there. The products are numbered as in the
list, the price at the right edge, then Totale / Acconto / Da pagare as before. The print buttons read «Laboratorio» / «Cliente»
with the printer, named «Stampa per laboratorio» / «Stampa per cliente»; what they print is unchanged (step 4 changes the slips).
The page puts the focus on its h1 whenever the page would have (not on Back, not on a first load).

**The Home card** (`home/BookingsTodayPart.tsx`): only the open bookings, each row «09:00–10:00» blue and bold, the name, «2 prodotti»
in grey at the right, the chevron; no «— Pronta / — Da fare».

**Choices made for the owner, to hear about:**
- The short booking number now counts within the MONTH of the booking's day (the listener holds one month): the first booking of an
  empty month is N. 1 again. ⚠️ REVERSED after review (19 Nov 2026): an EXISTING booking ALWAYS keeps its stored number, also when it is
  moved to another month where that number is already used (two bookings of a month may then share a number; the slips carry the date).
  The rules refuse an update that changes `number` (the rules suite pins it), so a renumbered move was refused on every retry; the fake
  source now refuses it too. Only a NEW booking gets the next number. Two devices offline at once can still give the same number, as before, and so can a month this device
  has never read while offline (the save question says so).
- The arrows ‹ › also pick a day: today in today's month, else the 1st of the month shown.
- A day already gone picked in the calendar gives «Nuova prenotazione» no day (the form refuses a past day for a new booking).
- «Cerca per nome» empties when another day is picked: a name typed for one day would hide another day's rows without a word.
- At 296px seven 44px cells cannot fit: the day cells are 44px tall but about 36px wide there (at 360 and on the tablet they are 44+).
- A row's product notes («senza cipolla») are not in the list: they are on the booking page and the slips.
- A tap on «Ritirata» / «Annulla» says a short line at the foot («Ritirata: Mario Rossi.»), as the booking page does.
- A delivery with the phone off keeps a «Cliente» group holding only the address.
- The open booking's day rides in the history entry, so a reload on a booking of another month opens that month.

**Tests**: `bookingModel.spec.ts` (months, Monday first, counts without cancelled, search folding, `todo`/`ready` open),
`bookingsStore.spec.ts` (one month, re-query, the tap overlay and its refusal), `BookingsSection.list.spec.tsx` (the calendar, the
re-query on ‹ ›, search, the rows, one-tap Ritirata / Annulla and a refused tap, the pre-fill, the form's month, the booking page's
header, status, prints, Italian, no Cliente group, focus, a reload on another month; the review fixes: both months while a move is
edited, a refused move saved again updates, the number in the new month, the offline warning, an address in another month, the
focus back on the row, a first load leaving the focus alone), the settings, scroll and form specs moved to
the new layout, `home/HomeSection.bookings.spec.tsx` (the rows). Driven in Chromium on the emulator, IT (miano@club.test, no phone,
slots) and EN (manager@club.test) at 1024, 360 and 296: Home card, list, search, a tap on «Ritirata» then «Annulla» (put back), the
next month and back, the booking page, the keyboard on the calendar — axe-core, sideways scroll, targets, clipped text, one h1,
console errors: 42/42 (run again after the review fixes). axe was run with React Aria's own live announcer (`[role="log"]`, an empty `role="img"` it leaves after an
announcement, app-wide) left out. Not done: the real SM-T550 tablet.

**Review fixes (19 Nov 2026)** on the same PR: (1) the number is kept on a move (above); (2) a second tap on «Ritirata» / «Annulla» or
the booking page's Ritirata / Annullata within 800 ms of a status write is ignored (`tapLockout.ts`, per row and button, the button
stays as it is); (3) a booking opened by its address in another month shows the loading line until its day has been read (`dayOf`),
and a failed read is tried again after 5 s and when the connection returns, never giving up for good; (4) a month whose result
reaches `READ_LIMIT` (1500) shows «Too many bookings in this month: some may not be shown.» (`monthMayBeCut`); (5) the calendar's
single Tab stop follows the day the arrows moved to, and goes back to the picked day when a day or a month is picked.

## Rebuild step 4 — as built (19 Nov 2026): the lab slips per piece and the customer slip

Branch `feature/mise2-bookings-slips`, a PR stacked on step 3 (`feature/mise2-bookings-list`). Built from the mockups the owner
approved on the tablet, for 24 December: many bookings of stuffed focaccia («scacciate»); in the lab each piece gets its own paper
slip with the customer's name and how many pieces they have, stuck on the piece with a toothpick so none gets lost in the oven. No
saved field, no rules change: the slips read the booking, the venue's `perPieceSlips` and each price-list item's `perPiece`.

**The question** (`BookingDetail.tsx`, `SlipChoice.tsx`). «Laboratorio» asks only when the venue's «Biglietti per pezzo» is on AND
the booking holds a line of a product marked «Chiedi per pezzo» in whole pieces (`asksSlipChoice`, `labSlips.ts`); otherwise it
prints «Tutto insieme» without a word. The app's own dialog (`useConfirm` with a body, the Pastries' «Copy day» way): title
«Biglietti per il laboratorio» / «Slips for the lab», two radio rows «Uno per pezzo» / «One per piece» (chosen at the start) and
«Tutto insieme» / «All together», Annulla / Stampa. ⚠️ No explanation text, at the owner's request: no intro line, no sub-lines
(the spec pins the dialog's whole text). The booking page now reads the published price list too (`usePriceList.ts`, moved out of
the editor; one document while the page is open); a list not read yet, refused or broken marks no product per piece.

**The lab slips** (`labSlips.ts`, `BookingSlips.tsx` `LabSlips`, `slipText.ts` `labSlipLines` / `labSlipDocuments`).
- «Uno per pezzo»: a per-piece line of N pieces gives N identical slips of one piece; any other line gives ONE slip with its
  quantity («12 × Cannoli siciliani»). 3 scacciate + 12 cannoli → 4 slips. An old line in kilos is never split.
- «Tutto insieme»: ONE slip with every line.
- Each slip, exactly: the customer's name big followed by `[N]`, a dashed line, then each product — the quantity only when more
  than one («12 ×»; a line in kilos keeps «1,5 kg», a pack «3 confezioni (250 g)»), the name bold, the weight of a piece
  («1,5 kg») — and under it the line's note split on its commas, each piece highlighted white on black around its words only (an
  inline span, `box-decoration-break: clone`, `print-color-adjust: exact` so the browser prints the black even with «background
  graphics» off: checked in Chromium's PDF). ⚠️ NO date, time slot, booking number, price, phone, address, nor the booking's own
  notes (the old lab slip's «LABORATORIO», number, day and mode are gone).
- `[N]` = how many slips «Uno per pezzo» makes for the booking, i.e. the pieces they have; shown on «Tutto insieme» too. With the
  venue's switch off every line counts one.
- Through the browser every slip is a page of its own (`.bk-slip + .bk-slip` breaks the page); the per-piece slips print on a
  page 80 × 100 mm (`booking-slip-piece-page.css`, switched on by `slipHost.tsx` only for that print) instead of 297 mm, so a
  receipt printer driven by the browser does not feed an A4's length of paper per piece. On the direct printer each slip is its
  own non-fiscal document (the printer cuts after each), sent one after another; the first that does not print stops the rest,
  the dialog says «1 of 4 slips printed.» with the reason, and «Print through the browser» prints only the slips left.

**The customer slip** (`CustomerSlip`, `customerSlipLines`): the venue's name; «Prenotazione N. 12»; the customer's name big;
«Ritiro: gio 24 dic» (or «Consegna: …»; the day short, in the venue's country's way, `slipDay`); «dalle 09:00 alle 10:00» from
`time` / `slotEnd` («alle 09:40» for an old booking with no slot); the lines numbered «1. 2 × Scacciata broccoli 1,5 kg   48,00 €»,
each with its note under it; Totale / Acconto / Da pagare, Da pagare big; the privacy line. Prices through `formatMoney` with the
venue's money, as before.

**The direct printer** (`receiptPrinter.ts`): a third line style, `big`, Epson's font 4, wrapped at 21 columns
(`BIG_COLUMNS`): the name on both slips, each piece of a lab note, «Da pagare». ⚠️ Reverse print is not verified on the FP-81 II
RT, so the note is double size there instead of highlighted (a comment says so); whether font 4 is double size, and bold, on
this model is also for the test print. «Plain letters only» now writes «×» as «x».

**Kept as it was**: the WhatsApp reminder (behind its switch); the slips' interface words follow `t()` and their units, numbers and
dates the venue's country, as before.

**Choices made for the owner, to hear about:**
- `[N]` is my reading of his paper slips («Anna Finta [3]»): how many pieces the customer has, the same on every slip of the
  booking and on «Tutto insieme». Easy to change (one line, `pieceCount`).
- The privacy line is worded for the name only when the venue does not ask for the phone AND the booking holds no phone and no
  address (an older booking with a phone, or a delivery, keeps the full line).
- The per-piece page is 100 mm long: enough for a name, one product and a long note; a longer one runs onto a second page.
- On the customer slip a quantity of one is written «1 ×» (every line says how many); on the lab slip it is not written.

**Tests**: `labSlips.spec.ts` (per-piece products and the switch, the question, 3 + 12 → 4 slips, «Tutto insieme», `[N]`, the note's
pieces, the quantity words, the short day), `slipText.spec.ts` (the lab slip's lines and nothing else, one document per slip, the
customer slip's lines, money and big «Da pagare», plain letters), `receiptPrinter.spec.ts` (font 4 wrapped at 21, «×»),
`BookingsSection.slips.spec.tsx` (the question appears or not, its whole text, Cancel, Italian, the 4 pages on the short paper,
the inline highlights, no date / price on the lab slip, «Tutto insieme», the customer slip in English and Italian, an old booking's
exact time, the privacy line, the direct printer's 4 documents, a stop half-way and the browser printing the rest), and the
updated lab-slip cases of `BookingsSection.spec.tsx` and `PrinterScreen.spec.tsx`.

**Not verified**: a real print on the Epson FP-81 II RT (font 4, 21 columns, one document per slip cut separately, accents and
«×»), the browser's print on the counter tablet (Chrome 101: the 100 mm page, the page breaks, the black highlight), and the
emulator drive at 1024 / 360 / 296 with axe-core for the new dialog.

**Review fixes (19 Nov 2026).** «Laboratorio» waits (pending) until the booking page's price list has answered once: pressed
before, a booking of 3 scacciate would have printed one slip «[2]» with no question. The printer's test page now has a
double-size line, so a printer that refuses font 4 refuses the test print first, not a real booking. A comma between two digits
is a decimal one and no longer splits a note («+ 0,5 kg ricotta» is one highlight). The 100 mm page is pinned by a spec.
**Still for the owner, after review:** the booking's own «Note» field is no longer printed on any slip (the lab slip is «exactly
this and nothing more»): a note like «tutto senza lattosio» written there instead of on a product never reaches the lab — he
should say whether it goes back on the lab slip. Nothing limits a per-piece print: a mistyped 100 instead of 10 on a per-piece
product, then Stampa, prints 100 slips (on the direct printer one after another, with no stop button).

**Review fixes and the owner's answers (19 Nov 2026).** The owner decided: the booking's general note prints on EVERY lab slip
(both modes, both paths), at the foot under the products, highlighted like a line's note (white on black in the browser, double size
on the receipt printer), split on commas with `noteParts`, nothing before it, blank prints nothing; and it prints again on the
customer slip as plain text after the lines and before the money (`.bk-slip-notes`). A per-piece print is now guarded, the same on
both paths: above 30 slips the app's own dialog asks «Stampare {n} biglietti?», above 300 nothing prints and the status line says
«Troppi biglietti ({n}): controlla le quantità della prenotazione.» (`slipCount` counts without building the slips). A cancelled
booking shows no print buttons (hidden, not disabled). «Laboratorio» is pending until the venue settings have answered as well as
the price list, so the default `perPieceSlips: true` never asks a venue that has it off. `noteParts` is a hand-written scan, no
regex lookbehind (Safari before 16.4 cannot parse one). On the direct printer a wrapped customer product note keeps its 3-space
indent on every line. The printer test page's accents line now carries «×». Nits: the loop variable `document` in
`BookingDetail.tsx` is `slipDocument`; the radio group in `SlipChoice` keeps its `aria-label` because `Dialog` exposes no title id.
**Still open:** what `[N]` after the name counts (the owner has not answered).

**Booking page and tablet layout (19 Nov 2026)** on the same PR, from the owner's design approved on the tablet. No saved field, no
rules change. **The tablet (from 1000px; the phone is untouched):** the list is the whole screen in two columns — «Nuova prenotazione»,
the calendar, the live regions and the doors «Stampante scontrini» / «Impostazioni» on the left, the picked day's card (heading,
«Cerca per nome», the rows) on the right; «Scegli una prenotazione per vederla qui.» (`bookings.pick`) is gone. A tap on a booking's
name (route `/bookings/:id`, unchanged) opens it IN the list: `BookingsSection` hands `BookingsList` the open card (`open`), drawn in
place of its row (above the rows when its row is not shown: the search hides it, its day is not loaded yet), with a 2px accent border
(`BookingDetail` `inPlace`) and an X («Chiudi», `FormBar` `backIcon="close"`) in place of Back. The list is a flex row whose left column (`.side`) animates its `width` from `calc(50% - gap/2)` to 300px in 350 ms, none under `prefers-reduced-motion`. ⚠️ A width, not `grid-template-columns`: the lab tablet's Chrome 101 cannot animate grid tracks (107 and later can) but has always animated a width. One
open at a time (another row replaces it). Closing — the X, Escape (only a key pressed inside the card: a dialog's own Escape closes
the dialog alone), the browser's Back — goes back to `/bookings` and puts the focus on the booking's row; opening puts it on the
card's h1. Picking another day closes it (a `replace`, never Back: a Back could land on an entry carrying another day) unless the
booking is on that day; a deep link chooses the booking's own day, once per booking opened. The form («Nuova», the pencil) stays
full screen, and so do the printer and settings screens: ⚠️ they sat beside the list on the right before, which the new two-column
list has no room for, so they now take the whole width like the form (Back brings the list back where it was) — a choice made for
the owner. **The booking page, everywhere:** no big «Ritirata» / «Annullata» buttons; a tag beside the name instead («✓ Ritirata»
green, «Annullata» red, none for an open one; `FormBar` `titleAfter`, outside the heading); at the foot, left of the bin, a low-key
«Annulla prenotazione» that asks first (the old cancel question, its body now says it can be reopened from the page) and, on a
cancelled booking, «Riapri prenotazione», which sets `todo` WITHOUT a question (my call: a mistaken cancel is undone at once); the
un-collect stays on the list row. No «Quando» heading on screen (kept hidden for screen readers): the day and slot first, `--fs-xl`
bold, the Ritiro/Consegna tag under it. «Prodotti» is «Ordine»; the lines (`BookingLines` `order`) are numbered «1.» in the accent
colour inside a 1.5px box with dividers and every other row on `--sunken`, quantity, bold name and weight, the note under it, the
price bold at the right — still an `ol`; the list rows keep their black circles. The print buttons wrap one under the other when
narrow, and stay hidden on a cancelled booking. **Tests:** `BookingsSection.tablet.spec.tsx` (the two columns' stylesheet, a row
opening in place with the rest still listed, one at a time, closing by X, Escape and Back with the focus returned, Escape in the
cancel dialog, a deep link choosing the day, a day change closing it), the booking-page specs in `BookingsSection.list.spec.tsx`
(no status buttons, the tags, cancel asks then cancels, reopen, double tap, «Ordine» and «1.», no «Quando», the phone unchanged).
Not done: the real SM-T550 tablet; `ui-check` is still to run.

**Review fixes of the booking page and tablet layout (19 Nov 2026):** (1) the DOM order is the phone's visual order again (New booking,
calendar, notices, the day's list, then the two doors); on the tablet the doors are DRAWN IN the left column instead (`split` prop,
once, never one hidden copy), so the Tab order is left column then the day; no `order` or `display: contents` trick for sequence.
(2) A row opened while a booking is open REPLACES the entry (list → current), so the card's X leaves for the list. (3) The open
booking's row is always drawn, whatever the search says, so its card has one stable parent and key (and keeps its place while the month
reloads); the title takes the focus only for the address it was opened at (`focusedFor`, never on a later remount), so typing in
«Cerca per nome» keeps the focus in the box. (4) Closing in the list (X, Escape, the bin, the not-found link) always REPLACES the
address with `/bookings`, never Back, so the day looked at is kept; the browser's own Back still pops to the list entry. (5) On close
the focus goes to the booking's row found by `data-booking` (opened by a tap or a deep link), else to the day's heading. (6) The
tablet keeps the page's own h1 «Prenotazioni»; the card's name is its h2 (`Page ownHeading` only off the split), so the screen no
longer swaps its heading at each open and close. A card just opened ignores its X, the phone and reminder links and the pencil for
400 ms (`useTapLockout`). (7) `FormBar` gives a title beside a tag `min-width: 0` and `overflow-wrap: anywhere`. Specs: the phone's
DOM order, open A / open B / X, typing beside an open card, save for X / pick Y / open / close, the bin, the 400 ms lockout.

## Name suggestions — as built (19 Nov 2026)

The owner's ask: under «Nome cliente» the booking form offers the commonest names of the province of Catania, so a name is two taps
instead of a word typed in full. The mockup was approved on the tablet.

- **Words, not people.** `commonNames.ts` holds two lists of words (first names, surnames), commonest first; no name is tied to a
  surname, a phone or a customer. Never fill them from a phone directory (GDPR). «Distefano» and «Di Stefano» are both there on
  purpose.
- **Italian venues only** (`countryOf(location) === 'IT'`): any other country, or none, keeps the plain box with no combobox roles.
- **Pure half** `nameSuggestions.ts`: `suggestNames(text)` → at most 5 `NameRow`s (`name`, `replaceFrom`, `typedLetters`);
  `applyName(text, row, max)`. Matching is on the word being typed (after the last space) from 2 letters, folded (lowercase, no
  accents, no apostrophes or spaces): «pata» finds Patanè, «dag» finds D'Agata. A complete word offers nothing. A compound surname
  is found by the last two words joined («Di M» → Di Mauro, only entries that hold a space) and its pick replaces both words. The
  first word offers first names first, then surnames; a later word offers surnames first. No word twice.
- **The window** `CustomerNameField.tsx` (`useNameSuggest`, used by the editor's local `TextField` through its `suggest` prop) +
  `.module.css`: a combobox like Food cost's `NameSuggest`, but floating over the fields below (absolute under the box, `z-index` 3,
  above the sticky form bar) because the owner asked for a window, not a push-down list. No heading inside; the typed letters are
  bold. It never picks by itself; Enter only on a row highlighted with the arrows; Escape, blur and a tap outside close it.
  A pick puts the word plus ONE space, keeps the focus (the pointer-down is swallowed) and the window reopens only on new letters.
- **The keyboard** can cover it: when the window opens or grows and its bottom is below `visualViewport.height` (else
  `innerHeight`), the field is scrolled to the top (`scrollIntoView({ block: 'start' })`, `scroll-margin-top` clears the form bar);
  a window that already fits scrolls nothing.
- **Saved value unchanged.** The trailing space of a pick is trimmed by `firstProblem`, the save question and `toBookingData`.
- Text: `bookings.form.nameSuggest` (listbox label), «Suggested names» / «Nomi suggeriti».
- Specs: `nameSuggestions.spec.ts` (pure, plus the lists' hygiene), `BookingsSection.names.spec.tsx` (the window, a pick, the
  arrows, Escape/blur/outside, other countries, the trimmed save, the CSS pins).
