// pricing.ts — from invoice lines to one net price per base unit (kg, l or piece).
// A port of invoice-import/pricing.py. The price is what the goods REALLY cost: the total of every line of
// the product on the invoice divided by everything delivered. A free-goods line (same article, total 0)
// therefore lowers the price, which is the point. Pure.
//
// FULL port of js/orders/invoice-zip/pricing.js: same exported names, same values, same behaviour input for
// input. Typing only differs (the casts are marked where they sit). parity.spec.ts compares the exports.

import { pySum, roundHalfUp } from './py-compat';
import { NOTE } from './reasons';

export { roundHalfUp };

type Dimension = [dimension: string, factor: number];

// Invoiced unit -> [dimension, factor to the base unit]. Anything not listed is a
// count of pieces or packages and needs a package weight from somewhere else.
const WEIGHT_UNITS: Record<string, Dimension> = {
  KG: ['kg', 1.0], KGM: ['kg', 1.0], KGS: ['kg', 1.0],
  KILOGRAMMI: ['kg', 1.0], KILOGRAMMO: ['kg', 1.0],
  GR: ['kg', 0.001], G: ['kg', 0.001], GRAMMI: ['kg', 0.001],
  QL: ['kg', 100.0], QLI: ['kg', 100.0], QUINTALI: ['kg', 100.0], QUINTALE: ['kg', 100.0],
  LT: ['l', 1.0], L: ['l', 1.0], LITRI: ['l', 1.0], LITRO: ['l', 1.0],
  ML: ['l', 0.001], CL: ['l', 0.01],
};
export const PIECES = 'pc';

// Pack size units -> [dimension, factor]
export const PACK_UNITS: Record<string, Dimension> = {
  kg: ['kg', 1.0], g: ['kg', 0.001], l: ['l', 1.0], ml: ['l', 0.001],
};

// A price outside these bounds is almost certainly a misread weight or pack, never a real price.
const KG_L_PRICE_RANGE: [number, number] = [0.05, 300.0];
const PIECE_PRICE_RANGE: [number, number] = [0.01, 50.0];
// What one egg can plausibly cost, used to tell «the quantity counts eggs» from «counts packs».
const EGG_PRICE_RANGE: [number, number] = [0.05, 0.90];
export const OUT_OF_SCALE_NOTE = NOTE.PRICE_OUT_OF_SCALE;
export const EGG_UNCLEAR_NOTE = NOTE.EGG_QUANTITY_UNCLEAR;

const RELIABILITY_ORDER: Record<string, number> = { alta: 0, media: 1, 'da verificare': 2 };
export const DISCOUNT_NOTE = NOTE.UNATTRIBUTED_DISCOUNT;

export function unitClass(rawUnit?: unknown): Dimension {
  const u = String(rawUnit || '').replace(/[\s.]+/g, '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(WEIGHT_UNITS, u) ? WEIGHT_UNITS[u] as Dimension : [PIECES, 1.0];
}

// One package: its size and the unit it is written in (kg, g, l, ml).
export interface PricingPack { size: number; unit: string }

// What the workbook row says about the package. The owner may have corrected it.
export interface PricingParams {
  priceUnit: string | null;
  pack: PricingPack | null;
  packCount: number | null;
  egg: boolean;
  eggWeightKg: number;
}

// priceUnit: 'kg' | 'l' | 'pcs' | null; pack: one package ({size, unit}) or null; packCount: int or null.
export function params({
  priceUnit = null, pack = null, packCount = null, egg = false, eggWeightKg = 0.05,
}: Partial<PricingParams> = {}): PricingParams {
  return { priceUnit, pack, packCount, egg, eggWeightKg };
}

function packBase(p: PricingParams): [number, string] | null {
  if (!p.pack) return null;
  // The cast is typing only: an unknown pack unit throws here, as in the original.
  const [dim, factor] = PACK_UNITS[p.pack.unit] as Dimension;
  return [p.pack.size * factor, dim];
}

// Weight of ONE piece, required whenever a price is per piece.
export function unitWeightKg(p: PricingParams): number | null {
  if (p.egg) return p.eggWeightKg;
  const base = packBase(p);
  if (base && base[1] === 'kg') return base[0];
  return null;
}

const inRange = (value: number, bounds: [number, number]): boolean => bounds[0] <= value && value <= bounds[1];

// One invoice line, as far as the price needs it.
export interface PricedLine {
  number: number;
  unit?: string | null;
  quantity?: number | null;
  total?: number | null;
  vatRate?: number | null;
}

// A product's price on one invoice and how far to trust it.
export interface ComputedPrice {
  price: number | null;
  qty: number | null;
  reliability: string;
  note: string;
  unitWeightKg: number | null;
  vatRate: number | null | undefined;
}

function finish(result: ComputedPrice, mixed: boolean, discountFlag: boolean, priceUnit: string | null = null): ComputedPrice {
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

function computed(price: number | null, qty: number | null, reliability: string, note: string,
  extra: Partial<ComputedPrice> = {}): ComputedPrice {
  return { price, qty, reliability, note, unitWeightKg: null, vatRate: null, ...extra };
}

// One product on one invoice -> its price, quantity and how far to trust them.
export function computeDocument(lines: readonly PricedLine[], p: PricingParams, discountFlag = false): ComputedPrice {
  const ordered = [...lines].sort((a, b) => a.number - b.number);
  // The cast is typing only: an empty list throws here, as in the original.
  const first = ordered[0] as PricedLine;
  const cls = unitClass(first.unit)[0];
  const same = ordered.filter((ln) => unitClass(ln.unit)[0] === cls);
  const mixed = same.length !== ordered.length;
  const vat = first.vatRate;

  const total = pySum(same.map((ln) => ln.total ?? 0.0));
  const pieces = pySum(same.map((ln) => ln.quantity ?? 0.0));

  // Already "da verificare": the reason it has no price is the useful note.
  const fail = (note: string): ComputedPrice => computed(null, null, 'da verificare', note, { vatRate: vat });

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
    let result: ComputedPrice;
    if (p.egg) {
      let note: string = NOTE.EGG_WEIGHT_FROM_CONFIG;
      let qty: number;
      let reliability: string;
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

export function worse(a: string, b: string): string {
  return (RELIABILITY_ORDER[a] as number) >= (RELIABILITY_ORDER[b] as number) ? a : b;
}
