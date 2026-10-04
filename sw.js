const CACHE_NAME = 'theitalianclub-v598';
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
// the code asks for the new version and nothing has it. In practice the window is very
// small — activate() only happens after a successful 302-file precache, i.e.
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
const SDK_CACHE = 'firebase-sdk-12-19-0';
const ASSETS = [
  './',
  './index.html',
  './home.html',
  './calculator.html',
  './orders.html',
  './suppliers.html',
  './install-guide.html',
  './reset-password.html',
  './js/reset-password.js',
  './js/reset-password-boot.js',
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
  './js/vat-number.js',
  './js/pack-size.js',
  './js/pack-format.js',
  './js/record-choices.js',
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
  './js/ingredient-name.js',
  './js/photo-model.js',
  // ⚠️ A NEW FILE, AND THE ONE FAILURE THAT DOES NOT HEAL ITSELF. An installed
  // phone that goes offline after a deploy finds a file the new HTML asks for and
  // its cache never received. It is also the file that decides whether a label may
  // be printed at all, so its absence would look like the app refusing every label.
  './js/market.js',
  './js/reveal-field.js',
  './js/save-guard.js',
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
  './js/kiosk.js',
  './js/kiosk-model.js',
  './js/wake-lock.js',
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
  './js/keyboard-done.js',
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
  './js/app-version.js',
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
  './js/confirm-flow.js',
  './js/zoom-steps.js',
  './js/calc-fullscreen.js',
  './js/result-place.js',
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
  './js/orders/order-day.js',
  './js/orders/deliveries.js',
  './js/orders/deliveries-view.js',
  './js/orders/send-routes.js',
  './js/orders/send-chooser.js',
  './js/orders/work-week.js',
  './js/orders/archive.js',
  './js/orders/history-window.js',
  './js/orders/reminders.js',
  './js/orders/kiosk-lines.js',
  './js/orders/reminder-view.js',
  './js/orders/suppliers.js',
  './js/orders/ingredients.js',
  './js/orders/no-supplier.js',
  './js/orders/line-supplier.js',
  './js/orders/memo.js',
  './js/orders/render-scheduler.js',
  './js/orders/ingredient-search.js',
  './js/orders/ingredient-list.js',
  './js/orders/search-box.js',
  './js/orders/supplier-detail.js',
  './js/orders/supplier-items.js',
  './js/orders/orders-config.js',
  './js/orders/supplier-order.js',
  './js/orders/supplier-order-screen.js',
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
  // «Import from invoices»: the pure model and plan, the data layer and the screen (suppliers.html).
  './js/orders/invoice-import-model.js',
  './js/orders/invoice-import-plan.js',
  './js/orders/invoice-import-data.js',
  './js/orders/invoice-import-screen.js',
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
  './js/catalogue/zoom-steps.js',
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
  "./": 'fb6d4386faa840f8',
  "./index.html": 'fb6d4386faa840f8',
  "./home.html": 'a4401ab28cb28eb9',
  "./calculator.html": '1342c7f5093e1664',
  "./orders.html": 'e1cc2322509dfbe5',
  "./suppliers.html": 'd0d861102a8e44b4',
  "./install-guide.html": '155cc21e1c1dc524',
  "./reset-password.html": '6210ead049967293',
  "./js/reset-password.js": '82c76584ef73d006',
  "./js/reset-password-boot.js": '9c3e1fca587f872c',
  "./qr.png": '761a95e5bc25e2ba',
  "./js/install-guide.js": '17fcd0c0fec489c2',
  "./tokens.css": '9bec41764fe56171',
  "./auth.css": '55b0bc1d41af5718',
  "./style.css": '9b9c828758e02325',
  "./orders.css": 'd15acfef1e289715',
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
  "./js/app.js": '751d79f292d1b62e',
  "./js/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/calculator-icons.js": 'c0b185a137195263',
  "./js/hold-to-zoom.js": 'e077890cd7ba70de',
  "./js/price-model.js": 'a68cbd60d71d814b',
  "./js/vat-rates.js": 'a3d073040b1d8490',
  "./js/vat-number.js": '097b915810c4d39a',
  "./js/pack-size.js": 'e5aae95d8c7b03d5',
  "./js/pack-format.js": 'c1b3a80d0921eb39',
  "./js/record-choices.js": '38da7c93b6f723a2',
  "./js/order-cost.js": 'a89d555ef365227d',
  "./js/currency.js": '241b1dbdf4cc465f',
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
  "./js/record-ui.js": '57bd203aced98f84',
  "./js/supplier-label.js": '9601ceed020c0205',
  "./js/order-unit.js": '8de5f5c0c76d5ff9',
  "./js/record-data.js": '4055f2a4cc82a953',
  "./js/ingredient-record-form.js": '125d345d918611c9',
  "./js/supplier-record-form.js": 'ea6bde005d398345',
  "./js/ingredient-kind.js": 'b5ea1d7ec8255fd6',
  "./js/ingredient-name.js": '9045e25fc169d2ff',
  "./js/photo-model.js": '67d1d83755bbd33a',
  "./js/market.js": '4b3979c5ca8128f7',
  "./js/reveal-field.js": 'f311c75f44e632d8',
  "./js/save-guard.js": '361b8200f7935368',
  "./js/push-model.js": '40c90e5a6229cb3f',
  "./js/push.js": 'd7aad3c3bd098461',
  "./js/client-order-model.js": '01afe2d8a045dbe8',
  "./js/client-order-history.js": 'c2939671de6d8112',
  "./js/client-orders-data.js": 'fe05d6e0f3d6d31e',
  "./js/calculator-client-orders.js": '04708e7a0b63635d',
  "./js/home-client-orders-badge.js": '2d1ebe03f89f0699',
  "./js/home-order-requests-badge.js": '3c3f93da00331b92',
  "./js/away-model.js": '95c90de8e2b5ab7a',
  "./js/calculator-recipe-source.js": '01a649ab954dbf31',
  "./js/calculator-catalogue-link.js": '41710bee4cba59f8',
  "./js/away-screen.js": 'e9d001178c51a4e7',
  "./js/away-reminder.js": 'bdd9d8cec3f44033',
  "./js/home-away.js": 'd791865d4ec8e8b1',
  "./js/help-content.js": '6ea7f0e9586c250d',
  "./js/help-button.js": '74575dcd436e06cc',
  "./js/sw-update.js": '645f66a2c7f40a6a',
  "./js/update-gate.js": '1801738b3e6def2d',
  "./js/kiosk.js": '68fc99ee7dad95c0',
  "./js/kiosk-model.js": '11735770388b0a44',
  "./js/wake-lock.js": '3cc98d18c5e2cbab',
  "./js/install-version.js": 'a35dbefbbbaa3acf',
  "./js/install-version-boot.js": '0e0cea81512abcec',
  "./js/install-hint.js": 'ff453ada2a444fee',
  "./js/install-hint-boot.js": '1dda92943f6c4017',
  "./js/install.js": '3a547433c9c0afc0',
  "./js/home-orders-badge.js": 'b41b71d1d04f6ff8',
  "./js/splash-init.js": '0982bbf1d8228eab',
  "./js/whats-new.js": '28a18a0146f90592',
  "./js/whats-new-boot.js": 'fc298a84a183238b',
  "./js/firebase.js": '7bbb3c00b4f7b031',
  "./js/firebase-target.js": 'b3759997e54ddbc3',
  "./js/same-data.js": '11ff91c9b0192d20',
  "./js/location.js": '6aaf53615a8739d1',
  "./js/sections.js": 'abcfdecb2bd5766d',
  "./js/roles.js": '7a7c5cf34d57f511',
  "./js/i18n.js": '88634e462670d3ac',
  "./js/i18n-dom.js": '24249af4367511e5',
  "./js/keyboard-done.js": 'de05a6dd1f3aac26',
  "./js/join-code.js": '5b89de65db5c102f',
  "./js/join-link.js": 'a90ea53c7ba51614',
  "./js/credentials.js": 'b805f88d003ea918',
  "./js/staff/dom.js": 'e700814a373b85e9',
  "./js/staff/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/staff/firebase-staff.js": '556b93b42a530ad5',
  "./js/share.js": 'ec8cbe05c9aa86ab',
  "./js/send-icon.js": '3690291475f44a99',
  "./js/send-sheet.js": '3774a0e7acf2ae9e',
  "./js/staff/people.js": '170bfae487a1bfbf',
  "./js/staff/language.js": '3e4c115f6cfe2bd2',
  "./js/staff/home-cards-screen.js": 'a53963420fed4227',
  "./js/local-data.js": '15240f20e96af7e0',
  "./js/unsent-guard.js": 'd75b23b7ad361133',
  "./js/auth-gate.js": '1ba0756de8dcc9cc',
  "./js/preview-ribbon.js": 'ee39b7ee13f78c02',
  "./js/home-session.js": '4066767af86b6601',
  "./js/home-settings.js": '22977f1f07dd9ad8',
  "./js/app-version.js": '2ed7f01712161130',
  "./js/location-title.js": '296d2d7d3d04d7f3',
  "./js/recipes.js": 'd078db16391046b7',
  "./js/calc.js": '4eaff92e58966666',
  "./js/calculator-recipe-text.js": 'aa41a24dba41595f',
  "./js/calculator-dough-math.js": '85008bf4375927f4',
  "./js/log.js": '386a3720e891f9ae',
  "./js/log-time.js": '0374bcb500904055',
  "./js/log-model.js": 'c9facc3202c2e8fe',
  "./js/log-store.js": '9b53edc064b6f29c',
  "./js/log-view.js": '34bd6b667b68a054',
  "./js/log-edit.js": '6e8ece2039936420',
  "./js/log-qty.js": '2aae575dfdaec907',
  "./js/log-add.js": '85cc4c93082f8568',
  "./js/log-settings.js": '2878595500c2fea5',
  "./js/whatsapp.js": '85499983381f4136',
  "./js/calculator-confirm.js": '68a8ecb9ef0f0ab9',
  "./js/calculator-config.js": '65e76f83f8458dbb',
  "./js/confirm-flow.js": '350a9b206670e6bd',
  "./js/zoom-steps.js": '7d6e1d46151b58e4',
  "./js/calc-fullscreen.js": '6af51e2b62fec85b',
  "./js/result-place.js": '01dfd5a297ba5c9c',
  "./js/calculator-config-store.js": 'e1fe72337b0b2bf3',
  "./js/calculator-order-prefill.js": '28c00f4fea7d43b7',
  "./js/calculator-order-text.js": '3eabd34a0df19321',
  "./js/calculator-render.js": 'd956e1fab1078099',
  "./js/calculator-settings.js": 'b60e28ec7bea4d76',
  "./js/calculator-whatsapp-settings.js": '39823bea666c3471',
  "./js/vendor/sortable.esm.js": '824d48148fc5b469',
  "./js/orders/boot.js": '53dba081d29270d8',
  "./js/orders/category-batches.js": '03d72f63c4fa4a8a',
  "./js/orders/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/orders/firebase-orders.js": 'de887575159d9af2',
  "./js/orders/orders-main.js": '33e62d806a80332b',
  "./js/orders/dom.js": '7ec966d71c5356cd',
  "./js/orders/day.js": '107abcbdf353c709',
  "./js/orders/order-day.js": '1194fbe02f9a9686',
  "./js/orders/deliveries.js": 'c3808bbad1620aff',
  "./js/orders/deliveries-view.js": '70f521b241e2c17e',
  "./js/orders/send-routes.js": '88562d53be92460e',
  "./js/orders/send-chooser.js": 'b36520fb74f98561',
  "./js/orders/work-week.js": '0ad139be5b53ea69',
  "./js/orders/archive.js": '3c1dab75b1779247',
  "./js/orders/history-window.js": '5c1fd1dd0e61ab85',
  "./js/orders/reminders.js": 'e9c255f18abea237',
  "./js/orders/kiosk-lines.js": '5b8e62a965bec75d',
  "./js/orders/reminder-view.js": '8fef47478579d97e',
  "./js/orders/suppliers.js": 'b1fb5923228df1a8',
  "./js/orders/ingredients.js": 'cdcb74e00643cc06',
  "./js/orders/no-supplier.js": '185050fd12a0a2b0',
  "./js/orders/line-supplier.js": '3d9d21bdc79b2955',
  "./js/orders/memo.js": '5629ad18c45095f2',
  "./js/orders/render-scheduler.js": 'ba85c95abb13b359',
  "./js/orders/ingredient-search.js": 'b205e1d0d4d5185c',
  "./js/orders/ingredient-list.js": 'bd69097d0d4af250',
  "./js/orders/search-box.js": '471bb6f217d97442',
  "./js/orders/supplier-detail.js": '46e792a492fff53a',
  "./js/orders/supplier-items.js": 'f435e2c2fb1a4f1b',
  "./js/orders/orders-config.js": 'ea185a64f9860879',
  "./js/orders/supplier-order.js": 'b3e5dad1f8190137',
  "./js/orders/supplier-order-screen.js": '85fb2d2d66f06f6d',
  "./js/orders/draft.js": '0a3c9a4ee9682f89',
  "./js/orders/preview.js": '24e6f6170cbb0fec',
  "./js/orders/order-text.js": '5067d23f04b8df8a',
  "./js/orders/supplier-picker.js": '259625649c8cbc4d',
  "./js/orders/order-request-model.js": 'e4e3365a72660bff',
  "./js/orders/order-requests.js": 'a46a3166f2d88536',
  "./js/orders/history.js": '6660ceac1bf8054a',
  "./js/orders/history-edit.js": '8ae63a82dff3413f',
  "./js/orders/place-confirm.js": '71eaa5ff7ea0fa87',
  "./js/orders/untold-changes.js": 'a96e0c1c65ec6191',
  "./js/orders/untold-view.js": '6868bf06ff110f58',
  "./js/orders/alert-dismissal.js": 'fbfe034ffa9f6620',
  "./js/orders/management.js": '21dd583fe32255d8',
  "./js/orders/mgmt-ui.js": '8894b23fd41e8a66',
  "./js/orders/registry.js": '7dd45341e1923a78',
  "./js/orders/registry-main.js": 'cfba8f63af6987a2',
  "./js/orders/registry-settings.js": '74c80116276527d1',
  "./js/orders/invoice-import-model.js": '83fc9ef6febd7d36',
  "./js/orders/invoice-import-plan.js": '5dd52c0716adfa9d',
  "./js/orders/invoice-import-data.js": '6f2dfd88c7417e3f',
  "./js/orders/invoice-import-screen.js": '5b049f460332eea7',
  "./js/form-dirty.js": '27dce3718a33d438',
  "./js/orders/level-stack.js": '6832e37854829455',
  "./js/orders/firebase-features.js": 'a0c27a97d6eb7747',
  "./js/orders/firebase-photo.js": '03e602401453f7c5',
  "./js/orders/photo-capture.js": 'e73f18bf389267f9',
  "./js/orders/holidays.js": '93d9c22d24769c1c',
  "./js/orders/holidays-it.js": '7b57e4698b5f299f',
  "./js/orders/suggestions.js": '7175c7fd940e1c4b',
  "./js/orders/notifications.js": '72fe5c2caeeb5a3b',
  "./js/orders/tablet-layout.js": '61965af69fc1ea62',
  "./js/orders/sticky-offset.js": 'a0c2e623a591b6ba',
  "./js/orders/order-summary.js": '0e2d3ad98ec27217',
  "./js/orders/order-cost-view.js": '4b03fed043e88d39',
  "./js/orders/order-summary-view.js": '2ab80dbb8b7fa26f',
  "./catalogue.html": 'd8e083ace20db70f',
  "./catalogue.css": 'cd81d12ad271c434',
  "./label-print.css": 'ffbcdf4e7a627a2d',
  "./records.css": '8398289629b4233d',
  "./js/catalogue/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/catalogue/dom.js": '9878ae7c750afd79',
  "./js/catalogue/catalogue-model.js": 'b4da069a0283ee7a',
  "./js/catalogue/recipe-cost-model.js": 'd29f16ee37c017a5',
  "./js/catalogue/recipe-allergen-model.js": 'b2a59adbdd259fb1',
  "./js/catalogue/allergen-sheet.js": 'b82e723ddeee0224',
  "./js/catalogue/photo-model.js": '437ecaf7df453145',
  "./js/catalogue/photo-capture.js": '43968960b32fb5dc',
  "./js/catalogue/firebase-photo.js": '6f642c842cd16a3b',
  "./js/catalogue/recipe-label-model.js": '8790302faf981b5a',
  "./js/catalogue/label-view.js": '77e90c2e289a2457',
  "./js/catalogue/label-template-model.js": '480a35fa8bd788e3',
  "./js/catalogue/label-print.js": 'b01a3743eb4bccc8',
  "./js/catalogue/label-zpl.js": '843e46ac6bb50597',
  "./js/print-queue-model.js": '52602cad051dbba0',
  "./js/catalogue/print-transports.js": '088f68d76249710f',
  "./js/catalogue/ingredient-picker.js": 'b3c9b4170e679af9',
  "./js/ingredient-create.js": '195adf62c59c2564',
  "./js/ingredient-edit-model.js": '75b571a45585a715',
  "./js/catalogue/ingredient-suggest.js": 'ddf3ca8acc2ed799',
  "./js/catalogue/firebase-catalogue.js": 'e560966537c00cae',
  "./js/catalogue/catalogue-store.js": '32d3ef5ccfb6da26',
  "./js/catalogue/catalogue-main.js": '6246be78f942669c',
  "./js/catalogue/catalogue-list.js": 'e3884564b29e8a7c',
  "./js/catalogue/tablet.js": 'fed91ff5d4aa2da4',
  "./js/catalogue/search-box.js": '188bbe833ccbde26',
  "./js/catalogue/catalogue-settings.js": '085573368700207f',
  "./js/catalogue/catalogue-detail.js": '47bc797fb462567b',
  "./js/catalogue/zoom-steps.js": '7d6e1d46151b58e4',
  "./js/catalogue/catalogue-editor.js": '6d7fd6f1b73d9958',
  "./js/catalogue/guided-model.js": '60902e8129430dd7',
  "./js/catalogue/guided-alarm.js": '9104e391cb96f5ef',
  "./js/catalogue/guided-run.js": 'da10dcad21f5e8d8',
  "./js/catalogue/guided-editor.js": '54166ebcffc295b7',
  "./js/catalogue/import-to-calculator.js": '509d83f39384e106',
  "./pastries.html": '1235bcabca392b9b',
  "./pastries.css": '3392bc6fd72be603',
  "./js/pastries/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/pastries/dom.js": '84e0623e447bb7ab',
  "./js/pastries/pastries-model.js": 'd162282f04d5287d',
  "./js/pastries/firebase-pastries.js": '89d43ccad1e099b2',
  "./js/pastries/pastries-store.js": '07fcca1ec0717a80',
  "./js/pastries/pastries-main.js": 'fbe7465d10be717e',
  "./js/pastries/pastries-strip.js": '9cfc62e2edf9a343',
  "./js/pastries/pastries-day.js": '66d6b8f0478f7b2c',
  "./js/pastries/pastries-editor.js": '3135e7f4d00f3efb',
  "./js/pastries/pastries-log-model.js": '6e3160b978365672',
  "./js/pastries/pastries-lock.js": 'adfbaeea4bd7c845',
  "./js/pastries/pastries-logs-store.js": '85cc1ec0c21baa30',
  "./js/pastries/pastries-logs.js": '91b2ec2a8704c3e5',
  "./js/pastries/tablet.js": 'c4b527a125c07873',
  "./foodcost.html": 'ab6061099fece3f9',
  "./foodcost.css": 'cff847be143c19af',
  "./js/foodcost/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/foodcost/dom.js": '911105da04a03481',
  "./js/foodcost/foodcost-model.js": '24b84dc23a6182f4',
  "./js/foodcost/firebase-foodcost.js": '48eee23e4556b3f3',
  "./js/foodcost/foodcost-store.js": '784c7844dfd80044',
  "./js/foodcost/foodcost-main.js": '9761b1f6aed19a71',
  "./js/foodcost/foodcost-list.js": '897a6bf3b9e0e95d',
  "./js/foodcost/tablet.js": '2eb3e7cad10ca3fc',
  "./js/foodcost/crossing-route.js": '2993db36c98800ae',
  "./js/foodcost/foodcost-editor.js": 'b650b8ec5e98c192',
  "./js/foodcost/foodcost-weighing.js": 'cb2f9dfafec4d739',
  "./js/foodcost/vat-guide.js": '59257253ecddb640',
  "./js/foodcost/vat-guide-view.js": '34ce4c1f2df472ed',
  "./js/foodcost/product-limits.js": 'd73e12634551ea98',
  "./js/foodcost/foodcost-settings.js": '8299df0496767f9a',
  "./inventory.html": 'd9762babb2ebdec6',
  "./inventory.css": '01904205569af145',
  "./js/inventory/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/inventory/dom.js": '5971dfbbb1e223ec',
  "./js/inventory/inventory-model.js": '7cc2935526d50a88',
  "./js/inventory/firebase-inventory.js": '14b4c710163c0408',
  "./js/inventory/inventory-outbox.js": '396a5be9a9069278',
  "./js/inventory/inventory-store.js": '3ea0528fdec4eabb',
  "./js/inventory/inventory-purchases.js": '703db62f90a981c9',
  "./js/inventory/inventory-value.js": '3c975c413f752b2e',
  "./js/inventory/inventory-usage.js": 'a213666d0119c6b5',
  "./js/inventory/inventory-list.js": 'e7902452c885770a',
  "./js/inventory/inventory-detail.js": '3b0eafbf21c40b48',
  "./js/inventory/inventory-main.js": '0ca1fb51917aafd4',
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
// project has observed rather than imagined: when the whole list left in one burst
// (before A3 capped it at 6 in flight, below), GitHub Pages answered 503 to one file of
// such a burst and 200 five times on retry (v1.63.0). Failing on the first refusal would turn an ordinary throttle into
// a release nobody receives.
//
// ⚠️⚠️ AND THE PRICE OF STRICTNESS, WHICH IS REAL AND MUST NOT BE LOST: a phone that
// can never complete the precache stops receiving updates ENTIRELY AND SILENTLY —
// js/sw-update.js announces an update only from the 'installed' state, so a rejected
// install shows no banner and triggers no compulsory-update gate. That phone runs old
// code against rules that deployed instantly, which is the very thing the gate exists
// to prevent. Two things stand between that and a release: the test that every ASSETS
// entry EXISTS (a mistyped path being the likeliest permanent cause), and this
// project's post-deploy sweep, which already asks the live site for all 302 files.
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
async function blobHashOf(body) {
  const head = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ⚠️ KEPT FOR tests/sw-asset-hashes.test.mjs, which runs the REAL SHA-1 through it; the
// install itself goes through download() below. Not dead code — deleting it turns that
// test red.
async function blobHash(response) {
  return blobHashOf(new Uint8Array(await response.clone().arrayBuffer()));
}

// ⚠️ A DOWNLOADED BODY IS READ ONCE (weak-tablet plan A3). It used to be cloned for the
// hash and streamed again for the cache (a tee that buffers the body). The bytes are read
// here, hashed, and the cached Response is built from the same bytes — hashing and the
// Response still copy them briefly, so the real memory saving is the 6-at-a-time limit
// below, not this. ⚠️ stamped() must keep the network's headers: a cached JS/CSS without
// its content-type is refused as a module/stylesheet and no page would boot offline.
async function download(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, hash: await blobHashOf(bytes) };
}

// The bytes, carrying their fingerprint — which is how the NEXT update recognises them.
function stamped({ response, bytes }, hash) {
  const headers = new Headers(response.headers);
  headers.set(HASH_HEADER, hash);
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
}

// ⚠️ AT MOST 6 DOWNLOADS IN FLIGHT. The whole list used to leave in one burst: GitHub
// Pages has answered 503 to bursts, and ~290 bodies in memory at once is a peak a
// 1.5 GB lab tablet does not have. Results are per asset, in the order given, with
// allSettled semantics: one failure never stops the others.
const PRECACHE_CONCURRENCY = 6;

async function settledPool(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await work(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
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
  res = await download(res);
  let got = res.hash;
  if (VERIFY_FINGERPRINTS && want && got !== want) {
    // Most likely the CDN still holding the previous copy for a minute after a deploy.
    // The same file asked for under an address it has never seen goes past it.
    const again = await fetch(new Request(`${asset}${asset.includes('?') ? '&' : '?'}fp=${want}`, { cache: 'reload' }));
    if (again.ok) {
      const second = await download(again);
      if (second.hash === want) { res = second; got = second.hash; }
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
    const results = await settledPool(pending, PRECACHE_CONCURRENCY, asset => cacheOne(cache, donors, asset));
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
  // bought nothing: the version is in the ADDRESS (/firebasejs/12.19.0/…), so a file at
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

  // ⚠️⚠️ THE PASSWORD-RESET PAGE IS NEVER WRITTEN TO ANY CACHE. Its address carries the
  // one-time code (`?mode=resetPassword&oobCode=…`), and the network-first branch below would
  // store it with the code in the cache key. So: the network, always; offline, THIS worker's
  // precached copy of the page, matched on the address WITHOUT the query (the code is not
  // needed to draw the page, and it is not in the cache). Before the generic branches on
  // purpose: a query string would otherwise route it there.
  if (p.endsWith('/reset-password.html')) {
    e.respondWith(
      // no-store: the browser's own HTTP cache (GitHub Pages says max-age=600) must not keep
      // the address with the code either.
      fetch(e.request, { cache: 'no-store' }).catch(() =>
        caches.open(CACHE_NAME)
          .then(cache => cache.match(url.origin + p))
          .then(hit => hit || Response.error())
      )
    );
    return;
  }

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
  // «Which version am I running?» — answered on the page's own port, for the
  // App version row in Home → Settings.
  if (e.data && e.data.action === 'version' && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ version: CACHE_NAME });
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
