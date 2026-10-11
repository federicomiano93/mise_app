# Parity list — Pastries

What Mise 2's Pastries must do because the current app does it. Built from
`tests/pastries-*.test.mjs`, `js/pastries/`, `firestore.rules` (the `pastries` and `pastry-logs`
blocks), the smoke test and the release history. Each line is a requirement; the ones marked
**spec** are pinned by a test in Mise 2 (a port runs the current app's tests against both files).
Differences from the current app are listed at the end, each with its reason.

## Data

1. **Seven documents for ever**: `locations/{lid}/pastries/{Monday…Sunday}`. The ids are the
   capitalised English weekday names — the same words suppliers store in `orderDays` — and are
   DATA: never translated. A screen shows the translated label, looked up by id. **spec**
2. **A day is written whole** (`setDoc`, no merge): `{ bakery, day, items: [{ name, qty }], note,
   updatedAt }`. `bakery` is the open venue's id, stamped by the data layer, never by a caller;
   `day` repeats the id; `updatedAt` is an ISO string. The rules refuse any other key and more
   than 100 rows. There is no delete: emptying a day is `items: []`.
3. **A save that omits the note keeps the note already there**; an explicit `''` clears it.
4. **Reading is forgiving and never throws** (`normalizeDays`): all seven days always present;
   a document whose id is not a weekday is ignored; where id and `day` disagree the id wins; at
   most 100 rows are read (what you see is always something you can save); names trimmed, blank
   rows dropped, names over 80 characters cut; a quantity is a whole number ≥ 0 (`1e999` → 0). **spec**
5. **Local copy for the first paint**: localStorage `pastries-days`, shared with the current app
   (same key, same shape `{ Monday: { items, note }, … }`). It also reads the older shape where
   each day was the bare items array. It is painted before the network answers, and it is wiped
   on a venue switch (it is not under `KEEP_PREFIXES`). **spec**
6. **Saving is local-first**: the screen changes at once; if the server refuses, the day is put
   back as it was and «Couldn't save {day} — check your connection.» is shown.
7. **One live listener on the seven days**, started when Pastries opens (seven reads per opening).
   If the stream dies: «Live sync interrupted — this list may be out of date.»
8. **Records** are `pastry-logs/{YYYY-MM-DD}_{Weekday}`, at most one per work date per day. They
   are read only while the Records screen is open (`orderBy('date','desc')`, `limit(120)`), and the
   listener is stopped on leaving it. Stream error: «Live sync interrupted — these records may be
   out of date.»
9. **Which days are confirmed tonight**: one equality query on `date == workDate`. A failure
   leaves nothing confirmed, so nothing is locked (the safe direction). **spec**
10. **Confirm writes the record in a transaction** that keeps the first `createdAt` of the night;
    `id` is never sent as a field. Not optimistic: nothing shows as recorded until the write has
    landed; once it has, the day shows as confirmed at once without waiting for the listener.
    Failure: «Couldn't record {day} — check your connection.» **spec** (buildLog)
11. **A record is removed only by a person**: the bin on Records, after a danger confirm. Nothing
    in the app deletes a record by itself. Failure: «Couldn't remove that record — check your
    connection.»

## Time

12. **The work day rolls at 4am**, computed with `setHours` on the local calendar (right on both
    clock-change Sundays and in a zone with no daylight saving). **spec**
13. **The opening day** is the day after the work day under way («tomorrow»), computed once when
    Pastries is opened, so it never jumps under a finger at 4am. **spec** (`provingDayFor`)
14. **The lock follows the clock**: at 4am the confirmations are asked again for the new work
    date (a timer to the next 4am, plus a check when the app comes back to the foreground,
    because a phone in a pocket throttles timers). **spec** (`msUntilWorkDayEnd`)
15. **Records show the last 15 days** — a display window only. A record nobody can date is shown,
    one dated ahead of this clock is shown. **spec**

## The day

16. Each row: the name on the left, the quantity on the right in same-width digits. Nothing is a
    field until the row is tapped.
17. **Correcting one number**: tapping a row opens an EMPTY box (placeholder 0) under it and
    closes any other open row. The tick appears only for a usable number (1–9999 and different
    from the current one); the hint says «type a number» / «same as now» / «must be at least 1» /
    «too many». Enter confirms. The write is composed from the live list at that moment and
    refused if the row is no longer the one typed into (index AND name, case-insensitive):
    «That row has changed — check the list.» On success: «{name}: {n}.» **spec** (`setQuantityAt`)
18. **What this phone has typed survives a snapshot** from another phone (kept by pastry name),
    as do the scroll position and the focus in the box.
19. Empty day: «Nothing to prove for {day} yet.» / «Tap the pencil to add.»
20. The day's standing note is shown under the list when there is one.
21. The opening day is subtitled «Tomorrow · to prove», every other day «To prove».
22. **Confirm** reads tonight's record once, then asks «Confirm {day}?» with «Keep this list as a
    record for {day}?» (or «{day} has nothing to prove. Record that?»), followed by «Tonight's
    record for {day} will be replaced.» when one exists, else «{day} will show as done. You can
    still change it — it will ask first.» After it: «{day} recorded.», the «Confirmed» mark and
    an Edit button replace Confirm. A second tap while the dialog is open does nothing.
23. **A confirmed day is locked until 4am.** Tapping a row, Edit or the pencil asks «Edit
    {day}?» / «{day} is already recorded for tonight. Edit these quantities?». Yes stores a
    permission in localStorage `pastries-edit-{Weekday}` = tonight's work date, then opens the
    row that was tapped. A Confirm spends the permission; 4am spends it too. Uncertain answers
    (no record, unreadable clock) never lock. **spec**
24. A colleague's Confirm locks the day here too and closes any open row.

## The days (strip on a phone, list on a tablet)

25. Seven days, Monday first. The short label is its own dictionary entry, never the first three
    letters of the full name (a translated word cannot be cut safely); the full name is the
    accessible name.
26. A tablist: arrows (both pairs), Home and End move the selection, only the selected day is in
    the Tab order, focus follows the selection. Phone: a row; tablet: a column.
27. The opening day carries a marker; a day with nothing in it is drawn quieter; each day shows
    how many pastries (kinds, not pieces) it holds.

## The editor

28. A working copy; nothing is stored until Save. It always has at least one row; quantities are
    held as text while typed (an empty box stays empty).
29. Name suggestions: the names on the other six days, sorted.
30. «Add pastry» adds an empty row and puts the cursor in it.
31. Removing a row: no question for an untouched row; otherwise «Remove this pastry?» / «Remove
    {name} from {day}?» (danger).
32. **Save is blocked**, the offending field highlighted and the person taken to it, by: the same
    name twice (case-insensitive) «{name} is on this list twice.»; a name with no number «How many
    {name}?»; a name over 80 characters «That name is too long.»; a quantity over 9999 «9999 is
    the most this can hold.»; more than 100 rows «That is more pastries than one day can hold.»
    A blank row is dropped, never an error; an empty list is valid. **spec**
33. Save asks «Save {day}?» with «Save these {n} pastries for {day}?» (or «{day} will have nothing
    to prove. Save that?»), stores, says «{day} saved.» and returns to the day.
34. Leaving with unsaved changes (rows or note) asks «Discard changes?» / «You have unsaved
    changes to {day}. Discard them?» (danger).
35. The note: a text area of up to 500 characters, labelled «Note — stays on {day} until you
    change it», placeholder «Anything worth remembering about this day…». Line breaks are kept.
    **spec**

## Records

36. Newest first; two records on one date keep the weekday order. **spec**
37. Each card: the date spelled «Wed 5 Aug» in the interface language, a badge with the list's
    weekday (a Wednesday list is confirmed on Tuesday night), the rows, «Nothing was proved.» when
    empty, the note as it was that night, and a bin labelled «Remove the record for {day},
    {date}». Removing asks «Remove this record?» / «… This cannot be undone.» and says «Record
    removed.»
38. Empty: «No records yet.» / «Tap Confirm at the bottom of a day to keep one.» Under the list:
    the line saying older records are kept and only the last 15 days are shown. Subtitle «Last 15
    days».

## Everywhere

39. Interface words follow the interface language; a weekday shown is its label, never its id.
    Pastry names are what people typed.
40. Usage record: the day, the editor and Records are separate screens; Confirm is the action
    `pastry-day-confirmed`.
41. Pastries exists only for those the venue shows it to; the rules decide (`canUse(lid,
    'pastries')`).
42. A screen that fails to draw never stops the data: one part failing leaves the others working.

## Differences from the current app, on purpose

- **Tablet**: the days are a list on the left and the chosen day, the editor and Records open on
  the right. Tapping another day with unsaved edits asks «Discard changes?» — the same question as
  Back — instead of hiding the days while editing.
- **Errors in the editor**: a notice at the top and the field outlined in red with the sentence
  under it, instead of a message that disappears (the design's form pattern). Save stays blocked.
- **Translated**: the editor's pastry count and the labels of the quantity box and of the bin were
  English on every venue.
- **Messages** are announced in a status region that exists before it changes, instead of a toast
  inserted already filled.
