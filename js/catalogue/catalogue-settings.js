// catalogue-settings.js — what the Recipe catalogue lets an owner change.
//
// One switch today: whether this venue may read a recipe from a photograph. It used to
// sit on the recipe list, and Federico's note on 23 Aug 2026 is the reason it does not
// any more — a switch nobody expects on a screen of recipes is worse than a screen with
// one row on it. The comment it replaces said *"one row does not justify building
// one"*; using the screen proved otherwise.
//
// ⚠️ REACHED ONLY BY AN OWNER OR A MANAGER, and the button that leads here is hidden
// from everybody else — the switch is the only thing on the screen, and an empty
// Settings screen is worse than no button. Hiding is courtesy either way: the server
// refuses the change itself (functions/onboarding.js setRecipePhoto).

import { t, onLanguageChange } from '../i18n.js';
import { el } from './dom.js';
import { LABEL_SIZES, normalizeLabelProfile } from './label-template-model.js';

export function renderSettings({ photoOn, onTogglePhoto, labelProfile, onSaveLabel }) {
  const root = el('div', { class: 'cat-view' });

  // ⚠️ EVERY PHRASE IS SET IN paint(), NEVER ONCE AT BUILD TIME. The interface
  // language comes from the VENUE and arrives a moment after the page has drawn
  // itself, so a string written once here is frozen in whatever language the app
  // started in. Same reason, same shape, as photo-capture.js.
  const label = el('span', { class: 'cat-photo-setting-label' });
  const state = el('span', { class: 'cat-photo-setting-state' });
  const row = el('button', {
    class: 'cat-alg-sheet-btn cat-photo-setting', type: 'button',
    onclick: () => onTogglePhoto(),
  }, [label, state]);

  const note = el('p', { class: 'cat-settings-note' });

  // ⚠️ THE SWITCH'S STATE IS TRACKED HERE, NOT TAKEN FROM THE ARGUMENT EACH TIME.
  // `paint(on = photoOn)` looked equivalent and was not: `photoOn` is the value the
  // screen was BUILT with, so the language listener below — which calls paint() with
  // no argument — put the pill back to whatever it said when the screen opened. Switch
  // the feature on, change the language, and the pill read OFF while the feature was
  // ON: the one thing this screen exists to tell you, wrong, with no way to notice.
  let current = photoOn;
  function paint(next = current) {
    current = next;
    label.textContent = t('cat.photo.setting');
    state.textContent = current ? t('cat.photo.on') : t('cat.photo.off');
    row.classList.toggle('cat-photo-setting--on', !!current);
    note.textContent = t('cat.photo.settingNote');
  }
  paint();

  // A language arriving while this screen is open. `root.isConnected` guards it:
  // swap() replaces the screen's children with no teardown hook, so the listener
  // outlives the view.
  onLanguageChange(() => { if (root.isConnected) paint(); });

  // ── Label printing ──────────────────────────────────────────────────────────
  //
  // ⚠️ THE PAPER ONLY. The printer's dots-per-inch and its command language are
  // already in the stored document and in the rules, deliberately, but they are NOT
  // on this screen: nothing reads them until raw printing exists, and a control that
  // changes nothing is a control somebody sets wrongly and then trusts.
  //
  // ⚠️ AND THE SIZE IS THE ONE THING HERE THAT CAN PRINT SOMETHING WRONG WITHOUT
  // LOOKING WRONG. A label laid out for 102 mm and printed on 76 mm paper loses its
  // right-hand edge — which on this screen is the end of the ingredient list.
  let profile = normalizeLabelProfile(labelProfile);

  const labelHead = el('h2', { class: 'lab-settings-h' });
  const sizeLabel = el('p', { class: 'lab-settings-label' });
  const sizeSwitch = el('div', { class: 'lab-switch lab-size-switch', role: 'group' });
  const sizeButtons = new Map();

  // ⚠️ THE PRESETS COME FROM THE MODEL, never typed here. Two lists of paper sizes is
  // two answers about which @page rule exists in the stylesheet, and the one that
  // would be wrong is the printed one.
  for (const size of LABEL_SIZES) {
    const btn = el('button', {
      class: 'lab-switch-btn', type: 'button',
      // Numbers, not a phrase: «76 × 51 mm» is the same in every language, so it is
      // built rather than translated.
      text: `${size.widthMm} × ${size.heightMm}`,
      onclick: () => save({ widthMm: size.widthMm, heightMm: size.heightMm }),
    });
    sizeButtons.set(size.id, btn);
    sizeSwitch.appendChild(btn);
  }

  const customBtn = el('button', {
    class: 'lab-switch-btn', type: 'button',
    onclick: () => { customOpen = true; paintLabel(); },
  });
  sizeSwitch.appendChild(customBtn);

  const widthInput = el('input', { type: 'number', min: '20', max: '300', step: '0.5', inputmode: 'decimal' });
  const heightInput = el('input', { type: 'number', min: '20', max: '300', step: '0.5', inputmode: 'decimal' });
  const widthUnit = el('span', { class: 'unit', text: 'mm' });
  const heightUnit = el('span', { class: 'unit', text: 'mm' });
  const widthWrap = el('label', { class: 'lab-size-field' }, [
    el('span', { class: 'lab-size-field-name' }),
    el('span', { class: 'cat-field' }, [widthInput, widthUnit]),
  ]);
  const heightWrap = el('label', { class: 'lab-size-field' }, [
    el('span', { class: 'lab-size-field-name' }),
    el('span', { class: 'cat-field' }, [heightInput, heightUnit]),
  ]);
  const customRow = el('div', { class: 'lab-size-custom' }, [widthWrap, heightWrap]);

  // ⚠️ ON change, NOT ON input. `input` fires on every keystroke, so typing «102»
  // would save 1, then 10, then 102 — three writes, and the first two are label
  // sizes this venue never chose. `change` fires when the field is left.
  const readCustom = () => {
    const w = Number(widthInput.value);
    const h = Number(heightInput.value);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    save({ widthMm: w, heightMm: h });
  };
  widthInput.addEventListener('change', readCustom);
  heightInput.addEventListener('change', readCustom);

  const dateLabel = el('span', { class: 'lab-settings-row-name' });
  const dateState = el('span', { class: 'lab-settings-row-state' });
  const dateRow = el('button', {
    class: 'cat-alg-sheet-btn lab-settings-row', type: 'button',
    onclick: () => save({ showDate: !profile.showDate }),
  }, [dateLabel, dateState]);
  const dateNote = el('p', { class: 'cat-settings-note' });

  // ⚠️ IT SAYS WHAT HAS TO BE DONE ONCE AND WHAT HAPPENS IF IT IS NOT. The first
  // print comes out the wrong size until the driver and the print window are set,
  // and somebody who has not been told that reads a correct app as a broken one.
  const setupNote = el('p', { class: 'cat-settings-note lab-settings-setup' });
  const labelError = el('p', { class: 'lab-nofit' });

  let customOpen = false;

  function currentPresetId() {
    const found = LABEL_SIZES.find(s => s.widthMm === profile.widthMm && s.heightMm === profile.heightMm);
    return found ? found.id : null;
  }

  function paintLabel() {
    labelHead.textContent = t('label.settings.title');
    sizeLabel.textContent = t('label.settings.size');
    customBtn.textContent = t('label.settings.custom');

    const preset = currentPresetId();
    for (const [id, btn] of sizeButtons) {
      const on = id === preset;
      btn.classList.toggle('lab-switch-btn--on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    // A size that matches no preset IS a custom size, so the fold opens itself —
    // otherwise the screen would show nothing selected and no way to see why.
    const isCustom = preset === null || customOpen;
    customBtn.classList.toggle('lab-switch-btn--on', preset === null);
    customBtn.setAttribute('aria-pressed', preset === null ? 'true' : 'false');
    customRow.hidden = !isCustom;

    // ⚠️ NOT WHILE SOMEBODY IS TYPING IN IT. Writing .value under a focused caret
    // moves it to the end mid-number, which is how «76» becomes «776».
    if (document.activeElement !== widthInput) widthInput.value = String(profile.widthMm);
    if (document.activeElement !== heightInput) heightInput.value = String(profile.heightMm);
    widthWrap.firstChild.textContent = t('label.settings.width');
    heightWrap.firstChild.textContent = t('label.settings.height');

    dateLabel.textContent = t('label.settings.showDate');
    dateState.textContent = profile.showDate ? t('cat.photo.on') : t('cat.photo.off');
    dateRow.classList.toggle('lab-settings-row--on', profile.showDate);
    dateNote.textContent = t('label.settings.showDateNote');
    setupNote.textContent = t('label.settings.setup');
  }
  paintLabel();
  labelError.hidden = true;

  // ⚠️ THE SCREEN CHANGES FIRST AND IS PUT BACK IF THE DATABASE REFUSES. The store
  // rolls its own copy back too; this is the half a person can see. A size that
  // looks saved and was not is a label that prints wrong tomorrow.
  async function save(patch) {
    const before = profile;
    profile = normalizeLabelProfile({ ...profile, ...patch });
    labelError.hidden = true;
    paintLabel();
    if (!onSaveLabel) return;
    try {
      await onSaveLabel(patch);
    } catch (err) {
      profile = before;
      paintLabel();
      labelError.hidden = false;
      labelError.textContent = t('label.settings.saveFailed');
    }
  }

  onLanguageChange(() => { if (root.isConnected) paintLabel(); });

  root.append(
    row, note,
    labelHead, sizeLabel, sizeSwitch, customRow,
    dateRow, dateNote, setupNote, labelError,
  );
  return { root, refresh: paint };
}
