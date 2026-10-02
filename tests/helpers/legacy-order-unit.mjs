// legacy-order-unit.mjs — FROZEN COPY of js/order-unit.js on main before «Cartone». See legacy-order-cost.mjs.
// order-unit.js — «what is ONE of this line?», for the ingredients that can be ordered
// in more than one unit. PURE, ZERO imports: Orders and Inventory both read it, and
// neither may import the other's folder.
//
// ⚠️ THE CASE THIS EXISTS FOR. One ingredient card can name an order unit («cartone»)
// AND a package («busta»), and the supplier will sell either. So the unit is a choice
// made PER ORDER LINE, not a property of the ingredient alone. Every question below is
// «which unit does this line mean?» — answered in ONE place, so the draft, the history,
// the message and the stocktake cannot disagree.
//
// ⚠️ A QUANTITY IN ONE UNIT IS NEVER CONVERTED INTO ANOTHER HERE. 2 cartoni and 2 buste
// are different numbers of different things; the callers refuse to add them up instead.

const MAX_UNIT = 100;

// A unit as typed, made safe: a trimmed string of at most 100 characters, '' for
// anything that is not a string. The cap matches what the ingredient rules accept, so a
// unit read from one document can always be written into another.
export function cleanUnit(v) {
  return typeof v === 'string' ? v.trim().slice(0, MAX_UNIT) : '';
}

// The same unit, ignoring case and stray spaces. «Busta», «busta» and « busta  » are
// one unit: units are free text, and treating a capital letter as a different unit
// would refuse an order for nothing — or, worse, show a choice of two identical words.
export function sameUnit(a, b) {
  const norm = v => cleanUnit(v).replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

// Does the card offer a real choice? Only when it names BOTH a unit and a package and
// they are different words. A card with only one of them — or the same word twice —
// has nothing to choose, so the order row shows no selector.
export function hasUnitChoice(ing) {
  const unit = cleanUnit(ing?.unit);
  const pack = cleanUnit(ing?.packUnit);
  return Boolean(unit) && Boolean(pack) && !sameUnit(unit, pack);
}

// The units to offer for a line: [the card's unit, its package] when there is a choice,
// else just the card's unit (or nothing).
//
// `current` is the unit a line ALREADY carries. If the card no longer offers it (the
// package was renamed since), it is appended rather than dropped: a stored choice must
// never be silently reinterpreted as a different unit just because a list got shorter.
export function unitChoices(ing, current = '') {
  const unit = cleanUnit(ing?.unit);
  const list = hasUnitChoice(ing) ? [unit, cleanUnit(ing.packUnit)] : (unit ? [unit] : []);
  const stale = cleanUnit(current);
  if (stale && !list.some(u => sameUnit(u, stale))) list.push(stale);
  return list;
}

// The unit a draft entry means: its own if it carries one, else the card's.
export function entryUnit(entry, ing) {
  return cleanUnit(entry?.unit) || cleanUnit(ing?.unit);
}

// Is this entry in the card's own unit? No unit stored means the default — that is the
// shape of every entry written before the choice existed.
export function isDefaultUnit(entry, ing) {
  return !cleanUnit(entry?.unit) || sameUnit(entry.unit, ing?.unit);
}

// THE one answer to «does this line show and freeze a unit?»: only when the ingredient
// offers a choice, or the entry carries a non-default unit anyway. Every other line
// stays exactly as it always was — no unit in the message, none in the record.
export function lineUnit(ing, entry) {
  if (hasUnitChoice(ing) || !isDefaultUnit(entry, ing)) return entryUnit(entry, ing);
  return '';
}

// The unit a RECORDED order line was placed in: the one frozen into the record, else
// the card's (every record written before the choice existed was in the card's unit).
export function recordUnit(record, id, ing) {
  return cleanUnit(record?.units?.[id]) || cleanUnit(ing?.unit);
}

// «2 × busta» — the multiplication sign, not a plural: units are free words, and
// «buste» / «cartoni» cannot be derived from them in any language.
export function qtyWithUnit(qty, unit) {
  const u = cleanUnit(unit);
  return u ? `${qty} × ${u}` : String(qty);
}

// What the DRAFT stores for a chosen unit: nothing for the card's own unit (so the
// ordinary entry keeps its {qty, stock} shape), the unit itself otherwise.
export function storedUnitFor(chosen, ing) {
  const unit = cleanUnit(chosen);
  if (!unit || sameUnit(unit, ing?.unit)) return '';
  return unit;
}
