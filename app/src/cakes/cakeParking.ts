// cakeParking.ts — the cake editor's working copy, set aside while its person goes to the Recipes to fill in a recipe the cake just
// created («Open in Recipes»), and handed back when the cake's screen opens again.
//
// ⚠️ MEMORY ONLY, AND MODULE-LEVEL ON PURPOSE. Cakes' own providers are unmounted the moment the person is in another section, so
// the copy cannot live in one; it lives here, for as long as the page does. No storage: a key holding a person's work must not start with
// a kept prefix and nothing here is worth surviving a reload (accepted: a reload loses it). Sign-out and a venue switch reload the
// page, so the next person never sees it.
//
// ⚠️ WHILE A COPY IS PARKED IT IS AN UNSAVED EDIT (architecture rule 2): `markBusy` is held, so the app never reloads itself under it.
// Cakes' list shows a line for every parked copy («There is an unsaved cake» — Resume / Discard), so leaving some other way never
// silently loses it (P20).
import { useSyncExternalStore } from 'react';
import type { Cake } from '@mise/shared/cake-model';
import { markBusy } from '../session/busy';
import type { Selected } from './cakeEditorModel';
import type { StepKey } from './cakeStepsModel';
import type { PriceTexts } from './CostCard';

// Everything the form needs to put itself back exactly as it was left.
export interface ParkedCake {
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
let release: (() => void) | null = null;

function changed(): void {
  all = [...parked.values()];
  if (all.length > 0 && release === null) release = markBusy();
  if (all.length === 0 && release !== null) {
    release();
    release = null;
  }
  for (const listener of [...listeners]) listener();
}

export function parkCake(copy: ParkedCake): void {
  parked.set(copy.key, copy);
  changed();
}

// Read without taking it: a form reads it while it is being made (React may make it twice) and drops it once it is on screen.
export function peekParked(key: string | null): ParkedCake | null {
  return key === null ? null : parked.get(key) ?? null;
}

export function dropParked(key: string): void {
  if (parked.delete(key)) changed();
}

// For the specs: nothing parked, no hold.
export function resetParkedCakes(): void {
  parked.clear();
  changed();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

// Every parked copy (the same array until one is parked or dropped).
export function useParkedCakes(): readonly ParkedCake[] {
  return useSyncExternalStore(subscribe, () => all);
}

// The key of the copy a navigation asks for, carried in the history entry's state (never in the address).
export function parkedKeyOf(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('parkedCake' in state)) return null;
  const key = (state as { parkedCake: unknown }).parkedCake;
  return typeof key === 'string' && key !== '' ? key : null;
}
