// mgmt-ui.js — the small pieces the Settings screen and the Fornitori screen BOTH use.
//
// They were local functions inside management.js while that one file held the
// settings AND the supplier/ingredient records. The records moved out to their own
// screen (js/orders/registry.js), and these came here rather than being copied:
// `reportFailure` is called from the settings AND from both record forms, and a
// second copy of "how this app reports a failed write" is a second wording waiting
// to drift. `field`, `mgmtRow` and the day checks are shared by the two forms.
//
// ⚠️ SINCE 13 Sep 2026 THE FORM PIECES LIVE IN js/record-ui.js, because the ingredient
// card is also opened from the Catalogue, which may not import this folder. They are
// re-exported below, so nothing in Orders had to change the way it imports them.
//
// ⚠️ NOTHING HERE READS A ROLE except mgmtRow, and it asks canManageHere() for the
// ONE irreversible action. Everything else in this file is drawn for everybody, which
// is the deliberate design of the records screen (see registry.js).

import { t } from '../i18n.js';
import { el } from './dom.js';
import { canManageHere } from './firebase-orders.js';
import { confirmDialog } from './confirm-dialog.js';
import { reportFailure } from '../record-ui.js';

export {
  WEEKDAYS, field, makeDayChecks, checkedDays, formActions, reportFailure, shortDate,
} from '../record-ui.js';

export const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// A row with three actions: Edit, Deactivate/Activate (reversible), Delete
// (permanent). Deactivate confirms only when hiding; Delete always confirms with
// a strong, irreversible warning and is styled low-key in danger red (P20).
//
// ⚠️ STAFF GET THE FIRST TWO AND NOT THE THIRD, and the pair is the point.
// Deactivating hides a supplier from the order screen and can be undone in one
// tap; deleting takes it away from everybody, along with every ingredient filed
// under it. So the reversible half of the job stays with whoever is working and
// only the irreversible half needs the owner — the alternative, hiding both,
// would send somebody to find the owner to tidy a list.
export function mgmtRow(name, meta, active, onEdit, onToggle, onDelete) {
  const actions = [
    el('button', { type: 'button', class: 'mgmt-link', onClick: onEdit }, t('ui.edit')),
    el('button', { type: 'button', class: 'mgmt-link', onClick: async () => {
      // Confirm before deactivating (guards against accidental taps);
      // reactivating is harmless and needs no confirmation.
      if (active) {
        const ok = await confirmDialog({
          message: t('orders.deactivateConfirm', { name }),
          okLabel: t('ui.deactivate'), danger: true,
          cancelLabel: t('ui.cancel'),
        });
        if (!ok) return;
      }
      try { await onToggle(); }
      catch (err) { await reportFailure(active ? 'deactivate' : 'activate', name, err); }
    } }, active ? t('ui.deactivate') : t('ui.activate')),
  ];

  if (canManageHere()) {
    actions.push(el('button', { type: 'button', class: 'mgmt-link danger', onClick: async () => {
      const ok = await confirmDialog({
        message: t('orders.deleteConfirm', { name }),
        okLabel: t('ui.delete'), danger: true,
        cancelLabel: t('ui.cancel'),
      });
      if (!ok) return;
      try { await onDelete(); }
      catch (err) { await reportFailure('delete', name, err); }
    } }, t('ui.delete')));
  }

  return el('div', { class: 'mgmt-item' + (active ? '' : ' inactive') }, [
    el('div', { class: 'mgmt-item-main' }, [
      el('span', { class: 'mgmt-item-name', text: name }),
      el('span', { class: 'mgmt-item-meta', text: meta }),
    ]),
    el('div', { class: 'mgmt-item-actions' }, actions),
  ]);
}
