// The Calculator speaks in WHOLE SENTENCES, in every language the app knows.
//
// A review found English that bypassed t() in the Calculator — «Only 4 …», « log»,
// « divisor», «Client», «Created», «Edited», « products. Reassign or delete them in
// Settings → Products first.» — so an Italian venue read half-English messages. The
// neighbouring keys were glued too: 'Delete the ' + name + ' recipe?' cannot be
// translated, because Italian puts the words in another order (see the comment above
// the dictionaries in js/i18n.js). Each one is now one entry with a hole in it.
//
// This file pins three things: the new keys exist in EVERY dictionary with the same
// holes; the retired fragment keys are gone, so nobody glues a sentence back out of
// them; and the Calculator files no longer carry the English literals that were found.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _dictionaries, t, setLanguage, currentLanguage } from '../js/i18n.js';
import { createLog, dayLabel } from '../js/log-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DICTS = _dictionaries();

function withLanguage(lang, fn) {
  const before = currentLanguage();
  try { setLanguage(lang); fn(); } finally { setLanguage(before); }
}

// key → the holes the sentence must carry. `plural: true` = picked by Intl.PluralRules.
const NEW_KEYS = {
  'calc.recipesIntro': { holes: ['n'], plural: true },
  'calc.recipeUsedByProducts': { holes: ['n'], plural: true },
  'calc.deleteRecipeNamed': { holes: ['name'] },
  'calc.deleteThisRecipe': { holes: [] },
  'calc.tooManyVisibleRecipes': { holes: ['n'], plural: true },
  'calc.showAsTabMax': { holes: ['n'] },
  'calc.deleteLogNamed': { holes: ['dough'] },
  'calc.deleteThisLog': { holes: [] },
  'calc.restoredFromVersion': { holes: ['v'] },
  'calc.versionCreated': { holes: [] },
  'calc.versionEdited': { holes: [] },
  'calc.logTitle': { holes: ['dough'] },
  'calc.byName': { holes: ['name'] },
  'calc.doughTitle': { holes: ['name'] },
  'calc.gramsRaw': { holes: ['g'] },
  'calc.divisorTitle': { holes: ['recipe'] },
  'calc.dayMadeFor': { holes: ['made', 'target'] },
  'calc.logEditHistory': { holes: ['dough'] },
  'calc.logDurationForRecipe': { holes: ['name'] },
  'calc.logKeepHours': { holes: ['n'], plural: true },
  'calc.extraLineN': { holes: ['i'] },
  'calc.unnamedClient': { holes: [] },
};

const RETIRED_FRAGMENTS = [
  'calc.yourRecipesTheBase', 'calc.canShowAsCalculator', 'calc.thisRecipeIsUsed',
  'calc.deleteThe', 'calc.recipe', 'calc.recipesCanShowAs', 'calc.showAsACalculator',
  'calc.deleteThis', 'calc.logThisCannotBe', 'calc.restoredFromV', 'calc.editHistory',
  'calc.logDurationFor', 'calc.extraLine',
];

const holesOf = (text) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('the dictionaries under test include English and Italian', () => {
  assert.ok(DICTS.en && DICTS.it);
});

for (const [lang, dict] of Object.entries(DICTS)) {
  for (const [key, spec] of Object.entries(NEW_KEYS)) {
    test(`${lang}: ${key} is a whole sentence with holes ${JSON.stringify(spec.holes)}`, () => {
      const entry = dict[key];
      assert.ok(entry !== undefined, `${key} missing from ${lang}`);
      const forms = spec.plural ? [entry.one, entry.other] : [entry];
      if (spec.plural) assert.equal(typeof entry, 'object', `${key} must carry one/other in ${lang}`);
      for (const text of forms) {
        assert.equal(typeof text, 'string', `${key} in ${lang}`);
        assert.deepEqual(holesOf(text), [...spec.holes].sort(), `${key} in ${lang}: «${text}»`);
        // A fragment begins or ends in a space so the caller can glue on a value.
        assert.equal(text, text.trim(), `${key} in ${lang} looks like a fragment: «${text}»`);
      }
    });
  }

  test(`${lang}: the glued fragment keys are gone`, () => {
    for (const key of RETIRED_FRAGMENTS) assert.equal(dict[key], undefined, `${key} still in ${lang}`);
  });
}

test('Italian: the messages from the review read as Italian sentences', () => {
  withLanguage('it', () => {
    assert.equal(t('calc.recipeUsedByProducts', { n: 1 }),
      'Questa ricetta è usata da 1 prodotto. Prima collegalo a un’altra ricetta o eliminalo in Impostazioni → Clienti.');
    assert.match(t('calc.recipeUsedByProducts', { n: 3 }), /^Questa ricetta è usata da 3 prodotti\./);
    assert.equal(t('calc.tooManyVisibleRecipes', { n: 4 }),
      'Solo 4 ricette possono comparire come linguette insieme. Nascondine prima un’altra.');
    assert.equal(t('calc.deleteRecipeNamed', { name: 'Focaccia' }), 'Vuoi eliminare la ricetta Focaccia?');
    assert.equal(t('calc.divisorTitle', { recipe: 'Pizza' }), 'Divisore di Pizza');
    assert.equal(t('calc.logTitle', { dough: 'Pizza' }), 'Registro di Pizza');
    assert.equal(t('calc.versionCreated'), 'Creata');
    assert.equal(t('calc.versionEdited'), 'Modificata');
    assert.equal(t('calc.unnamedClient'), 'Cliente senza nome');
    assert.equal(t('calc.logKeepHours', { n: 24 }), '24 ore');
  });
});

test('English: the same messages keep their wording, with the right screen named', () => {
  withLanguage('en', () => {
    assert.equal(t('calc.recipeUsedByProducts', { n: 1 }),
      'This recipe is used by 1 product. Reassign or delete it in Settings → Clients first.');
    assert.equal(t('calc.recipeUsedByProducts', { n: 2 }),
      'This recipe is used by 2 products. Reassign or delete them in Settings → Clients first.');
    assert.equal(t('calc.tooManyVisibleRecipes', { n: 4 }), 'Only 4 recipes can show as tabs at once. Hide another first.');
    assert.equal(t('calc.deleteRecipeNamed', { name: 'Focaccia' }), 'Delete the Focaccia recipe?');
    assert.equal(t('calc.logTitle', { dough: 'Pizza' }), 'Pizza log');
    assert.equal(t('calc.logKeepHours', { n: 1 }), '1 hour');
  });
});

test('Italian: the log day badge is one sentence, with the second day in its in-sentence form', () => {
  const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
  const version = { sheet: { dough: 'Focaccia' }, items: [], occasional: [], calculatedBy: '', at: {}, kind: 'create' };
  const log = createLog({ id: 'x', dough: 'Focaccia', forDay: 'tomorrow', version, createdAtMs: at(2026, 7, 12) });
  withLanguage('it', () => {
    assert.equal(dayLabel(log, at(2026, 7, 12, 20)).text, 'Oggi per domani');
    assert.equal(dayLabel(log, at(2026, 7, 13, 8)).text, 'Ieri per oggi');
  });
});

// The English literals the review found, as they were written at the call sites.
// Whole-line comments are stripped: a comment explaining the fix may quote them.
const FILES = [
  'js/recipes.js', 'js/calculator-settings.js', 'js/log-edit.js', 'js/log-add.js', 'js/log.js',
  'js/log-view.js', 'js/log-settings.js', 'js/log-model.js', 'js/calc.js', 'js/calculator-render.js',
  'js/calculator-whatsapp-settings.js', 'js/calculator-client-orders.js',
];
const FOUND_LITERALS = [
  "'Only '", "' product'", "' products'", "Settings → Products", "|| 'this'", "' divisor'",
  "' log'", "'Created'", "'Edited'", "' dough'", "' g raw'", "' hours'", "' for '", "'by '",
];

test('the Calculator files no longer carry the English literals the review found', () => {
  for (const file of FILES) {
    const code = readFileSync(join(ROOT, file), 'utf8').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const literal of FOUND_LITERALS) {
      assert.ok(!code.includes(literal), `${file} still contains ${literal}`);
    }
  }
});

// «Client» as a screen fallback: only the saved log TEXT (buildLogText, written into the
// stored record) and the config normaliser (a stored default name) may keep it.
test('«Client» is never a fallback drawn on screen in the Calculator', () => {
  const allowed = new Set(['js/log-model.js']);
  for (const file of FILES) {
    if (allowed.has(file)) continue;
    const code = readFileSync(join(ROOT, file), 'utf8').replace(/^[ \t]*\/\/.*$/gm, '');
    assert.ok(!code.includes("|| 'Client'"), `${file} still draws 'Client'`);
    assert.ok(!code.includes(": 'Client'"), `${file} still draws 'Client'`);
  }
});
