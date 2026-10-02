const CACHE_NAME = 'theitalianclub-v513';
// Firebase SDK modules (loaded from gstatic) are cached SEPARATELY from CACHE_NAME
// so they survive the cache-version bump that happens on every deploy — otherwise
// the offline SDK would be wiped each release until the next online load. The name
// carries the pinned SDK version; bumping the SDK orphans the old cache for cleanup.
//
// ⚠️ CHANGING THIS NAME COSTS ONE OFFLINE-CAPABLE LAUNCH, AND THE PRICE IS PAID
// ONCE PER SDK UPGRADE. activate() deletes every cache that is neither CACHE_NAME
// nor this one, so renaming it throws the old modules away — and the new ones are
// NOT precached (they are cross-origin; a gstatic hiccup would fail the whole
// all-or-nothing install and stop the phone updating at all). They arrive through
// the fetch handler below, on the first load that has a network.
// So between activate() and that first load, a phone that is OFFLINE cannot boot:
// the code asks for 12.18.0 and nothing has it. In practice the window is very
// small — activate() only happens after a successful 275-file precache, i.e.
// online, and tapping the update banner reloads the page immediately — but it is
// not zero, and it is the reason to bump the SDK deliberately rather than often.
// Leaving the name unchanged would close the window and cost ~1 MB of dead
// modules kept for ever instead; that trade was considered and rejected, because
// a cache whose name lies about its contents is worse than 1 MB.
//
// ⚠️ THE SECOND COST OF AN SDK CHANGE, AND IT IS NOT THE CACHE: FOR ABOUT ONE
// SECOND, ONE PAGE CAN HOLD BOTH VERSIONS. A page opened before the update has
// the old modules evaluated in its module map. Tapping the update banner calls
// skipWaiting(), activate() claims the page, and js/sw-update.js waits
// RELOAD_GRACE_MS (1000ms, so a debounced draft autosave can finish) before
// reloading. During that second the page is already served by the NEW cache, so
// a tap that triggers a lazy import of a module the page has not loaded yet —
// js/staff/firebase-staff.js is the live example, and it names three gstatic
// URLs of its own — pulls the NEW SDK in beside the old one. That is the
// "Service firestore is not available" failure this project's version test
// exists to prevent, arriving by a route no test can see.
// It is self-healing: the reload lands a moment later and the page is whole. It
// is written down because it is invisible, it is new (this is the first release
// in which the SDK version has ever moved), and the obvious "fix" — reloading
// instantly — would go back to eating the autosave that grace window is for.
//
// ⚠️ WHAT WAS FEARED AND MEASURED FALSE: that SDK 12 would raise the browser
// floor and stop the app booting on an old kitchen tablet. It does not, because
// the floor was already there. firebase-app.js at 10.12.0 ALREADY shipped
// optional chaining, so every page has required a 2020-era browser (Safari 13.1
// / iOS 13.4 / Chrome 80) for as long as this app has existed; 12.18.0 adds
// nullish coalescing, which needs exactly the same browsers. No device that
// could run the app before this upgrade is locked out by it. What DID grow is
// the cold download: firestore went 426 KB -> 668 KB, paid once, into this
// cache.
const SDK_CACHE = 'firebase-sdk-12-18-0';
const ASSETS = [
  './',
  './index.html',
  './home.html',
  './calculator.html',
  './orders.html',
  './suppliers.html',
  './install-guide.html',
  './qr.png',
  './js/install-guide.js',
  './tokens.css',
  './auth.css',
  './style.css',
  './orders.css',
  // The guided-mixing alarm. ⚠️ It has to be HERE, not merely on the server: the
  // one moment it is needed is a phone on a bench in a bakery, and a kitchen is
  // exactly where the signal is worst. A sound that only rings online is a sound
  // that fails on the days it matters.
  './sounds/alarm.wav',
  './fonts/manrope-latin.woff2',
  './fonts/manrope-latin-ext.woff2',
  './fonts/dm-mono-400-latin.woff2',
  './fonts/dm-mono-400-latin-ext.woff2',
  './fonts/dm-mono-500-latin.woff2',
  './fonts/dm-mono-500-latin-ext.woff2',
  './fonts/instrument-serif-latin.woff2',
  './fonts/instrument-serif-latin-ext.woff2',
  './fonts/atkinson-next-digits.woff2',
  './js/app.js',
  './js/confirm-dialog.js',
  './js/calculator-icons.js',
  './js/hold-to-zoom.js',
  './js/price-model.js',
  './js/vat-rates.js',
  './js/pack-size.js',
  './js/record-choices.js',
  './js/pack-format.js',
  './js/order-cost.js',
  // ⚠️ NEW, AND js/firebase.js IMPORTS IT — which every page loads before anything
  // else. Missing from this list, an installed phone that goes offline after the
  // deploy would fail to boot ANY screen, not merely lose a price.
  './js/currency.js',
  './js/allergen-model.js',
  './js/allergen-terms.js',
  './js/allergen-match.js',
  './js/venue-features.js',
  // ⚠️ js/auth-gate.js IMPORTS IT, and every page loads that — so a phone missing it
  // offline would fail to boot any screen at all, not merely lose a card.
  './js/home-cards.js',
  // The way from a recipe to its Food cost product and back (13 Sep 2026). Both
  // catalogue.html and foodcost.html import it at load, so offline without it neither
  // page would open at all.
  './js/recipe-link.js',
  // The suggestion list under a field and the full-screen search chooser, SHARED by the
  // Catalogue and Food cost since 13 Sep 2026, with their own copy of el(). Both pages
  // import them at load, so offline without them neither form would open.
  './js/dom.js',
  './js/pick-suggest.js',
  './js/pick-screen.js',
  // The two record cards and what they share, opened from «Fornitori e ingredienti» and
  // from a recipe row in the Catalogue (13 Sep 2026).
  './js/records.js',
  './js/record-ui.js',
  './js/supplier-label.js',
  './js/order-unit.js',
  './js/record-data.js',
  './js/ingredient-record-form.js',
  './js/supplier-record-form.js',
  // Is an item food or packaging? Asked by the registry, the Catalogue and Food cost.
  './js/ingredient-kind.js',
  './js/photo-model.js',
  // ⚠️ A NEW FILE, AND THE ONE FAILURE THAT DOES NOT HEAL ITSELF. An installed
  // phone that goes offline after a deploy finds a file the new HTML asks for and
  // its cache never received. It is also the file that decides whether a label may
  // be printed at all, so its absence would look like the app refusing every label.
  './js/market.js',
  './js/push-model.js',
  './js/push.js',
  './js/client-order-model.js',
  './js/client-order-history.js',
  './js/client-orders-data.js',
  './js/calculator-client-orders.js',
  './js/home-client-orders-badge.js',
  './js/home-order-requests-badge.js',
  './js/away-model.js',
  './js/calculator-recipe-source.js',
  './js/calculator-catalogue-link.js',
  './js/away-screen.js',
  './js/away-reminder.js',
  './js/home-away.js',
  './js/help-content.js',
  './js/help-button.js',
  // ⚠️ order.html AND js/client-orders/* ARE DELIBERATELY ABSENT FROM THIS LIST.
  // They are the page a wholesale CLIENT opens from their own link — not part of the
  // installed app, and no staff phone ever navigates to them. Precaching them would
  // put a copy of the client page on every phone in the bakery for nothing, and the
  // one failure this list exists to prevent (an installed user going offline and
  // finding a newly added file missing) cannot happen to a page installed users never
  // open. The two files above ARE listed: they are the Calculator's own half.
  './js/sw-update.js',
  './js/update-gate.js',
  './js/idle-reset.js',
  './js/install-version.js',
  './js/install-version-boot.js',
  './js/install-hint.js',
  './js/install-hint-boot.js',
  './js/install.js',
  './js/home-orders-badge.js',
  './js/splash-init.js',
  './js/whats-new.js',
  './js/whats-new-boot.js',
  './js/firebase.js',
  // Imported by js/firebase.js on every page: it picks the Firebase project by hostname.
  './js/firebase-target.js',
  // ⚠️ js/firebase.js IMPORTS IT, and every page loads that first: missing here, an
  // installed phone offline after the deploy would boot no screen at all.
  './js/same-data.js',
  './js/location.js',
  './js/sections.js',
  './js/roles.js',
  './js/i18n.js',
  './js/i18n-dom.js',
  './js/join-code.js',
  './js/join-link.js',
  './js/credentials.js',
  './js/staff/dom.js',
  './js/staff/confirm-dialog.js',
  './js/staff/firebase-staff.js',
  // ⚠️ share.js IS LISTED EVEN THOUGH TWO OF ITS THREE CALLERS ARE NOT. The two
  // that are absent are the app owner's back office; people.js is not, and it now
  // needs this to hand over an invitation link. A dependency of a precached file
  // has to be precached, or an installed owner who goes offline finds the import
  // missing — the one failure this list exists to prevent, and the one that does
  // not repair itself on the next load.
  './js/share.js',
  './js/send-icon.js',
  './js/send-sheet.js',
  // people.js IS listed: "Who can get in" belongs to the OWNER OF EVERY CUSTOMER'S
  // venue, not to whoever runs this app. The files above are its dependencies.
  './js/staff/people.js',
  './js/staff/language.js',
  './js/staff/home-cards-screen.js',
  // ⚠️ js/staff/businesses.js, js/staff/new-customer.js AND js/workspace-row.js ARE
  // DELIBERATELY ABSENT FROM THIS LIST. They are the app owner's own back office —
  // one person, on one phone — and the server refuses them to everybody else, so
  // precaching them puts code on every customer's device that none of those devices
  // can ever use. All three are reached through a dynamic import(), and the fetch
  // handler below caches whatever it fetches, so the first open still works offline
  // afterwards; only the very first open after a deploy needs the network, and
  // creating a business needs it anyway. The failure this list exists to prevent —
  // an installed user going offline and finding a newly added file missing — cannot
  // happen to screens no installed user can open.
  './js/local-data.js',
  // "Not sent yet" before a sign-out or a venue switch clears the offline copy. Loaded
  // on the tap by auth-gate.js and at load by home-settings.js (the Home), so offline
  // without it the Home would not open.
  './js/unsent-guard.js',
  './js/auth-gate.js',
  // Imported by the gate on every page (drawn only on a preview link).
  './js/preview-ribbon.js',
  './js/home-session.js',
  './js/home-settings.js',
  './js/location-title.js',
  './js/recipes.js',
  './js/calc.js',
  './js/calculator-recipe-text.js',
  './js/calculator-dough-math.js',
  './js/log.js',
  './js/log-time.js',
  './js/log-model.js',
  './js/log-store.js',
  './js/log-view.js',
  './js/log-edit.js',
  './js/log-qty.js',
  './js/log-add.js',
  './js/log-settings.js',
  './js/whatsapp.js',
  './js/calculator-confirm.js',
  './js/calculator-config.js',
  './js/calculator-config-store.js',
  './js/calculator-order-prefill.js',
  './js/calculator-order-text.js',
  './js/calculator-render.js',
  './js/calculator-settings.js',
  './js/calculator-whatsapp-settings.js',
  './js/vendor/sortable.esm.js',
  './js/orders/boot.js',
  './js/orders/category-batches.js',
  './js/orders/confirm-dialog.js',
  './js/orders/firebase-orders.js',
  './js/orders/orders-main.js',
  './js/orders/dom.js',
  './js/orders/day.js',
  './js/orders/deliveries.js',
  './js/orders/deliveries-view.js',
  './js/orders/send-routes.js',
  './js/orders/send-chooser.js',
  './js/orders/work-week.js',
  './js/orders/archive.js',
  './js/orders/history-window.js',
  './js/orders/reminders.js',
  './js/orders/reminder-view.js',
  './js/orders/suppliers.js',
  './js/orders/ingredients.js',
  './js/orders/no-supplier.js',
  './js/orders/ingredient-search.js',
  './js/orders/ingredient-list.js',
  './js/orders/search-box.js',
  './js/orders/supplier-detail.js',
  './js/orders/supplier-items.js',
  './js/orders/orders-config.js',
  './js/orders/draft.js',
  './js/orders/preview.js',
  './js/orders/order-text.js',
  './js/orders/supplier-picker.js',
  './js/orders/order-request-model.js',
  './js/orders/order-requests.js',
  './js/orders/history.js',
  './js/orders/history-edit.js',
  './js/orders/place-confirm.js',
  './js/orders/untold-changes.js',
  './js/orders/untold-view.js',
  './js/orders/alert-dismissal.js',
  './js/orders/management.js',
  // The records screen: what the Settings panel used to hold, on a page of its own.
  './js/orders/mgmt-ui.js',
  './js/orders/registry.js',
  './js/orders/registry-main.js',
  './js/orders/registry-settings.js',
  './js/form-dirty.js',
  './js/orders/level-stack.js',
  './js/orders/firebase-features.js',
  './js/orders/firebase-photo.js',
  './js/orders/photo-capture.js',
  './js/orders/holidays.js',
  './js/orders/holidays-it.js',
  './js/orders/suggestions.js',
  './js/orders/notifications.js',
  './js/orders/tablet-layout.js',
  './js/orders/sticky-offset.js',
  './js/orders/order-summary.js',
  './js/orders/order-cost-view.js',
  './js/orders/order-summary-view.js',
  './catalogue.html',
  './catalogue.css',
  './label-print.css',
  './records.css',
  './js/catalogue/confirm-dialog.js',
  './js/catalogue/dom.js',
  './js/catalogue/catalogue-model.js',
  './js/catalogue/recipe-cost-model.js',
  './js/catalogue/recipe-allergen-model.js',
  './js/catalogue/allergen-sheet.js',
  // Reading a recipe from a photograph. The screen needs the network to WORK,
  // but it must still LOAD offline — otherwise an installed phone that goes
  // offline after this deploy finds a file the new code asks for and its cache
  // never received, which is the one failure that does not heal itself.
  './js/catalogue/photo-model.js',
  './js/catalogue/photo-capture.js',
  './js/catalogue/firebase-photo.js',
  './js/catalogue/recipe-label-model.js',
  './js/catalogue/label-view.js',
  './js/catalogue/label-template-model.js',
  './js/catalogue/label-print.js',
  './js/catalogue/label-zpl.js',
  './js/print-queue-model.js',
  './js/catalogue/print-transports.js',
  './js/catalogue/ingredient-picker.js',
  './js/ingredient-create.js',
  './js/ingredient-edit-model.js',
  './js/catalogue/ingredient-suggest.js',
  './js/catalogue/firebase-catalogue.js',
  './js/catalogue/catalogue-store.js',
  './js/catalogue/catalogue-main.js',
  './js/catalogue/catalogue-list.js',
  './js/catalogue/tablet.js',
  './js/catalogue/search-box.js',
  './js/catalogue/catalogue-settings.js',
  './js/catalogue/catalogue-detail.js',
  './js/catalogue/catalogue-editor.js',
  './js/catalogue/guided-model.js',
  './js/catalogue/guided-alarm.js',
  './js/catalogue/guided-run.js',
  './js/catalogue/guided-editor.js',
  './js/catalogue/import-to-calculator.js',
  './pastries.html',
  './pastries.css',
  './js/pastries/confirm-dialog.js',
  './js/pastries/dom.js',
  './js/pastries/pastries-model.js',
  './js/pastries/firebase-pastries.js',
  './js/pastries/pastries-store.js',
  './js/pastries/pastries-main.js',
  './js/pastries/pastries-strip.js',
  './js/pastries/pastries-day.js',
  './js/pastries/pastries-editor.js',
  './js/pastries/pastries-log-model.js',
  './js/pastries/pastries-lock.js',
  './js/pastries/pastries-logs-store.js',
  './js/pastries/pastries-logs.js',
  './js/pastries/tablet.js',
  './foodcost.html',
  './foodcost.css',
  './js/foodcost/confirm-dialog.js',
  './js/foodcost/dom.js',
  './js/foodcost/foodcost-model.js',
  './js/foodcost/firebase-foodcost.js',
  './js/foodcost/foodcost-store.js',
  './js/foodcost/foodcost-main.js',
  './js/foodcost/foodcost-list.js',
  './js/foodcost/tablet.js',
  './js/foodcost/crossing-route.js',
  './js/foodcost/foodcost-editor.js',
  './js/foodcost/foodcost-weighing.js',
  // «Which products take which VAT rate» (13 Sep 2026): the guide's words, per country,
  // and the screen that shows them — opened from the product editor.
  './js/foodcost/vat-guide.js',
  './js/foodcost/vat-guide-view.js',
  // The numbers the rules accept on a product, checked before a save (14 Sep 2026).
  './js/foodcost/product-limits.js',
  // The Food cost settings — the hourly labour cost (13 Sep 2026).
  './js/foodcost/foodcost-settings.js',
  // The monthly stocktake. A page of the Food Cost section (it carries
  // data-section="foodcost"), but its own folder, because it owns its own
  // collection and imports nothing from js/foodcost/.
  './inventory.html',
  './inventory.css',
  './js/inventory/confirm-dialog.js',
  './js/inventory/dom.js',
  './js/inventory/inventory-model.js',
  './js/inventory/firebase-inventory.js',
  './js/inventory/inventory-outbox.js',
  './js/inventory/inventory-store.js',
  './js/inventory/inventory-purchases.js',
  './js/inventory/inventory-value.js',
  './js/inventory/inventory-usage.js',
  './js/inventory/inventory-list.js',
  './js/inventory/inventory-detail.js',
  './js/inventory/inventory-main.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// <asset-hashes>
// GENERATED by scripts/sw-hashes.mjs — never edit by hand. Each precached file's git blob
// hash (first 16 characters): the phone checks every download against it, and an update
// copies a file whose hash has not changed out of the previous cache instead of fetching it.
const ASSET_HASHES = {
  "./": '941d8ee8dc45b049',
  "./index.html": '941d8ee8dc45b049',
  "./home.html": 'a4401ab28cb28eb9',
  "./calculator.html": '6febbbbb883d4939',
  "./orders.html": 'aaffdd1680759680',
  "./suppliers.html": '408eeeac61e60686',
  "./install-guide.html": '155cc21e1c1dc524',
  "./qr.png": '761a95e5bc25e2ba',
  "./js/install-guide.js": '17fcd0c0fec489c2',
  "./tokens.css": '35378c324986c90f',
  "./auth.css": '89b970ddd3c5c9be',
  "./style.css": '314acebfd84603b2',
  "./orders.css": '202ddf06e7f3dd0f',
  "./sounds/alarm.wav": '0d1465974f5be95b',
  "./fonts/manrope-latin.woff2": '71eb731d55804619',
  "./fonts/manrope-latin-ext.woff2": 'bd24140af06f1b58',
  "./fonts/dm-mono-400-latin.woff2": '03e4859816da02b8',
  "./fonts/dm-mono-400-latin-ext.woff2": '9785e9177291ef52',
  "./fonts/dm-mono-500-latin.woff2": '67698d873cee7836',
  "./fonts/dm-mono-500-latin-ext.woff2": 'b87200956400a4ac',
  "./fonts/instrument-serif-latin.woff2": '0ad69719cac6f45e',
  "./fonts/instrument-serif-latin-ext.woff2": '0caad588cab430ca',
  "./fonts/atkinson-next-digits.woff2": '99ffa5b0e9a45a2b',
  "./js/app.js": '52b427fa0153b133',
  "./js/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/calculator-icons.js": '6bb803c39eabc4e0',
  "./js/hold-to-zoom.js": '92ffddd4533b46d7',
  "./js/price-model.js": '6ccc7e3d29a576be',
  "./js/vat-rates.js": 'a3d073040b1d8490',
  "./js/pack-size.js": 'e5aae95d8c7b03d5',
  "./js/record-choices.js": '38da7c93b6f723a2',
  "./js/pack-format.js": '7f32c4e57e63f131',
  "./js/order-cost.js": '19b76d67064c2379',
  "./js/currency.js": '9300d5695d2a6dac',
  "./js/allergen-model.js": 'a9ad7592da832a56',
  "./js/allergen-terms.js": '554df7742c345ca6',
  "./js/allergen-match.js": '049c14d576539d26',
  "./js/venue-features.js": '9699a0253c1f5d4d',
  "./js/home-cards.js": '0c4699f44e5079bb',
  "./js/recipe-link.js": '522033a543bf8f67',
  "./js/dom.js": '71ca1a65c3f97c25',
  "./js/pick-suggest.js": '34261899d5cc4fa6',
  "./js/pick-screen.js": '013297871d531869',
  "./js/records.js": '6a0ae8b13241abcb',
  "./js/record-ui.js": 'cddac8193fb24a3b',
  "./js/supplier-label.js": '9601ceed020c0205',
  "./js/order-unit.js": '1e5149dc8263a4f5',
  "./js/record-data.js": '47d198fbb955d963',
  "./js/ingredient-record-form.js": 'a81da752b1fb6a21',
  "./js/supplier-record-form.js": 'e696787bd1e15b7d',
  "./js/ingredient-kind.js": 'b5ea1d7ec8255fd6',
  "./js/photo-model.js": '67d1d83755bbd33a',
  "./js/market.js": '44718f135a2ed1fb',
  "./js/push-model.js": '1a3f64b5f28dc19c',
  "./js/push.js": 'afae0b76a614217c',
  "./js/client-order-model.js": '01afe2d8a045dbe8',
  "./js/client-order-history.js": 'c2939671de6d8112',
  "./js/client-orders-data.js": '4e490005f9908359',
  "./js/calculator-client-orders.js": '9e2d24f49368b74c',
  "./js/home-client-orders-badge.js": '2d1ebe03f89f0699',
  "./js/home-order-requests-badge.js": '3c3f93da00331b92',
  "./js/away-model.js": '95c90de8e2b5ab7a',
  "./js/calculator-recipe-source.js": 'efacab52a1256b8c',
  "./js/calculator-catalogue-link.js": '4824f7bc8b76b71c',
  "./js/away-screen.js": 'e9d001178c51a4e7',
  "./js/away-reminder.js": 'bdd9d8cec3f44033',
  "./js/home-away.js": 'd791865d4ec8e8b1',
  "./js/help-content.js": '6ea7f0e9586c250d',
  "./js/help-button.js": '74575dcd436e06cc',
  "./js/sw-update.js": 'cb938cf56f28cf52',
  "./js/update-gate.js": '2387259480385bfb',
  "./js/idle-reset.js": 'fe75808be89d71f1',
  "./js/install-version.js": 'a35dbefbbbaa3acf',
  "./js/install-version-boot.js": '0e0cea81512abcec',
  "./js/install-hint.js": 'ff453ada2a444fee',
  "./js/install-hint-boot.js": '1dda92943f6c4017',
  "./js/install.js": '3a547433c9c0afc0',
  "./js/home-orders-badge.js": 'b41b71d1d04f6ff8',
  "./js/splash-init.js": '0982bbf1d8228eab',
  "./js/whats-new.js": '28a18a0146f90592',
  "./js/whats-new-boot.js": 'c4a88b96a1986d6a',
  "./js/firebase.js": '379947062df613dc',
  "./js/firebase-target.js": 'b3759997e54ddbc3',
  "./js/same-data.js": '11ff91c9b0192d20',
  "./js/location.js": '6aaf53615a8739d1',
  "./js/sections.js": 'abcfdecb2bd5766d',
  "./js/roles.js": '2b491770c4b6165b',
  "./js/i18n.js": '68836f0477d55794',
  "./js/i18n-dom.js": 'a6d32c5bb1b56674',
  "./js/join-code.js": '5b89de65db5c102f',
  "./js/join-link.js": 'a90ea53c7ba51614',
  "./js/credentials.js": '5d9eece15a3a969a',
  "./js/staff/dom.js": 'e700814a373b85e9',
  "./js/staff/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/staff/firebase-staff.js": '6de5e4bd511328f7',
  "./js/share.js": 'ec8cbe05c9aa86ab',
  "./js/send-icon.js": '3690291475f44a99',
  "./js/send-sheet.js": '3774a0e7acf2ae9e',
  "./js/staff/people.js": 'e108038561ee08f4',
  "./js/staff/language.js": '3e4c115f6cfe2bd2',
  "./js/staff/home-cards-screen.js": 'a53963420fed4227',
  "./js/local-data.js": 'f858223fe05e3f77',
  "./js/unsent-guard.js": 'd75b23b7ad361133',
  "./js/auth-gate.js": '087bd4f627f12197',
  "./js/preview-ribbon.js": 'ee39b7ee13f78c02',
  "./js/home-session.js": '4066767af86b6601',
  "./js/home-settings.js": 'ad226838e6629316',
  "./js/location-title.js": '296d2d7d3d04d7f3',
  "./js/recipes.js": '2ca757945dc99521',
  "./js/calc.js": '3c9dbd187a60501c',
  "./js/calculator-recipe-text.js": 'aa41a24dba41595f',
  "./js/calculator-dough-math.js": '85008bf4375927f4',
  "./js/log.js": 'efca95d743e7267a',
  "./js/log-time.js": '0374bcb500904055',
  "./js/log-model.js": '625b88c5e5336bb4',
  "./js/log-store.js": '9b53edc064b6f29c',
  "./js/log-view.js": '1042bc5d8f8f8939',
  "./js/log-edit.js": '47a7ede51add7f49',
  "./js/log-qty.js": '2aae575dfdaec907',
  "./js/log-add.js": 'c5eccb926adfb3ae',
  "./js/log-settings.js": 'cebf8412a51f8506',
  "./js/whatsapp.js": 'bae7621de9542fc1',
  "./js/calculator-confirm.js": '68a8ecb9ef0f0ab9',
  "./js/calculator-config.js": '233fcda48cb469ce',
  "./js/calculator-config-store.js": '05b4d1f7b091fd60',
  "./js/calculator-order-prefill.js": '28c00f4fea7d43b7',
  "./js/calculator-order-text.js": '3eabd34a0df19321',
  "./js/calculator-render.js": 'bb2486b164490152',
  "./js/calculator-settings.js": '5f72aae8165643a6',
  "./js/calculator-whatsapp-settings.js": 'd5c36f05c04bdbea',
  "./js/vendor/sortable.esm.js": '824d48148fc5b469',
  "./js/orders/boot.js": '53dba081d29270d8',
  "./js/orders/category-batches.js": '03d72f63c4fa4a8a',
  "./js/orders/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/orders/firebase-orders.js": '79a914116cfcb55d',
  "./js/orders/orders-main.js": '26f58fbdc2893c3c',
  "./js/orders/dom.js": '7ec966d71c5356cd',
  "./js/orders/day.js": '8e00beadcda80dd1',
  "./js/orders/deliveries.js": 'cb8ab18721026f83',
  "./js/orders/deliveries-view.js": '63b95659f1224c71',
  "./js/orders/send-routes.js": '88562d53be92460e',
  "./js/orders/send-chooser.js": '9230aca2f6724221',
  "./js/orders/work-week.js": '0ad139be5b53ea69',
  "./js/orders/archive.js": 'a80df2d6f3858dd2',
  "./js/orders/history-window.js": 'f080bfc32d981c5a',
  "./js/orders/reminders.js": 'e9c255f18abea237',
  "./js/orders/reminder-view.js": '12eb553c1f553522',
  "./js/orders/suppliers.js": '4affc6816abb4b3a',
  "./js/orders/ingredients.js": '2226caf300b9a5b7',
  "./js/orders/no-supplier.js": 'a577ab8cea7c21b4',
  "./js/orders/ingredient-search.js": '3998cd3f18e0144e',
  "./js/orders/ingredient-list.js": '3934daa138993f4f',
  "./js/orders/search-box.js": '471bb6f217d97442',
  "./js/orders/supplier-detail.js": 'c427aeaf434b32cf',
  "./js/orders/supplier-items.js": '08575e8ea54ebe34',
  "./js/orders/orders-config.js": 'afe069c341cc8e01',
  "./js/orders/draft.js": '80560b341f7ca44e',
  "./js/orders/preview.js": '82d27c03b0a1f6bf',
  "./js/orders/order-text.js": '8d2ceea2c0db05e7',
  "./js/orders/supplier-picker.js": '8e0ff20f88ff0cc8',
  "./js/orders/order-request-model.js": 'e4e3365a72660bff',
  "./js/orders/order-requests.js": 'a46a3166f2d88536',
  "./js/orders/history.js": '21d09c16b4470cf6',
  "./js/orders/history-edit.js": '09d342e5954ac6b0',
  "./js/orders/place-confirm.js": '71eaa5ff7ea0fa87',
  "./js/orders/untold-changes.js": '7b084bb498f03345',
  "./js/orders/untold-view.js": '6868bf06ff110f58',
  "./js/orders/alert-dismissal.js": 'fbfe034ffa9f6620',
  "./js/orders/management.js": '1797cd30f5834ffd',
  "./js/orders/mgmt-ui.js": '8894b23fd41e8a66',
  "./js/orders/registry.js": 'ae77bae2dd9bd24c',
  "./js/orders/registry-main.js": '19953dd4988f0af4',
  "./js/orders/registry-settings.js": '74c80116276527d1',
  "./js/form-dirty.js": '27dce3718a33d438',
  "./js/orders/level-stack.js": '6832e37854829455',
  "./js/orders/firebase-features.js": 'de89853130a11423',
  "./js/orders/firebase-photo.js": '39a66d803edc884c',
  "./js/orders/photo-capture.js": 'eea1f85f85b0f26a',
  "./js/orders/holidays.js": '93d9c22d24769c1c',
  "./js/orders/holidays-it.js": '7b57e4698b5f299f',
  "./js/orders/suggestions.js": '4ce6ee178401868c',
  "./js/orders/notifications.js": '72fe5c2caeeb5a3b',
  "./js/orders/tablet-layout.js": '78613f8ebf11850f',
  "./js/orders/sticky-offset.js": '9c0ff3c78205049f',
  "./js/orders/order-summary.js": '3a9ad87dad4119e2',
  "./js/orders/order-cost-view.js": '8812db131fc92d28',
  "./js/orders/order-summary-view.js": '88dd7cfd3e65e3f4',
  "./catalogue.html": '91eacf7f31a7713b',
  "./catalogue.css": '655215cf87fd1c75',
  "./label-print.css": 'ffbcdf4e7a627a2d',
  "./records.css": '2a4ddcb99e16c298',
  "./js/catalogue/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/catalogue/dom.js": '9878ae7c750afd79',
  "./js/catalogue/catalogue-model.js": '797cccdb6a9a4d53',
  "./js/catalogue/recipe-cost-model.js": 'd29f16ee37c017a5',
  "./js/catalogue/recipe-allergen-model.js": '52209f23cc007a0d',
  "./js/catalogue/allergen-sheet.js": 'b82e723ddeee0224',
  "./js/catalogue/photo-model.js": '437ecaf7df453145',
  "./js/catalogue/photo-capture.js": '575332d39e58288d',
  "./js/catalogue/firebase-photo.js": 'a1ecd040521d9a5d',
  "./js/catalogue/recipe-label-model.js": '8790302faf981b5a',
  "./js/catalogue/label-view.js": '77e90c2e289a2457',
  "./js/catalogue/label-template-model.js": '480a35fa8bd788e3',
  "./js/catalogue/label-print.js": 'b01a3743eb4bccc8',
  "./js/catalogue/label-zpl.js": '843e46ac6bb50597',
  "./js/print-queue-model.js": '52602cad051dbba0',
  "./js/catalogue/print-transports.js": '088f68d76249710f',
  "./js/catalogue/ingredient-picker.js": 'a8eef2afe961e8a2',
  "./js/ingredient-create.js": '4fe6764763d30637',
  "./js/ingredient-edit-model.js": '75b571a45585a715',
  "./js/catalogue/ingredient-suggest.js": '70f26e512587e448',
  "./js/catalogue/firebase-catalogue.js": '4a56f24592f377c5',
  "./js/catalogue/catalogue-store.js": '32d3ef5ccfb6da26',
  "./js/catalogue/catalogue-main.js": 'e4d45c2098ab7281',
  "./js/catalogue/catalogue-list.js": 'e3884564b29e8a7c',
  "./js/catalogue/tablet.js": 'fed91ff5d4aa2da4',
  "./js/catalogue/search-box.js": '188bbe833ccbde26',
  "./js/catalogue/catalogue-settings.js": '62e1753f56f7a30a',
  "./js/catalogue/catalogue-detail.js": '52ab290f2feb8f75',
  "./js/catalogue/catalogue-editor.js": 'ab28315da1bcceeb',
  "./js/catalogue/guided-model.js": '60902e8129430dd7',
  "./js/catalogue/guided-alarm.js": '55fb5626d4ef22e7',
  "./js/catalogue/guided-run.js": '76393e41864ce48b',
  "./js/catalogue/guided-editor.js": 'b93f216672607087',
  "./js/catalogue/import-to-calculator.js": '509d83f39384e106',
  "./pastries.html": 'c63b87815434119d',
  "./pastries.css": '8639f8a1013cbddd',
  "./js/pastries/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/pastries/dom.js": '84e0623e447bb7ab',
  "./js/pastries/pastries-model.js": 'd162282f04d5287d',
  "./js/pastries/firebase-pastries.js": 'b93e7234e6f4b2bc',
  "./js/pastries/pastries-store.js": '07fcca1ec0717a80',
  "./js/pastries/pastries-main.js": 'c5ce78730a40fd0e',
  "./js/pastries/pastries-strip.js": '9cfc62e2edf9a343',
  "./js/pastries/pastries-day.js": '66d6b8f0478f7b2c',
  "./js/pastries/pastries-editor.js": '4c9ab869e2445b1e',
  "./js/pastries/pastries-log-model.js": '6e3160b978365672',
  "./js/pastries/pastries-lock.js": 'adfbaeea4bd7c845',
  "./js/pastries/pastries-logs-store.js": '9a81fc94327027be',
  "./js/pastries/pastries-logs.js": '91b2ec2a8704c3e5',
  "./js/pastries/tablet.js": 'c4b527a125c07873',
  "./foodcost.html": '9d455cdf6fbac398',
  "./foodcost.css": 'a25b3b5e1fd20f56',
  "./js/foodcost/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/foodcost/dom.js": '911105da04a03481',
  "./js/foodcost/foodcost-model.js": '465baa67bce8123a',
  "./js/foodcost/firebase-foodcost.js": '6e843c7f39d651c5',
  "./js/foodcost/foodcost-store.js": '784c7844dfd80044',
  "./js/foodcost/foodcost-main.js": '9d5c50d6365adf05',
  "./js/foodcost/foodcost-list.js": '897a6bf3b9e0e95d',
  "./js/foodcost/tablet.js": '2eb3e7cad10ca3fc',
  "./js/foodcost/crossing-route.js": '2993db36c98800ae',
  "./js/foodcost/foodcost-editor.js": '779964ac395bbea2',
  "./js/foodcost/foodcost-weighing.js": 'cb2f9dfafec4d739',
  "./js/foodcost/vat-guide.js": '59257253ecddb640',
  "./js/foodcost/vat-guide-view.js": '34ce4c1f2df472ed',
  "./js/foodcost/product-limits.js": 'd73e12634551ea98',
  "./js/foodcost/foodcost-settings.js": '9627111b53f26939',
  "./inventory.html": '30892b65b8d24d4b',
  "./inventory.css": '3ee3317ef2527b96',
  "./js/inventory/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/inventory/dom.js": '5971dfbbb1e223ec',
  "./js/inventory/inventory-model.js": '09eed83d8469a166',
  "./js/inventory/firebase-inventory.js": '98880ab94f7ccdfa',
  "./js/inventory/inventory-outbox.js": '396a5be9a9069278',
  "./js/inventory/inventory-store.js": '3ea0528fdec4eabb',
  "./js/inventory/inventory-purchases.js": '7c5fd05cc6dccdb6',
  "./js/inventory/inventory-value.js": 'ccb17e0a139a361e',
  "./js/inventory/inventory-usage.js": '5b580d4c482d01c3',
  "./js/inventory/inventory-list.js": 'bd7ef2eceb92c330',
  "./js/inventory/inventory-detail.js": 'ce63d7af51a2622a',
  "./js/inventory/inventory-main.js": 'a63c72974d9b2cf2',
  "./manifest.json": 'b3afdecd54f14f64',
  "./icons/icon-192.png": '16eed7827b42285d',
  "./icons/icon-512.png": '30e4120be12274a1',
};
// </asset-hashes>

// ⚠️⚠️ THE PRECACHE IS ALL-OR-NOTHING, AND IT IS NOW THE CODE THAT SAYS SO.
// Until this version the install used Promise.allSettled and reported success with a
// hole in the cache, while three separate notes in this project asserted the opposite
// — and one of them was USED as a rule: v1.65.1 read an installed cache as 191 of 192
// and dismissed it with "a real failure gives an EMPTY cache". It does not; 191 of 192
// is exactly the shape of one failed asset. The verdict there was right and the
// criterion behind it was not.
//
// ⚠️ WHAT A HOLE ACTUALLY COSTS, STATED HONESTLY, BECAUSE THE TRADE BELOW DEPENDS ON
// IT. A precached file missing from the cache is fetched from the network by the fetch
// handler, so a hole costs that screen only while OFFLINE. What is NOT recoverable is
// the moment of the swap: activate() deletes every cache that is not this one, so a
// partial worker destroys the last COMPLETE copy on its way in.
//
// ⚠️ THE RETRY IS WHAT MAKES STRICTNESS AFFORDABLE, and it guards a failure this
// project has observed rather than imagined: the whole list leaves in one burst, and
// GitHub Pages has answered 503 to one file of such a burst and 200 five times on
// retry (v1.63.0). Failing on the first refusal would turn an ordinary throttle into
// a release nobody receives.
//
// ⚠️⚠️ AND THE PRICE OF STRICTNESS, WHICH IS REAL AND MUST NOT BE LOST: a phone that
// can never complete the precache stops receiving updates ENTIRELY AND SILENTLY —
// js/sw-update.js announces an update only from the 'installed' state, so a rejected
// install shows no banner and triggers no compulsory-update gate. That phone runs old
// code against rules that deployed instantly, which is the very thing the gate exists
// to prevent. Two things stand between that and a release: the test that every ASSETS
// entry EXISTS (a mistyped path being the likeliest permanent cause), and this
// project's post-deploy sweep, which already asks the live site for all 275 files.
// ⚠️ NEITHER covers a device-specific failure — nobody has yet confirmed an update
// landing on a real iPhone under this code.
//
// cache: 'reload' bypasses the browser's HTTP cache (GitHub Pages serves
// ~10-minute max-age), so a brand-new worker can never precache stale copies.
const PRECACHE_ATTEMPTS = 3;

// ── Fingerprints (see ASSET_HASHES and scripts/sw-hashes.mjs) ────────────────
//
// ⚠️⚠️ EVERY FILE DOWNLOADED HERE IS CHECKED AGAINST ITS FINGERPRINT (speed audit, 23 Sep
// 2026). For a minute after a deploy GitHub Pages can still answer with the previous
// copy of a file; stored under this worker's name, that copy would be served until the
// next release, and — since files are no longer fetched again behind every request —
// nothing would ever replace it. A mismatch is fetched once more past the CDN; see
// cacheOne for why a copy that STILL does not match is stored rather than refused.
const HASH_HEADER = 'x-mise-hash';

// ⚠️ NOT CHECKED ON THIS COMPUTER, and only there. A Windows checkout serves its text
// files with CRLF line endings while GitHub serves the committed LF bytes, so on a local
// server every text file would fail its fingerprint and no worker would ever install
// (found by driving it, 23 Sep 2026). The hostnames are the same list js/firebase.js uses
// to send the app to the emulators instead of production.
const VERIFY_FINGERPRINTS = !['localhost', '127.0.0.1', '::1', '[::1]'].includes(self.location.hostname);

// A body's git blob hash, the same one scripts/sw-hashes.mjs recorded: sha1 of
// "blob <length>\0" followed by the bytes.
async function blobHash(response) {
  const body = new Uint8Array(await response.clone().arrayBuffer());
  const head = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// The response, carrying its fingerprint — which is how the NEXT update recognises it.
function stamped(response, hash) {
  const headers = new Headers(response.headers);
  headers.set(HASH_HEADER, hash);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// The caches earlier releases left behind, newest first: where an unchanged file is
// copied from instead of downloaded.
async function olderCaches() {
  const version = name => Number((name.match(/-v(\d+)$/) || [])[1]) || 0;
  const names = (await caches.keys())
    .filter(k => k !== CACHE_NAME && k !== SDK_CACHE && k.startsWith('theitalianclub-'))
    .sort((a, b) => version(b) - version(a));
  return Promise.all(names.map(n => caches.open(n)));
}

// One precached file into this worker's cache.
//
// ⚠️ AN UNCHANGED FILE IS COPIED, NOT DOWNLOADED. A release used to download all ~250
// files (~1.26 MB) whatever it changed; now only the files whose fingerprint differs
// from the copy already on the phone travel. A copy made before fingerprints existed
// carries none, so the first update under this code still downloads everything, once.
async function cacheOne(cache, donors, asset) {
  const want = ASSET_HASHES[asset];
  const request = new Request(asset, { cache: 'reload' });
  if (want) {
    for (const donor of donors) {
      const old = await donor.match(request);
      if (old && old.headers.get(HASH_HEADER) === want) {
        await cache.put(request, old);
        return;
      }
    }
  }
  let res = await fetch(request);
  if (!res.ok) throw new Error(`${asset}: HTTP ${res.status}`);
  let got = await blobHash(res);
  if (VERIFY_FINGERPRINTS && want && got !== want) {
    // Most likely the CDN still holding the previous copy for a minute after a deploy.
    // The same file asked for under an address it has never seen goes past it.
    const again = await fetch(new Request(`${asset}${asset.includes('?') ? '&' : '?'}fp=${want}`, { cache: 'reload' }));
    if (again.ok) {
      const againHash = await blobHash(again);
      if (againHash === want) { res = again; got = againHash; }
    }
  }
  // ⚠️⚠️ A COPY THAT STILL DOES NOT MATCH IS STORED ANYWAY — NEVER REFUSED (code review,
  // 23 Sep 2026). Refusing would fail the whole install, and a device whose bytes are
  // changed on the way in (an antivirus rewriting HTML, a company proxy) would then fail
  // EVERY install for ever: no banner, no compulsory update, nothing on screen — a phone
  // that silently never updates again, which is worse than one mismatched file. It is
  // stored under the hash it really has, so the next release will not copy it forward.
  if (VERIFY_FINGERPRINTS && want && got !== want) {
    console.warn(`${asset}: the server sent ${got}, this release is ${want} — stored as received`);
  }
  await cache.put(request, stamped(res, got));
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const donors = await olderCaches();
  let pending = ASSETS;
  for (let attempt = 1; attempt <= PRECACHE_ATTEMPTS && pending.length; attempt++) {
    // Back off before a retry, never before the first attempt: a throttle that is
    // answered immediately is simply the same burst again.
    if (attempt > 1) await new Promise(done => setTimeout(done, 400 * (attempt - 1)));
    const results = await Promise.allSettled(pending.map(asset => cacheOne(cache, donors, asset)));
    pending = pending.filter((url, i) => results[i].status === 'rejected');
  }
  if (pending.length) {
    // This message is the ONLY diagnosis a failed install produces — nothing else in
    // the app reports one — so it names the files rather than only counting them.
    throw new Error(
      `precache incomplete: ${pending.length} of ${ASSETS.length} assets failed — ` +
      pending.slice(0, 5).join(', ') + (pending.length > 5 ? ', …' : '')
    );
  }
}

self.addEventListener('install', e => {
  // NO skipWaiting() here: the new worker must WAIT so js/sw-update.js can show
  // the update banner; it activates when the user taps it (skipWaiting message
  // below) or when the app is next opened with no pages left from the old one.
  e.waitUntil(precache());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== SDK_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Every precached file's full address, for the fetch handler below.
const PRECACHED = new Set(ASSETS.map(a => new URL(a, self.location.href).href));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Cross-origin requests are bypassed (the browser performs them directly) with
  // ONE exception: the Firebase SDK modules on www.gstatic.com/firebasejs/*. Those
  // are static, CORS-clean, immutable files — caching them in a SEPARATE, persistent
  // cache (SDK_CACHE, untouched by the per-deploy CACHE_NAME bump) lets the app boot
  // offline and start instantly on a slow network, with no SDK vendoring and no
  // import rewriting. Everything else cross-origin — the live Firestore/Auth API,
  // anything else on gstatic (hence the /firebasejs/ path guard), the localhost
  // emulator — is left untouched: re-issuing those through the SW could cause a
  // transient auth/network-request-failed on the first sign-in.
  //
  // ⚠️⚠️ A CACHED SDK MODULE IS SERVED AND NOTHING ELSE HAPPENS (speed audit, 26 Sep
  // 2026). Every module used to be downloaded again BEHIND every page and written back
  // into this cache — ~900 KB rewritten to the phone's storage on each screen change,
  // competing with the page for the very disk the offline database reads from. It
  // bought nothing: the version is in the ADDRESS (/firebasejs/12.18.0/…), so a file at
  // one address never changes, and a new SDK version is a new address, fetched here on
  // its first use.
  if (url.origin !== self.location.origin) {
    if (url.host === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
      e.respondWith(
        caches.open(SDK_CACHE).then(cache =>
          cache.match(e.request).then(cached => cached || fetch(e.request).then(res => {
            // Store only executable, CORS-clean module responses (not opaque/redirected).
            if (res && res.status === 200 && !res.redirected &&
                (res.type === 'cors' || res.type === 'basic')) {
              cache.put(e.request, res.clone()).catch(() => {});
            }
            return res;
          }))
        )
      );
    }
    return;
  }

  // Install guide assets: always network-first (fresh from server), falling back
  // to cache only when offline. Avoids serving a stale guide after an update.
  const p = url.pathname;
  if (p.endsWith('/install-guide.html') || p.endsWith('/qr.png') || p.endsWith('/js/install-guide.js')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(res => {
        if (res.ok) {
          const clone = res.clone();
          // Caching is best-effort: a full quota must not become an unhandled
          // rejection, and the response has already been handed to the page.
          caches.open(CACHE_NAME)
            .then(cache => cache.put(e.request, clone))
            .catch(() => {});
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  if (e.request.method !== 'GET') return;

  // ⚠️⚠️ A PRECACHED FILE COMES FROM THIS WORKER'S OWN CACHE, AND NOTHING ELSE (speed
  // audit, 23 Sep 2026). It used to be served from the cache AND fetched again behind
  // every request — dozens of requests on every page — and after a deploy the OLD worker
  // wrote the NEW files into its OLD cache, so one page could run half of each release.
  // A precached file changes only with a new CACHE_NAME, whose worker brings its own
  // cache; ASSET_HASHES and its test make it impossible to change one without that.
  //
  // ⚠️ THIS WORKER'S CACHE, NOT caches.match(): while an update waits, its cache already
  // exists beside this one, and a global match could hand this worker's page a file
  // from the next release.
  if (PRECACHED.has(url.origin + url.pathname) && !url.search) {
    e.respondWith(
      caches.open(CACHE_NAME)
        .then(cache => cache.match(e.request))
        .then(hit => hit || fetch(e.request))
    );
    return;
  }

  // Anything else of ours — the client ordering page, which is deliberately not
  // precached — goes to the NETWORK FIRST: nothing versions it, so a cached copy served
  // first could stay stale for ever. The cache is the fallback with no signal.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        // Best-effort: a failed put must not surface as an unhandled rejection when
        // the page already has its response.
        caches.open(CACHE_NAME)
          .then(cache => cache.put(e.request, clone))
          .catch(() => {});
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});

self.addEventListener('message', e => {
  if (!e.source) return;
  if (e.data && e.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// ── Notifications that arrive with the app closed ────────────────────────────
//
// ⚠️ THIS IS HERE, IN THE APP'S OWN SERVICE WORKER, ON PURPOSE. Firebase's usual
// setup registers a SECOND worker (firebase-messaging-sw.js) at the site ROOT —
// and this app is not at the root, it lives under /mise_app/. Two
// workers fighting over one scope is a whole class of bug that simply cannot
// happen if there is only ever one. getToken() is handed THIS registration
// instead (js/push.js).
//
// The server sends DATA-ONLY messages, so nothing is displayed until the code
// below decides to display it. A message carrying a `notification` block would be
// shown by the browser automatically, and the app would lose the two decisions it
// actually needs: whether to show it at all, and what it should say.

// Every push must result in something visible — a browser is entitled to revoke
// permission from a site that pushes silently — so this always shows SOMETHING,
// even when the payload is unreadable.
function pushPayload(event) {
  try {
    const raw = event.data ? event.data.json() : null;
    // FCM delivers the fields under `data` for a data-only message.
    return (raw && (raw.data || raw)) || {};
  } catch (err) {
    return {};
  }
}

self.addEventListener('push', event => {
  const data = pushPayload(event);
  const title = data.title || 'Mise';
  const body = data.body || 'Open the app to see what changed.';
  // One notification per thing: a re-delivery REPLACES rather than stacking three
  // copies of the same alarm on a lock screen.
  const tag = data.tag || 'italianclub';

  event.waitUntil((async () => {
    // ⚠️ SILENT WHEN THE APP IS ALREADY IN FRONT OF YOU. The alarm the page itself
    // sounds is better (it repeats, and the screen is showing the countdown), so a
    // notification on top of it is the same thing twice. `visibilityState` is the
    // test and not merely "a window exists": a page left open behind a locked
    // screen is not somebody looking at it.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const watching = open.some(c => c.visibilityState === 'visible');
    if (watching) {
      // Still tell the page, so it can react without a second alarm going off.
      open.forEach(c => { try { c.postMessage({ type: 'push', data }); } catch (err) {} });
      return;
    }

    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: data.url || './index.html' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil((async () => {
    // Reuse a window that is already open rather than piling up copies of the app.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(url, self.location.href).href;
    const existing = open.find(c => c.url === target) || open[0];
    if (existing) {
      try { await existing.focus(); } catch (err) {}
      if (existing.url !== target && 'navigate' in existing) {
        try { await existing.navigate(target); } catch (err) {}
      }
      return;
    }
    await self.clients.openWindow(target);
  })());
});
