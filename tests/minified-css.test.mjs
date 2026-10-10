// The stylesheets a page loads are the minified copies in dist/ (10 Oct 2026).
//
// ⚠️ WHY THIS EXISTS. scripts/build-bundles.mjs writes dist/<name>.css for every root stylesheet a
// page links: ~511 KB of CSS become ~232 KB. Three things can go wrong silently, each with every
// other test green because the others read the SOURCES:
//   1. a relative url() (the fonts in tokens.css) stays as it was and now points into dist/, where
//      there is no fonts/ — every page falls back to a system font;
//   2. the minifier drops a rule it thinks nothing uses. CLAUDE.md records that classes are built at
//      run time (`auth-status--${kind}`, `lab-sheet-${block.role}`), and two automated dead-CSS passes
//      once deleted the label rules with every test green. esbuild does not tree-shake selectors; this
//      pins that, class by class;
//   3. a page still links the root source, so the minified copy is built, precached and never used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, DIST_DIR, rewriteCssUrls, pointSheetsAtDist, stylesheetHrefs, sheetsByPage, linkedSheets,
} from '../scripts/bundle-lib.mjs';
import { readAssets } from '../scripts/sw-hashes.mjs';

const read = file => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const SHEETS = linkedSheets();

// Every class a stylesheet's rules name, comments and url()s removed.
const classesOf = css => new Set(
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]),
);

test('the build covers every stylesheet the pages link, and only those', () => {
  assert.deepEqual(SHEETS, [
    'auth.css', 'catalogue.css', 'foodcost.css', 'inventory.css', 'label-print.css', 'order.css',
    'orders.css', 'pastries.css', 'records.css', 'style.css', 'tokens.css',
  ]);
  for (const sheet of SHEETS) assert.ok(existsSync(join(ROOT, DIST_DIR, sheet)), `${DIST_DIR}/${sheet} was not built`);
});

test('⚠️ every page links the minified copy, never the root source', () => {
  const byPage = sheetsByPage();
  assert.ok(Object.keys(byPage).length >= 10, 'fewer than ten pages link a stylesheet');
  for (const [page, hrefs] of Object.entries(byPage)) {
    for (const href of hrefs) {
      assert.match(href, /^dist\/[^/]+\.css$/, `${page} links ${href}`);
      assert.ok(existsSync(join(ROOT, href)), `${page} links ${href}, which does not exist`);
    }
  }
});

test('pointing a page at dist/ changes only the href of a stylesheet link', () => {
  const html = '<link rel="preload" href="fonts/a.woff2" as="font">\n'
    + '<link rel="stylesheet" href="style.css" media="print">\n<link href="x.css" rel="stylesheet">\n'
    + '<link rel="icon" href="icons/i.png">\n<a href="y.css">z</a>\n<link rel="stylesheet" href="https://e.test/a.css">\n';
  assert.equal(pointSheetsAtDist(html), html
    .replace('href="style.css"', 'href="dist/style.css"').replace('href="x.css"', 'href="dist/x.css"'));
  assert.deepEqual(stylesheetHrefs(html), ['style.css', 'x.css', 'https://e.test/a.css']);
  assert.equal(pointSheetsAtDist(pointSheetsAtDist(html)), pointSheetsAtDist(html), 'running it twice changes nothing more');
});

test('⚠️ a relative url() moves one folder up with the file; nothing else is touched', () => {
  const from = (css, o = { root: ROOT }) => rewriteCssUrls(css, o);
  assert.equal(from('a{src:url(fonts/manrope-latin.woff2) format("woff2")}'), 'a{src:url(../fonts/manrope-latin.woff2) format("woff2")}');
  assert.equal(from('a{src:url("fonts/manrope-latin.woff2")}'), 'a{src:url("../fonts/manrope-latin.woff2")}');
  assert.equal(from("a{src:url( 'fonts/manrope-latin.woff2' )}"), "a{src:url('../fonts/manrope-latin.woff2')}");
  for (const keep of ['url(data:image/png;base64,AAAA)', 'url(https://e.test/a.png)', 'url(//e.test/a.png)', 'url(/fonts/a.woff2)', 'url(#frag)']) {
    assert.equal(from(`a{b:${keep}}`), `a{b:${keep}}`, keep);
  }
  assert.throws(() => from('a{src:url(fonts/not-there.woff2)}'), /does not exist/);
});

test('⚠️ dist/tokens.css points at fonts that exist, from dist/', () => {
  const css = read(`${DIST_DIR}/tokens.css`);
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/['"]/g, ''));
  assert.ok(urls.length >= 9, `only ${urls.length} font urls`);
  for (const u of urls) {
    assert.match(u, /^\.\.\/fonts\//, u);
    assert.ok(existsSync(join(ROOT, DIST_DIR, u)), `${u} does not exist relative to dist/`);
  }
});

test('⚠️ the minifier drops no selector: every class a source rule names is in the minified copy', () => {
  let total = 0;
  for (const sheet of SHEETS) {
    const src = classesOf(read(sheet));
    const out = classesOf(read(`${DIST_DIR}/${sheet}`));
    total += src.size;
    assert.deepEqual([...src].filter(c => !out.has(c)), [], `${sheet}: classes lost in ${DIST_DIR}/${sheet}`);
  }
  assert.ok(total > 1000, `only ${total} classes compared — the check is reading nothing`);
});

test('⚠️ the run-time-built classes survive (the dead-CSS trap)', () => {
  const all = SHEETS.map(s => read(`${DIST_DIR}/${s}`)).join('\n');
  for (const prefix of ['.lab-sheet-', '.auth-status--']) {
    assert.ok(all.includes(prefix), `${prefix}* rules are gone from dist/`);
  }
  // The instrument: the same check must find the prefix in the SOURCE, or it proves nothing.
  const source = SHEETS.map(read).join('\n');
  for (const prefix of ['.lab-sheet-', '.auth-status--']) assert.ok(source.includes(prefix), `${prefix} is not in the sources`);
});

test('the minified copies are smaller, LF, and carry no source-map pointer', () => {
  for (const sheet of SHEETS) {
    const raw = readFileSync(join(ROOT, DIST_DIR, sheet), 'utf8');
    assert.ok(!raw.includes('\r'), `${sheet} has CRLF`);
    assert.ok(!raw.includes('sourceMappingURL'), `${sheet} points at a map that is not served`);
    assert.ok(raw.length < read(sheet).length, `${sheet} did not get smaller`);
  }
});

test('every precached stylesheet is a dist copy, and every page\'s sheets are precached when the page is', () => {
  const assets = new Set(readAssets(readFileSync(join(ROOT, 'sw.js'), 'utf8')));
  assert.deepEqual([...assets].filter(a => /^\.\/[^/]+\.css$/.test(a)), [], 'a root source stylesheet is precached');
  const pages = readdirSync(ROOT).filter(n => n.endsWith('.html') && assets.has(`./${n}`));
  let checked = 0;
  for (const page of pages) {
    for (const href of sheetsByPage()[page] || []) {
      checked += 1;
      assert.ok(assets.has(`./${href}`), `${page} links ${href}, which sw.js does not precache`);
    }
  }
  assert.ok(checked >= 15, `only ${checked} stylesheet links checked`);
});
