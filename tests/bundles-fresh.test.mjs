// dist/ is the build of js/, and it must never be older than it (10 Oct 2026).
//
// ⚠️ WHY THIS EXISTS. Every page loads ONE committed bundle, dist/<page>.js, built from the
// sources by scripts/build-bundles.mjs (esbuild, on the developer's machine). GitHub Pages serves
// only what is committed, so a source edited without a rebuild is a change that does not reach
// any phone — silently, with every other test green, because every other test reads the sources.
// The same shape as records.css. This test needs no esbuild and no install: it compares the
// fingerprints the build wrote into dist/build-manifest.json with the files as they are now.
//
// It fails when: a source a bundle was built from changed; a bundle was edited by hand; a page
// entry (js/pages/*.js) has no bundle; a page's <script> points at a bundle that does not exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  ROOT, entryPages, readManifest, manifestProblems, shaOfText, bundleTagsByPage, MANIFEST_FILE,
} from '../scripts/bundle-lib.mjs';
import { scriptsOfEntry } from './helpers/page-scripts.mjs';

test('⚠️ dist/ is up to date with js/ — if this fails, run: node scripts/build-bundles.mjs', () => {
  assert.deepEqual(manifestProblems(), [], 'run: node scripts/build-bundles.mjs (then node scripts/sw-hashes.mjs)');
});

// ⚠️ The instrument, before the reading: a manifest that lists nothing would pass the test above
// for ever. These prove the manifest really holds the entries, their inputs and every page.
test('the manifest really lists every entry, its own files and a real number of inputs', () => {
  const manifest = readManifest();
  assert.ok(manifest && typeof manifest.esbuild === 'string', 'the manifest names the esbuild version');
  const pages = entryPages();
  assert.ok(pages.length >= 10, `only ${pages.length} entries in js/pages/`);
  for (const page of pages) {
    const out = manifest.outputs[`dist/${page}.js`];
    assert.ok(out, `dist/${page}.js is not in the manifest`);
    assert.ok(out.inputs[`js/pages/${page}.js`], `dist/${page}.js does not list its own entry as an input`);
    assert.ok(out.inputs['js/pages/run-in-order.js'], `dist/${page}.js does not list the shared loader`);
    // Every script the entry runs went into the bundle.
    for (const script of scriptsOfEntry(page)) {
      assert.ok(out.inputs[script], `dist/${page}.js was not built from ${script}, which its entry runs`);
    }
  }
  assert.ok(Object.keys(manifest.outputs['dist/orders.js'].inputs).length > 80, 'the Orders bundle holds too few inputs');
  assert.ok(Object.keys(manifest.outputs['dist/index.js'].inputs).length > 40, 'the Home bundle holds too few inputs');
  assert.deepEqual(Object.keys(manifest.outputs['dist/i18n.js'].inputs), ['js/i18n.js']);
});

test('nothing in dist/ is outside the manifest, and every page runs its bundle', () => {
  const manifest = readManifest();
  const listed = new Set(Object.keys(manifest.outputs).flatMap(o => [o, `${o}.map`]).concat(MANIFEST_FILE));
  const onDisk = readdirSync(join(ROOT, 'dist')).map(n => `dist/${n}`);
  assert.deepEqual(onDisk.filter(f => !listed.has(f)), [], 'files in dist/ no build wrote');
  const tags = bundleTagsByPage();
  assert.ok(Object.keys(tags).length >= 10, 'fewer than ten pages carry a bundle tag');
  // A page with a bundle tag carries no other module tag: a script left beside it would run twice.
  for (const page of Object.keys(tags)) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    assert.deepEqual([...html.matchAll(/<script type="module" src="(js\/[^"]+)"/g)].map(m => m[1]), [],
      `${page} still has a module tag beside its bundle`);
  }
});

// ── The check can fail: run it against a small fake checkout ───────────────────────────────

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bundles-fresh-'));
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const entry = '// entry\nimport { runInOrder } from \'./run-in-order.js\';\n';
  put('js/pages/home.js', entry);
  put('js/pages/run-in-order.js', 'export const runInOrder = () => {};\n');
  put('js/util.js', 'export const x = 1;\n');
  put('dist/home.js', 'var x=1;\n');
  put('dist/home.js.map', '{}');
  put('home.html', '<script type="module" src="dist/home.js"></script>\n');
  const inputs = {};
  for (const f of ['js/pages/home.js', 'js/pages/run-in-order.js', 'js/util.js']) {
    inputs[f] = shaOfText(readFileSync(join(root, f), 'utf8'));
  }
  put(MANIFEST_FILE, JSON.stringify({ esbuild: 'x', outputs: { 'dist/home.js': { sha: shaOfText('var x=1;\n'), inputs } } }));
  return { root, put };
}

test('a fresh checkout has no problems, and each kind of staleness is named', () => {
  const { root, put } = fixture();
  try {
    assert.deepEqual(manifestProblems(root), []);

    put('js/util.js', 'export const x = 2;\n');
    assert.match(manifestProblems(root).join('\n'), /js\/util\.js changed since dist\/home\.js was built/);
    put('js/util.js', 'export const x = 1;\n');
    assert.deepEqual(manifestProblems(root), []);

    put('dist/home.js', 'var x=2;\n');
    assert.match(manifestProblems(root).join('\n'), /dist\/home\.js was edited by hand or is out of date/);
    put('dist/home.js', 'var x=1;\n');

    put('js/pages/other.js', '// a new entry nobody built\n');
    assert.match(manifestProblems(root).join('\n'), /js\/pages\/other\.js has no bundle/);
    rmSync(join(root, 'js/pages/other.js'));

    put('home.html', '<script type="module" src="dist/gone.js"></script>\n');
    assert.match(manifestProblems(root).join('\n'), /home\.html loads dist\/gone\.js, which does not exist/);
    put('home.html', '<script type="module" src="dist/home.js"></script>\n');

    rmSync(join(root, 'dist/home.js'));
    assert.match(manifestProblems(root).join('\n'), /dist\/home\.js is listed but missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('line endings do not change a fingerprint: a Windows checkout and CI agree', () => {
  assert.equal(shaOfText('a\r\nb\r\n'), shaOfText('a\nb\n'));
  assert.notEqual(shaOfText('a\nb\n'), shaOfText('a\nc\n'));
});
