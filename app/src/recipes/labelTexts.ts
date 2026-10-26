// labelTexts.ts — the two texts a recipe carries for the «with logo» image label: the title as printed and the
// ingredients as the owner types them, allergens in capitals. NEW IN MISE 2 (no original in js/).
//
// ⚠️ WHY A HELPER OF ITS OWN AND NOT normalizeCatalogueRecipe. That normaliser is a port of the current app's, pinned
// export by export against js/ (parity.spec.ts, label-corpus.spec.ts): it must keep dropping what the current app does
// not know. So the store normalises with it AND puts these two fields back from the stored document (`normalizeStoredRecipe`).
// The recipes' local copy (`catalogue-recipes`) then carries them too; the current app reads that copy with its own
// normaliser, which drops them, and saves recipes with merge, so it never removes them from the database.
//
// Stored as typed (the rules bound them: 200 and 2000 characters). An EMPTY field is not stored at all: an emptied box
// travels as a removal (recipesSource CLEARABLE_RECIPE_FIELDS), so «nothing typed» is always «no field».
//
// The store's normaliser also puts back, for the same reason, the two fields of the recipe SHELF (25 Oct 2026,
// @mise/shared/recipe-shelf): the category word and the archived flag.

import { normalizeCatalogueRecipe } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { shelfFieldsOf } from '@mise/shared/recipe-shelf';

// `haccpStorage` (26 Oct 2026) is the HACCP label's: how the semi-finished good is kept, printed when the venue prints
// that field. Same life as the other two: stored as typed, an emptied box is a removal.
export const LABEL_TEXT_FIELDS = ['labelName', 'labelIngredientsText', 'haccpStorage'] as const;
export type LabelTextField = (typeof LABEL_TEXT_FIELDS)[number];

// The rules' bounds (firestore.rules, `recipes`), repeated so a box never holds what the database would refuse.
export const LABEL_NAME_MAX = 200;
export const LABEL_TEXT_MAX = 2000;
export const HACCP_STORAGE_MAX = 200;
const MAX: Readonly<Record<LabelTextField, number>> = {
  labelName: LABEL_NAME_MAX, labelIngredientsText: LABEL_TEXT_MAX, haccpStorage: HACCP_STORAGE_MAX,
};

// A recipe as the store holds it: the shared shape, plus the two texts when they were stored, plus the shelf's two fields
// (a category word, `archived: true`) when they were.
export type LabelledRecipe = CatalogueRecipe & {
  readonly labelName?: string;
  readonly labelIngredientsText?: string;
  readonly haccpStorage?: string;
  readonly category?: string;
  readonly archived?: true;
};

// The two texts of a stored document, as stored: a string with something in it, else nothing.
function storedTexts(raw: unknown): Partial<Record<LabelTextField, string>> {
  const out: Partial<Record<LabelTextField, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  const held = raw as Record<string, unknown>;
  for (const key of LABEL_TEXT_FIELDS) {
    const value = held[key];
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}

// The store's normaliser: the shared one, then the two texts and the shelf's fields put back.
export function normalizeStoredRecipe(raw: unknown): LabelledRecipe | null {
  const norm = normalizeCatalogueRecipe(raw);
  return norm === null ? null : { ...norm, ...storedTexts(raw), ...shelfFieldsOf(raw) };
}

export function normalizeStoredRecipes(list: unknown): LabelledRecipe[] {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeStoredRecipe).filter((r): r is LabelledRecipe => r !== null);
}

// What a recipe holds, '' for nothing.
export function labelTextsOf(recipe: unknown): Record<LabelTextField, string> {
  const texts = storedTexts(recipe);
  return {
    labelName: texts.labelName ?? '', labelIngredientsText: texts.labelIngredientsText ?? '', haccpStorage: texts.haccpStorage ?? '',
  };
}

// The title the label prints: the typed one, else the recipe's name in capitals (the owner's decision, 25 Oct 2026).
export function labelTitleOf(recipe: unknown): string {
  const { labelName } = labelTextsOf(recipe);
  if (labelName.trim() !== '') return labelName.trim();
  const name = recipe && typeof recipe === 'object' ? (recipe as { name?: unknown }).name : '';
  return String(name ?? '').trim().toUpperCase();
}

// What a save sends for the two texts, from what the editor handed over: a string typed (trimmed, cut to the rules'
// bound) or null for an emptied box (the source turns it into a removal). A field handed over as anything else —
// above all `undefined`, «this save does not touch it» — is not sent, so the database keeps what it holds.
export function labelTextPatchOf(recipe: unknown): Partial<Record<LabelTextField, string | null>> {
  const out: Partial<Record<LabelTextField, string | null>> = {};
  if (!recipe || typeof recipe !== 'object') return out;
  const held = recipe as Record<string, unknown>;
  for (const key of LABEL_TEXT_FIELDS) {
    const value = held[key];
    if (typeof value !== 'string') continue;
    const text = value.trim().slice(0, MAX[key]);
    out[key] = text === '' ? null : text;
  }
  return out;
}
