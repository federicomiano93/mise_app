// supplier-label.ts — the ONE place that decides which name of a supplier the app SHOWS.
//
// TypeScript port of js/supplier-label.js for Mise 2. Behaviour is identical, input for input:
// supplier-label.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports
// and odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones the
// original paid for in bugs.
//
// An invoice carries the legal name («Aldo Legacy Foods Ltd Wholesale»), which does not fit a
// phone screen, so a supplier may also have a `shortName`. Rule: wherever the app DISPLAYS a
// supplier, it shows the short name when there is one, else the name. The stored `name` never
// changes and is still what the supplier card's «Name» field edits.
//
// PURE, zero imports: shared by Orders and the Catalogue (a calculation shared by several
// features lives in the shared base).

// The two names a supplier may carry. A document is data, so anything at all may arrive: every
// field is `unknown`, and `?.` is the original's own way of reading them.
interface NamedSupplier {
  name?: unknown;
  shortName?: unknown;
}

export function supplierLabel(s: unknown): string {
  const card = s as NamedSupplier | null | undefined;
  const short = typeof card?.shortName === 'string' ? card.shortName.trim() : '';
  if (short) return short;
  return String(card?.name || '');
}

// Does a typed search hit this supplier by EITHER of its names? `normalize` is the caller's
// own text folding (case, accents) so every search keeps behaving like its neighbours.
// `query` is already normalized by the caller; an empty query matches everything.
export function supplierMatches(s: unknown, query: string, normalize: (value: unknown) => string): boolean {
  if (!query) return true;
  const card = s as NamedSupplier | null | undefined;
  return [card?.name, card?.shortName].some(v => normalize(v).includes(query));
}
