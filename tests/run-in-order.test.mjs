// js/pages/run-in-order.js runs a page's scripts the way separate module tags did, and the entries
// in js/pages/ are nothing but a list for it. Both halves are pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { runInOrder } from '../js/pages/run-in-order.js';
import { ROOT, SHARED_HELPER } from '../scripts/bundle-lib.mjs';

test('scripts run one after another, in the order listed', async () => {
  const seen = [];
  const step = name => () => new Promise(done => setTimeout(() => { seen.push(name); done(); }, name === 'a' ? 15 : 0));
  await runInOrder([step('a'), step('b'), step('c')], () => assert.fail('nothing failed'));
  assert.deepEqual(seen, ['a', 'b', 'c'], 'a slow first script still finishes before the second starts');
});

test('⚠️ a loader that throws or rejects does not stop the next one, and its error is reported', async () => {
  const seen = [];
  const reported = [];
  const boom = new Error('boom');
  const nope = new TypeError('nope');
  await runInOrder([
    () => { seen.push(1); },
    () => { seen.push(2); throw boom; },
    () => { seen.push(3); return Promise.reject(nope); },
    () => { seen.push(4); },
  ], err => reported.push(err));
  assert.deepEqual(seen, [1, 2, 3, 4], 'every script ran');
  assert.deepEqual(reported, [boom, nope], 'each failure reached the reporter, once, in order');
});

test('the default reporter is globalThis.reportError when the browser has one', async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'reportError');
  const got = [];
  globalThis.reportError = err => got.push(err);
  try {
    // A fresh copy of the module, so its top-level choice of reporter is made again.
    const fresh = await import(`../js/pages/run-in-order.js?fresh=${Date.now()}`);
    const err = new Error('to the window');
    await fresh.runInOrder([() => { throw err; }]);
    assert.deepEqual(got, [err]);
  } finally {
    if (had) Object.defineProperty(globalThis, 'reportError', had); else delete globalThis.reportError;
  }
});

// ── The entries ─────────────────────────────────────────────────────────────────────────────────

const entries = readdirSync(join(ROOT, 'js/pages')).filter(n => n.endsWith('.js') && n !== SHARED_HELPER);
const code = file => readFileSync(join(ROOT, 'js/pages', file), 'utf8')
  .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('there are entries to check, so the scan below cannot pass by finding nothing', () => {
  assert.ok(entries.length >= 10, `only ${entries.length} entries`);
});

test('⚠️ an entry has no top-level await and holds only () => import(\'../…js\') loaders of files that exist', () => {
  const bad = [];
  for (const file of entries) {
    const text = code(file);
    if (/(^|\n)\s*await\b|\bfor await\b/.test(text)) bad.push(`${file}: top-level await`);
    const list = text.match(/runInOrder\(\[([\s\S]*?)\]\);/);
    if (!list) { bad.push(`${file}: no runInOrder([...]) call`); continue; }
    const items = list[1].split('\n').map(l => l.trim()).filter(Boolean);
    if (!items.length) bad.push(`${file}: empty list`);
    for (const item of items) {
      const m = item.match(/^\(\) => import\('(\.\.\/[^']+\.js)'\),$/);
      if (!m) { bad.push(`${file}: not a plain loader: ${item}`); continue; }
      if (!existsSync(join(ROOT, posix.normalize(posix.join('js', m[1].slice(3)))))) bad.push(`${file}: ${m[1]} does not exist`);
    }
    // Nothing else at the top level but the one import of the loader and the call.
    const rest = text.replace(list[0], '').replace(/import \{ runInOrder \} from '\.\/run-in-order\.js';/, '').trim();
    if (rest) bad.push(`${file}: unexpected code: ${rest.slice(0, 60)}`);
  }
  assert.deepEqual(bad, []);
});
