// Every module a precached page imports is itself precached (3 Oct 2026).
//
// ⚠️ A MISSING NAME HERE BREAKS A WHOLE SCREEN OFFLINE, AND NOTHING ELSE NOTICES. The service
// worker answers a precached file from its cache and anything else from the network. A module
// left out of ASSETS therefore loads fine online — so every test, every review and every drive
// passes — and fails offline, and a STATIC import that fails to load takes down every module
// that imports it, all the way up to the page. `js/pack-format.js` has been imported by the
// ingredient card since 1 Oct 2026 and was in no ASSETS list until this test found it: offline,
// Suppliers (registry.js) and the Recipe catalogue (via ingredient-create.js) did not start.
//
// Static imports only. A dynamic `import()` that fails offline breaks the one button that asked
// for it, not the page; the two in auth-gate.js (js/staff/) open the app owner's own screens.
//
// ⚠️ SINCE THE PAGES ARE BUNDLED (10 Oct 2026) the files a phone installs are dist/<page>.js plus
// dist/i18n.js, and the modules inside a bundle cannot be missing from it. What CAN still go
// missing is what a bundle imports from OUTSIDE itself, so that is what is checked here: every
// relative import of a bundle must be precached, and the only one allowed is ./i18n.js (the
// dictionary stays a file of its own on purpose). The https:// imports are the Firebase SDK,
// which has its own cache. The loose js/ files left in ASSETS (the classic scripts) are checked
// the way every file was before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';

import { readAssets } from '../scripts/sw-hashes.mjs';

const ROOT = new URL('..', import.meta.url);
const SW = readFileSync(new URL('sw.js', ROOT), 'utf8');

// Static `import … from '…'`, bare `import '…'` and `export … from '…'`. Only relative paths
// are the app's own files; the Firebase SDK comes from its CDN and has its own cache.
const IMPORT = /(?:\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;

function importsOf(file) {
  const raw = readFileSync(new URL(file, ROOT), 'utf8');
  // A bundle is minified code with no comments to strip (stripping `//` out of minified text
  // would eat real code); a source file is stripped, since comments may quote an import line.
  const text = file.startsWith('dist/') ? raw : raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  return [...text.matchAll(IMPORT)].map(m => posix.normalize(posix.join(posix.dirname(file), m[2])));
}

test('the import scan sees what it must see', () => {
  // Proof the pattern works on a file known to import a sibling, before trusting a pass.
  assert.ok(importsOf('js/ingredient-record-form.js').includes('js/pack-format.js'));
  assert.ok(importsOf('js/orders/registry.js').includes('js/ingredient-record-form.js'));
});

test('⚠️ every module imported by a precached file is precached too', () => {
  const assets = readAssets(SW).map(a => a.replace(/^\.\//, ''));
  assert.ok(assets.length > 30, 'ASSETS could not be read');
  assert.ok(assets.includes('dist/orders.js') && assets.includes('dist/i18n.js'), 'the bundles must be listed');
  const listed = new Set(assets);
  const missing = [];
  for (const file of assets.filter(a => a.endsWith('.js'))) {
    for (const dep of importsOf(file)) {
      if (!existsSync(new URL(dep, ROOT))) missing.push(`${file} imports ${dep}, which does not exist`);
      else if (!listed.has(dep)) missing.push(`${file} imports ${dep}, which is not in sw.js ASSETS`);
    }
  }
  assert.deepEqual(missing, [], 'add each to ASSETS and run: node scripts/sw-hashes.mjs');
});

test('⚠️ a bundle imports nothing from outside itself but ./i18n.js and the Firebase SDK', () => {
  const bundles = readAssets(SW).map(a => a.replace(/^\.\//, '')).filter(a => /^dist\/[^/]+\.js$/.test(a));
  assert.ok(bundles.length >= 10, `only ${bundles.length} bundles are precached`);
  // The instrument first: the scan must see the import it is there to allow.
  assert.deepEqual([...new Set(importsOf('dist/orders.js'))], ['dist/i18n.js']);
  const offenders = [];
  for (const file of bundles) {
    for (const dep of importsOf(file)) {
      if (dep !== 'dist/i18n.js') offenders.push(`${file} imports ${dep}`);
    }
  }
  assert.deepEqual(offenders, [], 'a second shared file would need its own place in ASSETS and a reason');
  assert.deepEqual(importsOf('dist/i18n.js'), [], 'the dictionary has no imports — it is written as a file of its own');
});
