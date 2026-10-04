// The main font is preloaded on the eight app pages (weak-tablet plan A3), so a slow
// tablet starts downloading it before tokens.css has been parsed.
//
// ⚠️ The preload only helps if its address is EXACTLY the one the @font-face asks for;
// otherwise Chrome downloads the font twice and warns "preloaded but not used".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const PAGES = ['index', 'orders', 'suppliers', 'catalogue', 'calculator', 'foodcost', 'inventory', 'pastries'];
const PRELOAD = /<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin>/;

// tokens.css sits at the site root, like the pages, so both resolve fonts/ the same way.
const faceSrc = read('tokens.css').match(/font-family:\s*'Manrope';[^}]*?src:\s*url\(([^)]+)\)/)[1];

for (const page of PAGES) {
  test(`${page}.html preloads the Manrope font the @font-face uses, before the first stylesheet`, () => {
    const html = read(`${page}.html`);
    const m = html.match(PRELOAD);
    assert.ok(m, 'no font preload');
    assert.equal(m[1], faceSrc, 'the preload must be the @font-face address, or it is wasted');
    assert.ok(html.indexOf(m[0]) < html.indexOf('<link rel="stylesheet"'), 'must come before the first stylesheet');
    assert.match(html, /font-src 'self'/, 'the CSP must allow the font');
  });
}

test('the client page order.html does not preload it', () => {
  assert.doesNotMatch(read('order.html'), /rel="preload"/);
});
