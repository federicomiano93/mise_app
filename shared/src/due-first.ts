// The suppliers to order today, first in a supplier list (Mise 2 only: no js/ original, so no pairing).
//
// The current app only LIGHTS the suppliers in `dueTodayIds` (reminders.ts); Mise 2 also puts them at the top of both supplier
// lists (his note of 9 Nov 2026: «metti i fornitori che si devono ordinare nel loro giorno di ordine tutti in alto»). The rule
// of WHO is due stays in reminders.ts, one definition; this file only orders and compares.

// Due ones first, each part keeping the order it came in (a stable split, not a sort: the lists are already in their own
// order, A–Z or the venue's). Nothing due, or the due ones already first: the very same array comes back, so a caller's memo
// does not see a change.
export function dueFirst<T extends { readonly id?: unknown }>(rows: readonly T[], due: ReadonlySet<string>): readonly T[] {
  if (due.size === 0) return rows;
  const first: T[] = [];
  const rest: T[] = [];
  for (const row of rows) (typeof row.id === 'string' && due.has(row.id) ? first : rest).push(row);
  if (first.length === 0 || first.length === rows.length) return rows;
  const moved = rows.some((row, index) => row !== (index < first.length ? first[index] : rest[index - first.length]));
  return moved ? [...first, ...rest] : rows;
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
