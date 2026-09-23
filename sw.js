const CACHE_NAME = 'theitalianclub-v369';
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
// small — activate() only happens after a successful 252-file precache, i.e.
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
  './js/app.js',
  './js/confirm-dialog.js',
  './js/calculator-icons.js',
  './js/hold-to-zoom.js',
  './js/price-model.js',
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
  './js/orders/reminders.js',
  './js/orders/reminder-view.js',
  './js/orders/suppliers.js',
  './js/orders/ingredient-category.js',
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
  './js/orders/firebase-features.js',
  './js/orders/firebase-photo.js',
  './js/orders/photo-capture.js',
  './js/orders/holidays.js',
  './js/orders/holidays-it.js',
  './js/orders/suggestions.js',
  './js/orders/notifications.js',
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
  './js/catalogue/ingredient-create.js',
  './js/catalogue/ingredient-suggest.js',
  './js/catalogue/firebase-catalogue.js',
  './js/catalogue/catalogue-store.js',
  './js/catalogue/catalogue-main.js',
  './js/catalogue/catalogue-list.js',
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
  './foodcost.html',
  './foodcost.css',
  './js/foodcost/confirm-dialog.js',
  './js/foodcost/dom.js',
  './js/foodcost/foodcost-model.js',
  './js/foodcost/firebase-foodcost.js',
  './js/foodcost/foodcost-store.js',
  './js/foodcost/foodcost-main.js',
  './js/foodcost/foodcost-list.js',
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
  "./": '7030115474b75a18',
  "./index.html": '7030115474b75a18',
  "./home.html": 'c08ad30f3a672010',
  "./calculator.html": '525abff9376fb37f',
  "./orders.html": 'bcfda4d140f34442',
  "./suppliers.html": '58da62f42b4df634',
  "./install-guide.html": 'c57a55ccf379afaf',
  "./qr.png": '761a95e5bc25e2ba',
  "./js/install-guide.js": '17fcd0c0fec489c2',
  "./tokens.css": '782e872bcfc15d23',
  "./auth.css": '8db3d5a1b9b85d37',
  "./style.css": '63f9e1000feeed07',
  "./orders.css": '61ffb04b92ee5b73',
  "./sounds/alarm.wav": '0d1465974f5be95b',
  "./fonts/manrope-latin.woff2": '71eb731d55804619',
  "./fonts/manrope-latin-ext.woff2": 'bd24140af06f1b58',
  "./fonts/dm-mono-400-latin.woff2": '03e4859816da02b8',
  "./fonts/dm-mono-400-latin-ext.woff2": '9785e9177291ef52',
  "./fonts/dm-mono-500-latin.woff2": '67698d873cee7836',
  "./fonts/dm-mono-500-latin-ext.woff2": 'b87200956400a4ac',
  "./fonts/instrument-serif-latin.woff2": '0ad69719cac6f45e',
  "./fonts/instrument-serif-latin-ext.woff2": '0caad588cab430ca',
  "./js/app.js": '52b427fa0153b133',
  "./js/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/calculator-icons.js": '6bb803c39eabc4e0',
  "./js/hold-to-zoom.js": '92ffddd4533b46d7',
  "./js/price-model.js": 'fa8b25472ed3fb83',
  "./js/currency.js": '9300d5695d2a6dac',
  "./js/allergen-model.js": 'a9ad7592da832a56',
  "./js/allergen-terms.js": '554df7742c345ca6',
  "./js/allergen-match.js": '049c14d576539d26',
  "./js/venue-features.js": '9699a0253c1f5d4d',
  "./js/home-cards.js": '0c4699f44e5079bb',
  "./js/recipe-link.js": '522033a543bf8f67',
  "./js/dom.js": '71ca1a65c3f97c25',
  "./js/pick-suggest.js": '34261899d5cc4fa6',
  "./js/pick-screen.js": '35e0a2c983bba52b',
  "./js/records.js": '6a0ae8b13241abcb',
  "./js/record-ui.js": 'fb1d21fc0e352117',
  "./js/record-data.js": 'ce5104faf4f7a3b9',
  "./js/ingredient-record-form.js": 'bfa9c0c6d6edff53',
  "./js/supplier-record-form.js": '7d84c7764ce81aee',
  "./js/ingredient-kind.js": 'b5ea1d7ec8255fd6',
  "./js/photo-model.js": '67d1d83755bbd33a',
  "./js/market.js": '44718f135a2ed1fb',
  "./js/push-model.js": 'eaf3519a168d2316',
  "./js/push.js": '263ad611457ff739',
  "./js/client-order-model.js": '01afe2d8a045dbe8',
  "./js/client-order-history.js": '95f0c334ee12ce80',
  "./js/client-orders-data.js": '4e490005f9908359',
  "./js/calculator-client-orders.js": '7661b211bdbd1cf7',
  "./js/home-client-orders-badge.js": '995488da8caf3218',
  "./js/home-order-requests-badge.js": '737c59c5e110099b',
  "./js/away-model.js": '95c90de8e2b5ab7a',
  "./js/calculator-recipe-source.js": 'efacab52a1256b8c',
  "./js/calculator-catalogue-link.js": '4824f7bc8b76b71c',
  "./js/away-screen.js": 'e9d001178c51a4e7',
  "./js/away-reminder.js": 'bdd9d8cec3f44033',
  "./js/home-away.js": 'd791865d4ec8e8b1',
  "./js/help-content.js": 'd61379e376eea712',
  "./js/help-button.js": '9a7415e712170a5f',
  "./js/sw-update.js": 'cb938cf56f28cf52',
  "./js/update-gate.js": '2387259480385bfb',
  "./js/idle-reset.js": 'fe75808be89d71f1',
  "./js/install-version.js": 'a35dbefbbbaa3acf',
  "./js/install-version-boot.js": '0e0cea81512abcec',
  "./js/install-hint.js": 'ff453ada2a444fee',
  "./js/install-hint-boot.js": '1dda92943f6c4017',
  "./js/install.js": '3a547433c9c0afc0',
  "./js/home-orders-badge.js": 'a208548d4152abb0',
  "./js/splash-init.js": '0982bbf1d8228eab',
  "./js/whats-new.js": '28a18a0146f90592',
  "./js/whats-new-boot.js": 'c4a88b96a1986d6a',
  "./js/firebase.js": 'e169886a7812d53c',
  "./js/same-data.js": '11ff91c9b0192d20',
  "./js/location.js": '6aaf53615a8739d1',
  "./js/sections.js": 'abcfdecb2bd5766d',
  "./js/roles.js": '2b491770c4b6165b',
  "./js/i18n.js": '58243e94ae280868',
  "./js/i18n-dom.js": 'a6d32c5bb1b56674',
  "./js/join-code.js": '5b89de65db5c102f',
  "./js/join-link.js": 'a90ea53c7ba51614',
  "./js/credentials.js": '5d9eece15a3a969a',
  "./js/staff/dom.js": 'e700814a373b85e9',
  "./js/staff/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/staff/firebase-staff.js": '52440b9f127469d3',
  "./js/share.js": 'ec8cbe05c9aa86ab',
  "./js/send-icon.js": '3690291475f44a99',
  "./js/send-sheet.js": '3774a0e7acf2ae9e',
  "./js/staff/people.js": '7e0afb0943e038cd',
  "./js/staff/language.js": '8381dff6b5bea44c',
  "./js/staff/home-cards-screen.js": '23a98da919bd1be5',
  "./js/local-data.js": 'f858223fe05e3f77',
  "./js/unsent-guard.js": 'd75b23b7ad361133',
  "./js/auth-gate.js": '25a470c7c6189fe7',
  "./js/home-session.js": '1df0014d501c0404',
  "./js/home-settings.js": 'b6efc31d381f07cc',
  "./js/location-title.js": '296d2d7d3d04d7f3',
  "./js/recipes.js": '10ffe7a070967fa4',
  "./js/calc.js": '3c9dbd187a60501c',
  "./js/calculator-recipe-text.js": 'aa41a24dba41595f',
  "./js/calculator-dough-math.js": '85008bf4375927f4',
  "./js/log.js": '516c521981a83a84',
  "./js/log-time.js": '0374bcb500904055',
  "./js/log-model.js": '625b88c5e5336bb4',
  "./js/log-store.js": '9b53edc064b6f29c',
  "./js/log-view.js": '91b500b0c9a6bff7',
  "./js/log-edit.js": '47a7ede51add7f49',
  "./js/log-qty.js": '2aae575dfdaec907',
  "./js/log-add.js": '812bfcbfb2ff09e2',
  "./js/log-settings.js": 'c898bf4564c45ddb',
  "./js/whatsapp.js": 'bae7621de9542fc1',
  "./js/calculator-confirm.js": '68a8ecb9ef0f0ab9',
  "./js/calculator-config.js": '233fcda48cb469ce',
  "./js/calculator-config-store.js": '05b4d1f7b091fd60',
  "./js/calculator-order-prefill.js": '28c00f4fea7d43b7',
  "./js/calculator-order-text.js": '3eabd34a0df19321',
  "./js/calculator-render.js": 'f67ce8cc04458439',
  "./js/calculator-settings.js": 'b60045ca853af659',
  "./js/calculator-whatsapp-settings.js": '6ea4ea7c70b52e01',
  "./js/vendor/sortable.esm.js": '824d48148fc5b469',
  "./js/orders/boot.js": '47f36046a755ca91',
  "./js/orders/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/orders/firebase-orders.js": 'f707cb2fa4796756',
  "./js/orders/orders-main.js": '0136cce01ae7f9f0',
  "./js/orders/dom.js": '7ec966d71c5356cd',
  "./js/orders/day.js": '8e00beadcda80dd1',
  "./js/orders/deliveries.js": '341d301921b23a4b',
  "./js/orders/deliveries-view.js": '5c04573cb8ece781',
  "./js/orders/send-routes.js": 'c7aa68108dab4f20',
  "./js/orders/send-chooser.js": 'c8eb96b60e7764ae',
  "./js/orders/work-week.js": '0ad139be5b53ea69',
  "./js/orders/archive.js": 'd60ce7da83589d0f',
  "./js/orders/reminders.js": 'd87dce55b4a0c3ac',
  "./js/orders/reminder-view.js": 'a1ddf5d7d015b994',
  "./js/orders/suppliers.js": '4d7fadc13b1beac7',
  "./js/orders/ingredient-category.js": '21cd5f6a948d0100',
  "./js/orders/ingredients.js": '531411957fadc044',
  "./js/orders/no-supplier.js": 'a577ab8cea7c21b4',
  "./js/orders/ingredient-search.js": '15b304c8da6535c9',
  "./js/orders/ingredient-list.js": 'f411adbd803e8018',
  "./js/orders/search-box.js": '471bb6f217d97442',
  "./js/orders/supplier-detail.js": '70fce095afbdf540',
  "./js/orders/supplier-items.js": '614aed80b44f1b3c',
  "./js/orders/orders-config.js": 'f05b01125712a1de',
  "./js/orders/draft.js": '90671af8a5495aa9',
  "./js/orders/preview.js": '43689698cb90086a',
  "./js/orders/order-text.js": '823bccaf644f303e',
  "./js/orders/supplier-picker.js": 'b7d1520fcf301c96',
  "./js/orders/order-request-model.js": '256c8ff60f99f294',
  "./js/orders/order-requests.js": '7083fdcfbddb8415',
  "./js/orders/history.js": '5b07ad8c6953b66b',
  "./js/orders/history-edit.js": '356e55c4d01778f4',
  "./js/orders/place-confirm.js": '54777faad85c87fd',
  "./js/orders/untold-changes.js": 'a3f105818fc4fc3e',
  "./js/orders/untold-view.js": '6868bf06ff110f58',
  "./js/orders/alert-dismissal.js": 'fbfe034ffa9f6620',
  "./js/orders/management.js": '0351b6c13b6ec548',
  "./js/orders/mgmt-ui.js": '8894b23fd41e8a66',
  "./js/orders/registry.js": '4eb1699bf090347d',
  "./js/orders/registry-main.js": 'bc5d53ff4290e1a4',
  "./js/orders/registry-settings.js": '0fccb7c64c8e25a8',
  "./js/orders/firebase-features.js": '59720cf671a14c78',
  "./js/orders/firebase-photo.js": '39a66d803edc884c',
  "./js/orders/photo-capture.js": 'eea1f85f85b0f26a',
  "./js/orders/holidays.js": '93d9c22d24769c1c',
  "./js/orders/holidays-it.js": '7b57e4698b5f299f',
  "./js/orders/suggestions.js": '8705128fe510b5dd',
  "./js/orders/notifications.js": 'cee091e382e6c5b9',
  "./catalogue.html": '1166c72921da90e2',
  "./catalogue.css": 'ce5f4d7762756b6e',
  "./label-print.css": 'ffbcdf4e7a627a2d',
  "./records.css": '827433e06e923671',
  "./js/catalogue/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/catalogue/dom.js": '9878ae7c750afd79',
  "./js/catalogue/catalogue-model.js": '461292988088f532',
  "./js/catalogue/recipe-cost-model.js": 'd29f16ee37c017a5',
  "./js/catalogue/recipe-allergen-model.js": '52209f23cc007a0d',
  "./js/catalogue/allergen-sheet.js": '34f4ccbd41747f47',
  "./js/catalogue/photo-model.js": '437ecaf7df453145',
  "./js/catalogue/photo-capture.js": '575332d39e58288d',
  "./js/catalogue/firebase-photo.js": '262dc65b76fffd9d',
  "./js/catalogue/recipe-label-model.js": '8790302faf981b5a',
  "./js/catalogue/label-view.js": '77e90c2e289a2457',
  "./js/catalogue/label-template-model.js": '480a35fa8bd788e3',
  "./js/catalogue/label-print.js": 'b01a3743eb4bccc8',
  "./js/catalogue/label-zpl.js": '668018fe0f321b6d',
  "./js/print-queue-model.js": '0b187ce4cf222d5a',
  "./js/catalogue/print-transports.js": '088f68d76249710f',
  "./js/catalogue/ingredient-picker.js": '0126ae87ecda222b',
  "./js/catalogue/ingredient-create.js": '1a3665cef807e967',
  "./js/catalogue/ingredient-suggest.js": '70f26e512587e448',
  "./js/catalogue/firebase-catalogue.js": '99653dbee8b18a1a',
  "./js/catalogue/catalogue-store.js": '893feefd93e45dd6',
  "./js/catalogue/catalogue-main.js": '4902525e8e229df8',
  "./js/catalogue/catalogue-list.js": '6a1719fe8545b8bc',
  "./js/catalogue/search-box.js": '188bbe833ccbde26',
  "./js/catalogue/catalogue-settings.js": 'd62804cee6d203c1',
  "./js/catalogue/catalogue-detail.js": 'f435ddccb0082404',
  "./js/catalogue/catalogue-editor.js": '42ed4b51d1e89d40',
  "./js/catalogue/guided-model.js": '60902e8129430dd7',
  "./js/catalogue/guided-alarm.js": '55fb5626d4ef22e7',
  "./js/catalogue/guided-run.js": 'ca154af4c9ad44d4',
  "./js/catalogue/guided-editor.js": '4acd4dd5d722756f',
  "./js/catalogue/import-to-calculator.js": '509d83f39384e106',
  "./pastries.html": '3df7643e5f0b5869',
  "./pastries.css": '2dc974c4b926704f',
  "./js/pastries/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/pastries/dom.js": '84e0623e447bb7ab',
  "./js/pastries/pastries-model.js": 'd162282f04d5287d',
  "./js/pastries/firebase-pastries.js": '83c0ea7262b9d62e',
  "./js/pastries/pastries-store.js": '4310bbde9d420416',
  "./js/pastries/pastries-main.js": '3ac7b5b4f07a8baa',
  "./js/pastries/pastries-strip.js": '6541f7fde8cf07d6',
  "./js/pastries/pastries-day.js": 'b35e58afec5d655b',
  "./js/pastries/pastries-editor.js": '4c9ab869e2445b1e',
  "./js/pastries/pastries-log-model.js": '6e3160b978365672',
  "./js/pastries/pastries-lock.js": 'adfbaeea4bd7c845',
  "./js/pastries/pastries-logs-store.js": '9a81fc94327027be',
  "./js/pastries/pastries-logs.js": 'd9deab3da9b4664b',
  "./foodcost.html": '1e615d571b18a29c',
  "./foodcost.css": 'fcb76b7b762465ea',
  "./js/foodcost/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/foodcost/dom.js": '911105da04a03481',
  "./js/foodcost/foodcost-model.js": '866a698fd1777ac3',
  "./js/foodcost/firebase-foodcost.js": '91bea6f653c17728',
  "./js/foodcost/foodcost-store.js": '784c7844dfd80044',
  "./js/foodcost/foodcost-main.js": 'f742039b86d90672',
  "./js/foodcost/foodcost-list.js": '40ab2b0e64cd28bc',
  "./js/foodcost/foodcost-editor.js": 'c2faf0c198a900df',
  "./js/foodcost/foodcost-weighing.js": 'cb2f9dfafec4d739',
  "./js/foodcost/vat-guide.js": '59257253ecddb640',
  "./js/foodcost/vat-guide-view.js": '6211fb50316ad0da',
  "./js/foodcost/product-limits.js": 'd73e12634551ea98',
  "./js/foodcost/foodcost-settings.js": 'da7fc49ed1d7b254',
  "./inventory.html": 'aa1c8064dd926b95',
  "./inventory.css": 'b4568a464e0ace00',
  "./js/inventory/confirm-dialog.js": '61a7f580f37c5ff8',
  "./js/inventory/dom.js": '5971dfbbb1e223ec',
  "./js/inventory/inventory-model.js": '09eed83d8469a166',
  "./js/inventory/firebase-inventory.js": '88da05d0396d3481',
  "./js/inventory/inventory-outbox.js": '396a5be9a9069278',
  "./js/inventory/inventory-store.js": 'dba2ec7211f4f0fc',
  "./js/inventory/inventory-purchases.js": 'f9d2887ae16f7a73',
  "./js/inventory/inventory-value.js": '2c7d42012f3e9771',
  "./js/inventory/inventory-usage.js": '5b580d4c482d01c3',
  "./js/inventory/inventory-list.js": '9aac4a815be65cdf',
  "./js/inventory/inventory-detail.js": '8b3efecbc8a998b8',
  "./js/inventory/inventory-main.js": '367658c897b271d3',
  "./manifest.json": '6c8312404a7d3729',
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
// project's post-deploy sweep, which already asks the live site for all 252 files.
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
// nothing would ever replace it. A mismatch is a failure like a 503: retried, and if it
// persists the install is refused and the browser tries the whole update again later.
const HASH_HEADER = 'x-mise-hash';

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
  const res = await fetch(request);
  if (!res.ok) throw new Error(`${asset}: HTTP ${res.status}`);
  const got = await blobHash(res);
  if (want && got !== want) throw new Error(`${asset}: the server sent ${got}, this release is ${want}`);
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
  // import rewriting; a version bump auto-refreshes it on the next online load.
  // Everything else cross-origin — the live Firestore/Auth API, reCAPTCHA (also on
  // gstatic, hence the /firebasejs/ path guard), the localhost emulator — is left
  // untouched: re-issuing those through the SW could cause a transient
  // auth/network-request-failed on the first anonymous sign-in.
  if (url.origin !== self.location.origin) {
    if (url.host === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
      e.respondWith(
        caches.open(SDK_CACHE).then(cache =>
          cache.match(e.request).then(cached => {
            const networkFetch = fetch(e.request).then(res => {
              // Store only executable, CORS-clean module responses (not opaque/redirected).
              if (res && res.status === 200 && !res.redirected &&
                  (res.type === 'cors' || res.type === 'basic')) {
                cache.put(e.request, res.clone()).catch(() => {});
              }
              return res;
            }).catch(() => cached);
            return cached || networkFetch;
          })
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
  const title = data.title || 'Misé';
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
