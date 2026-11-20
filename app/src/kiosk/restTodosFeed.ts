// restTodosFeed.ts — the scheduler behind the rest screen's «To do today» half: the same timing as the Orders lines (restOrders.ts) —
// one read when the tablet goes to REST, every 15 minutes while it stays, an answer of the same work day younger than that reused,
// never in the night (the controller stops it), never while the page is hidden. A failed read keeps the last good answer and never
// reaches the cover (P17); only the error's code is logged, never a to-do's words.

import { workDayDate } from '@mise/shared/kiosk-model';
import type { KioskTodo, KioskTodosSource } from './kioskTodosSource';
import { REFRESH_MS } from './restOrders';

export interface RestTodosFeedDeps {
  source: KioskTodosSource;
  // Fresh data arrived: repaint.
  onChange(): void;
  now?(): number;
  // False while the page is hidden: nothing is read then.
  visible?(): boolean;
  timers?: { set(callback: () => void, ms: number): unknown; clear(id: unknown): void };
}

export interface RestTodosFeed {
  start(): void;
  stop(): void;
  refreshIfStale(): void;
  // What the cover draws from: the last answer of this work day, or nothing.
  current(): readonly KioskTodo[];
  isRunning(): boolean;
}

export function createRestTodosFeed({
  source, onChange,
  now = () => Date.now(),
  visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  timers = { set: (callback, ms) => setInterval(callback, ms), clear: id => { clearInterval(id as ReturnType<typeof setInterval>); } },
}: RestTodosFeedDeps): RestTodosFeed {
  let timer: unknown = null;
  let running = false;
  let inFlight = false;
  let token = 0;
  let cache: { day: string; at: number; todos: readonly KioskTodo[] } | null = null;
  // The work day (before 04:00 still yesterday), so yesterday's answer is never shown as today's.
  const today = () => workDayDate(now());

  function fresh(): boolean {
    return cache !== null && cache.day === today() && now() - cache.at < REFRESH_MS;
  }

  async function refresh(): Promise<void> {
    if (!running || inFlight || !visible()) return;
    const mine = token;
    inFlight = true;
    try {
      const todos = await source.readOpen();
      if (mine !== token) return;   // stopped (woken, night) while the read was out
      cache = { day: today(), at: now(), todos: Array.isArray(todos) ? todos : [] };
      onChange();
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'error';
      console.warn('The kiosk to-dos could not be refreshed:', code);
    } finally {
      if (mine === token) inFlight = false;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      if (!fresh()) void refresh();
      timer = timers.set(() => { void refresh(); }, REFRESH_MS);
    },
    stop() {
      running = false;
      inFlight = false;
      token++;
      if (timer !== null) { timers.clear(timer); timer = null; }
    },
    refreshIfStale() {
      if (running && !fresh()) void refresh();
    },
    current() {
      return cache !== null && cache.day === today() ? cache.todos : [];
    },
    isRunning: () => running,
  };
}
