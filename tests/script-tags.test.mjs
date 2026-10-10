// A file that imports must be LOADED as a module.
//
// ⚠️⚠️ THIS SHIPPED, AND IT WAS SILENT. v1.47.0 added `import { t } from
// './i18n.js'` to js/install.js and js/install-guide.js — correct, and correctly
// translated — but index.html and install-guide.html loaded both as CLASSIC
// scripts. A classic script cannot contain `import`, so the browser threw
// SyntaxError and NEITHER FILE RAN AT ALL:
//
//   • the "Add to home screen" helper on the Home did nothing;
//   • the install guide — the page Federico actually sends to colleagues — lost
//     its device detection, its steps and its one-tap install.
//
// ⚠️ NOTHING EXISTING COULD HAVE CAUGHT IT, and that is why this file is here
// rather than a bigger comment. tests/modules-parse.test.mjs imports every module
// AS A MODULE, so both parsed perfectly. The dictionary checks found their keys.
// Only the HTML knew, and nothing was reading the HTML. It was found by a driver
// printing the page's own console — the same lesson as v1.37.0: a driver that
// reports only its own timeout hides the answer it already has.
//
// ⚠️ SINCE THE PAGES ARE BUNDLED (10 Oct 2026) a page carries ONE `<script type="module"
// src="dist/<page>.js">` and the scripts it runs are loaded by js/pages/<page>.js with import(),
// which is always a module load. So the risk now sits in two places, both checked below: the bundle
// tag itself (a bundle holds `import` statements, so as a classic script it would not run at all),
// and every other tag, which is still read the old way.
//
// ⚠️ THE OTHER DIRECTION IS NOT A FAULT. A module tag on a file with no imports
// is harmless (it only defers execution), so this asks the question that has a
// wrong answer, not the one that merely looks untidy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scriptsOfEntry } from './helpers/page-scripts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pages = readdirSync(ROOT).filter(name => name.endsWith('.html'));

const TAG = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g;
const IMPORTS = /^\s*(import|export)\s/m;

test('the app has pages to check, so this test cannot pass by finding nothing', () => {
  assert.ok(pages.length >= 6, `only found ${pages.length} pages`);
});

test('every script that imports is loaded as a module', () => {
  const broken = [];
  let checked = 0;

  for (const page of pages) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    for (const m of html.matchAll(TAG)) {
      const [tag, src] = m;
      if (/^https?:/.test(src)) continue;          // the Firebase SDK, loaded by the browser
      const file = join(ROOT, src);
      if (!existsSync(file)) {
        broken.push(`${page} loads ${src}, which is not in the repo`);
        continue;
      }
      checked += 1;
      const bundle = src.match(/^dist\/([^/]+)\.js$/);
      if (bundle) {
        // The bundle must be a module, and so must be every script its entry runs: each one is
        // opened by import(), so it cannot be a classic file, and must exist.
        if (!/\btype="module"/.test(tag)) broken.push(`${page} loads ${src} as a classic script — a bundle imports, it will not run at all`);
        const entry = scriptsOfEntry(bundle[1]);
        if (!entry.length) broken.push(`${page} loads ${src}, but js/pages/${bundle[1]}.js runs no scripts`);
        for (const script of entry) {
          checked += 1;
          if (!existsSync(join(ROOT, script))) broken.push(`js/pages/${bundle[1]}.js runs ${script}, which is not in the repo`);
        }
        continue;
      }
      if (IMPORTS.test(readFileSync(file, 'utf8')) && !/\btype="module"/.test(tag)) {
        broken.push(`${page} loads ${src} as a classic script, and it imports — the file will not run at all`);
      }
    }
  }

  // ⚠️ The instrument, before the reading. A regex one refactor away from
  // matching nothing would report a clean app for ever.
  assert.ok(checked > 20, `only inspected ${checked} scripts — the scan is not finding them`);
  assert.ok(pages.filter(p => /src="dist\//.test(readFileSync(join(ROOT, p), 'utf8'))).length >= 9,
    'fewer than nine pages carry a bundle tag — the scan is not finding them');
  assert.deepEqual(broken, []);
});
