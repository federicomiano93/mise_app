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
import { categoryValue, countInCategory } from '../record-choices.js';

const TRASH_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

// «Saved ✓» after deleting a category has to survive the screen being REDRAWN: registry.js
// rebuilds an open settings screen on every snapshot, and the write's own snapshot arrives
// before the chip could be read. Module-level, so the next build still knows.
let categorySavedUntil = 0;

// panels  — { allergens, nutrition } as they stand right now
// onSet(key, on) — throws one switch; resolves when the server has agreed
// categories()   — the venue's category list as it stands (record-choices categoryChoices)
// ingredients()  — every ingredient, to count who uses a category
// onDeleteCategory(list, ids) — writes the shortened list and clears the category on `ids`
export function buildRegistrySettings({
  panels, onSet, categories = () => [], ingredients = () => [], onDeleteCategory = null,
}) {
  const content = el('div', { class: 'mgmt-scroll reg-settings set-screen' });
  let current = { ...panels };

  // ⚠️⚠️ DECLARED BEFORE THE FIRST toggle() CALL, NOT AFTER IT. toggle() reads FIELD
  // the moment it builds a switch, and a `const` read before its line is reached
  // throws (the temporal dead zone): the whole Settings screen failed to open, with
  // every test green, until a driven run tapped the gear (28 Sep 2026).
  // ⚠️ `current` IS KEYED BY THE SWITCH, not read through an if/else on its name. With
  // two switches the chain was fine; with three, `key === 'showAllergens' ? … : …`
  // silently files the third one under the second.
  const FIELD = { showAllergens: 'allergens', showNutrition: 'nutrition', packPhoto: 'packPhoto' };

  // ONE card, in the app's one settings look (tokens.css .set-*, 28 Sep 2026): the
  // title and its line, then the three switches as rows.
  const card = el('section', { class: 'set-section' }, [
    el('div', { class: 'set-head' }, [
      el('h3', { text: t('orders.settings.ingredientCard') }),
      el('p', { text: t('orders.settings.cardNote') }),
    ]),
  ]);
  content.appendChild(card);

  card.appendChild(toggle({
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

  card.appendChild(toggle({
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
  card.appendChild(toggle({
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

  // One switch row, the same as every settings switch in the app: applied on the tap,
  // «Saved ✓» for two seconds, and put back — with the reason — if refused.

  function toggle({ key, label, note, confirmOff, confirmOn = null }) {
    const cb = el('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
    cb.checked = !!current[FIELD[key]];
    const saved = el('span', { class: 'set-saved', text: t('settings.saved'), hidden: true });
    let timer = null;

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
        saved.hidden = false;
        clearTimeout(timer);
        timer = setTimeout(() => { saved.hidden = true; }, 2000);
      } catch (err) {
        cb.checked = !wanted;          // back to what is actually stored
        await reportFailure('save', label, err);
      } finally {
        cb.disabled = false;
      }
    });

    return el('div', { class: 'set-row' }, [
      el('span', { class: 'set-text' }, [
        el('span', { class: 'set-title', text: label }),
        el('span', { class: 'set-sub', text: note }),
      ]),
      saved,
      el('label', { class: 'set-switch' }, [cb, el('span', { class: 'set-switch-track', 'aria-hidden': 'true' })]),
    ]);
  }

  if (onDeleteCategory) content.appendChild(categoryCard());

  // ── «Categorie» ────────────────────────────────────────────────────────────
  // One row per category, a low-key trash at its end (P20). Deleting NEVER moves the
  // ingredients that used it: they are left without a category (Federico's decision), and
  // the confirmation says how many.
  function categoryCard() {
    const list = categories();
    const head = el('div', { class: 'set-head' }, [
      el('h3', { text: t('orders.settings.categories') }),
      el('p', { text: t('orders.settings.categoriesNote') }),
    ]);
    const box = el('section', { class: 'set-section' }, [head]);

    const showSaved = () => {
      const chip = el('span', { class: 'set-saved reg-cat-saved', text: t('settings.saved') });
      head.appendChild(chip);
      setTimeout(() => chip.remove(), Math.max(0, categorySavedUntil - Date.now()));
    };
    if (categorySavedUntil > Date.now()) showSaved();

    if (!list.length) {
      box.appendChild(el('div', { class: 'set-row' }, [
        el('span', { class: 'set-text' }, [el('span', { class: 'set-sub', text: t('orders.settings.categoriesEmpty') })]),
      ]));
    }
    list.forEach(name => box.appendChild(categoryRow(name, list)));
    return box;
  }

  function categoryRow(name, list) {
    const del = el('button', {
      type: 'button', class: 'reg-cat-del', icon: TRASH_ICON,
      'aria-label': t('orders.settings.deleteCategory', { name }),
      onClick: async () => {
        if (del.disabled) return;
        const key = name.toLowerCase();
        const users = ingredients().filter(i => categoryValue(i?.category).toLowerCase() === key);
        const count = users.length;
        const message = count === 0
          ? t('orders.settings.deleteCategoryNone', { name })
          : (count === 1
            ? t('orders.settings.deleteCategoryOne', { name })
            : t('orders.settings.deleteCategoryMany', { name, count }));
        const ok = await confirmDialog({
          title: t('orders.settings.deleteCategoryTitle'), message,
          okLabel: t('ui.delete'), cancelLabel: t('ui.cancel'), danger: true,
        });
        if (!ok) return;
        del.disabled = true;
        try {
          await onDeleteCategory(list.filter(c => c.toLowerCase() !== key), users.map(i => i.id));
          categorySavedUntil = Date.now() + 2000;
          // The write's snapshot normally rebuilds this screen; if it has not yet, say so here.
          if (del.isConnected) {
            row.remove();
            const chip = el('span', { class: 'set-saved reg-cat-saved', text: t('settings.saved') });
            content.querySelector('.set-section:last-child .set-head')?.appendChild(chip);
            setTimeout(() => chip.remove(), 2000);
          }
        } catch (err) {
          del.disabled = false;             // keep the row; nothing changed
          await reportFailure('save', name, err);
        }
      },
    });
    const row = el('div', { class: 'set-row' }, [
      el('span', { class: 'set-text' }, [el('span', { class: 'set-title', text: name })]),
      del,
    ]);
    return row;
  }

  return content;
}
