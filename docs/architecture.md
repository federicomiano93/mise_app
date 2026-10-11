# Mise 2 — architecture

Mise 2 is the rewrite of Mise as ONE tablet-first single-page app in React + TypeScript + Vite.
It lives in this repository beside the current app until the switch (step 5 of the plan), and
until then it is served only on the preview, at `<preview>/mise2/`. This file is the map: what
is where, why it is that way, and the rules a new screen must follow.

> ⚠️ GitHub Pages builds this repository with Jekyll. A double curly brace or a curly brace
> followed by a percent sign anywhere in a committed Markdown file fails the whole Pages build
> (`tests/mise2-isolation.test.mjs` pins it). Write JSX examples without them.

## The layout

| Folder | What | Package |
|---|---|---|
| `js/`, `*.html`, `*.css`, `sw.js`, `dist/` | the CURRENT app (bug fixes only until the switch) | root, zero dependencies |
| `functions/` | Cloud Functions, shared by both apps | its own |
| `shared/` | pure TypeScript logic, ported from `js/` | `@mise/shared` |
| `app/` | Mise 2 itself | `mise2-app` |
| `docs/` | this file | — |

`app/` and `shared/` are self-contained npm packages, each with its own lockfile and an `.npmrc`
that sets `ignore-scripts=true` (no package runs code at install) and `save-exact=true` (every
version written down exactly). The root `package.json` stays the current app's: no workspaces,
nothing of Mise 2 in its lockfile (`tests/mise2-isolation.test.mjs`).

## Living beside the current app

Mise 2 is served from the SAME origin as the current app. That is deliberate (one sign-in serves
both, and the switch keeps the address) and it has consequences that every change must respect:

- **One IndexedDB.** Auth's record of who is signed in and Firestore's offline cache are shared.
  The npm `firebase` package is pinned to exactly the gstatic version `js/firebase.js` loads, and
  `tests/mise2-ci.test.mjs` fails if they differ; Auth starts with `initializeAuth` and getAuth()'s
  persistence list in its order (`tests/auth-start.test.mjs` pins both apps).
- **One localStorage.** Mise 2 uses the current app's keys with the current app's meaning:
  `active-location`, `offline-cache-uid`, `device-id`, `device-ping-*`, `error-reports`, `usage-*`.
  Either app's sign-out or venue switch runs the same keep-list (`KEEP_PREFIXES`, in
  `js/local-data.js` and `shared/src/local-data.ts`) over the other's keys: a key Mise 2 must keep
  across a venue switch starts with one of those prefixes, in both files.
- **One service worker scope.** The current `sw.js` controls `/mise2/` too. Mise 2 registers no
  service worker until step 5, when it takes over at the same path and name.
- **No App Check, no reCAPTCHA** (his decision, PR #212) — in either app.
- **The preview publishes only what is allowed.** `build-mise2` (`.github/workflows/preview.yml`)
  builds Mise 2 in a job that holds no Google credential and hands the built files to the deploy
  job, which builds nothing (`tests/preview-hosting.test.mjs`).

## The stack, and why

| Piece | Version | Why |
|---|---|---|
| React | 19.3.0 | components end the stale-screen bugs of the current app |
| TypeScript | 7.0.2 (`tsc` native) | a missing translation or a wrong field is a build error |
| Vite | 8.3.1 | build target `chrome107, edge107, firefox104, safari16`: the lab tablet (SM-T550, Chrome 119) and iPhone Safari 16.4 |
| React Aria Components | 1.21.1 | accessible controls (focus, keyboard, screen readers) without writing them |
| react-router | 8.4.0 | hash routing (`#/orders`), because GitHub Pages cannot rewrite deep links |
| lucide-react | 1.48.0 | the icon set of the design |
| Firebase | 12.19.0 | the same SDK as the current app (see above) |
| Vitest + Testing Library + jsdom | — | specs |
| Geist / Geist Mono | @fontsource-variable | bundled, so the app starts offline and no third party sees who opens it |

Preact was evaluated in step 2c and NOT adopted: React is about a fifth of the bundle, and React
Aria does not support Preact. The numbers are below.

## `app/src`, folder by folder

- `main.tsx` — loads the phone's language, creates the Firebase backend once, the session store,
  starts telemetry BEFORE the session (so an error during start-up is caught), then renders
  `AppBoundary › I18nProvider › SessionProvider › SessionGate › RouterProvider`.
- `i18n/` — typed messages without a library. `en.ts` is the source of the keys (`as const`);
  `it.ts` is typed against it, so a missing or extra Italian key fails `tsc` and therefore the
  build. `{name}` interpolation; plurals through Intl.PluralRules with the count passed as `n`
  (the current app's name); Italian is a lazy chunk loaded before the first render. Curly
  apostrophes only (a spec refuses `'`).
- `session/` — who is signed in and which venue is open. `session.ts` is the session half of
  `js/firebase.js`, decision for decision, behind an injected backend (`backend.ts`), so every trap
  is a spec with a fake backend (`session.spec.ts`). `firebaseBackend.ts` is the real one.
  `visibility.ts` decides which sections a person sees (the current app's page gate). The screens
  above a venue (sign-in, picker, no access, error) and `SessionGate` live here too.
- `shell/` — the frame: the dark rail (700px and wider), the phone tab bar, the top bar (venue,
  date, connection), `Page` (one h1, the tab title, focus on navigation), the placeholders, More,
  Not found, Not available, the offline banner.
- `errors/` — `PartBoundary` (a part that fails shows «This part didn't load / Reload», the rest
  keeps working), `RootError` and `AppBoundary` (the whole app).
- `telemetry/` — error reports, the daily device line, the usage record: ports of
  `js/error-report.js`, `js/device-ping.js`, `js/usage.js`, writing through `sinks.ts` exactly the
  shapes `firestore.rules` accepts. Screens are named `m2:<section>` and the build is stamped
  `m2-<7-char commit>`, so the owner's statistics tell the two apps apart.
- `data/` — where every section gets its data from (`DataContext`): one source factory per
  section, built once in `main.tsx` on the session's backend (`createDataServices`), so a screen
  never reaches for Firestore itself. A spec passes fakes instead (`testing/renderApp.tsx`, with
  `testing/fakePastriesSource.ts`), so no screen needs a database to be tested. A section's own
  `*Source.ts` is the only file that knows its collections' paths and shapes.
- `pastries/` — the first real section, and the pattern for the next: a source (`pastriesSource.ts`,
  the Firestore half, a port of `js/pastries/firebase-pastries.js`), a store (`pastriesStore.ts`,
  plain TypeScript with no React: the seven days, tonight's confirmations and the lock, the
  records), a context that starts it when the section opens and stops it when it closes
  (`PastriesContext.tsx`), and the screens: `PastriesSection` (the frame and the address),
  `DaysNav`, `DayPanel`, `Editor`, `Records`. `shell/sectionScreens.ts` lists it, so its code is
  fetched only when somebody opens it. Its parity list is `docs/parity/pastries.md`.
- `ui/` — the shared controls: `Button`, `Dialog` and `useConfirm` (a question that waits for an
  answer; never the browser's `confirm()`), `StatusMessage` (one short message at a time, in a
  live region that exists before it speaks), `FormBar` (Back, title, the one primary action: the
  top of an editor), `useMediaQuery` (only for attributes that must agree with a stylesheet's
  media query; layout is always CSS).
- `settings/` — the Settings page (today: the Account card).
- `styles/` — `tokens.css` (every colour, size, radius, shadow) and `base.css`.
- `testing/` — `renderApp`, the fake session store and other spec helpers.

## `shared/src`

Pure logic only, no DOM types. Each module is a PORT of a `js/` file, and its spec runs every test
against BOTH files (`describe.each` over the TypeScript port and the `js/` original), so the two
apps cannot drift apart while both are live. `parity.spec.ts` compares the full ports export by
export (names, constants, frozen-ness, function names and arity); a partial port (`membership`,
`location-id`, `pastries-model`, `market`, `price-model`) is not paired and its spec says why, and
compares what it does port with the `js/` file itself. `currency` is an ADAPTED port, also not paired:
the original keeps the venue's money in a module variable (`setCurrency`), and Mise 2 never keeps a
venue fact in a module variable, so the port is stateless (`moneyOf(symbol, layout)` returns the
`Money` that the formatting functions are handed, as `formatMoney` and `formatRate` of `price-model`
are); its spec runs each case against the `js/` module after `setCurrency` and against the port with
`moneyOf`, and demands the same text. `odd-inputs.spec.ts` feeds every export odd inputs and compares
the two. A quirk of the original that no real input can reach is
copied, not tidied, and marked where it sits: fixing it is a bug fix to BOTH files at once, and
`odd-inputs.spec.ts` fails until they agree. Today: join-code, push-model, home-cards, away-model,
allergen-model, sections, firebase-target, local-data, same-data, error-model, device-model,
usage-model, membership, location-id, pastries-model, pastries-log-model, pastries-lock, pack-size,
order-unit, ingredient-name, order-cost, market (partial: the country and the money, not the label
vocabulary), price-model (partial: the reading half, not the writing half or the dictionary lookups),
currency (adapted, stateless).

## The session

Statuses: `loading`, `signed-out`, `choose-location`, `no-access`, `error`, `ready`. The decisions,
and where each comes from:

- A leftover anonymous session is dropped, never treated as a person.
- Another person's offline copy is wiped before any read of theirs, at ANY sign-in. This is the
  one deliberate difference from the current app, which waits for the next page load: Mise 2 is
  one page that never reloads by itself.
- A cached "users/{uid} does not exist" is not trusted; a cached "admins/{uid} does not exist" is.
- One venue opens straight in; a remembered venue opens if it is still yours; otherwise the picker.
- The venue's language is loaded before the venue is shown.
- The phone's copy is checked against the server behind it; a difference reloads, at most once in
  30 seconds, and never while somebody is editing (`busy.ts`).
- Sign-out and a venue switch wipe both copies and reload; both ask first, and warn when something
  typed has not reached the server.
- It is NOT a security boundary (P2): `firestore.rules` judges every read and write.

## Rules for every new screen (step 3 onwards)

1. **Data only through the backend.** A section's data layer gets Firestore from the session's
   backend, never from `getFirestore()`: Firestore's settings are fixed by its first use.
2. **An editor marks itself busy.** Every screen that holds unsaved edits calls `markBusy()` while
   it does (`session/busy.ts`), or a self-started reload throws the typing away.
3. **Every part in a `PartBoundary`.** A list and a detail are two parts; one failing must not
   take the other down.
4. **Text through `t()`, food words through the country.** A word a person taps follows the
   interface language; a word that names a FOOD follows the venue's country (the current app's
   `i18n-labels` rule).
5. **CSS modules and tokens only.** One `Name.module.css` per component; colours, fonts, radii and
   shadows only as `var(--token)` from `tokens.css`. `css-modules.spec.ts` fails on a class a module
   does not define and on a token `tokens.css` does not define. Light theme only.
6. **Accessibility is part of done:** one `main` and one `h1` per screen, labelled navigation,
   48px targets, a visible focus ring, errors announced, live regions present before they change.
7. **Specs are `*.spec.ts(x)`, never `*.test.*`, never in a folder named `test/`**: the root
   `node --test` would run them and fail. A port runs its tests against both apps.
8. **Load sections lazily** once they are real, so the first screen stays light: a built section is
   listed in `shell/sectionScreens.ts`, which loads it on first use, behind `SectionRoute`'s gate.

## Testing and CI

- `app/`: `npm run typecheck`, `npm test` (Vitest, jsdom), `npm run build` (`tsc` first). Vitest
  processes only `?raw` CSS (`vite.config.ts`): with every stylesheet applied, jsdom hides the
  rail, because it ignores the media query that shows it.
- `shared/`: `npm run typecheck`, `npm test`.
- CI job `mise2` (a required check on `main` since 10 Oct 2026): installs both packages with
  `npm ci --ignore-scripts`, then typecheck, specs, build and `npm audit --audit-level=high`. It may
  only read the repository and holds no credential. `deploy-functions` still waits only on `test`
  and `rules`.
- Driving it: build with `--base=/mise2/` (from Git Bash: `MSYS_NO_PATHCONV=1`, or the path is
  rewritten), serve with `vite preview`, and on localhost it talks to the emulator.

## Performance (step 2c, 11 Oct 2026)

Phone profile: 360x800, CPU slowed 6 times, slow 4G (150 ms, 1.6 Mbps down). Time until the
sign-in form is usable, on the preview's CDN, medians of 2 runs:

| | current app | Mise 2 (step 2b-3) |
|---|---|---|
| first visit | 5.85 s | 4.12 s |
| second visit | 1.26 s | 1.47 s |
| later visits | 1.56 s | 1.96 s |

Mise 2's first visit is faster (5 files instead of 18). Later visits are slower by 0.2 to 0.4 s:
the cost is running the code (about 1 s of script at that CPU), over half of it Firestore (its
file is 554 KB of about 1.1 MB: Firestore 554, React 219, Firebase Auth 97, router 93, React Aria
81, the app 67).

What step 2c changed:
- **Firestore is loaded only when it is needed** (`session/firebaseBackend.ts`): the sign-in form
  needs none of it, so it is fetched while the password is typed, or by the signed-in session's
  first read.
- **The libraries have chunks of their own** (`vite.config.ts`): a release re-downloads Mise 2's
  own ~67 KB, not the whole bundle, and the browser can keep the libraries' compiled code.
- **Preact: not adopted.** React is about a fifth of the code and React Aria does not support it.
- **The service worker of step 5** will give Mise 2 the compiled-code cache that makes the
  current app's later visits fast.

Measured locally (served by `vite preview`, emulator; 3 runs, medians):

| | before 2c | after 2c |
|---|---|---|
| first visit | 8.6 s | 3.6 s |
| later visits | 3.4 s | 2.3 s |
| sign-in until the shell | 2.6 s | 2.6 s |

On the preview's CDN after 2c, both apps measured in the same session (3 runs, medians; the PC
was busier than for the first table, so compare the two columns, not the tables):

| | current app | Mise 2 after 2c |
|---|---|---|
| first visit | 4.99 s | 3.24 s |
| second visit | 1.80 s | 2.11 s |
| later visits | 1.96 s | 1.80 s |

Mise 2 is now faster on a first visit and level afterwards; the remaining 0.3 s on a second visit
is the compiled-code cache the current app gets from its service worker, which Mise 2 gets in
step 5. Verdict of step 2c: no change of framework; go on with the sections.

## Traps already paid for

- A tab's accessible name comes from its content, never from an `aria-label` that differs from the
  words drawn (axe `label-content-name-mismatch`). Text that is only for assistive technology uses
  the one `.visually-hidden` recipe in `base.css`, never `display: none`, which would take it out of
  the name.
- A sticky bar sticks only if nothing between it and the scroll area (the shell's `main`) has an
  `overflow`; `pastries/pastriesCss.spec.ts` reads the stylesheets and pins it.
- The status message sits 65px above the phone's tab bar, a copy of the bar's height;
  `ui/statusOffset.spec.ts` adds the bar up from its own stylesheet and fails when the two drift.
- An editor that copies its data when it opens must wait for the data: opened by its address, the
  store may still hold only an empty local copy (`daysLoaded` in the Pastries store).
- A screen that blocks leaving (unsaved edits) uses the router's `useBlocker`, which covers every
  way out (Back, the browser's Back, the rail, a day picked in a list), not the Back button alone.

- Vitest empties CSS, even `?raw`, unless told otherwise.
- Git Bash rewrites `--base=/mise2/` into a Windows path.
- jsdom applies `display: none` but not the media query that undoes it.
- A CSS custom property invented in a component fails the token guard: use layout that needs none.
- React 19 logs caught render errors with `console.error`, and React Router's boundary logs them
  again: the router's `onError` keeps it to one report.
- A live region inserted already filled is not announced reliably: render it empty first.
