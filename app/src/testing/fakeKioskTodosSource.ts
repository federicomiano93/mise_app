import { vi } from 'vitest';
import type { KioskTodo, KioskTodosSource } from '../kiosk/kioskTodosSource';

// The kiosk rest screen's to-do read, from memory: a spy, so a spec can count reads and make one fail.
export function fakeKioskTodosSource(todos: KioskTodo[] = []) {
  return {
    readOpen: vi.fn<KioskTodosSource['readOpen']>(async () => todos),
  };
}
