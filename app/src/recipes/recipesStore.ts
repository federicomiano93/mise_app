// recipesStore.ts — the Recipe catalogue's recipes for one venue, and the two per-device memories the
// list and the recipe screen keep: how often each recipe was opened, and a batch calculated for it.
//
// A port of the recipe half of js/catalogue/catalogue-store.js, decision for decision, as plain
// TypeScript with no React and no Firebase in it: the source (recipesSource.ts) and the browser
// (deps) are injected, so every trap below is a spec with fakes (recipesStore.spec.ts). Screens read
// it through RecipesContext.tsx. Steps 3d-1 to 3d-3 only read (recipes, then the ingredients the
// allergen gate looks rows up in, then the label profile the label screen lays the paper out with);
// the label profile's writes came with 3d-5, and 3d-6 writes recipes (save, delete — local-first, rolled
// back when refused) and watches the suppliers the link chooser names.
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

import {
  calculatorImportKind, isScaledEntryFresh, labelFieldsOf,
} from '@mise/shared/catalogue-model';
import type { CalculatorImportKind, CatalogueRecipe, ImportAction } from '@mise/shared/catalogue-model';
import { normalizeEndNote, normalizeSteps, ridOf, withRowIds } from '@mise/shared/guided-model';
import type { KeyValueStorage } from '../session/backend';
import { LABEL_TEXT_FIELDS, labelTextPatchOf, normalizeStoredRecipe, normalizeStoredRecipes } from './labelTexts';
import { newRecipeId, withoutPrice } from './recipesSource';
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
// The supplier documents as a JSON ARRAY, read back into an id → document map, as the current app does: only the
// names matter (the link chooser tells two similar articles apart by them).
export const SUPPLIERS_KEY = 'catalogue-suppliers';

// How long a delete waits to learn whether the recipe was imported into the Calculator (parity item 83): a slow or
// offline read never blocks a delete, it simply does not warn.
export const IMPORT_CHECK_MS = 2500;

// What a save is handed: the editor's cleaned working copy. `id` is null (or absent) for a new recipe. Every row is
// written as it comes (its link and its row id included); the store mints the row ids that are missing.
export interface RecipeToSave {
  readonly id?: string | null;
  readonly name: string;
  readonly ingredients: readonly Readonly<Record<string, unknown>>[];
  readonly netWeightG?: unknown;
  readonly shelfLifeDays?: unknown;
  // The mixing procedure and its closing message, as the working copy carries them. ⚠️ SENT ONLY WHEN THE RECIPE IS NEW
  // (no copy of it is held): a DUPLICATE starts with its original's procedure. For an existing recipe they are ignored here
  // and stay as stored (KEPT_FIELDS), whatever the working copy holds: their editor is the steps editor.
  readonly steps?: unknown;
  readonly endNote?: unknown;
  // The image label's two texts (labelTexts.ts): a string as typed (empty = take the field away), or undefined when a
  // caller leaves them out — then they are not sent and stay as stored. ⚠️ THE EDITOR NEVER LEAVES THEM OUT: its
  // cleanWorking hands back the texts it opened with (stored values pass through), so an untouched editor re-sends them as
  // they were when opened, exactly like the name and the ingredients.
  readonly labelName?: unknown;
  readonly labelIngredientsText?: unknown;
}

// What the steps editor saves (step 3d-8): the procedure and its closing message, as typed (the store normalises
// them), the recipe's name for a refusal's sentence, and `rows` — the recipe's rows as the editor copied them, with
// the row ids it minted for rows that had none (a step can only name a row by its id).
export interface ProcedureToSave {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly unknown[];
  readonly endNote: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

// The fields a save never sends, and that the local copy keeps from the version before it until the next snapshot:
//   • the oven loss and its two weighings — Food cost weighs them on a product's recipe line (13 Sep 2026), and a copy
//     read before the weighing and saved after would silently undo it (the current app's rule);
//   • the mixing procedure and its closing message — NEW IN MISE 2: their editor is step 3d-8, so this one never
//     changes them, and a merge that does not send them leaves them exactly as stored (the current app rewrites them
//     on every save from the copy it read).
const KEPT_FIELDS = ['lossPct', 'rawGrams', 'cookedGrams', 'steps', 'endNote'] as const;

export type RecipesMessage =
  // The recipes' live stream died: what is on screen may be old.
  | { readonly kind: 'recipes-stream-broken' }
  // A save the database refused: the change has been taken back. `name` is what was typed (may be empty).
  | { readonly kind: 'recipe-not-saved'; readonly name: string }
  // A delete the database refused: the recipe is back.
  | { readonly kind: 'recipe-not-deleted' };

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
  // The suppliers by id (only the names matter), for the link chooser. {} until they arrive, and after a quiet failure.
  readonly suppliers: Readonly<Record<string, StoredDoc>>;
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
  // The image label's logo (label-assets/logo), straight through to the source: watched by the screens that show it, for
  // as long as they are on screen (useLabelLogo.ts), never by the store — and never copied into storage (tens of
  // kilobytes; Firestore's own offline cache already holds the last one read).
  watchLabelLogo: RecipesSource['watchLabelLogo'];
  saveLabelLogo: RecipesSource['saveLabelLogo'];
  removeLabelLogo: RecipesSource['removeLabelLogo'];
  // Saves a recipe, LOCAL-FIRST: the list changes at once (and the phone's copy), then the database is asked. Returns
  // the recipe's id at once (a new one is made on the phone). Never waits for the network. A REFUSED write takes the
  // change back (the version before it, or no recipe at all for a new one) and says so with a RecipesMessage.
  saveRecipe(recipe: RecipeToSave): string;
  // Deletes a recipe, LOCAL-FIRST, with its open count and its remembered batch. A refused delete puts it back and
  // says so.
  deleteRecipe(id: string): void;
  // Saves a recipe's mixing procedure (steps + closing message), LOCAL-FIRST like saveRecipe, as a MERGE of those two
  // fields only — plus the ingredient rows when some row had no id yet (see the method). An empty procedure is saved
  // as empty, which deletes it. A refusal puts the version before it back and says `recipe-not-saved`. Returns false,
  // and writes nothing, when the recipe is not held (deleted meanwhile).
  saveProcedure(procedure: ProcedureToSave): boolean;
  // How the Calculator stands to the recipe: 'linked' (a tab follows it live), 'copy' (an old import that stays on its
  // own) or null (neither): config/calculator read once, raced against IMPORT_CHECK_MS. Never rejects: a slow, offline
  // or refused read answers null.
  calculatorImportOf(id: string): Promise<CalculatorImportKind | null>;
  // Links a recipe to the Calculator (a transaction on the server: NOT local-first). Resolves with what was done and
  // counts the recipe as used (the current app does: opening a recipe and importing it are both use); REJECTS when the
  // write cannot be made, and counts nothing.
  importIntoCalculator(recipe: CatalogueRecipe, marketOrderTitle: string): Promise<ImportAction>;
}

// A row as Firestore will take it: a key holding `undefined` makes the whole write throw, so it is left out.
function withoutUndefined(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row ?? {})) if (value !== undefined) out[key] = value;
  return out;
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

  let recipes: readonly CatalogueRecipe[] = normalizeStoredRecipes(bootRecipes);
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
  // Per key, while some patch on it is still in the air: the value it held before the first of them (`base`, the
  // confirmed one) and every patch's value with how it ended.
  type KeyEntry = { n: number; value: unknown; state: 'pending' | 'ok' | 'refused' };
  const labelKeyLog = new Map<string, { base: { had: boolean; value: unknown }; entries: KeyEntry[] }>();
  // Whether the venue had no label document when the first patch in the air was made.
  let labelNoneBeforeLog = false;
  let printAgents: readonly StoredDoc[] = [];
  let suppliers: Readonly<Record<string, StoredDoc>> = asIngredients(readJson(SUPPLIERS_KEY));
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
      scaled, labelConfig, labelConfigKnown, printAgents, suppliers };
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
  // (A save or a delete made on this phone cannot be mistaken here: Firestore's local view, which every answer comes
  // from, already holds the pending write, so it agrees with the list the store changed at once.)
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

  // Puts a recipe into the list (replacing the one with its id), normalised as the current app stores it, and into the
  // phone's copy. Announced.
  function upsertLocal(raw: Record<string, unknown>): void {
    const norm = normalizeStoredRecipe(raw);
    if (!norm) return;
    const at = recipes.findIndex(recipe => recipe.id === norm.id);
    const next = recipes.slice();
    if (at >= 0) next[at] = norm; else next.push(norm);
    recipes = next;
    writeJson(RECIPES_KEY, recipes);
    changed();
  }

  function removeLocal(id: string): void {
    recipes = recipes.filter(recipe => recipe.id !== id);
    writeJson(RECIPES_KEY, recipes);
    changed();
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

  function bumpUsage(id: string): void {
    if (!id) return;
    usage = { ...usage, [id]: (usage[id] ?? 0) + 1 };
    writeJson(USAGE_KEY, usage);
    changed();
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
          recipes = normalizeStoredRecipes(remote);
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
      stops.push(source.watchSuppliers(
        (remote, meta) => {
          // An empty answer from the browser's own database over suppliers already held is not believed (it may never
          // have read them). Only names, so nothing worse than a missing supplier beside an article is at stake.
          if (!meta.fromServer && remote.length === 0 && Object.keys(suppliers).length > 0) return;
          const clean = remote.filter(doc => doc && typeof doc.id === 'string' && doc.id);
          suppliers = asIngredients(clean);
          writeJson(SUPPLIERS_KEY, clean);
          changed();
        },
        err => {
          // Quiet, as the current app: a venue without Orders has no suppliers.
          deps.warn('Suppliers unavailable:', err);
        },
      ));
    },

    stop() {
      started = false;
      for (const stop of stops) stop();
      stops = [];
    },

    bumpUsage,

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
    watchLabelLogo: (onChange, onError) => source.watchLabelLogo(onChange, onError),
    saveLabelLogo: logo => source.saveLabelLogo(logo),
    removeLabelLogo: () => source.removeLabelLogo(),

    // ⚠️ THE WRITES ARE NOT CHAINED, AND THAT IS ON PURPOSE (the current app chains them behind each other). Each call
    // asks the source at once, in the order the taps were made: Firestore commits ONE client's writes in the order
    // they were made, and keeps the ones it has not sent in its own persistent queue across a reload while offline.
    // A chain held in memory would keep the later changes in the page, and a reload while offline would lose them —
    // after the screen had shown them as saved. (The defect the chain was made for, a height landing before a width,
    // came from two writes with no ordering; one client's writes have one.)
    //
    // ⚠️ ON A REFUSAL ONLY THE KEYS OF THE REFUSED PATCH ARE PUT BACK — and a key a LATER patch (still in the air, or
    // accepted) has set since keeps that later value: taking the whole document back would also undo a change the person
    // made after. A key is put back to the value of the most recent EARLIER patch on it that was not itself refused,
    // else to the value it held before the first patch in the air (the confirmed one): two refused patches on one key,
    // in whichever order they are refused, never leave the first one's refused value behind.
    saveLabelProfile(patch) {
      const keys = Object.keys(patch);
      if (labelKeyLog.size === 0) labelNoneBeforeLog = labelConfig === null;
      const current: Record<string, unknown> = labelConfig ?? {};
      const mine = ++labelPatchNumber;
      for (const key of keys) {
        let log = labelKeyLog.get(key);
        if (!log) {
          log = { base: { had: key in current, value: current[key] }, entries: [] };
          labelKeyLog.set(key, log);
        }
        log.entries.push({ n: mine, value: patch[key], state: 'pending' });
      }
      // Forgets a key's history once nothing on it is in the air.
      const tidy = () => {
        for (const [key, log] of [...labelKeyLog]) {
          if (!log.entries.some(entry => entry.state === 'pending')) labelKeyLog.delete(key);
        }
      };
      const settle = (state: 'ok' | 'refused') => {
        for (const key of keys) {
          const entry = labelKeyLog.get(key)?.entries.find(candidate => candidate.n === mine);
          if (entry) entry.state = state;
        }
      };

      labelConfig = { ...current, ...patch };
      writeJson(LABEL_CONFIG_KEY, labelConfig);
      changed();

      let written: Promise<void>;
      try {
        written = source.saveLabelConfig(patch);
      } catch (err) {
        written = Promise.reject(err);
      }
      return written.then(() => {
        settle('ok');
        tidy();
      }, (err: unknown) => {
        settle('refused');
        const next: Record<string, unknown> = { ...(labelConfig ?? {}) };
        for (const key of keys) {
          const log = labelKeyLog.get(key);
          if (!log) continue;
          const mineAt = log.entries.findIndex(entry => entry.n === mine);
          // A later patch that was not refused owns the key now.
          if (log.entries.slice(mineAt + 1).some(entry => entry.state !== 'refused')) continue;
          const earlier = log.entries.slice(0, mineAt).filter(entry => entry.state !== 'refused').at(-1);
          if (earlier) next[key] = earlier.value;
          else if (log.base.had) next[key] = log.base.value;
          else delete next[key];
        }
        tidy();
        // A venue that had no document goes back to having none, not to an empty one.
        labelConfig = Object.keys(next).length === 0 && labelNoneBeforeLog ? null : next;
        writeJson(LABEL_CONFIG_KEY, labelConfig);
        changed();
        throw err;
      });
    },

    // ⚠️ THE FIELDS ARE LISTED BY HAND, as in the current app: this object becomes the Firestore document and the rules
    // whitelist its keys by name, so spreading the recipe would send `id` (and anything else it carries) and every save
    // would be refused. What is NOT sent is in KEPT_FIELDS, with why.
    // ⚠️ SAVE IS THE ONE PLACE ROW IDS ARE MINTED (withRowIds): a mixing step or a Calculator tab that points at a row by
    // its `rid` still finds it after a rename or a row inserted above it. A row that has one keeps it.
    saveRecipe(recipe) {
      const rows = withRowIds(recipe.ingredients.map(withoutUndefined));
      const data: Record<string, unknown> = {
        name: recipe.name,
        ingredients: rows,
        // A number, or null for an emptied box, which the source sends as a removal.
        ...labelFieldsOf(recipe),
        // The image label's texts only when the editor handed them over (null = emptied, a removal too).
        ...labelTextPatchOf(recipe),
      };
      const id = recipe.id || newRecipeId();
      const prev = recipes.find(candidate => candidate.id === id) ?? null;
      // ⚠️ A NEW RECIPE MAY ARRIVE WITH A PROCEDURE (a duplicate): shaped exactly as saveProcedure shapes it, and a step
      // names only rows that exist in what is saved (the rows were just given their ids, a row the person deleted from the
      // copy takes its mention out of the steps). Never for an existing recipe: the merge would overwrite its procedure.
      if (!prev && (recipe.steps !== undefined || recipe.endNote !== undefined)) {
        const saved = new Set(rows.map(ridOf));
        data.steps = normalizeSteps(normalizeSteps(recipe.steps).map(step => ({ ...step, rows: step.rows.filter(rid => saved.has(rid)) })));
        data.endNote = normalizeEndNote(recipe.endNote);
      }
      const kept: Record<string, unknown> = {};
      if (prev) {
        const held = prev as unknown as Record<string, unknown>;
        for (const key of KEPT_FIELDS) if (held[key] !== undefined) kept[key] = held[key];
        // The image label's texts this save does not send stay as the phone held them, until the next snapshot.
        for (const key of LABEL_TEXT_FIELDS) if (!(key in data) && held[key] !== undefined) kept[key] = held[key];
      }
      upsertLocal({ ...kept, id, ...data });
      let written: Promise<void>;
      try {
        written = source.saveRecipeDoc(id, data);
      } catch (err) {
        written = Promise.reject(err);
      }
      written.catch((err: unknown) => {
        deps.warn('Recipe did not sync to Firestore:', err);
        if (prev) upsertLocal(prev as unknown as Record<string, unknown>); else removeLocal(id);
        say({ kind: 'recipe-not-saved', name: recipe.name });
      });
      return id;
    },

    // ⚠️ ONLY `steps` AND `endNote` TRAVEL (a merge), written even when EMPTY: a merge never deletes a field it is not
    // sent, so an omitted empty procedure would leave the old steps in the document (the current app's reason).
    // ⚠️ THE ROWS TRAVEL ONLY WHEN THE RECIPE HOLDS A ROW WITH NO ID (or one sharing an earlier row's). The current app
    // rewrites every row from the copy the steps editor opened with, which takes back a row added on another phone
    // meanwhile; here a recipe whose rows all have ids (every recipe saved by either app's editor since row ids exist) keeps
    // its rows untouched. When ids must be stored, they are put on the rows AS THIS PHONE HOLDS THEM NOW, matched to the
    // editor's copy by place and name; a step whose row cannot be matched says «no longer in the recipe» instead of naming
    // the wrong ingredient. Left as the current app: saved OFFLINE on a copy that still lacks the ids, the rows go from that
    // copy and win over another phone's row edits when the save reaches the server (a transaction would need the network).
    saveProcedure(procedure) {
      const prev = recipes.find(candidate => candidate.id === procedure.id) ?? null;
      if (!prev) return false;
      const held = prev.ingredients as unknown as readonly Readonly<Record<string, unknown>>[];
      // A held row's id counts only when it is there and not shared with an earlier row (withRowIds' own test): a row
      // with none, or with a duplicate, needs one stored.
      const unique = new Set<string>();
      const usable = held.map(row => {
        const rid = ridOf(row);
        if (!rid || unique.has(rid)) return '';
        unique.add(rid);
        return rid;
      });
      // The editor ticked its rows by the ids of ITS copy. A row of that copy whose id the recipe does not hold is matched
      // to the held row at the same place with the same name: when that row has an id of its own (another phone stored
      // one since the editor opened), the steps are pointed at it; when it has none, it takes the editor's.
      const remap = new Map<string, string>();
      const given = new Map<number, string>();
      procedure.rows.forEach((twin, i) => {
        const rid = ridOf(twin);
        const row = held[i];
        if (!rid || unique.has(rid) || !row) return;
        if (String(twin.label ?? '').trim() !== String(row.label ?? '').trim()) return;
        if (usable[i]) remap.set(rid, usable[i]!);
        else if (![...given.values()].includes(rid)) given.set(i, rid);
      });
      const steps = normalizeSteps(procedure.steps).map(step => ({ ...step, rows: step.rows.map(rid => remap.get(rid) ?? rid) }));
      const data: Record<string, unknown> = {
        // normalizeSteps again: two ids remapped onto one row must not name it twice.
        steps: normalizeSteps(steps),
        endNote: normalizeEndNote(procedure.endNote),
      };
      if (usable.some(rid => !rid)) {
        const matched = held.map((row, i) => (usable[i] ? row : given.has(i) ? { ...row, rid: given.get(i)! } : row));
        data.ingredients = withRowIds(matched.map(withoutUndefined));
      }
      upsertLocal({ ...(prev as unknown as Record<string, unknown>), ...data });
      let written: Promise<void>;
      try {
        written = source.saveRecipeDoc(procedure.id, data);
      } catch (err) {
        written = Promise.reject(err);
      }
      written.catch((err: unknown) => {
        deps.warn('Procedure did not sync to Firestore:', err);
        upsertLocal(prev as unknown as Record<string, unknown>);
        say({ kind: 'recipe-not-saved', name: procedure.name });
      });
      return true;
    },

    deleteRecipe(id) {
      const prev = recipes.find(candidate => candidate.id === id) ?? null;
      if (usage[id] != null) {
        const next = { ...usage };
        delete next[id];
        usage = next;
        writeJson(USAGE_KEY, usage);
      }
      if (scaled[id] != null) {
        const next = { ...scaled };
        delete next[id];
        scaled = next;
        writeJson(SCALED_KEY, scaled);
      }
      removeLocal(id);
      let removed: Promise<void>;
      try {
        removed = source.removeRecipeDoc(id);
      } catch (err) {
        removed = Promise.reject(err);
      }
      removed.catch((err: unknown) => {
        deps.warn('Recipe delete did not sync to Firestore:', err);
        if (prev) upsertLocal(prev as unknown as Record<string, unknown>);
        say({ kind: 'recipe-not-deleted' });
      });
    },

    calculatorImportOf(id) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<CalculatorImportKind | null>(resolve => { timer = setTimeout(() => resolve(null), IMPORT_CHECK_MS); });
      let read: Promise<CalculatorImportKind | null>;
      try {
        read = source.getCalculatorConfig().then(config => calculatorImportKind(config, id), () => null);
      } catch {
        read = Promise.resolve(null);
      }
      return Promise.race([read, late]).finally(() => clearTimeout(timer));
    },

    async importIntoCalculator(recipe, marketOrderTitle) {
      const action = await source.importIntoCalculator(recipe, marketOrderTitle);
      bumpUsage(recipe.id);
      return action;
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
