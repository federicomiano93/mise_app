// Which scripts a page runs, now that its <script type="module"> tags are one bundle.
//
// ⚠️ Until 10 Oct 2026 the answer was in the page's own HTML, one tag per script. Now the HTML
// carries a single `dist/<page>.js` tag and the list lives in the entry file js/pages/<page>.js
// (which scripts/build-bundles.mjs bundles). The tests that ask «does page X run script Y?»
// read it from there — the same question, the same order, the new place.

import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';
import { ROOT } from '../../scripts/bundle-lib.mjs';

const BUNDLE_TAG = /<script\b[^>]*\bsrc="dist\/([^"/]+)\.js"[^>]*>/g;
const LOADER = /\(\)\s*=>\s*import\(\s*'([^']+)'\s*\)/g;

// 'js/i18n-dom.js', 'js/auth-gate.js', … in the order the page runs them. [] for a page with none.
export function scriptsOfEntry(name) {
  const file = `js/pages/${name}.js`;
  if (!existsSync(`${ROOT}${file}`)) return [];
  const text = readFileSync(`${ROOT}${file}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  return [...text.matchAll(LOADER)].map(m => posix.normalize(posix.join('js/pages', m[1])));
}

// html is the page's text. Every script it runs, in order: a bundle tag stands for its entry's
// scripts; a page on the native-module allowlist (reset-password.html) lists them in its own tags.
export function pageScripts(html) {
  const either = new RegExp(`${BUNDLE_TAG.source}|<script\\b[^>]*type="module"[^>]*\\bsrc="(js/[^"]+)"[^>]*>`, 'g');
  return [...String(html).matchAll(either)].flatMap(m => (m[1] ? scriptsOfEntry(m[1]) : [m[2]]));
}

export function pageScriptsOf(pageFile) {
  return pageScripts(readFileSync(`${ROOT}${pageFile}`, 'utf8'));
}

// pageRuns('orders.html', 'js/kiosk.js')
export function pageRuns(pageFile, script) {
  return pageScriptsOf(pageFile).includes(script.replace(/^\.?\/?/, ''));
}
