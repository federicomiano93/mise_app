// invoice-import-stubs.mjs — what tests/invoice-import-flow.test.mjs puts in place of the three modules
// js/orders/invoice-import-screen.js cannot load under node: the data layer (it imports the Firebase SDK from
// a CDN), mgmt-ui.js (it reaches the same data layer) and the confirm dialog (it needs a real DOM).
// Each one hands the call to a function the test sets on globalThis, so the test decides what the
// «database» answers and records what was asked.

export const BACK_ICON = '<svg></svg>';

export async function confirmDialog(opts) {
  globalThis.__dialogs.push({ kind: 'confirm', ...opts });
  const answer = globalThis.__confirmAnswer;
  return typeof answer === 'function' ? answer(opts) : (answer ?? true);
}
export async function alertDialog(message, opts = {}) {
  globalThis.__dialogs.push({ kind: 'alert', message, ...opts });
}

export const createImportedSupplier = (...a) => globalThis.__inv.createImportedSupplier(...a);
export const linkSupplierVat = (...a) => globalThis.__inv.linkSupplierVat(...a);
export const freshSuppliers = (...a) => globalThis.__inv.freshSuppliers(...a);
export const freshIngredientsForSupplier = (...a) => globalThis.__inv.freshIngredientsForSupplier(...a);
export const invoicePointIds = (...a) => globalThis.__inv.invoicePointIds(...a);
export const freshPrice = (...a) => globalThis.__inv.freshPrice(...a);
export const runImportBatches = (...a) => globalThis.__inv.runImportBatches(...a);
