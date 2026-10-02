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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';

import { readAssets } from '../scripts/sw-hashes.mjs';

const ROOT = new URL('..', import.meta.url);
const SW = readFileSync(new URL('sw.js', ROOT), 'utf8');

// Static `import … from '…'`, bare `import '…'` and `export … from '…'`. Only relative paths
// are the app's own files; the Firebase SDK comes from its CDN and has its own cache.
const IMPORT = /(?:\bfrom\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

function importsOf(file) {
  const text = readFileSync(new URL(file, ROOT), 'utf8')
    // Comments may quote an import line; they load nothing.
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
  assert.ok(assets.length > 100, 'ASSETS could not be read');
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
