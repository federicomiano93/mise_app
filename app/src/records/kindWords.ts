// The words of an item's card that depend on its kind (14 Nov 2026: four kinds — ingredient, packaging, resale, other).
// One table, so the card's title, its Save question, its bin, the screen's «… saved.» and the Type menu cannot disagree.

import type { IngredientKind } from '@mise/shared/ingredient-kind';
import type { MessageKey } from '../i18n/en';

interface KindWords {
  // The card's title for a new item and for an existing one.
  readonly newTitle: MessageKey;
  readonly editTitle: MessageKey;
  // The Save question's title, the bin's name and the message after a save.
  readonly saveTitle: MessageKey;
  readonly delete: MessageKey;
  readonly saved: MessageKey;
  // The option of the card's «Type» menu.
  readonly option: MessageKey;
}

export const KIND_WORDS = Object.freeze({
  ingredient: {
    newTitle: 'sup.newIngredient', editTitle: 'sup.editIngredient', saveTitle: 'sup.ing.save.title',
    delete: 'sup.ing.delete', saved: 'sup.ingredientSaved', option: 'sup.kind.ingredient',
  },
  packaging: {
    newTitle: 'sup.newPackaging', editTitle: 'sup.editPackaging', saveTitle: 'sup.pack.save.title',
    delete: 'sup.pack.delete', saved: 'sup.packagingSaved', option: 'sup.kind.packaging',
  },
  resale: {
    newTitle: 'sup.newResale', editTitle: 'sup.editResale', saveTitle: 'sup.resale.save.title',
    delete: 'sup.resale.delete', saved: 'sup.resaleSaved', option: 'sup.kind.resale',
  },
  other: {
    newTitle: 'sup.newOther', editTitle: 'sup.editOther', saveTitle: 'sup.other.save.title',
    delete: 'sup.other.delete', saved: 'sup.otherSaved', option: 'sup.kind.other',
  },
} as const satisfies Record<IngredientKind, KindWords>);
