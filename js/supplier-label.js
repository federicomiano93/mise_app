// supplier-label.js — the ONE place that decides which name of a supplier the app SHOWS.
//
// An invoice carries the legal name («Aldo Legacy Foods Ltd Wholesale»), which does not fit a
// phone screen, so a supplier may also have a `shortName`. Rule: wherever the app DISPLAYS a
// supplier, it shows the short name when there is one, else the name. The stored `name` never
// changes and is still what the supplier card's «Name» field edits.
//
// PURE, zero imports: shared by Orders and the Catalogue (a calculation shared by several
// features lives in js/ root).

export function supplierLabel(s) {
  const short = typeof s?.shortName === 'string' ? s.shortName.trim() : '';
  if (short) return short;
  return String(s?.name || '');
}

// Does a typed search hit this supplier by EITHER of its names? `normalize` is the caller's
// own text folding (case, accents) so every search keeps behaving like its neighbours.
// `query` is already normalized by the caller; an empty query matches everything.
export function supplierMatches(s, query, normalize) {
  if (!query) return true;
  return [s?.name, s?.shortName].some(v => normalize(v).includes(query));
}
