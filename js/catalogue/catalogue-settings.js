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
import {
  LABEL_SIZES, PRINTER_LANGUAGES, DPI_CHOICES, DATE_KINDS, normalizeLabelProfile,
} from './label-template-model.js';

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
  // The paper, the printer, and — only for a printer driven in its own language —
  // its resolution.
  //
  // ⚠️ THE PRINTER AND THE RESOLUTION ARRIVED WITH ZPL AND NOT BEFORE IT. Both were
  // in the stored document and in the rules from the first release, deliberately,
  // but off this screen while nothing read them: a control that changes nothing is
  // one somebody sets wrongly and then trusts. Keep that rule for the next field.
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
  //
  // ⚠️⚠️ AND THE TWO FIELDS ARE ONE DECISION, SO THEY ARE ONE WRITE. A width and a
  // height typed one after the other produced two saves, and while both were in
  // flight the store briefly held the FIRST one's server answer — a size nobody had
  // asked for. It converges, and a person moving between screens at human speed
  // never sees it; a label screen opened inside that window paints the old paper and
  // does not repaint, which is exactly the kind of thing that gets printed. One
  // write cannot be half-applied.
  const SETTLE_MS = 350;
  let pendingSize = null;
  const readCustom = () => {
    const w = Number(widthInput.value);
    const h = Number(heightInput.value);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    clearTimeout(pendingSize);
    pendingSize = setTimeout(() => save({ widthMm: w, heightMm: h }), SETTLE_MS);
  };
  widthInput.addEventListener('change', readCustom);
  heightInput.addEventListener('change', readCustom);

  // ── Which printer, and at what resolution ─────────────────────────────────
  //
  // ⚠️ THESE ARRIVED WITH THE ZEBRA'S OWN LANGUAGE AND NOT BEFORE IT. They were in
  // the stored document and in the rules from the first release, deliberately, but
  // OFF this screen — a control that changes nothing is one somebody sets wrongly
  // and then trusts. Now they change something.
  const printerLabel = el('p', { class: 'lab-settings-label' });
  const printerSwitch = el('div', { class: 'lab-switch lab-size-switch', role: 'group' });
  const printerButtons = new Map();
  for (const language of PRINTER_LANGUAGES) {
    const btn = el('button', {
      class: 'lab-switch-btn', type: 'button',
      onclick: () => save({ printerLanguage: language }),
    });
    printerButtons.set(language, btn);
    printerSwitch.appendChild(btn);
  }
  const printerNote = el('p', { class: 'cat-settings-note' });

  const dpiLabel = el('p', { class: 'lab-settings-label' });
  const dpiSwitch = el('div', { class: 'lab-switch lab-size-switch', role: 'group' });
  const dpiButtons = new Map();
  for (const dpi of DPI_CHOICES) {
    const btn = el('button', {
      class: 'lab-switch-btn', type: 'button',
      // Numbers, not a phrase — «203 dpi» is the same in every language.
      text: `${dpi} dpi`,
      onclick: () => save({ dpi }),
    });
    dpiButtons.set(dpi, btn);
    dpiSwitch.appendChild(btn);
  }
  const dpiNote = el('p', { class: 'cat-settings-note' });


  // ── What else goes on the label ────────────────────────────────────────────
  //
  // ⚠️ THE WHOLE SECTION IS FOR FOOD SOLD SOMEWHERE ELSE. Over a venue's own counter
  // the name and the ingredients with the allergens emphasised are what the law asks
  // for; everything here is what a pack travelling to another shop or a market has
  // to carry as well. It says so on the screen, once, so nobody switches these on
  // believing they were missing something.
  const fullHead = el('h2', { class: 'lab-settings-h' });
  const fullNote = el('p', { class: 'cat-settings-note' });

  // One switch row, built the same way three times.
  const switchRow = (key) => {
    const name = el('span', { class: 'lab-settings-row-name' });
    const state = el('span', { class: 'lab-settings-row-state' });
    const row = el('button', {
      class: 'cat-alg-sheet-btn lab-settings-row', type: 'button',
      onclick: () => save({ [key]: !profile[key] }),
    }, [name, state]);
    return { key, row, name, state };
  };
  const weightSwitch = switchRow('showWeight');
  const storageSwitch = switchRow('showStorage');
  const businessSwitch = switchRow('showBusiness');

  // ⚠️ A FREE-TYPED LINE IS SAVED WHEN THE FIELD IS LEFT, never on every keystroke —
  // the same reason as the custom paper size, and here it also means a half-typed
  // address never reaches a label.
  const textField = (key, labelKey, placeholderKey) => {
    const input = el('input', {
      type: 'text', maxlength: '200',
      placeholder: placeholderKey ? t(placeholderKey) : '',
      class: 'lab-text-input',
      onchange: (e) => save({ [key]: String(e.target.value || '').trim() }),
    });
    const name = el('span', { class: 'lab-size-field-name' });
    const wrap = el('label', { class: 'lab-size-field lab-text-field' }, [
      name, el('span', { class: 'cat-field' }, [input]),
    ]);
    return { key, labelKey, placeholderKey, input, name, wrap };
  };
  const storageText = textField('storageText', 'label.settings.storageText', 'label.settings.storagePlaceholder');
  const businessName = textField('businessName', 'label.settings.businessName');
  const businessAddress = textField('businessAddress', 'label.settings.businessAddress');
  const businessNote = el('p', { class: 'cat-settings-note' });

  // ⚠️⚠️ WHICH DATE, AND IT IS THE ONE CHOICE ON THIS SCREEN THAT CAN HARM SOMEBODY.
  // «Use by» is a safety statement; «best before» is about quality. The note under it
  // says so in words, because the two are a single tap apart and the consequences are
  // thrown-away food on one side and unsafe food on the other.
  const dateKindLabel = el('p', { class: 'lab-settings-label' });
  const dateKindSwitch = el('div', { class: 'lab-switch lab-size-switch', role: 'group' });
  const dateKindButtons = new Map();
  for (const kind of DATE_KINDS) {
    const btn = el('button', {
      class: 'lab-switch-btn', type: 'button',
      onclick: () => save({ dateKind: kind }),
    });
    dateKindButtons.set(kind, btn);
    dateKindSwitch.appendChild(btn);
  }
  const dateKindNote = el('p', { class: 'cat-settings-note' });

  function paintFull() {
    fullHead.textContent = t('label.settings.full');
    fullNote.textContent = t('label.settings.fullNote');

    for (const s of [weightSwitch, storageSwitch, businessSwitch]) {
      s.name.textContent = t(`label.settings.${s.key}`);
      s.state.textContent = profile[s.key] ? t('cat.photo.on') : t('cat.photo.off');
      s.row.classList.toggle('lab-settings-row--on', !!profile[s.key]);
    }

    for (const f of [storageText, businessName, businessAddress]) {
      f.name.textContent = t(f.labelKey);
      if (f.placeholderKey) f.input.placeholder = t(f.placeholderKey);
      // ⚠️ NOT WHILE SOMEBODY IS TYPING IN IT — writing .value under a focused caret
      // moves it to the end mid-word.
      if (document.activeElement !== f.input) f.input.value = profile[f.key] || '';
    }
    // A box is shown only when the block that prints it is on: a control that changes
    // nothing is one somebody fills in and then trusts.
    storageText.wrap.hidden = !profile.showStorage;
    businessName.wrap.hidden = !profile.showBusiness;
    businessAddress.wrap.hidden = !profile.showBusiness;
    businessNote.hidden = !profile.showBusiness;
    businessNote.textContent = t('label.settings.businessNote');

    // ⚠️ AND THE SCREEN SAYS WHEN A SWITCH HAS NOTHING BEHIND IT. The label leaves
    // the line out — correctly — but from here that is indistinguishable from a
    // setting that did not save.
    const empty = (profile.showStorage && !profile.storageText)
      || (profile.showBusiness && !profile.businessName && !profile.businessAddress);
    emptyHint.hidden = !empty;
    emptyHint.textContent = t('label.settings.emptyBlock');

    dateKindLabel.hidden = !profile.showDate;
    dateKindSwitch.hidden = !profile.showDate;
    dateKindNote.hidden = !profile.showDate;
    dateKindLabel.textContent = t('label.settings.dateKind');
    dateKindNote.textContent = t('label.settings.dateKindNote');
    for (const [kind, btn] of dateKindButtons) {
      const on = kind === profile.dateKind;
      btn.textContent = t(`label.settings.dateKind.${kind}`);
      btn.classList.toggle('lab-switch-btn--on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  const emptyHint = el('p', { class: 'lab-nofit' });

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

    printerLabel.textContent = t('label.settings.printer');
    for (const [language, btn] of printerButtons) {
      const on = language === profile.printerLanguage;
      btn.textContent = t(`label.settings.printer.${language}`);
      btn.classList.toggle('lab-switch-btn--on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    printerNote.textContent = t('label.settings.printerNote');

    // ⚠️ THE RESOLUTION ONLY MATTERS TO A PRINTER DRIVEN IN ITS OWN LANGUAGE. Through
    // the print dialog the driver owns it, and offering the choice there would invite
    // somebody to set a number that changes nothing and then believe it did.
    const rawPrinter = profile.printerLanguage === 'zpl';
    dpiLabel.hidden = !rawPrinter;
    dpiSwitch.hidden = !rawPrinter;
    dpiNote.hidden = !rawPrinter;
    dpiLabel.textContent = t('label.settings.dpi');
    for (const [dpi, btn] of dpiButtons) {
      const on = dpi === profile.dpi;
      btn.classList.toggle('lab-switch-btn--on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    dpiNote.textContent = t('label.settings.dpiNote');

    dateLabel.textContent = t('label.settings.showDate');
    dateState.textContent = profile.showDate ? t('cat.photo.on') : t('cat.photo.off');
    dateRow.classList.toggle('lab-settings-row--on', profile.showDate);
    dateNote.textContent = t('label.settings.showDateNote');
    setupNote.textContent = t('label.settings.setup');
    paintFull();
  }
  paintLabel();
  labelError.hidden = true;

  // ⚠️⚠️ THE WRITES ARE PUT IN A QUEUE, AND THIS IS A REAL DEFECT THAT DRIVING THE
  // APP FOUND. Two saves fired close together are two independent setDoc(merge)
  // calls with no ordering guarantee between them: typing a width and then a height
  // saved `{width: 25, height: 51}` and `{width: 25, height: 20}`, the second landed
  // first, and the first put the OLD height back. On screen the width had changed
  // and the height had not, with nothing anywhere saying why — and the thing left
  // wrong was the size of a printed food label.
  //
  // Chaining them makes the last change a person made the last one written, which is
  // the only order that can be explained to somebody watching the screen.
  let queue = Promise.resolve();

  // ⚠️ THE SCREEN CHANGES FIRST AND IS PUT BACK IF THE DATABASE REFUSES. The store
  // rolls its own copy back too; this is the half a person can see. A size that
  // looks saved and was not is a label that prints wrong tomorrow.
  function save(patch) {
    const before = profile;
    profile = normalizeLabelProfile({ ...profile, ...patch });
    labelError.hidden = true;
    paintLabel();
    if (!onSaveLabel) return queue;
    queue = queue
      // ⚠️ .catch BEFORE the next write, never after: one rejected save must not
      // take the queue down with it and silently stop every later change.
      .catch(() => {})
      .then(() => onSaveLabel(patch))
      .catch(() => {
        profile = before;
        paintLabel();
        labelError.hidden = false;
        labelError.textContent = t('label.settings.saveFailed');
      });
    return queue;
  }

  onLanguageChange(() => { if (root.isConnected) paintLabel(); });

  root.append(
    row, note,
    labelHead, sizeLabel, sizeSwitch, customRow,
    printerLabel, printerSwitch, printerNote,
    dpiLabel, dpiSwitch, dpiNote,
    dateRow, dateNote,
    dateKindLabel, dateKindSwitch, dateKindNote,
    fullHead, fullNote,
    weightSwitch.row,
    storageSwitch.row, storageText.wrap,
    businessSwitch.row, businessName.wrap, businessAddress.wrap, businessNote,
    emptyHint,
    setupNote, labelError,
  );
  return { root, refresh: paint };
}
