// P18: an icon-only <button> in a page's HTML needs an accessible name, or a screen reader
// says only «button». Ten Back buttons in calculator.html had none (found 31 Oct 2026).
// A name is an aria-label, or a data-i18n-attr="aria-label" (the translated one), or text.
// Buttons built in JS are not seen here; ui-check (axe) covers the rendered screens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
// Named at runtime by JS (aria-label set in renderListsButton / refreshCount, with a count).
const NAMED_BY_JS = ['orders-alerts-btn', 'orders-lists-btn'];
const PAGES = readdirSync(root).filter(f => f.endsWith('.html'));

test('every icon-only button in every page has an accessible name', () => {
  const nameless = [];
  let seen = 0;
  for (const page of PAGES) {
    const html = readFileSync(new URL(page, root), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const [, attrs, inner] = m;
      seen++;
      const visible = inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]* aria-hidden="true"[^>]*>[\s\S]*?<\/[^>]+>/g, '');
      const text = visible.replace(/<[^>]*>/g, '').trim();
      const labelAttr = / aria-label="[^"]+"/.test(attrs);
      const translatedLabel = / data-i18n="[^"]+"/.test(attrs) && / data-i18n-attr="aria-label"/.test(attrs);
      const translatedText = / data-i18n="[^"]+"/.test(attrs) && !/data-i18n-attr/.test(attrs);
      const named = NAMED_BY_JS.some(id => attrs.includes(`id="${id}"`))
        || labelAttr || translatedLabel || translatedText || text !== '';
      if (!named) nameless.push(`${page}: <button${attrs.replace(/\s+/g, ' ').slice(0, 80)}>`);
    }
  }
  assert.ok(PAGES.includes('calculator.html') && seen >= 48, `only ${seen} buttons found: the scan is not reading the pages`);
  assert.deepEqual(nameless, []);
});
