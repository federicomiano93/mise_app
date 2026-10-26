import { describe, expect, test } from 'vitest';
import * as allergenModel from '@mise/shared/allergen-model';
import * as labelModel from '@mise/shared/recipe-label-model';
import * as market from '@mise/shared/market';
import * as imageLayout from '@mise/shared/label-image-layout';
import * as textCheck from '@mise/shared/label-text-check';
import * as haccpLabel from '@mise/shared/haccp-label';

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
//   - none of them reaches for the interface language, in any of the ways the app has of holding it;
//   - the door cannot be walked round: a file that imports a VALUE from the three label modules must be on the list or
//     use only names that are not food words (an allowlist, each name justified); `import * as` and `as` renames are
//     forbidden (they would hide a call from the scan); and in a listed file `lang` is declared once, from
//     `outputLanguage(`, and never assigned, destructured or taken as a parameter.
const sources = import.meta.glob<string>('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

// Every app file that draws a food word, and why it is allowed to. Adding a screen that prints allergens, nutrients
// or the label's own words means adding it here.
const LABEL_FILES: readonly string[] = [
  './recipes/AllergenCard.tsx', // what a recipe contains, on the recipe screen
  './recipes/DeclarationCard.tsx', // the ingredient declaration: Contains / May contain, and the text sent or copied
  './recipes/AllergenSheet.tsx', // the law card (the fourteen groups) and what each recipe contains
  './recipes/LabelScreen.tsx', // the label screen: the refusals, the notes, the date, Copy and Send (the text of the whole label)
  './recipes/HaccpLabelBody.tsx', // the HACCP label: its captions and values in the country's words, the allergens' names
  './recipes/ImageLabelBody.tsx', // the «with logo» image label: PRODOTTO IL, the allergen name in the text check, the typed ingredients
  './recipes/LabelCard.tsx', // the label as words: the ingredients, Contains, May contain and the nutrition table
  './records/AllergenSections.tsx', // the ingredient card's allergen rows, their group headings and the nutrient names, where an allergen is DECLARED
];

// The functions that put a food word, or a word of the label, in front of somebody. All but `ingredientLine` take the
// output language: as their last argument, except `declarationText(label, lang, options)`, where it is the second.
//
// `allergenLabel`, `allergenWordIt` and `nutrientWordIt` return a food word in ONE FIXED language (English, Italian,
// Italian) and take no language: a screen calling them would print that language whatever the country says. They are
// on the list so that any call is found, and they are never allowed to be called (NEVER_CALLED).
const LABEL_WORDS = [
  'allergenName', 'allergenGroupName', 'allergenGroupCodes', 'labelWord', 'nutrientName',
  'containsLine', 'mayContainLine', 'declarationText', 'ingredientLine',
  'allergenLabel', 'allergenWordIt', 'nutrientWordIt',
  // «PRODOTTO IL:» / «PRODUCED ON:» of the image label: a label word, the language last.
  'producedOnWord',
  // The HACCP label's captions («Preparato il», «Lotto»…) and its content (captions + the allergens' names): the language last.
  'haccpCaption', 'haccpContent',
] as const;
const NEVER_CALLED: readonly string[] = ['allergenLabel', 'allergenWordIt', 'nutrientWordIt'];
const TAKE_NO_LANGUAGE: readonly string[] = ['ingredientLine'];
const LANGUAGE_IS_SECOND: readonly string[] = ['declarationText'];

// ── The names a file may import from the three label modules WITHOUT being on the list ──────────────────────────────
//
// Anything not here, and not a type, makes the importing file a label file: it must then be on LABEL_FILES, where the
// rules above apply to it. Each name is allowed for the reason beside it; none returns a word a person reads.
const MODULES = '@mise/shared/(?:market|recipe-label-model|allergen-model|label-image-layout|label-text-check|haccp-label)';
const ALLOWED_VALUES: Readonly<Record<string, string>> = {
  countryOf: 'a country CODE (GB / IT), used for sums and links, not a word',
  currencyOf: 'a currency symbol, not a food word',
  moneyLayoutOf: 'where the symbol sits in a price, not a food word',
  canPrintLabel: 'a yes / no',
  outputLanguage: 'the language CODE a label must be printed in — this is how a file asks the country',
  COUNTRIES: 'the supported country codes',
  CURRENCY_COUNTRIES: 'country codes',
  MONEY_LAYOUT_COUNTRIES: 'country codes',
  ALLERGEN_STATES: 'the three state codes of an ingredient (unknown / none / listed)',
  ALLERGEN_CODES: 'allergen CODES; the words come only from allergenName',
  ALLERGEN_GROUPS: 'group CODES; the words come only from allergenGroupName',
  NUTRIENT_KEYS: 'nutrient KEYS; the words come only from nutrientName',
  LABEL_SHOWS: 'the codes of what a label shows (allergens / nutrition / both)',
  isAllergenCode: 'a yes / no over a code',
  normalizeAllergens: 'cleans stored codes, returns codes',
  normalizeMayContain: 'cleans stored codes, returns codes',
  normalizeNutrition: 'cleans stored numbers, returns keys and numbers',
  allergenState: 'one of the three state codes',
  checkedAt: 'the date an ingredient was checked, as stored',
  isDeclared: 'a yes / no',
  hasFullNutrition: 'a yes / no',
  missingNutrients: 'nutrient KEYS, not words',
  S: 'the canvas scale (4), a number',
  CANVAS_W: 'the canvas width in pixels, a number',
  CANVAS_H: 'the canvas height in pixels, a number',
  BODY_PX: 'the ingredients’ type size in pixels, a number',
  SMALL_BOLD_PX: 'the size of «PRODOTTO IL:» in pixels, a number',
  TITLE_MAX: 'the title’s largest size, a number',
  TITLE_MIN: 'the title’s smallest size, a number',
  TITLE_LINE: 'dots between two title lines, a number',
  LINE_HEIGHT: 'dots between two lines of ingredients, a number',
  TEXT_LIMIT_Y: 'where the ingredients must end, a number',
  LOGO_W: 'the logo’s width in pixels, a number',
  // The HACCP label (shared/haccp-label.ts): the fields, states, sizes and the settings are codes and numbers; the words of the
  // label come only from haccpCaption / haccpContent (on LABEL_WORDS), which take the country's language.
  HACCP_FIELDS: 'field CODES; the words come only from haccpCaption / haccpContent',
  HACCP_STATES: 'state codes (off / print / blank)',
  HACCP_DEFAULTS: 'a state per field CODE',
  HACCP_DATE_FIELDS: 'field codes',
  HACCP_TEXT_FIELDS: 'field codes',
  HACCP_TEXT_MAX: 'a box’s bound, a number',
  HACCP_SIZES: 'size codes (40x30 …), not words',
  HACCP_DEFAULT_SIZE: 'a size code',
  DOTS_PER_MM: 'dots to the millimetre, a number',
  haccpSizeMm: 'a size in millimetres, numbers',
  haccpSizeDots: 'a size in dots, numbers',
  haccpSettingsOf: 'the stored settings read into codes and a size',
  haccpListCategory: 'the venue’s own category word (data it typed), or null — not a food word of the label',
  lotFromDate: 'a date as digits (ddmmyy), not a word',
  dateFromInput: 'a date box’s text read into a date',
  inputFromDate: 'a date written for a date box (YYYY-MM-DD), digits',
  firstNameOf: 'the first name a person typed in the venue’s roster, data and not a food word',
  HACCP_MARGIN: 'the label’s margin in dots, a number',
  ROW: 'a text line’s height in dots, a number',
  BLANK_ROW: 'a blank line’s height in dots, a number',
};
// Exported by the three modules and NOT allowed outside a label file, because they carry or compose words: the tables
// hold each allergen's and nutrient's English `label`, and the builders compose ingredient names into the declaration.
const FOOD_CARRYING: readonly string[] = [
  'ALLERGENS', 'NUTRIENTS', 'buildAllergenFields', 'buildLabel', 'flattenIngredients', 'nutritionPer100g',
  // The image label: it composes the typed title and ingredients into the drawing, and its check names allergens.
  'layoutHaccpLabel', // composes the HACCP content (captions and the allergens' names) into the drawing
  'layoutLogoLabel', // composes the typed words (and «PRODOTTO IL:») into the drawing
  'ingredientWords', // hands out the typed words one by one
  'CHECKED_WORDS', 'NOT_ALLERGENS', 'BOLD_WORDS', 'DECLARED_WORDS', // the Italian allergen words
  'checkLabelText', // returns the allergen words found in the text, and the code of the one it lacks
  'ingredientAt', // a piece of the typed ingredients
  'runsOf', // the typed words split into bold allergens and plain text
];

// The source without its comments and string literals: explaining the rule in prose is exactly where a forbidden word
// belongs, and a sentence that mentions a function is not a call of it.
const codeOf = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// Every call of a label-word function in the code, with the text of its arguments (parentheses balanced).
function callsIn(code: string, names: readonly string[] = LABEL_WORDS): Array<{ name: string; args: string[] }> {
  const calls: Array<{ name: string; args: string[] }> = [];
  const pattern = new RegExp(`(?<![\\w.])(${names.join('|')})\\s*\\(`, 'g');
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

type ImportedName = { name: string; typeOnly: boolean; renamed: boolean };
type ImportStatement = { module: string; star: boolean; names: ImportedName[] };

// Every `import … from`, `export … from` and dynamic `import()` of the three label modules, in the code. The clause may
// hold words, braces, commas and `*` only, so a match can never run across another statement's string.
function labelImportsIn(code: string): { statements: ImportStatement[]; dynamic: number } {
  const statements: ImportStatement[] = [];
  const pattern = new RegExp(`\\b(?:import|export)\\s+(type\\s+)?([\\w\\s{},*$]*?)\\s*\\bfrom\\s*['"](${MODULES})['"]`, 'g');
  for (const match of code.matchAll(pattern)) {
    const wholeIsType = match[1] !== undefined;
    const clause = (match[2] ?? '').trim();
    const inside = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
    const names = inside.split(',').map(part => part.trim()).filter(Boolean).map(part => {
      const spec = part.replace(/^type\s+/, '');
      return {
        name: spec.split(/\s+as\s+/)[0] ?? '',
        typeOnly: wholeIsType || /^type\s/.test(part),
        renamed: /\bas\b/.test(spec),
      };
    });
    statements.push({ module: match[3] ?? '', star: clause.includes('*'), names });
  }
  const dynamic = [...code.matchAll(new RegExp(`\\bimport\\s*\\(\\s*['"]${MODULES}['"]`, 'g'))].length;
  return { statements, dynamic };
}

// What is wrong with one file's imports of the label modules. `listed`: the file is on LABEL_FILES, so any name is
// allowed to be imported — but a star import or a rename hides calls from the scan, listed or not.
function importProblemsIn(file: string, source: string, listed: boolean): string[] {
  const { statements, dynamic } = labelImportsIn(codeOf(source));
  const problems: string[] = [];
  if (dynamic > 0) problems.push(`${file}: imports a label module with import() — the scan cannot follow it`);
  for (const statement of statements) {
    if (statement.star) problems.push(`${file}: «import * as» / «export *» of ${statement.module} hides which functions are called`);
    for (const { name, typeOnly, renamed } of statement.names) {
      if (typeOnly) continue;
      if (renamed) problems.push(`${file}: renames «${name}» from ${statement.module} with «as» — a renamed call is invisible to the scan`);
      if (!listed && !(name in ALLOWED_VALUES)) {
        problems.push(`${file}: imports «${name}» from ${statement.module} but is not on LABEL_FILES — add it there, or it must not draw a food word`);
      }
    }
  }
  return problems;
}

// The language variable. In a listed file `lang` is declared from `outputLanguage(` and nothing else declares, assigns,
// destructures or takes a parameter by that name — or the country's language could be swapped for another one.
function languageProblemsIn(file: string, code: string): string[] {
  const without = code.replace(/\bconst\s+lang\s*=\s*outputLanguage\s*\(/g, 'const OK = outputLanguage(');
  const shapes: ReadonlyArray<readonly [RegExp, string]> = [
    [/\b(?:const|let|var)\s+lang\b/, 'declares lang from something other than outputLanguage('],
    [/(?<!\b(?:const|let|var)\s+)(?<![\w.])lang\s*=(?![=>])/, 'assigns lang'],
    [/\{[^}]*\blang\b[^}]*\}\s*=(?!=)/, 'destructures lang'],
    [/(?<!\?\s*)\blang\s*\??\s*:/, 'names lang as a parameter or a property'],
    [/(?<![\w.])lang\s*\)?\s*=>/, 'takes lang as an arrow-function parameter'],
    [/\bfunction\s*\w*\s*\([^)]*\blang\b/, 'takes lang as a function parameter'],
  ];
  return shapes
    .filter(([pattern]) => pattern.test(without))
    .map(([, why]) => `${file}: ${why} — «lang» must come from «const lang = outputLanguage(…)» alone`);
}

// What is wrong with one file that draws food words (an empty list: nothing).
function problemsIn(file: string, source: string): string[] {
  const code = codeOf(source);
  const problems: string[] = [];
  if (!/\bconst\s+lang\s*=\s*outputLanguage\s*\(/.test(code)) {
    problems.push(`${file}: has no «const lang = outputLanguage(…)» — the food words would not follow the venue's country`);
  }
  problems.push(...languageProblemsIn(file, code));
  problems.push(...importProblemsIn(file, source, true));
  const calls = callsIn(code);
  if (calls.length === 0) problems.push(`${file}: is on the list but calls no label-word function — take it off the list`);
  for (const { name, args } of calls) {
    if (NEVER_CALLED.includes(name)) {
      problems.push(`${file}: calls ${name}(…), which returns a word in one fixed language — use the country's own function`);
      continue;
    }
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

// ⚠️ THE TEXT CHECK TAKES ITS LANGUAGE IN AN OPTIONS OBJECT, so the «last argument» rule above cannot see it. Its own
// rule: every call of `checkLabelText(` hands over the country's `lang` in that object — the shorthand `{ lang, … }`, so
// the one name a listed file may use is the one declared from `outputLanguage(`. Without it the check would run in the
// wrong language, or in none: Italian lists applied to an English label, or no check at all on an Italian one.
const OPTION_CALLS: readonly string[] = ['checkLabelText'];
const PASSES_LANG = /(?:^|[{,]\s*)lang\s*(?:,|\}|:\s*lang\b)/;

function optionProblemsIn(file: string, code: string): string[] {
  return callsIn(code, OPTION_CALLS)
    .filter(({ args }) => !PASSES_LANG.test(args[1] ?? ''))
    .map(({ name, args }) => `${file}: ${name}(${args.join(', ')}) does not pass the country's «lang» in its options`);
}

// The only problem message the import door lets through, word for word (see the test that uses it).
const REVIEWED_EXCEPTION = './records/allergenCardModel.ts: imports «buildAllergenFields» from @mise/shared/allergen-model'
  + ' but is not on LABEL_FILES — add it there, or it must not draw a food word';

const appFiles = () => Object.entries(sources).filter(([file]) => !/\.spec\.tsx?$/.test(file));

describe('the interface language never reaches a food word', () => {
  test('the scan finds the app\'s files and the label files among them', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    for (const file of LABEL_FILES) expect(Object.keys(sources), `${file} must exist`).toContain(file);
  });

  test('every app file that calls a label-word function is on the list, and no file on it stopped calling one', () => {
    const calling = appFiles()
      .filter(([, source]) => callsIn(codeOf(source)).length > 0)
      .map(([file]) => file)
      .sort();
    expect(calling).toEqual([...LABEL_FILES].sort());
  });

  test('every file on the list asks the venue\'s country, passes it to every call, and holds no interface language', () => {
    const problems = LABEL_FILES.flatMap(file => problemsIn(file, sources[file] ?? ''));
    expect(problems).toEqual([]);
  });

  test('every call of the text check passes the country\'s «lang» in its options', () => {
    const problems = appFiles().flatMap(([file, source]) => optionProblemsIn(file, codeOf(source)));
    expect(problems).toEqual([]);
    // The scan must find the call it guards, or a green result means nothing.
    const calls = appFiles().flatMap(([, source]) => callsIn(codeOf(source), OPTION_CALLS));
    expect(calls.length).toBeGreaterThan(0);
  });

  test('and the options rule finds a call without «lang», with another language, or with none', () => {
    const problems = (call: string) => optionProblemsIn('x.tsx', call);
    expect(problems('checkLabelText(text, { lang, declared })')).toEqual([]);
    expect(problems('checkLabelText(text, { declared, lang })')).toEqual([]);
    expect(problems('checkLabelText(text, { lang })')).toEqual([]);
    expect(problems('checkLabelText(text, { lang: lang, declared })')).toEqual([]);
    expect(problems('const r = checkLabelText(\n  text,\n  { lang, declared: codes },\n);')).toEqual([]);
    expect(problems("checkLabelText(text, { lang: 'it', declared })")).toHaveLength(1);
    expect(problems('checkLabelText(text, { declared })')).toHaveLength(1);
    expect(problems('checkLabelText(text, { language: lang })')).toHaveLength(1);
    expect(problems('checkLabelText(text, options)')).toHaveLength(1);
    expect(problems('checkLabelText(text)')).toHaveLength(1);
    // A comment that mentions the call is not one.
    expect(optionProblemsIn('x.tsx', codeOf('// checkLabelText(text, { lang: "it" })'))).toEqual([]);
  });

  // ⚠️ THE DOOR CANNOT BE WALKED ROUND: a file that is not on the list may import from the three label modules only the
  // names that are not food words, and nobody may rename or star-import them.
  test('no app file imports a food-carrying value from the label modules without being on the list, or hides one', () => {
    const problems = appFiles().flatMap(([file, source]) => importProblemsIn(file, source, LABEL_FILES.includes(file)))
      // The one reviewed exception: it imports a builder of stored fields, not of words, and only that name, and only plainly.
      .filter(problem => problem !== REVIEWED_EXCEPTION);
    expect(problems).toEqual([]);
  });

  // ⚠️ THE EXCEPTION IS ONE EXACT MESSAGE: a rename with «as», a star import, or any other name in that file is still reported.
  test('the reviewed exception covers the plain import of buildAllergenFields in allergenCardModel.ts and nothing else', () => {
    const file = './records/allergenCardModel.ts';
    const plain = importProblemsIn(file, `import { buildAllergenFields } from '@mise/shared/allergen-model';`, false);
    expect(plain).toEqual([REVIEWED_EXCEPTION]);
    const renamed = importProblemsIn(file, `import { buildAllergenFields as b } from '@mise/shared/allergen-model';`, false);
    expect(renamed.filter(problem => problem !== REVIEWED_EXCEPTION)).not.toEqual([]);
    const other = importProblemsIn(file, `import { allergenName } from '@mise/shared/market';`, false);
    expect(other.filter(problem => problem !== REVIEWED_EXCEPTION)).not.toEqual([]);
  });

  // ⚠️ AN ALLOWLIST THAT DRIFTS FROM THE MODULES IS A HOLE: a new export must be decided on, on purpose.
  test('every runtime export of the label modules is a label word, allowed with a reason, or food-carrying', () => {
    const exported = [
      ...Object.keys(market), ...Object.keys(allergenModel), ...Object.keys(labelModel),
      ...Object.keys(imageLayout), ...Object.keys(textCheck), ...Object.keys(haccpLabel),
    ];
    const decided = new Set<string>([...LABEL_WORDS, ...Object.keys(ALLOWED_VALUES), ...FOOD_CARRYING]);
    expect(exported.filter(name => !decided.has(name))).toEqual([]);
    const exports = new Set(exported);
    expect([...decided].filter(name => !exports.has(name))).toEqual([]);
    for (const name of LABEL_WORDS) expect(ALLOWED_VALUES, `${name} is a label word`).not.toHaveProperty(name);
    for (const name of FOOD_CARRYING) expect(ALLOWED_VALUES, `${name} carries food words`).not.toHaveProperty(name);
  });

  // ⚠️ THE SCANNER MUST BE SHOWN TO FIND WHAT IT GUARDS, or a green result means nothing.
  test('and the scan itself finds each way of getting it wrong', () => {
    const good = 'const lang = outputLanguage(location);\nconst a = allergenName(code, lang);\nconst b = ingredientLine(label);';
    expect(problemsIn('good.tsx', good)).toEqual([]);

    expect(problemsIn('a.tsx', good.replace('outputLanguage(location)', "'en'"))).toEqual([
      expect.stringContaining('has no «const lang = outputLanguage('),
      expect.stringContaining('declares lang from something other than outputLanguage('),
    ]);
    expect(problemsIn('b.tsx', `${good}\nconst c = allergenName(code, locale);`)).toEqual([
      expect.stringContaining('allergenName(code, locale) does not pass'),
    ]);
    expect(problemsIn('c.tsx', `const { t, lang } = useT();\n${good}`)).toEqual(
      expect.arrayContaining([expect.stringContaining('takes lang or locale from useT()')]),
    );
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

  test('rule (a): an unlisted file importing a food-carrying value is found; allowed names and types are not', () => {
    const bad = "import { allergenName } from '@mise/shared/market';";
    expect(importProblemsIn('x.tsx', bad, false)).toEqual([expect.stringContaining('imports «allergenName»')]);
    // On the list the same import is fine.
    expect(importProblemsIn('x.tsx', bad, true)).toEqual([]);
    // Across lines, among allowed names, and from the other two modules.
    expect(importProblemsIn('x.tsx', "import {\n  countryOf,\n  labelWord,\n} from '@mise/shared/market';", false))
      .toEqual([expect.stringContaining('imports «labelWord»')]);
    expect(importProblemsIn('x.tsx', "import { ALLERGENS } from '@mise/shared/allergen-model';", false)).toHaveLength(1);
    expect(importProblemsIn('x.tsx', "import { buildLabel } from '@mise/shared/recipe-label-model';", false)).toHaveLength(1);
    expect(importProblemsIn('x.tsx', "export { allergenLabel } from '@mise/shared/allergen-model';", false)).toHaveLength(1);
    expect(importProblemsIn('x.tsx', "const m = await import('@mise/shared/market');", false))
      .toEqual([expect.stringContaining('import()')]);
    // Allowed names, type-only imports and unrelated modules are not a problem.
    expect(importProblemsIn('x.tsx', "import { countryOf, canPrintLabel } from '@mise/shared/market';", false)).toEqual([]);
    expect(importProblemsIn('x.tsx', "import type { Country, allergenName } from '@mise/shared/market';", false)).toEqual([]);
    expect(importProblemsIn('x.tsx', "import { type Country, currencyOf } from '@mise/shared/market';", false)).toEqual([]);
    expect(importProblemsIn('x.tsx', "import { ALLERGEN_GROUPS } from '@mise/shared/allergen-model';\nimport { x } from './market';", false)).toEqual([]);
    // A comment that mentions an import is not one.
    expect(importProblemsIn('x.tsx', "// import { allergenName } from '@mise/shared/market';", false)).toEqual([]);
  });

  test('rule (b): a star import, a star re-export or an «as» rename is found, listed or not', () => {
    for (const listed of [false, true]) {
      expect(importProblemsIn('x.tsx', "import * as market from '@mise/shared/market';", listed))
        .toEqual([expect.stringContaining('import * as')]);
      expect(importProblemsIn('x.tsx', "export * from '@mise/shared/allergen-model';", listed))
        .toEqual([expect.stringContaining('import * as')]);
      expect(importProblemsIn('x.tsx', "import { allergenName as name } from '@mise/shared/market';", listed))
        .toEqual(expect.arrayContaining([expect.stringContaining('renames «allergenName»')]));
      expect(importProblemsIn('x.tsx', "import { countryOf as c } from '@mise/shared/market';", listed))
        .toEqual([expect.stringContaining('renames «countryOf»')]);
    }
    // A type renamed is only a type.
    expect(importProblemsIn('x.tsx', "import { type Country as C } from '@mise/shared/market';", true)).toEqual([]);
  });

  test('rule (c): the fixed-language word functions are found anywhere, and refused in a listed file', () => {
    for (const name of ['allergenLabel', 'allergenWordIt', 'nutrientWordIt']) {
      expect(callsIn(`const x = ${name}(code);`)).toEqual([{ name, args: ['code'] }]);
      expect(problemsIn('x.tsx', `const lang = outputLanguage(location);\nconst x = ${name}(code);`))
        .toEqual([expect.stringContaining(`calls ${name}(…)`)]);
    }
    // And an unlisted file that merely imports one is caught by rule (a) as well.
    expect(importProblemsIn('x.tsx', "import { nutrientWordIt } from '@mise/shared/market';", false)).toHaveLength(1);
  });

  test('rule (d): in a listed file «lang» comes from outputLanguage( and from nothing else', () => {
    const good = 'const lang = outputLanguage(location);\nconst a = allergenName(code, lang);';
    expect(problemsIn('good.tsx', good)).toEqual([]);
    // Two scopes, two honest declarations.
    expect(problemsIn('two.tsx', `${good}\nfunction Row() { const lang = outputLanguage(location); return allergenName(c, lang); }`)).toEqual([]);
    // The ternary and the property read are not declarations.
    expect(problemsIn('use.tsx', `${good}\nconst w = open ? lang : null;\nconst z = label.lang;`)).toEqual([]);

    const wrong = (extra: string) => problemsIn('x.tsx', `${good}\n${extra}`);
    expect(wrong('const lang = other(location);')).toEqual([expect.stringContaining('declares lang from something')]);
    expect(wrong('let lang = outputLanguage(location);')).toEqual([expect.stringContaining('declares lang from something')]);
    expect(wrong("lang = 'it';")).toEqual([expect.stringContaining('assigns lang')]);
    expect(wrong('const { lang } = props;')).toEqual([expect.stringContaining('destructures lang')]);
    expect(wrong('const f = (lang) => allergenName(c, lang);')).toEqual(
      expect.arrayContaining([expect.stringContaining('arrow-function parameter')]),
    );
    expect(wrong('const f = (c, lang: string) => c;')).toEqual([expect.stringContaining('parameter or a property')]);
    expect(wrong('function f(c, lang) { return c; }')).toEqual([expect.stringContaining('function parameter')]);
    // The declaration is shadowed by another that reads the interface language.
    expect(wrong('const lang = interfaceLanguage;')).toEqual(
      expect.arrayContaining([expect.stringContaining('declares lang from something')]),
    );
  });
});
