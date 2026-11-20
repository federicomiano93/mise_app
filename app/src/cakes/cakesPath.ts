// The addresses of «Cakes» (20 Nov 2026), in one place so the section and the shell's usage names cannot disagree.
//
//   /cakes             the list of cakes
//   /cakes/new         a new cake's editor
//   /cakes/reference   the reference grams
//   /cakes/<id>        one cake's editor
//   anything deeper    unknown: the section goes back to the list
export const CAKES_PATH = '/cakes';

// What the usage record calls each screen (shell/sections.ts, screenNameFor). `rest` is what follows /cakes in the address.
// A junk address is sent back to the list, so it is counted as the list, the screen a person actually sees.
export function cakesScreenName(rest: string): string {
  const parts = rest.split('/').filter(part => part !== '');
  if (parts.length !== 1) return 'cakes';
  if (parts[0] === 'reference') return 'cakes-reference';
  return 'cakes-editor';
}
