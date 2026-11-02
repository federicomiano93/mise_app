// product-usage-model.js — the decision behind functions/product-usage.js. PURE, so a test can run it.
//
// Only the owner of the kitchen: everybody else who merges reads the products themselves.
export function mayAskProductUsage(access) {
  return access === 'owner-kitchen';
}

// ⚠️ IT RETURNS NAMES ONLY. Whatever else a product holds is money the caller may not read.
// The two lists are the ones js/orders/ingredient-merge.js findUsage() walks for everybody else.
export function productNamesUsing(ingredientId, products) {
  const names = [];
  for (const product of Array.isArray(products) ? products : []) {
    const parts = [
      ...(Array.isArray(product?.components) ? product.components : []),
      ...(Array.isArray(product?.packaging) ? product.packaging : []),
    ];
    if (parts.some(part => part && part.ingredientId === ingredientId)) {
      names.push(typeof product.name === 'string' ? product.name : '');
    }
  }
  return names;
}
