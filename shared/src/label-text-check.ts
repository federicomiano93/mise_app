// label-text-check.ts — the allergen check on the ingredients TEXT of an image label, and which of its words are
// printed bold. NEW IN MISE 2: a port of `controlla_allergeni` and of the bold words of the owner's label script
// (`genera_etichetta.py`, outside the repository — real business data stays there). Pinned against the script itself by
// label-text-check.spec.ts, through the golden file its harness recorded (fixtures/label-image-golden.json).
//
// ⚠️ IT DOES NOT REPLACE THE HACCP CONSULTANT, and the owner's own words say so: it stops the obvious mistakes before a
// label is printed. ERRORE stops the printing, DA VERIFICARE asks for the product sheet.
//
// THE ONLY DIFFERENCES FROM THE SCRIPT — three defects found in it on 25 Oct 2026, fixed here on purpose:
//   (a) BOLD = CHECKED. The script checks SPELTA, ALBUME, TUORLO, SIERO, CASEINA, YOGURT, MANDORLA, NOCCIOLA and
//       PISTACCHIO for capitals but does not print them bold; the law asks for both. One list now does both jobs.
//   (b) «malto» IS A WHOLE WORD. The script looks for words STARTING with «malto», so «maltodestrina» (a sugar, no
//       barley) and «maltitolo» raised a false ERRORE.
//   (c) ORZO NEXT TO THE BEER. The script accepted «birra» or «malto» whenever ORZO appeared ANYWHERE in the text — the
//       barley of another ingredient made the beer look declared. Now ORZO must be in the SAME ingredient: the piece
//       between commas, at the word's own depth, with its parentheses («birra (contiene ORZO, alcol 5°)»).
// One addition the script has no equivalent for, because it knows nothing of the recipe: when Mise holds the recipe's
// allergens fully declared, each one must appear in CAPITALS in the text (`declared`), else ERRORE.
//
// ⚠️ WORD BOUNDARIES ARE PYTHON'S, NOT JAVASCRIPT'S. JS `\b` only knows ASCII letters: «farina di grano» would match
// but «più» would split in two, and «già» next to a word would look like a boundary. Python 3's `\b` is Unicode-aware
// (a word character is a letter, a digit or `_`), so every boundary here is written as a look-around over exactly that
// class, with the `u` flag.
//
// The lists are ITALIAN, as the script's: the text is the venue's own words in the language of its labels. A venue
// whose labels are not Italian gets no check (`available: false`) and the screen says so — never an Italian check
// pretending to read English.

import type { AllergenCode } from './allergen-model';

// A word character for Python 3's `\b`.
const W = '[\\p{L}\\p{N}_]';
const word = (body: string): string => `(?<!${W})(?:${body})(?!${W})`;
const prefix = (body: string): string => `(?<!${W})(?:${body})`;

// 1) Allergens (and their forms) that must be written in CAPITALS — the script's DA_EVIDENZIARE, in its order.
export const CHECKED_WORDS: readonly string[] = Object.freeze([
  'grano', 'frumento', 'segale', 'orzo', 'avena', 'farro', 'kamut', 'spelta',
  'uova', 'uovo', 'albume', 'tuorlo', 'latte', 'burro', 'panna', 'formaggio',
  'ricotta', 'mascarpone', 'siero', 'lattosio', 'caseina', 'yogurt',
  'mandorle', 'mandorla', 'nocciole', 'nocciola', 'noci', 'pistacchi',
  'pistacchio', 'anacardi', 'arachidi', 'sesamo', 'soia', 'senape', 'sedano',
  'lupini', 'pesce', 'crostacei', 'molluschi', 'solfiti',
]);

// …except in these phrases, which are not allergens (the script's ECCEZIONI).
export const NOT_ALLERGENS: readonly string[] = Object.freeze([
  'grano saraceno', 'burro di cacao', 'burro di karit', 'latte di cocco',
  'noci di cocco', 'noce di cocco', 'noce moscata',
]);

// (a) The words printed bold: the checked list in capitals, longest first so the longer form wins (the script's
// `sorted(ALLERGENI, key=len, reverse=True)`; both sorts are stable, so equal lengths keep the list's order).
export const BOLD_WORDS: readonly string[] = Object.freeze(
  CHECKED_WORDS.map(w => w.toUpperCase()).sort((a, b) => b.length - a.length),
);
const BOLD_SPLIT = new RegExp(`(${BOLD_WORDS.join('|')})`);
const BOLD_SET = new Set(BOLD_WORDS);

export interface TextRun {
  readonly text: string;
  readonly bold: boolean;
}

// One word of the ingredients (no spaces in it) as runs of plain and bold text, exactly as the script splits it: an
// allergen word in capitals ANYWHERE inside the word is bold («d’AVENA,» → «d’», «AVENA», «,»).
export function runsOf(token: string): TextRun[] {
  return token.split(BOLD_SPLIT).filter(p => p !== '').map(p => ({ text: p, bold: BOLD_SET.has(p) }));
}

// The capitals that satisfy a declared allergen in the cross-check (all of them on the checked list, so every one is
// printed bold). The walnut's family — pecan, Brazil, macadamia — is written «noci …» in Italian.
export const DECLARED_WORDS: Readonly<Record<AllergenCode, readonly string[]>> = Object.freeze({
  'gluten-wheat': ['GRANO', 'FRUMENTO'],
  'gluten-rye': ['SEGALE'],
  'gluten-barley': ['ORZO'],
  'gluten-oats': ['AVENA'],
  'gluten-spelt': ['FARRO', 'SPELTA'],
  'gluten-kamut': ['KAMUT'],
  'nuts-almond': ['MANDORLE', 'MANDORLA'],
  'nuts-hazelnut': ['NOCCIOLE', 'NOCCIOLA'],
  'nuts-walnut': ['NOCI'],
  'nuts-cashew': ['ANACARDI'],
  'nuts-pecan': ['NOCI'],
  'nuts-brazil': ['NOCI'],
  'nuts-pistachio': ['PISTACCHI', 'PISTACCHIO'],
  'nuts-macadamia': ['NOCI'],
  celery: ['SEDANO'],
  crustaceans: ['CROSTACEI'],
  eggs: ['UOVA', 'UOVO', 'ALBUME', 'TUORLO'],
  fish: ['PESCE'],
  lupin: ['LUPINI'],
  milk: ['LATTE', 'BURRO', 'PANNA', 'FORMAGGIO', 'RICOTTA', 'MASCARPONE', 'SIERO', 'LATTOSIO', 'CASEINA', 'YOGURT'],
  molluscs: ['MOLLUSCHI'],
  mustard: ['SENAPE'],
  peanuts: ['ARACHIDI'],
  sesame: ['SESAMO'],
  soybeans: ['SOIA'],
  sulphites: ['SOLFITI'],
});

export type CheckIssue =
  // ERRORE: an allergen written in small letters (`word` as written).
  | { readonly kind: 'lowercase'; readonly word: string }
  // ERRORE: beer or malt without ORZO in the same ingredient.
  | { readonly kind: 'hidden'; readonly word: 'birra' | 'malto' }
  // ERRORE: a lecithin whose origin is not said.
  | { readonly kind: 'lecithin' }
  // ERRORE: Mise holds this allergen declared for the recipe and the text never says it in capitals.
  | { readonly kind: 'declared-missing'; readonly code: AllergenCode }
  // DA VERIFICARE: wine, vermouth, vinegar, raisins… (possible SULPHITES); chocolate; margarine.
  | { readonly kind: 'sulphites' }
  | { readonly kind: 'chocolate' }
  | { readonly kind: 'margarine' };

export interface CheckResult {
  // False when the labels are not in Italian: no check was made (the screen says so).
  readonly available: boolean;
  readonly errors: readonly CheckIssue[];
  readonly warnings: readonly CheckIssue[];
}

export interface CheckOptions {
  // The language the venue's labels are printed in (market.outputLanguage).
  readonly lang: string | null;
  // The recipe's allergens when Mise holds them FULLY declared, else null (no cross-check).
  readonly declared?: readonly AllergenCode[] | null;
}

// Lower case that keeps every index where it was (a character whose lower case is longer stays as it is), so a match
// found in it points at the same place in the text.
function lowerSameLength(text: string): string {
  const all = text.toLowerCase();
  if (all.length === text.length) return all;
  let out = '';
  for (const ch of text) {
    const l = ch.toLowerCase();
    out += l.length === ch.length ? l : ch;
  }
  return out;
}

// The ingredient a word belongs to: the piece between commas at the word's own depth of parentheses, with any
// parentheses inside it («birra (contiene ORZO, alcol 5°)»), and never crossing the parenthesis that holds it.
export function ingredientAt(text: string, index: number): string {
  let start = index;
  let depth = 0;
  for (let j = index - 1; j >= 0; j--) {
    const c = text[j];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) break;
    start = j;
  }
  let end = index;
  depth = 0;
  for (; end < text.length; end++) {
    const c = text[end];
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) break;
  }
  return text.slice(start, end);
}

const HIDDEN: readonly { readonly word: 'birra' | 'malto'; readonly re: RegExp }[] = [
  { word: 'birra', re: new RegExp(prefix('birra'), 'gu') },
  // (b) a whole word: «maltodestrina» and «maltitolo» are not malt.
  { word: 'malto', re: new RegExp(word('malto'), 'gu') },
];
const LECITHIN = new RegExp(prefix('lecitina'), 'u');
const LECITHIN_WITH_ORIGIN = new RegExp(`lecitina\\s+di\\s+${W}+`, 'u');
// «lievito di birra» is a yeast and holds no barley (the script's ECCEZIONI_NASCOSTI).
const HIDDEN_EXCEPTION = 'lievito di birra';

const TO_VERIFY: readonly { readonly kind: 'sulphites' | 'chocolate' | 'margarine'; readonly re: RegExp; readonly unless: string | null }[] = [
  { kind: 'sulphites', re: new RegExp(`${word('vin[oi]')}|vermut|vermouth|marsala|liquore|aceto|uvetta|uva passa`, 'u'), unless: 'SOLFITI' },
  { kind: 'chocolate', re: /cioccolat/u, unless: null },
  { kind: 'margarine', re: /margarina/u, unless: null },
];

// The check, in the script's order: small-letter allergens (list order, then where they stand), the hidden ones, then
// the three to verify, then the cross-check with the recipe.
export function checkLabelText(text: string, options: CheckOptions): CheckResult {
  if (options.lang !== 'it') return { available: false, errors: [], warnings: [] };
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];
  const lower = lowerSameLength(text);

  for (const w of CHECKED_WORDS) {
    for (const m of text.matchAll(new RegExp(word(w), 'giu'))) {
      const found = m[0];
      if (found === found.toUpperCase()) continue;
      const at = m.index;
      if (NOT_ALLERGENS.some(e => lower.startsWith(e, at))) continue;
      errors.push({ kind: 'lowercase', word: found });
    }
  }

  // Where «lievito di birra» stands, so a beer inside it is not counted.
  const exceptions: number[] = [];
  for (let i = lower.indexOf(HIDDEN_EXCEPTION); i >= 0; i = lower.indexOf(HIDDEN_EXCEPTION, i + 1)) exceptions.push(i);
  const inException = (at: number): boolean => exceptions.some(s => at >= s && at < s + HIDDEN_EXCEPTION.length);

  for (const h of HIDDEN) {
    // (c) every occurrence needs ORZO in its own ingredient; one that lacks it is enough for the error (said once).
    const bad = [...lower.matchAll(h.re)].some(m => !inException(m.index) && !ingredientAt(text, m.index).includes('ORZO'));
    if (bad) errors.push({ kind: 'hidden', word: h.word });
  }
  if (LECITHIN.test(lower) && !LECITHIN_WITH_ORIGIN.test(lower)) errors.push({ kind: 'lecithin' });

  for (const v of TO_VERIFY) {
    if (v.re.test(lower) && (v.unless === null || !text.includes(v.unless))) warnings.push({ kind: v.kind });
  }

  for (const code of options.declared ?? []) {
    const words = DECLARED_WORDS[code];
    if (!words.some(w => new RegExp(word(w), 'u').test(text))) errors.push({ kind: 'declared-missing', code });
  }

  return { available: true, errors, warnings };
}
