// What an installed phone holds after the service worker's install(), for the tests that ask
// «is this file precached?».
//
// ⚠️ SINCE THE PAGES ARE BUNDLED (10 Oct 2026), A MODULE IS NO LONGER LISTED IN sw.js ON ITS
// OWN: it is cached by being inside a dist/<page>.js bundle that IS listed. So «precached»
// means: named in ASSETS, or an input of a bundle that is named in ASSETS. The inputs come from
// dist/build-manifest.json, which tests/bundles-fresh.test.mjs holds to the real sources — a
// module that a page imports but no entry reaches is therefore NOT in this set, and the test
// that asked fails exactly as it did when the name was missing from the list.

import { readFileSync } from 'node:fs';
import { readAssets } from '../../scripts/sw-hashes.mjs';
import { readManifest, ROOT } from '../../scripts/bundle-lib.mjs';

const strip = file => String(file).replace(/^\.\//, '');

export function precachedSet() {
  const assets = readAssets(readFileSync(`${ROOT}sw.js`, 'utf8')).map(strip);
  const manifest = readManifest();
  const set = new Set(assets);
  for (const asset of assets) {
    const built = manifest && manifest.outputs[asset];
    if (built) for (const input of Object.keys(built.inputs)) set.add(input);
  }
  return set;
}

// isPrecached('./js/usage.js') or isPrecached('js/usage.js').
export function isPrecached(file, set = precachedSet()) {
  return set.has(strip(file));
}

// Every name must be precached; the message lists the ones that are not.
export function missingFromPrecache(files) {
  const set = precachedSet();
  return files.filter(f => !isPrecached(f, set)).map(strip);
}
