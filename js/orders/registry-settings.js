// registry-settings.js — what «Fornitori e ingredienti» lets a venue switch off.
//
// Two switches, both about the SAME question: does this business track allergens and
// nutrition at all? Federico, 23 Aug 2026: «aggiungi il settings degli ingredienti in
// modo tale che posso decidere di vedere gli allergeni e valori nutrizionali, magari
// non tutti sono interessati».
//
// ⚠️⚠️ THE ALLERGEN SWITCH TURNS OFF THE WHOLE FEATURE, NOT JUST THE FIELDS, AND THAT
// WAS HIS DECISION WHEN ASKED. Hiding only the tick boxes would leave the Catalogue
// still saying «non dichiarato» on every recipe and still offering a label, about data
// nobody can reach any more — an app promising something it can no longer do. So it
// reaches five screens: this form, the ingredient rows, the recipe's allergen card,
// the allergen sheet, and the LABEL.
//
// ⚠️ AND IT DELETES NOTHING. Switching it back on brings back every tick, every
// verification stamp and every nutrition figure exactly as they were — the forms still
// read what is stored and save it back untouched. The confirmation says so, because a
// switch that LOOKS destructive is one nobody dares to use, and one that IS
// destructive without saying so is worse.
//
// ⚠️ REACHED ONLY BY AN OWNER OR A MANAGER, and the gear that leads here is hidden
// from everybody else. Hiding is courtesy either way: functions/onboarding.js
// setIngredientPanels refuses the change itself (P2).

import { t } from '../i18n.js';
import { el } from './dom.js';
import { confirmDialog } from './confirm-dialog.js';
import { reportFailure } from './mgmt-ui.js';

// panels  — { allergens, nutrition } as they stand right now
// onSet(key, on) — throws one switch; resolves when the server has agreed
export function buildRegistrySettings({ panels, onSet }) {
  const content = el('div', { class: 'mgmt-scroll reg-settings' });
  let current = { ...panels };

  content.appendChild(el('h3', { class: 'mgmt-section-title', text: t('orders.settings.ingredientCard') }));
  content.appendChild(el('p', { class: 'notif-note', text: t('orders.settings.cardNote') }));

  content.appendChild(toggle({
    key: 'showAllergens',
    label: t('orders.settings.showAllergens'),
    note: t('orders.settings.showAllergensNote'),
    // ⚠️ ASKED ON THE WAY OUT, NEVER ON THE WAY IN. Switching a safety feature ON
    // needs no permission; switching it off takes the allergen card, the sheet and
    // the label away from everybody in the venue, and that is worth one sentence.
    confirmOff: {
      title: t('orders.settings.offTitle'),
      message: t('orders.settings.offBody'),
      okLabel: t('orders.settings.turnOff'),
    },
  }));

  content.appendChild(toggle({
    key: 'showNutrition',
    label: t('orders.settings.showNutrition'),
    note: t('orders.settings.showNutritionNote'),
    confirmOff: null,
  }));

  // ⚠️⚠️ THE THIRD SWITCH IS THE ONLY ONE ON THIS PAGE THAT SPENDS MONEY, and it is
  // therefore the only one that asks on the way IN rather than on the way out. The two
  // above hide something that already exists; this one starts paying a reading service
  // a few pence per photograph, on an account nobody in the venue owns. Federico's
  // decision, 24 Aug 2026, asked directly: a switch of its own, separate from the
  // recipe reader's, so one can be on while the other is off.
  //
  // ⚠️ IT DEFAULTS OFF, which is the opposite of the two above, and the reason is the
  // same one in reverse: a venue that has never heard of it must never find it already
  // running. js/orders/firebase-features.js reads it as `=== true`.
  content.appendChild(toggle({
    key: 'packPhoto',
    label: t('orders.settings.packPhoto'),
    note: t('orders.settings.packPhotoNote'),
    confirmOff: null,
    confirmOn: {
      title: t('orders.settings.packPhotoOnTitle'),
      message: t('orders.settings.packPhotoOnBody'),
      okLabel: t('orders.settings.packPhotoTurnOn'),
    },
  }));

  // One switch: a checkbox row, the same shape the Orders settings panel uses for
  // «Mostra la casella scorte». Applied on the tap — there is nothing to lose by
  // getting it wrong and one more tap undoes it.
  // ⚠️ `current` IS KEYED BY THE SWITCH, not read through an if/else on its name. With
  // two switches the chain was fine; with three, `key === 'showAllergens' ? … : …`
  // silently files the third one under the second.
  const FIELD = { showAllergens: 'allergens', showNutrition: 'nutrition', packPhoto: 'packPhoto' };

  function toggle({ key, label, note, confirmOff, confirmOn = null }) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!current[FIELD[key]];

    cb.addEventListener('change', async () => {
      const wanted = cb.checked;
      const ask = wanted ? confirmOn : confirmOff;
      if (ask) {
        const ok = await confirmDialog({ ...ask, cancelLabel: t('ui.cancel') });
        // ⚠️ PUT THE BOX BACK. A refused confirmation must leave the switch showing
        // what is actually stored, not what was tapped — in BOTH directions.
        if (!ok) { cb.checked = !wanted; return; }
      }
      cb.disabled = true;
      try {
        await onSet(key, wanted);
        current[FIELD[key]] = wanted;
      } catch (err) {
        cb.checked = !wanted;          // back to what is actually stored
        await reportFailure('save', label, err);
      } finally {
        cb.disabled = false;
      }
    });

    return el('div', { class: 'mgmt-field' }, [
      el('label', { class: 'mgmt-toggle' }, [cb, el('span', { text: label })]),
      el('p', { class: 'notif-note', text: note }),
    ]);
  }

  return content;
}
