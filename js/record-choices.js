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

// Trimmed, de-duplicated ignoring case (the FIRST spelling seen wins), sorted.
function tidy(words) {
  const seen = new Set();
  const out = [];
  for (const word of words) {
    const text = clean(word);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.sort((a, b) => a.localeCompare(b));
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
  return tidy([...base, ...used, categoryValue(current)]);
}

export function unitChoices({ ingredients, language, current } = {}) {
  const used = (ingredients || []).map(i => i?.unit);
  return tidy([...defaultsFor(DEFAULT_UNITS, language), ...used, current]);
}

// How many ingredients sit in `category` (case-insensitive, after trimming).
export function countInCategory(ingredients, category) {
  const key = clean(category).toLowerCase();
  if (!key) return 0;
  return (ingredients || []).filter(i => categoryValue(i?.category).toLowerCase() === key).length;
}
