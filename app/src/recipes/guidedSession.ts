import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { isResumable, normalizeEndNote, normalizeSteps } from '@mise/shared/guided-model';
import type { GuidedStep } from '@mise/shared/guided-model';

// The mix in progress, saved on THIS phone (a port of the saved session of js/catalogue/guided-run.js).
//
// ⚠️ THE KEY AND THE SHAPE ARE THE CURRENT APP'S, EXACTLY: both apps live on one origin, so a mix started in one is
// resumable in the other. localStorage and not Firestore on purpose — it belongs to the phone doing the mixing, it must
// survive with no connection, and nobody else's screen should follow along. (The key is not under KEEP_PREFIXES: a venue
// switch or a sign-out wipes it, which is right for a mix that belongs to a venue's recipe.)
export const SESSION_KEY = 'catalogue-guided-run';

// Everything the run needs, copied out of the recipe at the moment the mix is started: the rows come along because a step
// names ROWS, and those rows must keep the labels, units and amounts they had when the dough was started.
export interface GuidedSnapshot {
  name: string;
  ingredients: CatalogueRecipe['ingredients'];
  steps: GuidedStep[];
  endNote: string;
  targetGrams: number;
}

export interface GuidedSession {
  recipeId: string;
  snapshot: GuidedSnapshot;
  stepIndex: number;
  // The wall-clock instant the running timer ends; 0 when none is running.
  endsAt: number;
  startedAt: number;
}

// The three things a session needs of a Storage (a spec passes a fake).
export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// The phone's own storage, or null when the browser will not give it (blocked site data): then nothing is remembered.
function phoneStorage(): SessionStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ⚠️ THE CLOSING MESSAGE TRAVELS WITH THE SNAPSHOT. Left out, a run resumed from a saved session reaches the end and shows
// nothing, because the resume path never sees the live recipe again.
export function snapshotOf(recipe: CatalogueRecipe, targetGrams: number | null | undefined): GuidedSnapshot {
  const target = Number(targetGrams);
  return {
    name: String(recipe.name || ''),
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    steps: normalizeSteps(recipe.steps),
    endNote: normalizeEndNote(recipe.endNote),
    targetGrams: target > 0 ? target : 0,
  };
}

// What is stored, or null: nothing, junk JSON, a storage that throws. The shape is judged by `isResumable` later.
export function readSession(storage: SessionStorage | null = phoneStorage()): GuidedSession | null {
  if (storage === null) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SESSION_KEY) ?? 'null');
    return parsed !== null && typeof parsed === 'object' ? parsed as GuidedSession : null;
  } catch {
    return null;
  }
}

// Whether the session was written: false when the browser gives no storage or refuses the write (full, blocked). The mix still
// runs then; it just cannot be picked up again after a reload.
export function writeSession(session: GuidedSession, storage: SessionStorage | null = phoneStorage()): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearSession(storage: SessionStorage | null = phoneStorage()): void {
  if (storage === null) return;
  try {
    storage.removeItem(SESSION_KEY);
  } catch { /* nothing to be done */ }
}

// A session worth offering back: recent, whole, and for a recipe still in the catalogue. A recipe deleted since is dropped
// rather than resumed against a snapshot of something that no longer exists.
export function resumableSession(
  recipes: readonly { readonly id: string }[],
  nowMs: number = Date.now(),
  storage: SessionStorage | null = phoneStorage(),
): GuidedSession | null {
  const saved = readSession(storage);
  if (!isResumable(saved, nowMs) || saved === null) return null;
  return recipes.some(recipe => recipe.id === saved.recipeId) ? saved : null;
}

// A fresh session for a mix about to start: step 1, no timer, started now.
export function freshSession(recipe: CatalogueRecipe, targetGrams: number | null | undefined, nowMs: number = Date.now()): GuidedSession {
  return { recipeId: recipe.id, snapshot: snapshotOf(recipe, targetGrams), stepIndex: 0, endsAt: 0, startedAt: nowMs };
}
