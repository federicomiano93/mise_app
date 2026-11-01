// The ingredient card must not resend `active` for an existing item (28 Oct 2026).
//
// «Disattiva» / «Riattiva» now sits on the list row and saves on the tap. The card's save is a merge
// write: if it still sent `active: <what the card was opened with>`, a card left open on another
// phone would undo that tap on its next Save. So `active` goes out ONLY for a new item (true) and
// is left out for an existing one, whatever it holds — the stored value stays.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { installDom, type, click } from './helpers/form-dom.mjs';

const STUB = new URL('./helpers/session-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './firebase.js' && String(context.parentURL).endsWith('/js/ingredient-record-form.js')) {
      return { url: STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

installDom();
globalThis.__miseTestSession = { location: { id: 'loc-test', country: 'IT', language: 'en' } };
const { buildIngredientForm } = await import('../js/ingredient-record-form.js');
const { setCurrency } = await import('../js/currency.js');
setCurrency('€');

const BASE = { id: 'I1', name: 'Farina', supplierId: 'S1', brand: '', category: 'Other', kind: 'ingredient', unit: 'kg', weight: '', priceUnit: 'kg', pricePerUnit: 2 };

async function saveCard(item) {
  const saves = [];
  const root = buildIngredientForm({
    item,
    suppliers: [{ id: 'S1', name: 'Molino' }],
    presetKind: null,
    mayPrice: true,
    categories: ['Panetteria'],
    packs: ['busta'],
    panels: { allergens: false, nutrition: false },
    actions: {
      saveIngredient: async (id, payload) => { saves.push({ id, payload }); },
      priceHistory: async () => [],
      packPhotoOn: () => false,
    },
    onDone: () => {},
  });
  if (!item) {
    const name = (function find(n) {
      if (n.tagName === 'INPUT' && n.classList.contains('mgmt-input')) return n;
      for (const c of n.children) { const f = find(c); if (f) return f; }
      return null;
    }(root));
    type(name, 'Farina 00');
  }
  click(root.headerSave);
  await new Promise(r => setImmediate(r));
  return saves[saves.length - 1];
}

test('an existing ACTIVE item is saved without `active`', async () => {
  const saved = await saveCard({ ...BASE, active: true });
  assert.ok(saved, 'the card saved');
  assert.equal('active' in saved.payload, false);
});

test('an existing SWITCHED-OFF item is saved without `active` too, so the card cannot undo the row', async () => {
  const saved = await saveCard({ ...BASE, active: false });
  assert.ok(saved, 'the card saved');
  assert.equal('active' in saved.payload, false);
});

test('an existing item with the Cartone format is saved without `active`', async () => {
  const saved = await saveCard({
    ...BASE, active: false, unit: 'cartone', packUnit: 'busta', weight: '2.5kg', packCount: 4,
    pricePerUnit: 5, casePrice: 20, caseCount: 4, caseItemUnit: 'pcs', unitWeightKg: 2.5, priceUnit: 'pcs',
  });
  assert.ok(saved, 'the card saved');
  assert.equal('active' in saved.payload, false);
});

test('a NEW item is saved with active: true', async () => {
  const saved = await saveCard(null);
  assert.ok(saved, 'the card saved');
  assert.equal(saved.payload.active, true);
});
