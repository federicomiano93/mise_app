// todoModel.ts — what the «Da fare» card draws, worked out from the items, today and the clock.
// Pure: no React, no Firestore, no `new Date()` of its own (docs/parity/home.md, decisions H5–H7).

import { addDays, parseISODate, toISODate } from '@mise/shared/day';
import { TODO_KEEP_DAYS } from './todosSource';
import type { TodoItem } from './todosSource';

const DAY_MS = 86_400_000;

// How many days after today get a group of their own; what is further away folds under «Later».
export const TODO_AHEAD_DAYS = 7;

export type TodoGroup =
  // Not ticked, and its day is before today: oldest day first.
  | { readonly kind: 'overdue'; readonly items: readonly TodoItem[] }
  // One day, today (offset 0) or one of the next seven. Ticked items stay here, struck through.
  | { readonly kind: 'day'; readonly day: string; readonly offset: number; readonly items: readonly TodoItem[] }
  // Beyond the next seven days, ticked or not, by day.
  | { readonly kind: 'later'; readonly items: readonly TodoItem[] }
  // Ticked, and its day is before today: the newest tick first.
  | { readonly kind: 'done'; readonly items: readonly TodoItem[] };

// Inside one day: the order they were written in, an item whose creation time is not known yet
// (a write still on its way to a phone that never saw its own server time) last, then by id so the
// order never shuffles between two redraws.
function byCreation(a: TodoItem, b: TodoItem): number {
  if (a.createdAtMs !== b.createdAtMs) {
    if (a.createdAtMs === null) return 1;
    if (b.createdAtMs === null) return -1;
    return a.createdAtMs - b.createdAtMs;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byDayThenCreation(a: TodoItem, b: TodoItem): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return byCreation(a, b);
}

// When an item was ticked, for the hiding and the order: one with no time yet counts as ticked now.
function tickedAt(item: TodoItem, nowMs: number): number {
  return item.doneAtMs ?? nowMs;
}

function byNewestTick(nowMs: number) {
  return (a: TodoItem, b: TodoItem): number => {
    const diff = tickedAt(b, nowMs) - tickedAt(a, nowMs);
    return diff !== 0 ? diff : byCreation(a, b);
  };
}

// The card's groups, in the order they are drawn; an empty group is left out.
//
// `today` is the device's local day, «YYYY-MM-DD». ⚠️ DAYS ARE MOVED BY CALENDAR DAYS (setDate in
// @mise/shared/day), never by adding 86 400 000 ms to a midnight: the day the clocks change is 23 or
// 25 hours long. Comparing two «YYYY-MM-DD» strings with < is exact.
//
// ⚠️ A TICKED ITEM OLDER THAN THE KEEP TIME IS HIDDEN HERE TOO: Firestore's TTL deletes it within a day
// or so of its expireAt, but the emulator never does, and the delay is not a promise.
export function groupTodos(items: readonly TodoItem[], today: string, nowMs: number): TodoGroup[] {
  const start = parseISODate(today);
  const days = Array.from({ length: TODO_AHEAD_DAYS + 1 }, (_, offset) => toISODate(addDays(start, offset)));
  const lastDay = days[TODO_AHEAD_DAYS] ?? today;
  const keepMs = TODO_KEEP_DAYS * DAY_MS;

  const overdue: TodoItem[] = [];
  const perDay: TodoItem[][] = days.map(() => []);
  const later: TodoItem[] = [];
  const done: TodoItem[] = [];

  for (const item of items) {
    if (item.done && nowMs - tickedAt(item, nowMs) > keepMs) continue;
    if (item.day < today) {
      (item.done ? done : overdue).push(item);
    } else if (item.day > lastDay) {
      later.push(item);
    } else {
      // A day the calendar does not have («2026-11-31»: the rules' pattern accepts it, the form never makes it) is none of
      // the eight, so it folds under «Later» rather than vanishing.
      const slot = perDay[days.indexOf(item.day)];
      if (slot) slot.push(item);
      else later.push(item);
    }
  }

  const groups: TodoGroup[] = [];
  if (overdue.length > 0) groups.push({ kind: 'overdue', items: overdue.sort(byDayThenCreation) });
  days.forEach((day, offset) => {
    const list = perDay[offset] ?? [];
    if (list.length > 0) groups.push({ kind: 'day', day, offset, items: list.sort(byCreation) });
  });
  if (later.length > 0) groups.push({ kind: 'later', items: later.sort(byDayThenCreation) });
  if (done.length > 0) groups.push({ kind: 'done', items: done.sort(byNewestTick(nowMs)) });
  return groups;
}
