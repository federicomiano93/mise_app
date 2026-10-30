// The forty-two TypeScript models and the js/ files the live app runs today must stay the SAME
// thing, until the switch to Mise 2 retires the js/ ones. The behaviour specs next to each model
// run every test against both; this file checks what a behaviour test cannot see — that the two
// export the same names, the same constants, the same frozen-ness and the same function shapes.
//
// membership.ts, location-id.ts, pastries-model.ts, price-model.ts, currency.ts,
// inventory-value.ts, catalogue-model.ts, recipe-cost-model.ts and foodcost-model.ts are NOT paired here:
// they are partial or adapted ports (the pure half of
// js/roles.js and js/location.js; everything in js/pastries/pastries-model.js except weekdayLabel and
// weekdayShortLabel, which look a word up in the interface dictionary that in Mise 2 belongs to the
// app; js/price-model.js whole, adapted the same way pack-format is (the dictionary functions take the translator, formatMoney and formatRate take the money); js/currency.js without
// the module variable that holds the venue's money, which Mise 2 hands to the functions instead; and
// everything in js/inventory/inventory-value.js except formatTotal, which writes the total with that
// same module variable; the part of js/catalogue/catalogue-model.js that Food cost reads; everything in
// js/catalogue/recipe-cost-model.js except the two functions that look a word up in the dictionary; and
// everything in js/foodcost/foodcost-model.js except blockerText, likewise), so the js/ files export more
// or differently by design; their specs run every test against both files instead (pastries-model.spec.ts,
// price-model.spec.ts, currency.spec.ts, inventory-value.spec.ts, catalogue-model.spec.ts,
// recipe-cost-model.spec.ts and foodcost-model.spec.ts also compare the names, constants, frozen-ness and
// function shapes of everything they do port).
//
// The Calculator's partial ports are not paired either, for the same reason: calculator-config.ts (it leaves
// out the save path and `orderPrefillLabel`), log-model.ts (the legacy migration and `dayLabel`, which has
// the pure `dayLabelParts` instead), guided-model.ts (whole, but `stepRows`, `overdueText` and `progressText` take their words / the translator as an argument) and zoom-steps.ts (the storage and DOM halves); their
// specs (calculator-config.spec.ts, log-model.spec.ts, guided-model via calculator-recipe-source.spec.ts,
// zoom-steps.spec.ts) compare what they do port. calculator-tab-keys.ts is new in Mise 2 and has no original.
// recipe-link.ts is a partial port too (step 3d-7): it leaves out the page addresses of the current app (`recipeHash`,
// `foodCostHref`, `recipeHref`, `ordersHref`, `catalogueOriginFromHash`) and adds four things with no original; its spec
// compares names and shapes itself.
// recipe-export.ts is a partial port too (new in step "export"): it leaves out `buildPdfBlob` and `buildXlsxBlob`,
// which `import()` the vendored PDF and spreadsheet libraries that belong to the app, and adds `LIBRARY_ERROR` and
// `libraryError` (private to the original's loader); its spec compares names, constants, frozen-ness and shapes itself.
// calculator-order-prefill.ts is not paired: `prefillNote` takes the translate function as a third argument (the
// original reads the interface dictionary), so its arity differs by design; its spec compares names, constant and
// shapes itself. client-order-model.ts and client-order-history.ts are not paired either: `orderRows` takes the word for a
// deleted product as a third argument, and `linesLabel` / `emptyWords` take the translate function as their last (the
// originals read the interface dictionary), so those arities differ by design; their specs compare names, constants and
// shapes themselves. recipe-allergen-model.ts is not paired: it leaves out `incompleteText` and `blockingIngredients` takes
// the word for an unknown ingredient as a third argument (the original reads the interface dictionary); its spec compares
// names, constants and shapes itself. market.ts (with the label vocabulary), venue-features.ts, recipe-label-model.ts, label-template-model.ts and photo-model.ts ARE
// paired: they are full ports. calculator-recipe-text.ts is paired although it differs from the original in ONE input (the line called
// `Flour uniqua blue`, one venue's data): the exports are the same, and its spec says where the text differs.
// order-text.ts is paired although its flat list sorts numerically where the original does not (finding F-5, fixed in
// the port only): the exports are the same, and order-text.spec.ts says where the two differ.
// supplier-label.ts, vat-number.ts, favourite-suppliers.ts, record-choices.ts and category-batches.ts ARE paired (step 3e-1,
// the Suppliers page): full ports. ingredient-search.ts IS paired since step 3f-1 (it was a partial port, `normalizeText` and
// `filterSuppliers` only, until the row builders could use the ported order-text). Also paired since 3f-1, the pure core of
// the Orders section: send-routes.ts, supplier-order.ts, orders-config.ts, line-supplier.ts, order-text.ts and order-day.ts,
// all full ports. NOT paired, for the usual reasons: day.ts (adapted: the seven functions that spell a day take the translate
// function as their last argument, and the original's WEEKDAY_LONG is private), no-supplier.ts (adapted: `noSupplier` and
// `orderSuppliers` are handed the pseudo-supplier's word, and the constant `NO_SUPPLIER` built at import is left out) and
// archive.ts (adapted since 3f-4: everything is ported, but `recordedName` takes the deleted-ingredient word as a fourth argument); their specs compare names and shapes themselves.
// sent-check.ts IS paired (step 3f-2, placing an order): a full port of js/orders/sent-check.js. suggestions.ts and
// history-window.ts ARE paired (step 3f-2b, the suggestion hint and its live window of orders-history): full ports. untold-changes.ts WAS a
// partial port (only `confirmedEntries`) until step 3f-6 and is paired now (see below). order-day-choices.ts is new in Mise 2 (the seven-day choice of a supplier with no order days) and has
// no original, like calculator-tab-keys.ts, so there is nothing to pair it with; delivery-check.ts is new in Mise 2 as well (step 3f-5, the venue's
// «check deliveries» switch) and has no original either. deliveries.ts IS paired (step 3f-5, Incoming): a full port of js/orders/deliveries.js.
// reminders.ts, untold-changes.ts, alert-dismissal.ts and holidays-it.ts ARE paired (step 3f-6, Reminders and the bell): full ports of
// js/orders/reminders.js, untold-changes.js (completed in 3f-6: `askedToday`, `orderedToday` and `untoldChanges` joined
// `confirmedEntries`), alert-dismissal.js and holidays-it.js.
// holidays.ts and notifications.ts are NOT paired (step 3f-6, adapted on purpose): holidays.ts has no module state, no localStorage and no
// fetch — the UK list is an argument (with a built-in default that now runs to 2028, finding F-8) and the download and its cache move to
// Mise 2's data layer — and adds `ukDatesFromFeed`, `HOLIDAY_COUNTRIES` and the exported constants, leaving out `refreshHolidays`;
// notifications.ts is a partial port (only `computeAlerts` and `isReminderDue`; the renderers and `maybeNotify` become screen code) whose
// alerts are DATA, not words (finding F-6: the original pours English «tomorrow», English weekdays and raw ISO dates into Italian
// sentences). Their specs (holidays.spec.ts, notifications.spec.ts) run the shared assertions against both files and test the rest on the port.
// order-image.ts and send-chooser.ts are NOT paired (step 3f-3, sending): partial ports — the order picture's layout without
// the canvas, the File and the share sheet, and the send chooser's offers, links and photo batch without its screen
// (`chooseAndSend`); their specs compare names, constants and shapes themselves.
// ingredient-edit-model.ts IS paired (step 3e-2, the ingredient card's product data): a full port. allergen-terms.ts and
// allergen-match.ts ARE paired too (step 3e-4, the pack-list allergen reader): full ports. records.ts IS paired (T15, the Recipe
// catalogue's create-ingredient door): a full port. pack-format.ts is NOT: its
// `formatSummary` and `formatChanged` take the translate function and the locale as arguments; order-request-model.ts is a
// partial port (`remainingIds`); its spec compares names and shapes. ingredient-merge.ts IS paired since step 3e-7 (the merge itself).
// catalogue-photo-model.ts is not paired: it exports its table of sentences as well (`CATALOGUE_PHOTO_KEYS`, private in the
// original) and leaves out the sizes the original re-exports from photo-model; its spec compares what it ports.
// invoice-zip/reasons.ts, py-compat.ts, sha256.ts, classify.ts and pricing.ts ARE paired (step 3e-6, slice A1, the first
// half of the invoice reader): full ports of js/orders/invoice-zip/. invoice-zip/keywords.ts is NOT: it holds the seven keyword
// patterns that classify.js keeps private (classify.ts imports them from it and still exports exactly what the original does), so
// it has no js/ counterpart; invoice-zip/keywords.spec.ts pins it against invoice-import/classify.py instead.
// invoice-zip/fatturapa.ts, products.ts and selection.ts ARE paired too (slice A2, the second half of the reader): full ports.
// work-week.ts, price-changes-model.ts and invoice-import-model.ts ARE paired too (step 3e-6, slice B1a, the import model): full
// ports of js/orders/work-week.js, price-changes-model.js and invoice-import-model.js. invoice-import-plan.ts IS paired too (slice B1b,
// the screen's plan: the batches of writes, the decisions, the re-check, the summary): a full port of js/orders/invoice-import-plan.js.
// invoice-zip/build-import.ts is NOT: it is a PARTIAL port (decision T5) — every export of js/orders/invoice-zip/build-import.js
// except `buildImportFromInvoices`, which opens the zip archives with fflate and so stays app code
// (app/src/suppliers/invoiceImport/buildImport.ts), plus `buildImportFromRead`, the original's body after the reading. Its
// specs run every test against both files instead (selection.spec.ts and the app's buildImport.spec.ts).
//
// ⚠️ IT IS WHAT CATCHES A FIX MADE TO js/ AND FORGOTTEN HERE. A constant changed in one file
// (a new allergen, a new push kind, a new card) is invisible to every behavioural test that does
// not happen to read it; here it is a red line naming the export.

import { describe, expect, test } from 'vitest';
import * as joinCode from './join-code';
import * as pushModel from './push-model';
import * as homeCards from './home-cards';
import * as awayModel from './away-model';
import * as allergenModel from './allergen-model';
import * as sections from './sections';
import * as firebaseTarget from './firebase-target';
import * as localData from './local-data';
import * as sameData from './same-data';
import * as errorModel from './error-model';
import * as deviceModel from './device-model';
import * as usageModel from './usage-model';
import * as pastriesLogModel from './pastries-log-model';
import * as pastriesLock from './pastries-lock';
import * as packSize from './pack-size';
import * as orderUnit from './order-unit';
import * as ingredientName from './ingredient-name';
import * as orderCost from './order-cost';
import * as inventoryModel from './inventory-model';
import * as inventoryOutbox from './inventory-outbox';
import * as inventoryPurchases from './inventory-purchases';
import * as vatRates from './vat-rates';
import * as ingredientKind from './ingredient-kind';
import * as productLimits from './product-limits';
import * as vatGuide from './vat-guide';
import * as foodcostWeighing from './foodcost-weighing';
import * as calculatorDoughMath from './calculator-dough-math';
import * as calculatorRecipeSource from './calculator-recipe-source';
import * as calculatorRecipeText from './calculator-recipe-text';
import * as calculatorOrderText from './calculator-order-text';
import * as confirmFlow from './confirm-flow';
import * as logTime from './log-time';
import * as venueFeatures from './venue-features';
import * as market from './market';
import * as recipeLabelModel from './recipe-label-model';
import * as labelTemplateModel from './label-template-model';
import * as photoModel from './photo-model';
import * as supplierLabel from './supplier-label';
import * as vatNumber from './vat-number';
import * as favouriteSuppliers from './favourite-suppliers';
import * as recordChoices from './record-choices';
import * as categoryBatches from './category-batches';
import * as ingredientEditModel from './ingredient-edit-model';
import * as allergenTerms from './allergen-terms';
import * as allergenMatch from './allergen-match';
import * as records from './records';
import * as invoiceReasons from './invoice-zip/reasons';
import * as invoicePyCompat from './invoice-zip/py-compat';
import * as invoiceSha256 from './invoice-zip/sha256';
import * as invoiceClassify from './invoice-zip/classify';
import * as invoicePricing from './invoice-zip/pricing';
import * as invoiceFatturapa from './invoice-zip/fatturapa';
import * as invoiceProducts from './invoice-zip/products';
import * as invoiceSelection from './invoice-zip/selection';
import * as workWeek from './work-week';
import * as priceChangesModel from './price-changes-model';
import * as invoiceImportModel from './invoice-import-model';
import * as invoiceImportPlan from './invoice-import-plan';
import * as ingredientMerge from './ingredient-merge';
import * as sendRoutes from './send-routes';
import * as supplierOrder from './supplier-order';
import * as ordersConfig from './orders-config';
import * as lineSupplier from './line-supplier';
import * as orderText from './order-text';
import * as ingredientSearch from './ingredient-search';
import * as orderDay from './order-day';
import * as sentCheck from './sent-check';
import * as suggestions from './suggestions';
import * as historyWindow from './history-window';
import * as deliveries from './deliveries';
import * as reminders from './reminders';
import * as untoldChanges from './untold-changes';
import * as alertDismissal from './alert-dismissal';
import * as holidaysIt from './holidays-it';
import * as legacyJoinCode from '../../js/join-code.js';
import * as legacyPushModel from '../../js/push-model.js';
import * as legacyHomeCards from '../../js/home-cards.js';
import * as legacyAwayModel from '../../js/away-model.js';
import * as legacyAllergenModel from '../../js/allergen-model.js';
import * as legacySections from '../../js/sections.js';
import * as legacyFirebaseTarget from '../../js/firebase-target.js';
import * as legacyLocalData from '../../js/local-data.js';
import * as legacySameData from '../../js/same-data.js';
import * as legacyErrorModel from '../../js/error-model.js';
import * as legacyDeviceModel from '../../js/device-model.js';
import * as legacyUsageModel from '../../js/usage-model.js';
import * as legacyPastriesLogModel from '../../js/pastries/pastries-log-model.js';
import * as legacyPastriesLock from '../../js/pastries/pastries-lock.js';
import * as legacyPackSize from '../../js/pack-size.js';
import * as legacyOrderUnit from '../../js/order-unit.js';
import * as legacyIngredientName from '../../js/ingredient-name.js';
import * as legacyOrderCost from '../../js/order-cost.js';
import * as legacyInventoryModel from '../../js/inventory/inventory-model.js';
import * as legacyInventoryOutbox from '../../js/inventory/inventory-outbox.js';
import * as legacyInventoryPurchases from '../../js/inventory/inventory-purchases.js';
import * as legacyVatRates from '../../js/vat-rates.js';
import * as legacyIngredientKind from '../../js/ingredient-kind.js';
import * as legacyProductLimits from '../../js/foodcost/product-limits.js';
import * as legacyVatGuide from '../../js/foodcost/vat-guide.js';
import * as legacyFoodcostWeighing from '../../js/foodcost/foodcost-weighing.js';
import * as legacyCalculatorDoughMath from '../../js/calculator-dough-math.js';
import * as legacyCalculatorRecipeSource from '../../js/calculator-recipe-source.js';
import * as legacyCalculatorRecipeText from '../../js/calculator-recipe-text.js';
import * as legacyCalculatorOrderText from '../../js/calculator-order-text.js';
import * as legacyConfirmFlow from '../../js/confirm-flow.js';
import * as legacyLogTime from '../../js/log-time.js';
import * as legacyVenueFeatures from '../../js/venue-features.js';
import * as legacyMarket from '../../js/market.js';
import * as legacyRecipeLabelModel from '../../js/catalogue/recipe-label-model.js';
import * as legacyLabelTemplateModel from '../../js/catalogue/label-template-model.js';
import * as legacyPhotoModel from '../../js/photo-model.js';
import * as legacySupplierLabel from '../../js/supplier-label.js';
import * as legacyVatNumber from '../../js/vat-number.js';
import * as legacyFavouriteSuppliers from '../../js/orders/favourite-suppliers.js';
import * as legacyRecordChoices from '../../js/record-choices.js';
import * as legacyCategoryBatches from '../../js/orders/category-batches.js';
import * as legacyIngredientEditModel from '../../js/ingredient-edit-model.js';
import * as legacyAllergenTerms from '../../js/allergen-terms.js';
import * as legacyAllergenMatch from '../../js/allergen-match.js';
import * as legacyRecords from '../../js/records.js';
import * as legacyInvoiceReasons from '../../js/orders/invoice-zip/reasons.js';
import * as legacyInvoicePyCompat from '../../js/orders/invoice-zip/py-compat.js';
import * as legacyInvoiceSha256 from '../../js/orders/invoice-zip/sha256.js';
import * as legacyInvoiceClassify from '../../js/orders/invoice-zip/classify.js';
import * as legacyInvoicePricing from '../../js/orders/invoice-zip/pricing.js';
import * as legacyInvoiceFatturapa from '../../js/orders/invoice-zip/fatturapa.js';
import * as legacyInvoiceProducts from '../../js/orders/invoice-zip/products.js';
import * as legacyInvoiceSelection from '../../js/orders/invoice-zip/selection.js';
import * as legacyWorkWeek from '../../js/orders/work-week.js';
import * as legacyPriceChangesModel from '../../js/orders/price-changes-model.js';
import * as legacyInvoiceImportModel from '../../js/orders/invoice-import-model.js';
import * as legacyInvoiceImportPlan from '../../js/orders/invoice-import-plan.js';
import * as legacyIngredientMerge from '../../js/orders/ingredient-merge.js';
import * as legacySendRoutes from '../../js/orders/send-routes.js';
import * as legacySupplierOrder from '../../js/orders/supplier-order.js';
import * as legacyOrdersConfig from '../../js/orders/orders-config.js';
import * as legacyLineSupplier from '../../js/orders/line-supplier.js';
import * as legacyOrderText from '../../js/orders/order-text.js';
import * as legacyIngredientSearch from '../../js/orders/ingredient-search.js';
import * as legacyOrderDay from '../../js/orders/order-day.js';
import * as legacySentCheck from '../../js/orders/sent-check.js';
import * as legacySuggestions from '../../js/orders/suggestions.js';
import * as legacyHistoryWindow from '../../js/orders/history-window.js';
import * as legacyDeliveries from '../../js/orders/deliveries.js';
import * as legacyReminders from '../../js/orders/reminders.js';
import * as legacyUntoldChanges from '../../js/orders/untold-changes.js';
import * as legacyAlertDismissal from '../../js/orders/alert-dismissal.js';
import * as legacyHolidaysIt from '../../js/orders/holidays-it.js';

const PAIRS: readonly (readonly [string, object, object])[] = [
  ['join-code', joinCode, legacyJoinCode],
  ['push-model', pushModel, legacyPushModel],
  ['home-cards', homeCards, legacyHomeCards],
  ['away-model', awayModel, legacyAwayModel],
  ['allergen-model', allergenModel, legacyAllergenModel],
  ['sections', sections, legacySections],
  ['firebase-target', firebaseTarget, legacyFirebaseTarget],
  ['local-data', localData, legacyLocalData],
  ['same-data', sameData, legacySameData],
  ['error-model', errorModel, legacyErrorModel],
  ['device-model', deviceModel, legacyDeviceModel],
  ['usage-model', usageModel, legacyUsageModel],
  ['pastries-log-model', pastriesLogModel, legacyPastriesLogModel],
  ['pastries-lock', pastriesLock, legacyPastriesLock],
  ['pack-size', packSize, legacyPackSize],
  ['order-unit', orderUnit, legacyOrderUnit],
  ['ingredient-name', ingredientName, legacyIngredientName],
  ['order-cost', orderCost, legacyOrderCost],
  ['inventory-model', inventoryModel, legacyInventoryModel],
  ['inventory-outbox', inventoryOutbox, legacyInventoryOutbox],
  ['inventory-purchases', inventoryPurchases, legacyInventoryPurchases],
  ['vat-rates', vatRates, legacyVatRates],
  ['ingredient-kind', ingredientKind, legacyIngredientKind],
  ['product-limits', productLimits, legacyProductLimits],
  ['vat-guide', vatGuide, legacyVatGuide],
  ['foodcost-weighing', foodcostWeighing, legacyFoodcostWeighing],
  ['calculator-dough-math', calculatorDoughMath, legacyCalculatorDoughMath],
  ['calculator-recipe-source', calculatorRecipeSource, legacyCalculatorRecipeSource],
  ['calculator-recipe-text', calculatorRecipeText, legacyCalculatorRecipeText],
  ['calculator-order-text', calculatorOrderText, legacyCalculatorOrderText],
  ['confirm-flow', confirmFlow, legacyConfirmFlow],
  ['log-time', logTime, legacyLogTime],
  ['venue-features', venueFeatures, legacyVenueFeatures],
  ['market', market, legacyMarket],
  ['recipe-label-model', recipeLabelModel, legacyRecipeLabelModel],
  ['label-template-model', labelTemplateModel, legacyLabelTemplateModel],
  ['photo-model', photoModel, legacyPhotoModel],
  ['supplier-label', supplierLabel, legacySupplierLabel],
  ['vat-number', vatNumber, legacyVatNumber],
  ['favourite-suppliers', favouriteSuppliers, legacyFavouriteSuppliers],
  ['record-choices', recordChoices, legacyRecordChoices],
  ['category-batches', categoryBatches, legacyCategoryBatches],
  ['ingredient-edit-model', ingredientEditModel, legacyIngredientEditModel],
  ['allergen-terms', allergenTerms, legacyAllergenTerms],
  ['allergen-match', allergenMatch, legacyAllergenMatch],
  ['records', records, legacyRecords],
  ['invoice-zip/reasons', invoiceReasons, legacyInvoiceReasons],
  ['invoice-zip/py-compat', invoicePyCompat, legacyInvoicePyCompat],
  ['invoice-zip/sha256', invoiceSha256, legacyInvoiceSha256],
  ['invoice-zip/classify', invoiceClassify, legacyInvoiceClassify],
  ['invoice-zip/pricing', invoicePricing, legacyInvoicePricing],
  ['invoice-zip/fatturapa', invoiceFatturapa, legacyInvoiceFatturapa],
  ['invoice-zip/products', invoiceProducts, legacyInvoiceProducts],
  ['invoice-zip/selection', invoiceSelection, legacyInvoiceSelection],
  ['work-week', workWeek, legacyWorkWeek],
  ['price-changes-model', priceChangesModel, legacyPriceChangesModel],
  ['invoice-import-model', invoiceImportModel, legacyInvoiceImportModel],
  ['invoice-import-plan', invoiceImportPlan, legacyInvoiceImportPlan],
  ['ingredient-merge', ingredientMerge, legacyIngredientMerge],
  ['send-routes', sendRoutes, legacySendRoutes],
  ['supplier-order', supplierOrder, legacySupplierOrder],
  ['orders-config', ordersConfig, legacyOrdersConfig],
  ['line-supplier', lineSupplier, legacyLineSupplier],
  ['order-text', orderText, legacyOrderText],
  ['ingredient-search', ingredientSearch, legacyIngredientSearch],
  ['order-day', orderDay, legacyOrderDay],
  ['sent-check', sentCheck, legacySentCheck],
  ['suggestions', suggestions, legacySuggestions],
  ['history-window', historyWindow, legacyHistoryWindow],
  ['deliveries', deliveries, legacyDeliveries],
  ['reminders', reminders, legacyReminders],
  ['untold-changes', untoldChanges, legacyUntoldChanges],
  ['alert-dismissal', alertDismissal, legacyAlertDismissal],
  ['holidays-it', holidaysIt, legacyHolidaysIt],
];

const exportsOf = (module: object): Record<string, unknown> => module as Record<string, unknown>;

// The outbox of the current app got the fix of 11 Oct 2026 (PR #343, now on main), so that pair is compared in
// full like every other: a js/ regression fails here instead of being skipped.

// Whether a value, and everything inside it, is frozen — as a tree, so that a card frozen in one
// file and loose in the other is a difference even when the list around it is frozen in both.
type FrozenTree = null | { frozen: boolean; children: Record<string, FrozenTree> };

function frozenTree(value: unknown, seen: WeakSet<object> = new WeakSet()): FrozenTree {
  if (typeof value !== 'object' || value === null) return null;
  if (seen.has(value)) return { frozen: Object.isFrozen(value), children: {} };
  seen.add(value);
  const children: Record<string, FrozenTree> = {};
  for (const [key, inner] of Object.entries(value)) children[key] = frozenTree(inner, seen);
  return { frozen: Object.isFrozen(value), children };
}

describe.each(PAIRS)('parity: %s', (_name, tsModule, jsModule) => {
  const ts = exportsOf(tsModule);
  const js = exportsOf(jsModule);
  const names = Object.keys(js).sort();

  test('exports exactly the same names', () => {
    expect(Object.keys(ts).sort()).toStrictEqual(names);
  });

  test('every export is a function in both or a value in both', () => {
    for (const name of names) {
      expect(typeof ts[name], name).toBe(typeof js[name]);
    }
  });

  test('every non-function export is strictly equal', () => {
    for (const name of names) {
      if (typeof js[name] === 'function') continue;
      expect(ts[name], name).toStrictEqual(js[name]);
    }
  });

  test('frozen-ness matches for every object and array export, all the way down', () => {
    for (const name of names) {
      if (typeof js[name] !== 'object' || js[name] === null) continue;
      expect(Object.isFrozen(ts[name]), name).toBe(Object.isFrozen(js[name]));
      expect(frozenTree(ts[name]), name).toStrictEqual(frozenTree(js[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of names) {
      const mine = ts[name];
      const theirs = js[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});

test('all seventy-four models are compared', () => {
  expect(PAIRS.map(([name]) => name)).toStrictEqual(
    ['join-code', 'push-model', 'home-cards', 'away-model', 'allergen-model', 'sections', 'firebase-target', 'local-data', 'same-data',
      'error-model', 'device-model', 'usage-model', 'pastries-log-model', 'pastries-lock', 'pack-size', 'order-unit', 'ingredient-name',
      'order-cost', 'inventory-model', 'inventory-outbox', 'inventory-purchases', 'vat-rates', 'ingredient-kind', 'product-limits',
      'vat-guide', 'foodcost-weighing', 'calculator-dough-math', 'calculator-recipe-source', 'calculator-recipe-text', 'calculator-order-text',
      'confirm-flow', 'log-time', 'venue-features', 'market', 'recipe-label-model', 'label-template-model', 'photo-model',
      'supplier-label', 'vat-number', 'favourite-suppliers', 'record-choices', 'category-batches', 'ingredient-edit-model',
      'allergen-terms', 'allergen-match', 'records', 'invoice-zip/reasons', 'invoice-zip/py-compat', 'invoice-zip/sha256',
      'invoice-zip/classify', 'invoice-zip/pricing', 'invoice-zip/fatturapa', 'invoice-zip/products', 'invoice-zip/selection',
      'work-week', 'price-changes-model', 'invoice-import-model', 'invoice-import-plan', 'ingredient-merge', 'send-routes', 'supplier-order', 'orders-config', 'line-supplier', 'order-text', 'ingredient-search', 'order-day', 'sent-check', 'suggestions',
      'history-window', 'deliveries', 'reminders', 'untold-changes', 'alert-dismissal', 'holidays-it']);
});
