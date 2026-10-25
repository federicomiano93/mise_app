// The addresses of the Calculator, in one place so the section and the tab strip cannot disagree.
//
//   /calculator                              the first visible recipe
//   /calculator/<recipeId>                   that recipe's tab (the id percent-encoded)
//   /calculator/settings                     Settings (the hub)
//   /calculator/settings/extra               Extra dough
//   /calculator/settings/divisor             Divisor: pick a recipe
//   /calculator/settings/divisor/<recipeId>  that recipe's products
//   /calculator/settings/log                 Dough history settings
//   /calculator/settings/clients             Clients: the address book
//   /calculator/settings/clients/<id>        one client (an id the working copy lacks goes back to the list)
//   /calculator/settings/clients/new         the list (a client is made by «Add client», which opens it by its id)
//   /calculator/settings/recipes             Recipes: the list, an accordion
//   /calculator/settings/recipes/<id>        one recipe (an id the working copy lacks goes back to the list)
//   /calculator/settings/recipes/new         makes a fresh empty recipe and replaces itself with the recipe's address
//   any other /calculator/settings/…         unknown: back to /calculator/settings
//   /calculator/log                          the Dough history: the list of logs
//   /calculator/log/new                      Add log (a log made by hand)
//   /calculator/log/<id>                     one log, read-only
//   /calculator/log/<id>/edit                Edit log (a log made by hand)
//   /calculator/log/<id>/history             its versions, newest first
//   /calculator/log/<id>/history/<n>         version n of it (1-based)
//   any other /calculator/log/...            unknown: back to /calculator/log
//   anything else                            unknown: the section goes back to /calculator
//
// The tab is in the address so that Back, a reload and a link sent to a colleague land on the same
// tab. An id the venue does not (or no longer) show falls back to the first visible recipe.
//
// ⚠️ `settings` AS THE FIRST SEGMENT ALWAYS MEANS SETTINGS. A recipe whose id is literally «settings» therefore
// has no tab address of its own; generated ids («r-…», «cat-…») are never that word, and neither is `new` as a
// client's or a recipe's id (it would open the «new» editor, not that client).
//
// ⚠️ `log` AS THE FIRST SEGMENT ALWAYS MEANS THE DOUGH HISTORY, the same way: a recipe whose id is literally «log»
// has no tab address of its own. And `new` as the id of a LOG would open «Add log», not that log (generated log ids
// are never that word).
export const CALCULATOR_PATH = '/calculator';
export const SETTINGS_PATH = `${CALCULATOR_PATH}/settings`;
export const extraPath = `${SETTINGS_PATH}/extra`;
export const divisorPath = `${SETTINGS_PATH}/divisor`;
export const logSettingsPath = `${SETTINGS_PATH}/log`;
export const clientsPath = `${SETTINGS_PATH}/clients`;
export const newClientPath = `${clientsPath}/new`;
export const recipesPath = `${SETTINGS_PATH}/recipes`;
export const newRecipePath = `${recipesPath}/new`;
export const LOG_PATH = `${CALCULATOR_PATH}/log`;
export const newLogPath = `${LOG_PATH}/new`;

const encoded = (id: string): string => encodeURIComponent(id);

export const recipePath = (id: string): string => `${CALCULATOR_PATH}/${encoded(id)}`;
export const divisorRecipePath = (id: string): string => `${divisorPath}/${encoded(id)}`;
export const clientPath = (id: string): string => `${clientsPath}/${encoded(id)}`;
export const recipeSettingsPath = (id: string): string => `${recipesPath}/${encoded(id)}`;
export const logViewPath = (id: string): string => `${LOG_PATH}/${encoded(id)}`;
export const logEditPath = (id: string): string => `${logViewPath(id)}/edit`;
export const logHistoryPath = (id: string): string => `${logViewPath(id)}/history`;
// `n` is the version's number as a person counts it: 1 is the first.
export const logVersionPath = (id: string, n: number): string => `${logHistoryPath(id)}/${n}`;

// Whether an address belongs to the Clients editor (the list or one client): moving between them keeps its working
// copy, so it is never leaving.
export const inClientsEditor = (pathname: string): boolean => pathname === clientsPath || pathname.startsWith(`${clientsPath}/`);

// Whether an address belongs to the Recipes editor (the list or one recipe): moving between them keeps its working
// copy, so it is never leaving.
export const inRecipesEditor = (pathname: string): boolean => pathname === recipesPath || pathname.startsWith(`${recipesPath}/`);

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

// The screens of Settings that are drawn.
export type DrawnSettingsView = Exclude<SettingsView, { readonly kind: 'unknown' }>;

// The screens of the Dough history. `n` is 1-based, as it is written in the address.
export type LogView =
  | { readonly kind: 'list' }
  | { readonly kind: 'new' }
  | { readonly kind: 'one'; readonly id: string }
  | { readonly kind: 'edit'; readonly id: string }
  | { readonly kind: 'history'; readonly id: string }
  | { readonly kind: 'version'; readonly id: string; readonly n: number }
  | { readonly kind: 'unknown' };

export type DrawnLogView = Exclude<LogView, { readonly kind: 'unknown' }>;

export type CalculatorView =
  | { readonly kind: 'home' }
  | { readonly kind: 'recipe'; readonly id: string }
  | { readonly kind: 'settings'; readonly view: SettingsView }
  | { readonly kind: 'log'; readonly view: LogView }
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

// What follows /calculator/log, segment by segment. A version number is a plain positive integer: «0», «-1», «1.5»
// and «abc» are no version.
function parseLog(tail: readonly string[]): LogView {
  const [first, second, third, ...more] = tail;
  if (first === undefined) return { kind: 'list' };
  if (first === 'new') return tail.length === 1 ? { kind: 'new' } : { kind: 'unknown' };
  const id = idOf(first);
  if (id === null || more.length > 0) return { kind: 'unknown' };
  if (second === undefined) return { kind: 'one', id };
  if (second === 'edit' && third === undefined) return { kind: 'edit', id };
  if (second === 'history') {
    if (third === undefined) return { kind: 'history', id };
    return /^[1-9]\d{0,5}$/.test(third) ? { kind: 'version', id, n: Number(third) } : { kind: 'unknown' };
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
  if (first === 'log') {
    return { kind: 'log', view: parseLog(tail) };
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
  // A screen of the Dough history to draw.
  | { readonly log: DrawnLogView }
  // The tab to draw; null when the venue shows no recipe at all (the empty states).
  | { readonly active: string | null };

// `visibleIds` are the recipes shown as tabs, in order (getVisibleRecipes).
//
// ⚠️ WITH NO VISIBLE RECIPE THE ADDRESS IS LEFT ALONE. Until the configuration has answered there are
// none, and sending `/calculator/<id>` to `/calculator` then would lose the tab a link pointed at before
// anybody could say whether it exists.
//
// Any unknown address under the Dough history goes to its list. Whether a log exists is the screen's business (the
// logs may not have arrived yet), so a well-formed address is never redirected on that account.
//
// Any unknown address under Settings goes to the hub. `clients/new` is not a screen of its own: a client is made by
// «Add client», which opens the new client by its id, so the bare word goes to the list. `recipes/new` IS one: it
// makes a fresh recipe (the work view's «Add a recipe» opens it) and replaces itself with the recipe's own address.
export function resolveCalculatorPath(rest: string | undefined, visibleIds: readonly string[]): Resolved {
  const view = parseCalculatorPath(rest);
  if (view.kind === 'unknown') return { redirect: CALCULATOR_PATH };
  if (view.kind === 'settings') {
    const { view: screen } = view;
    if (screen.kind === 'unknown') return { redirect: SETTINGS_PATH };
    if (screen.kind === 'clients' && screen.target.kind === 'new') return { redirect: clientsPath };
    return { settings: screen };
  }
  if (view.kind === 'log') {
    return view.view.kind === 'unknown' ? { redirect: LOG_PATH } : { log: view.view };
  }
  const first = visibleIds[0] ?? null;
  if (view.kind === 'home') return { active: first };
  if (first === null) return { active: null };
  if (visibleIds.includes(view.id)) return { active: view.id };
  return { redirect: recipePath(first) };
}
