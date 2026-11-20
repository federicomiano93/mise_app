# Mise

**Back of house for bakeries and kitchens**: supplier orders, recipes and labels, doughs, food
cost, stock and customer bookings, in one installable web app built for the lab tablet that also
works on a phone or a computer.

Live: https://federicomiano93.github.io/mise_app/ ·
Install guide: https://federicomiano93.github.io/mise_app/install-guide.html

## What it does

Each venue turns on only the sections it uses, and an owner chooses which ones the staff see.

| Section | What it is for |
|---|---|
| **Home** | The day at a glance and a shared «To do» list. |
| **Orders** | Supplier ordering: quantities suggested from past orders, a shared draft that saves as you type, the order sent by WhatsApp or email, deliveries checked on arrival, order lists from the staff, and the history. |
| **Recipe book** | A searchable recipe library with categories; any recipe rescales to a total weight, exports to PDF or Excel, and prints its allergen, nutrition and HACCP labels. |
| **Calculator** | Scales doughs from the day's production orders and keeps a log of every batch. |
| **Pastries** | What to put to prove each night, one list per weekday. |
| **Ingredients & suppliers** | One record per supplier and per ingredient: packs, prices and their changes, allergens, delivery days, and supplier invoices imported from their files. |
| **Food cost** | The cost and margin of every product, from recipe weights, ingredient prices, cooking loss, packaging and labour. |
| **Stocktake** | The monthly count, with purchases filled in from the orders already recorded. |
| **Bookings** | Customer bookings by day and time slot, with slips printed for the lab and the customer. |

Wholesale clients place their orders from a page of their own. Staff join a venue with a code or
a link; the owner invites people, chooses their role and manages the team from Settings. A
tablet can run in kiosk mode, with a rest screen that keeps it on.

The app runs in English and Italian. Words that name a food, such as allergens and nutrients,
follow the venue's country, because that is what the label law requires.

## How it is built

- **One single-page app** in React 19 + TypeScript, built with Vite: `app/` holds the screens,
  `shared/` the logic that does not depend on a screen (and is tested on its own). React Aria
  Components for accessible controls, Lucide for icons, React Router for navigation. Every npm
  dependency is pinned to an exact version and audited in CI.
- **Firebase**: Firestore for the data (with an offline cache, so a change is saved on the device
  at once and synced in the background), Email/Password Authentication, Cloud Functions
  (`functions/`) for the few things a phone must not do itself (joining a venue, notifications,
  reading a recipe from a photo, nightly clean-ups), and Cloud Messaging for notifications.
- **GitHub Pages** serves the app, built by the `Pages` workflow. A service worker precaches the
  build and brings installed devices up to date after a release, never while somebody is editing.
- **One deployment serves many venues.** Each venue's data sits in its own folder
  (`locations/{id}/…`), and the security rules let an account reach only the venues it belongs to.
- The previous plain-JavaScript app (`js/`, `dist/`, the root pages) stays in the repository as
  the rollback copy; `order.html`, `reset-password.html` and `install-guide.html` are still served
  from it. How the two live on one address: `docs/architecture.md` and `docs/switch-runbook.md`.

## Security

- `firestore.rules` is enforced on the server. It requires membership of the venue, validates
  every saved document against a closed list of fields, and denies anything it does not match.
  Roles (employee, manager, owner and two partial owners) are part of the membership itself.
- Accounts sign in with email and password. There is no anonymous access, and nobody can grant
  themselves access to a venue: joining goes through a Cloud Function and a single-use code.
- The page carries a Content Security Policy, and data is always rendered as text, never as HTML.
- The Firebase web configuration is committed on purpose: a Firebase web API key is public
  configuration, restricted by origin and API. Real secrets, such as service accounts and `.env`
  files, never enter the repository.
- Personal data is kept only as long as it is needed: old bookings, client orders and technical
  records are cleaned up by scheduled functions.

## Working on it

Local work talks only to the Firebase emulator: on `localhost` the app never reaches the real
database.

```bash
firebase emulators:start --only auth,firestore --project bakery-app-ebf90
FIREBASE_PROJECT_ID=bakery-app-ebf90 node tests/rules/seed-emulator.mjs   # demo venues and accounts

cd shared && npm ci --ignore-scripts && cd ..
cd app && npm ci --ignore-scripts
npx --no-install vite                                   # the app with hot reload
npx --no-install vite build --base=/mise2/ && npx --no-install vite preview --base=/mise2/
```

Tests:

```bash
cd shared && npx --no-install vitest run   # the shared logic
cd app && npx --no-install tsc --noEmit -p . && npx --no-install vitest run   # types and screens
npm test                                   # repository checks (rules shape, workflows, the rollback copy)
npm run test:rules:emulated                # the Firestore rules, on a fresh emulator
```

## Releases

`main` accepts only pull requests whose `test`, `rules` and `mise2` checks pass. Every pull
request also gets a preview link that runs on a separate project with test data. Merging to
`main` builds and publishes the app and deploys the Cloud Functions; rule changes are deployed
first, by hand, and read back. Releases are git tags (`vMAJOR.MINOR.PATCH`), each with its
GitHub Release.
