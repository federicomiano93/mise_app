// What the Calculator says when it has nothing to show (P15 — the owner cannot read code, so these tests are
// the safety net), run against BOTH implementations: the TypeScript port in shared/ and
// js/calculator-config.js, which the live app uses today. Ported from tests/calculator-empty-state.test.mjs
// (all 12 of its tests); the two must stay equal until the switch to Mise 2.
//
// This became reachable on 13 Aug 2026, when the app stopped shipping one bakery's recipes as its default:
// from that day a customer who has just bought the app opens a Calculator with no tabs at all.
//
// The decision is pure so it can be pinned here; the words themselves live in the screen. What must never
// drift is WHICH of the three sentences is chosen, because two of them are wrong in ways that matter:
//   • "no recipes yet" while the server is still answering tells a customer with a full address book that
//     their work has gone;
//   • "add your first recipe" to somebody who has ten, all hidden, sets them building a duplicate of
//     something they already own.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-config';
import * as legacyJs from '../../js/calculator-config.js';

const legacy = legacyJs as unknown as typeof ported;

type Loose = any;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { calculatorEmptyReason, DEFAULT_CONFIG, MAX_VISIBLE_RECIPES } = m as unknown as Record<string, Loose>;
  const normalizeConfig = (raw: unknown): Loose => m.normalizeConfig(raw);

  const ANSWERED = true;
  const WAITING = false;

  // A minimal recipe: the empty state only ever asks whether one exists and whether it
  // is set to show, so nothing else is worth carrying here.
  const recipe = (id: string, extra?: Loose): Loose => ({ id, name: id, logic: 'orders', ingredients: [], ...extra });

  // ── There is something to draw ────────────────────────────────────────────────

  test('a visible recipe means there is nothing to explain', () => {
    const config = { recipes: [recipe('r1')] };
    expect(calculatorEmptyReason(config, ANSWERED)).toBe(null);
  });

  test('a visible recipe wins even before the server has answered', () => {
    // The cached copy is real data. Covering it with "Loading…" would blank the tabs of
    // every phone that has used the app before, on every single open.
    const config = { recipes: [recipe('r1')] };
    expect(calculatorEmptyReason(config, WAITING)).toBe(null);
  });

  test('more recipes than fit still leaves nothing to explain', () => {
    const many = [];
    for (let i = 0; i <= MAX_VISIBLE_RECIPES + 2; i++) many.push(recipe('r' + i));
    expect(calculatorEmptyReason({ recipes: many }, ANSWERED)).toBe(null);
  });

  // ── Nothing to draw, and the server has spoken ────────────────────────────────

  test('no recipes at all, once the server has answered, says so', () => {
    expect(calculatorEmptyReason({ recipes: [] }, ANSWERED)).toBe('no-recipes');
  });

  test('recipes that exist but are all hidden get their OWN sentence', () => {
    // ⚠️ Not 'no-recipes'. The two need different words and a different button: one
    // adds a recipe, the other picks which of the existing ones to show.
    const config = { recipes: [recipe('r1', { visible: false }), recipe('r2', { visible: false })] };
    expect(calculatorEmptyReason(config, ANSWERED)).toBe('hidden-recipes');
  });

  test('one hidden recipe among visible ones changes nothing', () => {
    const config = { recipes: [recipe('r1'), recipe('r2', { visible: false })] };
    expect(calculatorEmptyReason(config, ANSWERED)).toBe(null);
  });

  // ── Nothing to draw, and the server has NOT spoken ────────────────────────────

  test('an empty config with no answer yet says it is still loading', () => {
    // ⚠️ THIS IS THE ONE THAT PROTECTS AN EXISTING CUSTOMER. A phone with no cached
    // copy — a new device, or any device that has just entered a location, since
    // entering wipes the cache — starts on the empty default while Firestore is still
    // being asked. Answering "you have no recipes" there is a lie with a long tail:
    // the natural reaction is to start typing the recipes back in.
    expect(calculatorEmptyReason({ recipes: [] }, WAITING)).toBe('loading');
  });

  test('hidden recipes with no answer yet also read as loading', () => {
    const config = { recipes: [recipe('r1', { visible: false })] };
    expect(calculatorEmptyReason(config, WAITING)).toBe('loading');
  });

  test('a missing serverAnswered argument is treated as "not answered"', () => {
    // A caller that forgets the argument must get the cautious answer, never the
    // confident one.
    expect(calculatorEmptyReason({ recipes: [] })).toBe('loading');
  });

  // ── Garbage in ────────────────────────────────────────────────────────────────

  test('a missing or broken config does not throw, and reads as empty', () => {
    for (const bad of [null, undefined, {}, { recipes: null }, { recipes: 'three' }, 42]) {
      expect(calculatorEmptyReason(bad, ANSWERED)).toBe('no-recipes');
      expect(calculatorEmptyReason(bad, WAITING)).toBe('loading');
    }
  });

  // ── The shipped default ───────────────────────────────────────────────────────

  test('the app ships with nothing to show, and says so rather than showing a Log', () => {
    // The other half of the 13 Aug change: DEFAULT_CONFIG is empty, so this is exactly
    // what a customer sees the first time they open the Calculator. If somebody ever
    // puts recipes back into the default, this test names the file that did it.
    expect(calculatorEmptyReason(DEFAULT_CONFIG, ANSWERED)).toBe('no-recipes');
    expect(calculatorEmptyReason(normalizeConfig({}), ANSWERED)).toBe('no-recipes');
    expect(calculatorEmptyReason(normalizeConfig(null), ANSWERED)).toBe('no-recipes');
  });

  // ── The set of answers ────────────────────────────────────────────────────────

  test('there are exactly three sentences, and every one of them is reachable', () => {
    // The renderer keys its copy off these strings. A fourth added without its words
    // would fall back to "Loading…" and hang there in silence, so the set is pinned.
    const seen = new Set([
      calculatorEmptyReason({ recipes: [] }, WAITING),
      calculatorEmptyReason({ recipes: [] }, ANSWERED),
      calculatorEmptyReason({ recipes: [recipe('r1', { visible: false })] }, ANSWERED),
    ]);
    expect([...seen].sort()).toStrictEqual(['hidden-recipes', 'loading', 'no-recipes']);
  });
});
