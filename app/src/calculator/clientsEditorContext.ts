import { createContext, useContext } from 'react';
import type { Context } from 'react';
import type { Client, Product, Recipe } from '@mise/shared/calculator-config';
import type { ConfirmOptions } from '../ui/useConfirm';

// What the Clients editor shares with its two screens, the list and one client. The working copy lives in
// ClientsEditor, ABOVE both, so moving between them keeps every edit.
export interface ClientsEditorState {
  // The working copy of the whole address book.
  readonly clients: readonly Client[];
  // The recipes a product can belong to: the venue's (this editor saves clients only).
  readonly recipes: readonly Recipe[];
  readonly dirty: boolean;
  readonly saving: boolean;
  // A save was refused for a blank name: the blank fields are marked.
  readonly showErrors: boolean;
  // Changes each time a refused-for-blank-name save has been read out, so the screen on show moves the focus to the
  // first marked field.
  readonly checkTick: number;
  // The client added in this visit and not yet left: leaving it empty asks to drop it.
  readonly freshId: string | null;

  rename(clientId: string, name: string): void;
  patchProduct(clientId: string, productId: string, patch: Partial<Product>): void;
  addProduct(clientId: string): string;
  removeProduct(clientId: string, productId: string): void;
  removeClient(clientId: string): void;
  addClient(): string;
  reorder(moved: ReadonlySet<string>, targetId: string, position: 'before' | 'after' | 'on'): void;
  // The fresh client has been left (kept, or dropped): it is an ordinary client from now on.
  keep(): void;

  save(): Promise<void>;
  // Back from the list: asks about unsaved edits first, then leaves the editor.
  leaveEditor(): Promise<void>;
  // Back from a client: one step up to the list. Asks nothing about edits (they stay in the working copy).
  leaveToList(): void;
  // Moves between the screens of the editor without the «discard this new client?» question being asked of the
  // screen being left (the move is the editor's own).
  quietly(move: () => void): void;
  // «Discard this new client? You have not added anything to it.» — true to drop it.
  askDiscardNewClient(): Promise<boolean>;
  // The client was removed on purpose (deleted, or dropped): its screen draws nothing while it leaves.
  wasDropped(clientId: string): boolean;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

export const ClientsEditorContext: Context<ClientsEditorState | null> = createContext<ClientsEditorState | null>(null);

export function useClientsEditor(): ClientsEditorState {
  const value = useContext(ClientsEditorContext);
  if (!value) throw new Error('useClientsEditor must be used inside <ClientsEditor>.');
  return value;
}
