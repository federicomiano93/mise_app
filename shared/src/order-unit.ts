// order-unit.ts — «what is ONE of this line?», for the ingredients that can be ordered
// in more than one unit. PURE, ZERO imports: Orders and Inventory both read it, and
// neither may import the other's folder.
//
// TypeScript port of js/order-unit.js for Mise 2. Behaviour is identical, input for input:
// order-unit.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones the
// original paid for in bugs.
//
// ⚠️ THE CASE THIS EXISTS FOR. One ingredient card can name an order unit («cartone»)
// AND a package («busta»), and the supplier will sell either. So the unit is a choice
// made PER ORDER LINE, not a property of the ingredient alone. Every question below is
// «which unit does this line mean?» — answered in ONE place, so the draft, the history,
// the message and the stocktake cannot disagree.
//
// ⚠️ A QUANTITY IN ONE UNIT IS CONVERTED INTO ANOTHER IN ONE CASE ONLY: inPackages() below,
// for two orders of the same day. Everywhere else 2 cartoni and 2 buste are different numbers
// of different things.

// The few fields of a card and of a draft entry this file reads. Anything at all may arrive
// (a document is data), so every field is `unknown`; `?.` is the original's own way of reading
// them, kept as it was.
interface UnitCard {
  unit?: unknown;
  packUnit?: unknown;
  packCount?: unknown;
}
interface UnitEntry {
  unit?: unknown;
}
interface UnitRecord {
  units?: Readonly<Record<string, unknown>> | null;
}
type Maybe<T> = T | null | undefined;

const MAX_UNIT = 100;

// A unit as typed, made safe: a trimmed string of at most 100 characters, '' for
// anything that is not a string. The cap matches what the ingredient rules accept, so a
// unit read from one document can always be written into another.
export function cleanUnit(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, MAX_UNIT) : '';
}

// The same unit, ignoring case and stray spaces. «Busta», «busta» and « busta  » are
// one unit: units are free text, and treating a capital letter as a different unit
// would refuse an order for nothing — or, worse, show a choice of two identical words.
export function sameUnit(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string => cleanUnit(v).replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

// Does the card offer a real choice? Only when it names BOTH a unit and a package and
// they are different words. A card with only one of them — or the same word twice —
// has nothing to choose, so the order row shows no selector.
export function hasUnitChoice(ing: unknown): boolean {
  const card = ing as Maybe<UnitCard>;
  const unit = cleanUnit(card?.unit);
  const pack = cleanUnit(card?.packUnit);
  return Boolean(unit) && Boolean(pack) && !sameUnit(unit, pack);
}

// The units to offer for a line: [the card's unit, its package] when there is a choice,
// else just the card's unit (or nothing).
//
// `current` is the unit a line ALREADY carries. If the card no longer offers it (the
// package was renamed since), it is appended rather than dropped: a stored choice must
// never be silently reinterpreted as a different unit just because a list got shorter.
export function unitChoices(ing: unknown, current: unknown = ''): string[] {
  const card = ing as Maybe<UnitCard>;
  const unit = cleanUnit(card?.unit);
  const list = hasUnitChoice(ing) ? [unit, cleanUnit(card?.packUnit)] : (unit ? [unit] : []);
  const stale = cleanUnit(current);
  if (stale && !list.some(u => sameUnit(u, stale))) list.push(stale);
  return list;
}

// The unit a draft entry means: its own if it carries one, else the card's.
export function entryUnit(entry: unknown, ing: unknown): string {
  return cleanUnit((entry as Maybe<UnitEntry>)?.unit) || cleanUnit((ing as Maybe<UnitCard>)?.unit);
}

// Is this entry in the card's own unit? No unit stored means the default — that is the
// shape of every entry written before the choice existed.
export function isDefaultUnit(entry: unknown, ing: unknown): boolean {
  const own = entry as Maybe<UnitEntry>;
  return !cleanUnit(own?.unit) || sameUnit(own?.unit, (ing as Maybe<UnitCard>)?.unit);
}

// THE one answer to «does this line show and freeze a unit?»: only when the ingredient
// offers a choice, or the entry carries a non-default unit anyway. Every other line
// stays exactly as it always was — no unit in the message, none in the record.
export function lineUnit(ing: unknown, entry: unknown): string {
  if (hasUnitChoice(ing) || !isDefaultUnit(entry, ing)) return entryUnit(entry, ing);
  return '';
}

// The unit a RECORDED order line was placed in: the one frozen into the record, else
// the card's (every record written before the choice existed was in the card's unit).
export function recordUnit(record: unknown, id: unknown, ing: unknown): string {
  return cleanUnit((record as Maybe<UnitRecord>)?.units?.[id as string]) || cleanUnit((ing as Maybe<UnitCard>)?.unit);
}

// «2 × busta» — the multiplication sign, not a plural: units are free words, and
// «buste» / «cartoni» cannot be derived from them in any language.
export function qtyWithUnit(qty: unknown, unit: unknown): string {
  const u = cleanUnit(unit);
  return u ? `${qty} × ${u}` : String(qty);
}

// ⚠️ THE ONE CONVERSION THERE IS (Federico, 3 Oct 2026: «se ordino un cartone che ha 4 buste e
// nel pomeriggio ordino 2 buste considera un totale di 6 buste, il prezzo non cambia»).
// A quantity in the card's own unit or in its package, expressed in PACKAGES — or null when
// that cannot be known. Only when the card offers that choice AND says how many packages one
// unit holds (`packCount`, the whole number typed under «Cartone»). Nothing is guessed: no
// packCount, or a unit that is neither of the two, answers null and the callers refuse as
// before. Packages, never fractions of a case: 6 buste, not 1.5 cartoni. The price stays
// right because a busta line is priced per busta (order-cost.ts lineUnitCost).
export function inPackages(qty: number, unit: unknown, ing: unknown): number | null {
  if (!hasUnitChoice(ing)) return null;
  const card = ing as UnitCard;
  if (sameUnit(unit, card.packUnit)) return qty;
  const count = card.packCount;
  if (sameUnit(unit, card.unit) && typeof count === 'number' && Number.isInteger(count) && count >= 1) return qty * count;
  return null;
}

// Can two quantities of one ingredient, in these two units, be added up (in packages)?
export function addableInPackages(unitA: unknown, unitB: unknown, ing: unknown): boolean {
  return inPackages(1, unitA, ing) !== null && inPackages(1, unitB, ing) !== null;
}

// What the DRAFT stores for a chosen unit: nothing for the card's own unit (so the
// ordinary entry keeps its {qty, stock} shape), the unit itself otherwise.
export function storedUnitFor(chosen: unknown, ing: unknown): string {
  const unit = cleanUnit(chosen);
  if (!unit || sameUnit(unit, (ing as Maybe<UnitCard>)?.unit)) return '';
  return unit;
}
