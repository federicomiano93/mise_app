// The one-line announcements the app makes for the usage record (js/usage.js): every
// `mise:action` and `mise:screen` in js/ must be a literal the record accepts. A name the
// record would ignore is a hole nobody sees, so it is pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { ACTION_RE, SCREEN_RE } from '../js/usage-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'vendor') continue;
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const found = { action: [], screen: [], loose: [] };
for (const file of jsFiles(join(ROOT, 'js'))) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/new CustomEvent\('mise:(action|screen)', \{ detail: ([^}]*) \}\)/g)) {
    const literal = /^'([^']*)'$/.exec(m[2].trim());
    if (literal) found[m[1]].push({ rel, name: literal[1] });
    // The alerts panel decides between two literals.
    else if (/^mgmt \? 'management' : ''$/.test(m[2].trim())) { found.screen.push({ rel, name: 'management' }, { rel, name: '' }); }
    else if (/^open \? 'alerts' : ''$/.test(m[2].trim())) { found.screen.push({ rel, name: 'alerts' }); found.screen.push({ rel, name: '' }); }
    else if (/^fromBar \? 'supplier' : ''$/.test(m[2].trim())) { found.screen.push({ rel, name: 'supplier' }); found.screen.push({ rel, name: '' }); }
    else if (/^name === 'log' \? 'log' : ''$/.test(m[2].trim())) {
      found.screen.push({ rel, name: '' }, { rel, name: 'log' });
    } else found.loose.push(`${rel}: ${m[0]}`);
  }
  for (const m of src.matchAll(/'mise:(?:action|screen)'/g)) {
    // usage.js listens; every other mention must be one of the forms above.
    if (rel === 'js/usage.js') continue;
    const near = src.slice(Math.max(0, m.index - 40), m.index + 60);
    if (!/new CustomEvent\('mise:/.test(near)) found.loose.push(`${rel}: ${near.replace(/\s+/g, ' ')}`);
  }
}

test('every mise:action is a literal name the record accepts', () => {
  assert.ok(found.action.length >= 20, `only ${found.action.length} actions found`);
  for (const { rel, name } of found.action) {
    assert.match(name, ACTION_RE, `${rel}: «${name}» is not an action name`);
  }
});

test('every mise:screen is the empty view or a view name the record accepts', () => {
  assert.ok(found.screen.length >= 30, `only ${found.screen.length} views found`);
  for (const { rel, name } of found.screen) {
    // The page is added in front, so the longest page name (calculator) plus «:» still fits in 40.
    assert.ok(name === '' || (SCREEN_RE.test(name) && name.length <= 20), `${rel}: «${name}» is not a view name`);
  }
});

test('nothing announces in a shape this test cannot read', () => {
  assert.deepEqual(found.loose, []);
});

test('the key actions the owner asked for are all announced', () => {
  const names = new Set(found.action.map(a => a.name));
  for (const want of ['order-sent', 'order-request', 'recipe-saved', 'procedure-saved', 'dough-confirmed',
    'log-added', 'log-edited', 'pastry-day-confirmed', 'label-printed', 'month-closed', 'invoice-imported',
    'ingredient-saved', 'price-saved', 'supplier-saved', 'foodcost-saved', 'timer-started', 'feedback-sent',
    'join-code-made', 'kiosk-rest', 'kiosk-exit']) {
    assert.ok(names.has(want), `${want} is never announced`);
  }
});

test('the views of each screen are announced where the owner asked', () => {
  const byFile = file => new Set(found.screen.filter(s => s.rel === file).map(s => s.name));
  const has = (file, ...views) => {
    const set = byFile(file);
    for (const v of views) assert.ok(set.has(v), `${file} never announces «${v}»`);
  };
  has('js/catalogue/catalogue-main.js', '', 'detail', 'editor', 'label', 'allergens', 'settings', 'photo', 'steps', 'run');
  has('js/inventory/inventory-main.js', '', 'detail', 'usage', 'unavailable');
  has('js/foodcost/foodcost-main.js', '', 'editor', 'history');
  has('js/pastries/pastries-main.js', '', 'editor', 'logs');
  has('js/orders/orders-main.js', '', 'supplier', 'history', 'summary', 'send', 'requests', 'place-all', 'management');
  has('js/orders/tablet-layout.js', 'alerts', '');
  has('js/app.js', 'log', '');
  has('js/calculator-settings.js', 'settings', '');
  has('js/log-edit.js', 'log-history', 'log');
  has('js/home-settings.js', 'settings', '');
  has('js/staff/people.js', 'people', 'settings');
});

test('an announcement never throws where there is no window (the unit tests of those files)', () => {
  for (const file of jsFiles(join(ROOT, 'js'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(\S+)\s*dispatchEvent\(new CustomEvent\('mise:/g)) {
      assert.equal(m[1], 'globalThis.window?.', `${relative(ROOT, file)}: announce through globalThis.window?.`);
    }
  }
});

test('orders: the management panel is announced after the alerts panel closes; a summary closed with its supplier is silent', () => {
  const src = readFileSync(join(ROOT, 'js/orders/orders-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const open = src.slice(src.indexOf('function openManagement()'));
  assert.ok(open.indexOf('closeAlertsPanel()') < open.indexOf("detail: 'management'"));
  const close = src.slice(src.indexOf('function closeSupplier()'), src.indexOf('function closeSupplier()') + 1200);
  assert.match(close, /quietSummaryClose = true;\s*try \{ if \(hadSummary\) closeSummary\(\); \} finally \{ quietSummaryClose = false; \}/);
  assert.match(src, /if \(openerId && !quietSummaryClose\)/);
});
