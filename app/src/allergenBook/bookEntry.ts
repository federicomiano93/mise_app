// bookEntry.ts — ONE PRODUCT OF THE ALLERGEN BOOK AS WORDS, and the words of the sheet. Pure: no React. THE ONE LABEL FILE OF THE FEATURE
// (label-separation.spec.ts): the only place the allergen book composes a food word, so everything it prints says exactly what the
// product's label says.
//
// ⚠️⚠️ EVERY FOOD WORD FOLLOWS THE VENUE'S COUNTRY (`outputLanguage`), never the interface language. A British bakery run in Italian
// still prints «Contains». The paper's own words (the sheet's title, «Updated on», the legend, the box) are the country's too (D8),
// from the small table below: market.ts is a paired port of js/market.js and does not grow for this.
//
// ⚠️ THE INGREDIENT LINE (D3, D5). A hand-typed text (`labelIngredientsText`, the «with logo» image label's) WINS only when the text check
// ran AND found no error in it. For a venue whose labels are not Italian the check is «not available» (`available: false`): nothing can
// vouch for the text, so it is NOT used ('unchecked') and the line `buildLabel` composes is, with its allergens in bold. With errors the
// book falls back to that composed line too ('refused'). An INCOMPLETE product (its
// allergens cannot be declared) gets either a clean typed text, or the recipe's own rows as typed, heaviest first, both with NO bold at all: the
// app cannot vouch for them and the box on the paper says so.
import { labelWord, outputLanguage } from '@mise/shared/market';
import { buildLabel, containsLine, mayContainLine } from '@mise/shared/recipe-label-model';
import type { RecipeLabelTables } from '@mise/shared/recipe-label-model';
import { canLabel, recipeAllergens } from '@mise/shared/recipe-allergen-model';
import { checkLabelText, runsOf } from '@mise/shared/label-text-check';
import { labelTextsOf } from '../recipes/labelTexts';

// A piece of the ingredient line: an allergen is `bold` (on paper, bold capitals).
export type BookRun = { readonly text: string; readonly bold: boolean };

// Why a product cannot be declared: exactly the label's own refusal (label.blocked.notDeclared with the gaps, or label.blocked.noWeights).
export type BookReason = { readonly kind: 'not-declared'; readonly gaps: number } | { readonly kind: 'no-weights' };

export type BookEntry = {
  readonly id: string;
  // D2: the hand-typed label name, trimmed, else the recipe's name as written (never upper-cased: on paper capitals mean «allergen»).
  readonly name: string;
  readonly ingredientsWord: string;
  // The line after «Ingredienti: ». A composed line ends with a plain full stop; a typed one is as typed.
  readonly runs: readonly BookRun[];
  // '' when there is none, and always '' for an incomplete product.
  readonly contains: string;
  readonly mayContain: string;
  readonly complete: boolean;
  readonly reason: BookReason | null;
  // 'used': the hand-typed text is what `runs` holds. 'refused': there is one but its check found errors. 'unchecked': there is one but
  // no check exists for the country's language, so it is not used. 'none': nothing typed.
  readonly typedText: 'used' | 'refused' | 'unchecked' | 'none';
};

const nameOf = (recipe: unknown): string =>
  String((recipe && (recipe as { name?: unknown }).name) || '').trim();

// The typed text as runs: white space stays as plain runs, each word is split into plain and bold (an allergen in capitals).
function typedRuns(typed: string): BookRun[] {
  const runs: BookRun[] = [];
  for (const piece of typed.normalize('NFC').split(/(\s+)/u)) {
    if (piece === '') continue;
    if (/^\s+$/u.test(piece)) runs.push({ text: piece, bold: false });
    else runs.push(...runsOf(piece));
  }
  return runs;
}

// Names joined by «, » and a full stop, none of them bold.
function plainRuns(names: readonly string[]): BookRun[] {
  if (names.length === 0) return [];
  return [...names.flatMap((text, index): BookRun[] => (index > 0 ? [{ text: ', ', bold: false }, { text, bold: false }] : [{ text, bold: false }])), { text: '.', bold: false }];
}

// D4, the one decision: the product label can be made (every row declared AND something has a weight).
export function isBookComplete(recipe: unknown, tables: RecipeLabelTables): boolean {
  return canLabel(recipeAllergens(recipe, tables)) && buildLabel(recipe, tables, { shows: 'allergens' }).ok;
}

export function bookEntryOf(recipe: unknown, tables: RecipeLabelTables, location: unknown): BookEntry {
  const lang = outputLanguage(location);
  const label = buildLabel(recipe, tables, { shows: 'allergens' });
  const declared = recipeAllergens(recipe, tables);
  const complete = canLabel(declared) && label.ok;
  const id = String((recipe && (recipe as { id?: unknown }).id) || '');
  const texts = labelTextsOf(recipe);
  // On the image label `|` is a line break in the title; in the book it is a space.
  const name = texts.labelName.replace(/\s*\|\s*/g, ' ').trim() || nameOf(recipe);
  const typed = texts.labelIngredientsText.trim();
  const ingredientsWord = labelWord('ingredients', lang);

  // The check as the image label runs it: with the recipe's allergens when they are fully declared, with no cross-check otherwise.
  const checked = typed === ''
    ? null
    : complete
      ? checkLabelText(typed, { lang, declared: declared.allergens, mayContain: declared.mayContain })
      : checkLabelText(typed, { lang, declared: null, mayContain: null });
  const typedText: BookEntry['typedText'] = typed === '' || checked === null
    ? 'none'
    : !checked.available ? 'unchecked' : checked.errors.length === 0 ? 'used' : 'refused';

  if (label.ok && complete) {
    const composed = label.ingredients.flatMap((item, index): BookRun[] => (
      index > 0 ? [{ text: ', ', bold: false }, { text: item.name, bold: item.emphasise }] : [{ text: item.name, bold: item.emphasise }]
    ));
    return {
      id,
      name,
      ingredientsWord,
      runs: typedText === 'used' ? typedRuns(typed) : [...composed, { text: '.', bold: false }],
      contains: containsLine(label, lang),
      mayContain: mayContainLine(label, lang),
      complete: true,
      reason: null,
      typedText,
    };
  }

  const reason: BookReason = !label.ok && label.reason === 'not-declared' && label.gaps.length > 0
    ? { kind: 'not-declared', gaps: label.gaps.length }
    : { kind: 'no-weights' };
  // The recipe's own rows as typed, heaviest first; a tie keeps the recipe's order (the sort is stable).
  const rows = declared.rows
    .filter(row => row.label !== '')
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.grams - a.row.grams || a.index - b.index)
    .map(({ row }) => row.label);
  return {
    id,
    name,
    ingredientsWord,
    // ⚠️ NEVER BOLD for an incomplete product: bold capitals under the legend would read as an allergen declaration it cannot make.
    runs: typedText === 'used' ? [{ text: typed.normalize('NFC'), bold: false }] : plainRuns(rows),
    contains: '',
    mayContain: '',
    complete: false,
    reason,
    typedText,
  };
}

// ── The paper's own words (D8) ─────────────────────────────────────────────────────────────────────────────────────
// `{date}` is where the date goes. Italian for Italy, English for the United Kingdom.
const BOOK_WORDS = {
  it: {
    title: 'Libro allergeni',
    updated: 'Aggiornato al {date}',
    legend: 'Gli allergeni sono in MAIUSCOLO GRASSETTO.',
    verify: 'Allergeni da verificare: chiedere al personale',
    noCategory: 'Altri prodotti',
  },
  en: {
    title: 'Allergen book',
    updated: 'Updated on {date}',
    legend: 'Allergens are in BOLD CAPITALS.',
    verify: 'Allergens to be checked: ask the staff',
    noCategory: 'Other products',
  },
} as const;

const DATE_LOCALE = { it: 'it-IT', en: 'en-GB' } as const;

export type BookSheetWords = {
  readonly title: string;
  readonly updated: string;
  readonly legend: string;
  readonly verify: string;
  readonly noCategory: string;
};

// The words of the printed sheet, or null when the venue has no output language (no country: nothing may be printed).
export function bookSheetWords(location: unknown, today: Date): BookSheetWords | null {
  const lang = outputLanguage(location);
  if (lang === null) return null;
  const words = BOOK_WORDS[lang];
  const date = new Intl.DateTimeFormat(DATE_LOCALE[lang], { day: '2-digit', month: '2-digit', year: 'numeric' }).format(today);
  return {
    title: words.title,
    updated: words.updated.replace('{date}', date),
    legend: words.legend,
    verify: words.verify,
    noCategory: words.noCategory,
  };
}
