// Unit tests for the full-screen text size arithmetic (P15 — the owner cannot read code), run against BOTH
// implementations: the TypeScript port in shared/ and js/zoom-steps.js, which the live app uses today (the
// Ricettario's js/catalogue/zoom-steps.js is a byte copy of it, pinned by tests/copie-allineate.test.mjs).
// Ported from the S5 tests of tests/calculator-work-view.test.mjs that call the pure functions ('six steps',
// 'steps clamp at both ends', 'a stored value that is corrupt', 'a step written as digits'); the two must
// stay equal until the switch to Mise 2.
//
// zoom-steps.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also exports
// `readZoomStep` / `saveZoomStep` (they touch `localStorage`) and `buildZoomControls` (it builds DOM). The
// storage round trip is covered below through `parseStep` and `clampStep`, exactly as the Mise 2 screen will
// use them. The last block stands in for what pairing would have checked.
//
// NOT PORTED (they test what is left out, and need a DOM): the S5 tests of the pair of buttons, the
// full-screen dialog and its CSS (tests/calculator-work-view.test.mjs) — they belong to the screen's own
// specs in app/.

import { describe, expect, test } from 'vitest';
import fullscreenSource from '../../js/calc-fullscreen.js?raw';
import * as ported from './zoom-steps';
import * as legacyJs from '../../js/zoom-steps.js';

type Loose = any;
const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { ZOOM_SCALES, DEFAULT_ZOOM_STEP, clampStep, parseStep, stepBy, canStep, scaleOf } = m as unknown as Record<string, Loose>;

  test('six steps, 1× is the default, the largest is 2.1×', () => {
    expect([...ZOOM_SCALES]).toStrictEqual([0.8, 1, 1.2, 1.45, 1.75, 2.1]);
    expect(ZOOM_SCALES[DEFAULT_ZOOM_STEP]).toBe(1);
    expect(Object.isFrozen(ZOOM_SCALES)).toBe(true);
  });

  test('steps clamp at both ends and never leave the range', () => {
    expect(stepBy(0, -1)).toBe(0);
    expect(stepBy(5, 1)).toBe(5);
    expect(stepBy(1, 1)).toBe(2);
    expect(stepBy(1, -1)).toBe(0);
    expect(stepBy(99, 0)).toBe(5);
    expect(stepBy(-9, 0)).toBe(0);
    expect(canStep(0, -1)).toBe(false);
    expect(canStep(0, 1)).toBe(true);
    expect(canStep(5, 1)).toBe(false);
    expect(canStep(5, -1)).toBe(true);
    for (const junk of [null, undefined, '', 'x', NaN, 1.5, true, {}, []]) expect(clampStep(junk), String(junk)).toBe(DEFAULT_ZOOM_STEP);
    expect(scaleOf(0)).toBe(0.8);
    expect(scaleOf(5)).toBe(2.1);
    expect(scaleOf('nonsense')).toBe(1);
  });

  test('a stored value that is corrupt or out of range answers the default, never an extreme', () => {
    for (const raw of [null, undefined, '', 'abc', '-1', '6', '99', '1.5', '1e1', '{"a":1}', '  ', 'NaN']) {
      expect(parseStep(raw), JSON.stringify(raw)).toBe(DEFAULT_ZOOM_STEP);
    }
    for (let n = 0; n <= 5; n++) expect(parseStep(String(n))).toBe(n);
  });

  test('a step written as digits is read as that step (the regex has its backslash)', () => {
    expect(clampStep('3')).toBe(3);
    expect(clampStep(' 2 ')).toBe(2);
    expect(clampStep('d')).toBe(1);
  });

  test('the app\'s storage round trip: write clampStep, read parseStep (what saveZoomStep / readZoomStep do)', () => {
    for (const n of [0, 1, 2, 3, 4, 5]) expect(parseStep(String(clampStep(n)))).toBe(n);
    expect(parseStep(String(clampStep(42)))).toBe(5);
    expect(parseStep(String(clampStep(-3)))).toBe(0);
    expect(parseStep(String(clampStep('banana')))).toBe(DEFAULT_ZOOM_STEP);
  });
});

describe('the port against the original', () => {
  const LEFT_OUT = ['readZoomStep', 'saveZoomStep', 'buildZoomControls'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    for (const name of LEFT_OUT) expect(typeof original[name], name).toBe('function');
  });

  test('exports exactly the same names, except those', () => {
    expect(Object.keys(port).sort()).toStrictEqual(shared);
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect((mine as { name: string }).name, name).toBe((theirs as { name: string }).name);
      expect((mine as { length: number }).length, `${name}: arity`).toBe((theirs as { length: number }).length);
    }
  });

  test('the storage key the app uses is the one the current app uses (shared origin)', () => {
    // The key is not in this file: both apps hand it in. Pin the current app's spelling so Mise 2 cannot drift.
    const source = fullscreenSource;
    expect(source).toContain("'mise.calcZoomStep'");
  });
});
