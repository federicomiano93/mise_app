// ingredient-create.js — add an ingredient that is not in the records yet: from a recipe row in
// the Catalogue, and from a supplier's own order screen in Orders (a supplier preset).
//
// Lives in js/ root because TWO features open it, and a feature may not import another's folder.
// The layer's class is a PARAMETER for the same reason: the Catalogue hosts the card in
// `.pick-overlay rec-host`, but on the Orders page `.pick-overlay` (z-index 60, tokens.css) would
// sit UNDER `.supplier-detail` (z-index 600), and orders.html does not load records.css, whose
// rules are scoped to `.rec-host`. orders.css styles `.mgmt-*` directly and `.mgmt-overlay` sits
// at z 650, so Orders passes 'mgmt-overlay' and the header takes Orders' own look.
//
// Federico, 13 Sep 2026: «quando voglio associare un ingrediente di una ricetta ad un
// ingrediente in anagrafica per il prezzo, se non c'è in anagrafica fammelo inserire
// direttamente dalla ricerca degli ingredienti», and, asked how: «semplicemente apri una
// scheda ingrediente come in fornitori ed ingredienti». So this is THAT card — the one in
// js/ingredient-record-form.js — not a lighter copy of it: price for whoever may see money,
// allergens, nutrition, and «+ Nuovo fornitore».
//
// ⚠️ AN OVERLAY ABOVE THE RECIPE EDITOR, NEVER A SWAP. The editor's working copy lives only in
// its closure; replacing it would throw away every row typed so far. The card sits on top, and
// closing it — saved or not — leaves the editor exactly as it was.
//
// ⚠️ NO MONEY IS READ BY THE CREATE PATH. The catalogue loads no prices
// (tests/catalogue-no-money.test.mjs): a NEW ingredient has none to show, and the price box
// inside the card is the card's own, drawn only for somebody who may write one (mayWritePrices).
// The EDIT path (openIngredientEdit, below) is opened only from Orders, which holds the prices;
// it reads the price document itself only if Orders' snapshot has not arrived yet.
//
// ⚠️ IT ASKS NO PERMISSION ITSELF. The row that opens it is offered only where
// js/records.js mayEditRecords() says yes; the rules decide the save regardless (P2).

import { t } from './i18n.js';
import { el } from './dom.js';
import { confirmDialog } from './confirm-dialog.js';
import { currentSession } from './firebase.js';
import { allergensOn, nutritionOn } from './venue-features.js';
import { outputLanguage } from './market.js';
import { categoryChoices, unitChoices, packChoices } from './record-choices.js';
import { buildIngredientForm } from './ingredient-record-form.js';
import { buildSupplierForm } from './supplier-record-form.js';
import {
  mayWritePrices, saveIngredientWithPrice, saveSupplierRecord, readIngredientPrice,
} from './record-data.js';
import { itemWithPrice, needsPriceRead } from './ingredient-edit-model.js';
import { isPackaging } from './ingredient-kind.js';
import { snapshotFields, snapshotChanged } from './form-dirty.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

const CATALOGUE_LAYER = 'pick-overlay rec-host';

// The catalogue's suppliers as the card wants them: a list of { id, name, … }.
function supplierList(suppliers) {
  if (Array.isArray(suppliers)) return suppliers.filter(s => s && s.id);
  return Object.entries(suppliers || {}).map(([id, s]) => ({ ...s, id: s?.id || id }));
}

// The catalogue's ingredients as a plain list (it keeps them as { id: ingredient }).
function ingredientList(ingredients) {
  return Array.isArray(ingredients) ? ingredients : Object.values(ingredients || {});
}

// One full-screen layer. In the Catalogue, `.rec-host` is what records.css scopes the cards'
// styles to, so they reach these cards and nothing else on the page. Hosted in Orders'
// `.mgmt-overlay` the header wears Orders' classes (the ones registry.js overlay() draws), so
// the card looks like every other level of «Fornitori e ingredienti».
// `action` is the card's ONE Save, the header pill the form hands up as `form.headerSave`.
function layer({ title, body, onBack, layerClass, action = null }) {
  const orders = layerClass.split(' ').includes('mgmt-overlay');
  const node = el('div', {
    class: layerClass, role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
  }, [
    el('header', { class: orders ? 'app-header orders-header' : 'app-header' }, [
      el('span', { class: 'app-header-slot' }, [
        el('button', {
          class: orders ? 'app-icon-btn orders-icon-btn' : 'app-icon-btn',
          type: 'button', 'aria-label': t('ui.back'), icon: BACK_ICON, onclick: onBack,
        }),
      ]),
      el('div', { class: orders ? 'app-header-title orders-header-title' : 'app-header-title' }, [el('h1', { text: title })]),
      el('span', { class: 'app-header-slot' }, action ? [action] : []),
    ]),
    el('div', { class: 'mgmt-scroll' }, [body]),
  ]);
  document.body.appendChild(node);
  return node;
}

// «+ Nuovo fornitore» inside the card: one more layer above it. Resolves with { id, name }
// once saved, or null.
function createSupplier(layers, layerClass) {
  return new Promise(resolve => {
    let node = null;
    const close = (value) => {
      node?.remove();
      const at = layers.indexOf(node);
      if (at >= 0) layers.splice(at, 1);
      resolve(value);
    };
    const form = buildSupplierForm({
      item: null,
      save: saveSupplierRecord,
      onDone: saved => close(saved),
    });
    // P20: Back with typing asks first, like every other level here. It used to close at
    // once — and so did the Cancel beside Save — losing a half-typed supplier silently.
    let snapshot = null;
    node = layer({
      layerClass,
      title: t('orders.newSupplier'),
      onBack: async () => {
        if (typedInto(snapshot, node) && !(await confirmDiscard())) return;
        close(null);
      },
      body: form,
      action: form.headerSave,
    });
    snapshot = snapshotFields(form);
    layers.push(node);
  });
}

// P20: Back never throws typing away without asking — the same question, and the same
// snapshot helper, registry.js uses. A save in flight is typing being saved, so it is not
// «unsaved» (the header Save is disabled while it runs).
function typedInto(snapshot, layerNode) {
  if (!snapshot || layerNode?.querySelector('.app-header-save:disabled')) return false;
  return snapshotChanged(snapshot);
}

function confirmDiscard() {
  return confirmDialog({
    title: t('orders.registry.discardTitle'),
    message: t('orders.registry.discardMessage'),
    okLabel: t('ui.discard'),
    cancelLabel: t('ui.cancel'),
    danger: true,
  });
}

// Open the card for a new ingredient called `name`. Resolves with { id, name, kind } once it is
// saved, or with null when somebody backs out.
//
// `presetSupplierId` pre-selects the supplier (Orders opens it from a supplier's own screen).
// ⚠️ `storedCategories` is undefined from the Catalogue, ON PURPOSE: the list lives in
// config/orders, which a Catalogue-only venue cannot read. Orders, which has read it, passes it
// in; either way the menus also offer every category and unit the ingredients already use.
export function openIngredientCreate({
  name = '', suppliers, ingredients, presetSupplierId = null,
  storedCategories = undefined, layerClass = CATALOGUE_LAYER,
}) {
  return new Promise(resolve => {
    const layers = [];
    let settled = false;
    let saved = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      layers.splice(0).forEach(node => node.remove());
      resolve(saved);
    };

    const location = currentSession().location;
    const language = outputLanguage(location);
    const known = ingredientList(ingredients);
    // Assigned below, once the layer exists; Back only runs after that.
    let snapshot = null;
    let cardLayer = null;
    const leave = async () => {
      if (typedInto(snapshot, cardLayer) && !(await confirmDiscard())) return;
      saved = null;
      finish();
    };

    const form = buildIngredientForm({
      item: null,
      presetName: name,
      presetKind: 'ingredient',
      // ⚠️ NO «Tipo» MENU HERE. A recipe row may only be linked to FOOD (catalogue-model.js
      // linkOptions): filed as packaging, the row would point at an item with no allergens and
      // no way back to it from the chooser. Found by the code review of 14 Sep 2026. The card has
      // no «Tipo» menu any more (29 Sep 2026): a new item takes the kind it is added from.
      suppliers: supplierList(suppliers),
      preset: presetSupplierId,
      categories: categoryChoices({ stored: storedCategories, ingredients: known, language }),
      orderUnits: unitChoices({ ingredients: known, language }),
      packs: packChoices({ ingredients: known, language }),
      // ⚠️ THE SAME TWO DECISIONS registry.js makes, from the same root answers.
      mayPrice: mayWritePrices(),
      panels: { allergens: allergensOn(location), nutrition: nutritionOn(location), packPhoto: false },
      actions: {
        saveIngredient: async (id, payload, record, writePrice) => {
          const newId = await saveIngredientWithPrice(id, payload, record, writePrice);
          globalThis.window?.dispatchEvent(new CustomEvent('mise:action', { detail: 'ingredient-saved' }));
          if (record) globalThis.window?.dispatchEvent(new CustomEvent('mise:action', { detail: 'price-saved' }));
          saved = { id: newId, name: payload.name, kind: payload.kind };
        },
        // A new ingredient has no history to show, and the card asks only for an existing one.
        priceHistory: async () => [],
        // The packet photograph stays on «Fornitori e ingredienti»: it spends money per tap,
        // and it is switched on there.
        packPhotoOn: () => false,
        createSupplier: () => createSupplier(layers, layerClass),
      },
      onDone: finish,
    });

    cardLayer = layer({
      layerClass,
      title: t('orders.newIngredient'),
      body: form,
      onBack: leave,
      action: form.headerSave,
    });
    layers.push(cardLayer);
    // Taken once the form is in place, to tell «typed into» from «just opened».
    snapshot = snapshotFields(form);
  });
}

// Open the card for an EXISTING ingredient, from a screen that is not «Fornitori e ingredienti»
// (Orders: tap the name on a row — Federico, 1 Oct 2026: «voglio accedere alla scheda modifica
// ingrediente dalla scheda ordini così non devo tornare indietro nella scheda ingredienti e
// fornitori»). Resolves with { id, name } once it is saved, or with null when somebody backs
// out (or the ingredient is deleted from inside the card).
//
// `item` is the ingredient AS THE CARD OPENS IT: the document merged with its price document
// (Orders holds both and merges them with withPrices). `pricesLoaded` says whether that merge
// has really seen the price collection; when it has not, and this person may write prices,
// the price document is read here before anything is drawn.
//
// ⚠️ A CARD WITHOUT THE STORED PRICE IS NEVER SHOWN. Its price boxes would be empty and an
// untouched Save would then erase the price (pricePatch writes nulls over a merge). If the
// read fails this REJECTS and the caller says «could not be opened» — it never falls back to
// an empty price. Somebody who may not write prices gets no price block at all, so nothing
// can be erased and nothing is read.
//
// `actions` carries what only the calling feature can do, because this file may not import it:
//   priceHistory(id)     — the append-only price history reader (Orders' getPriceHistory)
//   deleteIngredient(id) — present only for whoever may delete; draws the card's bin (and does
//                          the feature's own clean-up, e.g. the order draft)
//   unitChanged({ id, from, item }) — optional: the card replaced the order unit `from`; the feature
//                          freezes the open draft line in it (Orders: draft.js freezeUnitInDraft)
// Everything else is the same as the Fornitori screen's own card: title, fields, price, panels,
// «+ Nuovo fornitore», and the question before typing is thrown away (P20).
export async function openIngredientEdit({
  item, suppliers, ingredients, storedCategories = undefined, layerClass = CATALOGUE_LAYER,
  pricesLoaded = false, actions = {},
}) {
  const mayPrice = mayWritePrices();
  const stored = needsPriceRead({ mayPrice, pricesLoaded })
    ? itemWithPrice(item, await readIngredientPrice(item.id))
    : item;

  return new Promise(resolve => {
    const layers = [];
    let settled = false;
    let saved = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      layers.splice(0).forEach(node => node.remove());
      resolve(saved);
    };

    const location = currentSession().location;
    const language = outputLanguage(location);
    const known = ingredientList(ingredients);
    let snapshot = null;
    let cardLayer = null;
    const leave = async () => {
      if (typedInto(snapshot, cardLayer) && !(await confirmDiscard())) return;
      saved = null;
      finish();
    };

    const form = buildIngredientForm({
      item: stored,
      suppliers: supplierList(suppliers),
      // `current` keeps the ingredient's own category / unit / pack word on the menu even when
      // no other ingredient uses it, exactly as the Fornitori screen's card does.
      categories: categoryChoices({ stored: storedCategories, ingredients: known, language, current: stored.category }),
      orderUnits: unitChoices({ ingredients: known, language, current: stored.unit }),
      packs: packChoices({ ingredients: known, language, current: stored.packUnit }),
      mayPrice,
      panels: { allergens: allergensOn(location), nutrition: nutritionOn(location), packPhoto: false },
      actions: {
        saveIngredient: async (id, payload, record, writePrice, meta) => {
          const savedId = await saveIngredientWithPrice(id, payload, record, writePrice);
          globalThis.window?.dispatchEvent(new CustomEvent('mise:action', { detail: 'ingredient-saved' }));
          if (record) globalThis.window?.dispatchEvent(new CustomEvent('mise:action', { detail: 'price-saved' }));
          saved = { id: savedId, name: payload.name };
          // The calling feature owns the draft; this file may not import it. Its failure is only logged.
          if (meta && meta.unitChangedFrom && typeof actions.unitChanged === 'function') {
            Promise.resolve(actions.unitChanged({ id: savedId, from: meta.unitChangedFrom, item: { ...stored, ...payload } }))
              .then(undefined, err => console.error('The draft line kept an old unit:', err));
          }
        },
        priceHistory: actions.priceHistory || (async () => []),
        // As on the create path: the packet photograph spends money per tap and stays on
        // «Fornitori e ingredienti».
        packPhotoOn: () => false,
        createSupplier: () => createSupplier(layers, layerClass),
        ...(typeof actions.deleteIngredient === 'function' ? { deleteIngredient: actions.deleteIngredient } : {}),
      },
      onDone: finish,
    });

    cardLayer = layer({
      layerClass,
      title: isPackaging(stored) ? t('orders.editPackaging') : t('orders.editIngredient'),
      body: form,
      onBack: leave,
      action: form.headerSave,
    });
    layers.push(cardLayer);
    snapshot = snapshotFields(form);
  });
}
