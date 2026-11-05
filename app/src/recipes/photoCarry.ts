import { KEEP_FOCUS } from '../shell/Page';
import { restoreWorking } from './editorModel';
import type { Working } from './editorModel';

// What travels between the new-recipe editor and the photo screen (step 3d-9). Two things, and both are about NOT losing
// work that somebody has typed or already paid for:
//
//  1. THE TYPED COPY, when «Fill from a photo» is pressed with something typed. It is written into the navigation state of
//     the editor's own history entry (the entry is replaced, same address), so it is on the entry it belongs to: Back from
//     the photo screen — the app's button or the phone's gesture, which runs no code of ours — lands on that entry and the
//     editor starts from it. ONCE: the editor takes it off the entry as soon as it has read it.
//  2. THE READ DRAFT, when a read succeeds. The photo screen steps back onto the editor's entry (so the history holds ONE
//     editor entry, never the typed copy and the draft side by side) and a history move cannot carry a state, so the draft
//     is handed over in this module for the editor that mounts next.

const TYPED = 'typedCopy';

// The state of the photo screen's entry: it was opened FROM the editor, so Back is the browser's Back and a read steps back
// onto the editor's entry.
export const FROM_EDITOR = { ...KEEP_FOCUS, fromEditor: true } as const;

// The state of the new-recipe editor «Duplicate» opens: Back and Discard step back ONE entry, to the recipe it was copied
// from (a Save still goes to the list, like any new recipe). It carries KEEP_FOCUS and `fromRecipe` like the other trips
// out of a recipe page.
export const FROM_DUPLICATE = { ...KEEP_FOCUS, fromRecipe: true, fromDuplicate: true } as const;

export function cameFromDuplicate(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromDuplicate' in state;
}

export function cameFromEditor(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromEditor' in state;
}

const asRecord = (state: unknown): Record<string, unknown> =>
  (typeof state === 'object' && state !== null ? { ...(state as Record<string, unknown>) } : {});

// ⚠️ BOTH CARRIED THINGS ARE STAMPED WITH WHO TYPED THEM AND WHERE (`carryOwner`): the browser keeps a history entry's state
// across a reload, and a sign-out or a venue switch reloads IN PLACE — so without the stamp, Back after a switch would open
// venue A's typed recipe, dirty, inside venue B (its links pointing at A's ingredients), or show the previous person's
// typing to the next one on a shared tablet. A copy stamped for anyone else is not there.
const OWNER = 'typedFor';
export function carryOwner(uid: string | null | undefined, locationId: string | null | undefined): string {
  return `${uid ?? ''}|${locationId ?? ''}`;
}

// The state of the editor's entry with the typed copy added, stamped for `owner`.
export function withTypedCopy(state: unknown, working: Working, owner: string): Record<string, unknown> {
  return { ...KEEP_FOCUS, ...asRecord(state), [TYPED]: working, [OWNER]: owner };
}

// The same, with the typed copy taken off. KEEP_FOCUS stays: this move is the app arranging itself.
export function withoutTypedCopy(state: unknown): Record<string, unknown> {
  const { [TYPED]: _gone, [OWNER]: _for, ...rest } = asRecord(state);
  return { ...KEEP_FOCUS, ...rest };
}

export function typedCopyOf(state: unknown, owner: string): Working | null {
  const record = asRecord(state);
  return TYPED in record && record[OWNER] === owner ? restoreWorking(record[TYPED]) : null;
}

export function hasTypedCopy(state: unknown): boolean {
  return TYPED in asRecord(state);
}

// The read draft, until the editor that mounts next has taken it — stamped like the typed copy, and only for a short while:
// a read that lands while the person's own Back is still being processed could leave it behind, and the next «New recipe»
// minutes later must not open pre-filled.
export const HANDOVER_TTL_MS = 30_000;

// Who made what is handed over: a recipe read from a photograph, or a DUPLICATE of a recipe (the recipe page's «Duplicate»,
// which opens the same new-recipe editor pre-filled). The editor asks, because the two are not the same story (a read has
// just been paid for; a duplicate is a copy of something saved).
export type HandOverBy = 'photo' | 'duplicate';

let handedOver: { working: Working; owner: string; at: number; by: HandOverBy } | null = null;

export function handOver(working: Working, owner: string, now = Date.now(), by: HandOverBy = 'photo'): void {
  handedOver = { working, owner, at: now, by };
}

// Looked at while drawing (it changes nothing, so a render run twice is harmless); taken away in an effect.
export function peekHandedOver(owner: string, now = Date.now()): { working: Working; by: HandOverBy } | null {
  if (handedOver === null || handedOver.owner !== owner) return null;
  const age = now - handedOver.at;
  return age >= 0 && age <= HANDOVER_TTL_MS ? { working: handedOver.working, by: handedOver.by } : null;
}

export function peekHandover(owner: string, now = Date.now()): Working | null {
  return peekHandedOver(owner, now)?.working ?? null;
}

// Whether anything is waiting at all (for specs).
export function hasHandover(): boolean {
  return handedOver !== null;
}

export function forgetHandover(): void {
  handedOver = null;
}
