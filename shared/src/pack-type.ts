// pack-type.ts — «Che confezione è?»: the word of the package a SINGLE product comes in (bottiglia, secchiello…), kept on the
// ingredient so the order can say «2 bottiglie» instead of «2». PURE.
//
// New in Mise 2 (no file of the current app to pair it with). It writes nothing the rules do not already accept: the type is
// stored as `unit = packUnit = word`, both existing fields.
//
// ⚠️ A TYPED SINGLE IS: unit == packUnit == a package word, and no packCount. That is the shape the card already leaves behind
// when an employee turns a Cartone into a Singola, and every reader prices it as ONE item (order-unit.ts hasUnitChoice is false,
// order-cost.ts itemsPerOrderedUnit / lineUnitCost, pack-format.ts formatOf's packWordIsUnit). Choosing a type writes BOTH fields,
// never packUnit alone: a packUnit with another unit would offer a unit choice nobody asked for.
//
// ⚠️ MONEY: moving between «no type» and «a type» changes the unit, and an empty unit on a stored case of more than one reads
// «the whole case» (order-cost.ts legacyUnitCost: 225 becomes 217, or null for pieces). So that move happens only when the
// caller says `mayRewrite` (a new item, or a price writer whose opened price has no stored case of more than one). A RENAME
// (one type to another) never changes how a line is priced and is always allowed.

import { cleanUnit, hasUnitChoice, lineUnit, qtyWithUnit, sameUnit } from './order-unit';
import { validPackCount } from './order-cost';
import { isCartonWord } from './pack-format';
import { packPlural } from './pack-words';

// The rules cap packUnit at 40.
export const PACK_TYPE_MAX = 40;

// The words that are a UNIT or a weight, never a package: the keys of order-cost.ts WEIGHT_UNITS and PIECE_UNITS (copied, those
// two tables are private there). A type of «kg» would make the line "kilos", and the readers would price it so.
const LOOSE_WORDS: ReadonlySet<string> = new Set([
  'kg', 'kgs', 'kilo', 'kilos', 'kili', 'chilo', 'chili', 'chilogrammi',
  'g', 'gr', 'grammi', 'grams',
  'l', 'lt', 'litro', 'litri', 'litre', 'litres', 'liter', 'liters',
  'ml', 'cl',
  'pz', 'pezzo', 'pezzi', 'pcs', 'pc', 'piece', 'pieces', 'each',
]);

const normal = (word: unknown): string => cleanUnit(word).toLowerCase().replace(/\.$/, '');

// Is this word a package a type may name? Not empty, not a weight / volume / piece word, not a carton word.
export function isPackTypeWord(word: unknown): boolean {
  const w = normal(word);
  return w !== '' && !LOOSE_WORDS.has(w) && !isCartonWord(w);
}

// The fields of a card this file reads: it is a document, so anything may arrive.
interface TypeCard { unit?: unknown; packUnit?: unknown; packCount?: unknown }
const asCard = (value: unknown): TypeCard => ((value && typeof value === 'object') ? value as TypeCard : {});

// THE one definition of «this card has a type»: the package word, or '' when it has none.
export function packTypeOf(ingredient: unknown): string {
  const card = asCard(ingredient);
  if (validPackCount(card) !== null) return '';
  if (cleanUnit(card.unit) === '' || !sameUnit(card.unit, card.packUnit)) return '';
  return isPackTypeWord(card.packUnit) ? cleanUnit(card.packUnit) : '';
}

export interface TypeGuard {
  // Moving between «no type» and «a type» is allowed (see the header).
  readonly mayRewrite: boolean;
}

// Does the card draw the «Che confezione è?» menu for these fields (the unit, the package word and the count as they WOULD be
// saved)? Never for a carton, never over a unit choice the item already offers (that choice would be lost), always for an item
// that has a type, and for an item without one only when `mayRewrite`, and its unit is empty or itself a package word.
export function packTypeShown(fields: unknown, { mayRewrite }: TypeGuard): boolean {
  const card = asCard(fields);
  if (validPackCount(card) !== null) return false;
  if (hasUnitChoice(card)) return false;
  if (packTypeOf(card) !== '') return true;
  if (!mayRewrite) return false;
  return cleanUnit(card.unit) === '' || isPackTypeWord(card.unit);
}

export interface PackTypePatch { unit?: string; packUnit?: string }

// What choosing `chosen` ('' = none) adds to the payload: both keys, or {} when nothing is to change.
export function packTypePatch(fields: unknown, chosen: unknown, guard: TypeGuard): PackTypePatch {
  const word = cleanUnit(chosen).slice(0, PACK_TYPE_MAX);
  const current = packTypeOf(fields);
  if (sameUnit(word, current)) return {};
  if (word !== '' && !isPackTypeWord(word)) return {};
  if (!packTypeShown(fields, guard)) return {};
  if (current !== '' && word !== '') return { unit: word, packUnit: word };
  if (!guard.mayRewrite) return {};
  return word === '' ? { unit: '', packUnit: '' } : { unit: word, packUnit: word };
}

// The package word a LINE of an order is counted in: only when the line shows no unit of its own (order-unit.ts lineUnit) and
// the card has a type. '' otherwise.
export function linePackWord(ingredient: unknown, entry: unknown): string {
  return lineUnit(ingredient, entry) !== '' ? '' : packTypeOf(ingredient);
}

// «2 bottiglie» / «1 secchiello»; a word nobody taught the plural of reads «2 × damigiana»; no word, just the number.
export function qtyWithPack(qty: unknown, word: unknown, language: unknown): string {
  const w = cleanUnit(word);
  if (w === '') return String(qty);
  const plural = packPlural(w, qty, language);
  return plural === null ? qtyWithUnit(qty, w) : `${qty} ${plural}`;
}

// A quantity as a screen shows it: «2 × unit» when the line has its own unit, else the card's package word, else the number.
export function shownQty(qty: unknown, unit: unknown, card: unknown, language: unknown): string {
  if (cleanUnit(unit) !== '') return qtyWithUnit(qty, unit);
  const word = packTypeOf(card);
  return word === '' ? String(qty) : qtyWithPack(qty, word, language);
}
