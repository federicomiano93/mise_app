// currency.test.mjs — the money follows the venue's COUNTRY, and nothing else.
//
// Federico photographed Panificio Miano on 23 Aug 2026: every price said «£» on a
// bakery in Italy whose ten prices had been typed in euros. The cause was one line —
// `export const CURRENCY = '£'` — written when every venue in production was British.
//
// ⚠️⚠️ THE TWO WAYS THIS CAN GO WRONG AGAIN ARE BOTH ABOUT WIRING, NOT ARITHMETIC,
// which is why this file reads source as well as calling functions:
//
//   1. somebody hoists the symbol back to a module constant, and it freezes
//      (tests/price-model.test.mjs owns that one — it is about formatting)
//   2. somebody wires it to the INTERFACE LANGUAGE instead of the country, because
//      the two calls sit on adjacent lines in js/firebase.js and look alike
//
// This file owns (2), and the guard that keeps currency symbols out of the code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { setCurrency, currentCurrency } from '../js/currency.js';
import { stringsIn } from './helpers/strings-in.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

// ── The file itself ──────────────────────────────────────────────────────────

test('it remembers a symbol and hands it back', () => {
  try {
    setCurrency('€');
    assert.equal(currentCurrency(), '€');
    setCurrency('£');
    assert.equal(currentCurrency(), '£');
  } finally {
    setCurrency('£');
  }
});

// ⚠️⚠️ NOTHING IN THIS FILE MAY DO ARITHMETIC. The whole safety argument for shipping
// a currency change against ten real prices is that the numbers are never touched —
// only the label in front of them. A rate table, a multiplication or a division
// appearing here is the change that would silently restate every price, every recipe
// cost and every margin in the database.
test('⚠️⚠️ js/currency.js converts nothing — no rates, no arithmetic', () => {
  const src = read('js/currency.js');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /[*/]\s*\d|\d\s*[*/]/,
    'a multiplication or division here would convert money instead of labelling it');
  assert.doesNotMatch(code, /\brate\b|\bconvert\b|\bexchange\b/i,
    'this file labels a number; it must never restate one');
});

// ⚠️ ZERO IMPORTS, and it is load-bearing rather than tidy: js/firebase.js is loaded
// by every page before anything else, and it imports this. An import added here is an
// import added to the sign-in screen's critical path.
test('⚠️ js/currency.js imports nothing', () => {
  const src = read('js/currency.js');
  assert.doesNotMatch(src, /^\s*import\s/m, 'it must stay free-standing');
});

// ── The wiring, which is where it went wrong before ──────────────────────────

// ⚠️⚠️ THE ADJACENT-LINE TRAP. In js/firebase.js the session sets the interface
// language and the currency one after the other. They look alike and they read
// DIFFERENT fields on purpose: `language` is a preference, `country` is where the food
// is sold. Wiring the currency to the language would show «£» to an English-speaking
// employee at an Italian bakery, for the same flour that costs «€6.50» in Italian —
// and every test that only ever runs one language at a time would pass.
test('⚠️⚠️ the session takes the currency from the COUNTRY, never from the language', () => {
  const src = read('js/firebase.js');
  const call = src.match(/setCurrency\((.*?)\);/);
  assert.ok(call, 'js/firebase.js must set the currency when a venue opens');
  assert.match(call[1], /currencyOf\(/,
    'it must ask js/market.js which country this venue sells in');
  assert.doesNotMatch(call[1], /interfaceLanguage|currentLanguage|\blanguage\b/,
    'the app’s language may not reach the currency');
});

// ⚠️ AND THAT THE CALL EXISTS AT ALL. A guard on the SHAPE of a call says nothing
// about the call being deleted — the v1.68.0 lesson, where four mutations survived by
// removing the thing being checked. Without this line the app compiles, every screen
// works, and every venue silently shows the fallback.
test('⚠️ the call is actually made, and on the location the session just opened', () => {
  const src = read('js/firebase.js');
  assert.equal((src.match(/setCurrency\(/g) || []).length, 1,
    'exactly one place may decide the currency');
  assert.match(src, /setCurrency\(currencyOf\(location\)\)/,
    'it must read the location document the session opened, not a remembered id');
  assert.match(src, /import \{ setCurrency \} from '\.\/currency\.js'/);
  assert.match(src, /import \{ currencyOf \} from '\.\/market\.js'/);
});

// ── No symbol may be written by hand ─────────────────────────────────────────

// ⚠️ A RULE, NOT A LIST. The old defect was one hardcoded '£'; the way to stop it
// coming back is not to remember that one line but to forbid the shape. Two files may
// hold a symbol — the country table that decides them and the fallback — and nothing
// else, so a new screen cannot quietly print the wrong money.
//
// ⚠️ IT READS STRINGS, NOT SOURCE. tests/helpers/strings-in.mjs exists because the
// obvious regex pairs one string's closing quote with the next one's opening quote and
// scans the code in between — which is how a mutation survived on 23 Aug.
test('⚠️ no currency symbol is written into any string in js/', () => {
  const ALLOWED = new Set([
    // The table that decides them, one entry per country.
    'js/market.js',
    // The fallback shown before a venue is open.
    'js/currency.js',
  ]);
  const offenders = [];
  let scanned = 0;
  for (const rel of jsFiles()) {
    if (ALLOWED.has(rel)) continue;
    // ⚠️ LINE BY LINE. stringsIn takes ONE line; handed a whole file it used to answer
    // nothing and this very guard passed while reading zero strings. It throws now.
    for (const line of read(rel).split(/\r?\n/)) {
      for (const s of stringsIn(line)) {
        scanned += 1;
        if (/[£€]/.test(s)) offenders.push(`${rel}: ${JSON.stringify(s.slice(0, 60))}`);
      }
    }
  }
  // ⚠️ AND PROVE IT ACTUALLY LOOKED. A guard that scans an empty set passes for ever.
  assert.ok(scanned > 5000, `only ${scanned} strings scanned — the guard is reading nothing`);
  assert.deepEqual(offenders, [],
    'a currency symbol belongs to the venue’s country, never to a screen');
});

// Proof the guard can fire: the exact shape it exists to catch.
test('and that guard would catch the line this release removed', () => {
  const sample = "export const CURRENCY = '£';";
  const found = stringsIn(sample).some(s => /[£€]/.test(s));
  assert.equal(found, true, 'the guard must recognise a hardcoded symbol');
});

function jsFiles() {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const child = rel ? `${rel}/${name}` : name;
      if (name === 'vendor') continue;
      if (statSync(join(ROOT, child)).isDirectory()) walk(child);
      else if (name.endsWith('.js')) out.push(child);
    }
  };
  walk('js');
  return out;
}
