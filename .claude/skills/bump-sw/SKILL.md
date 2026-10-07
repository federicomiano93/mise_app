---
name: bump-sw
description: Bump the service worker cache version and keep the precache list complete. Use whenever any cached file (HTML, CSS, JS under js/, icons, fonts, manifest) has been added, edited, or removed in Mise, before committing. Installed PWAs keep serving the old cache until CACHE_NAME changes, so always run this when finishing a change that touches a file listed in sw.js. Also read it BEFORE changing sw.js itself (fetch, install, activate, the SDK cache) — it holds how the cache behaves and why.
---

# Bump the service worker

The PWA precaches the files listed in `sw.js` and, since 23 Sep 2026, serves them
from that release's cache ALONE — nothing fetches them again behind the page. So a
cached file that changes without a new `CACHE_NAME` would stay old on every phone
until the next release. `sw.js` also carries each cached file's fingerprint
(`ASSET_HASHES`, its git blob hash): the phone checks every download against it and
copies unchanged files from the previous release instead of downloading them.

## When to use
After adding, editing, or removing any file the app serves: any *.html,
style.css, orders.css, anything under js/, manifest.json, or icons.

## Steps
1. If a file was ADDED or REMOVED: edit the `ASSETS` array in `sw.js` (with the
   `./` prefix, e.g. `'./js/orders/new-module.js'`). A new file a page imports at
   load MUST be listed, or an installed phone offline after the deploy cannot open
   that page.
2. Run `node scripts/sw-hashes.mjs`. It rewrites `ASSET_HASHES`, bumps `CACHE_NAME`
   by one whenever any fingerprint changed, and keeps the precache counts in the
   prose in step with `ASSETS`.
3. Tell the user the new CACHE_NAME value and any ASSETS lines added or removed.

## Notes
- Never edit `ASSET_HASHES` or bump `CACHE_NAME` by hand: the script does both, and
  `tests/sw-asset-hashes.test.mjs` fails until it has been run.
- Run it LAST, after every other edit to cached files in the batch: it fingerprints
  the files as they are on disk at that moment.
- Stacked branches each change the fingerprints: after merging `main` into a branch,
  run the script again rather than resolving the `ASSET_HASHES` block by hand.
- Never touch the fetch logic or the cross-origin skip — only `ASSETS`.

## How the cache behaves (since `v1.86.0`) — read before changing sw.js
- ⚠️ **A precached file is served from THIS worker's cache alone** — no background re-fetch (it once
  wrote new files into the old cache after a deploy) and no `caches.match` (a waiting release's
  cache must never answer the current page). Files not precached (the client page) go
  network-first.
- Every download is checked against its fingerprint (git's blob SHA-1). A mismatch is fetched once
  more with `?fp=`; a copy that still mismatches is STORED, never refused — refusing would stop a
  device behind an HTML-rewriting antivirus from ever updating. Not checked on localhost (a Windows
  checkout serves CRLF).
- An update copies unchanged files out of the previous cache (matched by `x-mise-hash`) and
  downloads only what changed.
- The precache is all-or-nothing: `install()` retries failures (3 attempts) and rejects if any
  remain, because `activate()` deletes every other cache. The price, accepted: a phone that can
  never complete the precache stops updating silently. Revisit at the first release really skipped
  for that reason.
- `firebase-sdk-12-19-0` — a separate persistent cache for the gstatic SDK, whitelisted in
  `activate`. Its name must track the SDK version (a test enforces it) or phones carry both copies
  forever. Pin the SDK to what gstatic actually serves, probing one version at a time. Fonts are
  self-hosted (`./fonts/`), so `style-src`/`font-src` are `'self'`.
- It bumps on every run that finds a change, so a release can skip numbers — harmless.
- A count one short is not a diagnosis: diff the list, never compare a number.
