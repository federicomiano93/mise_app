// guided-model.ts — the row id of a Catalogue recipe's ingredient. PURE.
//
// TypeScript PARTIAL port of js/catalogue/guided-model.js for Mise 2. Behaviour is identical, input for
// input, for everything ported: guided-model.spec.ts runs every test against BOTH files and compares the
// ported export with the js/ file itself; odd-inputs.spec.ts feeds both the same strange values. It is NOT
// paired in parity.spec.ts, because the original holds a whole mixing procedure the Calculator never reads.
//
// PORTED: `ridOf` — the Calculator's recipe source keys a linked recipe's rows by it
// (calculator-recipe-source.ts) — and `makeRowId` / `withRowIds`, which the Calculator's link picker uses to
// stamp an id on every row of the Catalogue recipe it links (step 3c-2). Step 3d (the Catalogue) the rest.
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

// ⚠️ THE IDS ARE RANDOM, NOT SEQUENTIAL: two phones editing the same recipe offline would each mint `r4` for a
// DIFFERENT ingredient, and whichever synced last would silently rebind the other phone's step to the wrong
// row. With random ids that collision cannot happen; the step reports its row as missing instead.
const RID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function makeRowId(random: () => number = Math.random): string {
  let out = 'r';
  for (let i = 0; i < 8; i++) out += RID_ALPHABET[Math.floor(random() * RID_ALPHABET.length)];
  return out;
}

// Every ingredient row given a `rid`, assigning one only where it is missing or would collide. Called on SAVE,
// never on read: an id minted on the way in would be different on every load and would point at nothing the
// next time. Returns a new array; the input is never mutated. Rows that already have a unique id come back
// byte-identical (the SAME objects), so a recipe nobody has touched keeps exactly the shape it has today.
export function withRowIds<T>(ingredients: readonly T[] | unknown, makeId: () => string = makeRowId): (T | (T & { rid: string }))[] {
  if (!Array.isArray(ingredients)) return [];
  const seen = new Set<string>();
  return (ingredients as T[]).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const rid = ridOf(row);
    if (rid && !seen.has(rid)) { seen.add(rid); return row; }
    // No id, or a duplicate of one already used: mint a fresh one. Looping guards against the (vanishingly
    // unlikely) case of the generator repeating itself.
    let fresh = makeId();
    while (!fresh || seen.has(fresh)) fresh = makeId();
    seen.add(fresh);
    return { ...row, rid: fresh };
  });
}
