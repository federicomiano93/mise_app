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
import { supplierLabel } from './supplier-label.js';
import { normalizeVat } from './vat-number.js';
import { field, formActions, makeDayChecks, checkedDays, reportFailure } from './record-ui.js';

// item     — the supplier being edited, or null for a new one
// save     — (id | null, payload) → Promise resolving with the supplier's id
// onDone   — ({ id, name }) once saved; `name` is the label the app will SHOW (short name
//            when there is one), because callers put it on screen straight away
//
// ⚠️ THE SAVE BUTTON IS NOT IN THE FORM. It is the header pill (.app-header-save) and the form
// exposes it as `form.headerSave`; the screen that draws the header puts it in the right-hand
// slot. The form keeps ownership of its state (it disables itself while the write runs), so the
// header cannot drift from it. Back is the screen's own and does what Cancel used to.
export function buildSupplierForm({ item, save, onDone }) {
  const name = el('input', { type: 'text', class: 'mgmt-input', value: item?.name || '' });
  const shortName = el('input', { type: 'text', class: 'mgmt-input', maxlength: '60', value: item?.shortName || '', 'aria-describedby': 'supplier-short-name-hint' });
  const category = el('input', { type: 'text', class: 'mgmt-input', value: item?.category || '' });
  const phone = el('input', { type: 'tel', class: 'mgmt-input', value: item?.phone || '', placeholder: t('orders.eg.phone') });
  const email = el('input', { type: 'email', class: 'mgmt-input', value: item?.email || '' });
  // The company's VAT number («P.IVA»), how an invoice finds its supplier. Optional.
  const vatNumber = el('input', { type: 'text', class: 'mgmt-input', maxlength: '30', autocomplete: 'off', value: item?.vatNumber || '', placeholder: t('orders.eg.vatNumber') });

  const deliveryChecks = makeDayChecks(item?.deliveryDays);
  const orderChecks = makeDayChecks(item?.orderDays);

  const saveBtn = el('button', { type: 'button', class: 'app-header-save', onClick: async () => {
    if (saveBtn.disabled) return;
    if (!name.value.trim()) { name.focus(); return; }
    saveBtn.disabled = true;
    const payload = {
      name: name.value.trim(),
      // '' when blank, never omitted: a merge write must be able to CLEAR a short name.
      shortName: shortName.value.trim(),
      category: category.value.trim(),
      phone: phone.value.trim(),
      email: email.value.trim(),
      deliveryDays: checkedDays(deliveryChecks),
      orderDays: checkedDays(orderChecks),
      active: item ? item.active !== false : true,
      // The canonical form (js/vat-number.js) — the one shape the invoice import matches on. '' clears it.
      vatNumber: normalizeVat(vatNumber.value),
    };
    let id;
    try { id = await save(item?.id || null, payload); }
    catch (err) {
      saveBtn.disabled = false;                       // let them try again
      await reportFailure('save', payload.name, err);
      return;
    }
    onDone?.({ id: id || item?.id || null, name: supplierLabel(payload) });
  } }, t('ui.save'));

  const form = el('div', { class: 'mgmt-form' }, [
    field(t('orders.field.name'), name),
    field(t('orders.field.shortName'), shortName),
    el('p', { class: 'notif-note', id: 'supplier-short-name-hint', text: t('orders.field.shortNameHint') }),
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
    field(t('orders.field.vatNumber'), vatNumber),
    formActions(),
  ]);
  form.headerSave = saveBtn;
  return form;
}
