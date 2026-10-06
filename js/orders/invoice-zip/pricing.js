// pricing.js — from invoice lines to one net price per base unit (kg, l or piece).
// A port of invoice-import/pricing.py. The price is what the goods REALLY cost: the total of every line of
// the product on the invoice divided by everything delivered. A free-goods line (same article, total 0)
// therefore lowers the price, which is the point. Pure.

import { pySum, roundHalfUp } from './py-compat.js';
import { NOTE } from './reasons.js';

export { roundHalfUp };

// Invoiced unit -> [dimension, factor to the base unit]. Anything not listed is a
// count of pieces or packages and needs a package weight from somewhere else.
const WEIGHT_UNITS = {
  KG: ['kg', 1.0], KGM: ['kg', 1.0], KGS: ['kg', 1.0],
  KILOGRAMMI: ['kg', 1.0], KILOGRAMMO: ['kg', 1.0],
  GR: ['kg', 0.001], G: ['kg', 0.001], GRAMMI: ['kg', 0.001],
  QL: ['kg', 100.0], QLI: ['kg', 100.0], QUINTALI: ['kg', 100.0], QUINTALE: ['kg', 100.0],
  LT: ['l', 1.0], L: ['l', 1.0], LITRI: ['l', 1.0], LITRO: ['l', 1.0],
  ML: ['l', 0.001], CL: ['l', 0.01],
};
export const PIECES = 'pc';

// Pack size units -> [dimension, factor]
export const PACK_UNITS = { kg: ['kg', 1.0], g: ['kg', 0.001], l: ['l', 1.0], ml: ['l', 0.001] };

// A price outside these bounds is almost certainly a misread weight or pack, never a real price.
const KG_L_PRICE_RANGE = [0.05, 300.0];
const PIECE_PRICE_RANGE = [0.01, 50.0];
// What one egg can plausibly cost, used to tell «the quantity counts eggs» from «counts packs».
const EGG_PRICE_RANGE = [0.05, 0.90];
export const OUT_OF_SCALE_NOTE = NOTE.PRICE_OUT_OF_SCALE;
export const EGG_UNCLEAR_NOTE = NOTE.EGG_QUANTITY_UNCLEAR;

const RELIABILITY_ORDER = { alta: 0, media: 1, 'da verificare': 2 };
export const DISCOUNT_NOTE = NOTE.UNATTRIBUTED_DISCOUNT;

export function unitClass(rawUnit) {
  const u = String(rawUnit || '').replace(/[\s.]+/g, '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(WEIGHT_UNITS, u) ? WEIGHT_UNITS[u] : [PIECES, 1.0];
}

// What the workbook row says about the package. The owner may have corrected it.
// priceUnit: 'kg' | 'l' | 'pcs' | null; pack: one package ({size, unit}) or null; packCount: int or null.
export function params({ priceUnit = null, pack = null, packCount = null, egg = false, eggWeightKg = 0.05 } = {}) {
  return { priceUnit, pack, packCount, egg, eggWeightKg };
}

function packBase(p) {
  if (!p.pack) return null;
  const [dim, factor] = PACK_UNITS[p.pack.unit];
  return [p.pack.size * factor, dim];
}

// Weight of ONE piece, required whenever a price is per piece.
export function unitWeightKg(p) {
  if (p.egg) return p.eggWeightKg;
  const base = packBase(p);
  if (base && base[1] === 'kg') return base[0];
  return null;
}

const inRange = (value, bounds) => bounds[0] <= value && value <= bounds[1];

function finish(result, mixed, discountFlag, priceUnit = null) {
  if (mixed) {
    result.reliability = 'da verificare';
    result.note = NOTE.MIXED_UNITS;
  }
  if (discountFlag) {
    result.reliability = 'da verificare';
    result.note = DISCOUNT_NOTE;
  }
  // ⚠️ NO ABSURD PRICE MAY LOOK RELIABLE: a price per kg/l or per piece outside any believable
  // range is a misread weight or pack count, so it can never stay «alta» or «media».
  if (result.price !== null && priceUnit !== null) {
    const bounds = priceUnit === 'pcs' ? PIECE_PRICE_RANGE : KG_L_PRICE_RANGE;
    if (!inRange(result.price, bounds)) {
      result.reliability = 'da verificare';
      result.note = OUT_OF_SCALE_NOTE;
    }
  }
  return result;
}

function computed(price, qty, reliability, note, extra = {}) {
  return { price, qty, reliability, note, unitWeightKg: null, vatRate: null, ...extra };
}

// One product on one invoice -> its price, quantity and how far to trust them.
export function computeDocument(lines, p, discountFlag = false) {
  const ordered = [...lines].sort((a, b) => a.number - b.number);
  const first = ordered[0];
  const cls = unitClass(first.unit)[0];
  const same = ordered.filter((ln) => unitClass(ln.unit)[0] === cls);
  const mixed = same.length !== ordered.length;
  const vat = first.vatRate;

  const total = pySum(same.map((ln) => ln.total ?? 0.0));
  const pieces = pySum(same.map((ln) => ln.quantity ?? 0.0));

  // Already "da verificare": the reason it has no price is the useful note.
  const fail = (note) => computed(null, null, 'da verificare', note, { vatRate: vat });

  if (p.priceUnit === null) return fail(cls === PIECES ? NOTE.NO_WEIGHT_ON_INVOICE : NOTE.NO_PRICE_UNIT);

  if (cls !== PIECES) {
    const baseQty = pySum(same.map((ln) => (ln.quantity ?? 0.0) * unitClass(ln.unit)[1]));
    if (baseQty <= 0) return fail(NOTE.QUANTITY_ZERO_OR_NEGATIVE);
    if (total <= 0) return fail(NOTE.AMOUNT_ZERO_OR_NEGATIVE);
    if (p.priceUnit !== cls) return fail(NOTE.PRICE_UNIT_DIFFERS_FROM_INVOICE);
    const price = total / baseQty;
    const note = cls === 'kg' ? NOTE.BY_WEIGHT : NOTE.BY_VOLUME;
    return finish(computed(price, baseQty, 'alta', note, { vatRate: vat }), mixed, discountFlag, p.priceUnit);
  }

  // Invoiced by pieces or packages: the weight has to come from elsewhere.
  if (pieces <= 0) return fail(NOTE.QUANTITY_ZERO_OR_NEGATIVE);
  if (total <= 0) return fail(NOTE.AMOUNT_ZERO_OR_NEGATIVE);
  const count = p.packCount || 1;

  if (p.priceUnit === 'pcs') {
    const weight = unitWeightKg(p);
    if (weight === null) return fail(NOTE.NO_PIECE_WEIGHT);
    let result;
    if (p.egg) {
      let note = NOTE.EGG_WEIGHT_FROM_CONFIG;
      let qty;
      let reliability;
      if (p.packCount === null) {
        note += `; ${NOTE.EGG_PACK_COUNT_MISSING}`;
        qty = pieces;
        reliability = 'media';
      } else {
        // The «X 30» may be applied twice: some invoices count eggs in the quantity, others
        // count packs. Take the reading whose price per egg is a believable egg price.
        const priceIfEggs = total / pieces;
        const priceIfPacks = total / (pieces * count);
        const eggsOk = inRange(priceIfEggs, EGG_PRICE_RANGE);
        const packsOk = inRange(priceIfPacks, EGG_PRICE_RANGE);
        reliability = 'media';
        if (eggsOk && !packsOk) {
          qty = pieces;
          note += `; ${NOTE.EGG_QUANTITY_COUNTS_EGGS}`;
        } else {
          qty = pieces * count;
          if (eggsOk === packsOk) {
            reliability = 'da verificare';
            note = EGG_UNCLEAR_NOTE;
          }
        }
      }
      result = computed(total / qty, qty, reliability, note, { unitWeightKg: weight, vatRate: vat });
    } else {
      const qty = pieces * count;
      result = computed(total / qty, qty, 'media', NOTE.PIECE_WEIGHT_FROM_DESCRIPTION,
        { unitWeightKg: weight, vatRate: vat });
    }
    return finish(result, mixed, discountFlag, p.priceUnit);
  }

  const base = packBase(p);
  if (base === null) return fail(NOTE.NO_WEIGHT_ON_INVOICE);
  const [size, dim] = base;
  if (dim !== p.priceUnit) return fail(NOTE.PRICE_UNIT_PACK_MISMATCH);
  const qty = pieces * size * count;
  return finish(
    computed(total / qty, qty, 'media', NOTE.WEIGHT_FROM_DESCRIPTION, { vatRate: vat }),
    mixed, discountFlag, p.priceUnit);
}

export function worse(a, b) {
  return RELIABILITY_ORDER[a] >= RELIABILITY_ORDER[b] ? a : b;
}
