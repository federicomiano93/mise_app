// Unit tests for the money layout (P15 — the owner cannot read code, so these tests are the safety
// net), run against BOTH implementations: the TypeScript port in shared/ and js/currency.js, which the
// live app uses today. Ported from tests/currency.test.mjs; the two must stay equal until the switch
// to Mise 2.
//
// currency.ts is an ADAPTED port, so parity.spec.ts does not pair it: the original keeps the venue's
// money in two module variables (setCurrency writes them, currentCurrency and moneyText read them),
// and Mise 2 never keeps a venue fact in a module variable — the money is handed to the functions
// that write it, and moneyOf(symbol, layout) is setCurrency's validation without the storing. So
// every case below runs against the js/ module after setCurrency(symbol, layout) and against the
// TypeScript one with moneyOf(symbol, layout), and demands the same text; the js/ module is put back
// to its fallback after every test. The last block stands in for what pairing would have checked.
//
// PORTED: the 4 tests that call the module — 'it remembers a symbol and hands it back' (as «a venue's
// symbol is kept»), 'Italian layout', 'the British layout and the fallback…' and 'localNumber writes a
// plain number in the money layout; typedDecimal reads either mark'.
//
// NOT PORTED, because they read source as text or test the wiring of the current app:
//   * '⚠️⚠️ js/currency.js converts nothing — no rates, no arithmetic' and '⚠️ js/currency.js imports
//     nothing' — they read js/currency.js as text.
//   * '⚠️⚠️ the session takes the currency from the COUNTRY, never from the language' and '⚠️ the call
//     is actually made, and on the location the session just opened' — they read js/firebase.js
//     (Mise 2's session reads the country through market.ts; its own spec owns that wiring).
//   * '⚠️ no currency symbol is written into any string in js/' and 'and that guard would catch the
//     line this release removed' — they scan every file of js/.
//   * 'the order line writes its quantity in the money layout' — it reads two screens as text.

import { afterEach, describe, expect, test } from 'vitest';
import * as ported from './currency';
import * as legacyJs from '../../js/currency.js';

const IT = { decimal: ',', group: '.', symbolAfter: true };
const NB = ' ';

// One venue's money, written through whichever implementation is being tested.
interface World {
  open(symbol?: unknown, layout?: unknown): void;
  symbol(): string;
  moneyText(fixed: string): string;
  localNumber(text: unknown, grouped?: boolean): string;
  typedDecimal(text: unknown): string;
}

function portedWorld(): World {
  let money = ported.FALLBACK_MONEY;
  return {
    open: (symbol, layout) => { money = ported.moneyOf(symbol, layout); },
    symbol: () => money.symbol,
    moneyText: fixed => ported.moneyText(fixed, money),
    localNumber: (text, grouped) => ported.localNumber(text, money, grouped),
    typedDecimal: text => ported.typedDecimal(text),
  };
}

function legacyWorld(): World {
  return {
    open: (symbol, layout) => { legacyJs.setCurrency(symbol, layout); },
    symbol: () => legacyJs.currentCurrency(),
    moneyText: fixed => legacyJs.moneyText(fixed),
    localNumber: (text, grouped) => legacyJs.localNumber(text, grouped),
    typedDecimal: text => legacyJs.typedDecimal(text),
  };
}

// The js/ module keeps its money for the life of the process, so a test never leaves a venue open.
afterEach(() => { legacyJs.setCurrency(); });

describe.each([
  ['shared/ (TypeScript)', portedWorld],
  ['js/ (current app)', legacyWorld],
] as const)('%s', (_name, makeWorld) => {
  const w = makeWorld();

  test("a venue's symbol is kept and handed back", () => {
    w.open('€');
    expect(w.symbol()).toBe('€');
    w.open('£');
    expect(w.symbol()).toBe('£');
  });

  test('a corrupt or missing symbol falls back rather than blanking the price', () => {
    for (const bad of [null, undefined, '', 0, {}, []]) {
      w.open(bad);
      expect(w.symbol(), `${JSON.stringify(bad)} must fall back`).toBe('£');
      expect(w.moneyText('1.00')).toBe('£1.00');
    }
  });

  // ── How the amount is written (4 Oct 2026) ─────────────────────────────────

  test('Italian layout: «1.234,56 €», a no-break space before the symbol', () => {
    w.open('€', IT);
    expect(w.moneyText('6.50')).toBe(`6,50${NB}€`);
    expect(w.moneyText('1234.56')).toBe(`1.234,56${NB}€`);
    expect(w.moneyText('1234567.00')).toBe(`1.234.567,00${NB}€`);
    expect(w.moneyText('999.99')).toBe(`999,99${NB}€`);
    expect(w.moneyText('-1234.50')).toBe(`-1.234,50${NB}€`);
    expect(w.moneyText('0.0035'), 'a small rate keeps every decimal').toBe(`0,0035${NB}€`);
    expect(w.moneyText('12')).toBe(`12${NB}€`);
  });

  test('the British layout and the fallback are exactly what the app always showed', () => {
    w.open('£', { decimal: '.', group: '', symbolAfter: false });
    expect(w.moneyText('1234.56')).toBe('£1234.56');
    expect(w.moneyText('-1.20')).toBe('£-1.20');
    w.open('£');
    expect(w.moneyText('1234.56'), 'no layout given = the historical one').toBe('£1234.56');
    w.open('€', { decimal: ',' });
    expect(w.moneyText('1234.56'), 'a half-formed layout falls back, never half-applies').toBe('€1234.56');
    w.open('€', IT);
    w.open('£');
    expect(w.moneyText('7.20'), 'a venue change puts the layout back too').toBe('£7.20');
  });

  // A quantity or weight beside a price, and what a person types in a price box (4 Oct 2026).
  test('localNumber writes a plain number in the money layout; typedDecimal reads either mark', () => {
    w.open('€', IT);
    expect(w.localNumber('2.5')).toBe('2,5');
    expect(w.localNumber(2.5), 'a number is taken as its text').toBe('2,5');
    expect(w.localNumber('1234.5')).toBe('1.234,5');
    expect(w.localNumber('1234.5', false), 'a box value is never grouped').toBe('1234,5');
    expect(w.localNumber('3')).toBe('3');
    expect(w.localNumber('1e-7'), 'text it cannot read comes back as is').toBe('1e-7');
    w.open('£');
    expect(w.localNumber('1234.5'), 'the British layout leaves it alone').toBe('1234.5');
    expect(w.typedDecimal('12,5')).toBe('12.5');
    expect(w.typedDecimal(' 12.5 ')).toBe('12.5');
    expect(w.typedDecimal('')).toBe('');
    expect(w.typedDecimal(null)).toBe('');
    expect(Number(w.typedDecimal('1.234,5')), 'two marks: unreadable, never guessed').toBeNaN();
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('thousands are grouped from the right, whatever the length, and a minus sign stays in front', () => {
    w.open('€', IT);
    for (const [text, shown] of [
      ['1', '1'], ['12', '12'], ['123', '123'], ['1234', '1.234'], ['12345', '12.345'], ['123456', '123.456'],
      ['1234567', '1.234.567'], ['-1234', '-1.234'], ['-123', '-123'], ['0.5', '0,5'], ['1234.5678', '1.234,5678'],
      ['-0.5', '-0,5'], ['', ''], ['abc', 'abc'], ['1,5', '1,5'], ['.5', '.5'], ['5.', '5.'], [' 5', ' 5'],
    ] as const) {
      expect(w.localNumber(text), JSON.stringify(text)).toBe(shown);
    }
  });

  test('⚠️ a quirk of the original, kept on purpose: the group is the replacement string of replace()', () => {
    // No real layout has a «$» in its group (they use «.» and nothing); if one ever did, both files
    // would expand it the same way until someone fixes BOTH.
    w.open('€', { decimal: ',', group: '$$', symbolAfter: true });
    expect(w.localNumber('1234.5')).toBe('1$234,5');
  });
});

// ── What only the TypeScript module is: money as a value ─────────────────────

describe('shared/ (TypeScript): the money is a value, never module state', () => {
  test('the fallback is the historical money: pounds, no grouping, symbol first — and it cannot change', () => {
    expect(ported.FALLBACK_MONEY).toStrictEqual({ symbol: '£', layout: { decimal: '.', group: '', symbolAfter: false } });
    expect(Object.isFrozen(ported.FALLBACK_MONEY)).toBe(true);
    expect(Object.isFrozen(ported.FALLBACK_MONEY.layout)).toBe(true);
  });

  test('moneyOf answers the fallback for nothing, and a frozen value for anything', () => {
    expect(ported.moneyOf(undefined, undefined)).toStrictEqual(ported.FALLBACK_MONEY);
    expect(ported.moneyOf('€', IT)).toStrictEqual({ symbol: '€', layout: IT });
    expect(Object.isFrozen(ported.moneyOf('€', IT))).toBe(true);
    // A layout of the expected shape is kept as given, as the original stored the very same object.
    expect(ported.moneyOf('€', IT).layout).toBe(IT);
  });

  test('⚠️ opening one venue changes nothing for another: the v1.57.0 defect cannot happen', () => {
    // The original needs «call this inside the function that draws, never at module load» because the
    // venue's money is a module variable. Here the money is an argument, so two venues at once, in any
    // order, each write their own amounts.
    const italy = ported.moneyOf('€', IT);
    const britain = ported.moneyOf('£', { decimal: '.', group: '', symbolAfter: false });
    expect(ported.moneyText('1234.50', italy)).toBe(`1.234,50${NB}€`);
    expect(ported.moneyText('1234.50', britain)).toBe('£1234.50');
    expect(ported.moneyText('1234.50', italy)).toBe(`1.234,50${NB}€`);
    expect(ported.moneyText('1234.50', ported.FALLBACK_MONEY)).toBe('£1234.50');
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The two functions that keep the venue's money in a module variable, which Mise 2 does not do.
  const LEFT_OUT = ['setCurrency', 'currentCurrency'];
  // What the port adds: the value the module variable is replaced by.
  const ADDED = ['FALLBACK_MONEY', 'moneyOf'];
  // They take the venue's money as one more argument, by design.
  const TAKE_THE_MONEY = ['moneyText', 'localNumber'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports the two functions this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(typeof original[name], name).toBe('function');
  });

  test('exports the same names, except those two, plus the money value and the function that makes it', () => {
    expect(Object.keys(port).sort()).toStrictEqual([...shared, ...ADDED].sort());
  });

  test('every function has the same name and the same number of required parameters (the money is one more)', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length + (TAKE_THE_MONEY.includes(name) ? 1 : 0));
    }
  });
});
