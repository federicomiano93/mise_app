// Is a lab-mode production open for this venue on THIS device? Asked by the sign-out and the venue switch, because both wipe this device's
// local copies (shared/local-data) and a production in progress lives in one of them: the draft of Food cost's lab mode.
//
// The prefix is defined HERE and imported by foodcost/lab/labDraft.ts, so the question and the key can never drift apart, and the session
// does not depend on a feature's folder.
export const LAB_DRAFT_PREFIX = 'foodcost-lab-draft:';

type KeyedStorage = Pick<Storage, 'length' | 'key'>;

export function hasLabDraft(locationId: string | null, storage?: KeyedStorage | null): boolean {
  if (!locationId) return false;
  try {
    const store = storage === undefined ? window.localStorage : storage;
    if (store === null) return false;
    const wanted = `${LAB_DRAFT_PREFIX}${locationId}:`;
    for (let i = 0; i < store.length; i += 1) if (store.key(i)?.startsWith(wanted)) return true;
  } catch {
    // Storage blocked: nothing is remembered, so there is nothing to lose.
  }
  return false;
}
