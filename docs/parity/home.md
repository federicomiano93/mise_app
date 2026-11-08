# Home — parity list and plan (step 3g)

Step 3g of the Mise 2 plan: Staff, invites, join codes, install guide, app-admin hub, Home settings,
kiosk and notifications. Its FIRST slice, 3g-1, is a new feature with no original in the current
app: the «Da fare» (To do) card on the Home.

## What the current app has

- `index.html` is the Home: one card per section, in the venue's order (`js/home-cards.js`), the
  hidden cards of `staffHiddenCards` / `staffShownCards`, and the badges. There is no to-do list.
- Mise 2 has NO Home screen yet: the address with no section in it redirects to the first section
  a person is shown (`shell/SectionRoute.tsx` `StartRedirect`), because the rail and the tab bar
  already do the cards' job of reaching a section.

## Where the request comes from

His note from the lab tablet, 23 Oct 2026 (Panificio Miano, Home): a card on the Home with things
to do, ticked like a checklist, a ticked item staying visible, a day chosen for each — «dai
priorità a questa nota rispetto alle altre». Decided by Claude on 24 Oct under his «prendi le
scelte che mi consigli» (archived in `archivio/note-superate/piano-mise-2-storia-fino-26-ott.md`).

## Decisions for 3g-1

- H1. **A Home screen comes first.** A new section `home` («Home»), first in the rail and first
  tab on a phone, shown to EVERYONE with access to the venue (like Settings), and the app opens
  on it. Today it holds only the «Da fare» card; later 3g slices may add to it.
- H2. **The phone's tab bar keeps five places**: Home, Orders, Recipes, Calculator, More. The
  Stocktake (used once a month) moves under «More». At 296px a sixth tab would not fit its word.
- H3. **One list per venue** (the bakery's whiteboard). Anyone with access adds, ticks, edits and
  deletes. Nobody's name is recorded on an item.
- H4. **Each item has a text (up to 200 characters) and a day**: today by default, any past or
  future day allowed. The day is chosen with «Oggi», «Domani» or a date field.
- H5. **What the card shows**: the overdue items not ticked (oldest first, marked «in ritardo»),
  then today, then the next 7 days, grouped by day. Items further away fold under «Più avanti (N)»
  at the foot (the 24 Oct decision said nothing about them; without the fold an item added for in
  two weeks would disappear until its week came).
- H6. **Ticking is one tap, saved at once, no question** (like an order list's tick). A ticked
  item stays on its day, struck through; a ticked item of a PAST day folds into «Fatte (N)».
  Untick is allowed from anywhere.
- H7. **Deletion, P13 — refined from the 24 Oct wording.** A ticked item is deleted automatically
  30 days after it was TICKED (the fold «Fatte» therefore shows the last 30 days). An item never
  ticked is never deleted by itself: it stays overdue until somebody ticks or deletes it. Why not
  «30 days after its day», as written on 24 Oct: an item ticked late would vanish at once, and a
  forgotten task would disappear silently.
- H8. **Add and edit** in a small form above the Home (`ui/FormDialog`): text, day, Save. No
  «Save?» question (the form itself is the explicit act, and a to-do must be quick); Back with
  typing asks «Discard changes?»; Delete is a small icon in the edit form and asks first (P20).
- H9. **No notification in v1** (push costs and adds complexity; ask him later).
- H10. **Offline**: everything works offline through Firestore's local copy; a change reaches the
  server when the connection returns.

## Data

`locations/{lid}/todos/{id}` — NEW collection:

| Field | Type | Rule |
|---|---|---|
| `text` | string | 1–200 characters (the app trims it) |
| `day` | string | `YYYY-MM-DD` |
| `done` | bool | |
| `doneAt` | timestamp or null | the server's time when ticked, null when not |
| `expireAt` | timestamp or null | set only when ticked: 30 days later (the phone's clock), never more than 32 days ahead; null when not ticked |
| `createdAt` | timestamp | the server's time on create, never changed |

Rules: every member of the venue (any role) may read, create, update and delete; closed key
whitelist; types and sizes checked on every write. Rules tests in `tests/rules/`.

**The automatic deletion: Firestore's own TTL policy** on the collection group `todos`, field
`expireAt` (P19: the platform's feature). Firestore deletes an expired item by itself, usually
within a day. Cost (P14): each deletion is billed as a normal delete, inside the free 20,000 a day;
no Cloud Function and no Cloud Scheduler job (3 free per account) is needed. It is set up ONCE on
production with one `gcloud` command, before Mise 2 goes live («Owed before the switch»); the
emulator does not run TTL, so the app also hides a ticked item older than 30 days by itself.

## Proposed slices of 3g

- 3g-1 — Home screen + «Da fare» card (this one). Size M.
- Later: Home settings, Staff, invites and join codes, install guide, app-admin hub, kiosk,
  notifications (each its own plan).

## Step 3g-1 as built

What was decided inside the brief while building (nothing in H1–H10 changed):

- **The day of «today» is `useTodayKey`** (`app/src/shell/useTodayKey.ts`, moved from home/ in the 3g-2 review), not `shell/useToday.ts`: that one gives the
  day as a SPELLED label («Friday 6 November»), which the list cannot compare with. The new hook returns the local day
  as `YYYY-MM-DD` (`todayISO` of `@mise/shared/day`), checked every minute and when the tablet wakes, and the state only
  changes when the DAY does. The model takes `today` and `nowMs` as arguments and never reads the clock itself.
- **Home is a plain section** in `SECTIONS` (`House` icon, first, `inRail: 'top'`, `inTabs: true`). `visibleSectionIds`
  adds `home` next to `settings`, so it is in every set (employee, manager, a venue with every section off) and
  `arrangeSections(...).first` is Home. `SectionRoute` needed no change: its gate is `visible.has(...)`. Stocktake is
  `inTabs: false`, so it sits under «More» with Suppliers, Pastries and Food cost. The usage statistics name it `home`.
- **Layout**: one card in a readable column, `max-width: 40rem` (left-aligned, full width on a phone), inside the shell's
  `Page`. The head holds the title (h2) and the primary «Add» button with a Plus icon; each group has an h3 (the
  overdue one in `--danger-ink`, with the words «Overdue» as well, so colour is never the only signal).
- **Rows**: a 48px React Aria checkbox (named by the item's text), then the text as a button that opens the form. The day
  tag is small (`--fs-sm`, `--ink-2`) and is drawn where the row is not under its own day's heading: «overdue · Tue 3 Nov»
  in Overdue, «Fri 20 Nov» in Later, «Mon 2 Nov» in Done. A ticked row is struck through and uses `--ink-3`
  (about 5:1 on the card; the same token as the muted text elsewhere).
- **Headings of the days**: «Today», «Tomorrow» (`day.today`, `day.tomorrow`), then the day spelled with
  `spellLongDate` of `@mise/shared/day` and a capital on its first letter (a heading has one; «lunedì 9 novembre» would
  read like a typo). The helper copies `dayTranslate` from `orders/dayWords.ts` (six lines) because a feature never imports
  another feature's folder.
- **The form**: the text field always shows its counter («15 / 200», as the field's description) and stops at 200
  (`maxLength`); «Today» and «Tomorrow» are two buttons that show `aria-pressed` (accent frame, never colour alone); the
  date is a native `<input type="date">` with a visible label, `max="9999-12-31"`, and a value that is not a whole
  `YYYY-MM-DD` (a half-typed or cleared field) is ignored, so the day can never become something the rules refuse. The text
  field takes the focus on a NEW item only. Save with no change in an edit writes nothing. Delete is an icon at the foot of
  the edit form, right-aligned, away from Save.
- **Focus after the form**: after a Save of an edit the focus goes to that row's button (looked up after the render, because
  the item may have moved to another day); after a new item, a delete or a discard of a new one, to «Add». It is set
  at once and again a frame later, because the modal hands the focus back to what opened it by itself.
- **The stream**: any answer, from the server or from this phone's copy, makes the list `ready` (no wait for the server:
  a to-do list on a phone that never loaded it and is offline would otherwise stay on «Loading…» for ever). An error keeps
  the items already there and shows «The list does not load. Check the connection.» in a status region present from the start.
- **Nothing reused from Pastries but the pattern**: store + context + fake source. `ui/FormDialog`, `ui/FormBar`,
  `ui/FoldedGroup`, `ui/useConfirm`, `ui/StatusMessage` and `session/busy.ts` are used as they are; the existing keys
  `ui.save`, `ui.back`, `ui.delete`, `ui.discard`, `common.cancel`, `day.today`, `day.tomorrow` are reused, and the
  `home.*` keys are new. The Italian wording of the discard question is the owner-agreed «Scartare le modifiche?»
  (the older sections say «Vuoi scartare le modifiche?»).
- **Specs**: `todoModel.spec.ts` (every boundary, two clock-change weeks), `todosStore.spec.ts`, `HomeSection.spec.tsx`;
  the shell and session specs that pinned the tab bar, the rail and where `/` lands were rewritten with the new lists.
- **Still owed** (not part of this slice): the TTL policy on production, the rules deploy, and the gate 5–7 checks of
  `mise2-check` (the driver in both languages at 1024, 360 and 296, the lab tablet).

### Review fixes

- **A, focus after a tick or an edit** (`TodoCard.tsx`): when a tick or untick sends the pressed row out of reach, the focus goes
  to the checkbox of the row now standing at its place in the visible order, else the previous one, else «Add»; an edit or a new
  item landing inside a closed fold puts the focus on that fold's title. A row that stays keeps the focus. `store.add` now returns
  the new id for this.
- **B, two phones tick one item** (`todosStore.ts`): a refused `setDone` is judged only once the list has settled
  (`REFUSAL_SETTLE_MS`, 2 s): if the list then shows the item in the wanted state (another phone ticked it first) or no
  longer has it, nothing is said; if it rolled back, the refusal is said. Judged at the moment of the refusal, Firestore's
  own pending tick would still be on screen and a genuine refusal (a phone whose clock is days off) would pass in silence.
- **The rail** (`shell/AppShell.module.css`, `railHeight.spec.ts`): with the Home an owner sees NINE rail items, and at
  56px an item the rail needed 696px on the lab tablet's 648px window (the 13 Oct defect again: account cut, rail
  scrolling). Now two steps: up to 800px of height 56px an item, up to 720px 48px with tighter padding (624px needed).
  The spec adds the rail up for every step from `SECTIONS.length`. Driven at 1024×648, 1280×760 and 1280×900.
- **Rules checks added**: 200 accented characters accepted (the rules count characters), a second tick of an item
  already ticked refused, an edit moving an item to another venue refused.
- **Deploying the rules**: ONLY from a ruleset that contains main (`firestore-rules` skill). This stack's
  `firestore.rules` lacks main's partial-owner roles: deploying it as it is would lock out every 'owner-sales' and
  'owner-kitchen' account. Once main is merged, its `member()` admits them and they get the list too (H3).
- **C, `todosSource.spec.ts`**: pins every write shape, the watch (estimate times, malformed documents skipped, `fromCache`,
  stop-before-load) and `cleanTodoText`.
- **D, an impossible day** (`todoModel.ts`): a day the calendar lacks (`2026-11-31`) goes to «Later», never nowhere.
- **E, retry after a stream error** (`todosStore.ts`): while started, the store re-subscribes after 30 s, 60 s, ... capped at 5
  minutes (reset by an answer), keeping the items and the error until then; `stop()` cancels it. The timer is injected.
- **F, form across midnight** (`TodoForm.tsx`): a new item's day not yet chosen follows `today`, and an untouched day is never
  «dirty».
- **G, junk under /home** (`HomeSection.tsx`): any address below `/home` is replaced by `/home`.

## Step 3g-2 — parity list (Settings: holiday, app language, sections for employees)

What the current app's Home settings hold (`js/home-settings.js`), and where each goes in Mise 2:

| Current app | Who | Mise 2 |
|---|---|---|
| Four cards by WHO a row is about: You / The venue / Your account / This device | — | `settings/SettingsPage.tsx` takes the same four cards (today it has account + venue + switch only) |
| «Sono in ferie» row (`js/away-screen.js`): one native date field, from today up to `maxAwayDate`, the sentence of what it does and does NOT do, «Torno prima» asked once and never red; read ONCE (not a listener, P14); written to `away/{uid}` (`buildAwayDoc`, rules already live) | everyone | this slice — row in «You» |
| The Home's holiday band (`js/home-away.js`), a BUTTON that asks «back already?» | everyone | this slice — on the Home above «Da fare» |
| The once-a-day reminder on the first section opened each day, main button «Sono tornato», marked BEFORE asking | everyone | this slice — in the shell, on the first section change of the day |
| «Lingua dell'app» (`js/staff/language.js`): each language named in itself, the label sentence naming the country, a reload after the change, `setLocationLanguage` (server refuses non-managers) | owner, manager | this slice — row in «The venue» |
| «Schede della Home» (`js/staff/home-cards-screen.js`): one switch per section the venue has (money ones included), «you still see everything», asks before hiding any (and says it silences employee notifications) and before showing a money card, a failed save puts the switch back, focus kept, `setStaffCard` | owner, manager | this slice — row in «The venue»; the screen is named «Sezioni per i dipendenti» (Mise 2 has sections, not cards) |
| The ORDER of the cards (drag + keyboard, `setHomeCardOrder`) | owner, manager | DECISION for him (D1 below) |
| «Chi può entrare» (People) | owner | 3g-3 Staff |
| «Cambia locale» | several venues | already in Mise 2 |
| App version row | everyone | step 5 (Mise 2 has no service worker until then) |
| Kiosk rows | everyone | the kiosk slice |
| Log out, quiet, last, asks first | everyone | already in Mise 2 |

Decisions to take with him:
- D1. **The order of the sections.** Mise 2's rail and phone tabs have ONE fixed order (Home first, Settings last, the
  five phone tabs of H2). (a) keep it fixed, the venue's `homeCardOrder` is left in the data for the current app only;
  (b) the rail follows the venue's order and the order is set on the same screen. Recommended (a): the same place for
  every section on every tablet, and the five phone tabs stay what H2 decided.
- D2. The holiday reminder and band work as in the current app (his choices of 13 Sep 2026), no change.

## Step 3g-2 as built (Settings: holiday, app language, sections for employees)

The decisions of the list above stand: D1 (a) the order of the sections stays fixed, nothing about `homeCardOrder`; D2 the holiday band and
reminder as in the current app. What was built, and what was decided inside the brief:

**Settings in cards by who a row is about.** `settings/SettingsPage.tsx`: «You» (`settings.you`, the holiday row, everybody), «The venue»
(`settings.venue`, only when `canManage`: the doors «App language» and «Sections for employees», each with its sentence), «Account»
(unchanged). No «This device» card (the app version waits for step 5, the kiosk for its slice). `settings.more` («The other settings arrive in
the next steps») is removed in both languages. «Log out» stays on the title line. One row look, `SettingsRow` (title, sentence, chevron, 48px
minimum, the whole row the target): a link for a door, a button for a dialog.

**Addresses.** Settings now owns `/settings/*` (`settings/SettingsSection.tsx`, wired in `routes.tsx`): `/settings/language` and
`/settings/sections`. A person without `canManage`, and any other address under `/settings`, is REPLACED by `/settings`. The usage record
names them `settings-language` and `settings-sections` (`settings/settingsPath.ts`, used by `screenNameFor`). The sub-screens keep the
page's h1 «Settings» and have a card with Back and an h2 (`SettingsSubScreen`, the Orders and Food cost shape); opened from the page the
screen opens on its h2 (opened by its address it leaves the focus to the skip link), and Back puts the focus on the door that opened it.

**Data layer.** `settings/settingsSource.ts` (+ `testing/fakeSettingsSource.ts`, registered in `createDataServices` as `settings`):
`readMyAway`, `saveAway` (decides `bad-date` synchronously, otherwise returns the write's promise), `setLanguage`, `setStaffCard`,
`readVenueFromServer`. The two Cloud Functions are called with a 60 s timeout (a cold function's first call outlives anything shorter; the screens also read the server after a failure) and each is followed by a read of the venue document from the
server; `setLanguage` and `setStaffCard` ignore a failed read straight after (the call itself succeeded) — `setStaffCard` then resolves
`null` and the screen applies the change to its own copy.

**The holiday.** `shell/away/awayStore.ts` + `AwayContext.tsx` (moved from settings/ in the review), provided by `AppShell`: one read when the venue opens, never a listener; a write
shows at once and only a rejection is reported; `away` is re-derived from the clock when the day changes (`useTodayKey`). Words are copied from
the current app (`away.*`, `settings.away.sub`). The row in «You»: not away, «I am on holiday» opens a `Dialog` with the sentence, a visible
label on a native date field (`min` today, `max` `maxAwayDate`); an empty or out-of-range day shows `away.badDate` in a live region inside the
dialog and writes nothing; away, the row is amber (`--warn-tint`, `--warn-ink`) with `away.onUntil` and `away.band.body` and asks «Back
already?» (`I am back`, not red); the row is disabled until the one read has answered. The Home band (`home/AwayBand.tsx`) is a button above
the «Da fare» card. A refused write puts the state back and says `away.saveFailed` in a dialog titled «I am on holiday»
(`shell/away/AwayRefusalAlert.tsx`, mounted once in the shell, so it is said wherever the person is when the answer lands — as the current
app's `js/away-screen.js` says it). `shared/src/away-reminder.ts` is the full paired port of `js/away-reminder.js` (parity and odd-inputs entries).

**The reminder.** One place, `shell/AwayReminder.tsx`, mounted once in `AppShell`: it judges an ARRIVAL in a section other than Home and
Settings, and only one this person is shown («not available» never reminds) (a change of section, or the app opened straight into one) once the holiday read has answered; `/more` is not a section and does
not trigger. Today is written to `away-reminded-date` before asking; storage that throws reminds. Continue or Escape keeps the holiday; the
section is open behind the question either way.

**App language** (`settings/LanguageScreen.tsx`): each language named in itself («English», «Italiano», not message keys), «In use»
pressed and disabled, «Use this» for the other, each button labelled by its language and its words («Italiano, Use this»); the label sentence always, in the INTERFACE's words, from the existing `country.<X>.in` and
`language.<x>.inSentence` keys, or `lang.labels.noCountry`; choosing shows `lang.saving` (a live region on the page from the start), turns the
buttons off, calls `setLanguage`, then reloads through `settings/pageReload.ts` (an object a spec can spy on; Mise 2 had no UI-reachable
reload). A failure shows `lang.err.save`. The screen imports only `countryOf`, `outputLanguage` and `canPrintLabel` from `market`.

**Sections for employees** (`settings/StaffSectionsScreen.tsx`): one switch per `STAFF_CARDS` card whose venue section the venue has
(`isSectionAllowed(location, card.section)`, the original's `allowedSections` rule), named with the Mise 2 section label (`calculator`
→ Calculator, `catalogue` → Recipes, `orders` → Orders, `suppliers` → Suppliers, `pastries` → Pastries, `foodcost` → Food cost,
`inventory` → Stocktake), the state word beside the switch and read as one. Hiding anything asks (danger; the push line for the
cards that send notifications, the allergen-sheet line for Recipes); showing a money card asks (not danger); showing an everyday card
saves at once. The switch moves only after the server agreed; every switch is disabled and `staffSections.saving` is said while saving;
a failure reads the server: if it already holds the change, that is a success (nothing is said); otherwise it says
`staffSections.err.save` and shows what the server holds; the focus is put back on the switch pressed. Its state is the session's `location`
at once, replaced by the server's answer when it arrives if nothing has been saved meanwhile, then by each save's answer; it lives only as long
as the screen, so reopening reads the server again (the current app's module-level `override` is NOT carried over).

**Choices the brief did not settle.**
1. The sub-screens keep «Settings» as the h1 and use the card's h2 for their name (so the browser tab stays «Settings · Mise»).
2. `/more` and the not-found page do not trigger the reminder; opening the app straight into a section does.
3. Setting a holiday does not itself count as a reminder: if no reminder was shown today, the first section entered afterwards asks once
   (as the current app does).
4. A holiday row that is away is a button that asks; there is no separate «change the date» (as the current app).
5. The language reload is `pageReload.reload()`; the session env's `reload` is not reachable from a screen.
6. The StaffSections screen is not wrapped in `markBusy()`: a switch holds nothing unsaved.
7. `settings/` screens are statically imported by the route (small), not lazy-loaded.
8. A follow-up read that fails after a successful call is swallowed, as the original's `refreshVenueFromServer` does.

**Choices taken for him since 7 Nov 2026** (the review of 8 Nov; each changes what a person sees):
9. A refused holiday change is said in a DIALOG («I am on holiday — Not saved…», OK), from the Home, from Settings and from the reminder
   alike, and wherever the person is when the server answers; before, the Home and Settings said it in their status line, which was gone
   once the page was left. The current app uses a dialog too.
10. While the holiday is still being read, the «I am on holiday» row is drawn dimmed and cannot be pressed (a moment on a slow connection).
11. The once-a-day reminder never asks in a section the person is not shown (an employee opening a hidden section's address).
12. «Sections for employees»: a save whose answer came too late but which the server did make is shown as saved, with no «Could not save».
13. «App language» and «Sections for employees» opened by their address (a reload, a bookmark) no longer move the focus to their title;
    Settings tapped in the rail opens on the page's title, not on the door used last.
14. After «I am back» the focus moves to «Add» (Home) or the row (Settings) only when the person pressed it there, never when the holiday
    ended by itself at midnight or on another phone.

Not done here: the order of the sections (D1, nothing built), «Who can enter» (3g-3), the app version row (step 5), the kiosk rows.

### Review fixes

- **A, a slow first call is not a refusal** (`settingsSource.ts`, `LanguageScreen.tsx`, `StaffSectionsScreen.tsx`): the Cloud Functions are
  waited for 60 s; after a failure each screen reads the venue from the server, and a language the server already speaks reloads as if
  the call had answered, a section the server already holds shows as saved.
- **B, the language reload never throws away typing** (`pageReload.ts`, `LanguageScreen.tsx`): Back is off while the call is in the air, and
  the reload (after a success or after the failure the server turned out to have saved) goes through `pageReload.reloadWhenIdle()`, which
  waits, polling every `BUSY_RETRY_MS`, while an editor holds the busy marker. The session's own copy of the venue is read again first.
- **C, Back is one level up** (`SettingsSubScreen.tsx`, `settingsHandBack.ts`): opened from the page, Back is `navigate(-1)`; opened by its
  address it REPLACES itself with the page (the rule of `orders/ordersNav.ts`). The door that opened the screen is promised the focus when
  the screen opens, so the phone's back gesture lands on it as well. Specs check the history action.
- **D, the holiday is read again** (`shell/away/awayStore.ts`, `AwayContext.tsx`): on a new day and when the tablet returns to the
  foreground, at most every ten minutes, never over a write still in the air. A re-read that finds nothing is ignored (the document is
  written empty, never deleted, so nothing means the read failed).
- **E, two refusals** (`awayStore.ts`): the store keeps `confirmed`, the last state the server is known to hold; the NEWEST write's refusal
  puts that back, not the previous optimistic value. A read whose answer carries no unconfirmed write of this phone and arrives during a
  pending write is recorded but not shown over it, and comes back if the write is refused. ⚠️ With real Firestore a read made while a write
  is in the air carries that write on top (`hasPendingWrites`, read as `pending`) and is NEVER recorded; so the refusal also asks the server
  again at once (finding K below).
- **F, the reminder watches the day** (`shell/AwayReminder.tsx`): an arrival is a section AND a day, so somebody sitting in a section when
  the day changes (or the tablet wakes on a new day) is judged again by the same rules.
- **G, focus after «I am back»** (`shell/away/useFocusOnBack.ts`): from the Home band the focus goes to the card's «Add» (or its title),
  from the Settings row to the new «I am on holiday» row, never to the page body, and only when the focus had nowhere to be.
  `LanguageScreen` puts the focus back on the button pressed after a failure.
- **H, the session's venue** (`StaffSectionsScreen.tsx`): after a save the session's `location` is read again (`refreshLocation`), so
  reopening shows the saved switches at once. `readVenueFromServer` stays: the screen's first answer and the re-read after a failure
  need to tell a failure apart, which `refreshLocation` cannot. «Saving…» ends before the error alert; leaving during a save owes no message.
- **I, no cross-feature imports**: the holiday pieces moved to `shell/away/` and `useTodayKey` to `shell/useTodayKey.ts`; no file in
  `home/` imports `settings/` or the other way round. The away half of the source stays in `settings/settingsSource.ts` (type imports only).

### Review fixes, 8 Nov 2026 (the interrupted review, finished)

The WIP of 7 Nov (06e1f3dc) is kept: the `pending` read-back (`hasPendingWrites`), the reminder asking the clock rather than the store's flag
just after midnight, and the door's focus handed back only on a return. The full review of the branch then found:

- **J, Back by the address** (`SettingsPage.tsx`, `settingsHandBack.ts`): the WIP's POP-only hand-back dropped the focus to the body when a
  screen opened by its address replaced itself with the page; that Back now marks the replace (`BACK_TO_SETTINGS`). The rail's Settings
  (a PUSH) still opens on the title.
- **K, a refusal asks the server again** (`awayStore.ts`): the newest refusal puts back what is known (`confirmed`, else what showed before
  the writes now in the air) and reads at once past the ten-minute gate; Firestore has dropped the refused write from the phone's copy by
  then. The WIP's `firstBefore` (kept for the store's whole life) is replaced by that per-burst value. The fake can hold writes and answers
  reads with the write on top (`holdWrites`), the sequence real Firestore produces.
- **L, a late refusal is said** (`shell/away/AwayRefusalAlert.tsx`, `awayStore.onRefused`): choice 9 above.
- **M, focus only after one's own «I am back»** (`useFocusOnBack.ts` returns `arm`, called by `useAskComeBack`'s `onBack`): choice 14.
- **N, the row waits for its read, and a picked day is typing** (`AwayRow.tsx`, `SettingsRow` `disabled`): choice 10; the date dialog holds
  `markBusy()` while a day is picked and not set.
- **O, a section saved late is saved** (`StaffSectionsScreen.tsx`): choice 12; the session's copy is read again on that path too.
- **P, language buttons named** (`LanguageScreen.tsx`): `aria-labelledby` = the language's name and the button's words.
- **Q, reminder for shown sections only** (`AwayReminder.tsx`, `useVisibleSections`): choice 11.
- **R, first load keeps the skip link first** (`SettingsSubScreen.tsx`): choice 13, as the Orders screens (`cameFromList`).

Left as they are, on purpose:
- Two server reads of the venue per save (the source's, then the session's `refreshLocation`): merging them needs a session API that takes
  a document; a save here happens a few times a year.
- On waking on a new day the reminder judges with the holiday known before the wake's re-read: if another phone ended it, the question
  can be asked once more; either answer is safe.
- «In ferie fino al 1/8/11 novembre» wants «all'»: the words are the current app's own (`js/i18n.js`), so the fix belongs to both apps.
