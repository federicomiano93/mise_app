// list-copy.ts — a local copy of the last good supplier and ingredient lists, so the Orders supplier list can be drawn the
// moment the section opens instead of waiting for Firestore. TypeScript PARTIAL port of js/orders/list-copy.js for Mise 2
// (the instant-list slice). The key, the version, the value's shape, the field whitelists and every refusal are the same, input
// for input: both apps share ONE origin and so ONE localStorage (docs/architecture.md, «One localStorage»), and a value one of
// them wrote must be read by the other. list-copy.spec.ts runs every test against this file and, when it exists on the branch,
// against the original.
//
// ⚠️ A PARTIAL PORT, SO parity.spec.ts DOES NOT PAIR IT. NOT PORTED (they are the page logic of the current app; in Mise 2 the
// hold of a tapped supplier lives in OrdersSection and is a React state, and the questions these functions answer are answered
// there by the store's flags — loaded, broken, serverSeen — and by the live lens, so nothing here needs to decide when the copy
// may be shown, which supplier to open or when to write):
//   - `bothLanded`, `shouldShowCopy` — when the current app paints the copy;
//   - `supplierToOpen` — the supplier held until the live lists land;
//   - `mayWriteCopy` — when the current app writes (Mise 2's hook asks its own store flags).
//
// ⚠️ THE COPY IS ONLY FOR LOOKING. It feeds the rows of the supplier list while the live lists have not landed, and nothing else:
// it never enters the store or its snapshot, so alerts, the bell, the «Order today» chips and every supplier screen read live
// data only. A supplier tapped meanwhile is held until the live data lands, and what opens something else is shut.
//
// ⚠️ ONLY WHAT A SUPPLIER CARD READS. No price (a manager's prices must not sit in this device's storage for an employee to
// read), no contact, no allergen, no pack list (P8) — and a small value is also a fast one to parse the moment the section opens.
//
// ⚠️ IT TRUSTS NOTHING IT READS. Storage can hold anything (another version of the app, a half-written value, another venue's
// copy). Every refusal returns null and the screen behaves as it did before this file existed. An EMPTY copy never paints: an
// empty venue would flash «no suppliers» before its real list arrived.
//
// ⚠️ THE KEY IS DELIBERATELY NOT UNDER KEEP_PREFIXES (local-data.ts): it is one venue's data, so a sign-out or a venue switch by
// EITHER app must wipe it, exactly as the current app wants. The «keys only under KEEP_PREFIXES» rule is for keys that must
// SURVIVE a switch.

// shared/ compiles against plain ES2022 (no DOM), but the browser and Node both have a console: the one call made here is
// declared, as history-window.ts does.
declare const console: { warn(...args: unknown[]): void };

export const LIST_COPY_KEY = 'orders-list-copy';
export const LIST_COPY_VERSION = 1;

// How long after the last snapshot the copy is written. Stringifying ~300 documents is real work on a weak tablet and must not
// sit in the first seconds of the page.
export const LIST_COPY_WRITE_DELAY_MS = 3000;

// The part of localStorage the copy uses. The caller gets the real one (which can throw, or be missing) and passes null when
// it has none.
export interface CopyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// A stored document, as the Orders screens hold one (the same shape as the app's StoredDoc).
export type CopyDoc = { readonly id: string } & Record<string, unknown>;

export interface ListCopy {
  readonly suppliers: CopyDoc[];
  readonly ingredients: CopyDoc[];
}

const SUPPLIER_FIELDS = ['id', 'name', 'shortName', 'category', 'deliveryDays', 'orderDays', 'active'];
const INGREDIENT_FIELDS = ['id', 'name', 'supplierId', 'active', 'kind'];

function keepFields(list: readonly unknown[], fields: readonly string[]): Record<string, unknown>[] {
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => Object.fromEntries(fields.filter(field => field in item).map(field => [field, item[field]])));
}

export function writeListCopy(
  lid: string,
  suppliers: readonly unknown[],
  ingredients: readonly unknown[],
  storage: CopyStorage | null,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LIST_COPY_KEY, JSON.stringify({
      v: LIST_COPY_VERSION,
      lid,
      suppliers: keepFields(suppliers, SUPPLIER_FIELDS),
      ingredients: keepFields(ingredients, INGREDIENT_FIELDS),
    }));
    return true;
  } catch {
    // Quota or a value JSON cannot hold. Never log the data. An older copy is removed rather than left behind half-true.
    console.warn('Orders: the list copy could not be saved');
    try { storage.removeItem(LIST_COPY_KEY); } catch { /* ignore */ }
    return false;
  }
}

function cleanList(list: unknown): CopyDoc[] | null {
  if (!Array.isArray(list)) return null;
  return list.filter((item): item is CopyDoc => Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    && typeof (item as Record<string, unknown>).id === 'string' && (item as Record<string, unknown>).id !== '');
}

export function readListCopy(lid: string | null | undefined, storage: CopyStorage | null): ListCopy | null {
  if (!storage || !lid) return null;
  let parsed: unknown;
  try {
    const raw = storage.getItem(LIST_COPY_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (value.v !== LIST_COPY_VERSION) return null;
  if (value.lid !== lid) return null;
  const suppliers = cleanList(value.suppliers);
  const ingredients = cleanList(value.ingredients);
  if (!suppliers || !ingredients) return null;
  if (suppliers.length === 0) return null;
  return { suppliers, ingredients };
}
