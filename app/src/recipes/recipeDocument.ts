// recipeDocument.ts — the fields a recipe's save sends, in ONE place: the store's saveRecipe builds its document here, and a section
// that creates a recipe on its own (Cakes' «+ New recipe») builds the very same one, so the two can never drift apart.
//
// ⚠️ THE FIELDS ARE LISTED BY HAND: this object becomes the Firestore document and the rules whitelist its keys by name, so spreading
// the recipe would send `id` (and anything else it carries) and every save would be refused.
import { labelFieldsOf } from '@mise/shared/catalogue-model';
import { withRowIds } from '@mise/shared/guided-model';
import { labelTextPatchOf } from './labelTexts';
import type { RecipeToSave } from './recipesStore';

// The rules' bound on a recipe's category word (firestore.rules, `recipes`).
const CATEGORY_FIELD_MAX = 100;

// What a save sends for the category, from what the editor handed over (see RecipeToSave.category).
function categoryPatchOf(recipe: RecipeToSave): { category?: string | null } {
  if (typeof recipe.category !== 'string') return {};
  const word = recipe.category.trim().slice(0, CATEGORY_FIELD_MAX);
  return { category: word === '' ? null : word };
}

// The document a save writes for `recipe`, its rows already given their ids (withRowIds).
export function recipeDataOf(recipe: RecipeToSave, rows: readonly unknown[]): Record<string, unknown> {
  return {
    name: recipe.name,
    ingredients: rows,
    // A number, or null for an emptied box, which the source sends as a removal.
    ...labelFieldsOf(recipe),
    // The image label's texts only when the editor handed them over (null = emptied, a removal too).
    ...labelTextPatchOf(recipe),
    // The category only when the person moved the choice (null = «no category», a removal).
    ...categoryPatchOf(recipe),
  };
}

// A recipe that has only a name, exactly as the catalogue's save writes it. A `null` is the data layer's «take this field away»; a NEW
// document has nothing to take away, so it is simply left out (the same document the source's merge write leaves in the database).
export function newRecipeData(name: string): Record<string, unknown> {
  const data = recipeDataOf({ name, ingredients: [] }, withRowIds([]));
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null));
}
