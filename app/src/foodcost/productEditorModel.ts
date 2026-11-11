import {
  PRODUCT_MODEL, isLegacyProduct, normalizeProduct, vatSelection, weighingAllowed,
} from '@mise/shared/foodcost-model';
import type {
  LineUnit, PackUnit, Product, ProductComponent, ProductDraft, SellingMode,
} from '@mise/shared/foodcost-model';
import { normalizeLossPct } from '@mise/shared/catalogue-model';
import { startWeighing, typeCooked, typeRaw } from '@mise/shared/foodcost-weighing';
import type { WeighingState } from '@mise/shared/foodcost-weighing';
import { kilosFromTyped, typedFromKilos } from '@mise/shared/line-quantity';
import type { KiloLineUnit } from '@mise/shared/line-quantity';

// The product being edited, as the editor holds it: a WORKING COPY (P20) in which every number is
// the TEXT of its box, so «12.» (a number half typed) and an empty box both survive a render, and
// every line has an id of its own that lives only here.
//
// ⚠️ THE LINE ID IS WHAT KEEPS A ROW STANDING while its quantity is typed: keyed by position, a
// removal above it would hand the focus to another line; keyed by content, every keystroke would
// rebuild the row and the finger would lose the box after one digit (found driving the current
// app on 13 Sep 2026). It is stripped before the product is saved or costed.

// ⚠️ A RECIPE LINE IS STORED IN KILOS, WHATEVER THE BOX SHOWS — but the box OPENS IN GRAMS, every time (current app
// a7f4c75d, 8 Nov 2026). Production showed 16 lines in 11 products 1000× too big: staff typed grams (as in the ingredient
// lines right below) into a box that opened on kg; and a correct 3.233 kg read as «3.233», which an Italian takes for three
// thousand. `unit` is memory only, never saved: `qty` is the text in that unit, and `qtyKg` is worked out from both.
// ⚠️ UNTOUCHED MEANS UNCHANGED: `stored` is the line as it opened (its box text and the kilos behind it). While the box and the
// unit are as they opened, the stored kilos are handed back EXACTLY — the old kilo box saved what was typed, so a 0.0416667
// read through grams (six decimals) would come back 0.041667 and a rename-only save would record a margin point.
export type WorkingComponent =
  | { key: string; kind: 'recipe'; recipeId: string; qty: string; unit: KiloLineUnit; stored?: { qty: string; kg: number } }
  | { key: string; kind: 'ingredient'; ingredientId: string; qty: string; unit: LineUnit };

// The unit every recipe line opens on.
export const RECIPE_LINE_OPENS_IN: KiloLineUnit = 'g';

export interface WorkingPackaging {
  key: string;
  ingredientId: string;
  qty: string;
}

export interface Working {
  name: string;
  components: WorkingComponent[];
  packaging: WorkingPackaging[];
  sellingMode: SellingMode | '';
  piecesPerBatch: string;
  packSize: string;
  packUnit: PackUnit | '';
  labourMinutes: string;
  labourPeople: string;
  sellingPrice: string;
  // The VAT menu's value: '' (not chosen), a rate of the country's menu, or 'other' (the free box).
  vatSelect: string;
  // The free box. Only read while the menu says 'other'.
  vatOther: string;
  foodCostTarget: string;
  // The product's own weighing (model 3), as the text of its two «Cottura» boxes. `rawText` is null while the raw box FOLLOWS the lines'
  // total (nothing typed apart: the saved product holds no `rawGrams`); `cookedText` is empty for «no loss».
  rawText: string | null;
  cookedText: string;
  // What the boxes opened with: their text and the exact grams behind it. ⚠️ UNTOUCHED MEANS UNCHANGED (the recipe line's `stored`
  // pattern): a box shows at most one decimal, so a box left as it opened hands the stored grams back EXACTLY — 416.6667 stays
  // 416.6667 through a rename-only save, which then records no margin point.
  opened: OpenedWeighing;
  // A person typed in a «Cottura» box (or tapped «use the total») on THIS screen. Only then does a product made of one recipe write
  // that recipe's weighing too: opening a converted product and saving it must not move the recipe.
  cookingTyped: boolean;
}

export interface OpenedWeighing {
  rawText: string | null;
  rawGrams: number | null;
  cookedText: string;
  cookedGrams: number | null;
}

// The numbers a product carries in a box, by the name the save limits know them by.
export type NumberField =
  | 'piecesPerBatch' | 'packSize' | 'labourMinutes' | 'labourPeople' | 'sellingPrice' | 'vatRate' | 'foodCostTarget';

// The two weights of «Cottura», which Save checks the way it checks a number box (weighingAllowed).
export type WeightField = 'rawGrams' | 'cookedGrams';

let lastKey = 0;
export const newLineKey = (): string => `line-${++lastKey}`;

const text = (value: number | null): string => (value === null ? '' : String(value));
const qtyText = (value: number): string => (value ? String(value) : '');
// A recipe line's stored kilos as its box shows them, in grams ('' for nothing yet, so the placeholder shows).
const recipeQtyText = (kilos: number): string => typedFromKilos(kilos, RECIPE_LINE_OPENS_IN);

// A stored recipe line as the working copy opens it: in grams, remembering what it opened with.
function openRecipeLine(recipeId: string, qtyKg: number): WorkingComponent {
  const qty = recipeQtyText(qtyKg);
  return { key: newLineKey(), kind: 'recipe', recipeId, qty, unit: RECIPE_LINE_OPENS_IN, stored: { qty, kg: qtyKg } };
}

// A stored weight as its box opens: at most one decimal, written like the recipe lines write grams (String, a «.», no grouping).
export function weightText(grams: number): string {
  return String(Math.round(grams * 10) / 10);
}

const NOTHING_WEIGHED: OpenedWeighing = { rawText: null, rawGrams: null, cookedText: '', cookedGrams: null };

export function emptyWorking(): Working {
  return {
    name: '', components: [], packaging: [], sellingMode: '', piecesPerBatch: '', packSize: '', packUnit: '',
    labourMinutes: '', labourPeople: '', sellingPrice: '', vatSelect: '', vatOther: '', foodCostTarget: '',
    rawText: null, cookedText: '', opened: NOTHING_WEIGHED, cookingTyped: false,
  };
}

// A new product started from a recipe (draftFromRecipe): its name and its lines, nothing else. ⚠️ The
// recipe's amount is 0 in the draft, and a 0 shows as an EMPTY box (qtyText), never as a typed «0».
export function workingFromDraft(draft: ProductDraft): Working {
  return {
    ...emptyWorking(),
    name: draft.name,
    components: draft.components.map<WorkingComponent>(line => openRecipeLine(line.recipeId, line.qtyKg)),
  };
}

// A copy of a stored product to edit. The caller passes currentProduct(...): a product saved before model 3 holds finished
// kilos on its recipe lines, and only the converted one holds the raw kilos the lines now mean. ⚠️ A STORED RATE THE COUNTRY'S MENU LACKS opens on «another
// rate», unchanged (vatSelection decides, in a test of its own).
export function workingFrom(product: Product, country: unknown): Working {
  const vat = vatSelection(product.vatRate, country);
  const opened: OpenedWeighing = {
    rawText: product.rawGrams === null ? null : weightText(product.rawGrams),
    rawGrams: product.rawGrams,
    cookedText: product.cookedGrams === null ? '' : weightText(product.cookedGrams),
    cookedGrams: product.cookedGrams,
  };
  return {
    name: product.name,
    components: product.components.map<WorkingComponent>(line => (line.kind === 'ingredient'
      ? { key: newLineKey(), kind: 'ingredient', ingredientId: line.ingredientId, qty: qtyText(line.qty), unit: line.unit }
      : openRecipeLine(line.recipeId, line.qtyKg))),
    packaging: product.packaging.map(line => ({ key: newLineKey(), ingredientId: line.ingredientId, qty: qtyText(line.qtyPcs) })),
    sellingMode: product.sellingMode ?? '',
    piecesPerBatch: text(product.piecesPerBatch),
    packSize: text(product.packSize),
    packUnit: product.packUnit ?? '',
    labourMinutes: text(product.labourMinutes),
    labourPeople: text(product.labourPeople),
    sellingPrice: text(product.sellingPrice),
    vatSelect: vat.select,
    vatOther: vat.other,
    foodCostTarget: text(product.foodCostTarget),
    rawText: opened.rawText,
    cookedText: opened.cookedText,
    opened,
    cookingTyped: false,
  };
}

// What a box holds → the number it stands for: null for an empty box, NaN for something that is not a
// number (which the save limits then refuse, naming the box).
// ⚠️ A COMMA TYPED IS A DECIMAL POINT: an Italian keyboard offers one, and the box is plain text (a
// number box returns '' for «12,5» in some browsers, which would read as «empty»).
export function readNumber(raw: string): number | null {
  const value = raw.trim().replace(',', '.');
  if (value === '') return null;
  return /^(\d+\.?\d*|\.\d+)$/.test(value) ? Number(value) : Number.NaN;
}

// A line's amount: anything that is not a plain number counts as nothing, like the current app's
// `Number(value) || 0` (and never a negative one, which the rules would refuse).
export function readQty(raw: string): number {
  const value = readNumber(raw);
  return value !== null && Number.isFinite(value) ? value : 0;
}

// A recipe line's kilos: the stored kilos, exactly, while the line is as it opened; else what its box says, read in the unit
// beside it (kilosFromTyped — six decimals at most, so 522 g is 0.522 kg, never 0.5220000000001).
export function recipeLineKg(line: { qty: string; unit: KiloLineUnit; stored?: { qty: string; kg: number } }): number {
  if (line.stored && line.qty === line.stored.qty && line.unit === RECIPE_LINE_OPENS_IN) return line.stored.kg;
  return kilosFromTyped(readQty(line.qty), line.unit);
}

export function vatRateOf(working: Working): number | null {
  if (working.vatSelect === 'other') return readNumber(working.vatOther);
  return working.vatSelect === '' ? null : Number(working.vatSelect);
}

// Whether each box that depends on the way of selling is on the page. ⚠️ A box that is not shown
// holds a value that means nothing: Save clears it rather than asking about a box nobody can find.
export function piecesShown(working: Working): boolean {
  return working.sellingMode === 'piece' || (working.sellingMode === 'pack' && working.packUnit === 'pcs');
}

export function packSizeShown(working: Working): boolean {
  return working.sellingMode === 'pack';
}

export function isShown(working: Working, field: NumberField): boolean {
  if (field === 'piecesPerBatch') return piecesShown(working);
  if (field === 'packSize') return packSizeShown(working);
  return true;
}

// A «Cottura» box → grams: the stored grams, exactly, while the box is as it opened; else what it says (empty → null, not a number → NaN).
function weightOf(text: string | null, openedText: string | null, openedGrams: number | null): number | null {
  if (text === openedText) return openedGrams;
  return text === null ? null : readNumber(text);
}

// How far a raw weight typed may sit from the lines' total and still count as the total, in grams.
const FOLLOWS_TOTAL_G = 0.05;

// Whether a raw box's text means «the lines' total»: empty, or within 0.05 g of it (compared with the EXACT total, not the one-decimal
// figure the box shows). Text that is not a number is a weight typed apart.
export function followsTotal(text: string, totalGrams: number): boolean {
  const typed = readNumber(text);
  return typed === null || Math.abs(typed - totalGrams) <= FOLLOWS_TOTAL_G;
}

// The raw box handed back to following the total when what it holds means that — at blur AND at Save, so Save never depends on the
// box having lost the focus first. ⚠️ A BOX LEFT AS IT OPENED is not touched (a stored raw weight 0.03 g off the total stays what it
// was), and the SAME object comes back when nothing changes, so a caller can tell.
export function settleRaw(working: Working, totalGrams: number): Working {
  const text = working.rawText;
  if (text === null || text === working.opened.rawText || !followsTotal(text, totalGrams)) return working;
  return { ...working, rawText: null };
}

// What the raw box shows: the text typed, else the lines' total (at most one decimal), empty while there is nothing to total.
export function rawBoxText(working: Working, totalGrams: number): string {
  if (working.rawText !== null) return working.rawText;
  return totalGrams > 0 ? weightText(totalGrams) : '';
}

// The first weight of «Cottura» the rules would refuse, or null.
export function firstBadWeight(product: Product): WeightField | null {
  if (!weighingAllowed(product.rawGrams)) return 'rawGrams';
  if (!weighingAllowed(product.cookedGrams)) return 'cookedGrams';
  return null;
}

const recipeOf = (recipes: Readonly<Record<string, unknown>>, recipeId: string): unknown =>
  (Object.prototype.hasOwnProperty.call(recipes, recipeId) ? recipes[recipeId] : null);

// The recipe a product made of ONE recipe writes its weighing onto (plan 2b: «come oggi»): only when a person typed in «Cottura» on
// this screen, the product has exactly one line, that line is a recipe, and the recipe exists. Packaging does not count as a line.
// The raw weight is the product's (typed apart, else the lines' total), the cooked one its own ('' for none: no patch).
export function recipeWeighing(
  working: Working, totalGrams: number, recipes: Readonly<Record<string, unknown>>,
): { recipeId: string; state: WeighingState } | null {
  if (!working.cookingTyped || working.components.length !== 1) return null;
  const [line] = working.components;
  if (!line || line.kind !== 'recipe') return null;
  const recipe = recipeOf(recipes, line.recipeId);
  if (!recipe) return null;
  const product = toProduct(settleRaw(working, totalGrams), '');
  // ⚠️ The lines' total is a float product (2.01 kg → 2009.9999999999998 g): a thousandth of a gram keeps that noise off the recipe.
  const raw = product.rawGrams ?? Math.round(totalGrams * 1000) / 1000;
  const cooked = product.cookedGrams;
  return {
    recipeId: line.recipeId,
    state: typeCooked(typeRaw(startWeighing(recipe), raw), cooked === null || Number.isNaN(cooked) ? '' : cooked),
  };
}

// The first recipe line (in order) whose recipe loses weight in the oven, while the cooked box is empty: a new product made of a
// recipe that loses weight must never show a no-loss cost unannounced (third code review).
export function recipeLossHint(working: Working, recipes: Readonly<Record<string, unknown>>): { name: string; pct: number } | null {
  if (working.cookedText.trim() !== '') return null;
  for (const line of working.components) {
    if (line.kind !== 'recipe') continue;
    const recipe = recipeOf(recipes, line.recipeId);
    if (!recipe || typeof recipe !== 'object') continue;
    const pct = normalizeLossPct((recipe as { lossPct?: unknown }).lossPct);
    if (pct > 0) return { name: String((recipe as { name?: unknown }).name ?? ''), pct };
  }
  return null;
}

// The working copy → a product, with its numbers read from their boxes and its lines stripped of
// the ids that live only here. A number that is not a number stays NaN (it is refused at Save, and
// every cost model reads it as «not said»).
export function toProduct(working: Working, id: string, name: string = working.name): Product {
  const components = working.components.map<ProductComponent>(line => (line.kind === 'ingredient'
    ? { kind: 'ingredient', ingredientId: line.ingredientId, qty: readQty(line.qty), unit: line.unit }
    : { recipeId: line.recipeId, qtyKg: recipeLineKg(line) }));
  return {
    id,
    name,
    components,
    packaging: working.packaging.map(line => ({ ingredientId: line.ingredientId, qtyPcs: readQty(line.qty) })),
    sellingMode: working.sellingMode === '' ? null : working.sellingMode,
    piecesPerBatch: readNumber(working.piecesPerBatch),
    packSize: readNumber(working.packSize),
    packUnit: working.packUnit === '' ? null : working.packUnit,
    sellingPrice: readNumber(working.sellingPrice),
    vatRate: vatRateOf(working),
    foodCostTarget: readNumber(working.foodCostTarget),
    labourMinutes: readNumber(working.labourMinutes),
    labourPeople: readNumber(working.labourPeople),
    rawGrams: weightOf(working.rawText, working.opened.rawText, working.opened.rawGrams),
    cookedGrams: weightOf(working.cookedText, working.opened.cookedText, working.opened.cookedGrams),
    noWeightLoss: false,
    model: PRODUCT_MODEL,
  };
}

// The product the cost models are handed while it is typed: normalised, so a half-typed box is
// «not said» and never NaN.
export function costable(working: Working, id: string): Product {
  return normalizeProduct(toProduct(working, id)) as Product;
}

// Whether a product must wait for the recipes and the prices before it is opened.
// ⚠️ A legacy product with recipe lines is converted WITH the recipes and the prices; converted before they arrive, a recipe
// line would keep its finished kilos and Save would write them as raw kilos — a cost too low, for ever. A legacy product with
// ingredient lines only converts without the tables. ProductEditor says how long it waits.
export function waitsForTables(product: Product): boolean {
  return isLegacyProduct(product) && product.components.some(line => line.kind !== 'ingredient');
}

// Whether every recipe on the product's lines is in `recipes`: this phone's copy, all there will be with no signal or with a
// recipes stream that died — so ProductEditor opens the form on it only then.
export function recipesOnLinesHere(product: Product, recipes: Readonly<Record<string, unknown>>): boolean {
  return product.components.every(line => line.kind === 'ingredient' || recipes[line.recipeId] !== undefined);
}

// A number for a sentence, in the interface language's own digits and decimal sign, with no
// grouping (a percentage never needs one). The same options as the list's percentText.
export function plainNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(value);
}

// The text box each number lives in. The VAT rate's box is the free one, shown while the menu says
// «another rate».
export const NUMBER_KEY = {
  piecesPerBatch: 'piecesPerBatch',
  packSize: 'packSize',
  labourMinutes: 'labourMinutes',
  labourPeople: 'labourPeople',
  sellingPrice: 'sellingPrice',
  vatRate: 'vatOther',
  foodCostTarget: 'foodCostTarget',
} as const satisfies Record<NumberField, keyof Working>;

export function isNumberField(field: string): field is NumberField {
  return Object.prototype.hasOwnProperty.call(NUMBER_KEY, field);
}

// A number emptied: what Save does to a value in a box that is not shown.
export function clearNumber(working: Working, field: NumberField): Working {
  return { ...working, [NUMBER_KEY[field]]: '' };
}
