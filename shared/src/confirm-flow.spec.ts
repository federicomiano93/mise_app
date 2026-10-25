// Unit tests for what a tap on a recipe's Confirm does (P15 — the owner cannot read code), run against BOTH
// implementations: the TypeScript port in shared/ and js/confirm-flow.js, which the live app uses today.
// Ported from tests/calculator-work-view.test.mjs (slice S1: 3 of its tests — 'S1: switch ON…', 'S1: switch
// OFF…' and the words are the screen's); the two must stay equal until the switch to Mise 2.
//
// ⚠️ ONE ANSWER, READ AT THE TAP: only a literal `askDoughDay: false` saves for today at once; a missing,
// corrupt or any other value opens the day picker, so the question is never skipped by accident.
// confirm-flow.ts is a FULL port, so parity.spec.ts pairs it.
//
// NOT PORTED from the same file: the S1 tests that read calculator.html, js/calculator-settings.js and
// js/app.js as text (the switch's markup, its wiring, `runConfirm` being called from app.js), and the words
// of the switch in the dictionary.

import { describe, expect, test } from 'vitest';
import * as ported from './confirm-flow';
import * as legacyJs from '../../js/confirm-flow.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  function probe(config: unknown): { answer: string; calls: (string | undefined)[][] } {
    const calls: string[][] = [];
    const answer = m.runConfirm('focaccia', {
      config,
      openDayPicker: id => calls.push(['picker', id]),
      saveToday: id => calls.push(['today', id]),
    });
    return { answer, calls };
  }

  test('S1: switch ON (or never set, or corrupt) → the day picker opens and nothing is saved', () => {
    for (const config of [{ askDoughDay: true }, {}, null, undefined, { askDoughDay: 'no' }, { askDoughDay: 0 }, { askDoughDay: null }, 'x', 5]) {
      const { answer, calls } = probe(config);
      expect(answer, JSON.stringify(config)).toBe('asked');
      expect(calls).toStrictEqual([['picker', 'focaccia']]);
    }
  });

  test('S1: switch OFF → saved for today at once and the picker never opens', () => {
    const { answer, calls } = probe({ askDoughDay: false });
    expect(answer).toBe('today');
    expect(calls).toStrictEqual([['today', 'focaccia']]);
  });
});
