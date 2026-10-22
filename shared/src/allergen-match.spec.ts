// Unit tests for reading a pack's own ingredient list and PROPOSING allergens (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/allergen-match.js (with js/allergen-terms.js
// and js/allergen-model.js behind it), which the live app uses today. Ported from
// tests/allergen-match.test.mjs; the two must stay equal until the switch to Mise 2. The module is a
// FULL port, so parity.spec.ts also compares its exports (names, constants, frozen-ness, shapes).
//
// PORTED: all 46 of 46 tests of tests/allergen-match.test.mjs. None of them reads a source file or
// the DOM. Added at the end: the shape of a reading (field names and order), and that nothing in the
// reconciliation result is shared with its inputs.
//
// ⚠️⚠️ EVERY TEST HERE IS ONE OF TWO QUESTIONS, and the second matters as much as the first:
//   a MISS   — an allergen on the pack that the matcher did not name. Somebody in hospital.
//   a CRY WOLF — an allergen the pack does NOT contain. It teaches people to tap through the
//              proposal, and then the real one goes through with them.
// The suggestion is inert either way — nothing here writes allergensCheckedAt.

import { describe, expect, test } from 'vitest';
import * as portedMatch from './allergen-match';
import * as portedTerms from './allergen-terms';
import * as portedModel from './allergen-model';
import * as legacyMatchJs from '../../js/allergen-match.js';
import * as legacyTermsJs from '../../js/allergen-terms.js';
import * as legacyModelJs from '../../js/allergen-model.js';

const legacyMatch = legacyMatchJs as unknown as typeof portedMatch;
const legacyTerms = legacyTermsJs as unknown as typeof portedTerms;
const legacyModel = legacyModelJs as unknown as typeof portedModel;

describe.each([
  ['shared/ (TypeScript)', portedMatch, portedTerms, portedModel],
  ['js/ (current app)', legacyMatch, legacyTerms, legacyModel],
] as const)('%s', (_name, m, terms, model) => {
  const { TERMS, NEGATIVE_PHRASES, REMAPS, AMBIGUOUS } = terms;
  const { ALLERGEN_CODES } = model;
  const read = (text: unknown) => m.readPackIngredients(text);
  const has = (text: string, ...codes: string[]): void => {
    const out = read(text);
    for (const c of codes) expect(out.allergens, `${JSON.stringify(text)} should propose ${c}, got [${out.allergens}]`).toContain(c);
  };
  const hasNot = (text: string, ...codes: string[]): void => {
    const out = read(text);
    for (const c of codes) expect(out.allergens, `${JSON.stringify(text)} must NOT propose ${c}, got [${out.allergens}]`).not.toContain(c);
  };

  // ── A real pack, read end to end ───────────────────────────────────────────

  test('a real Italian pack, with all four traps in one line', () => {
    const pack = 'Farina di SEMOLA di GRANO duro, LATTE scremato in polvere, '
      + 'lecitina di SOIA, zucchero. Può contenere tracce di FRUTTA A GUSCIO e SESAMO.';
    const out = read(pack);
    expect(out.allergens).toContain('gluten-wheat');
    expect(out.allergens).toContain('milk');
    expect(out.allergens).toContain('soybeans');
    // ⚠️ The traces half never merges into the composition half.
    expect(out.allergens).not.toContain('sesame');
    expect(out.mayContain).toContain('sesame');
  });

  test('a real English pack', () => {
    const pack = 'WHEAT flour, water, BUTTER (MILK), salt, yeast, malted BARLEY flour. '
      + 'May contain traces of NUTS and SESAME.';
    const out = read(pack);
    expect(out.allergens.filter(c => c.startsWith('gluten')).sort()).toStrictEqual(['gluten-barley', 'gluten-wheat']);
    expect(out.allergens).toContain('milk');
    expect(out.mayContain).toContain('sesame');
  });

  // ── THE MISSES: words that share no letters with the allergen ──────────────

  test('MILK, by every word that is not "milk"', () => {
    for (const word of ['caseinato di sodio', 'siero di latte in polvere', 'lattosio',
      'cagliata', 'ghee', 'burro chiarificato', 'parmigiano', 'mascarpone', 'panna acida']) {
      has(word, 'milk');
    }
    for (const word of ['whey powder', 'sodium caseinate', 'lactose', 'curd', 'ghee', 'buttermilk']) {
      has(word, 'milk');
    }
  });

  test('EGGS, including the one that turns up on cheese and wine', () => {
    // ⚠️ lisozima / E1105 is an egg derivative printed with no egg word anywhere near it.
    for (const word of ['lisozima', 'E1105', 'ovoalbumina', 'albume', 'maionese', 'zabaione']) {
      has(word, 'eggs');
    }
    for (const word of ['lysozyme', 'albumen', 'meringue', 'mayonnaise']) has(word, 'eggs');
  });

  test('WHEAT, by the words a bakery actually buys', () => {
    for (const word of ['semola rimacinata', 'farina manitoba', 'seitan', 'cuscus', 'pangrattato',
      'germe di grano', 'amido di frumento']) has(word, 'gluten-wheat');
    for (const word of ['semolina', 'durum wheat', 'couscous', 'panko', 'bulgur']) has(word, 'gluten-wheat');
  });

  test('SOYA, CELERY and SESAME, where the allergen is inside a compound name', () => {
    for (const word of ['tofu', 'miso', 'tamari', 'edamame', 'tempeh']) has(word, 'soybeans');
    // ⚠️ CELERY IS IN EVERY STOCK CUBE, and none of these words contains "sedano".
    for (const word of ['dado vegetale', 'brodo vegetale', 'soffritto', 'battuto', 'mirepoix']) has(word, 'celery');
    for (const word of ['bouillon', 'stock cube', 'celeriac']) has(word, 'celery');
    for (const word of ['tahina', 'gomasio', 'halva', 'tahini']) has(word, 'sesame');
  });

  test('FISH and SULPHITES, the two that hide behind a brand or a number', () => {
    // Worcestershire sauce contains anchovy and no fish word.
    for (const word of ['salsa worcester', 'colatura di alici', 'colla di pesce', 'bottarga', 'surimi']) has(word, 'fish');
    for (const word of ['worcestershire sauce', 'isinglass', 'anchovies']) has(word, 'fish');
    for (const word of ['metabisolfito di sodio', 'anidride solforosa', 'E220', 'E224']) has(word, 'sulphites');
    for (const word of ['sodium metabisulphite', 'sulphur dioxide', 'E228']) has(word, 'sulphites');
  });

  test('the nuts are named ONE BY ONE, never as a category', () => {
    has('marzapane', 'nuts-almond');
    has('torrone', 'nuts-almond');
    has('gianduia', 'nuts-hazelnut');
    has('pralinato', 'nuts-hazelnut');
    has('granella di pistacchio', 'nuts-pistachio');
    has('anacardi', 'nuts-cashew');
    // Somebody who can eat almonds but not hazelnuts is not served by "nuts".
    hasNot('marzapane', 'nuts-hazelnut');
    hasNot('gianduia', 'nuts-almond');
  });

  // ── THE CRY WOLVES: the traps that must stay silent ────────────────────────

  test('⚠️ the words that LOOK like an allergen and are not', () => {
    hasNot('grano saraceno', 'gluten-wheat');           // buckwheat is not wheat
    hasNot('farina di grano saraceno', 'gluten-wheat');
    hasNot('buckwheat flour', 'gluten-wheat');
    hasNot('burro di cacao', 'milk');                    // cocoa butter is not dairy
    hasNot('cocoa butter', 'milk');
    hasNot('latte di cocco', 'milk');
    hasNot('coconut milk', 'milk');
    hasNot('noce moscata', 'nuts-walnut');               // nutmeg is not a nut
    hasNot('nutmeg', 'nuts-walnut');
    hasNot('noce di cocco', 'nuts-walnut');
    hasNot('maltodestrine', 'gluten-barley');            // maltodextrin is not malt
    hasNot('maltodextrin', 'gluten-barley');
    hasNot('solfato di calcio', 'sulphites');            // sulphate is not sulphite
    hasNot('calcium sulphate', 'sulphites');
    hasNot('chestnut', 'nuts-walnut');
    hasNot('pine nuts', 'nuts-walnut');
  });

  // ⚠️⚠️ A PHRASE MAY NOT BE BOTH «SAY NOTHING» AND «MEANS PEANUTS». A trap claims its span before
  // anything else runs, so each one put among the traps silenced ITSELF.
  test('⚠️⚠️ a phrase that overrides a stem AND names an allergen does both', () => {
    const cases = [
      ['burro di arachidi', 'peanuts', 'milk'],
      ['peanut butter', 'peanuts', 'milk'],
      ['latte di mandorla', 'nuts-almond', 'milk'],
      ['almond milk', 'nuts-almond', 'milk'],
      ['latte di soia', 'soybeans', 'milk'],
      ['latte di avena', 'gluten-oats', 'milk'],
      ['noce di burro', 'milk', 'nuts-walnut'],
    ] as const;
    for (const [text, right, wrong] of cases) {
      const out = read(text);
      expect(out.allergens, `${text} must propose ${right}, got [${out.allergens}]`).toContain(right);
      expect(out.allergens, `${text} must NOT propose ${wrong}`).not.toContain(wrong);
    }
  });

  test('and the traps that really are silent stay silent', () => {
    for (const text of ['burro di cacao', 'burro di karite', 'latte di cocco', 'latte di riso',
      'cocoa butter', 'shea butter', 'coconut milk']) {
      expect(read(text).allergens, `${text} must propose nothing`).toStrictEqual([]);
    }
  });

  // ⚠️⚠️ THE MOST DANGEROUS ENTRY IN THE VOCABULARY. Left to the `nocciol` stem, «noccioline» names
  // HAZELNUT — an allergen the pack does not contain — AND misses PEANUTS, which it does.
  test('⚠️⚠️ «noccioline» is PEANUTS, never hazelnut', () => {
    for (const word of ['noccioline', 'noccioline americane']) {
      const out = read(word);
      expect(out.allergens, `${word} must be peanuts`).toContain('peanuts');
      expect(out.allergens, `${word} must NOT be hazelnut`).not.toContain('nuts-hazelnut');
    }
    // And the real hazelnut still works.
    has('nocciole', 'nuts-hazelnut');
  });

  test('⚠️ a negation must not over-suppress — it silences the WORD, not the allergen', () => {
    // «senza lattosio» does NOT mean milk-free: lactose-free milk still carries milk protein.
    const out = read('latte scremato senza lattosio, zucchero');
    expect(out.allergens, 'the milk in the list still counts').toContain('milk');
    // «gluten free» on an oat product does not remove OATS.
    const oats = read('gluten free oats, water');
    expect(oats.allergens, 'the oats are still oats').toContain('gluten-oats');
  });

  test('a whole word, never a fragment', () => {
    hasNot('milkshake-flavoured cornflour', 'gluten-oats');   // no stray "oat" inside
    hasNot('goat meat', 'gluten-oats');
    hasNot('exclamation', 'molluscs');                        // "clam" inside a word
    hasNot('scampi-flavoured crisps'.replace('scampi', 'xxx'), 'crustaceans');
  });

  // ── The questions it must ASK rather than answer ───────────────────────────

  test('⚠️ an ambiguous word is a QUESTION, never a guess', () => {
    const out = read('zucchero, emulsionante: lecitine, aromi');
    expect(out.allergens.length, 'nothing may be ticked from an ambiguous word').toBe(0);
    expect(out.questions.some(q => q.phrase === 'lecitine'), 'it must be raised as a question').toBe(true);
    expect(out.questions.find(q => q.phrase === 'lecitine')?.could).toStrictEqual(['soybeans', 'eggs']);
  });

  test('«lecitina di soia» is NOT ambiguous — the pack said which', () => {
    const out = read('lecitina di soia');
    expect(out.allergens).toContain('soybeans');
    expect(out.questions.length, 'the longer phrase settles it, so nothing is asked').toBe(0);
  });

  test('«albumina» alone is a question, because it is milk OR egg', () => {
    const out = read('albumina');
    expect(out.allergens.length).toBe(0);
    expect(out.questions[0]?.could).toStrictEqual(['milk', 'eggs']);
    // ...while the specific ones are not.
    has('lattoalbumina', 'milk');
    has('ovoalbumina', 'eggs');
  });

  // ── Composition versus traces ──────────────────────────────────────────────

  test('the two lists are never merged, whichever marker the pack uses', () => {
    for (const marker of ['Può contenere tracce di', 'May contain', 'Tracce di',
      'Prodotto in uno stabilimento che utilizza']) {
      const out = read(`Farina di grano, acqua. ${marker} nocciole.`);
      expect(out.allergens, marker).toContain('gluten-wheat');
      expect(out.allergens, `${marker}: a trace is not an ingredient`).not.toContain('nuts-hazelnut');
      expect(out.mayContain, `${marker}: and it must reach the traces`).toContain('nuts-hazelnut');
    }
  });

  test('a code in both halves is an INGREDIENT, not also a trace', () => {
    const out = read('Latte intero, zucchero. Può contenere tracce di latte.');
    expect(out.allergens).toContain('milk');
    expect(out.mayContain, 'buildAllergenFields strips it anyway — stay consistent').not.toContain('milk');
  });

  test('no traces marker means the whole text is composition', () => {
    const { composition, traces } = m.splitTraces('Farina, acqua, sale.');
    expect(composition).toBe('Farina, acqua, sale.');
    expect(traces).toBe('');
  });

  // ── Showing its working ────────────────────────────────────────────────────

  test('⚠️ every match points at the characters it came from', () => {
    const pack = 'Farina di GRANO tenero, LATTE in polvere';
    const out = read(pack);
    expect(out.matches.length).toBeGreaterThanOrEqual(2);
    for (const match of out.matches) {
      const slice = pack.slice(match.from, match.to).toLowerCase();
      expect(slice.length, 'an empty span cannot be shown to anybody').toBeGreaterThan(0);
      expect(match.to, `${match.phrase}: span ${match.from}-${match.to} is inside out`).toBeGreaterThan(match.from);
      expect(match.to, `${match.phrase}: span runs past the end of the text`).toBeLessThanOrEqual(pack.length);
    }
    const wheat = out.matches.find(x => x.code === 'gluten-wheat');
    expect(pack.slice(wheat?.from, wheat?.to), 'the wheat span must cover the word GRANO').toMatch(/GRANO/i);
  });

  test('accents and capitals do not hide a word, and the span still points at the original', () => {
    const pack = 'Purè di patate, PERÒ con LATTE';
    const out = read(pack);
    expect(out.allergens).toContain('milk');
    const hit = out.matches.find(x => x.code === 'milk');
    expect(pack.slice(hit?.from, hit?.to)).toBe('LATTE');
  });

  test('the normaliser keeps one index per surviving character', () => {
    const { norm, map } = m.normaliseWithMap('Farina, acqua');
    expect(norm.length).toBe(map.length);
    expect(norm).toBe('farina acqua');
    expect(map[0]).toBe(0);
  });

  // ── Empty is an honest answer and must look like one ───────────────────────

  test('⚠️ recognising nothing is reported, never left to look like "contains nothing"', () => {
    const out = read('Zucchero, acqua, acido citrico');
    expect(out.allergens).toStrictEqual([]);
    expect(out.recognisedAnything, 'the screen must be able to say it found nothing').toBe(false);
    expect(out.hasText).toBe(true);
  });

  test('no text at all is not the same as text with nothing in it', () => {
    for (const empty of ['', '   ', null, undefined]) {
      const out = read(empty);
      expect(out.allergens).toStrictEqual([]);
      expect(out.hasText, JSON.stringify(empty)).toBe(false);
    }
  });

  test('junk never throws', () => {
    for (const junk of [0, 1, {}, [], true, ' ', 'a'.repeat(5000)]) {
      expect(() => read(junk), String(junk).slice(0, 20)).not.toThrow();
    }
  });

  // ── The vocabulary itself ──────────────────────────────────────────────────

  test('every code in the vocabulary is a real allergen code', () => {
    const known = ALLERGEN_CODES as readonly string[];
    const unknown = Object.keys(TERMS).filter(c => !known.includes(c));
    expect(unknown, 'these would be dropped silently by normalizeAllergens').toStrictEqual([]);
    const remapped = REMAPS.map(r => r.code).filter(Boolean).filter(c => !known.includes(c));
    expect(remapped).toStrictEqual([]);
    const asked = AMBIGUOUS.flatMap(a => a.could).filter(c => !known.includes(c));
    expect(asked).toStrictEqual([]);
  });

  test('all 26 codes have words in BOTH languages', () => {
    // ⚠️ An English bakery buys Italian-labelled packs, so an English-only entry is a silent gap.
    expect(ALLERGEN_CODES.length).toBe(26);
    const missing = ALLERGEN_CODES.filter(code => {
      const t = TERMS[code];
      return !t || !(t.en || []).length || !(t.it || []).length;
    });
    expect(missing, 'these codes cannot be found on a pack in one of the two languages').toStrictEqual([]);
  });

  test('every phrase is already normalised, or it can never match', () => {
    const bad: string[] = [];
    const check = (p: string, where: string): void => {
      if (p !== p.toLowerCase()) bad.push(`${where}: "${p}" is not lowercase`);
      if (/[^a-z0-9 ]/.test(p)) bad.push(`${where}: "${p}" holds a character the normaliser strips`);
      if (p !== p.trim() || /\s\s/.test(p)) bad.push(`${where}: "${p}" has stray spacing`);
    };
    for (const langs of Object.values(TERMS)) {
      for (const lang of ['en', 'it'] as const) for (const p of langs[lang] || []) check(p, 'term');
    }
    for (const p of NEGATIVE_PHRASES) check(p, 'negative');
    for (const r of REMAPS) check(r.phrase, 'remap');
    for (const a of AMBIGUOUS) check(a.phrase, 'ambiguous');
    expect(bad).toStrictEqual([]);
  });

  // ⚠️⚠️ A CATEGORY IS A WARNING THIS APP HAS NO BOX FOR, AND IT MUST NOT PASS IN SILENCE.
  test('⚠️⚠️ a whole-family word is raised, never ticked and never ignored', () => {
    for (const word of ['frutta a guscio', 'tree nuts', 'cereali contenenti glutine']) {
      const out = read(`Zucchero. Può contenere tracce di ${word}.`);
      expect(out.allergens, `${word} must tick nothing`).toStrictEqual([]);
      expect(out.mayContain, `${word} must tick no trace either`).toStrictEqual([]);
      const q = out.questions.find(x => x.phrase === word);
      expect(q, `${word} must be raised as a question`).toBeTruthy();
      expect(q?.kind, `${word} needs the category wording`).toBe('category');
    }
  });

  test('the specific member still wins over its family', () => {
    // «tracce di nocciole» names the nut, so it is a trace and not a question.
    const out = read('Zucchero. Può contenere tracce di nocciole.');
    expect(out.mayContain).toContain('nuts-hazelnut');
    expect(out.questions.length, 'nothing is left to ask').toBe(0);
  });

  test('every ambiguous entry declares which question it is', () => {
    const kinds = new Set(['which', 'vague', 'category']);
    for (const a of AMBIGUOUS) {
      expect(kinds.has(a.kind), `${a.phrase} has no usable kind (${a.kind})`).toBe(true);
      if (a.kind === 'which') expect(a.could.length, `${a.phrase} is a "which" with nothing to choose between`).toBeGreaterThan(0);
      else expect(a.could, `${a.phrase} is a ${a.kind} and must offer no list`).toStrictEqual([]);
    }
  });

  // ⚠️⚠️ «farina» ALONE IS NOT WHEAT, AND IT WAS IN THE VOCABULARY.
  test('⚠️⚠️ a gluten-free flour is never declared as gluten', () => {
    for (const flour of ['farina di riso', 'farina di mais', 'farina di ceci',
      'farina di castagne', 'rice flour', 'chickpea flour', 'cornflour']) {
      const out = read(flour);
      expect(out.allergens.some(c => c.startsWith('gluten')),
        `${flour} must never propose gluten, got [${out.allergens}]`).toBe(false);
    }
    // ...and the qualified wheat forms still do.
    for (const flour of ['farina di grano tenero', 'farina di frumento', 'wheat flour']) {
      has(flour, 'gluten-wheat');
    }
  });

  test('a flour that IS an allergen is still named', () => {
    // ⚠️ The first fix silenced these along with the safe ones.
    has('farina di mandorle', 'nuts-almond');
    has('farina di soia', 'soybeans');
    has('farina di lupino', 'lupin');
    has('almond flour', 'nuts-almond');
  });

  test('«cream of tartar» is not dairy', () => {
    hasNot('cream of tartar', 'milk');
    hasNot('cremor tartaro', 'milk');
    has('double cream', 'milk');
  });

  // ⚠️⚠️ TWO MUTATIONS SURVIVED BECAUSE EVERY TRACES TEST USED «tracce di», WHICH IS ACCENT-FREE.
  test('⚠️⚠️ «Può contenere» alone splits the traces, accent and all', () => {
    const out = read('Farina di grano, zucchero. Può contenere nocciole.');
    expect(out.allergens, 'the wheat is an ingredient').toContain('gluten-wheat');
    expect(out.allergens, 'without the split, a trace is read as an ingredient').not.toContain('nuts-hazelnut');
    expect(out.mayContain, 'and it must reach the traces').toContain('nuts-hazelnut');
  });

  test('⚠️ an accent never hides a word, in the text OR in a marker', () => {
    const { norm } = m.normaliseWithMap('PERÒ Può È À');
    expect(norm, 'accents must fold away').toBe('pero puo e a');
    expect(read('Zucchero. Può contenere sedano.').mayContain).toContain('celery');
  });

  test('the English markers work on their own too', () => {
    const out = read('Wheat flour, sugar. May contain hazelnuts.');
    expect(out.allergens).toContain('gluten-wheat');
    expect(out.mayContain).toContain('nuts-hazelnut');
    expect(out.allergens).not.toContain('nuts-hazelnut');
  });

  // ── Who owns each tick, once the suggestion runs by itself ─────────────────
  //
  // ⚠️⚠️ THE RULE UNDER ALL OF IT: THE APP MAY TAKE BACK ONLY WHAT THE APP PUT THERE.

  const noTicks = () => ({ contains: [] as string[], may: [] as string[] });

  test('it ticks what the pack says, and remembers that it was the one who did', () => {
    const out = m.reconcileTicks({
      proposal: { allergens: ['milk'], mayContain: ['nuts-hazelnut'] },
      current: noTicks(), appOwned: new Set(), humanTouched: new Set(),
    });
    expect(out.contains).toStrictEqual(['milk']);
    expect(out.may).toStrictEqual(['nuts-hazelnut']);
    expect(out.added).toBe(2);
    expect(out.removed).toBe(0);
    expect(out.appOwned.has(m.tickKey('milk', 'contains'))).toBe(true);
    expect(out.appOwned.has(m.tickKey('nuts-hazelnut', 'may'))).toBe(true);
  });

  // ⚠️⚠️ THE CASE THE WHOLE DESIGN IS FOR. Without this the app would declare milk in an
  // almond-milk product for ever, and nothing on screen would say why.
  test('⚠️⚠️ «latte» then «latte di mandorla»: the app takes its own tick back', () => {
    const first = m.reconcileTicks({
      proposal: m.readPackIngredients('latte'),
      current: noTicks(), appOwned: new Set(), humanTouched: new Set(),
    });
    expect(first.contains, 'the first read must tick milk').toContain('milk');

    const second = m.reconcileTicks({
      proposal: m.readPackIngredients('latte di mandorla'),
      current: { contains: first.contains, may: first.may },
      appOwned: first.appOwned, humanTouched: new Set(),
    });
    expect(second.contains.includes('milk'), 'the text no longer says milk, and the app put that tick there').toBe(false);
    expect(second.contains, 'and almonds are what it does say').toContain('nuts-almond');
    expect(second.removed).toBe(1);
  });

  // ⚠️ A PERSON KNOWS THINGS THE PACK DOES NOT PRINT.
  test('⚠️ a tick a PERSON made survives any change to the text', () => {
    const out = m.reconcileTicks({
      proposal: m.readPackIngredients('farina di grano tenero'),
      current: { contains: ['celery'], may: [] },
      appOwned: new Set(),                       // nobody's but the person's
      humanTouched: new Set([m.tickKey('celery', 'contains')]),
    });
    expect(out.contains, 'a hand-made declaration is untouchable').toContain('celery');
    expect(out.removed).toBe(0);
  });

  // ⚠️ AND THE OTHER DIRECTION: clearing a wrong suggestion has to STICK.
  test('⚠️ a suggestion a person CLEARS is never proposed again', () => {
    const first = m.reconcileTicks({
      proposal: m.readPackIngredients('latte'),
      current: noTicks(), appOwned: new Set(), humanTouched: new Set(),
    });
    expect(first.contains).toContain('milk');

    // The person unticks it: the form drops it from appOwned and records the touch.
    const owned = new Set(first.appOwned);
    owned.delete(m.tickKey('milk', 'contains'));

    const second = m.reconcileTicks({
      proposal: m.readPackIngredients('latte'),          // the text still says milk
      current: { contains: [], may: [] },
      appOwned: owned,
      humanTouched: new Set([m.tickKey('milk', 'contains')]),
    });
    expect(second.contains.includes('milk'), 'it must not come back').toBe(false);
    expect(second.added).toBe(0);
  });

  // ⚠️⚠️ OPENING A SAVED PRODUCT AND TYPING MUST NOT LOSE A DECLARATION.
  test('⚠️⚠️ ticks loaded from the stored ingredient are the person’s, always', () => {
    const stored = { contains: ['eggs', 'milk'], may: ['sesame'] };
    const out = m.reconcileTicks({
      proposal: m.readPackIngredients('zucchero, acqua'),   // says none of them
      current: stored, appOwned: new Set(), humanTouched: new Set(),
    });
    expect([...out.contains].sort()).toStrictEqual(['eggs', 'milk']);
    expect(out.may).toStrictEqual(['sesame']);
    expect(out.removed).toBe(0);
  });

  test('a trace is dropped when the same allergen is declared outright', () => {
    const out = m.reconcileTicks({
      proposal: { allergens: ['milk'], mayContain: ['milk'] },
      current: noTicks(), appOwned: new Set(), humanTouched: new Set(),
    });
    expect(out.contains).toStrictEqual(['milk']);
    expect(out.may, 'buildAllergenFields would strip it on save anyway').toStrictEqual([]);
  });

  test('an empty pack proposes nothing and removes nothing a person made', () => {
    const out = m.reconcileTicks({
      proposal: m.readPackIngredients(''),
      current: { contains: ['fish'], may: [] },
      appOwned: new Set(), humanTouched: new Set(),
    });
    expect(out.contains).toStrictEqual(['fish']);
    expect(out.added).toBe(0);
    expect(out.removed).toBe(0);
  });

  // ⚠️ THE PROPERTY THAT MAKES ALL OF THE ABOVE INERT: nothing in this file stamps anything.
  test('⚠️ reconciling ticks never produces a verification stamp', () => {
    const out = m.reconcileTicks({
      proposal: m.readPackIngredients('latte, uova, farina di grano'),
      current: noTicks(), appOwned: new Set(), humanTouched: new Set(),
    });
    expect('checkedAt' in out).toBe(false);
    expect('allergensCheckedAt' in out).toBe(false);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('a reading has the same fields, in the same order, with and without text', () => {
    const fields = ['allergens', 'mayContain', 'questions', 'matches', 'recognisedAnything', 'hasText'];
    expect(Object.keys(read('latte'))).toStrictEqual(fields);
    expect(Object.keys(read(null))).toStrictEqual(fields);
    expect(Object.keys(read('latte').matches[0] ?? {})).toStrictEqual(['code', 'phrase', 'from', 'to', 'traces']);
  });

  test('the reconciliation gives back new lists and sets, never its inputs', () => {
    const current = { contains: ['eggs'], may: ['sesame'] };
    const appOwned = new Set<string>();
    const out = m.reconcileTicks({ proposal: m.readPackIngredients('latte'), current, appOwned, humanTouched: new Set() });
    expect(out.contains).not.toBe(current.contains);
    expect(out.appOwned).not.toBe(appOwned);
    expect(current).toStrictEqual({ contains: ['eggs'], may: ['sesame'] });
    expect(appOwned.size).toBe(0);
  });
});
