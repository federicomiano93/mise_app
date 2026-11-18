# Bookings («Prenotazioni») — Mise 2

NEW IN MISE 2, no original in the current app. The owner's plan of 18 Nov 2026 (customer bookings taken at the counter tablet of
Panificio Miano, with two printable slips), in five steps: 0 the printer test on the Epson FP-81 II RT, **1 this section**, 2 prices
from Food cost through a published price list, 3 direct printing to a receipt printer, 4 a WhatsApp reminder button.

## Step 1 as built (18 Nov 2026)

Branch `feature/mise2-bookings-1`, one PR into `main`. Nothing deployed: the rules, the index and the scheduled function go live only
on the owner's word.

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
show Bookings to (nothing read). It shares the right-hand column with «Ordini da fare» (two columns from 1000px while either is drawn).

**Data** (`locations/{lid}/bookings/{autoId}`, the `firestore-rules` skill's `data-model.md`): closed whitelist, every key on every
write, `createdAt` once and `updatedAt` every write by the server, the short number given once (max + 1, back to 1 after 9999; two
devices offline at once can repeat a number — it is a label on paper, never a key). ONE listener while the section is open:
`date >= today − 30`, newest first, at most 500. Local-first: every write goes into Firestore's offline queue at once and the screen
never waits for the server; a save the server REFUSES is kept in memory and the list offers it back («A booking was not saved. Open it
to try again»).

**Deletion after 30 days**: the scheduled function `deleteOldBookings` (Functions v2 `onSchedule`, `REGION`, daily at 03:17 Europe/Rome,
pages of 400, counts only in the log), the project's FIRST scheduled function (Cloud Scheduler: 3 jobs free). It needs the
collection-group field override on `bookings.date` (`firestore.indexes.json`, now named in `firebase.json`), deployed with
`firebase deploy --only firestore:indexes`; `deploy-functions` deploys only the function.

**Tests**: `bookings/bookingModel.spec.ts`, `bookingsStore.spec.ts`, `BookingsSection.spec.tsx` (list, booking, slips, editor),
`BookingsSection.visibility.spec.tsx`, `home/HomeSection.bookings.spec.tsx`, `tests/booking-cleanup.test.mjs`, the `bookings`
scenario of `tests/rules/firestore-rules-check.mjs`, `tests/rules-read-budget.test.mjs`, `tests/home-cards.test.mjs`.

**Not driven yet**: the emulator at 1024 / 360 / 296 in Italian and English with axe-core, the counter tablet (Chrome 101), a real
print on the Epson FP-81 II RT or any receipt printer, the scheduled function on a real project.
