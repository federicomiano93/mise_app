// The addresses of «Cakes» (20 Nov 2026), in one place so the section and the shell's usage names cannot disagree.
//
//   /cakes             the list of cakes
//   /cakes/new         a new cake's editor
//   /cakes/reference   the reference grams
//   /cakes/<id>        one cake's editor
//   anything deeper    unknown: the section goes back to the list
export const CAKES_PATH = '/cakes';

export const NEW_CAKE_SEGMENT = 'new';
export const REFERENCE_SEGMENT = 'reference';

export const newCakePath = `${CAKES_PATH}/${NEW_CAKE_SEGMENT}`;
export const referencePath = `${CAKES_PATH}/${REFERENCE_SEGMENT}`;

// ⚠️ A cake's id is made by makeDocumentId (letters and digits), so it is never `new` or `reference`; it is still encoded, so an
// id that could name another address never does.
export function cakePath(id: string): string {
  return `${CAKES_PATH}/${encodeURIComponent(id)}`;
}

export type CakesView =
  | { readonly kind: 'list' }
  | { readonly kind: 'new' }
  | { readonly kind: 'cake'; readonly id: string }
  | { readonly kind: 'reference' };

// `rest` is what follows /cakes in the address. Anything that is not one of the four addresses above reads as the list.
export function parseCakesPath(rest: string): CakesView {
  const parts = rest.split('/').filter(part => part !== '');
  if (parts.length !== 1) return { kind: 'list' };
  const [segment = ''] = parts;
  if (segment === REFERENCE_SEGMENT) return { kind: 'reference' };
  if (segment === NEW_CAKE_SEGMENT) return { kind: 'new' };
  try {
    return { kind: 'cake', id: decodeURIComponent(segment) };
  } catch {
    return { kind: 'list' };
  }
}

// What the usage record calls each screen (shell/sections.ts, screenNameFor). A junk address is sent back to the list, so it is
// counted as the list, the screen a person actually sees.
export function cakesScreenName(rest: string): string {
  const view = parseCakesPath(rest);
  if (view.kind === 'list') return 'cakes';
  return view.kind === 'reference' ? 'cakes-reference' : 'cakes-editor';
}

// How a NEW cake starts, chosen in the list's «How do you want to start?» dialog and carried to the editor in the navigation state
// (never saved): `standard` takes the venue's reference grams, `zero` starts with none, so every line needs its grams typed. A new
// cake opened by its address alone (a reload that lost the state, a bookmark) starts as `standard`, the way it always did.
export type CakeStart = 'standard' | 'zero';

export function startOf(state: unknown): CakeStart {
  return typeof state === 'object' && state !== null && 'cakeStart' in state && (state as { cakeStart: unknown }).cakeStart === 'zero' ? 'zero' : 'standard';
}
