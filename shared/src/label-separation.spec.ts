// The interface language must never reach a label — for the pure TypeScript ports (parity doc items 55 and 110e).
// The app-side guard (the screens that draw a label) comes with the screens.
//
// ⚠️⚠️ THIS IS THE ONE THAT PROTECTS SOMEBODY. An allergen label is a legal document. Retained Reg. (EU)
// 1169/2011 requires it to be in a language understood where the food is SOLD — so the words on it are decided
// by the venue's COUNTRY (market.ts) and by nothing else. The interface language is a preference: what the staff
// read on screen. Federico's own venues are the case that makes this real: they are in England and he is
// Italian — he wants the app in Italian and his labels MUST stay in English. The moment somebody wires the
// dictionary into the label code, setting the interface to Italian starts printing Italian allergen labels for
// food sold in the United Kingdom, and it would look like the feature working.
//
// ⚠️ A COMMENT SAYING "DO NOT DO THIS" IS NOT A GUARD. A rule that matters more than a behaviour is pinned by a
// test that NAMES it when broken, because a rule that lives only in a comment comes back. This file reads the
// SOURCE TEXT of the three pure modules that decide what a label says. It is a port of
// tests/i18n-label-separation.test.mjs (the model half) and of the source-text checks of tests/market.test.mjs
// ('holds words, never sentences', 'no label file uses a group heading', 'the copied text is in the same
// language as the label on screen') and tests/recipe-declaration.test.mjs ('the INGREDIENT NAMES are the
// venue's own words').

import { describe, expect, test } from 'vitest';
import marketSource from './market.ts?raw';
import recipeLabelSource from './recipe-label-model.ts?raw';
import recipeAllergenSource from './recipe-allergen-model.ts?raw';
import { stringsIn } from '../../tests/helpers/strings-in.mjs';

// The glob is typed by Vite's client types, which this package does not load (it has no DOM).
declare global {
  interface ImportMeta {
    glob<T>(pattern: string, options: { query: string; import: string; eager: true }): Record<string, T>;
  }
}
const everySource = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true });

// Everything that decides what a label SAYS and is pure. Adding a file to the label chain means adding it
// here — and if that is forgotten, 'every file that builds a label word is on the list' says so.
const LABEL_FILES: Readonly<Record<string, string>> = {
  'market.ts': marketSource,
  'recipe-label-model.ts': recipeLabelSource,
  'recipe-allergen-model.ts': recipeAllergenSource,
};

// The source without its comments: explaining the rule in prose is exactly where a forbidden word belongs.
const codeOf = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the label files do not know the interface exists', () => {
  test('they import nothing from app/ and nothing that is a dictionary', () => {
    for (const [file, source] of Object.entries(LABEL_FILES)) {
      const imports = [...codeOf(source).matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1] as string);
      expect(imports.length, `${file}: the scan must find its imports, or it guards nothing`).toBeGreaterThan(0);
      for (const target of imports) {
        expect(target, `${file} imports ${target}`).not.toMatch(/(^|\/)app(\/|$)/);
        expect(target, `${file} imports ${target}: a label builds what it SAYS and has no reason to know what is on screen`)
          .not.toMatch(/i18n|dictionar|messages|locale/i);
        expect(target, `${file} imports ${target}: shared/ stays inside shared/`).toMatch(/^\.\/[a-z-]+$|^\.\/fixtures\//);
      }
    }
  });

  test('no label file can reach the interface language', () => {
    for (const [file, source] of Object.entries(LABEL_FILES)) {
      const code = codeOf(source);
      expect(code, `${file} must never ask what language the SCREEN is in — a label follows the country`).not.toMatch(/\bcurrentLanguage\b/);
      expect(code, `${file} must never change the interface language`).not.toMatch(/\bsetLanguage\b/);
      expect(code, `${file} must never take a language from the device`).not.toMatch(/\blanguageFromTag\b/);
      expect(code, `${file} must never read the venue's interface setting`).not.toMatch(/\binterfaceLanguage\b/);
    }
  });

  test('and they never call the dictionary’s lookup either', () => {
    for (const [file, source] of Object.entries(LABEL_FILES)) {
      expect(codeOf(source), `${file}: t() is the interface's lookup`).not.toMatch(/(?<![.\w])t\(\s*['"`]/);
    }
  });

  // ⚠️ THE GUARD ITSELF IS PROVED TO FIRE: a scan that reads nothing passes everything.
  test('the scans can actually see a violation', () => {
    const bad = `import { t } from '../app/i18n/messages';\nconst lang = currentLanguage();\n// setLanguage in a comment is fine\n`;
    const imports = [...codeOf(bad).matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
    expect(imports).toStrictEqual(['../app/i18n/messages']);
    expect(codeOf(bad)).toMatch(/\bcurrentLanguage\b/);
    expect(codeOf(bad)).not.toMatch(/\bsetLanguage\b/);
    expect(codeOf(`const x = t('cat.cost.cycle');`)).toMatch(/(?<![.\w])t\(\s*['"`]/);
    // The real files have comments that name the dictionary and the interface; those must not trip the scan.
    expect(marketSource).toMatch(/dictionary/);
  });
});

describe('the label words are chosen in one place', () => {
  // ⚠️ A GROUP HEADING IS FOR READING, NEVER FOR A LABEL. A label must name the specific cereal and nut —
  // "Wheat", not "cereals containing gluten".
  test('no label file uses a group heading', () => {
    for (const file of ['recipe-label-model.ts', 'recipe-allergen-model.ts']) {
      expect(codeOf(LABEL_FILES[file] as string), `${file} must name the specific allergen, never its group`)
        .not.toMatch(/allergenGroupName|allergenGroupCodes/);
    }
  });

  // ⚠️ THE INGREDIENT NAMES ARE TYPED BY HAND AND THE APP NEVER TRANSLATES THEM. A plausible wrong word on a
  // legal document is worse than a foreign right one.
  test('nothing puts an ingredient NAME through a translation table', () => {
    const code = codeOf(recipeLabelSource);
    expect(code).not.toMatch(/allergenName\(item|translate|allergenName\(.*\.name/);
    expect(code.length, 'the scan must be reading the file').toBeGreaterThan(2000);
  });

  // ⚠️ THE COPIED TEXT IS THE LABEL. Whatever is pasted onto packaging comes from declarationText, so an English
  // copy on Italian packaging would arrive through the one door nobody thought of. The language rule is checked
  // where the text is BUILT.
  test('the declaration text asks the label’s language for every word, and hard-codes none', () => {
    const start = recipeLabelSource.indexOf('export function declarationText(');
    expect(start, 'declarationText must exist to be guarded').not.toBe(-1);
    const body = recipeLabelSource.slice(start, recipeLabelSource.indexOf('\n}', start));
    // ⚠️ PROVE THE SLICE IS REAL. A version of this test once sliced from an indexOf that had become -1, which
    // silently handed the whole file to the assertions.
    expect(body.length, 'the slice must actually contain the function').toBeGreaterThan(200);
    expect(body).toMatch(/labelWord\('ingredients', lang\)/);
    expect(body).toMatch(/containsLine\(label, lang\)/);
    expect(body).toMatch(/mayContainLine\(label, lang\)/);
    expect(body).toMatch(/nutrientName\(n, lang\)/);
    expect(body).toMatch(/labelWord\('typicalValues', lang\)/);
    expect(body, 'no English left hard-coded in the copied label').not.toMatch(/'Ingredients: '|'Typical values|'May contain:/);
  });

  test('every food word in the label model is asked in a language that was handed in', () => {
    const calls = [...codeOf(recipeLabelSource).matchAll(/\b(labelWord|allergenName|nutrientName)\s*\(([^)]*)\)/g)];
    expect(calls.length, 'the label model builds food words').toBeGreaterThanOrEqual(8);
    for (const call of calls) {
      const args = (call[2] as string).split(',').map(arg => arg.trim());
      expect(args[args.length - 1], `${call[1]}(${call[2]}) must be asked in the LABEL's language`).toBe('lang');
    }
  });

  // The label model is handed `lang`; it never derives one. (The screens derive it from the venue's country.)
  test('the label model never works the language out for itself', () => {
    expect(codeOf(recipeLabelSource)).not.toMatch(/outputLanguage|countryOf/);
  });
});

describe('market.ts holds words, never sentences', () => {
  // ⚠️ THE FIRST VERSION OF THE CHECK THIS IS A PORT OF GUARDED NOTHING: it used a regex that pairs the CLOSING
  // quote of one string with the OPENING quote of the next, so every «match» was the CODE in between (see
  // tests/helpers/strings-in.mjs). A deliberate English sentence added to the file sailed straight past it.
  const sentencesIn = (source: string): string[] => {
    const found: string[] = [];
    source.split(/\r?\n/).forEach((line, index) => {
      for (const literal of stringsIn(line) as string[]) {
        if (literal.length < 25) continue;
        if (/\b(the|this|that|because|and|is|are|not|you|which|when)\b/i.test(literal)) {
          found.push(`market.ts:${index + 1}  ${literal.slice(0, 80)}`);
        }
      }
    });
    return found;
  };

  test('so the file may stay without the dictionary', () => {
    expect(sentencesIn(marketSource),
      'these are read by a person and cannot be translated from here — market.ts may not import the dictionary, so '
      + 'a sentence in it is a sentence stuck in English').toStrictEqual([]);
  });

  test('and that check can actually see a sentence in a file', () => {
    expect(sentencesIn(`export const NOTE = 'This label is produced in the language of the country.';`)).toHaveLength(1);
    expect(stringsIn("  const a = 'GB'; const somethingVeryLongIndeed = 'IT';"),
      'a quote must pair with its own closing quote, never with the next string’s opening one').toStrictEqual(['GB', 'IT']);
  });
});

describe('the list of label files is complete', () => {
  // The same asking-the-app-not-trusting-the-list idea as the original: any shared module that calls a
  // label-word function builds what a label says, so it must be held to these rules too.
  test('every file that builds a label word is on the list', () => {
    const callers = Object.entries(everySource)
      .filter(([path]) => !path.endsWith('.spec.ts'))
      .filter(([, source]) => /\b(labelWord|allergenName|allergenGroupName|nutrientName)\s*\(/.test(codeOf(source)))
      .map(([path]) => path.replace('./', ''))
      .sort();
    expect(callers.length, 'the glob must find the sources').toBeGreaterThan(0);
    for (const file of callers) {
      expect(Object.keys(LABEL_FILES), `${file} builds label words and is not guarded`).toContain(file);
    }
  });
});
