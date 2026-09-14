// supplier-record-form.js — one supplier's card: name, category, the days they deliver and
// the days you order, and how to reach them.
//
// ⚠️ SHARED since 13 Sep 2026. It was drawn inside js/orders/registry.js. Federico asked to
// add a missing supplier from inside an ingredient's card («quando scrivo un ingrediente e lo
// voglio associare ad un fornitore che non ho ancora inserito in anagrafica dammi la
// possibilità di inserirlo direttamente da lì») — and that card is opened from the Catalogue
// too, which may not import the Orders folder. So the card lives here, and each caller hands
// it the save and says where to go afterwards.
//
// ⚠️ IT BUILDS THE FORM, NEVER THE SCREEN AROUND IT: no header, no overlay, no navigation.
// The caller owns those, the same seam the ingredient card uses.

import { t } from './i18n.js';
import { el } from './dom.js';
import { field, formActions, makeDayChecks, checkedDays, reportFailure } from './record-ui.js';

// item     — the supplier being edited, or null for a new one
// save     — (id | null, payload) → Promise resolving with the supplier's id
// onDone   — ({ id, name }) once saved
// onCancel — backed out; nothing was written
export function buildSupplierForm({ item, save, onDone, onCancel }) {
  const name = el('input', { type: 'text', class: 'mgmt-input', value: item?.name || '' });
  const category = el('input', { type: 'text', class: 'mgmt-input', value: item?.category || '' });
  const phone = el('input', { type: 'tel', class: 'mgmt-input', value: item?.phone || '', placeholder: 'e.g. 447700900123' });
  const email = el('input', { type: 'email', class: 'mgmt-input', value: item?.email || '' });

  const deliveryChecks = makeDayChecks(item?.deliveryDays);
  const orderChecks = makeDayChecks(item?.orderDays);

  const saveBtn = el('button', { type: 'button', class: 'btn-primary', onClick: async () => {
    if (!name.value.trim()) { name.focus(); return; }
    saveBtn.disabled = true;
    const payload = {
      name: name.value.trim(),
      category: category.value.trim(),
      phone: phone.value.trim(),
      email: email.value.trim(),
      deliveryDays: checkedDays(deliveryChecks),
      orderDays: checkedDays(orderChecks),
      active: item ? item.active !== false : true,
    };
    let id;
    try { id = await save(item?.id || null, payload); }
    catch (err) {
      saveBtn.disabled = false;                       // let them try again
      await reportFailure('save', payload.name, err);
      return;
    }
    onDone?.({ id: id || item?.id || null, name: payload.name });
  } }, t('ui.save'));

  return el('div', { class: 'mgmt-form' }, [
    field(t('orders.field.name'), name),
    field(t('orders.field.category'), category),
    el('div', { class: 'mgmt-field' }, [
      el('span', { class: 'mgmt-field-label', text: t('orders.deliveryDaysWhenThey') }),
      el('div', { class: 'day-checks' }, deliveryChecks),
    ]),
    el('div', { class: 'mgmt-field' }, [
      el('span', { class: 'mgmt-field-label', text: t('orders.orderDaysWhenYou') }),
      el('div', { class: 'day-checks' }, orderChecks),
    ]),
    field(t('orders.phoneWhatsappDigitsOnly'), phone),
    field(t('orders.field.email'), email),
    formActions(saveBtn, onCancel),
  ]);
}
