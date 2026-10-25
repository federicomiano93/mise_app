// Unit tests for the Calculator's data model (P15 — the owner cannot read code, so these tests are the safety
// net), run against BOTH implementations: the TypeScript port in shared/ and js/calculator-config.js, which
// the live app uses today. Ported from tests/calculator-config.test.mjs; the two must stay equal until the
// switch to Mise 2. A product belongs to the CLIENT that orders it: clients[].products[], with quantities per
// (client, product). They lock in:
//   • the shape and its read helpers,
//   • the dough math (Σ qty×weight) still matching the legacy formulas,
//   • two clients ordering the same thing keeping two independent quantities,
//   • the migration off the shared catalogue — and above all that it PRESERVES every product id, because the
//     divisor ticks, the WhatsApp lists, the saved log rows and the typed quantities all key by it,
//   • migration of the oldest per-tab shape,
//   • divisor / crate / WhatsApp resolution.
//
// calculator-config.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also exports
// `orderPrefillLabel` (it looks a word up in the interface dictionary). The save path (`reconcileConfigWrite`,
// `saveFailureKey`, step 3c-2) is ported: tests/config-reconcile.test.mjs and the saveFailureKey half of
// tests/calculator-save-failure.test.mjs run below against both files. The last block of this file stands in for what pairing would have
// checked: the same names, the same constants, the same frozen-ness, the same function shapes.
//
// PORTED from tests/calculator-config.test.mjs: all 73 of its tests. Added: the two words that come in as
// arguments (`formatGrams`' locale, `normalizeConfig`' market title), and the names / constants / shapes
// block.
//
// ⚠️ THE BAKERY'S DATA IS A FIXTURE, NOT THE APP'S DEFAULT (13 Aug 2026): tests/fixtures/bakery-config.mjs
// holds one customer's clients, products and formulas, and the assertions run through them. It is read from
// there, never copied.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-config';
import * as legacyJs from '../../js/calculator-config.js';
import { BAKERY_CONFIG as bakeryFixture } from '../../tests/fixtures/bakery-config.mjs';

const legacy = legacyJs as unknown as typeof ported;

// The fixture and the configs the tests build are plain data in many shapes (current, migrated, junk): they
// are handed to functions that read ANY value, so they are typed loosely here.
type Loose = any;
const BAKERY_CONFIG: Loose = bakeryFixture;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const {
    getOrderPrefillWindow, isFreeLineId, ORDER_PREFILL_WINDOWS, ORDER_PREFILL_LABELS, pairId, computeTarget,
    clampWeight, doughExtraGrams, getTabProducts, getClients, getClientById, getProducts, getProductById,
    getAllProducts, getWhatsappLists, getWhatsappClients, resolveListClients, resolveDirectClient,
    isExtraDoughEnabled, getDivisorProducts, getDivisorIncluded, isInDivisor, divisorTotal, splitDough,
    clampCratePerBox, isCrateEnabled, getCratePerBox, crateCount, CRATE_PERBOX_MIN, CRATE_PERBOX_MAX,
    CRATE_PERBOX_DEFAULT, WEIGHT_MIN, WEIGHT_MAX, EXTRA_MAX_G,
  } = m as unknown as Record<string, Loose>;
  const normalizeConfig = (raw: unknown): Loose => m.normalizeConfig(raw);

  // Helper: build a getQty(qtyId) function from a plain { qtyId: qty } map.
  const qtyFrom = (map: Record<string, number>) => (id: string): number => map[id] || 0;

  // ── Catalogue + tab view ──────────────────────────────────────────────────────

  test('the default config gives each client its own products (10 in all)', () => {
    expect(getProducts(BAKERY_CONFIG).length).toBe(10);
    expect(getClients(BAKERY_CONFIG).length).toBe(4);
    // There is no shared catalogue any more: every product sits under exactly one client.
    expect('products' in BAKERY_CONFIG).toBe(false);
    for (const p of getProducts(BAKERY_CONFIG)) {
      expect(p.clientId, p.name + ' knows which client orders it').toBeTruthy();
      expect(p.name && p.recipeId && p.weight > 0, p.name + ' is fully described').toBeTruthy();
    }
  });

  test('getTabProducts is a filtered view: one row per (client, product) of that recipe', () => {
    expect(getTabProducts(BAKERY_CONFIG, 'focaccia').map((p: Loose) => p.id)).toStrictEqual(['f-pizze', 'f-focacce', 'f-ciabatta', 'f-trayfocaccia', 'f-panini']);
    expect(getTabProducts(BAKERY_CONFIG, 'brioche').map((p: Loose) => p.id)).toStrictEqual(['b-burgerbuns', 'b-subrolls', 'b-bun', 'b-rolls']);
    expect(getTabProducts(BAKERY_CONFIG, 'sourdough').map((p: Loose) => p.id)).toStrictEqual(['s-loaf']);
  });

  test('each tab row carries its client, weight, kind, crate and a per-pair qtyId', () => {
    const ciabatta = getTabProducts(BAKERY_CONFIG, 'focaccia').find((p: Loose) => p.id === 'f-ciabatta');
    expect(ciabatta.clientName).toBe('Client 1');
    expect(ciabatta.clientId).toBe('c-client-1');
    expect(ciabatta.weight).toBe(160);
    expect(ciabatta.kind).toBe('dropdown');
    expect(ciabatta.crate.show).toBe(true);
    expect(ciabatta.qtyId).toBe(pairId('c-client-1', 'f-ciabatta'));
  });

  test('focaccia target matches the legacy hardcoded formula (products only)', () => {
    const q = {
      [pairId('c-bakery', 'f-pizze')]: 10,
      [pairId('c-bakery', 'f-focacce')]: 5,
      [pairId('c-client-1', 'f-ciabatta')]: 40,
      [pairId('c-client-2', 'f-trayfocaccia')]: 3,
      [pairId('c-client-3', 'f-panini')]: 24,
    };
    const legacy = 10 * 210 + 5 * 175 + 40 * 160 + 3 * 1750 + 24 * 115;
    expect(computeTarget(BAKERY_CONFIG, 'focaccia', qtyFrom(q))).toBe(legacy);
  });

  test('brioche target matches the legacy hardcoded formula (products only)', () => {
    const q = {
      [pairId('c-client-1', 'b-burgerbuns')]: 50,
      [pairId('c-client-1', 'b-subrolls')]: 30,
      [pairId('c-client-2', 'b-bun')]: 20,
      [pairId('c-client-2', 'b-rolls')]: 15,
    };
    const legacy = 50 * 85 + 30 * 125 + 20 * 75 + 15 * 65;
    expect(computeTarget(BAKERY_CONFIG, 'brioche', qtyFrom(q))).toBe(legacy);
  });

  test('sourdough target matches loaves × default loaf weight (900 g)', () => {
    const q = { [pairId('c-client-2', 's-loaf')]: 12 };
    expect(computeTarget(BAKERY_CONFIG, 'sourdough', qtyFrom(q))).toBe(12 * 900);
  });

  test('empty quantities give zero dough', () => {
    expect(computeTarget(BAKERY_CONFIG, 'focaccia', () => 0)).toBe(0);
    expect(computeTarget(BAKERY_CONFIG, 'brioche', () => 0)).toBe(0);
    expect(computeTarget(BAKERY_CONFIG, 'sourdough', () => 0)).toBe(0);
  });

  test('per-pair quantities: the SAME product on two clients has two independent boxes', () => {
    // The new headline capability: one catalogue product, ordered by two clients, each
    // with its own quantity — two rows, two qtyIds, summed independently.
    // Two clients holding their own copy — deliberately sharing one id, as the migration
    // from the shared catalogue produces.
    const config = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [
        { id: 'cA', name: 'A', products: [{ id: 'p1', name: 'Ciabatta', recipeId: 'focaccia', weight: 150, kind: 'number' }] },
        { id: 'cB', name: 'B', products: [{ id: 'p1', name: 'Ciabatta', recipeId: 'focaccia', weight: 150, kind: 'number' }] },
      ],
    };
    const rows = getTabProducts(config, 'focaccia');
    expect(rows.length).toBe(2);
    expect(rows.map((r: Loose) => r.clientName)).toStrictEqual(['A', 'B']);
    const q = { [pairId('cA', 'p1')]: 10, [pairId('cB', 'p1')]: 4 };
    expect(computeTarget(config, 'focaccia', qtyFrom(q))).toBe(10 * 150 + 4 * 150);
  });

  test('per-client kind: the same product can be a dropdown for one client, a number for another', () => {
    const config = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [
        { id: 'cA', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100, kind: 'dropdown' }] },
        { id: 'cB', name: 'B', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100, kind: 'number' }] },
      ],
    };
    const rows = getTabProducts(config, 'focaccia');
    expect(rows.find((r: Loose) => r.clientId === 'cA').kind).toBe('dropdown');
    expect(rows.find((r: Loose) => r.clientId === 'cB').kind).toBe('number');
  });

  test('a tab view only includes products of that recipe', () => {
    const config = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'Mixed', products: [
        { id: 'pf', name: 'F', recipeId: 'focaccia',  weight: 100, kind: 'number' },
        { id: 'pb', name: 'B', recipeId: 'brioche',   weight: 200, kind: 'number' },
        { id: 'ps', name: 'S', recipeId: 'sourdough', weight: 300, kind: 'number' },
      ] }],
    };
    expect(getTabProducts(config, 'focaccia').map((p: Loose) => p.id)).toStrictEqual(['pf']);
    expect(getTabProducts(config, 'brioche').map((p: Loose) => p.id)).toStrictEqual(['pb']);
    const q = { [pairId('c1', 'pf')]: 1, [pairId('c1', 'pb')]: 1, [pairId('c1', 'ps')]: 1 };
    expect(computeTarget(config, 'brioche', qtyFrom(q))).toBe(200);
  });

  test('getTabProducts tolerates a missing or malformed config', () => {
    expect(getTabProducts({}, 'focaccia')).toStrictEqual([]);
    expect(getTabProducts({ clients: 'oops' }, 'focaccia')).toStrictEqual([]);
    expect(getTabProducts(null, 'focaccia')).toStrictEqual([]);
  });

  test('a client product with no id is dropped rather than shown as a blank row', () => {
    const config = normalizeConfig({
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'A', products: [
        { id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 },
        { name: 'no id at all', recipeId: 'focaccia', weight: 100 },
      ] }],
    });
    expect(getTabProducts(config, 'focaccia').map((p: Loose) => p.id)).toStrictEqual(['p1']);
  });

  // ── clampWeight / NaN safety ───────────────────────────────────────────────────

  test('clampWeight blocks absurd typos and non-numbers', () => {
    expect(clampWeight(150)).toBe(150);
    expect(clampWeight(99999)).toBe(WEIGHT_MAX);
    expect(clampWeight(0)).toBe(WEIGHT_MIN);
    expect(clampWeight(-5)).toBe(WEIGHT_MIN);
    expect(clampWeight('abc')).toBe(WEIGHT_MIN);
    expect(clampWeight(undefined)).toBe(WEIGHT_MIN);
  });

  test('computeTarget never produces NaN even with a corrupt weight', () => {
    const config = {
      products: [{ id: 'p1', name: 'Bad', recipeId: 'focaccia', weight: 'oops' }],
      clients: [{ id: 'c1', name: 'X', items: [{ productId: 'p1', kind: 'number' }] }],
    };
    expect(Number.isFinite(computeTarget(config, 'focaccia', () => 5))).toBeTruthy();
  });

  test('doughExtraGrams: kg multiplies, grams pass through, junk is zero, capped', () => {
    expect(doughExtraGrams(1, 'kg')).toBe(1000);
    expect(doughExtraGrams(1.5, 'kg')).toBe(1500);
    expect(doughExtraGrams(1500, 'g')).toBe(1500);
    expect(doughExtraGrams(0, 'g')).toBe(0);
    expect(doughExtraGrams(-5, 'g')).toBe(0);
    expect(doughExtraGrams('abc', 'kg')).toBe(0);
    expect(doughExtraGrams(999999, 'kg')).toBe(EXTRA_MAX_G);
  });

  // ── Catalogue read helpers ─────────────────────────────────────────────────────

  test('getProductById finds a catalogue product; getAllProducts tags ordering clients', () => {
    expect(getProductById(BAKERY_CONFIG, 's-loaf').name).toBe('Loaf');
    expect(getProductById(BAKERY_CONFIG, 'nope')).toBe(null);
    const all = getAllProducts(BAKERY_CONFIG);
    expect(all.length).toBe(10);
    const loaf = all.find((p: Loose) => p.id === 's-loaf');
    expect(loaf.clientNames).toStrictEqual(['Client 2']);
    expect(loaf.clientCount).toBe(1);
    const pizze = all.find((p: Loose) => p.id === 'f-pizze');
    expect(pizze.clientNames).toStrictEqual(['Bakery']);
  });

  test('two clients holding the same product are two separate entries', () => {
    // They may share an id (that is what the migration produces), but each is its own
    // product, owned by its own client — changing one must never move the other.
    const config = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [
        { id: 'cA', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }] },
        { id: 'cB', name: 'B', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }] },
      ],
    };
    const all = getAllProducts(config);
    expect(all.length).toBe(2);
    expect(all.map((p: Loose) => p.clientName)).toStrictEqual(['A', 'B']);
    expect(all.map((p: Loose) => p.clientCount)).toStrictEqual([1, 1]);
  });

  test('getClientById / getWhatsappLists / resolveListClients on the default config', () => {
    expect(getClientById(BAKERY_CONFIG, 'c-client-2').name).toBe('Client 2');
    expect(getClientById(BAKERY_CONFIG, 'nope')).toBe(null);
    const lists = getWhatsappLists(BAKERY_CONFIG);
    expect(lists.length).toBe(1);
    expect(lists[0].title).toBe('Market order');
    const resolved = resolveListClients(BAKERY_CONFIG, lists[0]);
    expect(resolved.map((r: Loose) => r.client.id)).toStrictEqual(['c-client-1', 'c-client-2', 'c-client-3']);
    const client1 = resolved.find((r: Loose) => r.client.id === 'c-client-1');
    expect(client1.products.map((p: Loose) => p.id)).toStrictEqual(['f-ciabatta', 'b-burgerbuns', 'b-subrolls']);
  });

  test('a WhatsApp list entry can still attach a product another client owns', () => {
    // The lists stay decoupled: what you send a client is chosen by hand, not derived
    // from what it orders. A product it does not own resolves globally rather than
    // silently dropping a line from the message.
    const config = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [
        { id: 'cA', name: 'A', products: [{ id: 'pA', name: 'Loaf', recipeId: 'sourdough', weight: 900 }] },
        { id: 'cB', name: 'B', products: [{ id: 'pB', name: 'Panini', recipeId: 'focaccia', weight: 130 }] },
      ],
      whatsappLists: [{ id: 'wl1', title: 'Order', clients: [{ clientId: 'cB', products: ['pB', 'pA'] }] }],
    };
    const resolved = resolveListClients(config, config.whatsappLists[0]);
    expect(resolved.length).toBe(1);
    expect(resolved[0].products.map((p: Loose) => p.name)).toStrictEqual(['Panini', 'Loaf']);
  });

  test('a shared id resolves inside the entry OWN client, not the other copy', () => {
    // Both clients hold id p1, but with different names after one was renamed. The list
    // belongs to B, so it must print B's name.
    const config = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [
        { id: 'cA', name: 'A', products: [{ id: 'p1', name: 'Loaves of bread', recipeId: 'sourdough', weight: 900 }] },
        { id: 'cB', name: 'B', products: [{ id: 'p1', name: 'Sourdough loaf', recipeId: 'sourdough', weight: 900 }] },
      ],
      whatsappLists: [{ id: 'wl1', title: 'Order', clients: [{ clientId: 'cB', products: ['p1'] }] }],
    };
    const resolved = resolveListClients(config, config.whatsappLists[0]);
    expect(resolved[0].products.map((p: Loose) => p.name)).toStrictEqual(['Sourdough loaf']);
  });

  test('direct WhatsApp clients: typed name + products resolved by id', () => {
    expect(getWhatsappClients(BAKERY_CONFIG)).toStrictEqual([]);
    const config = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'cA', name: 'A', products: [{ id: 'pA', name: 'Loaf', recipeId: 'sourdough', weight: 900 }] }],
      whatsappClients: [{ id: 'wc1', name: 'Walk-in', products: ['pA', 'ghost'] }],
    };
    const resolved = resolveDirectClient(config, getWhatsappClients(config)[0]);
    expect(resolved.name).toBe('Walk-in');
    expect(resolved.products.map((p: Loose) => p.name)).toStrictEqual(['Loaf']); // ghost pruned
  });

  // ── Normalisation (new catalogue shape) ────────────────────────────────────────

  test('normalizeConfig clamps weights, re-homes an unknown recipe, drops junk products', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'X', products: [
        { id: 'p1', name: 'Big', recipeId: 'brioche', weight: 99999 },  // weight capped
        { id: 'p2', name: 'Bad', recipeId: 'weird',   weight: 'oops' }, // recipe re-homed, weight->MIN
        { notAnId: true },                                              // dropped
      ] }],
    };
    const norm = normalizeConfig(raw);
    expect(getProducts(norm).length).toBe(2);
    expect(getProductById(norm, 'p1').weight).toBe(WEIGHT_MAX);
    expect(getProductById(norm, 'p1').recipeId, 'a real recipe is left alone').toBe('brioche');
    expect(getProductById(norm, 'p2').recipeId, 'an unknown one falls to the first').toBe('focaccia');
    expect(getProductById(norm, 'p2').weight).toBe(WEIGHT_MIN);
  });

  test('a product on a recipe the owner CREATED is not dragged onto Focaccia', () => {
    // The recipe list is configurable, so validating against the three shipped ids
    // silently moved every product on a custom recipe.
    const raw = {
      clients: [{ id: 'c1', name: 'X', products: [{ id: 'p1', name: 'Ciabatta', recipeId: 'r-mine', weight: 150 }] }],
      recipes: [
        { id: 'focaccia', name: 'Focaccia', ingredients: [{ label: 'Flour', grams: 100 }] },
        { id: 'r-mine', name: 'My dough', ingredients: [{ label: 'Flour', grams: 100 }] },
      ],
    };
    const norm = normalizeConfig(raw);
    expect(getProductById(norm, 'p1').recipeId).toBe('r-mine');
    expect(getTabProducts(norm, 'r-mine').map((p: Loose) => p.id)).toStrictEqual(['p1']);
  });

  test('one client never holds the same product twice (first wins)', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'X', products: [
        { id: 'p1', name: 'First', recipeId: 'focaccia', weight: 100 },
        { id: 'p1', name: 'Dup',   recipeId: 'brioche',  weight: 200 },
      ] }],
    };
    const norm = normalizeConfig(raw);
    expect(getProducts(norm).length).toBe(1);
    expect(getProductById(norm, 'p1').name).toBe('First');
  });

  test('a legacy quantity kind is migrated on a client product too', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'A', products: [
        { id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100, kind: 'ciabatta' },
      ] }],
    };
    const products = getClientById(normalizeConfig(raw), 'c1').products;
    expect(products.length).toBe(1);
    expect(products[0].kind).toBe('dropdown'); // ciabatta -> dropdown
  });

  test('a product crate box is kept and clamped', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100, kind: 'number', crate: { show: true, perBox: 0 } }] }],
    };
    const row = getTabProducts(normalizeConfig(raw), 'focaccia')[0];
    expect(isCrateEnabled(row)).toBe(true);
    expect(getCratePerBox(row)).toBe(CRATE_PERBOX_MIN); // 0 clamped up
  });

  test('normalizeConfig keeps direct WhatsApp clients, pruning their dead product ids', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }] }],
      whatsappClients: [{ id: 'wc1', name: 'Custom', products: ['p1', 'gone'] }, { notAnObject: true }],
    };
    const norm = normalizeConfig(raw);
    expect(norm.whatsappClients.length).toBe(1);
    expect(norm.whatsappClients[0].name).toBe('Custom');
    expect(norm.whatsappClients[0].products).toStrictEqual(['p1']);
  });

  test('normalizeConfig prunes WhatsApp list entries for dead clients/products', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }] }],
      whatsappLists: [{ id: 'wl1', title: 'L', clients: [
        { clientId: 'c1', products: ['p1', 'ghost'] },
        { clientId: 'gone', products: ['p1'] },
      ] }],
    };
    const norm = normalizeConfig(raw);
    expect(norm.whatsappLists[0].clients.length).toBe(1);
    // `extras` (free lines typed by hand) is always present, empty when there are none.
    expect(norm.whatsappLists[0].clients[0]).toStrictEqual({ clientId: 'c1', products: ['p1'], extras: [] });
  });

  // ⚠️ REWRITTEN 13 Aug 2026, AND THE NEW EXPECTATION IS THE FEATURE. This used to
  // assert that garbage input produced TEN PRODUCTS — The Italian Club Bakery's ten,
  // which is what the default held. That is exactly what a customer who bought the
  // app used to be shown before their own document arrived.
  //
  // Nonsense in must still not crash and must still produce a usable shape; it must
  // simply produce an EMPTY one. Anything else is inventing somebody's data.
  test('missing or garbage input gives an empty config, never somebody else’s', () => {
    for (const bad of [null, 'oops', {}, 42, [], undefined]) {
      const cfg = normalizeConfig(bad);
      expect(getProducts(cfg).length, `${JSON.stringify(bad)} must produce no products`).toBe(0);
      expect(cfg.clients, 'and no clients').toStrictEqual([]);
      expect(cfg.recipes, 'and no recipes').toStrictEqual([]);
      // Still a usable shape: the settings are present, so no screen divides by
      // undefined on a brand-new venue.
      expect(cfg.logRetentionHours).toBe(24);
      expect(cfg.orderPrefillWindow).toBe('both');
    }
  });

  test('isExtraDoughEnabled defaults to true and honours an explicit false', () => {
    expect(isExtraDoughEnabled(BAKERY_CONFIG, 'focaccia')).toBe(true);
    expect(isExtraDoughEnabled({}, 'brioche')).toBe(true);
    expect(isExtraDoughEnabled(null, 'sourdough')).toBe(true);
    expect(isExtraDoughEnabled({ extraDough: { focaccia: false } }, 'focaccia')).toBe(false);
  });

  // ── Migration: the shared catalogue → products owned by their client ──────────

  test('migration: a catalogue document becomes products owned by their client', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      products: [
        { id: 'p1', name: 'Ciabatta', recipeId: 'focaccia',  weight: 160 },
        { id: 'p2', name: 'Panini',   recipeId: 'focaccia',  weight: 115 },
        { id: 'p3', name: 'Loaf',     recipeId: 'sourdough', weight: 900 },
      ],
      clients: [
        { id: 'c1', name: 'A', items: [
          { productId: 'p1', kind: 'ciabatta', crate: { show: true, perBox: 20 } },
          { productId: 'p2', kind: 'panini' },
        ] },
        { id: 'c2', name: 'B', items: [{ productId: 'p3', kind: 'number' }] },
      ],
    };
    const norm = normalizeConfig(raw);
    expect('products' in norm, 'the shared catalogue is gone').toBe(false);
    expect(getClientById(norm, 'c1').products.map((p: Loose) => p.id)).toStrictEqual(['p1', 'p2']);
    expect(getClientById(norm, 'c2').products.map((p: Loose) => p.id)).toStrictEqual(['p3']);
    // Name, recipe and weight came from the catalogue; kind and crate from the item.
    const ciabatta = getClientById(norm, 'c1').products[0];
    expect(ciabatta.name).toBe('Ciabatta');
    expect(ciabatta.weight).toBe(160);
    expect(ciabatta.recipeId).toBe('focaccia');
    expect(ciabatta.kind).toBe('dropdown');       // legacy 'ciabatta' migrated
    expect(ciabatta.crate.show).toBe(true);
    expect(getClientById(norm, 'c1').products[1].kind).toBe('number'); // legacy 'panini'
  });

  test('migration: a product ordered by TWO clients keeps ONE id in both copies', () => {
    // The load-bearing promise. Four things key by that id — divisor ticks, WhatsApp
    // lists, saved log rows and the typed quantities — and a fresh id for the second
    // client would quietly cut all four.
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      products: [{ id: 'shared', name: 'Loaves of bread', recipeId: 'sourdough', weight: 900 }],
      clients: [
        { id: 'cA', name: 'CLIENT A', items: [{ productId: 'shared', kind: 'number' }] },
        { id: 'cB', name: 'CLIENT B', items: [{ productId: 'shared', kind: 'number' }] },
      ],
      divisorIncluded: { sourdough: ['shared'] },
      whatsappLists: [{ id: 'wl', title: 'Morning list', clients: [{ clientId: 'cB', products: ['shared'] }] }],
    };
    const norm = normalizeConfig(raw);
    expect(getClientById(norm, 'cA').products.map((p: Loose) => p.id)).toStrictEqual(['shared']);
    expect(getClientById(norm, 'cB').products.map((p: Loose) => p.id)).toStrictEqual(['shared']);
    expect(getDivisorIncluded(norm, 'sourdough')).toStrictEqual(['shared']);
    const resolved = resolveListClients(norm, norm.whatsappLists[0]);
    expect(resolved[0].products.map((p: Loose) => p.name)).toStrictEqual(['Loaves of bread']);
    // The two quantity boxes keep the SAME keys the app already stored.
    expect(getTabProducts(norm, 'sourdough').map((r: Loose) => r.qtyId)).toStrictEqual([pairId('cA', 'shared'), pairId('cB', 'shared')]);
  });

  test('migration: the stale nested copy left by the catalogue era is ignored', () => {
    // v1.5.0 kept clients[].products as a revert window while maintaining items[].
    // Reading it instead of items[] would resurrect long-deleted products.
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      products: [{ id: 'live', name: 'Live', recipeId: 'focaccia', weight: 100 }],
      clients: [{
        id: 'c1', name: 'A',
        items: [{ productId: 'live', kind: 'number' }],
        products: [{ id: 'stale', name: 'Deleted ages ago', recipeId: 'focaccia', weight: 999 }],
      }],
    };
    expect(getClientById(normalizeConfig(raw), 'c1').products.map((p: Loose) => p.id)).toStrictEqual(['live']);
  });

  test('migration: an item pointing at a product that no longer exists is dropped', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      products: [{ id: 'p1', name: 'X', recipeId: 'focaccia', weight: 100 }],
      clients: [{ id: 'c1', name: 'A', items: [{ productId: 'p1', kind: 'number' }, { productId: 'gone', kind: 'number' }] }],
    };
    expect(getClientById(normalizeConfig(raw), 'c1').products.map((p: Loose) => p.id)).toStrictEqual(['p1']);
  });

  test('migration: re-normalising the migrated config changes nothing', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      products: [{ id: 'p1', name: 'Pizzas', recipeId: 'focaccia', weight: 210 }],
      clients: [{ id: 'c1', name: 'A', items: [{ productId: 'p1', kind: 'number' }] }],
    };
    const once = normalizeConfig(raw);
    const twice = normalizeConfig(JSON.parse(JSON.stringify(once)));
    expect(twice.clients).toStrictEqual(once.clients);
  });

  test('rollback safety: the saved shape is the one older code migrates FROM', () => {
    // A document written now has clients[].products and no top-level products[] —
    // exactly the pre-catalogue shape, so a phone still on an older version reads it
    // correctly instead of finding an empty address book.
    const saved = normalizeConfig({
      products: [{ id: 'p1', name: 'Pizzas', recipeId: 'focaccia', weight: 210 }],
      clients: [{ id: 'c1', name: 'A', items: [{ productId: 'p1', kind: 'number' }] }],
    });
    expect('products' in saved).toBe(false);
    expect(saved.clients[0].products[0].name).toBe('Pizzas');
    expect(saved.clients[0].products[0].weight).toBe(210);
  });

  test('migration math equals the legacy formula after migrating', () => {
    const norm = normalizeConfig({
      recipes: BAKERY_CONFIG.recipes,
      products: [{ id: 'f-pizze', name: 'Pizzas', recipeId: 'focaccia', weight: 210 }],
      clients: [{ id: 'c1', name: 'A', items: [{ productId: 'f-pizze', kind: 'number' }] }],
    });
    expect(computeTarget(norm, 'focaccia', qtyFrom({ [pairId('c1', 'f-pizze')]: 7 }))).toBe(7 * 210);
  });

  // ── Migration: oldest per-tab + market shape ───────────────────────────

  test('migration: the oldest per-tab + market shape becomes client-owned products', () => {
    const legacy = {
      recipes: BAKERY_CONFIG.recipes,
      focaccia: { clients: [
        { id: 'f-c1', name: 'Client 1', products: [{ id: 'f-cia', name: 'Ciabatta', weight: 160, kind: 'ciabatta' }] },
      ] },
      brioche: { clients: [
        { id: 'b-c1', name: 'Client 1', products: [{ id: 'b-bb', name: 'Burger buns', weight: 85, kind: 'number' }] },
      ] },
      market: { lists: [
        { id: 'l1', title: 'Market order', clients: [{ id: 'm-1', name: 'Client 1', products: [{ id: 'om-x', name: 'X' }] }] },
      ] },
    };
    const norm = normalizeConfig(legacy);
    // "Client 1" appears three times -> one merged client holding both products.
    expect(getClients(norm).length).toBe(1);
    const client = getClients(norm)[0];
    expect(client.name).toBe('Client 1');
    expect(client.products.map((p: Loose) => p.id).sort()).toStrictEqual(['b-bb', 'f-cia']);
    expect(getProductById(norm, 'f-cia').recipeId).toBe('focaccia');
    expect(getProductById(norm, 'b-bb').recipeId).toBe('brioche');
    expect(norm.whatsappLists.length).toBe(1);
    expect(norm.whatsappLists[0].clients[0].clientId).toBe(client.id);
    expect(norm.whatsappLists[0].clients[0].products.sort()).toStrictEqual(['b-bb', 'f-cia']);
  });

  // ── Divisor (display-only crate split) ─────────────────────────────────────────

  test('divisor includes NOTHING by default (opt-in)', () => {
    const q = { [pairId('c-bakery', 'f-pizze')]: 10 };
    expect(divisorTotal(BAKERY_CONFIG, 'focaccia', qtyFrom(q))).toBe(0);
    expect(getDivisorProducts(BAKERY_CONFIG, 'focaccia').length).toBe(0);
    expect(isInDivisor(BAKERY_CONFIG, 'focaccia', 'f-panini')).toBe(false);
  });

  test('divisor sums only ticked products; it sums across every client of a ticked product', () => {
    const config = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [
        { id: 'cA', name: 'A', products: [
          { id: 'p1', name: 'Panini', recipeId: 'focaccia', weight: 100, kind: 'number' },
          { id: 'p2', name: 'Pizza',  recipeId: 'focaccia', weight: 200, kind: 'number' },
        ] },
        { id: 'cB', name: 'B', products: [
          { id: 'p1', name: 'Panini', recipeId: 'focaccia', weight: 100, kind: 'number' }, // same id
        ] },
      ],
      divisorIncluded: { focaccia: ['p1'], brioche: [], sourdough: [] },
    };
    const q = {
      [pairId('cA', 'p1')]: 10, [pairId('cA', 'p2')]: 10, [pairId('cB', 'p1')]: 5,
    };
    // p1 ticked -> sum BOTH clients' p1 (10+5)×100; p2 untouched in the divisor.
    expect(divisorTotal(config, 'focaccia', qtyFrom(q))).toBe(15 * 100);
    // The recipe math still sums everything.
    expect(computeTarget(config, 'focaccia', qtyFrom(q))).toBe(10 * 100 + 10 * 200 + 5 * 100);
    expect(getDivisorProducts(config, 'focaccia').map((r: Loose) => r.id)).toStrictEqual(['p1', 'p1']);
  });

  test('splitDough divides into crates, and is safe at the edges', () => {
    expect(splitDough(3000, 2)).toBe(1500);
    expect(splitDough(5000, 4)).toBe(1250);
    expect(splitDough(3000, 0)).toBe(0);
    expect(splitDough(3000, -1)).toBe(0);
    expect(splitDough('abc', 2)).toBe(0);
    expect(splitDough(3000, 'x')).toBe(0);
  });

  test('normalizeConfig prunes divisor inclusions for products that no longer exist', () => {
    const raw = {
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'X', products: [{ id: 'p1', name: 'Panini', recipeId: 'focaccia', weight: 100 }] }],
      divisorIncluded: { focaccia: ['p1', 'ghost'], brioche: ['also-gone'] },
    };
    const norm = normalizeConfig(raw);
    expect(getDivisorIncluded(norm, 'focaccia')).toStrictEqual(['p1']);
    expect(getDivisorIncluded(norm, 'brioche')).toStrictEqual([]);
    expect(getDivisorIncluded(norm, 'sourdough')).toStrictEqual([]);
  });

  // ── Crate boxes (display-only, per association) ─────────────────────────────────

  test('crateCount = quantity ÷ pieces per box, safe at the edges', () => {
    expect(crateCount(40, 20)).toBe(2);
    expect(crateCount(30, 20)).toBe(1.5);
    expect(crateCount(0, 20)).toBe(0);
    expect(crateCount(40, 0)).toBe(0);
    expect(crateCount(-5, 20)).toBe(0);
    expect(crateCount('abc', 20)).toBe(0);
  });

  test('clampCratePerBox keeps sane values and defaults on junk', () => {
    expect(clampCratePerBox(20)).toBe(20);
    expect(clampCratePerBox(0)).toBe(CRATE_PERBOX_MIN);
    expect(clampCratePerBox(99999)).toBe(CRATE_PERBOX_MAX);
    expect(clampCratePerBox('abc')).toBe(CRATE_PERBOX_DEFAULT);
    expect(clampCratePerBox(undefined)).toBe(CRATE_PERBOX_DEFAULT);
  });

  test('crate box is per association: off by default, on only when explicitly enabled', () => {
    expect(isCrateEnabled({ crate: { show: true, perBox: 20 } })).toBe(true);
    expect(isCrateEnabled({ crate: { show: false } })).toBe(false);
    expect(isCrateEnabled({})).toBe(false);
    expect(isCrateEnabled(null)).toBe(false);
    expect(getCratePerBox({ crate: { perBox: 24 } })).toBe(24);
    expect(getCratePerBox({})).toBe(CRATE_PERBOX_DEFAULT);
  });

  test('the default ciabatta association has its crate box enabled (20 pieces)', () => {
    const ciabatta = getTabProducts(BAKERY_CONFIG, 'focaccia').find((p: Loose) => p.id === 'f-ciabatta');
    expect(isCrateEnabled(ciabatta)).toBe(true);
    expect(getCratePerBox(ciabatta)).toBe(20);
  });

  // ── Names carry invisible spaces (A5) ─────────────────────────────────────────
  // A trailing space is invisible in the app AND in the Firebase console, but it shows
  // up the moment the name is used inside a sentence: the log printed
  // "Seeded burger buns : 40 pz". Normalisation runs on BOTH read and save, so cleaning
  // it here fixes what is already stored without touching the database.

  test('names are trimmed on the way in, so a stored trailing space stops showing', () => {
    const norm = normalizeConfig({
      products: [{ id: 'p1', name: '  Seeded burger buns ', recipeId: 'brioche', weight: 80 }],
      clients: [{ id: 'c1', name: ' Bakery  ', items: [{ productId: 'p1', kind: 'number' }] }],
      recipes: [{ id: 'r1', name: '  Brioche ', ingredients: [{ label: ' Flour ', grams: 100 }] }],
      whatsappLists: [{ id: 'wl1', title: '  Market order ', clients: [{ clientId: 'c1', products: ['p1'] }] }],
    });
    expect(getProductById(norm, 'p1').name).toBe('Seeded burger buns');
    expect(getClientById(norm, 'c1').name).toBe('Bakery');
    expect(norm.recipes[0].name).toBe('Brioche');
    expect(norm.recipes[0].ingredients[0].label).toBe('Flour');
    expect(norm.whatsappLists[0].title).toBe('Market order');
  });

  test('the row the log prints has no space before the colon any more', () => {
    const norm = normalizeConfig({
      recipes: BAKERY_CONFIG.recipes,
      products: [{ id: 'p1', name: 'Seeded burger buns ', recipeId: 'focaccia', weight: 80 }],
      clients: [{ id: 'c1', name: 'Bakery', items: [{ productId: 'p1', kind: 'number' }] }],
    });
    const row = getTabProducts(norm, 'focaccia')[0];
    expect(row.name + ': 40 pz').toBe('Seeded burger buns: 40 pz');
  });

  test('a name of ONLY spaces falls back to the placeholder, never to an empty string', () => {
    // The trim has to happen BEFORE the fallback: String(x || 'Product').trim() would
    // let "   " through as "".
    const norm = normalizeConfig({
      products: [{ id: 'p1', name: '   ', recipeId: 'focaccia', weight: 80 }],
      clients: [{ id: 'c1', name: '  ', items: [{ productId: 'p1', kind: 'number' }] }],
      recipes: [{ id: 'r1', name: ' ', ingredients: [{ label: '  ', grams: 1 }] }],
    });
    expect(getProductById(norm, 'p1').name).toBe('Product');
    expect(getClientById(norm, 'c1').name).toBe('Client');
    expect(norm.recipes[0].name).toBe('Recipe');
    expect(norm.recipes[0].ingredients[0].label).toBe('Ingredient');
  });

  test('a missing name still falls back, and nothing throws on junk', () => {
    const norm = normalizeConfig({
      recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', products: [{ id: 'p1', recipeId: 'focaccia', weight: 80 }] }],
    });
    expect(getProductById(norm, 'p1').name).toBe('Product');
    expect(getClientById(norm, 'c1').name).toBe('Client');
  });

  // ── Pausing a product (B2) ────────────────────────────────────────────────────
  // A client that stops ordering something for a while should not have to delete it and
  // rebuild it later. A paused product keeps everything and simply leaves the calculator.

  const paused = (over = {}) => ({
    recipes: BAKERY_CONFIG.recipes,
      clients: [{ id: 'c1', name: 'A', products: [
      { id: 'p1', name: 'Pizzas',    recipeId: 'focaccia', weight: 210, kind: 'number', ...over },
      { id: 'p2', name: 'Focaccias', recipeId: 'focaccia', weight: 175, kind: 'number' },
    ] }],
  });

  test('a paused product has no row and adds no dough', () => {
    const config = normalizeConfig(paused({ active: false }));
    expect(getTabProducts(config, 'focaccia').map((p: Loose) => p.id)).toStrictEqual(['p2']);
    const q = { [pairId('c1', 'p1')]: 100, [pairId('c1', 'p2')]: 2 };
    expect(computeTarget(config, 'focaccia', qtyFrom(q)), 'the paused 100 is ignored').toBe(2 * 175);
  });

  test('a product with NO active field is active — every document in production lacks it', () => {
    const config = normalizeConfig(paused());
    expect(getTabProducts(config, 'focaccia').map((p: Loose) => p.id)).toStrictEqual(['p1', 'p2']);
    expect(getProductById(config, 'p1').active).toBe(true);
  });

  test('pausing survives a save-and-reload round trip', () => {
    const once = normalizeConfig(paused({ active: false }));
    const twice = normalizeConfig(JSON.parse(JSON.stringify(once)));
    expect(getProductById(twice, 'p1').active).toBe(false);
    expect(getTabProducts(twice, 'focaccia').map((p: Loose) => p.id)).toStrictEqual(['p2']);
  });

  test('a paused product keeps its settings, ready to come back untouched', () => {
    const config = normalizeConfig(paused({ active: false, kind: 'dropdown', crate: { show: true, perBox: 24 } }));
    const p = getProductById(config, 'p1');
    expect(p.name).toBe('Pizzas');
    expect(p.weight).toBe(210);
    expect(p.kind).toBe('dropdown');
    expect(p.crate).toStrictEqual({ show: true, perBox: 24 });
  });

  test('the divisor ignores a paused product but KEEPS its tick for when it returns', () => {
    const raw: Loose = paused({ active: false });
    raw.divisorIncluded = { focaccia: ['p1', 'p2'] };
    const config = normalizeConfig(raw);
    expect(getDivisorIncluded(config, 'focaccia'), 'the tick survives').toStrictEqual(['p1', 'p2']);
    expect(getDivisorProducts(config, 'focaccia').map((p: Loose) => p.id), 'but it does not split').toStrictEqual(['p2']);
    const q = { [pairId('c1', 'p1')]: 10, [pairId('c1', 'p2')]: 3 };
    expect(divisorTotal(config, 'focaccia', qtyFrom(q))).toBe(3 * 175);
  });

  test('a paused product still blocks deleting the recipe it belongs to', () => {
    // getProducts is what the recipe editor counts; a paused product is still a product,
    // or deleting its recipe would leave it homeless.
    const config = normalizeConfig(paused({ active: false }));
    expect(getProducts(config).filter((p: Loose) => p.recipeId === 'focaccia').length).toBe(2);
  });

  // ── Which days the WhatsApp order form fills itself from ──────────────────────
  // Stored in the shared config, so every phone in the bakery agrees. The default and
  // the fallback both widen rather than narrow: a missing or corrupt value must never
  // quietly hide a day's work from an order somebody is about to send.

  test('the setting defaults to both days', () => {
    expect(BAKERY_CONFIG.orderPrefillWindow).toBe('both');
    expect(getOrderPrefillWindow(normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [] }))).toBe('both');
  });

  test('each of the three choices survives normalisation', () => {
    for (const w of ORDER_PREFILL_WINDOWS) {
      expect(normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [], orderPrefillWindow: w }).orderPrefillWindow, w).toBe(w);
    }
  });

  test('a value nobody recognises falls back to both, never to nothing', () => {
    for (const bad of [undefined, null, '', 'ieri', 'BOTH', 42, {}, []]) {
      expect(normalizeConfig({ recipes: BAKERY_CONFIG.recipes, clients: [], orderPrefillWindow: bad }).orderPrefillWindow, String(bad)).toBe('both');
    }
  });

  test('the reader tolerates a missing config entirely', () => {
    expect(getOrderPrefillWindow(null)).toBe('both');
    expect(getOrderPrefillWindow(undefined)).toBe('both');
    expect(getOrderPrefillWindow({})).toBe('both');
  });

  test('every choice has wording, or the settings screen shows a blank option', () => {
    for (const w of ORDER_PREFILL_WINDOWS) {
      expect(typeof ORDER_PREFILL_LABELS[w]).toBe('string');
      expect(ORDER_PREFILL_LABELS[w].length > 0, w).toBeTruthy();
    }
  });

  // ── Free lines: things a client buys that the bakery does not calculate ───────
  // A line that exists ONLY in the WhatsApp message. The real case: a client buys
  // loaves cut from the bread baked for ANOTHER client, so the dough is counted once
  // and must not be counted twice — but the line still has to reach the message.

  const FREE_CFG = {
    recipes: BAKERY_CONFIG.recipes,
      clients: [
      { id: 'cA', name: 'CLIENT A', products: [
        { id: 'p1', name: 'Buns', recipeId: 'brioche', weight: 80, kind: 'number' }] },
    ],
    whatsappLists: [{ id: 'wl', title: 'Morning', clients: [
      { clientId: 'cA', products: ['p1'], extras: [{ id: '', name: 'Loaves of bread' }] }] }],
  };

  test('a free line survives normalisation and gets a wx- id', () => {
    const cfg = normalizeConfig(FREE_CFG);
    const extras = cfg.whatsappLists[0].clients[0].extras;
    expect(extras.length).toBe(1);
    expect(extras[0].name).toBe('Loaves of bread');
    expect(isFreeLineId(extras[0].id), extras[0].id).toBeTruthy();
  });

  test('a free line NEVER reaches the dough calculation', () => {
    // The point of the whole design: it is not a product, so there is nothing to count.
    const cfg = normalizeConfig(FREE_CFG);
    expect(getTabProducts(cfg, 'brioche').map((p: Loose) => p.id)).toStrictEqual(['p1']);
    expect(getProducts(cfg).length).toBe(1);
    expect(getProductById(cfg, cfg.whatsappLists[0].clients[0].extras[0].id)).toBe(null);
  });

  test('a free line reaches the message as an ordinary row, after the products', () => {
    const cfg = normalizeConfig(FREE_CFG);
    const [entry] = resolveListClients(cfg, cfg.whatsappLists[0]);
    expect(entry.products.map((p: Loose) => p.name)).toStrictEqual(['Buns', 'Loaves of bread']);
    expect(entry.products[1].free).toBe(true);
  });

  test('a free line id can never collide with a product id', () => {
    // The modal keys its quantity boxes by id; a collision would put one client's
    // typed number onto another row.
    const cfg = normalizeConfig(FREE_CFG);
    const ids = new Set(getProducts(cfg).map((p: Loose) => p.id));
    for (const l of cfg.whatsappLists[0].clients[0].extras) expect(ids.has(l.id)).toBe(false);
  });

  test('two free lines with the same name get different ids', () => {
    // Two inputs sharing an id means getElementById returns the first, so one quantity
    // is read twice and the other silently ignored.
    const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
      { clientId: 'cA', products: [], extras: [{ name: 'Bread' }, { name: 'Bread' }] }] }] });
    const extras = cfg.whatsappLists[0].clients[0].extras;
    expect(extras.length).toBe(2);
    expect(extras[0].id).not.toBe(extras[1].id);
  });

  test('an existing free line KEEPS its id when renamed', () => {
    // The id keys a quantity box. Recomputing it from the new name would move a typed
    // number to a different row mid-edit.
    const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
      { clientId: 'cA', products: [], extras: [{ id: 'wx-loaves-of-bread', name: 'Sourdough loaves' }] }] }] });
    expect(cfg.whatsappLists[0].clients[0].extras[0].id).toBe('wx-loaves-of-bread');
  });

  test('a blank free line is dropped quietly, not refused', () => {
    const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
      { clientId: 'cA', products: ['p1'], extras: [{ name: '   ' }, { name: '' }, null, 'oops'] }] }] });
    expect(cfg.whatsappLists[0].clients[0].extras).toStrictEqual([]);
    expect(cfg.whatsappLists[0].clients[0].products).toStrictEqual(['p1']);
  });

  test('a list entry with only free lines is kept, not treated as empty', () => {
    const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
      { clientId: 'cA', products: [], extras: [{ name: 'Loaves of bread' }] }] }] });
    const [entry] = resolveListClients(cfg, cfg.whatsappLists[0]);
    expect(entry.products.map((p: Loose) => p.name)).toStrictEqual(['Loaves of bread']);
  });

  test('a direct client can carry free lines too', () => {
    const cfg = normalizeConfig({ ...FREE_CFG,
      whatsappClients: [{ id: 'wc', name: 'Market stall', products: [], extras: [{ name: 'Bread' }] }] });
    const resolved = resolveDirectClient(cfg, cfg.whatsappClients[0]);
    expect(resolved.products.map((p: Loose) => p.name)).toStrictEqual(['Bread']);
  });

  test('a direct client that is ONLY free lines is not dropped', () => {
    // The old rule dropped an entry with no name and no products; a free line is now
    // something, so dropping it would delete work somebody had just typed.
    const cfg = normalizeConfig({ ...FREE_CFG,
      whatsappClients: [{ id: 'wc', name: '', products: [], extras: [{ name: 'Bread' }] }] });
    expect(cfg.whatsappClients.length).toBe(1);
  });

  test('free lines are capped, so a stuck finger cannot grow the config for ever', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ name: 'Line ' + i }));
    const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
      { clientId: 'cA', products: [], extras: many }] }] });
    expect(cfg.whatsappLists[0].clients[0].extras.length).toBe(50);
  });

  test('a config that never heard of free lines normalises to an empty list', () => {
    const cfg = normalizeConfig({ ...FREE_CFG, whatsappLists: [{ id: 'wl', title: 'M', clients: [
      { clientId: 'cA', products: ['p1'] }] }] });
    expect(cfg.whatsappLists[0].clients[0].extras).toStrictEqual([]);
  });

  // ── The two words the original looks up with t() — here they come in as arguments ──────────────────────────

  test('formatGrams groups four-digit numbers (Italian Intl would not by default)', () => {
    expect(m.formatGrams(5000)).toBe('5,000'); // the interface language is English under test
    expect(m.formatGrams(NaN)).toBe('0');
    expect(m.formatGrams(1234.6)).toBe('1,235');
    expect(m.formatGrams(5000, 'en-GB')).toBe('5,000');
  });

  test('normalizeConfig on the oldest shape names the market list in the interface language (the default is English)', () => {
    const oldest = {
      focaccia: { clients: [{ id: 'f-c1', name: 'Client 1', products: [{ id: 'f-cia', name: 'Ciabatta', weight: 160 }] }] },
      market: { clients: [{ id: 'm-1', name: 'Client 1', products: [] }] },
    };
    expect(normalizeConfig(oldest).whatsappLists[0].title).toBe('Market order');
  });
});

describe('the port with the words it is handed', () => {
  test('formatGrams groups in the interface language it is told (Italian: a dot, four digits included)', () => {
    expect(ported.formatGrams(5000, 'it-IT')).toBe('5.000');
    expect(ported.formatGrams(1234.6, 'it-IT')).toBe('1.235');
    expect(ported.formatGrams(NaN, 'it-IT')).toBe('0');
  });

  test('normalizeConfig names the list built out of the oldest «market» section with the title it is handed', () => {
    const oldest = {
      focaccia: { clients: [{ id: 'f-c1', name: 'Client 1', products: [{ id: 'f-cia', name: 'Ciabatta', weight: 160 }] }] },
      market: { clients: [{ id: 'm-1', name: 'Client 1', products: [] }] },
    };
    expect(ported.normalizeConfig(oldest, 'Ordine del mercato').whatsappLists[0]?.title).toBe('Ordine del mercato');
    // A title the document carries wins over the argument.
    const titled = { ...oldest, market: { title: 'Saturday', clients: [{ id: 'm-1', name: 'Client 1', products: [] }] } };
    expect(ported.normalizeConfig(titled, 'Ordine del mercato').whatsappLists[0]?.title).toBe('Saturday');
  });
});

// ── The save path (step 3c-2) — tests/config-reconcile.test.mjs and calculator-save-failure.test.mjs ──

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s — the save path', (_name, m) => {
  const { reconcileConfigWrite, saveFailureKey } = m as unknown as Record<string, Loose>;
  const ids = (out: Loose) => out.recipes.map((r: Loose) => r.id);

  test('no concurrent writer (revs match): recipes pass through, rev climbs', () => {
    const out = reconcileConfigWrite({ configRev: 3, recipes: [{ id: 'focaccia' }, { id: 'brioche' }] },
      { configRev: 3, recipes: [{ id: 'focaccia' }, { id: 'brioche' }] });
    expect(ids(out)).toStrictEqual(['focaccia', 'brioche']);
    expect(out.configRev).toBe(4);
  });

  test('concurrent import preserved: a cat-* recipe added on the server survives the save', () => {
    const out = reconcileConfigWrite({ configRev: 3, recipes: [{ id: 'focaccia' }] },
      { configRev: 4, recipes: [{ id: 'focaccia' }, { id: 'cat-x', name: 'X' }] });
    expect(ids(out)).toStrictEqual(['focaccia', 'cat-x']);
    expect(out.configRev).toBe(5);
  });

  test('normal delete is NOT resurrected (no conflict): removed recipe stays removed', () => {
    const out = reconcileConfigWrite({ configRev: 4, recipes: [{ id: 'focaccia' }] },
      { configRev: 4, recipes: [{ id: 'focaccia' }, { id: 'brioche' }] });
    expect(ids(out)).toStrictEqual(['focaccia']);
    expect(out.configRev).toBe(5);
  });

  test('deleting an imported (cat-*) recipe works when there is no concurrent writer', () => {
    const out = reconcileConfigWrite({ configRev: 5, recipes: [{ id: 'focaccia' }] },
      { configRev: 5, recipes: [{ id: 'focaccia' }, { id: 'cat-x' }] });
    expect(ids(out)).toStrictEqual(['focaccia']);
  });

  test('first write (no server document yet): rev starts at 1, recipes unchanged', () => {
    const out = reconcileConfigWrite({ configRev: 0, recipes: [{ id: 'focaccia' }] }, null);
    expect(ids(out)).toStrictEqual(['focaccia']);
    expect(out.configRev).toBe(1);
  });

  test('only imported (cat-*) recipes are preserved on conflict, not arbitrary ones', () => {
    const out = reconcileConfigWrite({ configRev: 3, recipes: [{ id: 'focaccia' }] },
      { configRev: 4, recipes: [{ id: 'focaccia' }, { id: 'my-recipe' }] });
    expect(ids(out)).toStrictEqual(['focaccia']);
    expect(out.configRev).toBe(5);
  });

  test('a cat-* already present in the save is not duplicated', () => {
    const out = reconcileConfigWrite({ configRev: 3, recipes: [{ id: 'focaccia' }, { id: 'cat-x' }] },
      { configRev: 4, recipes: [{ id: 'focaccia' }, { id: 'cat-x' }] });
    expect(ids(out)).toStrictEqual(['focaccia', 'cat-x']);
  });

  test('saveFailureKey: a refusal says the app is out of date, any other failure says check the connection', () => {
    expect(saveFailureKey({ synced: false, reason: 'write-failed', code: 'permission-denied' })).toBe('calc.notSavedOutOfDate');
    for (const code of ['unavailable', 'deadline-exceeded', 'failed-precondition', undefined, null, 42]) {
      expect(saveFailureKey({ synced: false, reason: 'write-failed', code }), String(code)).toBe('calc.notSavedCheckConnection');
    }
  });

  test('saveFailureKey: a stored change, no answer yet (already explained) and junk say nothing', () => {
    expect(saveFailureKey({ synced: true })).toBeNull();
    expect(saveFailureKey({ synced: false, reason: 'no-server-answer' })).toBeNull();
    expect(saveFailureKey(undefined)).toBeNull();
    expect(saveFailureKey(null)).toBeNull();
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The one function that looks a word up in the interface dictionary.
  const LEFT_OUT = ['orderPrefillLabel'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(original[name] !== undefined, name).toBe(true);
  });

  test('exports exactly the same names, except those', () => {
    expect(Object.keys(port).sort()).toStrictEqual(shared);
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
