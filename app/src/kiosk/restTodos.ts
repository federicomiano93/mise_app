// restTodos.ts — the «To do today» half of the kiosk's rest screen: which to-dos are drawn and in what order. PURE.
// Not done (the source asked for those), `day <= today` (overdue and today's; tomorrow's are not shown). Overdue first, the oldest day
// first, then the oldest made first; then today's, the oldest made first; an item with no known creation time goes last of its group.

import type { KioskTodo } from './kioskTodosSource';

// A resting screen is read from across the room: more than this many and the rest become «+N» (as the Orders lines).
export const MAX_TODOS_SHOWN = 4;

export type RestTodoLine = { readonly text: string; readonly late: boolean };
export type RestTodos = { readonly items: readonly RestTodoLine[]; readonly more: number };

export const NO_TODOS: RestTodos = Object.freeze({ items: Object.freeze([]), more: 0 });

function byMade(a: KioskTodo, b: KioskTodo): number {
  if (a.createdAtMs === b.createdAtMs) return 0;
  if (a.createdAtMs === null) return 1;
  if (b.createdAtMs === null) return -1;
  return a.createdAtMs - b.createdAtMs;
}

export function restTodosFor(todos: readonly KioskTodo[], today: string): RestTodos {
  const sorted = todos.filter(todo => todo.day <= today).sort((a, b) => {
    const lateA = a.day < today;
    const lateB = b.day < today;
    if (lateA !== lateB) return lateA ? -1 : 1;
    if (lateA && a.day !== b.day) return a.day < b.day ? -1 : 1;
    return byMade(a, b);
  });
  return {
    items: sorted.slice(0, MAX_TODOS_SHOWN).map(todo => ({ text: todo.text, late: todo.day < today })),
    more: Math.max(0, sorted.length - MAX_TODOS_SHOWN),
  };
}
