// kioskSettings.ts — the kiosk setting of THIS DEVICE (staff slice 5): read, saved and listened to.
//
// ⚠️ A SETTING OF ONE DEVICE, NOT OF A PERSON OR A VENUE (the plan's §5, «Kiosk is device-only»). It lives in this browser's
// localStorage under the current app's key `kiosk-mode`, with the current app's JSON shape (`{"enabled":…,"restMinutes":…,
// "nightHours":…}`, @mise/shared/kiosk-model), so a lab tablet that is in kiosk mode at the switch stays in kiosk mode, and an
// unknown or broken value reads as the defaults. Nothing is ever written to Firestore. The key starts with `kiosk-`, a
// KEEP_PREFIXES prefix (shared/src/local-data.ts), so a sign-out or a venue switch keeps it.
//
// One store for the whole page: Settings' «This device» card writes through save(), the kiosk (Kiosk.tsx) listens. A change made
// in ANOTHER tab arrives as the window's `storage` event, as in the current app.

import { useSyncExternalStore } from 'react';
import { KIOSK_STORAGE_KEY, readKioskSettings, serializeKioskSettings } from '@mise/shared/kiosk-model';
import type { KioskSettings } from '@mise/shared/kiosk-model';

export type KioskChange = Partial<Pick<KioskSettings, 'enabled' | 'restMinutes' | 'nightHours'>>;

const listeners = new Set<() => void>();
let cached: { raw: string | null; settings: KioskSettings } | null = null;

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function readRaw(): string | null {
  try { return storage()?.getItem(KIOSK_STORAGE_KEY) ?? null; } catch { return null; }
}

// The settings as stored now. The same object while the stored text is the same (useSyncExternalStore asks often).
export function kioskSettings(): KioskSettings {
  const raw = readRaw();
  if (cached === null || cached.raw !== raw) cached = { raw, settings: Object.freeze(readKioskSettings(raw)) };
  return cached.settings;
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

// Saves a (partial) change on top of what is stored. False when the device refused the write (a private window, a full or blocked
// storage): the caller says so, and its control shows the stored value again by itself.
export function saveKioskSettings(change: KioskChange): boolean {
  try {
    const store = storage();
    if (store === null) return false;
    store.setItem(KIOSK_STORAGE_KEY, serializeKioskSettings(readRaw(), change));
  } catch {
    return false;
  }
  notify();
  return true;
}

function onStorage(event: StorageEvent): void {
  // `key` null: another tab cleared the whole storage (a sign-out there runs the keep-list, which keeps this key).
  if (event.key === null || event.key === KIOSK_STORAGE_KEY) notify();
}

export function subscribeKioskSettings(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export function useKioskSettings(): KioskSettings {
  return useSyncExternalStore(subscribeKioskSettings, kioskSettings, kioskSettings);
}
