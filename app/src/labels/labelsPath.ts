// The addresses of «Labels» (the owner's «Etichette», 13 Nov 2026), in one place so the section, its screens and the
// shell's usage names cannot disagree.
//
//   /labels           the two choices: product label, HACCP label
//   /labels/product   the recipes, with a search box; a tap opens that recipe's product label
//   /labels/haccp     the recipes, with a search box; a tap opens that recipe's HACCP label
//   anything else     unknown: the section goes back to /labels
//
// ⚠️ THE LABEL ITSELF HAS NO ADDRESS HERE. A tap opens the Recipe catalogue's own label screen at its own address
// (`/recipes/<id>/label`, `/recipes/<id>/haccp`): the very screen the recipe's buttons open, never a copy of it.
export const LABELS_PATH = '/labels';

export type LabelKind = 'product' | 'haccp';

export const LABEL_KINDS: readonly LabelKind[] = ['product', 'haccp'];

export const labelListPath = (kind: LabelKind): string => `${LABELS_PATH}/${kind}`;

export type LabelsView = { readonly kind: 'choices' } | { readonly kind: 'list'; readonly label: LabelKind } | { readonly kind: 'unknown' };

// `rest` is what follows /labels in the address.
export function parseLabelsPath(rest: string | undefined): LabelsView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  if (parts.length === 0) return { kind: 'choices' };
  const [first] = parts;
  if (parts.length === 1 && (first === 'product' || first === 'haccp')) return { kind: 'list', label: first };
  return { kind: 'unknown' };
}

// What the usage record calls each screen (shell/sections.ts, screenNameFor). A junk address is sent back to the choices, so
// it is counted as the choices, the screen a person actually sees.
export function labelsScreenName(rest: string): string {
  const view = parseLabelsPath(rest);
  return view.kind === 'list' ? `labels-${view.label}` : 'labels';
}
