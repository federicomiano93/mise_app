// recipesStore.ts — the Recipe catalogue's recipes for one venue, and the two per-device memories the
// list and the recipe screen keep: how often each recipe was opened, and a batch calculated for it.
//
// A port of the recipe half of js/catalogue/catalogue-store.js, decision for decision, as plain
// TypeScript with no React and no Firebase in it: the source (recipesSource.ts) and the browser
// (deps) are injected, so every trap below is a spec with fakes (recipesStore.spec.ts). Screens read
// it through RecipesContext.tsx. Steps 3d-1 to 3d-3 only read (recipes, then the ingredients the
// allergen gate looks rows up in, then the label profile the label screen lays the paper out with);
// the writes (save, delete) come with 3d-6, the label profile's with 3d-5.
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
// The same two rules hold for the INGREDIENTS (3d-2): an empty or shrunken answer from the browser's
// own database would turn every linked row into «not declared» or «deleted ingredient» — the safe
// direction for a label, but a false alarm on every recipe screen.
//
// ⚠️ THE INGREDIENTS FAIL QUIETLY (parity item 13): a venue without Orders may have none or no right to
// read them; every linked row then reads «not declared», the honest answer. No message, only a warning
// in the console — and the wait ends, so a screen never waits for them for ever.

import { isScaledEntryFresh, normalizeCatalogueRecipes } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import type { KeyValueStorage } from '../session/backend';
import { withoutPrice } from './recipesSource';
import type { RecipesMeta, RecipesSource, StoredDoc } from './recipesSource';

// ⚠️ THE CURRENT APP'S KEYS, WITH THEIR MEANING (both apps share one origin): either app paints from
// the other's copy, so the recipes are stored NORMALISED, by the ported normaliser, as the current
// app stores them. Not under KEEP_PREFIXES, so a venue switch wipes them (the venue is not in the key).
export const RECIPES_KEY = 'catalogue-recipes';
// { recipeId: openCount } — «most used first», per device, never written to the database.
export const USAGE_KEY = 'catalogue-usage';
// { recipeId: { target: grams, ts: ms } } — a calculated batch stays shown until Clear or 12 hours.
export const SCALED_KEY = 'catalogue-scaled';
// The ingredient documents as a JSON ARRAY (`{ id, … }`, every price key removed), read back into an
// id → document map, as js/catalogue/catalogue-store.js does.
export const INGREDIENTS_KEY = 'catalogue-ingredients';
// The label profile document AS STORED (config/labels), or JSON null when the venue has none.
// ⚠️ THE CURRENT APP DOES NOT WRITE THAT null: for «no document» it REMOVES the key. So «the venue has
// none» survives only while Mise 2 is the last app to have heard the answer; after a visit to the current
// app it reads as «never told», and an offline Mise 2 then waits for the paper instead of using the
// defaults — the safe direction (no Print on a paper nobody confirmed), accepted on purpose. The current
// app reads Mise 2's "null" as null, which is the same answer. ⚠️ CACHED for the reason the current app gives: a label is printed
// at the counter, and a phone that has lost the network must still know what size paper this venue
// uses. Stored raw, never normalised: label-template-model's normalizer is the one place that decides
// what a missing or corrupt field means, in both apps.
export const LABEL_CONFIG_KEY = 'catalogue-label-config';

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
  // The ingredients by id — what the allergen gate looks a linked row up in. NO PRICE KEYS (header).
  readonly ingredients: Readonly<Record<string, StoredDoc>>;
  // Whether the ingredients can be judged: the local copy existed, a believable answer came, or their
  // stream failed (quietly). Until then no allergen verdict may be drawn — every row would read «not
  // declared» only because nothing has arrived.
  readonly ingredientsLoaded: boolean;
  // The ingredients' stream failed and NOTHING was ever held (no copy, no answer): every linked row
  // then looks «linked to an ingredient that no longer exists», which is untrue — the screens say
  // once that the list could not be read instead. Still no answer: the verdict stays «not declared».
  readonly ingredientsUnreadable: boolean;
  readonly usage: Readonly<Record<string, number>>;
  readonly scaled: Readonly<Record<string, ScaledEntry>>;
  // The label profile document as stored, or null (none). The screen normalises it.
  readonly labelConfig: Readonly<Record<string, unknown>> | null;
  // Whether the paper is KNOWN: the local copy existed (a document, or the word that there is none), a
  // believable answer came, or the stream failed (then the defaults, as the current app). Until then
  // a label cannot be laid out honestly — the defaults could be the wrong paper.
  readonly labelConfigKnown: boolean;
  // The shop computers that report in (print-agents), as the last answer left them; [] until one comes, and
  // after a failure. ⚠️ NEVER WRITTEN TO STORAGE BY THE APP, NOR READ FROM IT: a heartbeat is a statement about
  // RIGHT NOW. Firestore's own offline cache can still replay the last print-agents document to a phone that
  // opens offline; what bounds that is the 12-minute stale limit in printerPresence (the current app's rule,
  // catalogue-store.js), so an old beat is never believed for long.
  readonly printAgents: readonly StoredDoc[];
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
  // Puts a label job in the shop computer's queue. ⚠️ NOT LOCAL-FIRST: it rejects when the write cannot be made,
  // and the caller says so (the source explains why). Nothing is remembered here.
  queuePrintJob(job: Readonly<Record<string, unknown>>): Promise<void>;
  // Changes some fields of the label profile (config/labels), LOCAL-FIRST: the store's copy and the phone's copy
  // change at once and the snapshot is announced, then the source is asked. Resolves when the database has taken
  // the change. On a refusal the keys of THIS patch are put back to what they were just before it (except a key a
  // later patch has set since) and the promise rejects, so the screen can say so.
  saveLabelProfile(patch: Readonly<Record<string, unknown>>): Promise<void>;
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

// A stored ingredient list → id → document, the price keys dropped (a copy written by an older app).
function asIngredients(value: unknown): Record<string, StoredDoc> {
  const out: Record<string, StoredDoc> = {};
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (item && typeof item === 'object' && typeof (item as StoredDoc).id === 'string' && (item as StoredDoc).id) {
      out[(item as StoredDoc).id] = withoutPrice(item as StoredDoc);
    }
  }
  return out;
}

// A stored label profile: a plain object, or null for anything else (none, corrupt, an array…).
function asLabelConfig(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : null;
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
  // The stored text, or undefined when there is none (or storage refuses).
  function readRaw(key: string): string | undefined {
    try {
      return deps.storage?.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  }
  // Parsed, or undefined when the text is not JSON (a corrupt copy is no answer).
  function parseOr(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
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
  const bootIngredients = readJson(INGREDIENTS_KEY);
  const bootSaidNoIngredients = Array.isArray(bootIngredients) && bootIngredients.length === 0;
  let ingredients: Readonly<Record<string, StoredDoc>> = asIngredients(bootIngredients);
  let ingredientsLoaded = Array.isArray(bootIngredients);
  let ingredientsFromServer = false;
  let ingredientsUnreadable = false;
  // ⚠️ «THE KEY HOLDS null» AND «THERE IS NO KEY» ARE TWO ANSWERS: the first is a copy saying the venue
  // has no label profile (the defaults are right), the second is a phone that has never been told.
  const bootLabelRaw = readRaw(LABEL_CONFIG_KEY);
  const bootLabel = bootLabelRaw === undefined ? undefined : parseOr(bootLabelRaw);
  let labelConfig: Record<string, unknown> | null = asLabelConfig(bootLabel);
  let labelConfigKnown = bootLabel === null || labelConfig !== null;
  let labelConfigFromServer = false;
  // The label profile's local writes (saveLabelProfile): a running number per patch, and which patch last set each key.
  let labelPatchNumber = 0;
  const labelKeyOwner = new Map<string, number>();
  let printAgents: readonly StoredDoc[] = [];
  // The counts are kept even when a corrupt entry is dropped: they are a nicety, not data.
  let usage: Readonly<Record<string, number>> = asUsage(readJson(USAGE_KEY));
  let scaled: Readonly<Record<string, ScaledEntry>> = asScaled(readJson(SCALED_KEY));

  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: RecipesMessage) => void>();
  let stops: Array<() => void> = [];
  let started = false;

  let snapshot: RecipesSnapshot = build();

  function build(): RecipesSnapshot {
    return { recipes, recipesLoaded, recipesFromServer, streamBroken, ingredients, ingredientsLoaded, ingredientsUnreadable, usage,
      scaled, labelConfig, labelConfigKnown, printAgents };
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

  // The same judgement for the ingredients, against their own copy and their own server word.
  function believableIngredients(list: readonly StoredDoc[], meta: RecipesMeta): boolean {
    if (meta.fromServer) return true;
    if (ingredientsFromServer) return list.length > 0 || bootSaidNoIngredients;
    if (list.length === 0) return bootSaidNoIngredients;
    const ids = new Set(list.map(doc => doc.id));
    return Object.keys(ingredients).every(id => ids.has(id));
  }

  // ⚠️ «NO DOCUMENT» FROM THE BROWSER'S OWN DATABASE IS NOT THE TRUTH unless the local copy said so too:
  // that database may simply never have read config/labels, and believing it would lay a label out on
  // the DEFAULT paper (76 × 51) for a venue that prints on 57 × 32 — a label that prints wrong with
  // nothing saying why. A cached document that EXISTS is believed (it is the venue's own, maybe old).
  function believableLabel(data: Record<string, unknown> | null, meta: RecipesMeta): boolean {
    if (meta.fromServer || labelConfigFromServer) return true;
    if (data !== null) return true;
    return labelConfigKnown && labelConfig === null;
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
      stops.push(source.watchIngredients(
        (remote, meta) => {
          if (meta.fromServer) ingredientsFromServer = true;
          if (!believableIngredients(remote, meta)) return;
          // The source already removed the prices; removed again so no path can store one.
          const clean = remote.filter(doc => doc && typeof doc.id === 'string' && doc.id).map(withoutPrice);
          ingredients = asIngredients(clean);
          ingredientsLoaded = true;
          ingredientsUnreadable = false;
          writeJson(INGREDIENTS_KEY, clean);
          changed();
        },
        err => {
          deps.warn('Ingredients unavailable:', err);
          // Only when nothing was ever held: a copy or an earlier answer stays on screen as the data.
          if (!ingredientsLoaded) {
            ingredientsLoaded = true;
            ingredientsUnreadable = true;
            changed();
          }
        },
      ));
      stops.push(source.watchLabelConfig(
        (remote, meta) => {
          if (meta.fromServer) labelConfigFromServer = true;
          if (!believableLabel(remote, meta)) return;
          labelConfig = asLabelConfig(remote);
          labelConfigKnown = true;
          writeJson(LABEL_CONFIG_KEY, labelConfig);
          changed();
        },
        err => {
          deps.warn('Label settings unavailable:', err);
          // Quiet, as the current app: what is held stays; with nothing held the defaults are used —
          // the wait must end, or a refused read would leave Print dead for ever.
          if (!labelConfigKnown) {
            labelConfigKnown = true;
            changed();
          }
        },
      ));
      stops.push(source.watchPrintAgents(
        remote => {
          printAgents = Array.isArray(remote) ? remote : [];
          changed();
        },
        err => {
          // Quiet, as the current app: «nothing is listening» is the honest answer for a venue that runs no
          // agent, or whose read was refused.
          deps.warn('Print agents unavailable:', err);
          printAgents = [];
          changed();
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

    queuePrintJob: job => source.queuePrintJob(job),

    // ⚠️ THE WRITES ARE NOT CHAINED, AND THAT IS ON PURPOSE (the current app chains them behind each other). Each call
    // asks the source at once, in the order the taps were made: Firestore commits ONE client's writes in the order
    // they were made, and keeps the ones it has not sent in its own persistent queue across a reload while offline.
    // A chain held in memory would keep the later changes in the page, and a reload while offline would lose them —
    // after the screen had shown them as saved. (The defect the chain was made for, a height landing before a width,
    // came from two writes with no ordering; one client's writes have one.)
    //
    // ⚠️ ON A REFUSAL ONLY THE KEYS OF THE REFUSED PATCH ARE PUT BACK, to the value each had just before it — and a key
    // a LATER patch has set since keeps that later value: taking the whole document back would also undo a change the
    // person made after, and that one may well have been accepted.
    saveLabelProfile(patch) {
      const keys = Object.keys(patch);
      const wasNone = labelConfig === null;
      const current: Record<string, unknown> = labelConfig ?? {};
      // What each key held (or that it held nothing) just before this patch.
      const before = new Map<string, { had: boolean; value: unknown }>();
      for (const key of keys) before.set(key, { had: key in current, value: current[key] });
      const mine = ++labelPatchNumber;
      for (const key of keys) labelKeyOwner.set(key, mine);

      labelConfig = { ...current, ...patch };
      writeJson(LABEL_CONFIG_KEY, labelConfig);
      changed();

      let written: Promise<void>;
      try {
        written = source.saveLabelConfig(patch);
      } catch (err) {
        written = Promise.reject(err);
      }
      return written.catch((err: unknown) => {
        const next: Record<string, unknown> = { ...(labelConfig ?? {}) };
        for (const key of keys) {
          if (labelKeyOwner.get(key) !== mine) continue;
          const was = before.get(key);
          if (was?.had) next[key] = was.value;
          else delete next[key];
          labelKeyOwner.delete(key);
        }
        // A venue that had no document goes back to having none, not to an empty one.
        labelConfig = Object.keys(next).length === 0 && wasNone ? null : next;
        writeJson(LABEL_CONFIG_KEY, labelConfig);
        changed();
        throw err;
      });
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
