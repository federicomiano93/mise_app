// The addresses of the Calculator, in one place so the section and the tab strip cannot disagree.
//
//   /calculator                              the first visible recipe
//   /calculator/<recipeId>                   that recipe's tab (the id percent-encoded)
//   /calculator/settings                     Settings (the hub)
//   /calculator/settings/extra               Extra dough
//   /calculator/settings/divisor             Divisor: pick a recipe
//   /calculator/settings/divisor/<recipeId>  that recipe's products
//   /calculator/settings/log                 Dough history settings
//   /calculator/settings/clients[/<id>|/new] Clients       — parsed now, drawn by a later slice
//   /calculator/settings/recipes[/<id>|/new] Recipes       — parsed now, drawn by a later slice
//   any other /calculator/settings/…         unknown: back to /calculator/settings
//   anything else                            unknown: the section goes back to /calculator
//
// The tab is in the address so that Back, a reload and a link sent to a colleague land on the same
// tab. An id the venue does not (or no longer) show falls back to the first visible recipe.
//
// ⚠️ `settings` AS THE FIRST SEGMENT ALWAYS MEANS SETTINGS. A recipe whose id is literally «settings» therefore
// has no tab address of its own; generated ids («r-…», «cat-…») are never that word, and neither is `new` as a
// client's or a recipe's id (it would open the «new» editor, not that client).
export const CALCULATOR_PATH = '/calculator';
export const SETTINGS_PATH = `${CALCULATOR_PATH}/settings`;
export const extraPath = `${SETTINGS_PATH}/extra`;
export const divisorPath = `${SETTINGS_PATH}/divisor`;
export const logSettingsPath = `${SETTINGS_PATH}/log`;
export const clientsPath = `${SETTINGS_PATH}/clients`;
export const newClientPath = `${clientsPath}/new`;
export const recipesPath = `${SETTINGS_PATH}/recipes`;
export const newRecipePath = `${recipesPath}/new`;

const encoded = (id: string): string => encodeURIComponent(id);

export const recipePath = (id: string): string => `${CALCULATOR_PATH}/${encoded(id)}`;
export const divisorRecipePath = (id: string): string => `${divisorPath}/${encoded(id)}`;
export const clientPath = (id: string): string => `${clientsPath}/${encoded(id)}`;
export const recipeSettingsPath = (id: string): string => `${recipesPath}/${encoded(id)}`;

// What a list screen of Settings (Clients, Recipes) is pointed at.
export type SettingsTarget =
  | { readonly kind: 'list' }
  | { readonly kind: 'new' }
  | { readonly kind: 'one'; readonly id: string };

export type SettingsView =
  | { readonly kind: 'hub' }
  | { readonly kind: 'extra' }
  | { readonly kind: 'log' }
  | { readonly kind: 'divisor'; readonly recipeId: string | null }
  | { readonly kind: 'clients'; readonly target: SettingsTarget }
  | { readonly kind: 'recipes'; readonly target: SettingsTarget }
  | { readonly kind: 'unknown' };

// The screens of Settings that are drawn today.
export type DrawnSettingsView = Exclude<SettingsView, { readonly kind: 'clients' | 'recipes' | 'unknown' }>;

export type CalculatorView =
  | { readonly kind: 'home' }
  | { readonly kind: 'recipe'; readonly id: string }
  | { readonly kind: 'settings'; readonly view: SettingsView }
  | { readonly kind: 'unknown' };

// A segment as it was typed, back to the id it stands for; null when it is not valid percent-encoding.
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// An id segment: the id it stands for, or null for an empty or malformed one (an empty id is not a Firestore
// document id either).
function idOf(segment: string | undefined): string | null {
  if (segment === undefined) return null;
  const id = decoded(segment);
  return id === null || id === '' ? null : id;
}

function targetOf(tail: readonly string[]): SettingsTarget | null {
  if (tail.length === 0) return { kind: 'list' };
  if (tail.length > 1) return null;
  if (tail[0] === 'new') return { kind: 'new' };
  const id = idOf(tail[0]);
  return id === null ? null : { kind: 'one', id };
}

// What follows /calculator/settings, segment by segment.
function parseSettings(tail: readonly string[]): SettingsView {
  const [screen, ...more] = tail;
  if (screen === undefined) return { kind: 'hub' };
  if (screen === 'extra' && more.length === 0) return { kind: 'extra' };
  if (screen === 'log' && more.length === 0) return { kind: 'log' };
  if (screen === 'divisor') {
    if (more.length === 0) return { kind: 'divisor', recipeId: null };
    const recipeId = more.length === 1 ? idOf(more[0]) : null;
    return recipeId === null ? { kind: 'unknown' } : { kind: 'divisor', recipeId };
  }
  if (screen === 'clients' || screen === 'recipes') {
    const target = targetOf(more);
    return target === null ? { kind: 'unknown' } : { kind: screen, target };
  }
  return { kind: 'unknown' };
}

// `rest` is what follows /calculator in the address AS IT IS WRITTEN: the segments are split first and
// decoded after, so a recipe id with a slash or a percent sign in it (it is a Firestore document id) comes
// back whole. React Router's own «*» parameter is not used: it has already decoded the address once.
export function parseCalculatorPath(rest: string | undefined): CalculatorView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  if (parts.length === 0) return { kind: 'home' };
  const [first, ...tail] = parts;
  if (first === 'settings') {
    return { kind: 'settings', view: parseSettings(tail) };
  }
  if (parts.length === 1) {
    const id = idOf(first);
    if (id !== null) return { kind: 'recipe', id };
  }
  return { kind: 'unknown' };
}

export type Resolved =
  // Replace the address with this one.
  | { readonly redirect: string }
  // A screen of Settings to draw.
  | { readonly settings: DrawnSettingsView }
  // The tab to draw; null when the venue shows no recipe at all (the empty states).
  | { readonly active: string | null };

// `visibleIds` are the recipes shown as tabs, in order (getVisibleRecipes).
//
// ⚠️ WITH NO VISIBLE RECIPE THE ADDRESS IS LEFT ALONE. Until the configuration has answered there are
// none, and sending `/calculator/<id>` to `/calculator` then would lose the tab a link pointed at before
// anybody could say whether it exists.
//
// The Clients and Recipes screens are reserved addresses: a later slice draws them, and until then they
// go to the hub rather than to a blank page; so does any other address under Settings.
export function resolveCalculatorPath(rest: string | undefined, visibleIds: readonly string[]): Resolved {
  const view = parseCalculatorPath(rest);
  if (view.kind === 'unknown') return { redirect: CALCULATOR_PATH };
  if (view.kind === 'settings') {
    const { view: screen } = view;
    if (screen.kind === 'clients' || screen.kind === 'recipes' || screen.kind === 'unknown') {
      return { redirect: SETTINGS_PATH };
    }
    return { settings: screen };
  }
  const first = visibleIds[0] ?? null;
  if (view.kind === 'home') return { active: first };
  if (first === null) return { active: null };
  if (visibleIds.includes(view.id)) return { active: view.id };
  return { redirect: recipePath(first) };
}
