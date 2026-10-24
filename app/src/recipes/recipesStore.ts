// recipesStore.ts — the Recipe catalogue's recipes for one venue, and the two per-device memories the
// list and the recipe screen keep: how often each recipe was opened, and a batch calculated for it.
//
// A port of the recipe half of js/catalogue/catalogue-store.js, decision for decision, as plain
// TypeScript with no React and no Firebase in it: the source (recipesSource.ts) and the browser
// (deps) are injected, so every trap below is a spec with fakes (recipesStore.spec.ts). Screens read
// it through RecipesContext.tsx. Step 3d-1 only reads; the writes (save, delete) come with 3d-6.
//
// It says nothing in words: a failure is a RecipesMessage, and the screen puts it in the person's
// language.
//
// ⚠️ TWO DIFFERENCES FROM THE ORIGINAL, ON PURPOSE (docs/parity/catalogue.md):
//   • an EMPTY answer from the browser's own database is not believed over a local copy that had
//     recipes (the Pastries' trap: that database can be empty because this phone never synced it),
//     nor, before the server's first answer, one that lacks a recipe the copy holds;
//   • the open counts and the remembered batches are pruned only on the SERVER's word: an answer from
//     the browser's own database can hold just the few recipes the Calculator read one by one, and
//     pruning on it would throw away the counts of every other recipe for good.

import { isScaledEntryFresh, normalizeCatalogueRecipes } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import type { KeyValueStorage } from '../session/backend';
import type { RecipesMeta, RecipesSource, StoredDoc } from './recipesSource';

// ⚠️ THE CURRENT APP'S KEYS, WITH THEIR MEANING (both apps share one origin): either app paints from
// the other's copy, so the recipes are stored NORMALISED, by the ported normaliser, as the current
// app stores them. Not under KEEP_PREFIXES, so a venue switch wipes them (the venue is not in the key).
export const RECIPES_KEY = 'catalogue-recipes';
// { recipeId: openCount } — «most used first», per device, never written to the database.
export const USAGE_KEY = 'catalogue-usage';
// { recipeId: { target: grams, ts: ms } } — a calculated batch stays shown until Clear or 12 hours.
export const SCALED_KEY = 'catalogue-scaled';

export type RecipesMessage =
  // The recipes' live stream died: what is on screen may be old.
  | { readonly kind: 'recipes-stream-broken' };

export interface ScaledEntry {
  readonly target: number;
  readonly ts: number;
}

export interface RecipesSnapshot {
  // Normalised, in the order the database gave them (the list sorts them itself).
  readonly recipes: readonly CatalogueRecipe[];
  // Whether the list can be shown: the local copy existed, or a believable answer came (or the
  // stream failed). Until then the list says «Loading…» and an address cannot open its recipe.
  readonly recipesLoaded: boolean;
  // Whether the SERVER has answered once: only then is «this recipe no longer exists» the truth.
  readonly recipesFromServer: boolean;
  // The live stream died (no resubscribe): the screen may say that what it shows may be old.
  readonly streamBroken: boolean;
  readonly usage: Readonly<Record<string, number>>;
  readonly scaled: Readonly<Record<string, ScaledEntry>>;
}

export interface RecipesDeps {
  // localStorage, or null when the browser will not give it (then nothing is remembered).
  readonly storage: KeyValueStorage | null;
  now(): number;
  warn(message: string, detail?: unknown): void;
}

export interface RecipesStore {
  getSnapshot(): RecipesSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: RecipesMessage) => void): () => void;
  // Starts the listener; stop() ends it. Safe to call start → stop → start (React's development mode
  // does exactly that).
  start(): void;
  stop(): void;
  // A recipe was OPENED by a person (not redrawn by the app): one more for «most used first».
  bumpUsage(id: string): void;
  // The batch remembered for a recipe on this device, in grams, or null (none, or older than 12 h).
  scaledTarget(id: string): number | null;
  // Remembers a calculated batch (grams > 0), stamped now. Anything else is ignored.
  setScaledTarget(id: string, grams: number): void;
  // Forgets it (Clear).
  clearScaledTarget(id: string): void;
}

// A map read back from storage: a plain object, or nothing (corrupt, an array, a number…).
function asMap(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asUsage(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, count] of Object.entries(asMap(value))) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) out[id] = count;
  }
  return out;
}

function asScaled(value: unknown): Record<string, ScaledEntry> {
  const out: Record<string, ScaledEntry> = {};
  for (const [id, entry] of Object.entries(asMap(value))) {
    const e = asMap(entry);
    if (typeof e.target === 'number' && typeof e.ts === 'number') out[id] = { target: e.target, ts: e.ts };
  }
  return out;
}

export function createRecipesStore(source: RecipesSource, deps: RecipesDeps): RecipesStore {
  // A corrupt or unavailable copy reads as «none»; the listener fills it in.
  function readJson(key: string): unknown {
    try {
      const raw = deps.storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function writeJson(key: string, value: unknown): void {
    try {
      deps.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the copy in memory still works this session.
    }
  }

  const bootRecipes = readJson(RECIPES_KEY);
  // ⚠️ ONLY A COPY THAT SAYS «NO RECIPES» MAY LET AN EMPTY CACHED ANSWER STAND (see believable()).
  const bootSaidNone = Array.isArray(bootRecipes) && bootRecipes.length === 0;

  let recipes: readonly CatalogueRecipe[] = normalizeCatalogueRecipes(bootRecipes);
  let recipesLoaded = Array.isArray(bootRecipes);
  let recipesFromServer = false;
  let streamBroken = false;
  // The counts are kept even when a corrupt entry is dropped: they are a nicety, not data.
  let usage: Readonly<Record<string, number>> = asUsage(readJson(USAGE_KEY));
  let scaled: Readonly<Record<string, ScaledEntry>> = asScaled(readJson(SCALED_KEY));

  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: RecipesMessage) => void>();
  let stops: Array<() => void> = [];
  let started = false;

  let snapshot: RecipesSnapshot = build();

  function build(): RecipesSnapshot {
    return { recipes, recipesLoaded, recipesFromServer, streamBroken, usage, scaled };
  }

  function changed(): void {
    snapshot = build();
    for (const listener of [...listeners]) listener();
  }

  function say(message: RecipesMessage): void {
    for (const listener of [...messageListeners]) listener(message);
  }

  // ⚠️ AN EMPTY ANSWER FROM THE BROWSER'S OWN DATABASE IS NOT THE TRUTH unless the local copy agreed
  // there were none: that database can be empty because this phone never synced the recipes, and
  // believing it would show «No recipes yet» over a venue that has forty.
  //
  // ⚠️ NOR IS ONE THAT LACKS A RECIPE ALREADY HELD, until the server has spoken once: that database can
  // hold only the few recipes the Calculator read one by one, and believing it would shrink the list,
  // say «Recipe deleted.» about one that exists, and save the shrunken list over the full local copy.
  // (This slice writes nothing, so nothing held can be a deletion made on this phone.)
  function believable(list: readonly StoredDoc[], meta: RecipesMeta): boolean {
    if (meta.fromServer) return true;
    if (recipesFromServer) return list.length > 0 || bootSaidNone;
    if (list.length === 0) return bootSaidNone;
    const ids = new Set(list.map(doc => doc.id));
    return recipes.every(recipe => ids.has(recipe.id));
  }

  // Drops the counts and the batches of recipes that no longer exist, and the batches older than
  // 12 hours, so neither map grows for ever. Only on the server's word (header).
  function prune(): void {
    const ids = new Set(recipes.map(r => r.id));
    const nextUsage: Record<string, number> = {};
    for (const [id, count] of Object.entries(usage)) if (ids.has(id)) nextUsage[id] = count;
    if (Object.keys(nextUsage).length !== Object.keys(usage).length) {
      usage = nextUsage;
      writeJson(USAGE_KEY, usage);
    }
    const now = deps.now();
    const nextScaled: Record<string, ScaledEntry> = {};
    for (const [id, entry] of Object.entries(scaled)) {
      if (ids.has(id) && isScaledEntryFresh(entry, now)) nextScaled[id] = entry;
    }
    if (Object.keys(nextScaled).length !== Object.keys(scaled).length) {
      scaled = nextScaled;
      writeJson(SCALED_KEY, scaled);
    }
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    onMessage(listener) {
      messageListeners.add(listener);
      return () => { messageListeners.delete(listener); };
    },

    start() {
      if (started) return;
      started = true;
      stops.push(source.watchRecipes(
        (remote, meta) => {
          if (meta.fromServer) recipesFromServer = true;
          if (!believable(remote, meta)) return;
          recipes = normalizeCatalogueRecipes(remote);
          recipesLoaded = true;
          writeJson(RECIPES_KEY, recipes);
          if (meta.fromServer) prune();
          changed();
        },
        err => {
          deps.warn('Catalogue live sync failed:', err);
          streamBroken = true;
          // A dead stream still ends the wait: the list shows what it has, and says why it may be old.
          recipesLoaded = true;
          changed();
          say({ kind: 'recipes-stream-broken' });
        },
      ));
    },

    stop() {
      started = false;
      for (const stop of stops) stop();
      stops = [];
    },

    bumpUsage(id) {
      if (!id) return;
      usage = { ...usage, [id]: (usage[id] ?? 0) + 1 };
      writeJson(USAGE_KEY, usage);
      changed();
    },

    // A pure read: an entry past its 12 hours reads as none, and is tidied away by the next prune
    // (the original tidied it on read; reading from a render must not write).
    scaledTarget(id) {
      const entry = scaled[id];
      return entry && isScaledEntryFresh(entry, deps.now()) ? entry.target : null;
    },

    setScaledTarget(id, grams) {
      if (!id || !(grams > 0) || !Number.isFinite(grams)) return;
      scaled = { ...scaled, [id]: { target: grams, ts: deps.now() } };
      writeJson(SCALED_KEY, scaled);
      changed();
    },

    clearScaledTarget(id) {
      if (scaled[id] == null) return;
      const next = { ...scaled };
      delete next[id];
      scaled = next;
      writeJson(SCALED_KEY, scaled);
      changed();
    },
  };
}

export function browserRecipesDeps(): RecipesDeps {
  let storage: KeyValueStorage | null = null;
  try { storage = window.localStorage; } catch { /* blocked site data */ }
  return {
    storage,
    now: () => Date.now(),
    warn: (message, detail) => console.warn(message, detail),
  };
}
