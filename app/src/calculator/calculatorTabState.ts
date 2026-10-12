// What each recipe tab remembers on this phone: the quantities, the knob, the total, the trays, the extra
// dough, and the day it was last used. Plain TypeScript with no React in it; the screen reads it through
// TabStateContext.tsx.
//
// ⚠️ THE KEYS AND THE TEXT ARE THE CURRENT APP'S (shared/src/calculator-tab-keys.ts): both apps live on the
// same origin and read each other's copy, so a number typed here is the number the other app shows, and the
// other way round. None of them is under KEEP_PREFIXES: a venue switch wipes them all.
//
// ⚠️ `touched-<rid>` IS WRITTEN IN EXACTLY THE PLACES THE TAB PERSISTS SOMETHING (`set` with `touch`). Written
// anywhere else, a used tab would be wiped as if untouched; written nowhere, a stale tab would survive.
//
// ⚠️ A NEW WORK DAY EMPTIES YESTERDAY'S NUMBERS, but never under the fingers of somebody reading a recipe:
// the screen calls `sweep` before it first draws a tab and when the app comes back to the foreground, and
// never in between. Forgetting a tab is the ONE function of calculator-tab-keys (`tabKeysToForget`), lock
// included.

import { staleTabIds, tabKeysToForget, touchedKey } from '@mise/shared/calculator-tab-keys';
import type { KeyValueStorage } from '../session/backend';

// How long the quiet «fields cleared, this is a new day» line stays (the current app: 12 s).
export const CLEARED_NOTE_MS = 12_000;

export interface TabState {
  // A key's text, or null when nothing is kept under it.
  read(key: string): string | null;
  // Keeps `value` under `key`, and stamps the tab as used when `touch` names it.
  set(key: string, value: string, touch?: string): void;
  // Stamps the tab as used (`touched-<rid>`) without writing anything else.
  touch(rid: string): void;
  // Forgets one key (Edit drops `revealed-<rid>`; the rest of the tab stays).
  remove(key: string): void;
  // Forgets a tab: every key of it, its lock included. `qtyIds` are the tab's current quantity ids.
  forget(rid: string, qtyIds: readonly string[]): void;
  // Clears every tab of `tabs` last used on an EARLIER work day and says which were cleared. Each is
  // remembered for the note.
  sweep(tabs: readonly { id: string; qtyIds: readonly string[] }[]): string[];
  // Whether the «new day» line is still due for a tab, and for how many more milliseconds.
  noteLeft(rid: string): number;
  subscribe(listener: () => void): () => void;
  // Changes whenever anything a screen reads has.
  getVersion(): number;
}

export function createTabState(storage: KeyValueStorage | null, now: () => number): TabState {
  // What this page wrote, read first: a phone that refuses storage (or fills it) still remembers the
  // numbers for as long as the page lives. `null` is «removed».
  const memory = new Map<string, string | null>();
  const noteUntil = new Map<string, number>();
  const listeners = new Set<() => void>();
  let version = 0;

  function notify(): void {
    version += 1;
    for (const listener of [...listeners]) listener();
  }

  function read(key: string): string | null {
    if (memory.has(key)) return memory.get(key) ?? null;
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function put(key: string, value: string): void {
    memory.set(key, value);
    try { storage?.setItem(key, value); } catch { /* full or blocked: the page still remembers it */ }
  }

  function drop(key: string): void {
    memory.set(key, null);
    try { storage?.removeItem(key); } catch { /* ditto */ }
  }

  function stamp(rid: string): void {
    put(touchedKey(rid), String(now()));
  }

  return {
    read,

    set(key, value, touch) {
      put(key, value);
      if (touch !== undefined) stamp(touch);
      notify();
    },

    remove(key) {
      drop(key);
      notify();
    },

    touch(rid) {
      stamp(rid);
      notify();
    },

    forget(rid, qtyIds) {
      for (const key of tabKeysToForget(rid, qtyIds)) drop(key);
      notify();
    },

    sweep(tabs) {
      const stale = staleTabIds(tabs.map(tab => tab.id), read, now());
      if (stale.length === 0) return [];
      for (const rid of stale) {
        for (const key of tabKeysToForget(rid, tabs.find(tab => tab.id === rid)?.qtyIds ?? [])) drop(key);
        noteUntil.set(rid, now() + CLEARED_NOTE_MS);
      }
      notify();
      return stale;
    },

    noteLeft(rid) {
      const until = noteUntil.get(rid);
      return until === undefined ? 0 : Math.max(0, until - now());
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    getVersion: () => version,
  };
}
