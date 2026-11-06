import { vi } from 'vitest';
import { cleanTodoText } from '../home/todosSource';
import type { TodoItem, TodosSource } from '../home/todosSource';

// A to-do source for the specs, in memory: the items are in one map, every write lands at once (as
// Firestore's local copy does) and every live watcher is told. A write is refused, as the rules or
// the network would, by setting `refuseWith` to the error to reject with.
type Watcher = { onChange: (items: TodoItem[], fromCache: boolean) => void; onError: (err: unknown) => void };

export type FakeTodosSource = TodosSource & {
  items: Map<string, TodoItem>;
  // While set, every write rejects with this error and changes nothing.
  refuseWith: unknown;
  // Tells every watcher again (as another phone's write would).
  push(): void;
  // Kills every live stream with an error.
  breakStreams(): void;
  // How many watchers are live (the store must stop its listener).
  watching(): number;
};

export const permissionDenied = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });

export function fakeTodosSource(seed: readonly TodoItem[] = []): FakeTodosSource {
  const items = new Map(seed.map(item => [item.id, item] as const));
  const watchers = new Set<Watcher>();
  let counter = 0;
  let refuseWith: unknown = null;

  function push(): void {
    for (const w of watchers) w.onChange([...items.values()], false);
  }
  const refusal = (): Promise<void> | null => (refuseWith === null ? null : Promise.reject(refuseWith as Error));

  return {
    items,
    get refuseWith() { return refuseWith; },
    set refuseWith(value: unknown) { refuseWith = value; },
    push,
    breakStreams() {
      for (const w of [...watchers]) w.onError(new Error('unavailable'));
      watchers.clear();
    },
    watching: () => watchers.size,
    watch: vi.fn((onChange, onError) => {
      const watcher: Watcher = { onChange, onError };
      watchers.add(watcher);
      // Like onSnapshot: the first answer arrives after the call returns.
      queueMicrotask(() => { if (watchers.has(watcher)) onChange([...items.values()], false); });
      return () => { watchers.delete(watcher); };
    }),
    add: vi.fn((text, day) => {
      counter += 1;
      const id = `new${counter}`;
      const clean = cleanTodoText(text);
      const refused = refusal();
      if (refused) return { id, written: refused };
      items.set(id, { id, text: clean, day, done: false, doneAtMs: null, createdAtMs: Date.now() + counter });
      push();
      return { id, written: Promise.resolve() };
    }),
    edit: vi.fn(async (id, text, day) => {
      const clean = cleanTodoText(text);
      const refused = refusal();
      if (refused) return refused;
      const current = items.get(id);
      if (current) items.set(id, { ...current, text: clean, day });
      push();
    }),
    setDone: vi.fn(async (id, done) => {
      const refused = refusal();
      if (refused) return refused;
      const current = items.get(id);
      if (current) items.set(id, { ...current, done, doneAtMs: done ? Date.now() : null });
      push();
    }),
    remove: vi.fn(async id => {
      const refused = refusal();
      if (refused) return refused;
      items.delete(id);
      push();
    }),
  };
}
