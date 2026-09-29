// The Categories card in Ingredients settings: what a pure test cannot reach without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SETTINGS = read('js/orders/registry-settings.js');
const MAIN = read('js/orders/registry-main.js');
const REGISTRY = read('js/orders/registry.js');

test('the count in the confirmation comes from countInCategory, not a second copy of it', () => {
  assert.match(SETTINGS, /const count = countInCategory\(ingredients\(\), name\)/);
});

test('deleting is off until config/orders has arrived, and the screen learns when it does', () => {
  assert.match(SETTINGS, /disabled: categoriesReady\(\) \? null : ''/);
  assert.match(MAIN, /categoriesLoaded: \(\) => state\.loaded\.config/);
  const watcher = MAIN.slice(MAIN.indexOf("watchDoc(COLLECTIONS.config, 'orders'"));
  assert.ok(watcher.indexOf('state.loaded.config = true') < watcher.indexOf('screen.refresh()'));
  assert.match(REGISTRY, /categoriesReady: \(\) => data\.categoriesLoaded\?\.\(\) !== false/);
});

test('after a delete, focus goes to a delete button or to the heading, never lost', () => {
  assert.match(SETTINGS, /tabindex: '-1'/);
  assert.match(SETTINGS, /focusAfterDelete\(box\)/);
  assert.match(SETTINGS, /\|\| box\.querySelector\('h3'\)/);
  assert.match(SETTINGS, /categoryFocusAfter = \{/);
});
