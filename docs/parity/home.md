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

- **The day of «today» is `useTodayKey`** (`app/src/home/useTodayKey.ts`), not `shell/useToday.ts`: that one gives the
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
