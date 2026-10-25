// recipe-shelf.ts — where a recipe sits on the Recipe catalogue's shelf: the one CATEGORY it is filed under, from the venue's
// own list, and whether it is ARCHIVED (kept, out of the list, still linked everywhere). PURE: no DOM, no storage, no words —
// the screens say everything in the person's language.
//
// NEW IN MISE 2, NOT A PORT (Federico's request 23 Oct 2026, «dividere per categorie le ricette, tipo ricette stagionali; finita
// la stagione le voglio poter archiviare per snellire la lista»; the details decided 24 Oct 2026): the current app has neither.
// Used by three sections — the Recipe catalogue groups its list and edits the list of words, the Calculator and Food cost leave
// an archived recipe out of the choices for a NEW link — so it lives here, once.
//
// The data (firestore.rules, `recipes` and `config/labels`):
//   • recipes/{id}.category — a string, 1–100 characters; «no category» is NO FIELD (an emptied choice travels as a removal).
//     A word that is not on the venue's list (taken off it) reads as «no category», and comes back if the word is put back.
//   • recipes/{id}.archived — `true`, or no field. Archiving and restoring are owner/manager only (the rules ask the role only
//     when the flag moves). ⚠️ An archived recipe is NEVER hidden from what already points at it: a Calculator tab, a Food cost
//     product, a sub-recipe row, a label — they read recipes by id and keep working. Only the list and the pickers change.
//   • config/labels.recipeCategories — the venue's list, a list of strings (≤ 100 entries), written whole.

// The longest word the Settings box takes (the rules allow 100: room to spare for a word stored by a later version).
export const RECIPE_CATEGORY_MAX = 40;
// The rules' cap on the list.
export const RECIPE_CATEGORIES_MAX = 100;

// Two category words are the same word whatever their case and their spaces: «Natale» and «natale » are one category, so the list
// never holds both and a recipe filed under one is in the other.
export function categoryKey(word: unknown): string {
  return typeof word === 'string' ? word.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
}

// The venue's list as stored, made safe: only strings with something in them, trimmed, each word once (the first spelling
// wins), at most RECIPE_CATEGORIES_MAX. Anything else (no list, a corrupt value) is no list.
export function normalizeRecipeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const word = item.trim().replace(/\s+/g, ' ');
    const key = categoryKey(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= RECIPE_CATEGORIES_MAX) break;
  }
  return out;
}

// The list in the order a person reads it: alphabetical in the interface language, case and accents aside.
export function sortedCategories(list: readonly string[], locale?: string): string[] {
  return list.slice().sort((a, b) => a.localeCompare(b, locale, { sensitivity: 'base' }));
}

// The category word a recipe holds, as stored (trimmed), or '' for none.
export function storedCategoryOf(recipe: unknown): string {
  const value = recipe && typeof recipe === 'object' ? (recipe as { category?: unknown }).category : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

// The category a recipe is in, SPELLED AS THE LIST SPELLS IT, or '' when it holds none or a word the list does not have.
export function categoryOf(recipe: unknown, list: readonly string[]): string {
  const key = categoryKey(storedCategoryOf(recipe));
  if (!key) return '';
  return list.find(word => categoryKey(word) === key) ?? '';
}

// Whether a recipe is archived: only a literal `true` (a corrupt value is not archived — the recipe stays in sight).
export function isArchivedRecipe(recipe: unknown): boolean {
  return Boolean(recipe && typeof recipe === 'object' && (recipe as { archived?: unknown }).archived === true);
}

// The recipes a person may choose for a NEW link (a Calculator tab, a Food cost line, a sub-recipe row): every recipe but the
// archived ones. Never for what already points at a recipe — that keeps reading it by id.
export function withoutArchived<T>(recipes: readonly T[]): T[] {
  return recipes.filter(recipe => !isArchivedRecipe(recipe));
}

// The two fields a stored recipe document carries for the shelf, as the store keeps them beside the shared normaliser's
// shape: the category word when there is one, `archived: true` when it is archived; nothing otherwise («absent rather than
// empty», like the rest of a recipe).
export function shelfFieldsOf(raw: unknown): { category?: string; archived?: true } {
  const out: { category?: string; archived?: true } = {};
  const category = storedCategoryOf(raw);
  if (category) out.category = category;
  if (isArchivedRecipe(raw)) out.archived = true;
  return out;
}

export type RecipeGroup<T> = {
  // The category's word as the list spells it, or '' for the recipes in none.
  readonly category: string;
  readonly recipes: readonly T[];
};

// The recipe list laid out on the shelf: the recipes that are not archived, grouped by their category in the list's order
// (`categories` as the screen orders it), then the ones in no category last; and the archived ones apart, for the folded
// group at the foot. Each group keeps the order the recipes came in (the caller sorts them first: most used first). A group
// with no recipe is left out, so a venue with no category in use gets ONE group, '' — the list as it always was.
export function shelveRecipes<T>(recipes: readonly T[], categories: readonly string[]): {
  groups: RecipeGroup<T>[];
  archived: T[];
} {
  const byKey = new Map<string, T[]>();
  const none: T[] = [];
  const archived: T[] = [];
  for (const recipe of recipes) {
    if (isArchivedRecipe(recipe)) { archived.push(recipe); continue; }
    const word = categoryOf(recipe, categories);
    if (!word) { none.push(recipe); continue; }
    const key = categoryKey(word);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(recipe); else byKey.set(key, [recipe]);
  }
  const groups: RecipeGroup<T>[] = [];
  for (const word of categories) {
    const bucket = byKey.get(categoryKey(word));
    if (bucket && bucket.length) groups.push({ category: word, recipes: bucket });
  }
  if (none.length) groups.push({ category: '', recipes: none });
  return { groups, archived };
}

// How many recipes are filed under a word of the list, archived ones included (all of them leave it if the word goes).
export function countInCategory(recipes: readonly unknown[], word: string, categories: readonly string[]): number {
  const key = categoryKey(word);
  if (!key) return 0;
  return recipes.filter(recipe => categoryKey(categoryOf(recipe, categories)) === key).length;
}

export type CategoryRefusal = 'empty' | 'tooLong' | 'taken' | 'full';

// Adds a word to the list (at the end: the screens sort it). The word is trimmed and its inner spaces folded; refused when
// empty, longer than RECIPE_CATEGORY_MAX, already on the list (whatever the case), or the list is full.
export function addCategory(list: readonly string[], typed: unknown): { list: string[] } | { refusal: CategoryRefusal } {
  const word = typeof typed === 'string' ? typed.trim().replace(/\s+/g, ' ') : '';
  if (!word) return { refusal: 'empty' };
  if (word.length > RECIPE_CATEGORY_MAX) return { refusal: 'tooLong' };
  const key = categoryKey(word);
  if (list.some(held => categoryKey(held) === key)) return { refusal: 'taken' };
  if (list.length >= RECIPE_CATEGORIES_MAX) return { refusal: 'full' };
  return { list: [...list, word] };
}

// Takes a word off the list (whatever the case). The recipes filed under it are NOT rewritten: they read as «no category»
// until the word comes back.
export function removeCategory(list: readonly string[], word: string): string[] {
  const key = categoryKey(word);
  return list.filter(held => categoryKey(held) !== key);
}
