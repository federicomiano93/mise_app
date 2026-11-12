// Is a lab-mode production open for this venue on THIS device? Asked by the sign-out and the venue switch, because both wipe this device's
// local copies (shared/local-data) and a production in progress lives in one of them: the draft of Food cost's lab mode.
//
// The prefix is defined HERE and imported by foodcost/lab/labDraft.ts, so the question and the key can never drift apart, and the session
// does not depend on a feature's folder.
export const LAB_DRAFT_PREFIX = 'foodcost-lab-draft:';

type KeyedStorage = Pick<Storage, 'length' | 'key'> & Partial<Pick<Storage, 'getItem' | 'removeItem'>>;

function phoneStorage(): KeyedStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// A light check that a stored draft is a draft at all (labDraft.parseDraft does the full, field-by-field one when the lab opens it): the
// right version, a real start instant, a list of lines. A corrupt key is not a production, and asking about it at every sign-out for ever,
// with nobody able to cancel it, would be a trap.
function looksLikeDraft(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null) return false;
    const draft = data as { v?: unknown; startedAt?: unknown; lines?: unknown };
    return draft.v === 1 && typeof draft.startedAt === 'number' && Number.isFinite(draft.startedAt) && draft.startedAt > 0 && Array.isArray(draft.lines);
  } catch {
    return false;
  }
}

function labKeys(locationId: string, store: KeyedStorage): string[] {
  const wanted = `${LAB_DRAFT_PREFIX}${locationId}:`;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(wanted)) keys.push(key);
  }
  return keys;
}

export function hasLabDraft(locationId: string | null, storage?: KeyedStorage | null): boolean {
  if (!locationId) return false;
  try {
    const store = storage === undefined ? phoneStorage() : storage;
    if (store === null) return false;
    // Without a way to read the keys back, a key of ours is taken as a draft (asking once too often costs a tap).
    return labKeys(locationId, store).some(key => (store.getItem ? looksLikeDraft(store.getItem(key)) : true));
  } catch {
    // Storage blocked: nothing is remembered, so there is nothing to lose.
    return false;
  }
}

// Removes the drafts of this venue whose product no longer exists (deleted on another device), and the unsound ones. Called by Food cost
// once its product list has been answered by the server: until then a missing product may only be a partial local copy.
export function dropOrphanLabDrafts(locationId: string, productIds: ReadonlySet<string>, storage?: KeyedStorage | null): void {
  try {
    const store = storage === undefined ? phoneStorage() : storage;
    if (store === null || !store.removeItem) return;
    const prefix = `${LAB_DRAFT_PREFIX}${locationId}:`;
    for (const key of labKeys(locationId, store)) {
      const orphan = !productIds.has(key.slice(prefix.length));
      if (orphan || !looksLikeDraft(store.getItem ? store.getItem(key) : null)) store.removeItem(key);
    }
  } catch {
    // Nothing to clean when storage is blocked.
  }
}
