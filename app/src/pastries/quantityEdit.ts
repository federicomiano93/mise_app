import { MAX_QTY } from '@mise/shared/pastries-model';
import type { Weekday } from '@mise/shared/pastries-model';

// The quick correction of one number on a day's list (port of the box in pastries-day.js).
//
// ⚠️ THE BOX STARTS EMPTY AND TYPING IS A PROPOSAL. The standing quantity stays plain text and
// nothing is written until the tick (or Enter), so a stray thumb costs nothing and the number
// somebody will read at 4am can never be altered by a tap.

// What this phone has typed is kept by day AND pastry name — never by position, because another
// phone can reorder the list under it. Case and surrounding spaces do not tell two names apart
// (the same rule the editor uses for «the same pastry twice»).
export function typedKey(day: Weekday, name: string): string {
  return `${day} ${name.trim().toLowerCase()}`;
}

// What was typed as a whole number, or null when it is nothing usable to talk about (empty, or
// not a finite number). 0.4 is 0, 1e999 is nothing.
export function proposedQuantity(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? n : null;
}

export type QuantityHint =
  | 'past.hint.typeANumber'
  | 'past.hint.sameAsNow'
  | 'past.hint.atLeastOne'
  | 'past.hint.tooMany';

export type QuantityCheck = {
  // Whether the tick is shown, and Enter writes: 1…MAX_QTY and different from the current one.
  readonly usable: boolean;
  // What to tell the person; null when there is nothing to say.
  readonly hint: QuantityHint | null;
};

// The order of the checks is the original's: «same as now» comes before «at least 1», so a row
// that already holds 0 reads «same as now» when 0 is typed.
export function checkQuantity(proposed: number | null, current: number): QuantityCheck {
  if (proposed === null) return { usable: false, hint: 'past.hint.typeANumber' };
  if (proposed === current) return { usable: false, hint: 'past.hint.sameAsNow' };
  if (proposed <= 0) return { usable: false, hint: 'past.hint.atLeastOne' };
  if (proposed > MAX_QTY) return { usable: false, hint: 'past.hint.tooMany' };
  return { usable: true, hint: null };
}
