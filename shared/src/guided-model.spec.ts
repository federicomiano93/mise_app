// Unit tests for the Catalogue's guided mixing procedure (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/catalogue/guided-model.js. Every test of tests/guided-model.test.mjs is
// ported here; the two must stay equal until the switch to Mise 2.
//
// guided-model.ts is an ADAPTED port, so parity.spec.ts does not pair it: `stepRows`, `overdueText` and
// `progressText` read the interface dictionary in the original, and the port is handed the word / the translator
// instead. Here the port gets the current app's own dictionary (`t`), so both must say the SAME text; the last
// blocks stand in for what pairing would have checked (export list, names, arities, one Italian run).

import { describe, expect, test } from 'vitest';
import * as ported from './guided-model';
import * as portedCatalogue from './catalogue-model';
import * as legacyJs from '../../js/catalogue/guided-model.js';
import * as legacyCatalogueJs from '../../js/catalogue/catalogue-model.js';
import { DEFAULT_LANGUAGE, setLanguage, t } from '../../js/i18n.js';

type Loose = any;
const legacy = legacyJs as unknown as typeof ported;
const legacyCatalogue = legacyCatalogueJs as unknown as typeof portedCatalogue;

// The interface dictionary, handed to the port as the translator.
const tr: ported.GuidedTranslate = (key, params) => t(key, params as Record<string, string | number>);

// A recipe shaped exactly as Firestore holds one, rows already carrying ids.
const recipe = (): Loose => ({
  id: 'R1',
  name: 'Croissant',
  ingredients: [
    { rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' },
    { rid: 'rb', label: 'Water', grams: 500, unit: 'g' },
    { rid: 'rc', label: 'Butter', grams: 500, unit: 'g' },
    { rid: 'rd', label: 'Salt', grams: 20, unit: 'g' },
  ],
  steps: [
    { text: 'Add the flour and the water', rows: ['ra', 'rb'], seconds: 0, speed: '' },
    { text: 'Mix', rows: [], seconds: 240, speed: '1' },
    { text: 'Add the butter', rows: ['rc'], seconds: 300, speed: '2' },
  ],
});

const session = (over: Record<string, unknown> = {}): Loose => ({
  recipeId: 'R1',
  snapshot: recipe(),
  stepIndex: 1,
  startedAt: 1_000_000_000,
  ...over,
});

describe.each([
  ['shared/ (TypeScript)', ported, portedCatalogue, true],
  ['js/ (current app)', legacy, legacyCatalogue, false],
] as const)('%s', (_name, m, cat, isPort) => {
  const g = m as unknown as Record<string, Loose>;
  const c = cat as unknown as Record<string, Loose>;
  const {
    MAX_STEPS, MAX_STEP_SECONDS, MAX_STEP_TEXT, MAX_SPEED_TEXT, MAX_END_NOTE, RESUME_TTL_MS,
    makeRowId, ridOf, withRowIds,
    normalizeSeconds, normalizeStep, normalizeSteps, normalizeEndNote, isEmptyStep, hasProcedure,
    unassignedRows, missingRefs, amountsFor,
    remainingMs, timerState, formatDuration, formatRemaining, isResumable,
  } = g;
  const { scaleCatalogue, baseAmounts, normalizeCatalogueRecipe } = c;

  // The three adapted functions, called the way the CURRENT APP calls them: the port gets the word / translator.
  const stepRows = (step: unknown, r: unknown, amounts: unknown): Loose =>
    isPort ? g.stepRows(step, r, amounts, t('cat.noLongerInThe')) : g.stepRows(step, r, amounts);
  const overdueText = (endsAt: unknown, nowMs: unknown): string =>
    isPort ? g.overdueText(endsAt, nowMs, tr) : g.overdueText(endsAt, nowMs);
  const progressText = (i: unknown, n: unknown, opts?: { inline?: boolean }): string =>
    isPort ? g.progressText(i, n, opts, tr) : g.progressText(i, n, opts);

  // ── Stable row ids ──────────────────────────────────────────────────────────

  test('a row\'s id is its rid, trimmed', () => {
    expect(ridOf({ rid: 'ra' })).toBe('ra');
    expect(ridOf({ rid: '  ra  ' })).toBe('ra');
    expect(ridOf({ rid: 42 })).toBe('42');
  });

  test('a row with no usable id answers the empty text, never undefined or a throw', () => {
    for (const row of [null, undefined, {}, { rid: null }, { rid: undefined }, { rid: '' }, { rid: '   ' }, 'str', 5, []]) {
      expect(ridOf(row), JSON.stringify(row)).toBe('');
    }
  });

  test('the key of a linked row is its own rid, never its name', () => {
    expect(ridOf({ rid: 'r1', label: 'Yeast' })).toBe(ridOf({ rid: 'r1', label: 'Fresh yeast' }));
  });

  test('a row that already has an id keeps it, byte for byte', () => {
    const rows = [{ rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' }];
    const out = withRowIds(rows);
    expect(out[0], 'the untouched row must be the SAME object, not a copy').toBe(rows[0]);
    expect(out[0].rid).toBe('ra');
  });

  test('a row with no id gets one, and it is unique', () => {
    const out = withRowIds([
      { label: 'Flour', grams: 1000 },
      { label: 'Water', grams: 500 },
      { rid: 'rc', label: 'Butter', grams: 500 },
    ]);
    expect(ridOf(out[0])).toBeTruthy();
    expect(ridOf(out[1])).toBeTruthy();
    expect(out[2].rid).toBe('rc');
    expect(new Set(out.map(ridOf)).size, 'two rows ended up sharing an id').toBe(3);
  });

  test('a DUPLICATED id is broken apart — two rows may never share one', () => {
    const out = withRowIds([
      { rid: 'ra', label: 'Flour', grams: 1000 },
      { rid: 'ra', label: 'Water', grams: 500 },
    ]);
    expect(out[0].rid).toBe('ra');
    expect(out[1].rid).not.toBe('ra');
    expect(ridOf(out[1])).toBeTruthy();
  });

  test('the generator never repeats itself into a collision', () => {
    let n = 0;
    const bad = () => (++n <= 2 ? 'rx' : 'ry');
    const out = withRowIds([{ label: 'A' }, { label: 'B' }], bad);
    expect(out[0].rid).toBe('rx');
    expect(out[1].rid).toBe('ry');
  });

  test('withRowIds survives junk without throwing, and never mutates its input', () => {
    expect(withRowIds(null)).toStrictEqual([]);
    expect(withRowIds('nope')).toStrictEqual([]);
    const input = [null, { label: 'A' }];
    const out = withRowIds(input);
    expect(out[0]).toBeNull();
    expect(ridOf(out[1])).toBeTruthy();
    expect(input[1]).toStrictEqual({ label: 'A' });
  });

  test('a generated id looks like an id, and follows the random source it is given', () => {
    for (let i = 0; i < 50; i++) expect(makeRowId()).toMatch(/^r[a-z0-9]{8}$/);
    expect(makeRowId(() => 0)).toBe('raaaaaaaa');
    expect(makeRowId(() => 0.999)).toBe('r99999999');
  });

  // ── Surviving the trip through Firestore ────────────────────────────────────
  // normalizeCatalogueRecipe REBUILDS a recipe from scratch, so a field it does not mention is dropped on the way
  // in — silently, and permanently once the recipe is next saved. These pin the same trap for the procedure.

  test('a row id survives the trip in from the database', () => {
    const back = normalizeCatalogueRecipe({
      id: 'R1', name: 'Croissant',
      ingredients: [{ rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' }],
    });
    expect(back.ingredients[0].rid).toBe('ra');
  });

  test('a procedure survives the trip in from the database', () => {
    const steps = [{ text: 'Mix', rows: ['ra'], seconds: 240, speed: '1' }];
    expect(normalizeCatalogueRecipe({ id: 'R1', name: 'C', ingredients: [], steps }).steps).toStrictEqual(steps);
  });

  test('a recipe with no procedure keeps exactly the shape it has today', () => {
    // Absent, not empty: hundreds of recipes have no steps and must not all be rewritten with a new field.
    const back = normalizeCatalogueRecipe({ id: 'R1', name: 'C', ingredients: [] });
    expect('steps' in back).toBe(false);
    expect('rid' in normalizeCatalogueRecipe({ id: 'R1', name: 'C', ingredients: [{ label: 'Flour', grams: 1 }] }).ingredients[0]).toBe(false);
  });

  // ── Normalising ─────────────────────────────────────────────────────────────

  test('a step made of junk never produces NaN or a negative time', () => {
    const step = normalizeStep({ text: null, rows: 'nope', seconds: 'abc', speed: undefined });
    expect(step).toStrictEqual({ text: '', rows: [], seconds: 0, speed: '' });
    expect(normalizeSeconds(-30)).toBe(0);
    expect(normalizeSeconds(NaN)).toBe(0);
    // ⚠️ Infinity is JUNK, not "the maximum": it must fall to no timer at all.
    expect(normalizeSeconds(Infinity)).toBe(0);
    expect(normalizeSeconds('90')).toBe(90);
    expect(normalizeSeconds(12.7), 'a fraction of a second is not a thing').toBe(12);
    expect(normalizeStep(null)).toBeNull();
  });

  test('a mistyped duration is capped, not obeyed', () => {
    expect(normalizeSeconds(999999)).toBe(MAX_STEP_SECONDS);
  });

  test('the limits are the ones the rules also enforce', () => {
    expect([MAX_STEPS, MAX_STEP_TEXT, MAX_SPEED_TEXT, MAX_STEP_SECONDS, MAX_END_NOTE, RESUME_TTL_MS])
      .toStrictEqual([100, 300, 24, 43200, 300, 86400000]);
  });

  test('long text and a long speed are cut to size', () => {
    const step = normalizeStep({ text: 'x'.repeat(500), speed: 'y'.repeat(50) });
    expect(step.text.length).toBe(MAX_STEP_TEXT);
    expect(step.speed.length).toBe(MAX_SPEED_TEXT);
  });

  test('the same row named twice in one step is only added once', () => {
    expect(normalizeStep({ rows: ['ra', 'ra', 'rb', '', null] }).rows).toStrictEqual(['ra', 'rb']);
  });

  test('an entirely empty step is dropped rather than shown as a blank card', () => {
    expect(isEmptyStep({ text: '', rows: [], seconds: 0, speed: '' })).toBe(true);
    expect(normalizeSteps([{ text: '', rows: [], seconds: 0, speed: '' }]).length).toBe(0);
    // …but a step that only holds a timer is real work and must survive.
    expect(normalizeSteps([{ seconds: 60 }]).length).toBe(1);
  });

  test('a runaway procedure is cut to the cap the rules also enforce', () => {
    const many = Array.from({ length: MAX_STEPS + 20 }, (_, i) => ({ text: 'step ' + i }));
    expect(normalizeSteps(many).length).toBe(MAX_STEPS);
  });

  test('normalizeSteps survives junk, and hasProcedure answers honestly', () => {
    expect(normalizeSteps(null)).toStrictEqual([]);
    expect(normalizeSteps('nope')).toStrictEqual([]);
    expect(normalizeSteps([null, 7, 'x'])).toStrictEqual([]);
    expect(hasProcedure({})).toBe(false);
    expect(hasProcedure({ steps: [] })).toBe(false);
    expect(hasProcedure(recipe())).toBe(true);
  });

  // ── The safety net: no ingredient may go missing in silence ─────────────────

  test('AN INGREDIENT IN NO STEP IS ALWAYS REPORTED', () => {
    const missed = unassignedRows(recipe());
    expect(missed.map((r: Loose) => r.label)).toStrictEqual(['Salt']);
  });

  test('…and a procedure that accounts for everything reports nothing', () => {
    const r = recipe();
    r.steps.push({ text: 'Add the salt', rows: ['rd'] });
    expect(unassignedRows(r)).toStrictEqual([]);
  });

  test('a recipe with no procedure at all counts every row as unassigned', () => {
    const r = recipe();
    r.steps = [];
    expect(unassignedRows(r).map((r2: Loose) => r2.label)).toStrictEqual(['Flour', 'Water', 'Butter', 'Salt']);
  });

  test('a row with no id is unassigned — it cannot be in a step', () => {
    const r = recipe();
    r.ingredients.push({ label: 'Sugar', grams: 100, unit: 'g' });
    expect(unassignedRows(r).some((row: Loose) => row.label === 'Sugar')).toBe(true);
  });

  test('a nameless row is not counted — the editor drops those on save', () => {
    const r = recipe();
    r.ingredients.push({ rid: 're', label: '   ', grams: 0, unit: 'g' });
    expect(unassignedRows(r).map((x: Loose) => x.label)).toStrictEqual(['Salt']);
  });

  test('a row deleted from the recipe leaves its step SAYING so', () => {
    const r = recipe();
    r.ingredients = r.ingredients.filter((i: Loose) => i.rid !== 'rc'); // butter deleted
    expect(missingRefs(r)).toStrictEqual(['rc']);

    const rows = stepRows(r.steps[2], r, amountsFor(r, 0));
    expect(rows.length, 'the line must stay put, not vanish').toBe(1);
    expect(rows[0].missing).toBe(true);
    expect(rows[0].label).toMatch(/no longer in the recipe/i);
    expect(rows[0].amount).toBeNull();
  });

  test('missingRefs is empty for an intact recipe, and never repeats an id', () => {
    expect(missingRefs(recipe())).toStrictEqual([]);
    const r = recipe();
    r.ingredients = [];
    r.steps = [{ rows: ['ra'] }, { rows: ['ra', 'rb'] }];
    expect(missingRefs(r)).toStrictEqual(['ra', 'rb']);
  });

  // ── The amounts are the recipe screen's own numbers ─────────────────────────

  test('A STEP SHOWS EXACTLY WHAT THE RECIPE SCREEN SHOWS, at any batch size', () => {
    // ⚠️ The one number in this feature that can be WRONG rather than merely missing.
    const r = recipe();
    for (const target of [0, 4000, 17500, 100000]) {
      const mine = amountsFor(r, target);
      const theirs = target > 0 ? scaleCatalogue(r, target) : baseAmounts(r);
      expect(mine, `the two disagree at ${target} g`).toStrictEqual(theirs);
    }
  });

  test('a batch of zero, or junk, falls back to the recipe as written', () => {
    const r = recipe();
    const base = baseAmounts(r);
    for (const bad of [0, -1, NaN, null, undefined, 'x', Infinity]) {
      expect(amountsFor(r, bad), `${String(bad)} did not fall back`).toStrictEqual(base);
    }
  });

  test('a step lists its rows in the order it names them, with the batch amounts', () => {
    const r = recipe();
    const amounts = amountsFor(r, 4040); // 2x the 2020 g recipe
    const rows = stepRows(r.steps[0], r, amounts);
    expect(rows.map((x: Loose) => x.label)).toStrictEqual(['Flour', 'Water']);
    expect(rows.map((x: Loose) => x.amount)).toStrictEqual([2000, 1000]);
    expect(rows.map((x: Loose) => x.unit)).toStrictEqual(['g', 'g']);
    expect(rows.every((x: Loose) => x.missing === false)).toBe(true);
  });

  test("a 'to taste' row shows no number rather than a zero", () => {
    const r = {
      ingredients: [{ rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' },
        { rid: 'rb', label: 'Pepper', grams: 0, unit: 'to taste' }],
      steps: [{ rows: ['rb'] }],
    };
    expect(stepRows(r.steps[0], r, amountsFor(r, 2000))[0].amount).toBeNull();
  });

  test('stepRows survives junk without throwing', () => {
    expect(stepRows(null, recipe(), [])).toStrictEqual([]);
    expect(stepRows({ rows: [] }, null, null)).toStrictEqual([]);
    expect(stepRows({ rows: ['ra'] }, recipe(), null)[0].amount).toBeNull();
  });

  // ── The clock ───────────────────────────────────────────────────────────────

  test('what is left is read off the clock, never counted', () => {
    const now = 1_000_000;
    expect(remainingMs(now + 60_000, now)).toBe(60_000);
    expect(remainingMs(now - 5_000, now), 'overdue must stay negative').toBe(-5_000);
    expect(remainingMs('x', now)).toBe(0);
    expect(remainingMs(now, 'x')).toBe(0);
  });

  test('the timer has three states and no fourth', () => {
    const now = 1_000_000;
    expect(timerState(0, now)).toBe('idle');
    expect(timerState(null, now)).toBe('idle');
    expect(timerState(now + 1, now)).toBe('running');
    expect(timerState(now, now)).toBe('finished');
    expect(timerState(now - 60_000, now)).toBe('finished');
  });

  test('the countdown reads the way a kitchen timer reads', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(59)).toBe('00:59');
    expect(formatDuration(240)).toBe('04:00');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3905)).toBe('1:05:05');
  });

  test('a finished timer reads 00:00 — never a negative', () => {
    const now = 1_000_000;
    expect(formatRemaining(now - 90_000, now)).toBe('00:00');
    expect(formatDuration(-30)).toBe('00:00');
    expect(formatDuration(NaN)).toBe('00:00');
  });

  test('a part-second left still reads as a second, so it never sits on 00:00', () => {
    const now = 1_000_000;
    expect(formatRemaining(now + 400, now)).toBe('00:01');
  });

  test('COMING BACK LATE SAYS HOW LATE, instead of a tidy countdown', () => {
    // The alarm cannot ring while the app is in the background. What it must never do is come back pretending
    // nothing happened.
    const now = 1_000_000_000;
    expect(overdueText(now + 60_000, now), 'still running — say nothing').toBe('');
    expect(overdueText(now - 5_000, now)).toMatch(/just now/);
    expect(overdueText(now - 60_000, now)).toMatch(/1 minute ago/);
    expect(overdueText(now - 6 * 60_000, now)).toMatch(/6 minutes ago/);
    expect(overdueText(now - 90 * 60_000, now)).toMatch(/over an hour/);
    expect(overdueText(now - 200 * 60_000, now)).toMatch(/over 3 hours/);
  });

  // ── Picking up an interrupted run ───────────────────────────────────────────

  test('a run from a few minutes ago is offered back', () => {
    expect(isResumable(session(), 1_000_000_000 + 5 * 60_000)).toBe(true);
  });

  test('a run from another day is not', () => {
    expect(isResumable(session(), 1_000_000_000 + RESUME_TTL_MS + 1)).toBe(false);
    // …and one from just inside the window still is.
    expect(isResumable(session(), 1_000_000_000 + RESUME_TTL_MS - 1)).toBe(true);
  });

  test('A CLOCK THAT WENT BACKWARDS MAKES IT STALE, not fresh', () => {
    expect(isResumable(session(), 1_000_000_000 - 60_000)).toBe(false);
  });

  test('a session missing anything it needs is refused', () => {
    expect(isResumable(null, 1_000_000_000)).toBe(false);
    expect(isResumable('nope', 1_000_000_000)).toBe(false);
    expect(isResumable(session({ recipeId: '' }), 1_000_000_000)).toBe(false);
    expect(isResumable(session({ snapshot: null }), 1_000_000_000)).toBe(false);
    expect(isResumable(session({ snapshot: { steps: [] } }), 1_000_000_000)).toBe(false);
    expect(isResumable(session({ startedAt: 'x' }), 1_000_000_000)).toBe(false);
    expect(isResumable(session(), 'x')).toBe(false);
  });

  test('a step number outside the procedure is refused rather than clamped', () => {
    // Clamping would open a snapshot of 3 steps at step 9 and call it step 3 — resuming at the wrong point.
    expect(isResumable(session({ stepIndex: 3 }), 1_000_000_000)).toBe(false);
    expect(isResumable(session({ stepIndex: -1 }), 1_000_000_000)).toBe(false);
    expect(isResumable(session({ stepIndex: 1.5 }), 1_000_000_000)).toBe(false);
    expect(isResumable(session({ stepIndex: 2 }), 1_000_000_000)).toBe(true);
  });

  test('the resume offer says where you were', () => {
    expect(progressText(3, 9)).toBe('Step 4 of 9');
    expect(progressText(0, 3)).toBe('Step 1 of 3');
    expect(progressText(0, 0)).toBe('');
    expect(progressText('x', 9)).toBe('');
  });

  test('the inline form of the progress line is its own phrase, and the step is clamped into 1..total', () => {
    expect(progressText(3, 9, { inline: true })).toBe('step 4 of 9');
    expect(progressText(99, 9)).toBe('Step 9 of 9');
    expect(progressText(-5, 9)).toBe('Step 1 of 9');
  });

  // ── The closing message ─────────────────────────────────────────────────────

  test('a closing message is trimmed and kept', () => {
    expect(normalizeEndNote('  Final dough temperature 24-26 degrees  ')).toBe('Final dough temperature 24-26 degrees');
  });

  test('no closing message is an empty string, never undefined or null', () => {
    for (const nothing of [undefined, null, '', '   ']) {
      expect(normalizeEndNote(nothing), `${String(nothing)} did not become ''`).toBe('');
    }
  });

  test('junk becomes text rather than leaking a shape onto the screen', () => {
    expect(typeof normalizeEndNote(42)).toBe('string');
    expect(normalizeEndNote(42)).toBe('42');
    expect(typeof normalizeEndNote({})).toBe('string');
  });

  test('a very long closing message is cut, not sent whole', () => {
    expect(normalizeEndNote('x'.repeat(1000)).length).toBe(MAX_END_NOTE);
  });

  test('the closing message survives a round trip through the recipe normaliser', () => {
    // ⚠️ THE FIVE-PLACE TRAP: a field the model carries and one of the hand-listed field lists does not is
    // dropped on every save, silently.
    const withNote = normalizeCatalogueRecipe({
      id: 'R9', name: 'Croissant', ingredients: [], endNote: 'Final dough temperature 24-26 degrees',
    });
    expect(withNote.endNote).toBe('Final dough temperature 24-26 degrees');
  });

  test('a recipe with no closing message does not grow an empty one', () => {
    const plain = normalizeCatalogueRecipe({ id: 'R9', name: 'Croissant', ingredients: [] });
    expect('endNote' in plain).toBe(false);
    const blank = normalizeCatalogueRecipe({ id: 'R9', name: 'Croissant', ingredients: [], endNote: '   ' });
    expect('endNote' in blank).toBe(false);
  });
});

describe('the port against the original', () => {
  const orig = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const ADAPTED = ['stepRows', 'overdueText', 'progressText'];

  test('the port exports exactly what the original exports', () => {
    expect(Object.keys(port).sort()).toStrictEqual(Object.keys(orig).sort());
  });

  test('every constant is the same value in both', () => {
    for (const name of Object.keys(orig).filter(n => typeof orig[n] !== 'function')) {
      expect(port[name], name).toBe(orig[name]);
    }
  });

  test('every function that is not adapted has the same name and arity in both', () => {
    for (const name of Object.keys(orig).filter(n => typeof orig[n] === 'function' && !ADAPTED.includes(n))) {
      expect((port[name] as { name: string }).name, name).toBe((orig[name] as { name: string }).name);
      expect((port[name] as { length: number }).length, `${name}: arity`).toBe((orig[name] as { length: number }).length);
    }
  });

  test('the adapted functions take one argument more: the word / the translator', () => {
    for (const name of ADAPTED) {
      expect((port[name] as { name: string }).name, name).toBe((orig[name] as { name: string }).name);
    }
    expect(ported.stepRows.length).toBe(legacy.stepRows.length + 1);
    expect(ported.overdueText.length).toBe(legacy.overdueText.length + 1);
    // `progressText` has a DEFAULTED options object before the translator, and `Function.length` stops counting
    // at the first default: so it reads 2 in both, though the port takes one more.
    expect(ported.progressText.length).toBe(legacy.progressText.length);
  });

  test('the adapted functions say the same text as the original, in both languages', () => {
    const lang = (code: string, fn: () => void): void => {
      setLanguage(code);
      try { fn(); } finally { setLanguage(DEFAULT_LANGUAGE); }
    };
    const l = legacyJs as unknown as Record<string, Loose>;
    for (const code of ['en', 'it']) {
      lang(code, () => {
        const now = 1_000_000_000;
        for (const ago of [5_000, 60_000, 6 * 60_000, 90 * 60_000, 200 * 60_000, -60_000]) {
          expect(ported.overdueText(now - ago, now, tr), `${code} overdue ${ago}`).toBe(l.overdueText(now - ago, now));
        }
        for (const inline of [false, true]) {
          expect(ported.progressText(3, 9, { inline }, tr), `${code} progress`).toBe(l.progressText(3, 9, { inline }));
        }
        const r = recipe();
        r.ingredients = [];
        expect(ported.stepRows(r.steps[0], r, [], t('cat.noLongerInThe'))).toStrictEqual(l.stepRows(r.steps[0], r, []));
      });
    }
    lang('it', () => {
      expect(ported.progressText(3, 9, {}, tr)).toBe('Passo 4 di 9');
      expect(ported.overdueText(0, 30_000, tr)).toBe('Tempo scaduto — proprio ora.');
    });
  });
});
