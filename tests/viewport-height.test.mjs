// The visible height on the lab tablet (P15).
//
// ⚠️ FOUND ON THE REAL TABLET, 31 Oct 2026 (SM-T550, Chrome 101, landscape 1024×648). Its Chrome
// stops at 101 and `dvh` arrived in 108, so `height: 100vh; height: 100dvh` kept the first line —
// and on Android Chrome 100vh is the height without the address bar and tab strip: the body was
// 744px on a screen that shows 648. The bottom 96px were off the glass and the Calculator's footer
// («Storico impasti», «Ordini», «Impostazioni») could not be reached by finger.
//
// The fix is ONE value, `--vh100` (tokens.css: 100vh, switched to 100dvh inside @supports), that
// js/viewport-height.js sets inline to the measured height where dvh is unknown. This test pins:
//   • no stylesheet writes vh/dvh/svh/lvh itself — only tokens.css (and catalogue.css's one svh,
//     inside its own @supports after a plain var(--vh100) line);
//   • no "fallback" pair whose later line holds var() (it falls to the INITIAL value, not to the
//     line above — measured in both apps, 14 Oct 2026);
//   • every page runs js/viewport-height.js first;
//   • what the script does, on a fake window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptsOfEntry } from './helpers/page-scripts.mjs';
import { installViewportHeight, VH_VAR } from '../js/viewport-height.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEETS = readdirSync(ROOT).filter(n => n.endsWith('.css'));
const read = name => readFileSync(join(ROOT, name), 'utf8');
const withoutComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

const TOKENS_SUPPORTS = /@supports\s*\(\s*height:\s*100dvh\s*\)\s*\{\s*:root\s*\{\s*--vh100:\s*100dvh;?\s*\}\s*\}/;
const CATALOGUE_SUPPORTS = /@supports\s*\(\s*height:\s*100svh\s*\)\s*\{\s*\.cat-detail-top\s*\{\s*min-height:\s*calc\(100svh - 56px\);?\s*\}\s*\}/;
const NEW_UNITS = /\d(?:dvh|svh|lvh|dvb|svb|lvb|dvmin|svmin|lvmin|dvmax|svmax|lvmax)\b/;
const VH = /\d(?:vh|vmin|vmax)\b/;

test('finds the stylesheets it reads', () => {
  assert.ok(SHEETS.length >= 10, SHEETS.join(', '));
  assert.ok(SHEETS.includes('tokens.css') && SHEETS.includes('style.css'));
});

test('tokens.css: --vh100 is 100vh in :root, then 100dvh inside @supports, after it', () => {
  const css = withoutComments(read('tokens.css'));
  const plain = css.search(/:root\s*\{[^}]*--vh100:\s*100vh;/);
  const modern = css.search(TOKENS_SUPPORTS);
  assert.ok(plain >= 0, 'tokens.css :root must declare --vh100: 100vh');
  assert.ok(modern > plain, 'the @supports (height: 100dvh) block must come after the plain value');
});

test('no stylesheet writes vh, dvh or svh except through --vh100', () => {
  const offenders = [];
  for (const name of SHEETS) {
    let css = withoutComments(read(name));
    if (name === 'tokens.css') css = css.replace(TOKENS_SUPPORTS, '').replace(/--vh100:\s*100vh;/, '');
    if (name === 'catalogue.css') {
      assert.match(css, CATALOGUE_SUPPORTS, 'catalogue.css keeps its svh inside @supports');
      css = css.replace(CATALOGUE_SUPPORTS, '');
    }
    for (const line of css.split('\n')) {
      if (NEW_UNITS.test(line) || VH.test(line)) offenders.push(`${name}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the pinned shells read --vh100 (the body that was cut on the tablet)', () => {
  const bodyRule = name => withoutComments(read(name)).match(/(?:^|\n)body\s*\{([^}]*)\}/)?.[1] ?? '';
  for (const name of ['style.css', 'foodcost.css', 'inventory.css']) {
    assert.match(bodyRule(name), /height:\s*var\(--vh100\)/, `${name} body`);
  }
  assert.match(withoutComments(read('order.css')), /min-height:\s*var\(--vh100\)/);
});

// Every pair of declarations of the same property in one rule where the LATER one holds var()
// and an earlier one does not: the earlier line is never used.
function fallbackTraps(css) {
  const traps = [];
  for (const block of withoutComments(css).matchAll(/\{([^{}]*)\}/g)) {
    const decls = block[1].split(';').map(d => d.trim()).filter(d => d.includes(':'))
      .map(d => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]);
    decls.forEach(([prop, value], i) => {
      if (!value.includes('var(')) return;
      if (decls.slice(0, i).some(([p, v]) => p === prop && !v.includes('var('))) traps.push(`${prop}: ${value}`);
    });
  }
  return traps;
}

test('the trap finder finds a trap', () => {
  assert.deepEqual(fallbackTraps('.a { height: 100vh; height: var(--vh100); }'), ['height: var(--vh100)']);
  assert.deepEqual(fallbackTraps('.a { height: var(--vh100); } @supports (x:y) { .a { height: 1px; } }'), []);
});

test('no stylesheet has a "fallback" line before a declaration holding var()', () => {
  const offenders = SHEETS.flatMap(name => fallbackTraps(read(name)).map(t => `${name}: ${t}`));
  assert.deepEqual(offenders, []);
});

test('every bundled page runs js/viewport-height.js first', () => {
  const entries = readdirSync(join(ROOT, 'js/pages'))
    .filter(n => n.endsWith('.js') && n !== 'run-in-order.js').map(n => n.replace(/\.js$/, ''));
  assert.ok(entries.length >= 10, entries.join(', '));
  for (const entry of entries) {
    assert.equal(scriptsOfEntry(entry)[0], 'js/viewport-height.js', `js/pages/${entry}.js`);
  }
});

function fakeWindow({ dvh, height }) {
  const listeners = {};
  const props = new Map();
  const root = {
    clientHeight: height,
    style: { setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k) },
  };
  return {
    props, root, listeners,
    CSS: { supports: (p, v) => dvh && p === 'height' && v === '100dvh' },
    document: { documentElement: root },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: type => { delete listeners[type]; },
  };
}

test('where dvh works, nothing is written and nothing listens', () => {
  const win = fakeWindow({ dvh: true, height: 648 });
  installViewportHeight(win);
  assert.equal(win.props.size, 0);
  assert.deepEqual(Object.keys(win.listeners), []);
});

test('where dvh is unknown, --vh100 is the layout height and follows a resize', () => {
  const win = fakeWindow({ dvh: false, height: 648 });
  const stop = installViewportHeight(win);
  assert.equal(VH_VAR, '--vh100');
  assert.equal(win.props.get('--vh100'), '648px');
  win.root.clientHeight = 328;                 // the on-screen keyboard
  win.listeners.resize();
  assert.equal(win.props.get('--vh100'), '328px');
  win.root.clientHeight = 1024;                // turned to portrait
  win.listeners.orientationchange();
  assert.equal(win.props.get('--vh100'), '1024px');
  stop();
  assert.equal(win.props.has('--vh100'), false);
  assert.deepEqual(Object.keys(win.listeners), []);
});

test('a page not laid out yet (height 0) keeps the stylesheet value until a real height comes', () => {
  const win = fakeWindow({ dvh: false, height: 0 });
  installViewportHeight(win);
  assert.equal(win.props.has('--vh100'), false);
  win.root.clientHeight = 648;
  win.listeners.resize();
  assert.equal(win.props.get('--vh100'), '648px');
});
