// productPicker.ts — the product window of the booking form, the pure half (bookings rebuild step 2, 19 Nov 2026).
//
// NEW IN MISE 2. The owner's design, approved on the tablet: ONE product per opening, in up to three steps — 1 «Scegli il
// prodotto» (the favourites as tiles, or a search over the whole price list, or a name typed freely), 2 «Scegli il peso» (a
// kilo product: its weights, or another typed), 3 «Modifiche» (what to leave out or add more of, from the product's
// `removable`, and the venue's «Da aggiungere»). The result is one card on the form, its note pre-filled with the changes.
// Plain TypeScript: no React, no dictionary (the words come in as functions).

import { foldName } from '@mise/shared/price-list';
import type { PriceItem } from '@mise/shared/price-list';

// The favourites, in the list's order (by name): the tiles of step 1.
export function favouritesOf(items: readonly PriceItem[]): PriceItem[] {
  return items.filter(item => item.favourite);
}

// The items whose name holds every word typed (case and spaces aside), in the list's order. Nothing typed: every item.
export function searchItems(items: readonly PriceItem[], query: string): PriceItem[] {
  const words = foldName(query).split(' ').filter(word => word !== '');
  if (words.length === 0) return [...items];
  return items.filter(item => {
    const name = foldName(item.name);
    return words.every(word => name.includes(word));
  });
}

// The name typed in the search, when it can be booked as a product of its own (the old form's free text): something typed that
// is not exactly a name on the list (that one is offered as its tile instead). null otherwise.
export function freeNameOf(query: string, items: readonly PriceItem[]): string | null {
  const name = query.trim().replace(/\s+/g, ' ');
  if (name === '') return null;
  return items.some(item => foldName(item.name) === foldName(name)) ? null : name;
}

// Step 2 is asked for a kilo product (its weights, or another typed) and for a name typed freely (which may be had by weight, as
// the old form's kilo unit allowed); a piece or a pack has nothing to weigh.
export function asksWeight(item: PriceItem | null): boolean {
  return item === null || item.per === 'kg';
}

// The ingredients step 3 offers to leave out or add more of: the product's `removable`. Never chosen (null) — or a name typed
// freely — offers none: the form does not read the recipes (an employee at the counter may not), so the group is hidden.
export function removableOf(item: PriceItem | null): readonly string[] {
  return item?.removable ?? [];
}

// Whether step 3 has anything to show: an ingredient to change, or an extra the venue offers.
export function asksChanges(item: PriceItem | null, extras: readonly string[]): boolean {
  return removableOf(item).length > 0 || extras.length > 0;
}

// An ingredient of the recipe, changed: left out («senza cipolla») or more of it («+ cipolla»). The two exclude each other.
export type IngredientMark = 'without' | 'extra';

export type Changes = {
  // By the ingredient's name as the list holds it.
  readonly marks: Readonly<Record<string, IngredientMark>>;
  // The venue's extras chosen, by name.
  readonly extras: readonly string[];
};

export const NO_CHANGES: Changes = Object.freeze({ marks: Object.freeze({}), extras: Object.freeze([]) as readonly string[] });

// A press on «−» or «+» of an ingredient: sets that mark (replacing the other), or clears it when it was already the one set.
export function toggleMark(changes: Changes, name: string, mark: IngredientMark): Changes {
  const marks = { ...changes.marks };
  if (marks[name] === mark) delete marks[name];
  else marks[name] = mark;
  return { ...changes, marks };
}

// A press on an extra: on, or off again.
export function toggleExtra(changes: Changes, name: string): Changes {
  const on = changes.extras.includes(name);
  return { ...changes, extras: on ? changes.extras.filter(extra => extra !== name) : [...changes.extras, name] };
}

export type ChangeWords = {
  readonly without: (name: string) => string;
  readonly extra: (name: string) => string;
};

// The note the changes make, in the order the window shows them (the recipe's, then the extras): «senza cipolla, + provola».
// '' when nothing changed. A name said twice (an ingredient made extra that is also an extra) is said once.
export function changesNote(
  removable: readonly string[],
  extras: readonly string[],
  changes: Changes,
  words: ChangeWords,
): string {
  const parts: string[] = [];
  const said = new Set<string>();
  const say = (text: string) => {
    const key = foldName(text);
    if (said.has(key)) return;
    said.add(key);
    parts.push(text);
  };
  for (const name of removable) {
    const mark = changes.marks[name];
    if (mark === 'without') say(words.without(name));
    else if (mark === 'extra') say(words.extra(name));
  }
  for (const name of extras) {
    if (changes.extras.includes(name)) say(words.extra(name));
  }
  return parts.join(', ');
}
