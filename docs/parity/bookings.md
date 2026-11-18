# Bookings («Prenotazioni») — Mise 2

NEW IN MISE 2, no original in the current app. The owner's plan of 18 Nov 2026 (customer bookings taken at the counter tablet of
Panificio Miano, with two printable slips), in five steps: 0 the printer test on the Epson FP-81 II RT, **1 this section**, 2 prices
from Food cost through a published price list, 3 direct printing to a receipt printer, 4 a WhatsApp reminder button.

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
the line «Opens WhatsApp with the message written: check it, then send it.» It is a link to `https://wa.me/<number>?text=…` in a
new tab — WhatsApp (the app, or WhatsApp Web) opens on the customer's chat. Shown only while the order is still to come (to do,
ready), and only for a phone WhatsApp can open.

**The number** (`bookings/reminderText.ts`, `whatsappNumber`): digits only, with the country code. A number typed with «+» or
«00» keeps its own; one typed without gets the VENUE's country code (Italy 39, every digit kept; the UK 44, its leading 0 dropped).
Fewer than 8 or more than 15 digits, or a venue with no country: no button.

**The message** (`reminderMessage`), in the interface's language like the slips, the date and the money in the venue's country's
way:

    Ciao Anna Finta,
    ti ricordiamo la tua prenotazione N. 4 da Panificio Miano, con ritiro:
    giovedì 24 dicembre alle 09:30

    • 1,5 kg Focaccia
    • 3 confezioni (250 g) Grissini

    Da pagare: 32,50 €
    A presto!

A delivery says «con consegna:» and adds «Indirizzo: …». «Da pagare» is the total less the deposit, or the total when no deposit
was taken; nothing when it is all paid or there is no total. The booking's notes and the line notes are NOT in it (they are for the
lab); no price per line.

**Privacy**: the phone and the name go to WhatsApp only when the person taps and sends, to the customer themselves, about this
order (the use the slip's privacy line names). Nothing is stored about the reminder and nothing is logged.

**Tests**: `bookings/reminderText.spec.ts`, the reminder cases of `bookings/BookingsSection.spec.tsx`.

**Not verified**: WhatsApp opening on the counter tablet (it needs WhatsApp or WhatsApp Business installed, or it opens WhatsApp
Web in the browser), a number from abroad typed without «+» (it gets the venue's code, wrongly), a landline (WhatsApp says the
number is not on WhatsApp). Not recorded: whether a reminder was sent (it would need a new field in the booking and a rules change).

