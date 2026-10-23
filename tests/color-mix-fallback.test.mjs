// The lab tablet (SM-T550) runs Chrome 101, the newest its Play store serves, and
// color-mix() arrived in Chrome 111. Found on the tablet (13–14 Oct 2026): the guided
// run's rings — «time is up», «the speed changed», read from across the room — were
// 0px wide, and the recipe editor's empty ingredient field had no red highlight
// (P20: block, jump to and HIGHLIGHT the empty one).
//
// ⚠️ A plain line BEFORE the color-mix() line does not save it. A value holding var() is
// accepted when the sheet is read and thrown out only when the page is drawn, so the
// later line still wins and the property ends at its initial value: border none,
// background transparent. Measured on the tablet: border-top-width 0px. So the plain
// colour goes in the rule, and the softer color-mix() one inside
// @supports (color: color-mix(…)), AFTER the rule it softens.
//
// The one exception is a box-shadow: there the tablet loses a soft focus glow over a
// border that changes colour anyway — nothing that carries a meaning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sheets = readdirSync(root).filter(name => name.endsWith('.css'));
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SUPPORTS = /@supports\s*\(\s*color\s*:\s*color-mix\([^{]*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g;

function rules(source) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
}

const catalogue = strip(readFileSync(new URL('catalogue.css', root), 'utf8'));
const guarded = [...catalogue.matchAll(SUPPORTS)].map(m => m[1]).join('\n');
const outside = catalogue.replace(SUPPORTS, '');
const RINGS = ['.guided-card--due::after', '.guided-speed--changed.guided-speed--flash::after'];

test('it reads the stylesheets, and some of them use color-mix()', () => {
  assert.ok(sheets.length > 5, sheets.join());
  assert.ok(sheets.some(name => readFileSync(new URL(name, root), 'utf8').includes('color-mix(')));
});

test('outside @supports, color-mix() is only ever a box-shadow, in every stylesheet', () => {
  const bad = [];
  for (const name of sheets) {
    const rest = strip(readFileSync(new URL(name, root), 'utf8')).replace(SUPPORTS, '');
    for (const { selector, body } of rules(rest)) {
      for (const decl of body.split(';')) {
        if (!decl.includes('color-mix(')) continue;
        const property = decl.slice(0, decl.indexOf(':')).trim();
        if (property !== 'box-shadow') bad.push(`${name} ${selector} → ${property}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('every softer colour in @supports has a plain one for the same selector and property before it', () => {
  const missing = [];
  for (const name of sheets) {
    const css = strip(readFileSync(new URL(name, root), 'utf8'));
    for (const block of css.matchAll(SUPPORTS)) {
      const before = css.slice(0, block.index).replace(SUPPORTS, '');
      for (const { selector, body } of rules(block[1])) {
        for (const decl of body.split(';').filter(d => d.includes('color-mix('))) {
          const property = decl.slice(0, decl.indexOf(':')).trim();
          const plain = rules(before).some(r => r.selector === selector && r.body.split(';').some(d => {
            const p = d.slice(0, d.indexOf(':')).trim();
            return (p === property || property.startsWith(p + '-')) && !d.includes('color-mix(');
          }));
          if (!plain) missing.push(`${name} ${selector} → ${property}`);
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('an empty amount box is tinted too: its own surface rule is more specific than the row\'s', () => {
  const rule = rules(outside).find(r => r.selector === '.cat-ing-editrow .cat-amount .cat-grm.cat-invalid');
  assert.ok(rule, 'the amount box has no invalid rule of its own');
  assert.match(rule.body, /background\s*:\s*var\(--error-bg\)/);
  assert.match(rule.body, /border-color\s*:\s*var\(--cat-danger\)/);
});

test('each guided ring has a plain border outside @supports', () => {
  for (const ring of RINGS) {
    const rule = rules(outside).find(r => r.selector === ring);
    assert.ok(rule, `${ring} is missing`);
    assert.match(rule.body, /border\s*:\s*4px solid var\(--cat-crust(-ink)?\)/, `${ring}: no plain ring`);
  }
});

test('the softer rings live inside @supports, after the rules they soften', () => {
  for (const ring of RINGS) {
    const rule = rules(guarded).find(r => r.selector === ring);
    assert.ok(rule && /border-color\s*:\s*color-mix\(/.test(rule.body), `${ring}: no softer ring in @supports`);
    assert.ok(catalogue.indexOf(ring) < catalogue.lastIndexOf(ring), `${ring}: the @supports rule must come after the plain one`);
  }
});

test('an empty ingredient field is highlighted without color-mix()', () => {
  const rule = rules(outside).find(r => r.selector === '.cat-ing-editrow input.cat-invalid');
  assert.ok(rule, 'the invalid-field rule is missing');
  assert.match(rule.body, /background\s*:\s*var\(--error-bg\)/);
});
