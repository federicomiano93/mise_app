// Mise 2's service worker — the SOURCE. The worker phones run is `sw.js` at the root of the build, which
// app/sw-plugin.ts writes by putting the build's constants above this file (see BUILD CONSTANTS). Plain
// ES2020, no imports, no modules: it runs as a classic worker on Chrome 101 (the lab tablet) and on the
// registration the current app already made at the same address.
//
// ⚠️⚠️ SAME PATH, SAME NAME AS TODAY'S sw.js, ON PURPOSE (step 5 of the plan). Every installed copy of the
// current app asks the browser to check `sw.js` for an update (js/sw-update.js: on load, on coming back to
// the foreground, every 15 minutes). After the switch that address answers with THIS file, so each phone
// installs Mise 2 the way it installs any release: this worker installs and WAITS, the current app's own
// update banner and compulsory gate show, and its tap sends {action: 'skipWaiting'} — the message below
// honours exactly that shape. Nobody reinstalls anything, and the registration (with its push subscription)
// is kept.
//
// ⚠️⚠️ AND THE WAY BACK IS THE SAME ROAD. A revert puts the current app's sw.js back at this address with a
// higher CACHE_NAME: it installs and waits, Mise 2's page (shell/serviceWorker.ts) applies a waiting worker
// as soon as nobody is editing, and the current app's activate() deletes every cache but its own — this one
// included. Proved by app/sw/rollback.spec.ts, which runs both files.
//
// ⚠️ ONLY CACHES ARE EVER DELETED. The person's data lives in IndexedDB (Firebase Auth's record of who is
// signed in, Firestore's offline copy and its queue of unsent writes) and in localStorage (the current app's
// keys, which Mise 2 shares on purpose: docs/architecture.md, «Living beside the current app»). This file
// never touches either: a worker that cleared them would sign every phone out and throw away writes that
// have not reached the server. What survives a SIGN-OUT is a different question, decided by KEEP_PREFIXES in
// the page, never here.
//
// BUILD CONSTANTS (written above this file by app/sw-plugin.ts):
//   CACHE_NAME     this release's cache: CACHE_PREFIX + a fingerprint of the whole precache list
//   CACHE_PREFIX   'mise2-<base>-': only caches of THIS address are ever replaced (the preview's origins can
//                  hold a Mise 2 at / and another at /mise2/, which must not delete each other's)
//   PRECACHE       [{ url, rev, html? }] — every file of the build, `url` relative to this worker, `rev` the
//                  first 16 hex digits of the SHA-256 of its bytes
//   ENTRY          the address of the entry script index.html loads: a copy of index.html that does not name
//                  it is the PREVIOUS release (a CDN still holding it), never stored
//   TAKE_OVER      true when Mise 2 is built for the site's own address (the switch): the current app's caches
//                  are then this worker's to remove. false at /mise2/ beside the current app (the old preview).
//   LEGACY_ROUTES  { 'orders.html': '/orders', … } — the current app's pages, and the Mise 2 screen each one is now

/* global CACHE_NAME, CACHE_PREFIX, PRECACHE, ENTRY, TAKE_OVER, LEGACY_ROUTES */

const REV_HEADER = 'x-mise2-rev';
const PRECACHE_ATTEMPTS = 3;
const PRECACHE_CONCURRENCY = 6;
// The address this worker serves: the folder it sits in (the registration's scope).
const SCOPE = new URL('./', self.location.href).href;
const PRECACHED = new Map(PRECACHE.map(entry => [new URL(entry.url, SCOPE).href, entry]));

// Not checked on this computer (a Windows checkout serves CRLF; the same list as the current app's sw.js and
// shared/src/firebase-target.ts).
const VERIFY = !['localhost', '127.0.0.1', '::1', '[::1]'].includes(self.location.hostname);

// ── Install: the whole build, all or nothing ─────────────────────────────────────────────────────────────
//
// ⚠️ ALL OR NOTHING, as the current app's (its sw.js says why at length): activate() below replaces the
// previous release's cache, so a worker with a hole in its precache would destroy the last complete copy on
// its way in. A failure is retried (GitHub Pages answers 503 to bursts), at most 6 downloads at a time (the
// lab tablet's memory), and an install that still misses a file is REJECTED: the phone keeps the release it
// has and tries again at the next check.

async function revOf(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function download(url) {
  const res = await fetch(new Request(url, { cache: 'reload' }));
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { res, bytes, rev: await revOf(bytes) };
}

function stamped({ res, bytes }, rev) {
  // The network's headers are kept: a script or stylesheet cached without its content-type is refused.
  const headers = new Headers(res.headers);
  headers.set(REV_HEADER, rev);
  return new Response(bytes, { status: res.status, statusText: res.statusText, headers });
}

// The older caches of this address, where an unchanged file is copied from instead of downloaded.
async function donors() {
  const names = (await caches.keys()).filter(name => name !== CACHE_NAME && name.startsWith(CACHE_PREFIX));
  return Promise.all(names.map(name => caches.open(name)));
}

async function cacheOne(cache, olderCaches, entry) {
  const url = new URL(entry.url, SCOPE).href;
  for (const older of olderCaches) {
    const hit = await older.match(url);
    if (hit && hit.headers.get(REV_HEADER) === entry.rev) { await cache.put(url, hit); return; }
  }
  let got = await download(url);
  if (VERIFY && got.rev !== entry.rev) {
    // Most likely the CDN still holding the previous copy for a few minutes after a deploy: the same file
    // under an address it has never seen goes past it.
    const again = await download(`${url}${url.includes('?') ? '&' : '?'}fp=${entry.rev}`).catch(() => null);
    if (again && again.rev === entry.rev) got = again;
  }
  if (VERIFY && got.rev !== entry.rev) {
    // ⚠️ index.html is the one file whose OLD copy breaks the app: it names the previous release's scripts,
    // which are no longer on the server. A copy that does not name this release's entry script is refused
    // (the install fails and is tried again later, when the CDN has caught up). A copy that DOES name it was
    // changed on the way in (an antivirus or a company proxy rewriting HTML): refusing it would stop that
    // device updating for ever, so it is stored, as the current app does with every mismatch.
    if (entry.html && !new TextDecoder().decode(got.bytes).includes(ENTRY)) {
      throw new Error(`${entry.url}: the server still sends the previous release`);
    }
    console.warn(`${entry.url}: the server sent ${got.rev}, this release is ${entry.rev} — stored as received`);
  }
  await cache.put(url, stamped(got, got.rev));
}

async function pool(items, limit, work) {
  const failed = [];
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await work(item); } catch (err) { failed.push(item); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return failed;
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const olderCaches = await donors();
  let pending = PRECACHE;
  for (let attempt = 1; attempt <= PRECACHE_ATTEMPTS && pending.length; attempt++) {
    if (attempt > 1) await new Promise(done => setTimeout(done, 400 * (attempt - 1)));
    pending = await pool(pending, PRECACHE_CONCURRENCY, entry => cacheOne(cache, olderCaches, entry));
  }
  if (pending.length) {
    throw new Error(`precache incomplete: ${pending.length} of ${PRECACHE.length} files failed — `
      + pending.slice(0, 5).map(e => e.url).join(', '));
  }
}

self.addEventListener('install', event => {
  // NO skipWaiting(): the new worker WAITS until the page lets it in — Mise 2's page when nobody is
  // editing (shell/serviceWorker.ts), the current app's page when its update banner is tapped.
  event.waitUntil(precache());
});

// ── Activate: the take-over ──────────────────────────────────────────────────────────────────────────────
//
// Removed: this address's earlier Mise 2 caches, and — only at the switch (TAKE_OVER) — the current app's:
// its release caches (`theitalianclub-v…`) and its Firebase SDK cache (`firebase-sdk-…`, the gstatic modules
// Mise 2 does not load: it bundles the same SDK). Anything else is not ours and is left alone.
function replaced(name) {
  if (name === CACHE_NAME) return false;
  if (name.startsWith(CACHE_PREFIX)) return true;
  return TAKE_OVER && (name.startsWith('theitalianclub-') || name.startsWith('firebase-sdk-'));
}

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(replaced).map(name => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────────────────────────────────

// The Mise 2 address that answers one of the current app's pages: an installed phone opens index.html (its
// start_url), a notification opens calculator.html, orders.html or catalogue.html (functions/push-model.js),
// a bookmark can be any of them. null for a page that is not one of those (order.html, reset-password.html…).
function legacyTarget(url) {
  const u = new URL(url, SCOPE);
  if (u.origin !== new URL(SCOPE).origin || !u.href.startsWith(SCOPE)) return null;
  const page = u.pathname.slice(new URL(SCOPE).pathname.length);
  if (!Object.prototype.hasOwnProperty.call(LEGACY_ROUTES, page)) return null;
  const route = LEGACY_ROUTES[page];
  return route ? `${SCOPE}#${route}` : SCOPE;
}

// ⚠️ THIS WORKER'S CACHE, NOT caches.match(): while an update waits its cache already exists beside this one,
// and a global match could hand this page a file of the next release.
function fromCache(href) {
  return caches.open(CACHE_NAME)
    .then(cache => cache.match(href))
    .then(hit => hit || fetch(href));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Firestore, Auth, the Functions and every other host: never touched (the browser does it directly).
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  const page = url.pathname.slice(new URL(SCOPE).pathname.length);

  if (request.mode === 'navigate') {
    // The app itself, also opened with a query (?source=pwa) — offline included.
    if (page === '' || page === 'index.html') {
      event.respondWith(fromCache(`${SCOPE}index.html`));
      return;
    }
    // A page of the current app: its Mise 2 screen. (Without this worker, the build's own stub pages do the
    // same: app/sw-plugin.ts writes them from the same list.)
    const target = legacyTarget(url.href);
    if (target && target !== url.href) {
      event.respondWith(Response.redirect(target, 302));
      return;
    }
    // ⚠️ Everything else is the NETWORK, untouched, and never written to a cache: `order.html` (the
    // wholesale clients' page, kept as it is) and `reset-password.html`, whose address carries a one-time
    // code that must never land in a cache key.
    return;
  }

  // A file of this release (scripts, styles, fonts, the alarm): from this release's cache.
  if (!url.search && PRECACHED.has(url.href)) {
    event.respondWith(fromCache(url.href));
  }
  // Anything else of ours (the files order.html and reset-password.html load): the network.
});

// ── Messages ─────────────────────────────────────────────────────────────────────────────────────────────

self.addEventListener('message', event => {
  if (!event.source) return;
  const data = event.data || {};
  // Sent by Mise 2's page AND by the current app's (js/sw-update.js): the same message, the same answer.
  if (data.action === 'skipWaiting') self.skipWaiting();
  // «Which version am I running?» — the current app's Settings row asks it on the page's own port.
  if (data.action === 'version' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// ── Notifications that arrive with the app closed ────────────────────────────────────────────────────────
//
// ⚠️ KEPT FROM THE CURRENT APP, THOUGH MISE 2 SUBSCRIBES NOBODY YET (reminder notifications are deferred until
// after the switch). The push subscription belongs to the REGISTRATION, not to the script, so a phone the
// current app subscribed goes on receiving the server's pushes after this worker replaces it. A push that
// shows nothing would make the browser show its own «this site has been updated in the background» and can
// cost the site its permission, so every push still shows the server's text; a tap opens the Mise 2 screen
// of the page it names.

function pushPayload(event) {
  try {
    const raw = event.data ? event.data.json() : null;
    return (raw && (raw.data || raw)) || {};
  } catch (err) {
    return {};
  }
}

self.addEventListener('push', event => {
  const data = pushPayload(event);
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open.some(c => c.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'Mise', {
      body: data.body || 'Open the app to see what changed.',
      tag: data.tag || 'italianclub',
      renotify: true,
      icon: `${SCOPE}icons/icon-192.png`,
      badge: `${SCOPE}icons/icon-192.png`,
      data: { url: data.url || './index.html' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const wanted = (event.notification.data && event.notification.data.url) || './index.html';
  const target = legacyTarget(wanted) || SCOPE;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = open.find(c => c.url === target) || open[0];
    if (existing) {
      try { await existing.focus(); } catch (err) { /* focus can be refused */ }
      if (existing.url !== target && 'navigate' in existing) {
        try { await existing.navigate(target); } catch (err) { /* an uncontrolled window cannot be navigated */ }
      }
      return;
    }
    await self.clients.openWindow(target);
  })());
});
