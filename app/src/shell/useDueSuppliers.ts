import { useMemo, useRef } from 'react';
import { sameSet } from '@mise/shared/due-first';
import { dueTodayIds } from '@mise/shared/reminders';
import type { PlacedRecord, ReminderSupplier, SkippedMap } from '@mise/shared/reminders';
import { useTodayKey } from './useTodayKey';

// The ids of the suppliers STILL to order today, for the lists of both sections (Orders and Ingredients & suppliers): the rule is
// `dueTodayIds`, the one the «Order today» strip uses, so a supplier is never lit in a list and ticked off in the strip.
//
// ⚠️ NOBODY IS LIT UNTIL `ready`: before the records a supplier placed this morning would flash as «to order», before the draft
// one closed this morning would too. The caller says `ready` once suppliers, records and draft have all arrived (a dead stream
// counts as arrived, and the caller then hands `skipped` as null, read as «nobody closed»).
//
// ⚠️ THE SAME SET COMES BACK WHILE ITS MEMBERS DO NOT CHANGE: the draft changes on every keystroke on another phone, and a new
// Set each time would redraw the lists (and move the rows) for nothing. The day is `useTodayKey`'s, so at midnight the set is
// worked out again by itself.
export function useDueSuppliers({ suppliers, records, skipped, ready }: {
  suppliers: readonly ReminderSupplier[];
  records: readonly PlacedRecord[];
  skipped: SkippedMap;
  ready: boolean;
}): ReadonlySet<string> {
  const today = useTodayKey();
  const next = useMemo(
    () => (ready ? dueTodayIds({ suppliers, history: records, today, skipped }) : new Set<string>()),
    [ready, suppliers, records, today, skipped],
  );
  const kept = useRef<ReadonlySet<string>>(next);
  if (!sameSet(kept.current, next)) kept.current = next;
  return kept.current;
}
