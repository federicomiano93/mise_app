import { PRODUCT_MODEL } from './foodcost-model';
import type { Product } from './foodcost-model';

// Pure and shared: Food cost's store and the recipe editor (a new recipe can make its empty card) write ONE document shape.
//
// The fields of a product document, listed BY HAND: this object becomes the Firestore document and
// the rules whitelist exactly these — spreading the product would send `id` and every save would be
// refused. `model` is always the app's: the rules refuse a save without it over a product that has
// it, so an older phone cannot delete ingredient lines and packs in silence.
export function toProductDocument(product: Product): Record<string, unknown> {
  return {
    name: product.name,
    components: product.components ?? [],
    packaging: product.packaging ?? [],
    sellingMode: product.sellingMode ?? null,
    piecesPerBatch: product.piecesPerBatch ?? null,
    packSize: product.packSize ?? null,
    packUnit: product.packUnit ?? null,
    sellingPrice: product.sellingPrice ?? null,
    vatRate: product.vatRate ?? null,
    foodCostTarget: product.foodCostTarget ?? null,
    labourMinutes: product.labourMinutes ?? null,
    labourPeople: product.labourPeople ?? null,
    // ⚠️ NEVER WRITTEN AGAIN (model 3): the product is saved WHOLE, so the key drains from every product saved. The rules
    // still whitelist it for the products the current app saved.
    // ⚠️ THE PRODUCT'S OWN WEIGHING is written only when it has a value: the rules refuse a null.
    ...(product.rawGrams !== null ? { rawGrams: product.rawGrams } : {}),
    ...(product.cookedGrams !== null ? { cookedGrams: product.cookedGrams } : {}),
    model: PRODUCT_MODEL,
    // Model 4. Written on every save (the card is saved WHOLE): the kind always, the category's id or null.
    kind: product.kind ?? 'finished',
    categoryId: product.categoryId ?? null,
  };
}
