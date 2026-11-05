import { vi } from 'vitest';
import type { CatalogueRecipe, ImportAction } from '@mise/shared/catalogue-model';
import type { RecipesMeta, RecipesSource, StoredDoc } from '../recipes/recipesSource';

// A Recipe catalogue source for the specs of screens, in memory: the recipes and the ingredients are
// plain maps, and every live watcher is told when they change, like Firestore would. The store itself
// is covered against its own fake in recipesStore.spec.ts; a screen's spec only needs a database that
// behaves.
type Listener = { onChange: (list: StoredDoc[], meta: RecipesMeta) => void; onError: (err: unknown) => void };
// This fake is a database that is online: every answer comes from the server.
const FROM_SERVER: RecipesMeta = { fromServer: true };

export type FakeRecipesSource = RecipesSource & {
  recipes: Map<string, StoredDoc>;
  // The ingredients the allergen gate reads (no prices: the real source strips them).
  ingredients: Map<string, StoredDoc>;
  // The label profile (config/labels) as stored; null = the venue has none (the defaults).
  labelConfig: Record<string, unknown> | null;
  // The next watch fails (the rules refused it, or the stream died).
  refuse: { recipes: boolean; ingredients: boolean; labelConfig: boolean; printAgents: boolean; queue: boolean; labelSave: boolean };
  // The shop computers' heartbeats (print-agents) as the watch reports them.
  printAgents: StoredDoc[];
  // Replaces the agents and tells every watcher at once, as a new heartbeat would. Does NOT go through push():
  // a heartbeat arrives on its own.
  setPrintAgents(list: StoredDoc[]): void;
  // Every job the screen put in the queue, in order, as it was handed over (refused ones are not here).
  jobs: Record<string, unknown>[];
  // The next queue writes wait until the returned function is called (a slow network); the job is recorded then.
  holdQueue(): () => void;
  // Tells every watcher again (as another phone's write would).
  push(): void;
  // Kills every live RECIPES stream, as a lost permission would.
  breakStream(): void;
  // Holds back the first answers until release() (Firestore still loading).
  hold(): void;
  release(): void;
  // Holds back ONLY the label profile's answer (the paper is not known yet) until releaseLabelConfig().
  holdLabelConfig(): void;
  releaseLabelConfig(): void;
  // Every label-profile patch the screen sent, in the order it was sent (refused ones are not here). A merge write:
  // each is folded into `labelConfig`, and the watchers are told.
  labelSaves: Record<string, unknown>[];
  // The next label saves wait until the returned function is called (a slow network); the patch is merged then.
  holdLabelSaves(): () => void;
  // The suppliers the link chooser names.
  suppliers: Map<string, StoredDoc>;
  // Every recipe write, in order, as it was handed over: { id, data } for a save, { id, deleted: true } for a delete
  // (refused ones are not here). A save is merged into `recipes` (a null field removed), and the watchers are told.
  recipeWrites: Array<{ id: string; data?: Record<string, unknown>; deleted?: true }>;
  // The next recipe saves / deletes are refused (the rules said no).
  refuseRecipeWrites: { save: boolean; remove: boolean };
  // The next recipe writes wait until the returned function is called (offline, or a slow network).
  holdRecipeWrites(): () => void;
  // config/calculator as stored (null = none), what the delete warning reads; `calculatorHold` makes the read hang.
  calculatorConfig: Record<string, unknown> | null;
  holdCalculatorRead(): () => void;
  // Every import into the Calculator, in order, as it was handed over (refused ones are not here), and what the next
  // ones answer. `refuseImport` makes the next imports reject with that error (null = they succeed); `holdImport`
  // makes them wait until the returned function is called.
  imports: Array<{ recipe: CatalogueRecipe; marketOrderTitle: string }>;
  importResult: ImportAction;
  refuseImport: unknown;
  holdImport(): () => void;
};

export function fakeRecipesSource(
  seed: {
    recipes?: StoredDoc[]; ingredients?: StoredDoc[]; labelConfig?: Record<string, unknown> | null; printAgents?: StoredDoc[];
    suppliers?: StoredDoc[]; calculatorConfig?: Record<string, unknown> | null;
  } = {},
): FakeRecipesSource {
  const recipes = new Map((seed.recipes ?? []).map(doc => [doc.id, doc] as const));
  const ingredients = new Map((seed.ingredients ?? []).map(doc => [doc.id, doc] as const));
  const suppliers = new Map((seed.suppliers ?? []).map(doc => [doc.id, doc] as const));
  const watchers = new Set<Listener>();
  const ingredientWatchers = new Set<Listener>();
  const supplierWatchers = new Set<Listener>();
  let recipeWriteHold: Promise<void> | null = null;
  let calculatorHold: Promise<void> | null = null;
  let importHold: Promise<void> | null = null;
  type LabelListener = {
    onChange: (data: Record<string, unknown> | null, meta: RecipesMeta) => void;
    onError: (err: unknown) => void;
  };
  const labelWatchers = new Set<LabelListener>();
  const agentWatchers = new Set<{ onChange: (list: StoredDoc[]) => void; onError: (err: unknown) => void }>();
  const refuse = { recipes: false, ingredients: false, labelConfig: false, printAgents: false, queue: false, labelSave: false };
  let queueHold: Promise<void> | null = null;
  let labelSaveHold: Promise<void> | null = null;
  let held = false;
  let labelHeld = false;
  const refused = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });

  // Like onSnapshot: the first answer arrives after the call returns.
  function watch(set: Set<Listener>, refusedNow: () => boolean, current: () => StoredDoc[]) {
    return (onChange: Listener['onChange'], onError: Listener['onError']) => {
      const listener: Listener = { onChange, onError };
      set.add(listener);
      queueMicrotask(() => {
        if (!set.has(listener)) return;
        if (refusedNow()) {
          set.delete(listener);
          onError(refused());
        } else if (!held) {
          onChange(current(), FROM_SERVER);
        }
      });
      return () => { set.delete(listener); };
    };
  }

  const fake: FakeRecipesSource = {
    recipes, ingredients, refuse, suppliers,
    labelConfig: seed.labelConfig ?? null,
    printAgents: seed.printAgents ?? [],
    jobs: [],
    labelSaves: [],
    recipeWrites: [],
    refuseRecipeWrites: { save: false, remove: false },
    calculatorConfig: seed.calculatorConfig ?? null,
    imports: [],
    importResult: 'added',
    refuseImport: null,
    holdImport() {
      let release: () => void = () => undefined;
      importHold = new Promise<void>(resolve => { release = resolve; });
      return () => { importHold = null; release(); };
    },
    holdRecipeWrites() {
      let release: () => void = () => undefined;
      recipeWriteHold = new Promise<void>(resolve => { release = resolve; });
      return () => { recipeWriteHold = null; release(); };
    },
    holdCalculatorRead() {
      let release: () => void = () => undefined;
      calculatorHold = new Promise<void>(resolve => { release = resolve; });
      return () => { calculatorHold = null; release(); };
    },
    holdLabelSaves() {
      let release: () => void = () => undefined;
      labelSaveHold = new Promise<void>(resolve => { release = resolve; });
      return () => { labelSaveHold = null; release(); };
    },
    setPrintAgents(list) {
      fake.printAgents = list;
      for (const w of agentWatchers) w.onChange(list);
    },
    holdQueue() {
      let release: () => void = () => undefined;
      queueHold = new Promise<void>(resolve => { release = resolve; });
      return () => { queueHold = null; release(); };
    },
    push() {
      if (held) return;
      for (const w of watchers) w.onChange([...recipes.values()], FROM_SERVER);
      for (const w of ingredientWatchers) w.onChange([...ingredients.values()], FROM_SERVER);
      for (const w of supplierWatchers) w.onChange([...suppliers.values()], FROM_SERVER);
      if (!labelHeld) for (const w of labelWatchers) w.onChange(fake.labelConfig, FROM_SERVER);
    },
    breakStream() {
      for (const w of [...watchers]) {
        watchers.delete(w);
        w.onError(refused());
      }
    },
    hold() { held = true; },
    release() { held = false; fake.push(); },
    holdLabelConfig() { labelHeld = true; },
    releaseLabelConfig() {
      labelHeld = false;
      if (!held) for (const w of labelWatchers) w.onChange(fake.labelConfig, FROM_SERVER);
    },

    watchRecipes: vi.fn<RecipesSource['watchRecipes']>(
      watch(watchers, () => refuse.recipes, () => [...recipes.values()]),
    ),
    watchIngredients: vi.fn<RecipesSource['watchIngredients']>(
      watch(ingredientWatchers, () => refuse.ingredients, () => [...ingredients.values()]),
    ),
    watchLabelConfig: vi.fn<RecipesSource['watchLabelConfig']>((onChange, onError) => {
      const listener: LabelListener = { onChange, onError };
      labelWatchers.add(listener);
      queueMicrotask(() => {
        if (!labelWatchers.has(listener)) return;
        if (refuse.labelConfig) {
          labelWatchers.delete(listener);
          onError(refused());
        } else if (!held && !labelHeld) {
          onChange(fake.labelConfig, FROM_SERVER);
        }
      });
      return () => { labelWatchers.delete(listener); };
    }),
    watchPrintAgents: vi.fn<RecipesSource['watchPrintAgents']>((onChange, onError) => {
      const listener = { onChange, onError };
      agentWatchers.add(listener);
      queueMicrotask(() => {
        if (!agentWatchers.has(listener)) return;
        if (refuse.printAgents) {
          agentWatchers.delete(listener);
          onError(refused());
        } else {
          onChange(fake.printAgents);
        }
      });
      return () => { agentWatchers.delete(listener); };
    }),
    queuePrintJob: vi.fn<RecipesSource['queuePrintJob']>(async job => {
      if (queueHold) await queueHold;
      if (refuse.queue) throw refused();
      fake.jobs.push({ ...job });
    }),
    saveLabelConfig: vi.fn<RecipesSource['saveLabelConfig']>(async patch => {
      if (labelSaveHold) await labelSaveHold;
      if (refuse.labelSave) throw refused();
      fake.labelSaves.push({ ...patch });
      fake.labelConfig = { ...(fake.labelConfig ?? {}), ...patch };
      fake.push();
    }),
    watchSuppliers: vi.fn<RecipesSource['watchSuppliers']>(
      watch(supplierWatchers, () => false, () => [...suppliers.values()]),
    ),
    // A merge, like setDoc(…, { merge: true }): the fields handed over replace the stored ones, a null one is removed,
    // and every other stored field stays.
    saveRecipeDoc: vi.fn<RecipesSource['saveRecipeDoc']>(async (id, data) => {
      if (recipeWriteHold) await recipeWriteHold;
      if (fake.refuseRecipeWrites.save) throw refused();
      fake.recipeWrites.push({ id, data: { ...data } });
      const merged: Record<string, unknown> = { ...(recipes.get(id) ?? {}), ...data, id };
      for (const [key, value] of Object.entries(data)) if (value === null) delete merged[key];
      recipes.set(id, merged as StoredDoc);
      fake.push();
    }),
    removeRecipeDoc: vi.fn<RecipesSource['removeRecipeDoc']>(async id => {
      if (recipeWriteHold) await recipeWriteHold;
      if (fake.refuseRecipeWrites.remove) throw refused();
      fake.recipeWrites.push({ id, deleted: true });
      recipes.delete(id);
      fake.push();
    }),
    importIntoCalculator: vi.fn<RecipesSource['importIntoCalculator']>(async (recipe, marketOrderTitle) => {
      if (importHold) await importHold;
      if (fake.refuseImport !== null) throw fake.refuseImport;
      fake.imports.push({ recipe, marketOrderTitle });
      return fake.importResult;
    }),
    getCalculatorConfig: vi.fn<RecipesSource['getCalculatorConfig']>(async () => {
      if (calculatorHold) await calculatorHold;
      return fake.calculatorConfig;
    }),
  };
  return fake;
}
