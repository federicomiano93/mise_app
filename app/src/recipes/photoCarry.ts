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

export function cameFromEditor(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromEditor' in state;
}

const asRecord = (state: unknown): Record<string, unknown> =>
  (typeof state === 'object' && state !== null ? { ...(state as Record<string, unknown>) } : {});

// The state of the editor's entry with the typed copy added.
export function withTypedCopy(state: unknown, working: Working): Record<string, unknown> {
  return { ...KEEP_FOCUS, ...asRecord(state), [TYPED]: working };
}

// The same, with the typed copy taken off. KEEP_FOCUS stays: this move is the app arranging itself.
export function withoutTypedCopy(state: unknown): Record<string, unknown> {
  const { [TYPED]: _gone, ...rest } = asRecord(state);
  return { ...KEEP_FOCUS, ...rest };
}

export function typedCopyOf(state: unknown): Working | null {
  return TYPED in asRecord(state) ? restoreWorking(asRecord(state)[TYPED]) : null;
}

export function hasTypedCopy(state: unknown): boolean {
  return TYPED in asRecord(state);
}

// The read draft, until the editor that mounts next has taken it.
let handedOver: Working | null = null;

export function handOver(working: Working): void {
  handedOver = working;
}

// Looked at while drawing (it changes nothing, so a render run twice is harmless); taken away in an effect.
export function peekHandover(): Working | null {
  return handedOver;
}

export function forgetHandover(): void {
  handedOver = null;
}
