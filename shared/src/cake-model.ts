// cake-model.ts — a cake on the price list: its measures, the grams of every card it is made of, and the Food cost
// product that carries its money. Mise 2 only (no js/ original). PURE: no DOM, no Firestore.
//
// ⚠️ ONE MONEY ENGINE. Nothing here adds up money by itself: a cake is turned into an ordinary Food cost product
// (`cakeProduct`: one semi-finished line per card, in kilos) and every figure comes from foodcost-model.ts /
// per-kg-model.ts run on that product. The maths in this file is GRAMS only: how much of a part a tier needs, and how
// that is shared between the cards of the part.
//
// ⚠️ A cake and its product never drift: the product is always derived from the cake's own fields (`ref` included),
// and the Save of the section writes both in one batch (the document: toCakeDocument; the product: cakeProduct).

import type { CostTables, PackagingLine, Product, ProductComponent, SemiLine, SemiLineReason, CostResult } from './foodcost-model';
import {
  PRODUCT_MODEL, componentLineCost, costProduct, labourBatchCost, productCooking, productionCost, suggestedGrossPrice,
} from './foodcost-model';
import { costPerKg } from './per-kg-model';
import { roundTo } from './price-model';

// ⚠️ The rules' ceiling on `model` is this number exactly (model-ceiling.spec.ts): raise the rules first.
export const CAKE_MODEL = 1;

// Top to bottom, the order the editor lists them.
export const CAKE_PARTS = Object.freeze(['decoration', 'coating', 'filling', 'soak', 'base'] as const);
export type CakePart = (typeof CAKE_PARTS)[number];

export const MAX_TIERS = 3;
export const TIER_STEP_CM = 6;
export const MIN_TIER_CM = 10;
export const MAX_DIAMETER_CM = 60;
export const MIN_DISCS = 1;
export const MAX_DISCS = 5;
// 3 tiers x 5 parts x 6 cards = 90 lines, which keeps the product's components under its own 100.
export const MAX_CARDS_PER_PART = 6;
export const MAX_PACKAGING = 20;
export const MAX_SLICES = 200;
export const MAX_LINE_GRAMS = 100000;
export const CAKE_PRODUCT_PREFIX = 'cake-';

// Only used to draw a cake whose venue has no reference grams yet (cakeGeometry); no cost depends on it.
export const DEFAULT_DISC_HEIGHT_CM = 3;
// What junk input falls back to in normalizeCake: a plain one-tier cake.
const DEFAULT_DIAMETER_CM = 20;
const DEFAULT_DISCS = 3;
const DEFAULT_SLICES = 12;

// The eight numbers the rules' isCakeReference lists (model-ceiling.spec.ts pins them against firestore.rules).
export const REFERENCE_KEYS = Object.freeze([
  'diameterCm', 'discs', 'discHeightCm', 'baseG', 'soakG', 'fillingG', 'coatingG', 'decorationG',
] as const);

export interface ReferenceGrams {
  diameterCm: number;
  discs: number;
  discHeightCm: number;
  // Per disc.
  baseG: number;
  // Per disc.
  soakG: number;
  // Per layer between two discs.
  fillingG: number;
  // The whole reference cake, top and sides.
  coatingG: number;
  // The reference cake's top.
  decorationG: number;
}

export interface CakeLine {
  // 0 = the bottom (largest) tier.
  tier: number;
  part: CakePart;
  productId: string;
  // null = «from the rule».
  grams: number | null;
}

export interface Cake {
  id: string;
  name: string;
  diameterCm: number;
  tiers: number;
  discs: number;
  slices: number;
  lines: CakeLine[];
  packaging: PackagingLine[];
  assemblyMinutes: number | null;
  sellingPrice: number | null;
  vatRate: number | null;
  foodCostTarget: number | null;
  categoryId: string | null;
  ref: ReferenceGrams | null;
  model: number | null;
}

// ── Ids ──────────────────────────────────────────────────────────────────────

export function cakeProductId(cakeId: string): string {
  return CAKE_PRODUCT_PREFIX + cakeId;
}

export function cakeIdOfProduct(productId: unknown): string | null {
  if (typeof productId !== 'string' || !productId.startsWith(CAKE_PRODUCT_PREFIX)) return null;
  const rest = productId.slice(CAKE_PRODUCT_PREFIX.length);
  return rest === '' ? null : rest;
}

export function isCakeProductId(id: unknown): boolean {
  return cakeIdOfProduct(id) !== null;
}

// ── Normalising (junk-safe: never throws, never yields NaN) ──────────────────

type Loose = Record<string, unknown>;

function isObject(raw: unknown): raw is Loose {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

// Only a real number counts: Number('') is 0 and Number('12') is 12, and a string in a number field is junk.
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// null unless ALL eight are present and inside the rules' bounds: a half reference would price a cake from nothing.
export function normalizeReference(raw: unknown): ReferenceGrams | null {
  if (!isObject(raw)) return null;
  const n = (key: string): number | null => finite(raw[key]);
  const diameterCm = n('diameterCm');
  const discs = n('discs');
  const discHeightCm = n('discHeightCm');
  const grams = (['baseG', 'soakG', 'fillingG', 'coatingG', 'decorationG'] as const).map(n);
  if (diameterCm === null || diameterCm < MIN_TIER_CM || diameterCm > MAX_DIAMETER_CM) return null;
  if (discs === null || !Number.isInteger(discs) || discs < MIN_DISCS || discs > MAX_DISCS) return null;
  if (discHeightCm === null || !(discHeightCm > 0) || discHeightCm > 20) return null;
  if (grams.some(g => g === null || g < 0 || g > MAX_LINE_GRAMS)) return null;
  const [baseG = 0, soakG = 0, fillingG = 0, coatingG = 0, decorationG = 0] = grams as number[];
  return { diameterCm, discs, discHeightCm, baseG, soakG, fillingG, coatingG, decorationG };
}

export function sameReference(a: ReferenceGrams | null | undefined, b: ReferenceGrams | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return REFERENCE_KEYS.every(key => a[key] === b[key]);
}

function normalizeLine(raw: unknown): CakeLine | null {
  if (!isObject(raw)) return null;
  const tier = finite(raw.tier);
  if (tier === null || !Number.isInteger(tier) || tier < 0 || tier >= MAX_TIERS) return null;
  if (!(CAKE_PARTS as readonly unknown[]).includes(raw.part)) return null;
  const productId = typeof raw.productId === 'string' ? raw.productId.trim() : '';
  if (productId === '' || productId.length > 64) return null;
  const typed = finite(raw.grams);
  // A negative or typed-as-text figure is «not typed»: the rule's figure applies.
  const grams = typed === null || typed < 0 ? null : clamp(Math.round(typed), 0, MAX_LINE_GRAMS);
  return { tier, part: raw.part as CakePart, productId, grams };
}

function normalizePacking(raw: unknown): PackagingLine | null {
  if (!isObject(raw)) return null;
  const ingredientId = typeof raw.ingredientId === 'string' ? raw.ingredientId.trim() : '';
  const qtyPcs = finite(raw.qtyPcs);
  if (ingredientId === '' || qtyPcs === null || !(qtyPcs > 0)) return null;
  return { ingredientId, qtyPcs: Math.min(1000, qtyPcs) };
}

function positiveOrNull(value: unknown, max: number): number | null {
  const n = finite(value);
  return n !== null && n > 0 ? Math.min(max, n) : null;
}

// A cake from arbitrary (Firestore) input. Lines of a tier beyond `tiers` are KEPT (the editor brings them back when a
// tier is added again); toCakeDocument and resolveLines leave them out. The same card twice in one tier+part, and a
// 7th card in a part, are dropped.
export function normalizeCake(raw: unknown): Cake | null {
  if (!isObject(raw)) return null;
  const diameter = finite(raw.diameterCm);
  const diameterCm = diameter === null ? DEFAULT_DIAMETER_CM : clamp(diameter, MIN_TIER_CM, MAX_DIAMETER_CM);
  const tiersRaw = finite(raw.tiers);
  // At least one tier even for a 10 cm cake: maxTiersFor is 0 only below the minimum, which the clamp rules out.
  const tiers = clamp(tiersRaw === null ? 1 : Math.round(tiersRaw), 1, Math.max(1, maxTiersFor(diameterCm)));
  const discsRaw = finite(raw.discs);
  const slicesRaw = finite(raw.slices);

  const seen = new Set<string>();
  const perPart = new Map<string, number>();
  const lines: CakeLine[] = [];
  for (const item of Array.isArray(raw.lines) ? raw.lines : []) {
    const line = normalizeLine(item);
    if (!line) continue;
    const key = `${line.tier}|${line.part}|${line.productId}`;
    if (seen.has(key)) continue;
    const partKey = `${line.tier}|${line.part}`;
    const count = perPart.get(partKey) ?? 0;
    if (count >= MAX_CARDS_PER_PART) continue;
    seen.add(key);
    perPart.set(partKey, count + 1);
    lines.push(line);
  }

  const vat = finite(raw.vatRate);
  const model = finite(raw.model);
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name: (typeof raw.name === 'string' ? raw.name : '').trim().slice(0, 200),
    diameterCm,
    tiers,
    discs: discsRaw === null ? DEFAULT_DISCS : clamp(Math.round(discsRaw), MIN_DISCS, MAX_DISCS),
    slices: slicesRaw === null ? DEFAULT_SLICES : clamp(Math.round(slicesRaw), 1, MAX_SLICES),
    lines,
    packaging: (Array.isArray(raw.packaging) ? raw.packaging : []).map(normalizePacking)
      .filter((p): p is PackagingLine => !!p).slice(0, MAX_PACKAGING),
    assemblyMinutes: positiveOrNull(raw.assemblyMinutes, 100000),
    sellingPrice: positiveOrNull(raw.sellingPrice, 100000),
    vatRate: vat === null || vat < 0 ? null : Math.min(100, vat),
    foodCostTarget: positiveOrNull(raw.foodCostTarget, 100),
    categoryId: typeof raw.categoryId === 'string' && raw.categoryId.trim() !== '' && raw.categoryId.length <= 64 ? raw.categoryId : null,
    ref: normalizeReference(raw.ref),
    model: model !== null && Number.isInteger(model) && model > 0 ? model : null,
  };
}

// ── Measures ─────────────────────────────────────────────────────────────────

// Bottom tier first: each tier above is one step narrower.
export function tierDiameters(diameterCm: number, tiers: number): number[] {
  return Array.from({ length: tiers }, (_, i) => diameterCm - TIER_STEP_CM * i);
}

// The smallest bottom diameter that still leaves every tier at least MIN_TIER_CM.
export function minDiameterFor(tiers: number): number {
  return MIN_TIER_CM + TIER_STEP_CM * (tiers - 1);
}

// How many tiers a bottom diameter can carry (0 below the minimum diameter).
export function maxTiersFor(diameterCm: number): number {
  let tiers = 0;
  while (tiers < MAX_TIERS && diameterCm >= minDiameterFor(tiers + 1)) tiers += 1;
  return tiers;
}

// ── The rule: how many grams of a part a tier needs ──────────────────────────

// Surface of a stack of `n` discs: the top plus the sides.
function surface(diameterCm: number, discs: number, discHeightCm: number): number {
  return Math.PI * (diameterCm / 2) ** 2 + Math.PI * diameterCm * (discs * discHeightCm);
}

// Grams of one part for ONE tier, scaled from the reference cake by area. NOT rounded (resolveLines rounds the share).
// ⚠️ The coating is approximate: the lower tops left uncovered under an upper tier are not subtracted.
// null while the venue has no reference grams.
export function ruleGrams(ref: ReferenceGrams | null, part: CakePart, tierDiameterCm: number, discs: number): number | null {
  if (!ref) return null;
  const area = (tierDiameterCm / ref.diameterCm) ** 2;
  switch (part) {
    case 'base': return ref.baseG * area * discs;
    case 'soak': return ref.soakG * area * discs;
    case 'filling': return ref.fillingG * area * Math.max(0, discs - 1);
    case 'coating':
      return ref.coatingG * surface(tierDiameterCm, discs, ref.discHeightCm) / surface(ref.diameterCm, ref.discs, ref.discHeightCm);
    case 'decoration': return ref.decorationG * area;
  }
}

export interface ResolvedLine extends CakeLine {
  diameterCm: number;
  ruleG: number | null;
  // The line's share of the rule's grams: the rule divided by the cards in its (tier, part), whole grams.
  share: number | null;
  // What the cake uses: the typed grams, else the share, else 0.
  grams: number;
  manual: boolean;
  // No rule (no reference grams) and nothing typed: the line counts as 0 g and the screen asks for a figure.
  missing: boolean;
}

// The lines of the tiers the cake has (a line of a tier beyond `tiers` is not part of the cake).
export function resolveLines(cake: Cake): ResolvedLine[] {
  const diameters = tierDiameters(cake.diameterCm, cake.tiers);
  const live = cake.lines.filter(line => line.tier >= 0 && line.tier < cake.tiers);
  const cardsIn = new Map<string, number>();
  for (const line of live) {
    const key = `${line.tier}|${line.part}`;
    cardsIn.set(key, (cardsIn.get(key) ?? 0) + 1);
  }
  return live.map(line => {
    const diameterCm = diameters[line.tier] as number;
    const ruleG = ruleGrams(cake.ref, line.part, diameterCm, cake.discs);
    const share = ruleG === null ? null : Math.round(ruleG / (cardsIn.get(`${line.tier}|${line.part}`) as number));
    const manual = line.grams !== null;
    return {
      ...line, diameterCm, ruleG, share,
      grams: line.grams ?? share ?? 0,
      manual,
      missing: !manual && ruleG === null,
    };
  });
}

// ── The product behind the cake ──────────────────────────────────────────────

// The cake as an ordinary Food cost product: one semi-finished line per card (its grams added up over every tier and
// part it appears in, in order of first appearance; a card at 0 g is left out), sold as ONE piece.
export function cakeProduct(cake: Cake): Product {
  const kilos = new Map<string, number>();
  for (const line of resolveLines(cake)) kilos.set(line.productId, (kilos.get(line.productId) ?? 0) + line.grams);
  const components: ProductComponent[] = [];
  for (const [productId, grams] of kilos) {
    if (grams > 0) components.push({ kind: 'semi', productId, qtyKg: grams / 1000 });
  }
  return {
    id: cakeProductId(cake.id),
    name: cake.name,
    components,
    packaging: cake.packaging.map(p => ({ ...p })),
    sellingMode: 'piece',
    piecesPerBatch: 1,
    packSize: null,
    packUnit: null,
    sellingPrice: cake.sellingPrice,
    vatRate: cake.vatRate,
    foodCostTarget: cake.foodCostTarget,
    labourMinutes: cake.assemblyMinutes,
    labourPeople: null,
    noWeightLoss: false,
    rawGrams: null,
    cookedGrams: null,
    model: PRODUCT_MODEL,
    kind: 'finished',
    categoryId: cake.categoryId,
  };
}

// The document, written WHOLE: exactly the keys of the cakes rule (no id: it is the document's name; no bakery: the data
// layer stamps it). Lines of a tier the cake no longer has are not written.
export function toCakeDocument(cake: Cake, nowIso: string): Record<string, unknown> {
  return {
    name: cake.name,
    diameterCm: cake.diameterCm,
    tiers: cake.tiers,
    discs: cake.discs,
    slices: cake.slices,
    lines: cake.lines.filter(line => line.tier < cake.tiers)
      .map(line => ({ tier: line.tier, part: line.part, productId: line.productId, grams: line.grams })),
    packaging: cake.packaging.map(p => ({ ingredientId: p.ingredientId, qtyPcs: p.qtyPcs })),
    assemblyMinutes: cake.assemblyMinutes,
    sellingPrice: cake.sellingPrice,
    vatRate: cake.vatRate,
    foodCostTarget: cake.foodCostTarget,
    categoryId: cake.categoryId,
    ref: cake.ref ? { ...cake.ref } : null,
    model: CAKE_MODEL,
    updatedAt: nowIso,
  };
}

// ── Costs (all from the Food cost engine) ────────────────────────────────────

export interface CakeLineCost {
  line: ResolvedLine;
  name: string;
  materials: number | null;
  labour: number | null;
  reason: SemiLineReason | null;
}

export function cakeLineCosts(cake: Cake, tables: CostTables): CakeLineCost[] {
  return resolveLines(cake).map(line => {
    const cost = componentLineCost({ kind: 'semi', productId: line.productId, qtyKg: line.grams / 1000 } satisfies SemiLine, tables);
    return {
      line,
      name: cost.name,
      materials: cost.cost,
      labour: cost.labour ?? null,
      reason: (cost.reason as SemiLineReason | null) ?? null,
    };
  });
}

export interface CakeTotals {
  product: Product;
  materials: number | null;
  // The assembly work (the cake's own minutes) and the work already in its semi-finished cards; their sum is `labour`.
  labourAssembly: number | null;
  labourSemis: number | null;
  labour: number | null;
  total: number | null;
  foodCostPct: number | null;
  status: CostResult['status'];
  partial: boolean;
  suggestedGross: number | null;
  // cost = materials per slice; total = materials + labour per slice (null without a labour rate).
  perSlice: { cost: number | null; total: number | null; price: number | null };
  unpricedIds: string[];
  // Lines with no grams at all (no reference grams, nothing typed): counted as 0 g, so the cost is partial.
  missingLines: number;
}

export function cakeTotals(cake: Cake, tables: CostTables): CakeTotals {
  const product = cakeProduct(cake);
  const pc = productionCost(product, tables);
  const cost = costProduct(product, tables);
  const labour = pc.labourUnitCost;
  const labourAssembly = labourBatchCost(product, tables);
  const labourSemis = labour === null ? null : roundTo(labour - (labourAssembly ?? 0), 4);
  // A card with no price (or only a partial one, or gone) makes the cost incomplete: name it.
  const unpricedIds: string[] = [];
  for (const component of product.components) {
    if (component.kind !== 'semi') continue;
    if (componentLineCost(component, tables).reason !== null) unpricedIds.push(component.productId);
  }
  // ⚠️ A figure shown alone is ALWAYS the materials (the step-1 rule, PR #589): the slice's `cost` must not mean
  // «materials + labour» for a manager and «materials» for an employee who cannot read the rate. The total is apart.
  const missingLines = resolveLines(cake).filter(line => line.missing).length;
  const perSliceOf = (value: number | null) => (value === null ? null : roundTo(value / cake.slices, 4));
  return {
    product,
    materials: pc.unitCost,
    labourAssembly,
    labourSemis,
    labour,
    total: pc.totalUnitCost,
    foodCostPct: cost.foodCostPct,
    status: cost.status,
    // ⚠️ A line with no grams counts as 0 g and is left out of the product: the cost is then incomplete, never «cheap».
    partial: pc.partial || missingLines > 0,
    suggestedGross: suggestedGrossPrice({ unitCost: pc.unitCost, vatRate: product.vatRate, targetPct: product.foodCostTarget }),
    perSlice: {
      cost: perSliceOf(pc.unitCost),
      total: perSliceOf(pc.totalUnitCost),
      price: cake.sellingPrice === null ? null : roundTo(cake.sellingPrice / cake.slices, 4),
    },
    unpricedIds,
    missingLines,
  };
}

// ── «What you need» ──────────────────────────────────────────────────────────

export interface NeedSemi {
  productId: string;
  name: string;
  // What comes out of the oven and goes into the cakes.
  readyKg: number;
  lossPct: number | null;
  // What to make raw so that `readyKg` comes out; null while the card's weights say nothing.
  prepareKg: number | null;
}

export interface NeedIngredient {
  key: string;
  kind: 'ingredient' | 'piece';
  name: string;
  kg: number | null;
  pcs: number | null;
  from: string[];
}

export interface CakeNeeds {
  semis: NeedSemi[];
  ingredients: NeedIngredient[];
  // Cards that cannot be opened into ingredients because they have no price yet (costPerKg opens only priced cards).
  notOpened: { productId: string; name: string }[];
}

function tableGet(table: unknown, id: string): Loose | null {
  if (!table) return null;
  const t = table as { get?: unknown } & Loose;
  const found = typeof t.get === 'function' ? (t.get as (id: string) => unknown).call(table, id) : t[id];
  return isObject(found) ? found : null;
}

// What to buy and make for `count` cakes made from `product` (cakeProduct, or a quote's copy of it).
export function cakeNeeds(product: Product, tables: CostTables, count: number): CakeNeeds {
  const n = Number.isFinite(count) ? clamp(Math.floor(count), 1, 99) : 1;
  const semis: NeedSemi[] = [];
  const notOpened: { productId: string; name: string }[] = [];
  const merged = new Map<string, NeedIngredient>();

  for (const component of product.components) {
    if (component.kind !== 'semi') continue;
    const card = tableGet(tables.products, component.productId);
    if (!card) continue; // gone: the cost block already says so, and it has no name to show
    const name = String(card.name ?? '').trim();
    const readyKg = component.qtyKg * n;
    const withId = { ...card, id: component.productId };

    const cooking = productCooking(withId, tables);
    semis.push({
      productId: component.productId,
      name,
      readyKg,
      lossPct: cooking.lossPct,
      prepareKg: cooking.outputKg !== null && cooking.outputKg > 0 ? readyKg * cooking.rawTotalKg / cooking.outputKg : null,
    });

    const perKg = costPerKg(withId, tables, { packaging: false });
    if (perKg.total === null || perKg.rows.length === 0) {
      notOpened.push({ productId: component.productId, name });
      continue;
    }
    for (const row of perKg.rows) {
      if (row.kind === 'packaging') continue;
      const kg = row.kg === null ? null : row.kg * readyKg;
      const pcs = row.pcs === null ? null : row.pcs * readyKg;
      const known = merged.get(row.key);
      if (!known) {
        merged.set(row.key, { key: row.key, kind: row.kind, name: row.name, kg, pcs, from: [name] });
        continue;
      }
      if (kg !== null) known.kg = (known.kg ?? 0) + kg;
      if (pcs !== null) known.pcs = (known.pcs ?? 0) + pcs;
      if (!known.from.includes(name)) known.from.push(name);
    }
  }

  const ingredients = [...merged.values()].sort((a, b) => (b.kg ?? -1) - (a.kg ?? -1));
  return { semis, ingredients, notOpened };
}

// ── What the screens draw ────────────────────────────────────────────────────

export interface CakeGeometryTier {
  index: number;
  diameterCm: number;
  discs: number;
  discHeightCm: number;
  parts: Record<CakePart, { productIds: string[]; grams: number }>;
}

export interface CakeGeometry {
  tiers: CakeGeometryTier[];
}

// The ONE description of the cake the 2D drawing (and later the 3D one) is made from.
export function cakeGeometry(cake: Cake): CakeGeometry {
  const resolved = resolveLines(cake);
  const diameters = tierDiameters(cake.diameterCm, cake.tiers);
  return {
    tiers: diameters.map((diameterCm, index) => {
      const parts = {} as CakeGeometryTier['parts'];
      for (const part of CAKE_PARTS) {
        const mine = resolved.filter(line => line.tier === index && line.part === part);
        parts[part] = { productIds: mine.map(line => line.productId), grams: mine.reduce((sum, line) => sum + line.grams, 0) };
      }
      return { index, diameterCm, discs: cake.discs, discHeightCm: cake.ref?.discHeightCm ?? DEFAULT_DISC_HEIGHT_CM, parts };
    }),
  };
}
