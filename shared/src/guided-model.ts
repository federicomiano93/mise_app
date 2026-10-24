// guided-model.ts — the row id of a Catalogue recipe's ingredient. PURE.
//
// TypeScript PARTIAL port of js/catalogue/guided-model.js for Mise 2. Behaviour is identical, input for
// input, for everything ported: guided-model.spec.ts runs every test against BOTH files and compares the
// ported export with the js/ file itself; odd-inputs.spec.ts feeds both the same strange values. It is NOT
// paired in parity.spec.ts, because the original holds a whole mixing procedure the Calculator never reads.
//
// PORTED: `ridOf` only — the one function the Calculator's recipe source needs (calculator-recipe-source.ts
// keys a linked recipe's rows by it). Step 3c-2 (the link picker, which stamps ids on the Catalogue's rows)
// adds `withRowIds` and `makeRowId`; Step 3d (the Catalogue) the rest.
//
// ⚠️ THE KEY OF A LINKED ROW IS ITS OWN `rid`, never its name and never its position: renaming "Yeast" to
// "Fresh yeast" must not switch the leavening knob off, and inserting a row at the top must not make the
// yeast step ask for the flour.

// A row's id: a trimmed string, or '' when it has none.
export function ridOf(row: unknown): string {
  const r = row as { rid?: unknown } | null | undefined;
  const rid = r && r.rid != null ? String(r.rid).trim() : '';
  return rid || '';
}
