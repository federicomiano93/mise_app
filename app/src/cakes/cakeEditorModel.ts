// cakeEditorModel.ts — the working copy of ONE cake and every move the editor makes on it, pure (no React, no Firebase).
//
// The copy is a plain `Cake` (shared/cake-model): the screen edits it, `toCakeDocument` writes it, `cakeProduct` costs it. Every move
// returns a NEW cake and never touches the one it was given, so a spec can compare before and after and React can compare by reference.
//
// ⚠️ A NUMBER THAT IS NOT A NUMBER STAYS NaN (as in Food cost's toProduct): the price, the VAT and the target are typed as text on the
// screen and read here; a half-typed or junk box is refused at Save by `firstInvalidNumber` (shared/product-limits), which names the
// box, instead of being silently dropped.
//
// ⚠️ A WHOLE CAKE CANNOT BE PUT INSIDE A CAKE: a `cake-` product is never offered as a card (the cake's own product id and any other
// cake's alike), so a loop through two cakes cannot be built.

import {
  CAKE_MODEL, MAX_CARDS_PER_PART, MAX_DISCS, MAX_PACKAGING, MAX_SLICES, MIN_DISCS, MAX_LINE_GRAMS, isCakeProductId, maxTiersFor, minDiameterFor,
  sameReference, toCakeDocument,
} from '@mise/shared/cake-model';
import type { Cake, CakeLine, CakePart, ReferenceGrams } from '@mise/shared/cake-model';
import { readNumber } from '../foodcost/productEditorModel';

// A new cake starts as a plain one-tier cake (the same defaults normalizeCake falls back on), with no name, no price and no card.
const NEW_DIAMETER_CM = 20;
const NEW_DISCS = 3;
const NEW_SLICES = 12;

// The diameter stepper stops here (the rules allow 60: nobody bakes that, and a tap too many should not reach it).
export const EDITOR_MAX_DIAMETER_CM = 40;
export const DIAMETER_STEP_CM = 2;
export const ASSEMBLY_STEP_MIN = 5;
const MAX_ASSEMBLY_MINUTES = 100000;
const MAX_PACK_PCS = 1000;

export interface Selected {
  tier: number;
  part: CakePart;
}

// The copy to edit. `venueRef` is what a NEW cake takes its rule grams from (null while the venue has none). `newId` is the id a new
// cake will be saved under, made once by the caller so the same id lives from the first keystroke to the save.
export function workingFrom(cake: Cake | null, venueRef: ReferenceGrams | null, newId = ''): Cake {
  if (cake === null) {
    return {
      id: newId, name: '', diameterCm: NEW_DIAMETER_CM, tiers: 1, discs: NEW_DISCS, slices: NEW_SLICES, lines: [], packaging: [],
      assemblyMinutes: null, sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null,
      ref: venueRef ? { ...venueRef } : null, model: CAKE_MODEL,
    };
  }
  return {
    ...cake,
    lines: cake.lines.map(line => ({ ...line })),
    packaging: cake.packaging.map(line => ({ ...line })),
    ref: cake.ref ? { ...cake.ref } : null,
  };
}

// What Save would write, as one string: two copies are the same when it is. (Lines of a tier the cake no longer has are not written, so
// bringing a tier back by «−» then «+» is not a change.)
function signature(cake: Cake): string {
  return JSON.stringify([toCakeDocument(cake, ''), cake.id]);
}

export function isDirty(working: Cake, initial: Cake): boolean {
  return signature(working) !== signature(initial);
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export type Measure = 'diameterCm' | 'tiers' | 'discs' | 'slices' | 'assemblyMinutes';

// One measure, clamped to what the cake can be: the diameter from the smallest the tiers need (minDiameterFor) to the editor's ceiling,
// the tiers from 1 to what the diameter carries (maxTiersFor), the discs 1–5, the slices 1–200, the assembly minutes above 0 or none.
export function setMeasure(cake: Cake, measure: Measure, value: number): Cake {
  if (!Number.isFinite(value)) return cake;
  switch (measure) {
    case 'diameterCm': {
      const diameterCm = clamp(Math.round(value), minDiameterFor(cake.tiers), EDITOR_MAX_DIAMETER_CM);
      return diameterCm === cake.diameterCm ? cake : { ...cake, diameterCm };
    }
    case 'tiers': {
      const tiers = clamp(Math.round(value), 1, Math.max(1, maxTiersFor(cake.diameterCm)));
      return tiers === cake.tiers ? cake : { ...cake, tiers };
    }
    case 'discs': {
      const discs = clamp(Math.round(value), MIN_DISCS, MAX_DISCS);
      return discs === cake.discs ? cake : { ...cake, discs };
    }
    case 'slices': {
      const slices = clamp(Math.round(value), 1, MAX_SLICES);
      return slices === cake.slices ? cake : { ...cake, slices };
    }
    case 'assemblyMinutes': {
      const assemblyMinutes = value > 0 ? Math.min(MAX_ASSEMBLY_MINUTES, Math.round(value)) : null;
      return assemblyMinutes === cake.assemblyMinutes ? cake : { ...cake, assemblyMinutes };
    }
  }
}

export function setName(cake: Cake, name: string): Cake {
  return name === cake.name ? cake : { ...cake, name };
}

// '' = no category.
export function setCategory(cake: Cake, categoryId: string): Cake {
  const next = categoryId === '' ? null : categoryId;
  return next === cake.categoryId ? cake : { ...cake, categoryId: next };
}

// The selling price (gross, VAT in) and the target, typed: '' is none, junk is NaN (refused at Save).
export function setPrice(cake: Cake, text: string): Cake {
  return { ...cake, sellingPrice: readNumber(text) };
}

export function setTarget(cake: Cake, text: string): Cake {
  return { ...cake, foodCostTarget: readNumber(text) };
}

// The VAT menu's value ('' = not chosen, a rate, or 'other' with its own box).
export function vatFromSelect(select: string, other: string): number | null {
  if (select === 'other') return readNumber(other);
  return select === '' ? null : Number(select);
}

export function setVat(cake: Cake, rate: number | null): Cake {
  return { ...cake, vatRate: rate };
}

const sameLine = (tier: number, part: CakePart, productId: string) => (line: CakeLine): boolean =>
  line.tier === tier && line.part === part && line.productId === productId;

// The cards of one part of one tier, in the order they were added.
export function cardsIn(cake: Cake, tier: number, part: CakePart): CakeLine[] {
  return cake.lines.filter(line => line.tier === tier && line.part === part);
}

// Whether a card may be added to this part: not a cake, not twice in the same part, and not past MAX_CARDS_PER_PART.
export function canAddCard(cake: Cake, tier: number, part: CakePart, productId: string): boolean {
  if (productId === '' || isCakeProductId(productId)) return false;
  const mine = cardsIn(cake, tier, part);
  return mine.length < MAX_CARDS_PER_PART && !mine.some(line => line.productId === productId);
}

export function addCard(cake: Cake, tier: number, part: CakePart, productId: string): Cake {
  if (!canAddCard(cake, tier, part, productId)) return cake;
  return { ...cake, lines: [...cake.lines, { tier, part, productId, grams: null }] };
}

export function removeCard(cake: Cake, tier: number, part: CakePart, productId: string): Cake {
  const same = sameLine(tier, part, productId);
  return cake.lines.some(same) ? { ...cake, lines: cake.lines.filter(line => !same(line)) } : cake;
}

// Grams typed for a card, as the box holds them: whole grams, '' = back to the rule. Anything that is not a plain number leaves the
// card as it was (the box never shows what was refused). Never above what the rules accept.
export function setGrams(cake: Cake, tier: number, part: CakePart, productId: string, text: string): Cake {
  const same = sameLine(tier, part, productId);
  if (!cake.lines.some(same)) return cake;
  const typed = readNumber(text);
  if (typed !== null && !Number.isFinite(typed)) return cake;
  const grams = typed === null ? null : clamp(Math.round(typed), 0, MAX_LINE_GRAMS);
  return { ...cake, lines: cake.lines.map(line => (same(line) ? { ...line, grams } : line)) };
}

export function resetGrams(cake: Cake, tier: number, part: CakePart, productId: string): Cake {
  return setGrams(cake, tier, part, productId, '');
}

// Packaging for the whole cake, counted in pieces. One line per ingredient; MAX_PACKAGING lines.
export function addPack(cake: Cake, ingredientId: string): Cake {
  if (ingredientId === '' || cake.packaging.length >= MAX_PACKAGING || cake.packaging.some(line => line.ingredientId === ingredientId)) return cake;
  return { ...cake, packaging: [...cake.packaging, { ingredientId, qtyPcs: 1 }] };
}

export function removePack(cake: Cake, ingredientId: string): Cake {
  return cake.packaging.some(line => line.ingredientId === ingredientId)
    ? { ...cake, packaging: cake.packaging.filter(line => line.ingredientId !== ingredientId) }
    : cake;
}

// The pieces of one packaging line, typed: whole pieces, 0 while the box is empty (Save asks for a number above 0).
export function setPackQty(cake: Cake, ingredientId: string, text: string): Cake {
  const typed = readNumber(text);
  if (typed !== null && !Number.isFinite(typed)) return cake;
  const qtyPcs = typed === null ? 0 : clamp(Math.round(typed), 0, MAX_PACK_PCS);
  return { ...cake, packaging: cake.packaging.map(line => (line.ingredientId === ingredientId ? { ...line, qtyPcs } : line)) };
}

// The first packaging line the database would refuse (no pieces), or null.
export function firstEmptyPack(cake: Cake): string | null {
  return cake.packaging.find(line => !(line.qtyPcs > 0))?.ingredientId ?? null;
}

// The venue's reference grams as they are now, taken into the cake (the rule lines recompute, the grams typed by hand stay).
export function takeReference(cake: Cake, venueRef: ReferenceGrams | null): Cake {
  return sameReference(cake.ref, venueRef) ? cake : { ...cake, ref: venueRef ? { ...venueRef } : null };
}

// The venue has reference grams and the cake was made with others (or with none): the editor offers to take the current ones.
export function referenceChanged(cake: Cake, venueRef: ReferenceGrams | null): boolean {
  return venueRef !== null && !sameReference(cake.ref, venueRef);
}
