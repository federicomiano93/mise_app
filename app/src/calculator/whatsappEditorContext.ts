import { createContext, useContext } from 'react';
import type { Context } from 'react';
import type { ConfirmOptions } from '../ui/useConfirm';
import type { Lines, WorkingItem } from './whatsappModel';

// What the WhatsApp editor shares with the screens of ONE item: the list with its chooser, its client entries and the
// pickers, or the direct client with its picker. The working copy lives in WhatsappItemEditor, ABOVE all of them, so
// moving between them keeps every edit.
export interface WhatsappEditorState {
  readonly working: WorkingItem;
  readonly dirty: boolean;
  readonly saving: boolean;
  // A save was refused for a blank name: the field is marked.
  readonly showErrors: boolean;
  // Changes each time a refused-for-blank-name save has been read out, so the screen with the name moves the focus to it.
  readonly checkTick: number;

  rename(name: string): void;
  addEntry(clientId: string): void;
  removeEntry(clientId: string): void;
  // Changes the lines of one entry of the list (found by its client), or of the direct client when `clientId` is null.
  editLines(clientId: string | null, change: (lines: Lines) => Lines): void;

  save(): Promise<void>;
  // Back from the list or the direct client: asks about unsaved edits first, then leaves for the top.
  leaveItem(): Promise<void>;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

export const WhatsappEditorContext: Context<WhatsappEditorState | null> = createContext<WhatsappEditorState | null>(null);

export function useWhatsappEditor(): WhatsappEditorState {
  const value = useContext(WhatsappEditorContext);
  if (!value) throw new Error('useWhatsappEditor must be used inside <WhatsappItemEditor>.');
  return value;
}
