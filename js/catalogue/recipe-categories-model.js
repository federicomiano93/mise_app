// recipe-categories-model.js — the one CATEGORY a recipe is filed under, from the venue's own
// list. PURE: no DOM, no storage, no words — the screens say everything in the person's language.
//
// Federico, 1 Nov 2026: «creare delle categorie dentro il ricettario». ⚠️ THE SAME DATA AS MISE 2
// (shared/src/recipe-shelf.ts on its branch, PR #404), so nothing moves at the switch:
//   • recipes/{id}.category — a string, 1–100 characters; «no category» is NO field (an emptied
//     choice travels as a removal). A word that is not on the venue's list (taken off it) reads as
//     «no category», and comes back if the word is put back — so deleting a category writes no recipe.
//   • config/labels.recipeCategories — the venue's list, a list of strings (≤ 100), written whole.

// The longest word the Settings box takes (the rules allow 100: room for a word stored by a later version).
export const RECIPE_CATEGORY_MAX = 40;
// The rules' cap on the list.
export const RECIPE_CATEGORIES_MAX = 100;

function tidyWord(word) {
  return typeof word === 'string' ? word.trim().replace(/\s+/g, ' ') : '';
}

// Two category words are the same word whatever their case and their spaces: «Natale» and «natale »
// are one category, so the list never holds both and a recipe filed under one is in the other.
export function categoryKey(word) {
  return tidyWord(word).toLocaleLowerCase();
}

// The venue's list as stored, made safe: only strings with something in them, tidied, each word once
// (the first spelling wins), at most RECIPE_CATEGORIES_MAX. Anything else (no list, a corrupt value) is no list.
export function normalizeRecipeCategories(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const word = tidyWord(item);
    const key = categoryKey(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= RECIPE_CATEGORIES_MAX) break;
  }
  return out;
}

// The list in the order a person reads it: alphabetical in the interface language, case and accents aside.
export function sortedCategories(list, locale) {
  return list.slice().sort((a, b) => a.localeCompare(b, locale, { sensitivity: 'base' }));
}

// The category a recipe is in, SPELLED AS THE LIST SPELLS IT, or '' when it holds none or a word the list does not have.
export function categoryOf(recipe, list) {
  const key = categoryKey(recipe && recipe.category);
  if (!key) return '';
  return list.find(word => categoryKey(word) === key) || '';
}

// The recipes grouped by their category, in the order of `categories` (as the screen orders it), then
// the ones in no category last. Each group keeps the order the recipes came in (the caller sorts them
// first: most used first). A group with no recipe is left out, so a venue with no category in use gets
// ONE group, '' — the list as it always was.
export function groupByCategory(recipes, categories) {
  const byKey = new Map();
  const none = [];
  for (const recipe of recipes) {
    const word = categoryOf(recipe, categories);
    if (!word) { none.push(recipe); continue; }
    const key = categoryKey(word);
    if (byKey.has(key)) byKey.get(key).push(recipe); else byKey.set(key, [recipe]);
  }
  const groups = [];
  for (const word of categories) {
    const bucket = byKey.get(categoryKey(word));
    if (bucket) groups.push({ category: word, recipes: bucket });
  }
  if (none.length) groups.push({ category: '', recipes: none });
  return groups;
}

// How many recipes are filed under a word of the list (all of them leave it if the word goes).
export function countInCategory(recipes, word, categories) {
  const key = categoryKey(word);
  if (!key) return 0;
  return recipes.filter(recipe => categoryKey(categoryOf(recipe, categories)) === key).length;
}

// Adds a word to the list (at the end: the screens sort it). Answers { list } or { refusal }, and
// refuses a word that is empty, longer than RECIPE_CATEGORY_MAX, already on the list (whatever the
// case), or a list that is full.
export function addCategory(list, typed) {
  const word = tidyWord(typed);
  if (!word) return { refusal: 'empty' };
  if (word.length > RECIPE_CATEGORY_MAX) return { refusal: 'tooLong' };
  const key = categoryKey(word);
  if (list.some(held => categoryKey(held) === key)) return { refusal: 'taken' };
  if (list.length >= RECIPE_CATEGORIES_MAX) return { refusal: 'full' };
  return { list: [...list, word] };
}

// Takes a word off the list (whatever the case). The recipes filed under it are NOT rewritten: they
// read as «no category» until the word comes back.
export function removeCategory(list, word) {
  const key = categoryKey(word);
  return list.filter(held => categoryKey(held) !== key);
}
