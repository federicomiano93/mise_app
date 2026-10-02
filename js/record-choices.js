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

// The stored «no category» word: a blank category is saved as 'Other', and reads back as blank.
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

// «+ Nuovo fornitore…» is the last option of the supplier menu; this is its value. It is a MARKER,
// never a supplier: whatever is saved goes through supplierToSave.
export const NEW_SUPPLIER_CHOICE = '__mise_new_supplier__';

// The supplier id to SAVE: the menu's value, unless it still shows the «+ Nuovo fornitore…» marker
// (the supplier card was cancelled or failed, or a save raced it) — then the last real value.
export function supplierToSave(value, previous) {
  return value === NEW_SUPPLIER_CHOICE ? previous : value;
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

// ── «Confezione»: what ONE package of the weight is (busta, sacco…) ─────────────
// Same venue-data rule as the words above: the defaults follow the venue's OUTPUT language.
export const DEFAULT_PACKS = Object.freeze({
  it: Object.freeze(['busta', 'sacco', 'bottiglia', 'barattolo', 'scatola', 'vaschetta', 'pezzo']),
  en: Object.freeze(['bag', 'sack', 'bottle', 'jar', 'box', 'tub', 'piece']),
});

// The defaults plus every packUnit an ingredient already uses (case-insensitive, an in-use
// spelling wins over a default), plus the item's own current value in its exact spelling.
export function packChoices({ ingredients, language, current } = {}) {
  const used = (ingredients || []).map(i => i?.packUnit);
  return choices(defaultsFor(DEFAULT_PACKS, language), [...used, current]);
}

// ── «Confezione: Cartone» — the words the card writes for it ──────────────────
// Same venue-data rule: the venue's OUTPUT language decides them, never the screen's.
// ⚠️ THE ORDER UNIT OF A CARTON IS WRITTEN BY THE CARD, NOT TYPED (1 Oct 2026): the «Unità
// d'ordine» menu is gone, and a card that says «Cartone» stores this word in `unit` (unless the
// item already carries a carton word of its own — js/pack-format.js keeps that one).
export const CARTON_WORD = Object.freeze({ it: 'cartone', en: 'case' });
export const cartonWordFor = (language) => defaultsFor(CARTON_WORD, language);

// The order unit a NEW loose item gets from the way it is priced («al kg», «al litro», «al
// pezzo»): the same words the old «Unità d'ordine» menu offered for them.
export const LOOSE_UNIT_WORDS = Object.freeze({
  it: Object.freeze({ kg: 'kg', l: 'l', pcs: 'pz' }),
  en: Object.freeze({ kg: 'kg', l: 'l', pcs: 'pcs' }),
});
export const looseUnitFor = (priceUnit, language) => defaultsFor(LOOSE_UNIT_WORDS, language)[priceUnit] || '';

// What one item inside a carton is called when the card has to show it before anybody picked
// a word (a stored case of pieces whose ingredient names no package).
export const PIECE_WORD = Object.freeze({ it: 'pezzo', en: 'piece' });
export const pieceWordFor = (language) => defaultsFor(PIECE_WORD, language);

// The plural of the DEFAULT package words, for «Cartone da 4 buste». A small table, not a
// grammar: a word somebody typed in («+ Nuova…») is not in it and the caller falls back to
// «4 × parola». ⚠️ SINGULAR FOR ONE, and null for any word the table does not know.
const PACK_PLURALS = Object.freeze({
  it: Object.freeze({
    busta: 'buste', sacco: 'sacchi', bottiglia: 'bottiglie', barattolo: 'barattoli',
    scatola: 'scatole', vaschetta: 'vaschette', pezzo: 'pezzi',
  }),
  en: Object.freeze({
    bag: 'bags', sack: 'sacks', bottle: 'bottles', jar: 'jars', box: 'boxes', tub: 'tubs', piece: 'pieces',
  }),
});

export function packWordFor(word, count, language) {
  const key = clean(word).toLowerCase();
  const plural = defaultsFor(PACK_PLURALS, language)[key];
  if (!plural) return null;
  return Number(count) === 1 ? key : plural;
}

// The package word «Cartone» starts on when nothing was picked yet: the first default of the list
// (busta / bag), never the alphabetically first word of a menu.
export const defaultPackFor = (language) => defaultsFor(DEFAULT_PACKS, language)[0];
