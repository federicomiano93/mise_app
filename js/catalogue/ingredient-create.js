// ingredient-create.js — add an ingredient that is not in the records yet, from a recipe row.
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
// ⚠️ NO MONEY IS READ HERE. The catalogue loads no prices (tests/catalogue-no-money.test.mjs):
// a NEW ingredient has none to show, and the price box inside the card is the card's own,
// drawn only for somebody who may write one (mayWritePrices).
//
// ⚠️ IT ASKS NO PERMISSION ITSELF. The row that opens it is offered only where
// js/records.js mayEditRecords() says yes; the rules decide the save regardless (P2).

import { t } from '../i18n.js';
import { el } from './dom.js';
import { currentSession } from '../firebase.js';
import { allergensOn, nutritionOn } from '../venue-features.js';
import { buildIngredientForm } from '../ingredient-record-form.js';
import { buildSupplierForm } from '../supplier-record-form.js';
import { mayWritePrices, saveIngredientWithPrice, saveSupplierRecord } from '../record-data.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// The catalogue's suppliers as the card wants them: a list of { id, name, … }.
function supplierList(suppliers) {
  if (Array.isArray(suppliers)) return suppliers.filter(s => s && s.id);
  return Object.entries(suppliers || {}).map(([id, s]) => ({ ...s, id: s?.id || id }));
}

// One full-screen layer in the catalogue's own header. `.rec-host` is what records.css
// scopes the cards' styles to, so they reach these cards and nothing else on the page.
function layer({ title, body, onBack }) {
  const node = el('div', {
    class: 'pick-overlay rec-host', role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
  }, [
    el('header', { class: 'cat-header cat-pick-header' }, [
      el('span', { class: 'cat-pick-spacer' }, [
        el('button', { class: 'cat-icon-btn', type: 'button', 'aria-label': t('ui.back'), icon: BACK_ICON, onclick: onBack }),
      ]),
      el('div', { class: 'cat-pick-title' }, [el('h1', { text: title })]),
      el('span', { class: 'cat-pick-spacer' }),
    ]),
    el('div', { class: 'mgmt-scroll' }, [body]),
  ]);
  document.body.appendChild(node);
  return node;
}

// «+ Nuovo fornitore» inside the card: one more layer above it. Resolves with { id, name }
// once saved, or null.
function createSupplier(layers) {
  return new Promise(resolve => {
    let node = null;
    const close = (value) => {
      node?.remove();
      const at = layers.indexOf(node);
      if (at >= 0) layers.splice(at, 1);
      resolve(value);
    };
    node = layer({
      title: t('orders.newSupplier'),
      onBack: () => close(null),
      body: buildSupplierForm({
        item: null,
        save: saveSupplierRecord,
        onDone: saved => close(saved),
        onCancel: () => close(null),
      }),
    });
    layers.push(node);
  });
}

// Open the card for a new ingredient called `name`. Resolves with { id, name } once it is
// saved, or with null when somebody backs out.
export function openIngredientCreate({ name, suppliers }) {
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
    const form = buildIngredientForm({
      item: null,
      presetName: name,
      presetKind: 'ingredient',
      suppliers: supplierList(suppliers),
      preset: null,
      // ⚠️ THE SAME TWO DECISIONS registry.js makes, from the same root answers.
      mayPrice: mayWritePrices(),
      panels: { allergens: allergensOn(location), nutrition: nutritionOn(location), packPhoto: false },
      actions: {
        saveIngredient: async (id, payload, record, writePrice) => {
          const newId = await saveIngredientWithPrice(id, payload, record, writePrice);
          saved = { id: newId, name: payload.name };
        },
        // A new ingredient has no history to show, and the card asks only for an existing one.
        priceHistory: async () => [],
        // The packet photograph stays on «Fornitori e ingredienti»: it spends money per tap,
        // and it is switched on there.
        packPhotoOn: () => false,
        createSupplier: () => createSupplier(layers),
      },
      onDone: finish,
      onCancel: () => { saved = null; finish(); },
    });

    layers.push(layer({
      title: t('orders.newIngredient'),
      body: form,
      onBack: () => { saved = null; finish(); },
    }));
  });
}
