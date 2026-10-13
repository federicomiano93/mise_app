import { describe, expect, test } from 'vitest';

// The interface language must never reach a word that names a FOOD — the app side of the guard (parity doc items 54,
// 55 and 110e; shared/src/label-separation.spec.ts guards the pure modules).
//
// ⚠️⚠️ THIS IS THE ONE THAT PROTECTS SOMEBODY. An allergen declaration is a legal document: the words on it are the
// language of the venue's COUNTRY (`outputLanguage`), not the language the staff chose for the screen. A British
// bakery run by an Italian reads the app in Italian and must still print «Wheat». The moment a screen hands the
// interface language to `allergenName`, switching the app to Italian starts printing Italian allergens for food sold
// in the United Kingdom — and it looks like the feature working.
//
// ⚠️ A COMMENT SAYING «DO NOT DO THIS» IS NOT A GUARD. This reads the SOURCE TEXT of every app file:
//   - a file that calls a label-word function is on an explicit list (so a new screen that prints food words cannot
//     slip in unnoticed — adding one means adding it here, on purpose);
//   - every file on the list asks the venue's COUNTRY (`const lang = outputLanguage(…)`), and every label-word call
//     passes that `lang` as its last argument;
//   - none of them reaches for the interface language, in any of the ways the app has of holding it.
const sources = import.meta.glob<string>('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

// Every app file that draws a food word, and why it is allowed to. Adding a screen that prints allergens, nutrients
// or the label's own words means adding it here.
const LABEL_FILES: readonly string[] = [
  './recipes/AllergenCard.tsx', // what a recipe contains, on the recipe screen
  './recipes/DeclarationCard.tsx', // the ingredient declaration: Contains / May contain, and the text sent or copied
  './recipes/AllergenSheet.tsx', // the law card (the fourteen groups) and what each recipe contains
];

// The functions that put a food word, or a word of the label, in front of somebody. All but `ingredientLine` take the
// output language: as their last argument, except `declarationText(label, lang, options)`, where it is the second.
const LABEL_WORDS = [
  'allergenName', 'allergenGroupName', 'allergenGroupCodes', 'labelWord', 'nutrientName',
  'containsLine', 'mayContainLine', 'declarationText', 'ingredientLine',
] as const;
const TAKE_NO_LANGUAGE: readonly string[] = ['ingredientLine'];
const LANGUAGE_IS_SECOND: readonly string[] = ['declarationText'];

// The source without its comments and string literals: explaining the rule in prose is exactly where a forbidden word
// belongs, and a sentence that mentions a function is not a call of it.
const codeOf = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// Every call of a label-word function in the code, with the text of its arguments (parentheses balanced).
function callsIn(code: string): Array<{ name: string; args: string[] }> {
  const calls: Array<{ name: string; args: string[] }> = [];
  const pattern = new RegExp(`(?<![\\w.])(${LABEL_WORDS.join('|')})\\s*\\(`, 'g');
  for (const match of code.matchAll(pattern)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const args: string[] = [];
    let current = '';
    while (index < code.length && depth > 0) {
      const char = code[index] ?? '';
      if ('([{'.includes(char)) depth += 1;
      if (')]}'.includes(char)) depth -= 1;
      if (depth === 0) break;
      if (char === ',' && depth === 1) { args.push(current.trim()); current = ''; } else { current += char; }
      index += 1;
    }
    if (current.trim() !== '') args.push(current.trim());
    calls.push({ name: match[1] ?? '', args });
  }
  return calls;
}

// Every way the app has of holding the interface language: the hook's `lang` and `locale`, the context, the
// loaders and the type. A label file may use the hook for `t` and nothing else of it.
const INTERFACE_LANGUAGE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\{[^}]*\b(lang|locale)\b[^}]*\}\s*=\s*useT\s*\(\s*\)/, 'takes lang or locale from useT()'],
  [/\buseT\s*\(\s*\)\s*\.\s*(lang|locale)\b/, 'reads lang or locale off useT()'],
  [/\bI18nContext\b/, 'reads the i18n context'],
  [/\buseContext\b/, 'reads a context'],
  [/\b(setLanguage|pickLanguage|loadLanguage|localeOf|languageFromTag|currentLanguage|interfaceLanguage)\b/, 'touches the interface language'],
  [/from\s+['"][^'"]*\/i18n\/(i18n|I18nContext|I18nProvider)['"]/, 'imports the language machinery'],
  [/\bdocument\.documentElement\.lang\b|\bnavigator\.language\b/, 'reads the device\'s language'],
];

// What is wrong with one file that draws food words (an empty list: nothing).
function problemsIn(file: string, source: string): string[] {
  const code = codeOf(source);
  const problems: string[] = [];
  if (!/\bconst\s+lang\s*=\s*outputLanguage\s*\(/.test(code)) {
    problems.push(`${file}: has no «const lang = outputLanguage(…)» — the food words would not follow the venue's country`);
  }
  const calls = callsIn(code);
  if (calls.length === 0) problems.push(`${file}: is on the list but calls no label-word function — take it off the list`);
  for (const { name, args } of calls) {
    if (TAKE_NO_LANGUAGE.includes(name)) continue;
    const passed = LANGUAGE_IS_SECOND.includes(name) ? args[1] : args.at(-1);
    if (passed !== 'lang') {
      problems.push(`${file}: ${name}(${args.join(', ')}) does not pass the country's «lang» as its language argument`);
    }
  }
  for (const [pattern, why] of INTERFACE_LANGUAGE) {
    if (pattern.test(code)) problems.push(`${file}: ${why} — a label follows the COUNTRY, never the screen`);
  }
  return problems;
}

describe('the interface language never reaches a food word', () => {
  test('the scan finds the app\'s files and the label files among them', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    for (const file of LABEL_FILES) expect(Object.keys(sources), `${file} must exist`).toContain(file);
  });

  test('every app file that calls a label-word function is on the list, and no file on it stopped calling one', () => {
    const calling = Object.entries(sources)
      .filter(([file]) => !/\.spec\.tsx?$/.test(file))
      .filter(([, source]) => callsIn(codeOf(source)).length > 0)
      .map(([file]) => file)
      .sort();
    expect(calling).toEqual([...LABEL_FILES].sort());
  });

  test('every file on the list asks the venue\'s country, passes it to every call, and holds no interface language', () => {
    const problems = LABEL_FILES.flatMap(file => problemsIn(file, sources[file] ?? ''));
    expect(problems).toEqual([]);
  });

  // ⚠️ THE SCANNER MUST BE SHOWN TO FIND WHAT IT GUARDS, or a green result means nothing.
  test('and the scan itself finds each way of getting it wrong', () => {
    const good = 'const lang = outputLanguage(location);\nconst a = allergenName(code, lang);\nconst b = ingredientLine(label);';
    expect(problemsIn('good.tsx', good)).toEqual([]);

    expect(problemsIn('a.tsx', good.replace('outputLanguage(location)', "'en'"))).toEqual([
      expect.stringContaining('has no «const lang = outputLanguage('),
    ]);
    expect(problemsIn('b.tsx', `${good}\nconst c = allergenName(code, locale);`)).toEqual([
      expect.stringContaining('allergenName(code, locale) does not pass'),
    ]);
    expect(problemsIn('c.tsx', `const { t, lang } = useT();\n${good}`)).toEqual([
      expect.stringContaining('takes lang or locale from useT()'),
    ]);
    expect(problemsIn('d.tsx', `const { locale } = useT();\n${good}`)).toEqual([
      expect.stringContaining('takes lang or locale from useT()'),
    ]);
    expect(problemsIn('e.tsx', `${good}\nconst x = useContext(I18nContext);`)).toHaveLength(2);
    expect(problemsIn('f.tsx', `${good}\nconst c = declarationText(label, { withNutrition: false });`)).toEqual([
      expect.stringContaining('declarationText('),
    ]);
    expect(problemsIn('g.tsx', 'const lang = outputLanguage(location);')).toEqual([
      expect.stringContaining('calls no label-word function'),
    ]);
    expect(problemsIn('f2.tsx', `${good}\nconst c = declarationText(label, lang, { withNutrition: false });`)).toEqual([]);
    expect(problemsIn('f3.tsx', `${good}\nconst c = declarationText(label, locale, { withNutrition: false });`)).toEqual([
      expect.stringContaining('declarationText('),
    ]);
    // A mention in a comment is not a call, and not a violation.
    expect(problemsIn('h.tsx', `// not useT().lang, nor allergenName(code, locale)\n${good}`)).toEqual([]);
    // A call nested in another call is still found, with its arguments whole.
    expect(callsIn('x(allergenName(code, lang), 2)')).toEqual([{ name: 'allergenName', args: ['code', 'lang'] }]);
  });
});
