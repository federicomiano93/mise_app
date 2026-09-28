---
name: ui-check
description: Measure every Mise screen for interface and accessibility faults — axe-core (contrast, button names, labels, WCAG 2.2 target size), touch targets under 44px, sideways scroll, clipped text, icons off their label, titles off centre, console errors — at 296px, 360px and tablet width, in English and Italian. Use after ANY change to a screen, a stylesheet or tokens.css, before opening a PR that touches the UI, before showing Federico a mockup built from the app, and whenever asked to "check the interface", "improve the UX" or "audit accessibility". It measures; it never judges whether a screen reads well — that is Federico, on a phone.
---

# UI check — measure, don't eyeball

Every serious UI defect in this app was found by Federico opening a phone, never by
a test. This check catches the MEASURABLE share before he has to: a colour 0.01 under
the contrast line (`--text-3`, ~40 screens, found by the first run on 28 Sep 2026), a
button with no name, a row wider than the phone.

## Run it

Three things running, all LOCAL (the driver refuses any non-localhost URL):

```bash
# 1. emulator (from the repo), then seed it once
firebase emulators:start --only auth,firestore --project bakery-app-ebf90
FIREBASE_PROJECT_ID=bakery-app-ebf90 node tests/rules/seed-emulator.mjs
# 2. the app over http — a FRESH port each time (a stale server served an old tree)
python -m http.server 5931 --bind 127.0.0.1
# 3. the check, from ..\algprobe\mise-drive\ — once per language
node ui-check.mjs http://127.0.0.1:5931/ manager@club.test en 9471
node ui-check.mjs http://127.0.0.1:5931/ miano@club.test   it 9472
#    optional 5th argument: a regex of screen names, e.g. "orders|suppliers"
```

`miano@club.test` is the Italian venue: **always run it** — Italian words are longer,
and a label that fits in English is the one that overflows in Italian.
Each run takes ~3 minutes (17 screens × 3 sizes). Never run two drivers at once.
`axe-core` is pinned in `..\algprobe\mise-drive\package.json` (dev only, never shipped
to phones); update it deliberately, never to a release younger than a few weeks (P11).

## Read the result

`shots/ui-<tag>.md` groups every finding by kind, each with the screens it appears on;
`shots/ui-<tag>.json` has the detail; one screenshot per screen and size beside them.
**Open the screenshot before acting on a finding** — a measurement can be a false alarm.

| Finding | What it means | Default action |
|---|---|---|
| Did not open / Console error | the screen is broken | fix first |
| Sideways scroll | the page is wider than the phone | fix |
| axe `button-name`, `label`, `aria-*` | a screen reader cannot say what it is | fix |
| axe `color-contrast` | text under 4.5:1 | fix the TOKEN in tokens.css, never one screen; `tests/text-contrast.test.mjs` pins them |
| Target under 24px | fails WCAG 2.2 AA | fix |
| Target under 44px | below the comfortable thumb size | a design choice — list it, do not fix unasked |
| Text cut off | a label ends in «…» or is clipped | fix, unless the ellipsis is deliberate (long names) |
| Icon off its label (>1.5px) | the icon sits high/low on the text | fix: flex row on the button AND the wrapper span |
| Title off centre (>2px) | the header title is pushed sideways | see the known decisions below |

## Known decisions — report them, never «fix» them unasked

These are Federico's to make (see the project CLAUDE.md backlog). Report them once in
the end list if they are still there; do not reopen them as new findings:
- `--text-4` at 3.4–3.6:1 (inactive segmented tabs, small mono labels).
- The Pastries day tabs of other days in `--text-5` (2.24:1).
- The 36×36 round header buttons (the design system's size; over the 24px minimum).
- The Orders title 44px off centre on a phone (one button left, three right) and the
  Calculator title 24px off centre.

A NEW screen that adds to one of these lists is a finding, not a known decision.

## What it cannot see — check these by driving the app

The script walks each screen in its FIRST state. Before calling a UI change done, also
drive (with the drivers in `..\algprobe\mise-drive\`, by label, scoped to the overlay —
see "Driving the app with a script" in the project CLAUDE.md):
- the EMPTY state (no suppliers, no orders, no recipes) and the FULL one (long lists);
- an ERROR (a save refused) and OFFLINE — the message must say what to do;
- the LONGEST real text: an Italian supplier name, a 40-character ingredient;
- keyboard: Tab reaches every control with a visible focus ring, Esc closes overlays;
- `prefers-reduced-motion`: sheets and dialogs appear without animation.

Then say in the end list which of these were driven and which were not.
