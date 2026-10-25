// The addresses of the Recipe catalogue, in one place so the section, the list's rows and the screens
// one level down cannot disagree.
//
//   /recipes          the list of recipes
//   /recipes/<id>     one recipe (the id percent-encoded)
//   /recipes/allergens  the Allergen sheet (step 3d-2)
//   /recipes/<id>/label the label of one recipe (step 3d-3), one level below the recipe
//   anything else     unknown: the section goes back to /recipes
//
// ⚠️ THE WORDS A LATER STEP WILL TAKE AS ITS OWN ARE NEVER A RECIPE'S ID (`new`, `allergens`,
// `settings`, `photo`): a Firestore auto id is 20 characters, so none of them can be one, and a recipe
// address that happens to be one of them must not be taken for a recipe that does not exist.
// recipesPath.spec.ts pins the list.
export const RECIPES_PATH = '/recipes';
export const ALLERGENS_PATH = '/recipes/allergens';

const RESERVED = ['new', 'allergens', 'settings', 'photo'] as const;

export type RecipesView =
  | { readonly kind: 'list' }
  | { readonly kind: 'recipe'; readonly id: string }
  | { readonly kind: 'allergens' }
  | { readonly kind: 'label'; readonly id: string }
  | { readonly kind: 'unknown' };

export const recipePath = (id: string): string => `${RECIPES_PATH}/${encodeURIComponent(id)}`;
export const labelPath = (id: string): string => `${recipePath(id)}/label`;

// Whether an id (already decoded) can be a recipe's: not empty, and not a word a step has taken for its own.
const isRecipeId = (id: string | null): id is string => id !== null && id !== '' && !(RESERVED as readonly string[]).includes(id);

// A segment as it was typed, back to the id it stands for; null when it is not valid percent-
// encoding («%», «%E0%A4%A»).
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// `rest` is what follows /recipes in the address AS IT IS WRITTEN: each segment is split first and
// decoded after, so an id with a slash, a percent sign or a space in it comes back whole (React
// Router's own «*» parameter has already decoded the address once).
export function parseRecipesPath(rest: string | undefined): RecipesView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  if (parts.length === 0) return { kind: 'list' };
  const [first] = parts;
  if (parts.length === 1 && first !== undefined) {
    const id = decoded(first);
    // The Allergen sheet (step 3d-2) is one of the reserved words: never a recipe whose id is «allergens».
    if (id === 'allergens') return { kind: 'allergens' };
    // An empty id is not a recipe (and not a Firestore document id either).
    if (isRecipeId(id)) return { kind: 'recipe', id };
  }
  // `<id>/label`: the label of that recipe. The id is read by the same rule as a recipe's own, so a reserved word
  // before «label» (`/allergens/label`) is no recipe's label.
  const second = parts[1];
  if (parts.length === 2 && first !== undefined && second === 'label') {
    const id = decoded(first);
    if (isRecipeId(id)) return { kind: 'label', id };
  }
  return { kind: 'unknown' };
}

// The views that are drawn: an unknown address is only ever a redirect.
export type ShownView = Exclude<RecipesView, { readonly kind: 'unknown' }>;

export type Resolved = { readonly redirect: string } | { readonly view: ShownView };

export function resolveRecipesPath(rest: string | undefined): Resolved {
  const view = parseRecipesPath(rest);
  if (view.kind === 'unknown') return { redirect: RECIPES_PATH };
  return { view };
}
