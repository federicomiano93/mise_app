// A long press on a Home card must not open the iPhone's web-link preview.
//
// Federico, 13 Sep 2026, with a screenshot: holding a card opened Safari's own «Open /
// Add to Reading List / Copy Link / Share» sheet over the app — «non mi piace». The cards
// are <a> links, and that sheet is what iOS does to any link. No desktop browser supports
// the property that switches it off, so nothing but this test and his phone can see it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('⚠️ a long press on a Home card or the Home banner opens no link preview and selects no text', () => {
  const css = read('orders.css');
  const rule = css.match(/\n\.home-card,\s*\na\.home-reminder\s*\{([^}]*)\}/);
  assert.ok(rule, 'orders.css must carry one rule for .home-card and a.home-reminder together');
  assert.match(rule[1], /-webkit-touch-callout:\s*none;/, 'the iOS link preview on a long press');
  assert.match(rule[1], /-webkit-user-select:\s*none;/, 'Safari still needs the prefixed form');
  assert.match(rule[1], /(^|\s)user-select:\s*none;/);
});

test('every card on the Home is one of the elements that rule reaches', () => {
  const home = read('index.html');
  const links = home.match(/<a class="[^"]*"/g) || [];
  const cards = links.filter(tag => /\bhome-card\b/.test(tag));
  assert.ok(cards.length >= 7, `expected the seven Home cards, found ${cards.length}`);
  for (const tag of cards) assert.match(tag, /^<a class="home-card"/, `${tag} would not match .home-card`);
});
