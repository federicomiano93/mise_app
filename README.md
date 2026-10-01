# Mise

**Back of house for bakeries and kitchens**: doughs, recipes, supplier orders, food cost
and stock, in one installable web app that works on a phone, a tablet or a computer.

Live: https://federicomiano93.github.io/mise_app/ ·
Install guide: https://federicomiano93.github.io/mise_app/install-guide.html

## What it does

Each venue turns on only the sections it uses.

| Section | What it is for |
|---|---|
| **Calculator** | Scales doughs from the day's production orders and keeps a log of every batch. |
| **Recipe catalogue** | A searchable recipe library; any recipe rescales to a total weight. Allergen and nutrition labels are printed from it. |
| **Orders** | Supplier ordering: quantities suggested from past orders, a shared draft that saves as you type, the order sent by WhatsApp or email, deliveries checked off on arrival, and the order history. |
| **Ingredients & suppliers** | One record per supplier and per ingredient: pack sizes, prices, allergens, delivery days. |
| **Pastries** | What to put to prove each night, one list per weekday. The work day rolls over at 4am. |
| **Food cost** | The cost and margin of every product, from recipe weights, ingredient prices, packaging and labour. |
| **Stocktake** | The monthly count, with purchases filled in from the orders already recorded. |

Wholesale clients can also place their orders from a page of their own. Staff join a
venue with a code or a link, and notifications reach their phones even when the app is
closed.

The app runs in English and Italian. Words that name a food, such as allergens and
nutrients, follow the venue's country, because that is what the label law requires.

## How it is built

- **Plain HTML, CSS and JavaScript modules**, with no build step and no framework. Each
  feature lives in its own folder under `js/`, so it can be lifted out on its own.
- **Firebase**: Firestore for the data (with an offline cache), Email/Password
  Authentication, Cloud Functions (`functions/`) for the few things a phone must not do
  itself, and Cloud Messaging for notifications.
- **GitHub Pages** serves the app. A service worker precaches the app's files, checks each
  one against its fingerprint, and brings installed phones up to date after a release.
- **One deployment serves many venues.** Each venue's data sits in its own folder
  (`locations/{id}/…`), and the security rules let an account reach only the venues it
  belongs to.

## Security

- `firestore.rules` is enforced on the server. It requires membership of the venue,
  validates every saved document against a closed list of fields, and denies anything
  it does not match. Roles (staff, manager, owner) are part of the membership itself.
- Accounts sign in with email and password. There is no anonymous access, and nobody
  can grant themselves access to a venue.
- Every page carries a Content Security Policy, and data is always rendered as text,
  never as HTML.
- `js/firebase.js` is committed on purpose: a Firebase web API key is public
  configuration, restricted by origin and API. Real secrets, such as service accounts
  and `.env` files, never enter the repository.

## Working on it

The app needs a web server, because service workers and Firebase do not run from `file://`.

```bash
firebase emulators:start --only auth,firestore --project bakery-app-ebf90
python -m http.server 5931 --bind 127.0.0.1
```

Open http://127.0.0.1:5931/. On `localhost` the app writes only to the local emulator.

```bash
npm test                    # the unit, i18n, service-worker and shape tests
npm run test:rules:emulated # the Firestore rules checks, on a fresh emulator
node scripts/sw-hashes.mjs  # after changing any precached file
```

## Releases

`main` accepts only pull requests whose `test` and `rules` checks pass. Every pull
request also gets a preview link that runs on a separate project with test data.
Merging to `main` publishes the app and deploys the Cloud Functions. Releases are git
tags (`vMAJOR.MINOR.PATCH`), each with its GitHub Release.
