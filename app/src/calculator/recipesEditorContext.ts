import { createContext, useContext } from 'react';
import type { Context } from 'react';
import type { RecipeIngredient } from '@mise/shared/calculator-config';
import type { ResolvedRecipe } from '@mise/shared/calculator-recipe-source';
import type { MessageKey } from '../i18n/en';
import type { ConfirmOptions } from '../ui/useConfirm';
import type { StoredDoc } from './calculatorSource';
import type { EditableRecipe } from './recipesModel';

// What the Recipes editor shares with its two screens, the list and one recipe. The working copy lives in
// RecipesEditor, ABOVE both, so moving between them keeps every edit.
// How a link to a Catalogue recipe ended. «stale»: the person left the choice before it answered, so nothing was done.
// «failed» carries the sentence to say.
export type LinkResult =
  | { readonly status: 'linked' }
  | { readonly status: 'stale' }
  | { readonly status: 'failed'; readonly message: MessageKey };

export type AddResult =
  | { readonly status: 'added'; readonly id: string }
  | { readonly status: 'stale' }
  | { readonly status: 'failed'; readonly message: MessageKey };

export interface RecipesEditorState {
  // The working copy of the whole recipe list.
  readonly recipes: readonly EditableRecipe[];
  // The names the ingredient boxes suggest (the venue's registry).
  readonly ingredientNames: readonly string[];
  readonly dirty: boolean;
  readonly saving: boolean;
  // A save was refused for something missing: the empty fields are marked.
  readonly showErrors: boolean;
  // Changes each time a refused save has been read out, so the screen on show moves the focus to the first marked
  // field.
  readonly checkTick: number;
  // Changes the moment a refused Save marks the empty fields (before the sentence is said), so a screen showing something
  // without those fields (the reorder mode) can give way to them.
  readonly errorTick: number;
  // The recipe added in this visit and not yet left: leaving it empty asks to drop it.
  readonly freshId: string | null;
  // The list row open in place (at most one); kept when going to a recipe and back.
  readonly openId: string | null;

  setOpenId(id: string | null): void;
  patch(recipeId: string, patch: Partial<EditableRecipe>): void;
  addIngredient(recipeId: string): number;
  patchIngredient(recipeId: string, index: number, patch: Partial<RecipeIngredient>): void;
  removeIngredient(recipeId: string, index: number): void;
  // The reorder mode: the ingredient at `from` goes to `to`. Only the order changes, so the leavening and the dough don't.
  moveIngredient(recipeId: string, from: number, to: number): void;
  chooseLeavening(recipeId: string, picked: string): void;
  // «Show in the calculator»: refused (and said) when four are already shown.
  setVisible(recipeId: string, visible: boolean): Promise<void>;
  // «Add recipe» on the list: asks first when four are shown (the recipe is then created hidden). False when the person
  // said no; the choice of recipe (/recipes/new) follows.
  askToAdd(): Promise<boolean>;
  // The choice's «New recipe, written here»: an empty recipe, last in the list, hidden when four are shown. Its id.
  addBlankRecipe(): string;
  // Shows a recipe at its own address, REPLACING the choice that made it in the history (so Back goes where the choice was
  // opened from).
  showRecipe(recipeId: string): void;
  // The choice's recipe of the Catalogue: stamps its rows, then adds a recipe named after it, linked, «from a total» (as the
  // Catalogue's own «Import into Calculator» makes it). `isCurrent` is asked once the stamp has answered: false means the
  // person has left the choice, and then NOTHING is added (a late answer must not land on the screen that came next).
  addFromCatalogue(source: StoredDoc, isCurrent: () => boolean): Promise<AddResult>;
  // Delete: refused (and said) while products use the recipe, otherwise confirmed. True when it is gone.
  deleteRecipe(recipeId: string): Promise<boolean>;
  // The recipe is gone without a question (a fresh empty one, discarded).
  dropRecipe(recipeId: string): void;
  // How many products point at the recipe.
  productCount(recipeId: string): number;
  // The fresh recipe has been left (kept, or dropped): it is an ordinary recipe from now on.
  keep(): void;

  // ── The Catalogue ──
  // What a linked recipe is made of, right now: the Catalogue recipe (watched, or as the picker chose it).
  resolved(recipe: EditableRecipe): ResolvedRecipe;
  // The rows of the Catalogue recipe a linked recipe is made of; null when the recipe is not linked.
  linkedRows(recipe: EditableRecipe): RecipeIngredient[] | null;
  // Every Catalogue recipe, read once, the first time it is asked for (when the picker opens). Rejects when it
  // cannot be read.
  loadCatalogue(): Promise<StoredDoc[]>;
  // Stamps a stable id on every row of the Catalogue recipe, THEN links the recipe to it. Nothing is linked when the stamp
  // is refused, unreachable (it gives up after 10 s) or the recipe is gone; `isCurrent` as in addFromCatalogue.
  link(recipeId: string, source: StoredDoc, isCurrent: () => boolean): Promise<LinkResult>;
  unlink(recipeId: string): void;
  // A notice the person must read (the screens that cannot show one themselves).
  say(message: string): Promise<void>;

  save(): Promise<void>;
  // Back from the list: asks about unsaved edits first, then leaves the editor.
  leaveEditor(): Promise<void>;
  // Back from a recipe: one step up to the list. Asks nothing about edits (they stay in the working copy).
  leaveToList(): void;
  // The list has been on show in this visit: Back from a recipe lands on it, and hands the focus to its row. (A
  // recipe made by the work view's «Add a recipe» has no list behind it: Back returns to the work view.)
  cameFromList(): boolean;
  // Moves between the screens of the editor without the «discard this new recipe?» question being asked of the
  // screen being left (the move is the editor's own).
  quietly(move: () => void): void;
  // «Discard this new recipe? You have not added anything to it.» — true to drop it.
  askDiscardNewRecipe(): Promise<boolean>;
  // The recipe was removed on purpose: its screen draws nothing while it leaves.
  wasDropped(recipeId: string): boolean;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

export const RecipesEditorContext: Context<RecipesEditorState | null> = createContext<RecipesEditorState | null>(null);

export function useRecipesEditor(): RecipesEditorState {
  const value = useContext(RecipesEditorContext);
  if (!value) throw new Error('useRecipesEditor must be used inside <RecipesEditor>.');
  return value;
}
