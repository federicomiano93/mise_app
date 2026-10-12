// The addresses of the Calculator, in one place so the section and the tab strip cannot disagree.
//
//   /calculator              the first visible recipe
//   /calculator/<recipeId>   that recipe's tab (the id percent-encoded)
//   anything else            unknown: the section goes back to /calculator
//
// The tab is in the address so that Back, a reload and a link sent to a colleague land on the same
// tab. An id the venue does not (or no longer) show falls back to the first visible recipe.
export const CALCULATOR_PATH = '/calculator';

export const recipePath = (id: string): string => `${CALCULATOR_PATH}/${encodeURIComponent(id)}`;

export type CalculatorView =
  | { readonly kind: 'home' }
  | { readonly kind: 'recipe'; readonly id: string }
  | { readonly kind: 'unknown' };

// A segment as it was typed, back to the id it stands for; null when it is not valid percent-encoding.
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// `rest` is what follows /calculator in the address AS IT IS WRITTEN: the segments are split first and
// decoded after, so a recipe id with a slash or a percent sign in it (it is a Firestore document id) comes
// back whole. React Router's own «*» parameter is not used: it has already decoded the address once.
export function parseCalculatorPath(rest: string | undefined): CalculatorView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  if (parts.length === 0) return { kind: 'home' };
  const [first] = parts;
  if (parts.length === 1 && first !== undefined) {
    const id = decoded(first);
    if (id !== null && id !== '') return { kind: 'recipe', id };
  }
  return { kind: 'unknown' };
}

export type Resolved =
  // Replace the address with this one.
  | { readonly redirect: string }
  // The tab to draw; null when the venue shows no recipe at all (the empty states).
  | { readonly active: string | null };

// `visibleIds` are the recipes shown as tabs, in order (getVisibleRecipes).
//
// ⚠️ WITH NO VISIBLE RECIPE THE ADDRESS IS LEFT ALONE. Until the configuration has answered there are
// none, and sending `/calculator/<id>` to `/calculator` then would lose the tab a link pointed at before
// anybody could say whether it exists.
export function resolveCalculatorPath(rest: string | undefined, visibleIds: readonly string[]): Resolved {
  const view = parseCalculatorPath(rest);
  if (view.kind === 'unknown') return { redirect: CALCULATOR_PATH };
  const first = visibleIds[0] ?? null;
  if (view.kind === 'home') return { active: first };
  if (first === null) return { active: null };
  if (visibleIds.includes(view.id)) return { active: view.id };
  return { redirect: recipePath(first) };
}
