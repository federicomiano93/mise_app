import { useMemo, useSyncExternalStore } from 'react';
import { LAB_DRAFT_PREFIX } from '../../session/pendingLabWork';
import { MAX_DIGITS } from './keypadRules';
import { LAB_STEPS, clampPeople } from './labModel';
import type { LabDraft, LabLine, LabLineRef, LabStepId } from './labModel';

// A production in progress, kept on THIS tablet so that a screen turning off, a call, leaving the app or a reload loses nothing.
//
// ⚠️ NOT UNDER KEEP_PREFIXES, ON PURPOSE (like the Recipe book's mix in progress, recipes/guidedSession.ts): the draft holds a venue's
// weights and ingredient ids. A sign-out or a venue switch wipes every key outside the keep list (shared/local-data), which is what
// stops one business's half-made batch from being offered to the next person on a shared tablet. The key carries the venue and the
// product as well, so even a wipe that missed could not offer it elsewhere. The cost: signing out in the middle of a production drops
// it — which is why the sign-out and the venue switch ASK FIRST when a draft exists (session/pendingLabWork.ts, useLeaveFlow).
// ⚠️ NEVER READ BACK ON TRUST: the JSON is parsed field by field, every number clamped, and anything unsound makes the draft «none»
// (and removes it) rather than a screen that crashes at the oven. A draft is not stored before «Inizia».
export { LAB_DRAFT_PREFIX };

export const labDraftKey = (locationId: string, productId: string): string => `${LAB_DRAFT_PREFIX}${locationId}:${productId}`;

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// The tablet's own storage, or null when the browser will not give it (blocked site data): then nothing is remembered.
function phoneStorage(): DraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// What the keypad can type: digits with at most one comma, six digits in all (keypadRules.MAX_DIGITS).
const TYPED = /^\d*,?\d*$/;
const MAX_LINES = 200;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 200;
const isTyped = (value: unknown): value is string => typeof value === 'string' && TYPED.test(value) && value.replace(',', '').length <= MAX_DIGITS;

function readRef(value: unknown): LabLineRef | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'recipe' && isId(value.recipeId)) return { kind: 'recipe', recipeId: value.recipeId };
  if (value.kind === 'ingredient' && isId(value.ingredientId) && (value.unit === 'g' || value.unit === 'kg' || value.unit === 'pcs')) {
    return { kind: 'ingredient', ingredientId: value.ingredientId, unit: value.unit };
  }
  return null;
}

function readLine(value: unknown): LabLine | null {
  if (!isRecord(value) || !isId(value.key) || typeof value.added !== 'boolean') return null;
  const ref = readRef(value.ref);
  if (ref === null) return null;
  const planned = value.planned;
  if (planned !== null && !(typeof planned === 'number' && Number.isFinite(planned) && planned >= 0)) return null;
  return { key: value.key, ref, planned, added: value.added };
}

// The stored text → a draft, or null when it is not a sound one.
export function parseDraft(text: string | null): LabDraft | null {
  if (text === null) return null;
  try {
    const data: unknown = JSON.parse(text);
    if (!isRecord(data) || data.v !== 1) return null;
    const startedAt = data.startedAt;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) return null;
    if (typeof data.step !== 'string' || !(LAB_STEPS as readonly string[]).includes(data.step)) return null;
    if (!Array.isArray(data.lines) || data.lines.length > MAX_LINES) return null;
    const lines = data.lines.map(readLine);
    if (lines.some(line => line === null)) return null;
    const keys = new Set((lines as LabLine[]).map(line => line.key));
    if (keys.size !== lines.length) return null;

    const weighed: Record<string, string> = {};
    if (isRecord(data.weighed)) {
      for (const [key, typed] of Object.entries(data.weighed)) if (keys.has(key) && isTyped(typed)) weighed[key] = typed;
    }
    const ticked: Record<string, boolean> = {};
    if (isRecord(data.ticked)) {
      for (const [key, done] of Object.entries(data.ticked)) if (keys.has(key) && done === true) ticked[key] = true;
    }
    const orNull = (value: unknown): string | null => (isTyped(value) ? value : null);
    const frozen = data.minutesFrozen;
    return {
      startedAt,
      step: data.step as LabStepId,
      lines: lines as LabLine[],
      weighed,
      ticked,
      raw: orNull(data.raw),
      cooked: isTyped(data.cooked) ? data.cooked : '',
      pieces: orNull(data.pieces),
      minutes: orNull(data.minutes),
      minutesFrozen: typeof frozen === 'number' && Number.isFinite(frozen) && frozen >= 1 ? Math.round(frozen) : null,
      people: typeof data.people === 'number' && Number.isFinite(data.people) ? clampPeople(data.people) : null,
    };
  } catch {
    return null;
  }
}

export function serializeDraft(draft: LabDraft): string {
  return JSON.stringify({ v: 1, ...draft });
}

// ── The store: one key per venue and product, with listeners so the card's banner follows the lab on the same screen ─────────────

const listeners = new Set<() => void>();
const notify = (): void => { listeners.forEach(listener => { listener(); }); };

export function readDraft(key: string, storage: DraftStorage | null = phoneStorage()): LabDraft | null {
  if (storage === null) return null;
  let text: string | null = null;
  try {
    text = storage.getItem(key);
  } catch {
    return null;
  }
  const draft = parseDraft(text);
  if (draft === null && text !== null) clearDraft(key, storage);
  return draft;
}

export function writeDraft(key: string, draft: LabDraft, storage: DraftStorage | null = phoneStorage()): void {
  if (storage === null || draft.startedAt === null) return;
  try {
    storage.setItem(key, serializeDraft(draft));
  } catch {
    // Storage full or refused: the production goes on in memory, as it would on a tablet that remembers nothing.
    return;
  }
  notify();
}

export function clearDraft(key: string, storage: DraftStorage | null = phoneStorage()): void {
  if (storage === null) return;
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
  notify();
}

function rawOf(key: string): string | null {
  const storage = phoneStorage();
  if (storage === null) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

// The open production of a product, or null. Read from the stored text (a string, so the same value is the same snapshot).
export function useLabDraft(key: string): LabDraft | null {
  const text = useSyncExternalStore(subscribe, () => rawOf(key), () => null);
  return useMemo(() => parseDraft(text), [text]);
}
