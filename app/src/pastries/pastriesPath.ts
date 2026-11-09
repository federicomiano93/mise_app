import { isWeekday } from '@mise/shared/pastries-model';
import type { Weekday } from '@mise/shared/pastries-model';

// What the address under /pastries says to show.
//
//   /pastries                  the opening day (day: null — the section works out which)
//   /pastries/Tuesday          that day
//   /pastries/Tuesday/edit     the editor of that day
//   /pastries/records          Records
//   anything else              unknown: the section goes back to /pastries
//
// ⚠️ THE DAY IN THE ADDRESS IS THE ENGLISH ID, exactly as stored (`Tuesday`), never the word the
// person reads. A lower-case or translated day is «unknown» rather than a guess.
export type PastriesView =
  | { readonly kind: 'day'; readonly day: Weekday | null }
  | { readonly kind: 'editor'; readonly day: Weekday }
  | { readonly kind: 'records' }
  | { readonly kind: 'unknown' };

// `rest` is what follows /pastries: React Router's «*» (undefined or '' for /pastries itself).
export function parsePastriesPath(rest: string | undefined): PastriesView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  const [first, second] = parts;
  if (parts.length === 0) return { kind: 'day', day: null };
  if (parts.length === 1 && first === 'records') return { kind: 'records' };
  if (parts.length === 1 && isWeekday(first)) return { kind: 'day', day: first };
  if (parts.length === 2 && isWeekday(first) && second === 'edit') return { kind: 'editor', day: first };
  return { kind: 'unknown' };
}
