const CACHE_NAME = 'theitalianclub-v661';
// Firebase SDK modules (loaded from gstatic) are cached SEPARATELY from CACHE_NAME
// so they survive the cache-version bump that happens on every deploy — otherwise
// the offline SDK would be wiped each release until the next online load. The name
// carries the pinned SDK version; bumping the SDK orphans the old cache for cleanup.
//
// ⚠️ CHANGING THIS NAME COSTS ONE OFFLINE-CAPABLE LAUNCH, AND THE PRICE IS PAID
// ONCE PER SDK UPGRADE. activate() deletes every cache that is neither CACHE_NAME
// nor this one, so renaming it throws the old modules away — and the new ones are
// NOT precached (they are cross-origin; a gstatic hiccup would fail the whole
// all-or-nothing install and stop the phone updating at all). They are WARMED
// best-effort by the install handler (warmSdkCache, below — never able to fail the
// install) and otherwise arrive through the fetch handler, on the first load that has
// a network. So the window described here is now only the one where that download
// itself failed.
// So between activate() and that first load, a phone that is OFFLINE cannot boot:
// the code asks for the new version and nothing has it. In practice the window is very
// small — activate() only happens after a successful 67-file precache, i.e.
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
  // The page scripts. Each page loads ONE bundle (js/pages/<page>.js, built by
  // scripts/build-bundles.mjs) holding every module it imports, the lazy ones too, so the
  // old per-module list is gone: a module is cached by being inside a bundle. dist/i18n.js is
  // the one file shared by all of them (the dictionary and the current language).
  // ⚠️ A bundle missing from this list is a blank screen offline after the deploy, so every
  // precached page has its own. order.html (the wholesale CLIENT page, deliberately not
  // precached: no staff phone navigates to it) has dist/order.js and is served from the network.
  './dist/i18n.js',
  './dist/index.js',
  './dist/calculator.js',
  './dist/orders.js',
  './dist/suppliers.js',
  './dist/install-guide.js',
  // reset-password.html is DELIBERATELY NOT BUNDLED (bundle-lib NATIVE_MODULE_PAGES): its boot file
  // must draw «Checking your link…» and forward other email actions without the Firebase SDK, which a
  // bundle would make it wait for. So its own modules are listed one by one, as before the bundles —
  // everything its three module tags and the lazy reset-password.js reach.
  './js/allergen-model.js',
  './js/calculator-config.js',
  './js/credentials.js',
  './js/currency.js',
  './js/firebase-target.js',
  './js/firebase.js',
  './js/i18n-dom.js',
  './js/i18n.js',
  './js/keyboard-done.js',
  './js/local-data.js',
  './js/location.js',
  './js/market.js',
  './js/preview-ribbon.js',
  './js/reset-password-boot.js',
  './js/reset-password.js',
  './js/roles.js',
  './js/same-data.js',
  './js/sections.js',
  './js/sw-update.js',
  './js/update-gate.js',
  './dist/catalogue.js',
  './dist/pastries.js',
  './dist/foodcost.js',
  './dist/inventory.js',
  './qr.png',
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
  './js/splash-init.js',
  './catalogue.html',
  './catalogue.css',
  './label-print.css',
  './records.css',
  './pastries.html',
  './pastries.css',
  './foodcost.html',
  './foodcost.css',
  // The monthly stocktake. A page of the Food Cost section (it carries
  // data-section="foodcost"), but its own folder, because it owns its own
  // collection and imports nothing from js/foodcost/.
  './inventory.html',
  './inventory.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// <asset-hashes>
// GENERATED by scripts/sw-hashes.mjs — never edit by hand. Each precached file's git blob
// hash (first 16 characters): the phone checks every download against it, and an update
// copies a file whose hash has not changed out of the previous cache instead of fetching it.
const ASSET_HASHES = {
  "./": 'f82630fff2530d55',
  "./index.html": 'f82630fff2530d55',
  "./home.html": 'a4401ab28cb28eb9',
  "./calculator.html": '3a19225ac7e2bf1e',
  "./orders.html": '6fed1c46f516e18d',
  "./suppliers.html": '9626d903f397696e',
  "./install-guide.html": '322c79acf63896ef',
  "./reset-password.html": '278e67d11c8b4a50',
  "./dist/i18n.js": '2e8c3410faf22cf1',
  "./dist/index.js": '9a2bec34d7a908ee',
  "./dist/calculator.js": '5fe9d84bfa7dffbd',
  "./dist/orders.js": '9fa06696e7d42d9e',
  "./dist/suppliers.js": '13749f4d39b1918f',
  "./dist/install-guide.js": '86df880954faeae9',
  "./js/allergen-model.js": 'a9ad7592da832a56',
  "./js/calculator-config.js": '65e76f83f8458dbb',
  "./js/credentials.js": 'b805f88d003ea918',
  "./js/currency.js": '241b1dbdf4cc465f',
  "./js/firebase-target.js": 'b3759997e54ddbc3',
  "./js/firebase.js": '3652fda906848824',
  "./js/i18n-dom.js": '24249af4367511e5',
  "./js/i18n.js": '662cbbc54446f157',
  "./js/keyboard-done.js": 'de05a6dd1f3aac26',
  "./js/local-data.js": '91aa7f1699c897a1',
  "./js/location.js": '6aaf53615a8739d1',
  "./js/market.js": 'b9b3e27e43e99dd4',
  "./js/preview-ribbon.js": 'ee39b7ee13f78c02',
  "./js/reset-password-boot.js": '9c3e1fca587f872c',
  "./js/reset-password.js": '82c76584ef73d006',
  "./js/roles.js": '7a7c5cf34d57f511',
  "./js/same-data.js": '11ff91c9b0192d20',
  "./js/sections.js": 'abcfdecb2bd5766d',
  "./js/sw-update.js": '2ffc253aa03eff0f',
  "./js/update-gate.js": '1801738b3e6def2d',
  "./dist/catalogue.js": 'fc22ccf20e2c0b58',
  "./dist/pastries.js": '4f4a93cc17d49c3e',
  "./dist/foodcost.js": 'f95d88260daae5e0',
  "./dist/inventory.js": '39aca9c1cb76ccd5',
  "./qr.png": '761a95e5bc25e2ba',
  "./tokens.css": 'abeb621f95374e83',
  "./auth.css": '55b0bc1d41af5718',
  "./style.css": '1bb57bc3ae9b3666',
  "./orders.css": '64003553203242c9',
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
  "./js/splash-init.js": 'c68474ad53893e48',
  "./catalogue.html": '6f3b2e2b9024e62e',
  "./catalogue.css": 'fdfd0ad245c37c26',
  "./label-print.css": 'ffbcdf4e7a627a2d',
  "./records.css": 'aeaddb44ba386bf2',
  "./pastries.html": '06018742937e8035',
  "./pastries.css": '0689cee72e1f5468',
  "./foodcost.html": '984ccded950e5e41',
  "./foodcost.css": '5b64f3f388a38eef',
  "./inventory.html": 'c66c725a6f990fc3',
  "./inventory.css": '1d262ed4a6109aa8',
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
// project's post-deploy sweep, which already asks the live site for all 67 files.
// ⚠️ NEITHER covers a device-specific failure — nobody has yet confirmed an update
// landing on a real iPhone under this code.
//
// cache: 'reload' bypasses the browser's HTTP cache (GitHub Pages serves
// ~10-minute max-age), so a brand-new worker can never precache stale copies.
const PRECACHE_ATTEMPTS = 3;

// The Firebase SDK modules the page bundles import from gstatic (exactly the URLs in dist/*.js;
// tests/precache-install.test.mjs holds this list to them, and to SDK_CACHE's version).
//
// ⚠️ WHY THE INSTALL WARMS THEM. A bundle imports every one of these at the top, even those a
// page used to reach only through a lazy import (firebase-functions.js, firebase-messaging.js).
// Many phones never fetched those, so they are not in SDK_CACHE. Scenario: the new worker
// installs in the background while online, the person closes the app, and next morning opens it
// OFFLINE: the waiting worker activates, the bundle imports a module nobody cached, and the WHOLE
// page fails — a blank Home on a phone that opened fine offline before the release. The SDK
// cannot be part of the all-or-nothing precache (a gstatic hiccup would stop the phone updating),
// so it is fetched on the side, best effort.
const SDK_MODULES = [
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js',
];

// Never rejects: every failure is swallowed, so it can sit inside waitUntil beside the precache
// without being able to fail or block the install. A module already in SDK_CACHE is not fetched
// again; a download is stored under the same acceptance rule the fetch handler uses.
// Each download is cut off after this long: a stalled gstatic connection must not hold the install.
const SDK_WARM_TIMEOUT_MS = 30000;

function warmSdkCache() {
  return caches.open(SDK_CACHE).then(cache => Promise.allSettled(SDK_MODULES.map(url =>
    cache.match(url).then(hit => {
      if (hit) return null;
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), SDK_WARM_TIMEOUT_MS);
      return fetch(url, { mode: 'cors', signal: stop.signal }).then(res => {
        if (res && res.status === 200 && !res.redirected &&
            (res.type === 'cors' || res.type === 'basic')) {
          return cache.put(url, res.clone());
        }
        return null;
      }).finally(() => clearTimeout(timer));
    })
  ))).catch(() => {});
}

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
  // The SDK warm-up runs beside the precache and cannot reject (see warmSdkCache).
  e.waitUntil(Promise.all([precache(), warmSdkCache()]));
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
  if (p.endsWith('/install-guide.html') || p.endsWith('/qr.png') || p.endsWith('/dist/install-guide.js')) {
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
