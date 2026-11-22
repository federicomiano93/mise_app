// cakeParking.ts — the cake editor's working copy, set aside while its person goes to the Recipes to fill in a recipe the cake just
// created («Open in Recipes»), and handed back when the cake's screen opens again.
//
// ⚠️ MEMORY ONLY, AND MODULE-LEVEL ON PURPOSE. Cakes' own providers are unmounted the moment the person is in another section, so
// the copy cannot live in one; it lives here, for as long as the page does. No storage: a key holding a person's work must not start with
// a kept prefix and nothing here is worth surviving a reload (accepted: a reload loses it).
//
// ⚠️ A COPY BELONGS TO ONE PERSON AND ONE VENUE. Sign-out and a venue switch do NOT always reload the page (a sign-out in another tab,
// or the next sign-in on a phone that held the same data, only change the session), so the copy is never handed to anybody else, twice
// over: every copy carries the uid and the venue it was parked under and is returned only to that pair (`ParkingOwner`), and the app
// shell clears the whole shelf the moment the person or the venue changes (`clearParkedCakes`).
//
// ⚠️ A PARKED COPY HOLDS NO `markBusy` ON PURPOSE (see session/busy.ts): a hold that nobody may be looking at any more would keep the
// device off every update and rollback. Losing the copy to a reload the app starts by itself is the accepted trade-off; the recipe's own
// editor holds the busy mark while it is dirty. Cakes' list shows a line for every parked copy («Unsaved cake: …» — Resume / Discard), so
// leaving some other way never silently loses it (P20).
import { useMemo, useSyncExternalStore } from 'react';
import type { Cake } from '@mise/shared/cake-model';
import { useSession } from '../session/SessionContext';
import type { Selected } from './cakeEditorModel';
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

export function parkCake(copy: ParkedCake): void {
  parked.set(copy.key, copy);
  changed();
}

// Read without taking it: a form reads it while it is being made (React may make it twice) and drops it once it is on screen.
// Only the owner's own copy is ever returned.
export function peekParked(key: string | null, owner: ParkingOwner | null): ParkedCake | null {
  const copy = key === null ? undefined : parked.get(key);
  return copy !== undefined && isOwnedBy(copy, owner) ? copy : null;
}

export function dropParked(key: string): void {
  if (parked.delete(key)) changed();
}

// The person or the venue has changed (or the session left the ready state): nothing parked is anybody's any more.
export function clearParkedCakes(): void {
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
