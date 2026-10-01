// registry-main.js — entry point for suppliers.html.
//
// The thin half: it opens the listeners, hands the screen live getters, and wires
// the same save/delete calls the Settings panel used to make. Every judgement about
// what the screen LOOKS like is in registry.js and ingredient-form.js.
//
// ⚠️ IT IS A PAGE OF THE ORDERS FEATURE, not a feature of its own. Same collections,
// same `data-section="orders"` gate, same data layer — which is why it lives in
// js/orders/ and imports nothing from another feature's folder.

import { t } from '../i18n.js';
import { onSession, currentSession } from '../firebase.js';
import { outputLanguage } from '../market.js';
import { categoryChoices, unitChoices, packChoices } from '../record-choices.js';
import { withPrices } from '../price-model.js';
import { buildRegistry } from './registry.js';
import { dropDeletedIngredientFromDraft } from './draft.js';
import {
  COLLECTIONS, watchCollection, watchIngredientPrices, canManageHere,
  saveDoc, removeDoc, saveIngredientWithPrice, saveSupplierRecord, getPriceHistory,
  watchDoc, setCategoryOnMany, deleteIngredientWithPrice, mayWritePrices,
} from './firebase-orders.js';

const state = {
  suppliers: [],
  rawIngredients: [],
  ingredientPrices: {},
  ingredients: [],
  // The venue's saved category list (config/orders). null = never saved one, or not
  // loaded yet: both mean «offer the defaults».
  ingredientCategories: null,
  loaded: { ingredients: false, config: false },
};

const host = document.getElementById('registry-host');
// The page header's round «+». ⚠️ NEVER HIDDEN ON A ROLE — the dashed button it replaces
// had no gate either (js/orders/registry.js); registry.js says which word it carries.
const addBtn = document.getElementById('registry-add');

const screen = buildRegistry(
  {
    suppliers: () => state.suppliers,
    ingredients: () => state.ingredients,
    // ⚠️ THE LANGUAGE IS READ HERE, AT CALL TIME: no venue is open when this module loads.
    // The words are the venue's OUTPUT language, not the screen's (js/record-choices.js).
    // `current` is the item being edited, whose own value is always offered.
    categories: (current) => categoryChoices({
      stored: state.ingredientCategories, ingredients: state.ingredients,
      language: outputLanguage(currentSession().location), current,
    }),
    // ⚠️ Until config/orders has answered, `categories()` is only the defaults: Settings keeps
    // the delete buttons off, or a delete would overwrite the saved list with them.
    categoriesLoaded: () => state.loaded.config,
    orderUnits: (current) => unitChoices({
      ingredients: state.ingredients, language: outputLanguage(currentSession().location), current,
    }),
    packs: (current) => packChoices({
      ingredients: state.ingredients, language: outputLanguage(currentSession().location), current,
    }),
  },
  {
    // Resolves with the supplier's id, new or not: «+ Nuovo fornitore» inside an ingredient's
    // card selects the supplier it has just created.
    saveSupplier: (id, payload) => saveSupplierRecord(id, payload),
    // One call for both create and update, because the ingredient and its price
    // record have to land together or not at all — see saveIngredientWithPrice.
    // `record` is null whenever the price did not actually move.
    // ⚠️ writePrice IS PASSED THROUGH, not decided here. A batch is all-or-nothing:
    // including a write to ingredient-prices for somebody the rules refuse would
    // fail the WHOLE save, so renaming an ingredient — ordinary work — would come
    // back as a permission error with nothing on screen explaining it.
    saveIngredient: (id, payload, record, writePrice) =>
      saveIngredientWithPrice(id, payload, record, writePrice),
    priceHistory: (id) => getPriceHistory(id),
    setSupplierActive: (id, active) => saveDoc(COLLECTIONS.suppliers, id, { active }),
    setIngredientActive: (id, active) => saveDoc(COLLECTIONS.ingredients, id, { active }),
    deleteSupplier: (id) => removeDoc(COLLECTIONS.suppliers, id),
    // ⚠️ A GETTER, AND THE GATE LIVES HERE (registry.js may ask no role): the card draws its bin
    // only when this is a function, and registry.js reads it each time a card is opened, so it
    // follows the session — which arrives AFTER this module runs — and is absent for staff.
    // The ingredient and its price go in one batch; the price delete only where the person may
    // write prices (saveIngredientWithPrice's reasoning). The rules decide either way (P2).
    get deleteIngredient() {
      return canManageHere()
        ? async (id) => {
          await deleteIngredientWithPrice(id, mayWritePrices());
          // ⚠️ ALSO THE ORDER DRAFT, like the Orders path: a quantity typed for this ingredient
          // would otherwise stay in drafts/current. Not awaited — the card closes now.
          dropDeletedIngredientFromDraft(id);
        }
        : undefined;
    },
    // The shortened list and «no category» on every ingredient that used it — one batch.
    deleteCategory: (list, ids) => setCategoryOnMany(ids, 'Other',
      { name: COLLECTIONS.config, id: 'orders', data: { ingredientCategories: list } }),
  },
  {
    onChrome: ({ addLabel }) => addBtn?.setAttribute('aria-label', addLabel),
    // The tablet's right-hand pane; a phone never shows it and nothing opens in it.
    pane: document.getElementById('registry-pane'),
  },
);

addBtn?.addEventListener('click', () => screen.addCurrent());

host?.appendChild(screen.node);

// ⚠️ THE PAGE'S OWN BACK, ON A TABLET, WHILE THE PANE HOLDS TYPING: it leads away from the
// page, so it asks first (P20). A plain link otherwise — a phone never reaches this branch,
// its full-screen level covers the button.
const backLink = document.getElementById('registry-back');
backLink?.addEventListener('click', (event) => {
  if (!screen.leaveWouldAsk()) return;
  event.preventDefault();
  screen.askBeforeLeaving().then((ok) => { if (ok) location.href = backLink.href; });
});

// ── The bottom bar ───────────────────────────────────────────────────────────
//
// ⚠️⚠️ THE BUTTON CARRIES THE PERMISSION, AND THE BAR ONLY FOLLOWS IT. Hiding the
// BAR on a role is the trap v1.62.0 cost a release to: the catalogue's bar was gated
// on canManage while a photo switch was the only thing in it, and the day the allergen
// sheet moved in it would have been walled off from the counter staff it is written
// for. So the rule here is «no visible button ⇒ no bar», derived rather than typed —
// add a button that everybody may use and the bar comes back on its own.
//
// ⚠️ AND IT WAITS FOR THE SESSION. canManageHere() reads the session, which arrives a
// moment AFTER this module runs; asked once at load it answers «no» for everybody and
// the owner never sees the gear. onSession fires immediately with what is known and
// again when the location opens.
const footerEl = document.getElementById('registry-footer');
const settingsBtn = document.getElementById('registry-settings-btn');

settingsBtn?.addEventListener('click', () => screen.openSettings());

onSession(() => {
  if (!footerEl || !settingsBtn) return;
  settingsBtn.hidden = !canManageHere();
  footerEl.hidden = ![...footerEl.children].some(child => !child.hidden);
});

// ⚠️ THE ERROR IS SAID OUT LOUD. A listener that fails silently leaves an empty
// list, and an empty list on this screen reads as «this bakery has no suppliers» —
// which is exactly the wrong thing to believe while typing an order.
function liveDataLost(what) {
  return (err) => {
    console.error(`Live ${what} failed:`, err);
    const box = document.getElementById('registry-error');
    if (!box) return;
    box.hidden = false;
    box.textContent = t('orders.registry.loadFailed');
  };
}

// Suppliers and ingredients are a handful of documents and every one of them is
// needed to draw the screen, so both are unbounded — the same choice Orders makes.
watchCollection(COLLECTIONS.suppliers, list => {
  state.suppliers = list;
  screen.refresh();
}, liveDataLost('suppliers'));

// ⚠️ THE PRICES ARE A SECOND COLLECTION AND ARRIVE SEPARATELY. They moved off the
// ingredient document because Orders reads every ingredient to work at all, so a
// rate written there is a rate everybody can read (js/price-model.js). Merged in
// here so the form opens on the price it is meant to edit; an employee is refused
// that collection and simply sees no price, which is the same thing they see for
// an ingredient nobody has priced.
watchIngredientPrices(map => {
  state.ingredientPrices = map;
  if (state.loaded.ingredients) {
    state.ingredients = withPrices(state.rawIngredients, map);
    screen.refresh();
  }
});

// The venue's saved category list. A failure here is not shown on the page: the menus fall
// back to the defaults plus whatever ingredients already use, which is a usable screen.
watchDoc(COLLECTIONS.config, 'orders', (doc, fromCache) => {
  state.ingredientCategories = Array.isArray(doc?.ingredientCategories) ? doc.ingredientCategories : null;
  // ⚠️ «MISSING» COUNTS ONLY WHEN THE SERVER SAID IT. A cold start offline reports a missing
  // document from an empty cache; treating that as «loaded» would let a delete write the
  // defaults-minus-one over the venue's real list.
  if (doc !== null || !fromCache) state.loaded.config = true;
  screen.refresh();
}, err => console.error('Live category list failed:', err));

watchCollection(COLLECTIONS.ingredients, list => {
  state.rawIngredients = list;
  state.ingredients = withPrices(list, state.ingredientPrices);
  state.loaded.ingredients = true;
  screen.refresh();
}, liveDataLost('ingredients'));
