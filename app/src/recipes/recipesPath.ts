// The addresses of the Recipe catalogue, in one place so the section, the list's rows and the screens
// one level down cannot disagree.
//
//   /recipes          the list of recipes
//   /recipes/<id>     one recipe (the id percent-encoded)
//   anything else     unknown: the section goes back to /recipes
//
// ⚠️ THE WORDS A LATER STEP WILL TAKE AS ITS OWN ARE NEVER A RECIPE'S ID (`new`, `allergens`,
// `settings`, `photo`): a Firestore auto id is 20 characters, so none of them can be one, and a recipe
// address that happens to be one of them must not be taken for a recipe that does not exist.
// recipesPath.spec.ts pins the list.
export const RECIPES_PATH = '/recipes';

const RESERVED = ['new', 'allergens', 'settings', 'photo'] as const;

export type RecipesView =
  | { readonly kind: 'list' }
  | { readonly kind: 'recipe'; readonly id: string }
  | { readonly kind: 'unknown' };

export const recipePath = (id: string): string => `${RECIPES_PATH}/${encodeURIComponent(id)}`;

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
    // An empty id is not a recipe (and not a Firestore document id either).
    if (id !== null && id !== '' && !(RESERVED as readonly string[]).includes(id)) return { kind: 'recipe', id };
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
