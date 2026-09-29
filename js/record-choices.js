// record-choices.js — the lists behind the ingredient card's «Categoria» and «Unità
// d'ordine» menus.
//
// PURE (P15), and in js/ root because two features draw that card: Orders and the
// Catalogue (CLAUDE.md "Modular by feature"). It imports nothing.
//
// ⚠️ THE DEFAULT WORDS ARE THE VENUE'S DATA, NOT INTERFACE TEXT. «Panetteria» and «cartone»
// are words a bakery files its goods under, so they follow the venue's OUTPUT language
// (js/market.js outputLanguage) and are plain constants here, never t() keys — a venue
// that runs its screens in English but works in Italian must still get Italian words.
//
// ⚠️ THE ITEM'S OWN CURRENT VALUE IS ALWAYS IN THE LIST. A menu that lacked what is stored
// would open on the wrong choice and the next save would quietly change it.

export const DEFAULT_CATEGORIES = Object.freeze({
  it: Object.freeze(['Panetteria', 'Pasticceria', 'Vendita']),
  en: Object.freeze(['Bakery', 'Pastry', 'Retail']),
});

export const DEFAULT_UNITS = Object.freeze({
  it: Object.freeze(['pz', 'kg', 'cartone', 'cassa', 'sacco', 'busta', 'confezione']),
  en: Object.freeze(['pcs', 'kg', 'case', 'crate', 'sack', 'bag', 'pack']),
});

// The stored «no category» word (see js/orders/ingredient-category.js, which is a FEATURE
// file and so is not imported here): a blank category is saved as 'Other'.
const NO_CATEGORY_WORD = 'Other';

const defaultsFor = (table, language) => table[language === 'it' ? 'it' : 'en'];

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// Trimmed, non-empty, de-duplicated — ignoring case unless `exact` (then only an identical
// spelling counts as a repeat). The FIRST spelling seen wins.
function tidy(words, { exact = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const word of words) {
    const text = clean(word);
    const key = exact ? text : text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

// ⚠️ THE SPELLING OF A STORED VALUE IS NEVER CHANGED BY DRAWING A MENU. Two different rules:
//  - values IN USE (an ingredient carries them, or it is the item being edited) are kept in
//    EXACTLY their own spelling, and two spellings that are both in use both stay: they are
//    different stored strings, and folding «farine» into «Farine» would rewrite one of them
//    the next time an unrelated save wrote the menu's choice back;
//  - the venue's saved list and the defaults are only SUGGESTIONS, so one that matches an
//    in-use value ignoring case gives way to it (its spelling is the one people already use).
function choices(suggested, inUse) {
  const used = tidy(inUse, { exact: true });
  const taken = new Set(used.map(w => w.toLowerCase()));
  const rest = tidy(suggested).filter(w => !taken.has(w.toLowerCase()));
  return [...rest, ...used].sort((a, b) => a.localeCompare(b));
}

// A category as it counts: '' when there is none.
export function categoryValue(raw) {
  const text = clean(raw);
  return text === NO_CATEGORY_WORD ? '' : text;
}

// stored      — the venue's saved list (config/orders), or null/undefined if it never saved
//               one. ⚠️ AN EMPTY ARRAY IS AN ANSWER: the venue deleted every category.
// ingredients — every ingredient, so a category already in use is offered too
// current     — the item being edited
export function categoryChoices({ stored, ingredients, language, current } = {}) {
  const base = Array.isArray(stored) ? stored : defaultsFor(DEFAULT_CATEGORIES, language);
  const used = (ingredients || []).map(i => categoryValue(i?.category));
  return choices(base, [...used, categoryValue(current)]);
}

export function unitChoices({ ingredients, language, current } = {}) {
  const used = (ingredients || []).map(i => i?.unit);
  return choices(defaultsFor(DEFAULT_UNITS, language), [...used, current]);
}

// How many ingredients sit in `category` (case-insensitive, after trimming).
export function countInCategory(ingredients, category) {
  const key = clean(category).toLowerCase();
  if (!key) return 0;
  return (ingredients || []).filter(i => categoryValue(i?.category).toLowerCase() === key).length;
}

// «+ New …» was picked in a menu and its text box was left empty: saving would silently clear
// the category or the unit, so the card blocks it instead.
export function isBlankNewChoice(isNew, typed) {
  return isNew === true && clean(typed) === '';
}
