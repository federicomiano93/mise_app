// calculator-recipe-text.ts — the text of the Copy / WhatsApp recipe export. PURE: no DOM, no Firebase, no
// storage.
//
// TypeScript FULL port of js/calculator-recipe-text.js for Mise 2, with ONE DELIBERATE DIFFERENCE (below).
// calculator-recipe-text.spec.ts runs the current app's tests against BOTH files, except the one case that
// differs, which it asserts for each file separately; parity.spec.ts compares the exports. It takes the
// same ingredient data that feeds the on-screen render — a [{ name, grams }] list plus the total grams.
//
// ⚠️ DIFFERENCE FROM THE CURRENT APP (decided 12 Oct 2026, listed in docs/parity/calculator.md):
// js/ writes the ingredient called exactly `Flour uniqua blue` on TWO lines ("Flour uniqua" as a bare
// label, then "blue:" with the value), a legacy layout for one venue's ingredient. That is one customer's
// DATA written into the code, so the port does not know it: the ingredient is written like every other
// line — `(name + ':').padEnd(11) + grams.padStart(5) + ' g'`. For every other input the two files
// return the same text, byte for byte.

// Plain ASCII divider: the box-drawing character used before (U+2500) renders as a "missing glyph" box on
// some phone/WhatsApp fonts.
const SEP = '-'.repeat(22);

// One aligned "name:   value g" line, padded exactly as the old export did.
function fmtLine(name: unknown, val: unknown): string {
  return ((name as string) + ':').padEnd(11) + String(val).padStart(5) + ' g';
}

export interface RecipeTextRow {
  name?: unknown;
  grams?: unknown;
}

// Build the full recipe text from a recipe name, its ingredient rows and total. name: the recipe's name
// (shown uppercased on the first line). rows: [{ name, grams }]. totalG: integer grams. Returns '' when
// there are no rows.
export function buildRecipeText(name: unknown, rows: readonly RecipeTextRow[] | unknown, totalG: number): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const title = String(name || 'Recipe').toUpperCase();
  return [
    title + '  ' + (totalG / 1000).toFixed(1) + ' kg',
    SEP,
    ...(rows as RecipeTextRow[]).flatMap(r => [fmtLine(r.name, Math.round(r.grams as number))]),
  ].join('\n');
}
