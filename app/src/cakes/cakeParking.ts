// cakeParking.ts — the cake editor's working copy, set aside while its person goes to the Recipes to fill in a recipe the cake just
// created («Open in Recipes»), and handed back when the cake's screen opens again.
//
// ⚠️ THE SHELF IS IN MEMORY AND MODULE-LEVEL ON PURPOSE. Cakes' own providers are unmounted the moment the person is in another section, so
// the copy cannot live in one; it lives here, for as long as the page does.
//
// ⚠️ AND AN UNSAVED CAKE IS ALSO WRITTEN ON THE DEVICE (22 Nov 2026, «no work lost»): while a cake form is dirty (rememberCake, a short pause
// after the last change) and the moment a copy is set aside (parkCake), under ONE key that starts with NO kept prefix — a copy holds a
// person's work, so the sign-out and venue-switch wipe of shared/local-data removes it with every other key. A tablet's app closed from the
// recent apps, or Android closing it, cannot be stopped by any page: the next time Cakes opens, restoreCakesFromDevice puts the copies back on
// the shelf and the list offers «Unsaved cake: …» (Resume / Discard). The copy goes at Save, at Discard (the list's, and the form's own «leave
// and lose»), at Delete and when the shell empties the shelf. A copy is read back ONLY for the uid and venue it was written under, field by
// field (readParkedCake): a broken or foreign one is thrown away, never trusted. Every storage access is guarded (private mode, a full
// disk): then nothing is remembered and the form works as before. Only what the cake form already holds is written: no person's name, no contact.
//
// ⚠️ A COPY BELONGS TO ONE PERSON AND ONE VENUE. Sign-out and a venue switch do NOT always reload the page (a sign-out in another tab,
// or the next sign-in on a phone that held the same data, only change the session), so the copy is never handed to anybody else, twice
// over: every copy carries the uid and the venue it was parked under and is returned only to that pair (`ParkingOwner`), and the app
// shell clears the whole shelf the moment the person or the venue changes (`clearParkedCakes`).
//
// ⚠️ A PARKED COPY HOLDS NO `markBusy` ON PURPOSE (see session/busy.ts): a hold that nobody may be looking at any more would keep the
// device off every update and rollback. Losing the shelf to a reload the app starts by itself is the accepted trade-off (the device's copy
// still offers it again); the recipe's own editor holds the busy mark while it is dirty. Cakes' list shows a line for every parked copy
// («Unsaved cake: …» — Resume / Discard), so leaving some other way never silently loses it (P20).
import { useMemo, useSyncExternalStore } from 'react';
import { CAKE_PARTS, MAX_TIERS, normalizeCake } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import { useSession } from '../session/SessionContext';
import type { Selected } from './cakeEditorModel';
import { STEP_KEYS } from './cakeStepsModel';
import type { StepKey } from './cakeStepsModel';
import type { PriceTexts } from './CostCard';

// Everything the form needs to put itself back exactly as it was left.
// Whose copy it is: the signed-in account and the open venue.
export interface ParkingOwner {
  readonly uid: string;
  readonly locationId: string;
}

export interface ParkedCake {
  readonly uid: string;
  readonly locationId: string;
  // The cake's id: a saved cake's own, or the id the form made for a new one (so the copy is found again by it).
  readonly key: string;
  // The saved cake's id, or null for a new cake (which opens at /cakes/new).
  readonly savedId: string | null;
  readonly working: Cake;
  // What «dirty» is measured against: the copy as it was last saved (or started).
  readonly initial: Cake;
  readonly texts: PriceTexts;
  readonly tier: number;
  readonly openStepKey: StepKey | null;
  readonly selected: Selected | null;
  readonly fromScratch: boolean;
}

const parked = new Map<string, ParkedCake>();
let all: readonly ParkedCake[] = [];
const listeners = new Set<() => void>();

const isOwnedBy = (copy: ParkedCake, owner: ParkingOwner | null): boolean => owner !== null && copy.uid === owner.uid && copy.locationId === owner.locationId;

function changed(): void {
  all = [...parked.values()];
  for (const listener of [...listeners]) listener();
}

// ── The device's copy ─────────────────────────────────────────────────────────────────────────

// ⚠️ NO KEPT PREFIX (shared/local-data KEEP_PREFIXES): cakeParking.device.spec.tsx pins that keysToClear() lists this key.
export const UNSAVED_CAKES_KEY = 'cake-unsaved-v1';
// A short pause after the last change before it is written: typing is not a write per letter.
export const REMEMBER_DELAY_MS = 500;
// Never more than this many copies on the device (the oldest go first); a cake with 90 lines is a few KB.
const MAX_DEVICE_COPIES = 20;
const MAX_DEVICE_TEXT = 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length <= max;
const isTierIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_TIERS;

type DeviceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function deviceStorage(): DeviceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// One stored copy → a sound one, or null. Field by field, and both cakes through normalizeCake (junk-safe, never NaN).
export function readParkedCake(raw: unknown): ParkedCake | null {
  if (!isRecord(raw)) return null;
  const { uid, locationId, key, savedId, texts, tier, openStepKey, selected, fromScratch } = raw;
  if (!isText(uid) || uid === '' || !isText(locationId) || locationId === '' || !isText(key) || key === '') return null;
  if (savedId !== null && (!isText(savedId) || savedId === '')) return null;
  if (!isRecord(texts) || !isText(texts.price, 40) || !isText(texts.target, 40) || !isText(texts.vatSelect, 40) || !isText(texts.vatOther, 40)) return null;
  if (!isTierIndex(tier)) return null;
  if (openStepKey !== null && !(STEP_KEYS as readonly unknown[]).includes(openStepKey)) return null;
  let chosen: Selected | null = null;
  if (selected !== null) {
    if (!isRecord(selected) || !isTierIndex(selected.tier) || !(CAKE_PARTS as readonly unknown[]).includes(selected.part)) return null;
    chosen = { tier: selected.tier, part: selected.part as Selected['part'] };
  }
  if (typeof fromScratch !== 'boolean') return null;
  const working = normalizeCake(raw.working);
  const initial = normalizeCake(raw.initial);
  if (working === null || initial === null) return null;
  return {
    uid,
    locationId,
    key,
    savedId,
    working,
    initial,
    texts: { price: texts.price, target: texts.target, vatSelect: texts.vatSelect, vatOther: texts.vatOther },
    tier,
    openStepKey: openStepKey as StepKey | null,
    selected: chosen,
    fromScratch,
  };
}

function writeDevice(copies: readonly ParkedCake[]): void {
  const store = deviceStorage();
  if (store === null) return;
  try {
    if (copies.length === 0) store.removeItem(UNSAVED_CAKES_KEY);
    else store.setItem(UNSAVED_CAKES_KEY, JSON.stringify({ v: 1, copies: copies.slice(-MAX_DEVICE_COPIES) }));
  } catch {
    // A full disk or blocked site data: the form works as before, nothing is remembered.
  }
}

// Every sound copy on the device, whoever's. A value that is not a list of copies is removed, so it is not read as broken for ever.
function readDevice(): ParkedCake[] {
  const store = deviceStorage();
  if (store === null) return [];
  try {
    const text = store.getItem(UNSAVED_CAKES_KEY);
    if (text === null) return [];
    const raw: unknown = text.length > MAX_DEVICE_TEXT ? null : JSON.parse(text);
    const list = isRecord(raw) && Array.isArray(raw.copies) ? (raw.copies as unknown[]) : null;
    if (list === null) {
      store.removeItem(UNSAVED_CAKES_KEY);
      return [];
    }
    const sound = list.map(readParkedCake).filter((copy): copy is ParkedCake => copy !== null);
    if (sound.length !== list.length) writeDevice(sound);
    return sound;
  } catch {
    try { store.removeItem(UNSAVED_CAKES_KEY); } catch { /* nothing to do: nothing is remembered */ }
    return [];
  }
}

// The newest change per cake, waiting for its pause to end.
const pending = new Map<string, ParkedCake>();
let timer: ReturnType<typeof setTimeout> | null = null;
let leaveListening = false;

const sameCake = (a: ParkedCake, b: ParkedCake): boolean => a.key === b.key && a.uid === b.uid && a.locationId === b.locationId;

function upsertDevice(copy: ParkedCake): void {
  writeDevice([...readDevice().filter(held => !sameCake(held, copy)), copy]);
}

// Writes whatever is waiting now. Also what a hidden page or a closing page does: the recent apps' swipe is preceded by «hidden».
export function flushRemembered(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.size === 0) return;
  const waiting = [...pending.values()];
  pending.clear();
  for (const copy of waiting) upsertDevice(copy);
}

function listenForLeaving(): void {
  if (leaveListening || typeof document === 'undefined') return;
  leaveListening = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushRemembered(); });
  window.addEventListener('pagehide', flushRemembered);
}

// The form is dirty: its copy goes on the device a moment after the last change (one write for a burst of typing).
export function rememberCake(copy: ParkedCake): void {
  listenForLeaving();
  pending.set(copy.key, copy);
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(flushRemembered, REMEMBER_DELAY_MS);
}

// Saved, discarded, deleted, or clean again: nothing of this cake stays on the device, and nothing waiting is written later.
export function forgetCake(key: string): void {
  pending.delete(key);
  if (pending.size === 0 && timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const held = readDevice();
  const kept = held.filter(copy => copy.key !== key);
  if (kept.length !== held.length) writeDevice(kept);
}

// Cakes opens: this person's copies on the device in this venue are put on the shelf, where the list offers them. They stay on the device
// until they are saved or discarded. A copy already on the shelf is not replaced.
export function restoreCakesFromDevice(owner: ParkingOwner | null): void {
  if (owner === null) return;
  let added = false;
  for (const copy of readDevice()) {
    if (!isOwnedBy(copy, owner) || parked.has(copy.key)) continue;
    parked.set(copy.key, copy);
    added = true;
  }
  if (added) changed();
}

// ── The shelf ─────────────────────────────────────────────────────────────────────────────────

export function parkCake(copy: ParkedCake): void {
  parked.set(copy.key, copy);
  // Set aside: the live copy's pause is over, this one is written at once (the page may be closed while the recipe is filled in).
  pending.delete(copy.key);
  upsertDevice(copy);
  changed();
}

// Read without taking it: a form reads it while it is being made (React may make it twice) and drops it once it is on screen.
// Only the owner's own copy is ever returned.
export function peekParked(key: string | null, owner: ParkingOwner | null): ParkedCake | null {
  const copy = key === null ? undefined : parked.get(key);
  return copy !== undefined && isOwnedBy(copy, owner) ? copy : null;
}

// Off the shelf, the device's copy untouched: the form that has taken a copy back is now the unsaved edit and keeps writing it.
export function dropParked(key: string): void {
  if (parked.delete(key)) changed();
}

// «Discard» on the list: gone from the shelf AND from the device.
export function discardParked(key: string): void {
  dropParked(key);
  forgetCake(key);
}

// The person or the venue has changed (or the session left the ready state): nothing parked is anybody's any more, on the shelf or on the device.
export function clearParkedCakes(): void {
  pending.clear();
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  try { deviceStorage()?.removeItem(UNSAVED_CAKES_KEY); } catch { /* nothing to remove */ }
  if (parked.size === 0) return;
  parked.clear();
  changed();
}

// For the specs: nothing parked.
export function resetParkedCakes(): void {
  clearParkedCakes();
}

// The account and the venue of the session now, or null before a venue is open.
export function useParkingOwner(): ParkingOwner | null {
  const { user, locationId } = useSession();
  const uid = user?.uid ?? null;
  return useMemo(() => (uid === null || locationId === null ? null : { uid, locationId }), [uid, locationId]);
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

// Every parked copy of this person in this venue (the same array until one is parked or dropped).
export function useParkedCakes(): readonly ParkedCake[] {
  const owner = useParkingOwner();
  const every = useSyncExternalStore(subscribe, () => all);
  return useMemo(() => every.filter(copy => isOwnedBy(copy, owner)), [every, owner]);
}

// The key of the copy a navigation asks for, carried in the history entry's state (never in the address).
export function parkedKeyOf(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('parkedCake' in state)) return null;
  const key = (state as { parkedCake: unknown }).parkedCake;
  return typeof key === 'string' && key !== '' ? key : null;
}
