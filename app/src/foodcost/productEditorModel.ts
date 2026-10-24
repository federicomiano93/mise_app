import {
  PRODUCT_MODEL, normalizeProduct, vatSelection,
} from '@mise/shared/foodcost-model';
import type {
  LineUnit, PackUnit, Product, ProductComponent, ProductDraft, SellingMode,
} from '@mise/shared/foodcost-model';

// The product being edited, as the editor holds it: a WORKING COPY (P20) in which every number is
// the TEXT of its box, so «12.» (a number half typed) and an empty box both survive a render, and
// every line has an id of its own that lives only here.
//
// ⚠️ THE LINE ID IS WHAT KEEPS A ROW STANDING while its quantity is typed: keyed by position, a
// removal above it would hand the focus to another line; keyed by content, every keystroke would
// rebuild the row and the finger would lose the box after one digit (found driving the current
// app on 13 Sep 2026). It is stripped before the product is saved or costed.

export type WorkingComponent =
  | { key: string; kind: 'recipe'; recipeId: string; qty: string }
  | { key: string; kind: 'ingredient'; ingredientId: string; qty: string; unit: LineUnit };

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
}

// The numbers a product carries in a box, by the name the save limits know them by.
export type NumberField =
  | 'piecesPerBatch' | 'packSize' | 'labourMinutes' | 'labourPeople' | 'sellingPrice' | 'vatRate' | 'foodCostTarget';

let lastKey = 0;
export const newLineKey = (): string => `line-${++lastKey}`;

const text = (value: number | null): string => (value === null ? '' : String(value));
const qtyText = (value: number): string => (value ? String(value) : '');

export function emptyWorking(): Working {
  return {
    name: '', components: [], packaging: [], sellingMode: '', piecesPerBatch: '', packSize: '', packUnit: '',
    labourMinutes: '', labourPeople: '', sellingPrice: '', vatSelect: '', vatOther: '', foodCostTarget: '',
  };
}

// A new product started from a recipe (draftFromRecipe): its name and its lines, nothing else. ⚠️ The
// recipe's amount is 0 in the draft, and a 0 shows as an EMPTY box (qtyText), never as a typed «0».
export function workingFromDraft(draft: ProductDraft): Working {
  return {
    ...emptyWorking(),
    name: draft.name,
    components: draft.components.map<WorkingComponent>(line => ({
      key: newLineKey(), kind: 'recipe', recipeId: line.recipeId, qty: qtyText(line.qtyKg),
    })),
  };
}

// A copy of a stored product to edit. ⚠️ A STORED RATE THE COUNTRY'S MENU LACKS opens on «another
// rate», unchanged (vatSelection decides, in a test of its own).
export function workingFrom(product: Product, country: unknown): Working {
  const vat = vatSelection(product.vatRate, country);
  return {
    name: product.name,
    components: product.components.map<WorkingComponent>(line => (line.kind === 'ingredient'
      ? { key: newLineKey(), kind: 'ingredient', ingredientId: line.ingredientId, qty: qtyText(line.qty), unit: line.unit }
      : { key: newLineKey(), kind: 'recipe', recipeId: line.recipeId, qty: qtyText(line.qtyKg) })),
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

// The working copy → a product, with its numbers read from their boxes and its lines stripped of
// the ids that live only here. A number that is not a number stays NaN (it is refused at Save, and
// every cost model reads it as «not said»).
export function toProduct(working: Working, id: string, name: string = working.name): Product {
  const components = working.components.map<ProductComponent>(line => (line.kind === 'ingredient'
    ? { kind: 'ingredient', ingredientId: line.ingredientId, qty: readQty(line.qty), unit: line.unit }
    : { recipeId: line.recipeId, qtyKg: readQty(line.qty) }));
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
    model: PRODUCT_MODEL,
  };
}

// The product the cost models are handed while it is typed: normalised, so a half-typed box is
// «not said» and never NaN.
export function costable(working: Working, id: string): Product {
  return normalizeProduct(toProduct(working, id)) as Product;
}

// The recipes on the product, each once, in the order they first appear: one pair of weighings each.
export function recipeIdsOn(working: Working): string[] {
  const ids: string[] = [];
  for (const line of working.components) {
    if (line.kind === 'recipe' && !ids.includes(line.recipeId)) ids.push(line.recipeId);
  }
  return ids;
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
