import { MAX_QTY, WEEKDAYS } from '@mise/shared/pastries-model';
import type { InvalidItems, InvalidProblem, PastryDays, PastryItem, Weekday } from '@mise/shared/pastries-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// One row of the editor's working copy. `note` is the row's own note («9x3»), '' when none. The quantity is TEXT while it is typed: a number field that
// is emptied must stay empty, not snap to 0 under the cursor. `id` is only for React (a row keeps its
// inputs, and their focus, when another row goes).
export interface EditorRow {
  readonly id: number;
  readonly name: string;
  readonly qty: string;
  readonly note: string;
}

export type EditorField = 'name' | 'qty' | 'note';

export function blankRow(id: number): EditorRow {
  return { id, name: '', qty: '', note: '' };
}

// A day's stored list → the rows the editor starts from. ⚠️ AT LEAST ONE ROW, ALWAYS: an empty day
// opens on one empty row, so the first thing a person sees is somewhere to type.
export function rowsFrom(items: readonly PastryItem[], nextId: () => number): EditorRow[] {
  const rows = items.map(item => ({ id: nextId(), name: item.name, qty: String(item.qty), note: item.note ?? '' }));
  return rows.length > 0 ? rows : [blankRow(nextId())];
}

// What cleanItems, findInvalidItems and the rules read: name, quantity and note, no React key.
export function workingItems(rows: readonly EditorRow[]): { name: string; qty: string; note: string }[] {
  return rows.map(({ name, qty, note }) => ({ name, qty, note }));
}

// An untouched row (nothing typed in any box) goes without a question. A row with only a note typed
// is NOT untouched: removing it would lose what somebody wrote.
export function isUntouched(row: EditorRow): boolean {
  return row.name.trim() === '' && row.qty.trim() === '' && row.note.trim() === '';
}

// The names already on the OTHER six days: the same pastries prove on several days, and typing
// «Savoury croissant» seven times is exactly the friction worth removing. Sorted for the language
// the person reads (localeCompare), each name once.
export function namesOnOtherDays(days: PastryDays, day: Weekday): string[] {
  const names = new Set<string>();
  for (const other of WEEKDAYS) {
    if (other === day) continue;
    for (const item of days[other].items) if (item.name) names.add(item.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// The box that is wrong, so the person is taken to it. A missing or too-big number is the quantity
// box; a repeated or too-long name is the name box; «more pastries than a day can hold» is about the
// list as a whole, so there is no box to point at (the notice at the top says it).
export function fieldOf(problem: InvalidProblem): EditorField | null {
  switch (problem) {
    case 'no-qty':
    case 'qty-too-big':
      return 'qty';
    case 'too-many':
      return null;
    case 'duplicate':
    case 'too-long':
      return 'name';
    // A problem the model gains later still lands on the name box rather than on nothing.
    default:
      return 'name';
  }
}

// What to say when a save is blocked: a plain sentence, naming the pastry where there is one.
// «Invalid input» tells nobody what to do next.
export function problemMessage(t: Translate, found: InvalidItems): string {
  switch (found.problem) {
    case 'duplicate':
      return t('past.onListTwice', { name: found.name });
    case 'no-qty':
      return t('past.howMany', { name: found.name });
    case 'too-long':
      return t('past.thatNameIsToo');
    // As text: the limit reads «9999» (the parity list), not the grouped «9,999».
    case 'qty-too-big':
      return t('past.mostItCanHold', { n: String(MAX_QTY) });
    case 'too-many':
      return t('past.thatIsMorePastries');
    // A problem the model gains later is still a sentence, never a blank notice.
    default:
      return t('past.thatCannotBeSaved');
  }
}
