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
| `expireAt` | timestamp or null | set only when ticked: 30 days later, never more than 31 days ahead; null when not ticked |
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
