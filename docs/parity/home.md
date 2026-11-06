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
