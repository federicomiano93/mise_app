import { LINE_UNITS } from '@mise/shared/foodcost-model';
import type { LineUnit } from '@mise/shared/foodcost-model';
import { positiveNumber } from '@mise/shared/price-model';

// The units an INGREDIENT line of «Made of» offers (step 3b of the Food cost plan, 11 Nov 2026): only the ones its price can be
// turned into, so a line can never be typed in a unit that costs nothing.
//
//   priced per kilo (or litre)  → g, kg — and pieces only when one piece has a weight
//   priced per piece            → pieces — and g, kg only when one piece has a weight
//   no price basis yet          → all three: nothing to convert from, so nothing is ruled out
//
// The price basis and the piece weight are the ones the cost model reads (`priceUnit`, `unitWeightKg`, laid on by withPrices):
// no second source.
// ⚠️ THE LINE'S OWN UNIT IS ALWAYS OFFERED, even outside the set: a line saved in pieces before its ingredient lost its piece weight
// keeps «pieces» in its menu, so opening and saving the form never changes a saved line behind the person's back.
// Always in the order g, kg, pieces (LINE_UNITS).

type Priced = { priceUnit?: unknown; unitWeightKg?: unknown };

function basisOf(ingredient: unknown): 'kg' | 'pcs' | null {
  const unit = ingredient && typeof ingredient === 'object' ? (ingredient as Priced).priceUnit : null;
  if (unit === 'kg' || unit === 'l') return 'kg';
  return unit === 'pcs' ? 'pcs' : null;
}

export function hasPieceWeight(ingredient: unknown): boolean {
  return !!ingredient && typeof ingredient === 'object' && positiveNumber((ingredient as Priced).unitWeightKg) !== null;
}

// What converts, before the line's own unit is added back.
function convertible(ingredient: unknown): readonly LineUnit[] {
  const basis = basisOf(ingredient);
  if (basis === null) return LINE_UNITS;
  if (hasPieceWeight(ingredient)) return LINE_UNITS;
  return basis === 'kg' ? ['g', 'kg'] : ['pcs'];
}

export function lineUnits(ingredient: unknown, current: LineUnit): LineUnit[] {
  const set = convertible(ingredient);
  return LINE_UNITS.filter(unit => set.includes(unit) || unit === current);
}

// The unit a NEW line opens on: grams when grams convert, else the first that does (pieces, for something bought by the piece
// with no piece weight).
export function openingUnit(ingredient: unknown): LineUnit {
  const set = convertible(ingredient);
  return set.includes('g') ? 'g' : (set[0] ?? 'g');
}
