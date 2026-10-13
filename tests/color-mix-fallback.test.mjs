// The lab tablet (SM-T550) runs Chrome 101, the newest its Play store serves, and
// color-mix() arrived in Chrome 111. Most uses here are a focus or error tint over a
// border that still changes colour, so the tablet loses nothing; but the guided run's
// rings ARE the signal — «time is up», «the speed changed» — read from across the room
// on that very tablet.
//
// ⚠️ A plain line BEFORE the color-mix() line does not save it. A value holding var() is
// accepted when the sheet is read and thrown out only when the page is drawn, so the
// later line still wins and the property ends at its initial value: border none, no
// ring. Measured on the tablet (14 Oct 2026): border-top-width 0px. The softer ring
// must sit inside @supports, with the plain one outside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../catalogue.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SUPPORTS = /@supports\s*\(\s*color\s*:\s*color-mix\([^{]*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g;

const guarded = [...css.matchAll(SUPPORTS)].map(m => m[1]).join('\n');
const outside = css.replace(SUPPORTS, '');

function rules(source) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
}

const RINGS = ['.guided-card--due::after', '.guided-speed--changed.guided-speed--flash::after'];

test('each guided ring has a plain border outside @supports', () => {
  for (const ring of RINGS) {
    const rule = rules(outside).find(r => r.selector === ring);
    assert.ok(rule, `${ring} is missing`);
    assert.match(rule.body, /border\s*:\s*4px solid var\(--cat-crust(-ink)?\)/, `${ring}: no plain ring`);
    assert.doesNotMatch(rule.body, /color-mix\(/, `${ring}: color-mix() outside @supports`);
  }
});

test('the softer rings live inside @supports, after the rules they soften', () => {
  for (const ring of RINGS) {
    const rule = rules(guarded).find(r => r.selector === ring);
    assert.ok(rule && /border-color\s*:\s*color-mix\(/.test(rule.body), `${ring}: no softer ring in @supports`);
    const plainAt = css.indexOf(ring + ' {') >= 0 ? css.indexOf(ring + ' {') : css.indexOf(ring + '{');
    const softAt = css.lastIndexOf(ring);
    assert.ok(plainAt >= 0 && softAt > plainAt, `${ring}: the @supports rule must come after the plain one`);
  }
});

test('no animated rule outside @supports leans on color-mix()', () => {
  for (const { selector, body } of rules(outside)) {
    if (/animation\s*:/.test(body)) assert.doesNotMatch(body, /color-mix\(/, selector);
  }
});
