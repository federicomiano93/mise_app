---
name: bump-sw
description: Bump the service worker cache version and keep the precache list complete. Use whenever any cached file (HTML, CSS, JS under js/, icons, manifest) has been added, edited, or removed in The Italian Club, before committing. Installed PWAs keep serving the old cache until CACHE_NAME changes, so always run this when finishing a change that touches a file listed in sw.js.
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
