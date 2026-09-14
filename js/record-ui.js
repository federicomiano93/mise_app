// record-ui.js — the small pieces every RECORD form is built from: a labelled field, the
// weekday ticks, the Cancel/Save row, and the one way a failed write is reported.
//
// ⚠️ SHARED since 13 Sep 2026. They lived in js/orders/mgmt-ui.js, used by the Settings
// panel and the two record forms. The ingredient card is now also opened from the
// Catalogue (Federico: «semplicemente apri una scheda ingrediente come in fornitori ed
// ingredienti»), and a feature may not import another feature's folder — so the pieces the
// cards need came here, and mgmt-ui.js re-exports them for Orders unchanged.
//
// ⚠️ NOTHING HERE READS A ROLE. The one role gate of those screens (Delete) stays in
// mgmt-ui.js, beside the row that draws it.

import { t, localeTag } from './i18n.js';
import { el } from './dom.js';
import { alertDialog } from './confirm-dialog.js';

// The weekday keys as STORED on a supplier. ⚠️ English, and it must stay English:
// this is data, not a phrase — a supplier's deliveryDays is matched against these
// strings, so translating them stops a Monday supplier matching a Monday.
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function field(labelText, input) {
  return el('label', { class: 'mgmt-field' }, [el('span', { class: 'mgmt-field-label', text: labelText }), input]);
}

// Build one weekday checkbox group (used for both delivery days and order days).
export function makeDayChecks(selectedDays) {
  return WEEKDAYS.map(day => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = (selectedDays || []).includes(day);
    cb.dataset.day = day;
    return el('label', { class: 'day-check' }, [cb, el('span', { text: day.slice(0, 3) })]);
  });
}

export function checkedDays(checks) {
  return checks.map(l => l.querySelector('input')).filter(c => c.checked).map(c => c.dataset.day);
}

export function formActions(saveBtn, onCancel) {
  return el('div', { class: 'mgmt-form-actions' }, [
    el('button', { type: 'button', class: 'btn-secondary', onClick: () => onCancel?.() }, t('ui.cancel')),
    saveBtn,
  ]);
}

// Report a failed write. Every write in these panels used to drop its promise, so a
// rejection (network down, or a Firestore rule refusing the payload) left the
// operator looking at an unchanged row with no idea anything had gone wrong.
//
// A dialog, not a status line: these screens are full-screen overlays, so anything
// behind them would never be read. alertDialog sits at z-index 10000, above the overlay.
//
// ⚠️ `action` IS A KEY, NOT A WORD. It used to be the English verb dropped into an
// English sentence — «Could not save "Mozzarella"» — so a failed write on an Italian
// screen answered in English. One whole sentence per verb, because the grammar around
// it is not the same in the two languages.
export async function reportFailure(actionKey, name, err) {
  console.error(`${actionKey} failed:`, err);
  await alertDialog(
    t(`orders.failed.${actionKey}`, { name }),
    { title: t('orders.notSaved') },
  );
}

// "10 Aug 2026" from an ISO stamp. Anything unreadable falls back to the raw
// value rather than to "Invalid Date", which tells the reader nothing.
export function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' });
}
