import type { AnswerMeta, CalculatorSource, StoredDoc } from '../calculator/calculatorSource';

// A Calculator source for the specs, in memory: the configuration, the catalogue recipes and the logs are
// plain values; a log save lands at once (or is refused, with `refuse`, or held, with `holdSaves`), and every
// live watcher is told, like Firestore would. By default every answer comes from the server (an online
// database); `answer()` lets a spec send one from the browser's own database instead.
type ConfigListener = { onChange: (data: Record<string, unknown> | null, meta: AnswerMeta) => void; onError: (err: unknown) => void };
type LogsListener = { sinceMs: number; onChange: (list: StoredDoc[], meta: AnswerMeta) => void; onError: (err: unknown) => void };
type RecipeListener = { id: string; onChange: (recipe: StoredDoc | null, meta: AnswerMeta) => void };

const FROM_SERVER: AnswerMeta = { fromServer: true };

export type FakeCalculatorSource = CalculatorSource & {
  config: Record<string, unknown> | null;
  recipes: Map<string, StoredDoc>;
  logs: Map<string, StoredDoc>;
  // The next calls of this kind fail.
  refuse: { save: boolean; config: boolean; logs: boolean };
  // Every log that reached the source, in order.
  saved: StoredDoc[];
  // Which linked recipes are watched right now.
  watchedRecipes(): string[];
  // Tells every watcher again (as another phone's write would).
  push(meta?: AnswerMeta): void;
  // Holds back every answer until release() (Firestore still loading).
  hold(): void;
  release(): void;
  // Log saves wait (offline) until settleSaves().
  holdSaves(): void;
  settleSaves(): void;
};

export function fakeCalculatorSource(seed: {
  config?: Record<string, unknown> | null;
  recipes?: StoredDoc[];
  logs?: StoredDoc[];
} = {}): FakeCalculatorSource {
  const recipes = new Map((seed.recipes ?? []).map(doc => [doc.id, doc] as const));
  const logs = new Map((seed.logs ?? []).map(doc => [doc.id, doc] as const));
  const configWatchers = new Set<ConfigListener>();
  const logWatchers = new Set<LogsListener>();
  const recipeWatchers = new Set<RecipeListener>();
  const refuse = { save: false, config: false, logs: false };
  const saved: StoredDoc[] = [];
  let held = false;
  let savesHeld = false;
  let heldSaves: Array<() => void> = [];

  const refused = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
  const logList = (sinceMs: number) => [...logs.values()].filter(log => Number(log.createdAtMs) >= sinceMs);

  function tellConfig(listener: ConfigListener, meta: AnswerMeta) {
    if (refuse.config) listener.onError(refused());
    else listener.onChange(fake.config, meta);
  }
  function tellLogs(listener: LogsListener, meta: AnswerMeta) {
    if (refuse.logs) listener.onError(refused());
    else listener.onChange(logList(listener.sinceMs), meta);
  }
  function tellRecipe(listener: RecipeListener, meta: AnswerMeta) {
    listener.onChange(recipes.get(listener.id) ?? null, meta);
  }

  const fake: FakeCalculatorSource = {
    config: seed.config === undefined ? null : seed.config,
    recipes, logs, refuse, saved,

    watchConfig(onChange, onError) {
      const listener = { onChange, onError };
      configWatchers.add(listener);
      if (!held) tellConfig(listener, FROM_SERVER);
      return () => { configWatchers.delete(listener); };
    },

    watchLinkedRecipe(id, onChange) {
      const listener = { id, onChange };
      recipeWatchers.add(listener);
      if (!held) tellRecipe(listener, FROM_SERVER);
      return () => { recipeWatchers.delete(listener); };
    },

    watchLogs(sinceMs, onChange, onError) {
      const listener = { sinceMs, onChange, onError };
      logWatchers.add(listener);
      if (!held) tellLogs(listener, FROM_SERVER);
      return () => { logWatchers.delete(listener); };
    },

    saveLog(log) {
      const doc = { ...log } as StoredDoc;
      saved.push(doc);
      if (refuse.save) return Promise.reject(refused());
      const land = () => {
        logs.set(doc.id, doc);
        for (const listener of logWatchers) tellLogs(listener, FROM_SERVER);
      };
      if (savesHeld) {
        return new Promise<void>(resolve => { heldSaves.push(() => { land(); resolve(); }); });
      }
      land();
      return Promise.resolve();
    },

    watchedRecipes: () => [...new Set([...recipeWatchers].map(listener => listener.id))],

    push(meta = FROM_SERVER) {
      for (const listener of configWatchers) tellConfig(listener, meta);
      for (const listener of logWatchers) tellLogs(listener, meta);
      for (const listener of recipeWatchers) tellRecipe(listener, meta);
    },

    hold() { held = true; },
    release() {
      held = false;
      fake.push();
    },

    holdSaves() { savesHeld = true; },
    settleSaves() {
      savesHeld = false;
      const waiting = heldSaves;
      heldSaves = [];
      for (const land of waiting) land();
    },
  };
  return fake;
}
