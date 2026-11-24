// Browser protections of the pages that stay on the current app's files (order.html, reset-password.html,
// install-guide.html) and of Mise 2's index.html (app/csp-plugin.ts):
//  (a) the frame-buster — GitHub Pages sends no X-Frame-Options and a <meta> frame-ancestors is ignored, so every
//      published page must hide itself and break out when another site frames it. It must run FIRST, before anything
//      renders or loads. Mise 2's own run is pinned by app/src/csp.spec.ts.
//  (b) script-src of order.html and reset-password.html names the pinned Firebase path, not the whole gstatic host
//      (which also serves libraries known to bypass a CSP), and that path is the version the pages really import.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

const BUSTER = [
  'if (window.top !== window.self) {',
  "document.documentElement.style.visibility = 'hidden';",
  'try { window.top.location = window.self.location; } catch (e) {}',
];
const noComments = html => html.replace(/<!--[\s\S]*?-->/g, '');
const squash = text => text.replace(/\s+/g, ' ');
const hasBuster = text => BUSTER.every(line => squash(text).includes(squash(line)));

const INLINE_PAGES = ['order.html', 'reset-password.html'];

test('order.html and reset-password.html: the frame-buster is the first thing in the first script, ahead of the CSP', () => {
  for (const page of INLINE_PAGES) {
    const html = noComments(read(page));
    const first = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(first, `${page}: no inline script`);
    assert.ok(html.indexOf('<script') === first.index, `${page}: another script comes before the inline bootstrap`);
    assert.ok(hasBuster(first[1]), `${page}: the first script has no frame-buster`);
    const body = first[1];
    assert.ok(body.indexOf('window.top !== window.self') < body.indexOf('document.write'), `${page}: the buster must run before the CSP is written`);
    assert.ok(html.indexOf('<script') < html.search(/<link|<style|<body|type="module"/), `${page}: something loads before the bootstrap`);
  }
});

test('install-guide.html: js/frame-buster.js is the first script of the page, a classic one', () => {
  const html = noComments(read('install-guide.html'));
  const tags = [...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]);
  assert.equal(tags[0], '<script src="js/frame-buster.js">');
  assert.ok(html.indexOf(tags[0]) < html.search(/<link|<style|<body/), 'something loads before the frame-buster');
  assert.ok(hasBuster(read('js/frame-buster.js')), 'js/frame-buster.js lost its lines');
  assert.match(read('sw.js'), /'\.\/js\/frame-buster\.js'/, 'the offline copy of install-guide.html needs the file in ASSETS');
});

test('Mise 2: the bootstrap that writes the CSP carries the frame-buster, first', () => {
  const source = read('app/csp-plugin.ts');
  const bootstrap = source.slice(source.indexOf('export function bootstrapScript'));
  assert.ok(bootstrap.indexOf('window.top !== window.self') > 0, 'app/csp-plugin.ts has no frame-buster');
  assert.ok(bootstrap.indexOf('window.top !== window.self') < bootstrap.indexOf('var local'), 'the frame-buster must come before the rest');
  assert.ok(bootstrap.includes("document.documentElement.style.visibility = 'hidden'"));
  assert.ok(bootstrap.includes('try { window.top.location = window.self.location; } catch (e) {}'));
});

test('the frame-buster, run: a framed page hides and navigates the top window; a top-level one is untouched', () => {
  const sources = [
    ...INLINE_PAGES.map(p => read(p).match(/<script>([\s\S]*?)<\/script>/)[1]),
    read('js/frame-buster.js'),
  ];
  for (const code of sources) {
    const run = win => {
      const root = { style: {} };
      vm.runInNewContext(code, {
        window: win, location: { hostname: 'x.test' }, document: { write() {}, documentElement: root },
      });
      return root.style;
    };
    const free = { location: 'https://page.test/' };
    free.top = free; free.self = free;
    assert.equal(run(free).visibility, undefined);
    const parent = { location: 'https://evil.test/' };
    const framed = { top: parent, location: 'https://page.test/' };
    framed.self = framed;
    assert.equal(run(framed).visibility, 'hidden');
    assert.equal(parent.location, 'https://page.test/');
    const sandboxed = { top: { set location(_v) { throw new Error('blocked'); } }, location: 'x' };
    sandboxed.self = sandboxed;
    assert.equal(run(sandboxed).visibility, 'hidden');
  }
});

function jsFiles(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) { if (name !== 'vendor') jsFiles(rel, out); } else if (name.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('script-src of order.html and reset-password.html is the pinned Firebase path, and that is the version imported', () => {
  const imported = new Set();
  for (const file of [...jsFiles('js'), 'dist/order.js']) {
    for (const m of read(file).matchAll(/https:\/\/www\.gstatic\.com\/firebasejs\/([^/'"`\s]+)\//g)) imported.add(m[1]);
  }
  assert.equal(imported.size, 1, `the pages import more than one Firebase version: ${[...imported]}`);
  const [version] = imported;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const page of INLINE_PAGES) {
    const directive = read(page).match(/"script-src ([^"]*?);\s*"/);
    assert.ok(directive, `${page}: no script-src`);
    assert.equal(directive[1], `'self' https://www.gstatic.com/firebasejs/${version}/`,
      `${page}: script-src must be 'self' plus the pinned path of the version the pages import (${version})`);
  }
  assert.ok(read('app/package.json').includes(`"firebase": "${version}"`), 'Mise 2 and the current pages must load the same Firebase version');
});
