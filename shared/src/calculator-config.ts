// calculator-config.ts — the pure data model of the Calculator's configuration (`config/calculator`). PURE:
// no Firebase, no DOM, no storage.
//
// TypeScript PARTIAL port of js/calculator-config.js for Mise 2. Behaviour is identical, input for input,
// for everything ported: calculator-config.spec.ts (and the specs of the other models that read the config)
// run every test against BOTH files and compare each ported export with the js/ file itself;
// odd-inputs.spec.ts feeds both the same strange values. It is NOT paired in parity.spec.ts, because of
// what is left out.
//
// PORTED: reading and normalising the stored document in EVERY shape the current app reads (`normalizeConfig`:
// the current shape, the shared-catalogue shape and the oldest per-tab + market shape), `DEFAULT_CONFIG` and
// `CONFIG_MODEL`, the lookups (clients, products, recipes, ingredients, WhatsApp lists), the visible tabs,
// the empty-state reason, the targets by logic (`computeTarget`, `computeRecipeTarget`), trays, extra dough,
// the divisor, the crate boxes, the free lines, the log-display settings and the order-prefill window.
//
// LEFT OUT, for step 3c-2 (writing the configuration): `reconcileConfigWrite` and `saveFailureKey` (the save
// path), and for 3c-4 (market orders): `orderPrefillLabel` (it looks a word up in the interface dictionary,
// `t()`, which in Mise 2 belongs to the app; `ORDER_PREFILL_LABELS` — the dictionary KEYS — is ported, the app
// resolves them through its own typed i18n).
//
// TWO WORDS THE ORIGINAL LOOKS UP WITH `t()` COME IN AS ARGUMENTS instead (read when drawing, never at module
// level):
//   · `formatGrams(n, localeTag)` — the number grouped in the interface language ('it-IT' | 'en-GB');
//   · `normalizeConfig(raw, marketOrderTitle)` — only the oldest per-tab shape needs it, as the title of the
//     list it builds out of the old «market» section (`help.marketOrder`: «Market order»). The defaults are
//     the English words, which is what the original answers when the interface is English.
//
// The state keys of one recipe tab (`qty-…`, `param-…`, …) are built in calculator-tab-keys.ts: in the
// original they are string literals scattered through js/app.js and js/calc.js, never a function here.
//
// THE MODEL — a product belongs to the client that orders it:
//   • config.clients[] is the address book, and each client carries its own `products[]`:
//     { id, name, recipeId, weight, kind, crate, active }. There is no shared catalogue: what a client
//     orders is described in one place, on one screen.
//   • A recipe tab is a FILTERED VIEW: getTabProducts(config, recipeId) walks every client's products and
//     emits one row per product belonging to that recipe. Quantities are per (client, product), keyed by
//     `qtyId` = pairId(clientId, id).
//
// ⚠️ Two clients migrated from one catalogue product KEEP THE SAME id. Four things key by it — divisor ticks,
// WhatsApp lists, saved log rows and typed quantities — and minting a fresh id would quietly cut all four.
// Where the client is known, resolve a product inside THAT client's list (see resolveListClients).
//
// item.kind drives the INPUT WIDGET in the calculator, NOT the math:
//   'number'   → plain numeric quantity field (default)
//   'dropdown' → quantity picked from a fixed preset dropdown (0/20/40/60/80/100)
//   'kg'       → quantity entered directly in kilograms (weight 1000 g/kg)
// Legacy kinds are migrated on load: 'ciabatta' → 'dropdown', 'panini' → 'number'. A product can opt into a
// "crate box" (product.crate = { show, perBox }): a display-only helper showing how many crates its order
// fills.
//
// ⚠️ THE STORED DOCUMENT IS UNTYPED BY NATURE: inside the normalisers it is read as `any`, field by field,
// exactly as the original reads it. What comes OUT of `normalizeConfig` is typed.

export const TABS = ['focaccia', 'brioche', 'sourdough'];

// ⚠️ THE SHAPE NUMBER OF config/calculator, like `model: 2` on a food-cost product. assemble() rebuilds the
// document from a FIXED list of keys, so a phone still running an older build that saves the config silently
// DROPS every key added since. The app therefore always writes EXACTLY this number — never
// Math.max(stored, this): a build that knows less must write a LOWER number, and the rules refuse a write
// that lowers configModel, so the older build gets «could not save» instead of deleting data. Raise it (here
// and in the rules) the day a new key or recipe logic is added — and a release that raises it cannot be
// rolled back by a revert.
// 1 = the document before the field existed; 2 = adds showClientOrdersButton; 3 = adds the 'trays' /
// 'traysTotal' recipe logics and `trayWeight`; 4 = adds askDoughDay (whether Confirm asks «today or
// tomorrow?»).
export const CONFIG_MODEL = 4;

// Allowed weight range, in grams. Guards against a typo turning 150 into 15000 and silently producing ten
// times the intended dough.
export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 5000;

// Separator for a per (client, product) quantity key. Chosen so it cannot occur in generated ids (which are
// lowercase letters, digits and single hyphens).
const PAIR_SEP = '::';

// The quantity key for a (client, product) association: the id of the input/select the calculator renders
// for that pair, and the localStorage key it persists under (`qty-<pairId>`).
export function pairId(clientId: unknown, productId: unknown): string {
  return String(clientId) + PAIR_SEP + String(productId);
}

// ── Types of what comes out ──────────────────────────────────────────────────

export type ProductKind = 'number' | 'dropdown' | 'kg';

export interface Crate {
  show: boolean;
  perBox: number;
}

export interface Product {
  id: string;
  name: string;
  recipeId: string;
  weight: number;
  kind: ProductKind;
  crate: Crate;
  active: boolean;
}

export interface Client {
  id: string;
  name: string;
  products: Product[];
}

// One row of a recipe tab: a product of one client, with its owner.
export interface TabProduct {
  id: string;
  qtyId: string;
  name: string;
  recipeId: string;
  weight: number;
  kind: ProductKind;
  crate: Crate;
  clientId: string;
  clientName: string;
}

export type Logic = 'orders' | 'total' | 'both' | 'trays' | 'traysTotal';

export interface RecipeIngredient {
  key: string;
  label: string;
  grams: number;
}

export interface Recipe {
  id: string;
  name: string;
  logic: Logic;
  ingredients: RecipeIngredient[];
  trayWeight: number;
  catalogueId?: string;
  leaveningRid?: string | null;
  leaveningKey: string | null;
  leaveningDefaultPct: number;
  showLeavening: boolean;
  baselinePct: number | null;
  order: number;
  visible: boolean;
}

export interface FreeLine {
  id: string;
  name: string;
}

export interface WhatsappListClient {
  clientId: string;
  products: string[];
  extras: FreeLine[];
}

export interface WhatsappList {
  id: string;
  title: string;
  clients: WhatsappListClient[];
}

export interface WhatsappClient {
  id: string;
  name: string;
  products: string[];
  extras: FreeLine[];
}

export interface RegistryIngredient {
  id: string;
  name: string;
}

export type OrderPrefillWindow = 'both' | 'yesterday' | 'today';

export interface CalculatorConfig {
  // Absent on the default (nothing has been read from a server yet).
  configRev?: number;
  clients: Client[];
  recipes: Recipe[];
  ingredients: RegistryIngredient[];
  whatsappLists: WhatsappList[];
  whatsappClients: WhatsappClient[];
  extraDough: Record<string, boolean>;
  divisorIncluded: Record<string, string[]>;
  logVisibility: Record<string, boolean>;
  logRetentionHours: number;
  logRetentionByDough: Record<string, number>;
  orderPrefillWindow: OrderPrefillWindow;
  showClientOrdersButton: boolean;
  askDoughDay: boolean;
  configModel: number;
}

// A product row as the free lines and the WhatsApp messages see it: a real product, or a free line.
export type ResolvedProduct = (Product & { clientId?: string; clientName?: string }) | (FreeLine & { free: true });

// Default configuration. EMPTY, AND THAT IS THE FEATURE (13 Aug 2026): until then the default held one
// bakery's own address book — four clients, ten products with their weights, three recipes with their real
// formulas — and every customer who bought the Calculator opened it holding somebody else's recipes. It is
// never written to anybody's database; it is what the app SHOWS until a real document arrives.
//
// ⚠️ THE NUMBERS BELOW STAY, and they are not data: they are how the screens behave before anybody has
// chosen anything. A window of days, a retention in hours and a set of switches describe no business and
// name no client.
export const DEFAULT_CONFIG: CalculatorConfig = {
  clients: [],
  recipes: [],
  ingredients: [],
  whatsappLists: [],
  whatsappClients: [],
  // Per-recipe switches. Empty maps: normalizeConfig fills in a default for any recipe id it does not find.
  extraDough: {},
  divisorIncluded: {},
  logVisibility: {},
  logRetentionHours: 24,
  logRetentionByDough: {},
  // Which days the WhatsApp order form fills itself from. Default: both, because a day's order is normally
  // assembled from two days' work.
  orderPrefillWindow: 'both',
  // The bottom-bar «Orders» button. ON by default (read as `!== false`, see showsClientOrdersButton).
  showClientOrdersButton: true,
  // Whether Confirm asks which day the dough is for. ON by default (read as `!== false`, see asksDoughDay).
  askDoughDay: true,
  configModel: CONFIG_MODEL,
};

// Whether the bottom bar offers the Orders button. Missing, corrupt or anything but a literal false = ON, so
// a typo can never remove the only door to the clients' orders.
export function showsClientOrdersButton(config: unknown): boolean {
  return !(config && (config as { showClientOrdersButton?: unknown }).showClientOrdersButton === false);
}

// Whether Confirm asks «today or tomorrow?». Missing, corrupt or anything but a literal false = ON: the
// question is the safe side (a wrong day is worse than one more tap).
export function asksDoughDay(config: unknown): boolean {
  return !(config && (config as { askDoughDay?: unknown }).askDoughDay === false);
}

const KINDS: readonly string[] = ['number', 'dropdown', 'kg'];

// Migrate a stored kind to the current taxonomy. The old 'ciabatta'/'panini' values conflated the input
// widget with a helper box; they now map to their pure input widget. Anything unknown falls back to a plain
// number field.
const LEGACY_KIND: Record<string, string> = { ciabatta: 'dropdown', panini: 'number' };
function normalizeKind(kind: unknown): ProductKind {
  const migrated = LEGACY_KIND[kind as string] || kind;
  return (KINDS.includes(migrated as string) ? migrated : 'number') as ProductKind;
}

// Deep clone via JSON — config is plain data (no functions/dates), so this is safe and keeps callers from
// mutating shared defaults.
export function cloneConfig<T>(config: T): T {
  return JSON.parse(JSON.stringify(config)) as T;
}

// "Extra dough" is a free amount of dough to make, NOT tied to any product — entered directly in each tab and
// added on top of the products' total. Capped to guard against an extreme typo (e.g. 1 kg mistyped as
// 1000 kg).
export const EXTRA_MAX_G = 500000; // 500 kg

// Convert an extra-dough entry to grams. unit 'kg' multiplies by 1000; anything non-numeric or negative
// becomes 0 so the math never sees NaN.
export function doughExtraGrams(value: unknown, unit?: unknown): number {
  let g = Number(value);
  if (!Number.isFinite(g) || g < 0) return 0;
  if (unit === 'kg') g *= 1000;
  return Math.min(g, EXTRA_MAX_G);
}

// The divisor box splits dough into up to this many crates (a 0–4 dropdown, 0 = no split shown).
// Display-only — it never affects the dough math.
export const DIVISOR_MAX = 4;

// The per-association "crate box" helper: how many pieces fit in one crate.
export const CRATE_PERBOX_MIN = 1;
export const CRATE_PERBOX_MAX = 1000;
export const CRATE_PERBOX_DEFAULT = 20;

// Clamp a weight to the allowed range and coerce to a finite number. Returns WEIGHT_MIN for anything
// non-numeric so the math never sees NaN.
export function clampWeight(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return WEIGHT_MIN;
  if (n < WEIGHT_MIN) return WEIGHT_MIN;
  if (n > WEIGHT_MAX) return WEIGHT_MAX;
  return n;
}

// Clamp the pieces-per-crate to a sane range, defaulting on anything non-numeric.
export function clampCratePerBox(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return CRATE_PERBOX_DEFAULT;
  if (n < CRATE_PERBOX_MIN) return CRATE_PERBOX_MIN;
  if (n > CRATE_PERBOX_MAX) return CRATE_PERBOX_MAX;
  return n;
}

// ── Read helpers (used by the calculator, settings and WhatsApp) ──────────────
// Each takes `config` as ANY value: a missing or garbage config reads as empty, never throws.

// The whole address book (empty array for a missing/garbage config).
export function getClients(config: unknown): Client[] {
  const c = config as { clients?: unknown } | null | undefined;
  return (c && Array.isArray(c.clients)) ? c.clients as Client[] : [];
}

export function getClientById(config: unknown, id: unknown): Client | null {
  return getClients(config).find(c => c && c.id === id) || null;
}

// Every product of every client, flattened and tagged with its owner. A product belongs to exactly one
// client, so this is the whole set of products in the app.
export function getProducts(config: unknown): (Product & { clientId: string; clientName: string })[] {
  const out: (Product & { clientId: string; clientName: string })[] = [];
  for (const client of getClients(config)) {
    for (const p of (client.products || [])) {
      if (p) out.push({ ...p, clientId: client.id, clientName: client.name });
    }
  }
  return out;
}

// Find a product by id, or null. Two clients that order the same product keep the SAME id, so this can be
// ambiguous; use it only where the client is unknown and the name is all that matters — the WhatsApp
// message. Where the client IS known, look inside that client's own products instead (see
// resolveListClients).
export function getProductById(config: unknown, id: unknown): (Product & { clientId: string; clientName: string }) | null {
  return getProducts(config).find(p => p && p.id === id) || null;
}

// The pool the WhatsApp editor picks from. With products owned by a client there is exactly one of each
// `clientNames` / `clientCount`.
export function getAllProducts(config: unknown): (Product & { clientId: string; clientName: string; clientNames: string[]; clientCount: number })[] {
  return getProducts(config).map(p => ({ ...p, clientNames: [p.clientName], clientCount: 1 }));
}

// ── Recipes (the base) + ingredient registry ──────────────────────────────────

// The calc logics a recipe can use:
//   'orders'     → quantities from clients (+ leavening knob) — today's behaviour
//   'total'      → one typed total in grams, ingredients pro-rata (no clients/leavening)
//   'both'       → orders + a typed total + leavening; the two totals are summed
//   'trays'      → a number of trays × the recipe's tray weight, ingredients pro-rata
//   'traysTotal' → trays × tray weight + a typed total in grams, ingredients pro-rata
export const LOGICS: Logic[] = ['orders', 'total', 'both', 'trays', 'traysTotal'];

// Logics that take clients' orders (and so a leavening knob, an extra-dough box, products).
export function usesOrders(logic: unknown): boolean { return logic === 'orders' || logic === 'both'; }
// Logics that take a typed total in grams.
export function usesTypedTotal(logic: unknown): boolean { return logic === 'total' || logic === 'both' || logic === 'traysTotal'; }
// Logics that take a number of trays.
export function usesTrays(logic: unknown): boolean { return logic === 'trays' || logic === 'traysTotal'; }
// Logics that scale pro-rata with the leavening neutralised (no orders to adjust it for).
export function isProRata(logic: unknown): boolean { return logic === 'total' || usesTrays(logic); }

// ── Trays ─────────────────────────────────────────────────────────────────────
// One tray weighs `trayWeight` grams of dough, set per recipe. Whole grams: a scale in a kitchen does not
// show tenths, and a whole number keeps «5 × 1,000 g» readable.
export const DEFAULT_TRAY_WEIGHT = 1000;
export const MAX_TRAY_WEIGHT = 100000;
// Below this a typed weight is almost surely kilos («1.2» meant as 1.2 kg): Save refuses it.
export const MIN_TRAY_WEIGHT = 50;
export const MAX_TRAYS = 10000;

// A tray weight → whole grams in MIN_TRAY_WEIGHT…MAX_TRAY_WEIGHT; missing, text, NaN or under the minimum →
// 1000. A stored weight under 50 g can only come from somewhere other than the Recipes screen (which refuses
// it); 1000 is the safe reading, never 1 g per tray.
export function normalizeTrayWeight(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < MIN_TRAY_WEIGHT) return DEFAULT_TRAY_WEIGHT;
  return Math.min(n, MAX_TRAY_WEIGHT);
}

// Whether a typed tray weight is a usable answer (the Recipes screen blocks Save otherwise).
export function isValidTrayWeight(v: unknown): boolean {
  if (v === '' || v === null || v === undefined) return false;
  const n = Number(v);
  return Number.isFinite(n) && n >= MIN_TRAY_WEIGHT && n <= MAX_TRAY_WEIGHT;
}

// A typed number of trays → a whole number in 0…MAX_TRAYS. WHOLE TRAYS ONLY, decided in this one place: if
// half trays are ever wanted, this is the only line that changes.
export function normalizeTrays(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_TRAYS);
}

// What a trays box must show so that it equals what is computed: the whole number used, or null when the box
// already says it (or is empty, which is left alone while typing).
export function settledTraysText(raw: unknown): string | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const used = String(normalizeTrays(raw));
  return used === String(raw).trim() ? null : used;
}

// The grams a number of trays makes with this recipe's tray weight.
export function traysGrams(recipe: unknown, trays: unknown): number {
  return normalizeTrays(trays) * normalizeTrayWeight(recipe && (recipe as { trayWeight?: unknown }).trayWeight);
}

// «5,000» / «5.000»: grouped in the interface language. Intl's Italian skips the group for four digits
// unless asked, and a tray count makes four-digit grams the everyday case. `localeTag` is the interface
// language's tag ('it-IT' or 'en-GB'); call it while drawing, so the language is read then.
export function formatGrams(n: unknown, localeTag: string = 'en-GB'): string {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try {
    return new Intl.NumberFormat(localeTag, { useGrouping: 'always', maximumFractionDigits: 0 } as unknown as Intl.NumberFormatOptions).format(v);
  } catch (e) {
    return String(Math.round(v));
  }
}

// The maximum number of recipes that can be visible as calculator tabs at once.
export const MAX_VISIBLE_RECIPES = 4;

// All recipes (empty array for a missing/garbage config).
export function getRecipes(config: unknown): Recipe[] {
  const c = config as { recipes?: unknown } | null | undefined;
  return (c && Array.isArray(c.recipes)) ? c.recipes as Recipe[] : [];
}

export function getRecipeById(config: unknown, id: unknown): Recipe | null {
  return getRecipes(config).find(r => r && r.id === id) || null;
}

// The recipes shown as calculator tabs: those flagged visible, in their chosen order, capped at
// MAX_VISIBLE_RECIPES (screen space).
export function getVisibleRecipes(config: unknown): Recipe[] {
  return getRecipes(config)
    .filter(r => r && r.visible !== false)
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .slice(0, MAX_VISIBLE_RECIPES);
}

// The ingredient registry (empty array for a missing/garbage config).
export function getIngredients(config: unknown): RegistryIngredient[] {
  const c = config as { ingredients?: unknown } | null | undefined;
  return (c && Array.isArray(c.ingredients)) ? c.ingredients as RegistryIngredient[] : [];
}

// ── Why the Calculator has nothing to show ────────────────────────────────────
// Since the default config was emptied (13 Aug 2026) a brand-new customer opens a Calculator with no tabs at
// all. Returns null when there IS something to draw, otherwise which sentence to say:
//   'loading'        → nothing yet, and the server has not answered
//   'no-recipes'     → answered: this venue has no recipes at all
//   'hidden-recipes' → answered: recipes exist, but none is set to show as a tab
//
// ⚠️ 'loading' IS THE POINT OF THE serverAnswered ARGUMENT, and leaving it out would make the screen lie. A
// phone with no cached copy starts on the empty DEFAULT_CONFIG while Firestore is still being asked. Saying
// "you have no recipes" there tells a customer with a full address book that their work is gone, for as long
// as the network takes.
//
// ⚠️ AND 'hidden-recipes' IS NOT THE SAME SENTENCE AS 'no-recipes'. Sending somebody to "add your first
// recipe" when they have ten, all hidden, sets them creating a duplicate of something they already own.
export type EmptyReason = 'loading' | 'no-recipes' | 'hidden-recipes';

export function calculatorEmptyReason(config: unknown, serverAnswered?: unknown): EmptyReason | null {
  if (getVisibleRecipes(config).length > 0) return null;
  if (!serverAnswered) return 'loading';
  return getRecipes(config).length > 0 ? 'hidden-recipes' : 'no-recipes';
}

// Whether a recipe's calculator tab shows a leavening knob: only logics that order or sum ('orders'/'both'),
// and only when the recipe designates a leavening with the "show the knob" flag on. A 'total' or trays
// recipe never shows it (pure pro-rata).
export function showsLeaveningKnob(recipe: unknown): boolean {
  const r = recipe as { logic?: unknown; leaveningKey?: unknown; showLeavening?: unknown } | null | undefined;
  if (!r || !usesOrders(r.logic)) return false;
  return !!(r.leaveningKey && r.showLeavening);
}

// Build the scaleRecipe spec from a config recipe: the ordered {key: grams} amounts, which ingredient is the
// leavening, and the stored baseline %. The dough math feeds this straight into scaleRecipe — see
// calculator-dough-math.ts.
export function recipeSpec(recipe: unknown): { amounts: Record<string, number>; leaveningKey: string | null; baselinePct: number | null } {
  const r = recipe as { ingredients?: unknown; leaveningKey?: string; baselinePct?: unknown } | null | undefined;
  const amounts: Record<string, number> = {};
  for (const ing of (r && Array.isArray(r.ingredients) ? r.ingredients as { key?: string; grams?: unknown }[] : [])) {
    if (ing && ing.key) amounts[ing.key] = Number(ing.grams) || 0;
  }
  const leaveningKey = (r && r.leaveningKey && amounts[r.leaveningKey] != null)
    ? r.leaveningKey : null;
  const baselinePct = (r && Number.isFinite(Number(r.baselinePct))) ? Number(r.baselinePct) : null;
  return { amounts, leaveningKey, baselinePct };
}

// The saved independent WhatsApp lists (empty array for a missing/garbage config).
export function getWhatsappLists(config: unknown): WhatsappList[] {
  const c = config as { whatsappLists?: unknown } | null | undefined;
  return (c && Array.isArray(c.whatsappLists)) ? c.whatsappLists as WhatsappList[] : [];
}

// The saved direct WhatsApp clients (empty array for a missing/garbage config).
export function getWhatsappClients(config: unknown): WhatsappClient[] {
  const c = config as { whatsappClients?: unknown } | null | undefined;
  return (c && Array.isArray(c.whatsappClients)) ? c.whatsappClients as WhatsappClient[] : [];
}

// Free lines join the resolved rows as ordinary ones, so the order modal, the prefill and the message
// builder need to know nothing about them: a row is a row. They come LAST, after the products, because they
// are the additions to an order rather than the body of it.
//
// `free: true` is carried for the settings screen, which is the only place that has to tell the two apart —
// it lets you rename a free line and not a product.
function freeLineRows(extras: unknown): (FreeLine & { free: true })[] {
  return (Array.isArray(extras) ? extras as (FreeLine | null)[] : [])
    .filter((l): l is FreeLine => !!(l && l.id && l.name))
    .map(l => ({ id: l.id, name: l.name, free: true as const }));
}

// Resolve a WhatsApp list to the data the order message needs: for each client entry, the live client object
// plus the chosen product objects, with dangling references (deleted client or product) skipped.
export function resolveListClients(config: unknown, list: unknown): { client: Client; products: ResolvedProduct[] }[] {
  const l = list as { clients?: unknown } | null | undefined;
  if (!l || !Array.isArray(l.clients)) return [];
  const out: { client: Client; products: ResolvedProduct[] }[] = [];
  for (const entry of l.clients as ({ clientId?: unknown; products?: unknown; extras?: unknown } | null)[]) {
    if (!entry) continue;
    const client = getClientById(config, entry.clientId);
    if (!client) continue; // a deleted client drops out of the list
    // Resolve inside THIS client's own products first. Two clients ordering the same product share an id, so
    // a global lookup could return the other one's copy and print its name. The global fallback keeps an
    // older reference working rather than silently dropping a line from the message.
    const own = new Map<unknown, Product>((client.products || []).map(p => [p.id, p]));
    const productIds = Array.isArray(entry.products) ? entry.products as unknown[] : [];
    const products = (productIds
      .map(id => own.get(id) || getProductById(config, id))
      .filter(Boolean) as ResolvedProduct[])
      .concat(freeLineRows(entry.extras));
    out.push({ client, products });
  }
  return out;
}

// Resolve a direct WhatsApp client to the order message's data: its typed name plus the chosen product
// objects, skipping ids whose product was deleted.
export function resolveDirectClient(config: unknown, dc: unknown): { name: string; products: ResolvedProduct[] } | null {
  if (!dc) return null;
  const d = dc as { products?: unknown; extras?: unknown; name?: unknown };
  const productIds = Array.isArray(d.products) ? d.products as unknown[] : [];
  const products = (productIds.map(id => getProductById(config, id)).filter(Boolean) as ResolvedProduct[])
    .concat(freeLineRows(d.extras));
  return { name: (d.name || 'Client') as string, products };
}

// Whether the per-tab "Extra dough" box is shown for a given tab. Defaults to shown.
export function isExtraDoughEnabled(config: unknown, tab: unknown): boolean {
  const c = config as { extraDough?: Record<string, unknown> } | null | undefined;
  return !(c && c.extraDough && c.extraDough[tab as string] === false);
}

// ── Log display settings (visibility + retention) ─────────────────────────────
// Both are DISPLAY-only filters for the app's Log list. Logs are always written to Firestore; these only
// decide what the list shows.

export const LOG_RETENTION_OPTIONS = [24, 48];
export const LOG_RETENTION_DEFAULT = 24;

export function isLogVisible(config: unknown, tab: unknown): boolean {
  const c = config as { logVisibility?: Record<string, unknown> } | null | undefined;
  return !(c && c.logVisibility && c.logVisibility[tab as string] === false);
}

export function getLogRetentionHours(config: unknown): number {
  return normalizeLogRetention(config && (config as { logRetentionHours?: unknown }).logRetentionHours);
}

export function getLogRetentionForDough(config: unknown, tab: unknown): number {
  const m = (config && (config as { logRetentionByDough?: Record<string, unknown> }).logRetentionByDough) as Record<string, unknown> | undefined | null | false | 0 | '';
  const n = m && Number(m[tab as string]);
  return LOG_RETENTION_OPTIONS.includes(n as number) ? n as number : getLogRetentionHours(config);
}

// ── Which days the WhatsApp order form fills itself from ──────────────────────
// A day's order is normally assembled from TWO days' work: some products are made the day before it goes
// out, some the same morning. That is why 'both' is the default — but which days apply is the bakery's own
// rhythm, not a fact the app can derive, so it is a setting.
//
// ⚠️ 'yesterday' means yesterday ONLY, not "yesterday onwards". Someone who bakes everything the day before
// wants today's half-finished calculations kept OUT of the message, and an option that quietly included them
// would be the same as 'both'.
export const ORDER_PREFILL_WINDOWS: OrderPrefillWindow[] = ['both', 'yesterday', 'today'];
export const ORDER_PREFILL_DEFAULT: OrderPrefillWindow = 'both';

// Wording for the setting, and for the sentence above the order form. Kept beside the values so the two can
// never drift apart.
// ⚠️ KEYS, resolved at draw time through the interface dictionary (the original's `orderPrefillLabel`, which
// does the lookup, is left out of this port).
export const ORDER_PREFILL_LABELS: Record<OrderPrefillWindow, string> = {
  both: 'help.yesterdayAndToday',
  yesterday: 'help.yesterdayOnly',
  today: 'help.todayOnly',
};

export function getOrderPrefillWindow(config: unknown): OrderPrefillWindow {
  const v = config && (config as { orderPrefillWindow?: unknown }).orderPrefillWindow;
  return (ORDER_PREFILL_WINDOWS as unknown[]).includes(v) ? v as OrderPrefillWindow : ORDER_PREFILL_DEFAULT;
}

// ── Tab view (clients' products → per-association rows) ───────────────────────

// A recipe tab's rows: for every client's product that belongs to `recipeId`, one row carrying the
// product's name/weight/recipe plus its kind/crate and its owning client. The SAME product ordered by two
// clients yields two rows. Each row's `qtyId` is the per (client, product) quantity key; `id` stays the
// product id (so divisor/crate/whatsapp keep keying by product).
export function getTabProducts(config: unknown, recipeId: unknown): TabProduct[] {
  const out: TabProduct[] = [];
  for (const client of getClients(config)) {
    if (!client || !Array.isArray(client.products)) continue;
    for (const product of client.products) {
      if (!product || product.recipeId !== recipeId) continue;
      // A paused product keeps its settings but leaves the calculator entirely: no row, no dough, no
      // divisor, no log. This is the ONE place that decides it — every consumer builds its rows from here.
      if (product.active === false) continue;
      out.push({
        id: product.id,
        qtyId: pairId(client.id, product.id),
        name: product.name,
        recipeId: product.recipeId,
        weight: product.weight,
        kind: normalizeKind(product.kind),
        crate: normalizeCrate(product.crate),
        clientId: client.id,
        clientName: client.name,
      });
    }
  }
  return out;
}

// Core dough math: total raw grams = Σ (quantity × unit weight) over every (client, product) association in
// a tab. getQty(qtyId) returns the quantity entered for that pair (pieces, or kilograms for a 'kg' product —
// its weight is 1000 g/kg).
export function computeTarget(config: unknown, tab: unknown, getQty: (qtyId: string) => unknown): number {
  let total = 0;
  for (const row of getTabProducts(config, tab)) {
    const qty = Number(getQty(row.qtyId)) || 0;
    total += qty * clampWeight(row.weight);
  }
  return total;
}

// What `computeRecipeTarget` is handed: the entered quantities, the extra dough, the typed total, the trays.
export interface RecipeTargetInputs {
  getQty?: (qtyId: string) => unknown;
  extraGrams?: unknown;
  totalInput?: unknown;
  trays?: unknown;
}

// The target raw weight for a recipe, by its calc logic (pure — the screen feeds in the entered quantities,
// extra and typed total):
//   'orders' → Σ(qty×weight) over the recipe's products + extra
//   'total'  → the typed total only
//   'both'   → Σ(qty×weight) + the typed total + extra
//   'trays'      → trays × the recipe's tray weight
//   'traysTotal' → trays × the recipe's tray weight + the typed total
// All inputs are coerced so the result is always a finite number ≥ 0.
export function computeRecipeTarget(
  config: unknown,
  recipe: unknown,
  { getQty, extraGrams = 0, totalInput = 0, trays = 0 }: RecipeTargetInputs = {},
): number {
  if (!recipe) return 0;
  const r = recipe as { logic?: unknown; id?: unknown };
  const finite = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const extra = Math.max(0, finite(extraGrams));
  const typed = Math.max(0, finite(totalInput));
  if (r.logic === 'total') return typed;
  if (r.logic === 'trays') return traysGrams(recipe, trays);
  if (r.logic === 'traysTotal') return traysGrams(recipe, trays) + typed;
  const orders = (typeof getQty === 'function') ? computeTarget(config, r.id, getQty) : 0;
  if (r.logic === 'both') return orders + typed + extra;
  return orders + extra; // 'orders'
}

// ── Divisor (display-only crate split) ────────────────────────────────────────
// The divisor box sums the dough of the SELECTED products of a tab and divides it into N crates. It NEVER
// touches the recipe or the log. Selection is by product id, so ticking a product splits its dough across
// every client that orders it.

export function getDivisorIncluded(config: unknown, tab: unknown): unknown[] {
  const inc = (config && (config as { divisorIncluded?: Record<string, unknown> }).divisorIncluded) as Record<string, unknown> | undefined | null | false | 0 | '';
  return inc && Array.isArray(inc[tab as string]) ? inc[tab as string] as unknown[] : [];
}

export function isInDivisor(config: unknown, tab: unknown, productId: unknown): boolean {
  return getDivisorIncluded(config, tab).includes(productId);
}

// The tab's rows currently in the divisor (every association of a ticked product).
export function getDivisorProducts(config: unknown, tab: unknown): TabProduct[] {
  const included = getDivisorIncluded(config, tab);
  return getTabProducts(config, tab).filter(row => included.includes(row.id));
}

// Total raw grams the divisor splits: Σ (quantity × unit weight) over the INCLUDED associations only. Same
// shape as computeTarget but limited to the divisor selection.
export function divisorTotal(config: unknown, tab: unknown, getQty: (qtyId: string) => unknown): number {
  let total = 0;
  for (const row of getDivisorProducts(config, tab)) {
    const qty = Number(getQty(row.qtyId)) || 0;
    total += qty * clampWeight(row.weight);
  }
  return total;
}

// Grams per crate = total ÷ n, or 0 when n is 0/invalid. Never returns NaN.
export function splitDough(total: unknown, n: unknown): number {
  const parts = Number(n);
  if (!Number.isFinite(parts) || parts <= 0) return 0;
  const grams = Number(total);
  if (!Number.isFinite(grams) || grams < 0) return 0;
  return grams / parts;
}

// ── Crate boxes (display-only, per association) ────────────────────────────────
// A per-association helper that tells the baker how many crates an order fills. The crate config
// (show, perBox) lives on the client's product; getTabProducts merges it onto each row, so these operate on
// a row exactly as before.

export function isCrateEnabled(row: unknown): boolean {
  const r = row as { crate?: { show?: unknown } } | null | undefined;
  return !!(r && r.crate && r.crate.show);
}

export function getCratePerBox(row: unknown): number {
  const r = row as { crate?: { perBox?: unknown } } | null | undefined;
  return clampCratePerBox(r && r.crate ? r.crate.perBox : undefined);
}

export function crateCount(qty: unknown, perBox: unknown): number {
  const n = Number(qty);
  const per = Number(perBox);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (!Number.isFinite(per) || per <= 0) return 0;
  return n / per;
}

// ── Normalisation & migration ─────────────────────────────────────────────────

// A product's optional crate box: shown only when explicitly enabled; perBox always clamped so the math
// never sees a zero/garbage divisor.
function normalizeCrate(raw: any): Crate {
  return {
    show: !!(raw && raw.show),
    perBox: clampCratePerBox(raw && raw.perBox),
  };
}

// One of a client's products: what it is called, which recipe it belongs to, its unit weight, how its
// quantity is typed and its optional crate box.
//
// ⚠️ recipeId is NOT validated here: recipes are configurable, so the only list that can say whether one
// exists is config.recipes, which normalizeConfig assembles afterwards. It used to be checked against the
// three shipped ids, which silently moved a product assigned to any recipe the owner had created onto
// Focaccia. homeProducts() below does the check properly, once the recipes are known.
function normalizeProduct(p: any): Product | null {
  if (!p || typeof p !== 'object' || !p.id) return null;
  const recipe = p.recipeId != null ? p.recipeId : p.dough; // tolerate the old field name
  return {
    id: String(p.id),
    name: cleanName(p.name, 'Product'),
    recipeId: String(recipe == null ? '' : recipe),
    weight: clampWeight(p.weight),
    kind: normalizeKind(p.kind),
    crate: normalizeCrate(p.crate),
    // Paused: kept in the client's list but out of the calculator until it comes back.
    // ⚠️ Missing means ACTIVE. No document in production carries this field, and a default of "paused" would
    // empty every tab at once. Same convention as `visible` on recipes and `active` on the Orders suppliers.
    active: p.active !== false,
  };
}

// A client: id, name, and the products it orders. Junk is dropped and ids are unique WITHIN the client (the
// same client never orders the same product twice).
function normalizeClient(client: any): Client | null {
  if (!client || typeof client !== 'object') return null;
  const products: Product[] = [];
  const seen = new Set<string>();
  for (const raw of (Array.isArray(client.products) ? client.products : [])) {
    const p = normalizeProduct(raw);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    products.push(p);
  }
  return {
    id: String(client.id || ''),
    name: cleanName(client.name, 'Client'),
    products,
  };
}

// Point every product at a recipe that actually exists. A product whose recipe was deleted would otherwise
// belong to no tab at all, which means it could never be seen or edited again — so it is re-homed onto the
// first recipe rather than lost.
function homeProducts(clients: Client[], recipes: Recipe[]): Client[] {
  const known = new Set(recipes.map(r => r.id));
  const first = recipes[0];
  const fallback = first ? first.id : '';
  for (const c of clients) {
    for (const p of c.products) if (!known.has(p.recipeId)) p.recipeId = fallback;
  }
  return clients;
}

// ── Free lines: things a client buys that the bakery does not calculate ───────
// A line that exists ONLY in the WhatsApp message. It carries its own name and is not a product at all, which
// is the entire point:
//
//   • it can never reach the dough calculation, structurally — not by a flag being respected in every place
//     that counts a product, but because there is nothing to count;
//   • it can never be pruned away, because there is no reference to resolve;
//   • the order form always leaves it at 0, because no production log can ever name it — which is right,
//     since nobody logs what they did not make.
//
// It exists because of a real case: a client buys loaves that are cut from the bread baked for ANOTHER
// client, so the dough is already counted once and must not be counted twice — but the line still has to
// appear in the message, or the client is sent an order missing what they asked for.
//
// ⚠️ THE ID IS PREFIXED `wx-`, AND THAT PREFIX IS LOAD-BEARING. The order modal keys its inputs by product id
// and the prefill keys its lookups the same way, so a free line must never collide with a real `p-…` id — a
// collision would put a client's typed quantity onto somebody else's row.
export const FREE_LINE_PREFIX = 'wx-';
const MAX_FREE_LINES = 50;

export function isFreeLineId(id: unknown): boolean {
  return String(id || '').startsWith(FREE_LINE_PREFIX);
}

// Keep the ones that still have a name. A blank line is not an error — it is a row somebody started and
// abandoned — so it is dropped quietly rather than refused.
//
// ⚠️ IDS ARE MADE UNIQUE WITHIN THE ENTRY. Two lines named the same would otherwise slug to the same id, and
// the modal would render two inputs sharing one id: getElementById returns the first, so one quantity would
// be read twice and the other silently ignored. Suffixed rather than dropped — a client really can be sold
// two things with the same name.
function normalizeFreeLines(raw: any): FreeLine[] {
  if (!Array.isArray(raw)) return [];
  const out: FreeLine[] = [];
  const used = new Set<string>();
  for (const line of raw) {
    if (!line || typeof line !== 'object') continue;
    const name = String(line.name == null ? '' : line.name).trim();
    if (!name) continue;

    const wanted = isFreeLineId(line.id) ? String(line.id) : FREE_LINE_PREFIX + (slug(name) || 'line');
    let id = wanted;
    for (let n = 2; used.has(id); n++) id = `${wanted}-${n}`;
    used.add(id);

    out.push({ id, name });
    if (out.length >= MAX_FREE_LINES) break;
  }
  return out;
}

// One WhatsApp list client entry, validated against the products + address book.
function normalizeListClient(raw: any, validClientIds: Set<string>, validProductIds: Set<string>): WhatsappListClient | null {
  if (!raw || typeof raw !== 'object') return null;
  const clientId = String(raw.clientId || '');
  if (!validClientIds.has(clientId)) return null;
  const products = Array.isArray(raw.products)
    ? raw.products.map(String).filter((id: string) => validProductIds.has(id))
    : [];
  return { clientId, products, extras: normalizeFreeLines(raw.extras) };
}

function normalizeWhatsappList(raw: any, validClientIds: Set<string>, validProductIds: Set<string>): WhatsappList | null {
  if (!raw || typeof raw !== 'object') return null;
  const clients = Array.isArray(raw.clients)
    ? raw.clients.map((c: any) => normalizeListClient(c, validClientIds, validProductIds)).filter(Boolean) as WhatsappListClient[]
    : [];
  return { id: String(raw.id || 'wl'), title: cleanName(raw.title, 'Order'), clients };
}

function normalizeWhatsappLists(raw: any, clients: Client[], validProductIds: Set<string>): WhatsappList[] {
  if (!Array.isArray(raw)) return [];
  const validClientIds = new Set(clients.map(c => c.id));
  return raw.map(l => normalizeWhatsappList(l, validClientIds, validProductIds)).filter(Boolean) as WhatsappList[];
}

// A direct WhatsApp client: typed name (kept as-is) plus product ids pruned to ones that still exist. A fully
// empty entry (no name AND no products AND no free lines) is dropped.
function normalizeWhatsappClient(raw: any, validProductIds: Set<string>): WhatsappClient | null {
  if (!raw || typeof raw !== 'object') return null;
  const products = Array.isArray(raw.products)
    ? raw.products.map(String).filter((id: string) => validProductIds.has(id))
    : [];
  const extras = normalizeFreeLines(raw.extras);
  const name = String(raw.name || '').trim();
  if (name === '' && products.length === 0 && extras.length === 0) return null;
  return { id: String(raw.id || 'wc'), name, products, extras };
}

function normalizeWhatsappClients(raw: any, validProductIds: Set<string>): WhatsappClient[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(c => normalizeWhatsappClient(c, validProductIds)).filter(Boolean) as WhatsappClient[];
}

// Convert the OLD `groups` shape (a group = a title + client ids, implicitly carrying each client's whole
// product list) into the new independent-list shape. Each client entry is seeded with all the products that
// client currently orders.
function groupsToLists(groups: any, clients: Client[]): any[] {
  if (!Array.isArray(groups)) return [];
  const byId = new Map(clients.map(c => [c.id, c]));
  return groups.map((g, gi) => {
    const clientIds = Array.isArray(g && g.clientIds) ? g.clientIds : [];
    const entries = clientIds.map((cid: unknown) => {
      const client = byId.get(String(cid));
      if (!client) return null;
      return { clientId: client.id, products: (client.products || []).map(p => p.id) };
    }).filter(Boolean);
    return { id: String((g && g.id) || 'wl-' + gi), title: cleanName(g && g.title, 'Order'), clients: entries };
  });
}

// Per-recipe "show Extra dough box" flags. Default shown (true) unless explicitly false. Keyed by every recipe
// id so a new recipe can carry its own setting.
function normalizeExtraDough(raw: any, ids: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of ids) out[id] = !(raw && raw[id] === false);
  return out;
}

// Per-recipe "show this recipe's logs" flags. Default shown (true) unless explicitly false.
function normalizeLogVisibility(raw: any, ids: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of ids) out[id] = !(raw && raw[id] === false);
  return out;
}

function normalizeLogRetention(raw: unknown): number {
  const n = Number(raw);
  return LOG_RETENTION_OPTIONS.includes(n) ? n : LOG_RETENTION_DEFAULT;
}

function normalizeLogRetentionByDough(raw: any, legacyGlobal: unknown, ids: string[]): Record<string, number> {
  const fallback = normalizeLogRetention(legacyGlobal);
  const out: Record<string, number> = {};
  for (const id of ids) {
    const n = raw && Number(raw[id]);
    out[id] = LOG_RETENTION_OPTIONS.includes(n) ? n : fallback;
  }
  return out;
}

// The set of product ids that belong to a given recipe, across every client.
function recipeProductIds(clients: Client[], recipeId: string): Set<string> {
  const ids = new Set<string>();
  for (const c of clients) {
    for (const p of (c.products || [])) if (p.recipeId === recipeId) ids.add(p.id);
  }
  return ids;
}

// Which product ids each recipe's divisor includes, pruned to ids that still exist in that recipe so a
// deleted product never lingers. Defaults to none. Keyed by product id, not per client, so ticking a product
// splits it across every client that orders it.
function normalizeDivisorIncluded(raw: any, clients: Client[], recipeIds: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const rid of recipeIds) {
    const validIds = recipeProductIds(clients, rid);
    const stored: string[] = raw && Array.isArray(raw[rid]) ? raw[rid].map(String) : [];
    out[rid] = stored.filter(id => validIds.has(id));
  }
  return out;
}

// Every name in this config is typed by hand, so it collects stray spaces at either end. A trailing one is
// invisible — in the app AND in the Firebase console — until the name is used inside a sentence, where it
// reads as "Seeded burger buns : 40 pz" in the log and in the WhatsApp message.
//
// ⚠️ Trim BEFORE applying the fallback: `String(x || 'Product').trim()` would let a name made only of spaces
// through as an empty string.
function cleanName(value: unknown, fallback: string): string {
  const s = String(value == null ? '' : value).trim();
  return s || fallback;
}

// A slug suitable for a stable-ish id derived from a name (lowercase, hyphenated).
function slug(s: unknown): string {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// One recipe ingredient row: a stable key (its identity within the recipe), a label (the displayed name) and
// grams. Keys are made unique within a recipe by the caller.
function normalizeIngredientRow(raw: any, index: number): RecipeIngredient | null {
  if (!raw || typeof raw !== 'object') return null;
  const label = cleanName(raw.label || raw.name, 'Ingredient');
  const key = raw.key ? String(raw.key) : (slug(label) || ('ing' + index));
  return { key, label, grams: Number(raw.grams) || 0 };
}

// One recipe: id, name, logic, ordered ingredients (unique keys), optional designated leavening with its
// default % / show flag, the stored baseline %, order and visibility. Anything invalid falls back to a safe
// value so the math always runs.
function normalizeRecipe(raw: any, index: number): Recipe | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name, 'Recipe');
  const id = String(raw.id || ('r-' + (slug(name) || index)));
  const logic: Logic = (LOGICS as unknown[]).includes(raw.logic) ? raw.logic : 'orders';

  const ingredients: RecipeIngredient[] = [];
  const usedKeys = new Set<string>();
  const rawIngs: any[] = Array.isArray(raw.ingredients) ? raw.ingredients : [];
  rawIngs.forEach((ri, i) => {
    const row = normalizeIngredientRow(ri, i);
    if (!row) return;
    let key = row.key;
    while (usedKeys.has(key)) key = key + '-' + i; // keep keys unique within the recipe
    usedKeys.add(key);
    ingredients.push({ key, label: row.label, grams: row.grams });
  });

  const leaveningKey = (raw.leaveningKey && usedKeys.has(String(raw.leaveningKey)))
    ? String(raw.leaveningKey) : null;
  const leaveningDefaultPct = Math.max(0, Number(raw.leaveningDefaultPct) || 0);
  const showLeavening = raw.showLeavening !== false;
  const baselinePct = Number.isFinite(Number(raw.baselinePct)) && Number(raw.baselinePct) > 0
    ? Number(raw.baselinePct)
    : (leaveningKey && leaveningDefaultPct > 0 ? leaveningDefaultPct : null);

  // ⚠️ THE LINK TO A CATALOGUE RECIPE MUST SURVIVE. Since 14 Aug 2026 a tab can take its ingredients from the
  // Catalogue (`catalogueId`, its leavening as `leaveningRid`), but this function rebuilt every recipe from a
  // fixed list that did not carry them — and it runs on every save, on the live stream and on the cached
  // copy, so a link chosen in Settings → Recipes was gone the moment it was saved (found 4 Oct 2026).
  const link = raw.catalogueId && String(raw.catalogueId).trim()
    ? { catalogueId: String(raw.catalogueId).trim(), leaveningRid: raw.leaveningRid ? String(raw.leaveningRid) : null }
    : {};

  return {
    id, name, logic, ingredients,
    // Kept whatever the logic, so switching away from trays and back loses nothing.
    trayWeight: normalizeTrayWeight(raw.trayWeight),
    ...link,
    leaveningKey, leaveningDefaultPct, showLeavening, baselinePct,
    order: Number(raw.order) || 0,
    visible: raw.visible !== false,
  };
}

// The recipe list. Ids are de-duplicated (first wins).
//
// ⚠️ NO RECIPES IS A REAL ANSWER, AND UNTIL 13 Aug 2026 IT WAS OVERWRITTEN: an empty or missing list used to
// fall back to "the three shipped recipes so the calculator always has something to scale", which handed a
// brand-new customer one bakery's formulas, and gave a customer who DELETED all their own recipes those
// formulas back out of nowhere. An empty list now stays empty.
function normalizeRecipes(raw: any): Recipe[] {
  if (!Array.isArray(raw)) return [];
  const out: Recipe[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const nr = normalizeRecipe(r, i);
    if (nr && !seen.has(nr.id)) { seen.add(nr.id); out.push(nr); }
  });
  return out;
}

// The ingredient registry: every saved registry name PLUS every label used by a recipe (so the autocomplete
// pool is always a superset of what is in use), de-duped case-insensitively. Independent of the recipes — a
// name can exist here unused.
function normalizeIngredients(raw: any, recipes: Recipe[]): RegistryIngredient[] {
  const byName = new Map<string, RegistryIngredient>(); // lowercased name -> { id, name }
  function add(name: unknown, idHint?: unknown): void {
    const clean = String(name || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (byName.has(key)) return;
    byName.set(key, { id: String(idHint || ('ing-' + (slug(clean) || byName.size))), name: clean });
  }
  if (Array.isArray(raw)) for (const r of raw) if (r && typeof r === 'object') add(r.name, r.id);
  for (const recipe of recipes) for (const ing of (recipe.ingredients || [])) add(ing.label);
  return [...byName.values()];
}

// Assemble the normalised config from already-normalised clients plus the raw document's remaining sections.
// Shared by the current-shape and migration paths.
function assemble(clients: Client[], raw: any): CalculatorConfig {
  const recipes = normalizeRecipes(raw.recipes);
  homeProducts(clients, recipes);
  const recipeIds = recipes.map(r => r.id);
  const validProductIds = new Set<string>();
  for (const c of clients) for (const p of c.products) validProductIds.add(p.id);
  const rawLists = Array.isArray(raw.whatsappLists)
    ? raw.whatsappLists
    : groupsToLists(raw.groups, clients);
  return {
    // Optimistic-concurrency revision (see saveCalculatorConfig): preserved across load/edit/save so a
    // concurrent write (e.g. a catalogue import) is detected.
    configRev: Number(raw.configRev) || 0,
    clients,
    recipes,
    ingredients: normalizeIngredients(raw.ingredients, recipes),
    whatsappLists: normalizeWhatsappLists(rawLists, clients, validProductIds),
    whatsappClients: normalizeWhatsappClients(raw.whatsappClients, validProductIds),
    extraDough: normalizeExtraDough(raw.extraDough, recipeIds),
    divisorIncluded: normalizeDivisorIncluded(raw.divisorIncluded, clients, recipeIds),
    logVisibility: normalizeLogVisibility(raw.logVisibility, recipeIds),
    logRetentionHours: normalizeLogRetention(raw.logRetentionHours),
    logRetentionByDough: normalizeLogRetentionByDough(raw.logRetentionByDough, raw.logRetentionHours, recipeIds),
    // An unknown or missing value falls back to 'both' — the widest window, so a corrupt setting never
    // silently narrows what the order form offers.
    orderPrefillWindow: getOrderPrefillWindow(raw),
    showClientOrdersButton: showsClientOrdersButton(raw),
    askDoughDay: asksDoughDay(raw),
    // Always this build's own number (see CONFIG_MODEL), never the stored one.
    configModel: CONFIG_MODEL,
  };
}

// Migrate the shared-catalogue shape (a top-level products[] plus clients[].items[], live from v1.5.0 to
// v1.21.x) into products owned by their client. Each item is resolved to its catalogue product and carries
// its own kind/crate.
//
// ⚠️ THE ID IS PRESERVED, even when two clients order the same product and the two copies therefore end up
// sharing one. Four things key by that id — the divisor ticks, the WhatsApp lists, the rows of every saved
// log, and the typed quantities in localStorage (qty-<client>::<product>) — and minting a new one for the
// second client would quietly cut all four.
function migrateCatalogue(raw: any): Client[] {
  const catalogue = new Map<string, Product>();
  for (const p of (Array.isArray(raw.products) ? raw.products : [])) {
    const np = normalizeProduct(p);
    if (np && !catalogue.has(np.id)) catalogue.set(np.id, np);
  }
  const clients: Client[] = [];
  for (const c of (Array.isArray(raw.clients) ? raw.clients : [])) {
    if (!c || typeof c !== 'object') continue;
    const products: Product[] = [];
    const seen = new Set<string>();
    for (const item of (Array.isArray(c.items) ? c.items : [])) {
      if (!item || !item.productId) continue;
      const base = catalogue.get(String(item.productId));
      if (!base || seen.has(base.id)) continue; // an item pointing at a deleted product
      seen.add(base.id);
      products.push({ ...base, kind: normalizeKind(item.kind), crate: normalizeCrate(item.crate) });
    }
    clients.push({ id: String(c.id || ''), name: cleanName(c.name, 'Client'), products });
  }
  return clients;
}

// Migrate the OLDEST per-tab shape ({focaccia,brioche,sourdough}.clients + market) into the clients-with-
// products shape. Clients with the same name across tabs/market are merged; each market list becomes a group
// referencing those clients. Best-effort: market-only product names cannot become products and are dropped
// — safe because no real data exists in that shape (placeholders only).
function migrateLegacy(raw: any, marketOrderTitle: string): CalculatorConfig {
  const byName = new Map<string, Client>(); // lowercased name -> client object { id, name, products }
  const order: Client[] = [];

  function findOrCreateClient(name: unknown, idHint?: unknown): Client {
    const key = String(name || 'Client').trim().toLowerCase();
    let client = byName.get(key);
    if (!client) {
      client = { id: String(idHint || 'c-' + (key.replace(/\s+/g, '-') || 'client')), name: cleanName(name, 'Client'), products: [] };
      byName.set(key, client);
      order.push(client);
    }
    return client;
  }

  for (const tab of TABS) {
    const tabConf = raw[tab];
    if (!tabConf || !Array.isArray(tabConf.clients)) continue;
    for (const legacyClient of tabConf.clients) {
      if (!legacyClient || typeof legacyClient !== 'object') continue;
      const client = findOrCreateClient(legacyClient.name, legacyClient.id);
      for (const p of (Array.isArray(legacyClient.products) ? legacyClient.products : [])) {
        const np = normalizeProduct({ ...p, recipeId: tab });
        if (np && !client.products.some(x => x.id === np.id)) client.products.push(np);
      }
    }
  }

  const groups = legacyMarketLists(raw.market, marketOrderTitle).map((list: any, li: number) => {
    const clientIds: string[] = [];
    for (const mc of (Array.isArray(list.clients) ? list.clients : [])) {
      const client = findOrCreateClient(mc && mc.name, mc && mc.id);
      if (!clientIds.includes(client.id)) clientIds.push(client.id);
    }
    return { id: String(list.id || 'g-' + li), title: cleanName(list.title, marketOrderTitle), clientIds };
  });

  return assemble(order, { ...raw, whatsappLists: undefined, groups });
}

// Pull the legacy market section into a flat list of {id,title,clients} shapes.
function legacyMarketLists(market: any, marketOrderTitle: string): any[] {
  if (!market || typeof market !== 'object') return [];
  if (Array.isArray(market.lists)) return market.lists;
  if (Array.isArray(market.clients)) {
    return [{ id: 'list-market', title: market.title || marketOrderTitle, clients: market.clients }];
  }
  return [];
}

// Produce a safe, well-formed config from arbitrary (e.g. Firestore) input. A shared-catalogue document (with
// a top-level `products`) is migrated into the current shape; a current document (clients[].products) is
// validated; an oldest per-tab document is migrated; missing/garbage input falls back to the default so the
// app always renders. `marketOrderTitle` is read only by the oldest shape (see the header).
//
// ⚠️ The catalogue branch must come FIRST: a document written by v1.5.0–v1.21.x carries BOTH a top-level
// products[] AND a stale clients[].products[] left behind as a revert window back then. The stale copy is
// deliberately ignored — `items` is what those versions actually maintained.
//
// ⚠️ Rollback safety: a document in the CURRENT shape has clients[].products and no top-level products[],
// which is exactly the shape the pre-v1.5.0 code migrated from. A phone still running an older version
// therefore reads it correctly instead of finding an empty address book.
export function normalizeConfig(raw: unknown, marketOrderTitle: string = 'Market order'): CalculatorConfig {
  const base = cloneConfig(DEFAULT_CONFIG);
  if (!raw || typeof raw !== 'object') return base;
  const doc = raw as any;

  if (Array.isArray(doc.products)) return assemble(migrateCatalogue(doc), doc);

  // Current shape: each client owns the products it orders.
  if (Array.isArray(doc.clients)) {
    return assemble(doc.clients.map(normalizeClient).filter(Boolean) as Client[], doc);
  }

  // Oldest per-tab + market shape.
  if (doc.focaccia || doc.brioche || doc.sourdough || doc.market) {
    return migrateLegacy(doc, marketOrderTitle);
  }

  return base;
}
