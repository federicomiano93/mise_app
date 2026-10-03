// invoice-import-screen.js — «Import from invoices»: suppliers and ingredients, with their prices, from
// the file the owner's local script made out of the supplier e-invoices (invoice-import/README.md).
//
// THE SCREEN DECIDES NOTHING ABOUT THE DATA. invoice-import-model.js matches the file against what the
// venue holds and lists the writes; invoice-import-plan.js applies the person's answers and re-checks each
// row before it is written; invoice-import-data.js talks to Firestore. This file asks, shows and confirms.
//
// Four steps, one level: Choose the file → Suppliers → Ingredients → Summary. Back leaves the whole import
// (it asks first once a file is loaded and the import is not finished — P20); there is no Back inside it.
//
// ⚠️ NOTHING IS WRITTEN BEFORE THE CONFIRMATION OF ITS STEP, and a write never starts while a question is
// open. While rows are being written Back is disabled: a half-sent bulk import is the one thing here that
// cannot be put back by tapping Cancel.
// ⚠️ EVERY WORD IS ASKED INSIDE A FUNCTION (the venue's language arrives after this module loads), and
// this screen names no food: ingredient names are the file's own.

import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { formatPricePerUnit } from '../price-model.js';
import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { BACK_ICON } from './mgmt-ui.js';
import {
  parseImportFile, planSuppliers, supplierWrites, planIngredients, ingredientWrites,
} from './invoice-import-model.js';
import {
  applyDecisions, bucketOf, filterCounts, visibleFilters, entriesFor, waitingCount, importTotals, idsToCheck,
  invoiceCount, replanRow, summarizeRun, stopKind, writesRow, changedSupplierKeys, isRetryableReason,
  rememberHints,
} from './invoice-import-plan.js';
import {
  createImportedSupplier, linkSupplierVat, freshSuppliers, freshIngredientsForSupplier, invoicePointIds,
  freshPrice, runImportBatches,
} from './invoice-import-data.js';

// A row's status or bucket → the tone of its pill and the word it carries. The word is ALWAYS there: the
// colour only repeats it (P18).
const TONES = Object.freeze({
  new: 'ok', present: 'ok', 'update-price': 'ok',
  'history-only': 'quiet', unchanged: 'quiet', skipped: 'quiet',
  maybe: 'warn', 'maybe-duplicate': 'warn', choose: 'warn', decide: 'warn',
  error: 'error',
});

const STATUS_KEYS = Object.freeze({
  new: 'invoiceImport.status.new',
  present: 'invoiceImport.status.present',
  maybe: 'invoiceImport.status.maybe',
  error: 'invoiceImport.status.error',
  'update-price': 'invoiceImport.status.updatePrice',
  'history-only': 'invoiceImport.status.historyOnly',
  unchanged: 'invoiceImport.status.unchanged',
  'maybe-duplicate': 'invoiceImport.status.decide',
  choose: 'invoiceImport.status.decide',
  skipped: 'invoiceImport.status.skipped',
});

const FILTER_KEYS = Object.freeze({
  all: 'invoiceImport.filter.all',
  new: 'invoiceImport.status.new',
  'update-price': 'invoiceImport.status.updatePrice',
  'history-only': 'invoiceImport.status.historyOnly',
  unchanged: 'invoiceImport.status.unchanged',
  decide: 'invoiceImport.status.decide',
  error: 'invoiceImport.filter.errors',
});

const REASON_KEYS = Object.freeze({
  'not-object': 'invoiceImport.reason.notObject',
  'key-missing': 'invoiceImport.reason.keyMissing',
  'duplicate-key': 'invoiceImport.reason.duplicateKey',
  'name-missing': 'invoiceImport.reason.nameMissing',
  'vat-missing': 'invoiceImport.reason.vatMissing',
  'vat-too-long': 'invoiceImport.reason.vatTooLong',
  'supplier-key-missing': 'invoiceImport.reason.supplierKeyMissing',
  'supplier-missing': 'invoiceImport.reason.supplierMissing',
  'price-unit': 'invoiceImport.reason.priceUnit',
  'unit-weight-missing': 'invoiceImport.reason.unitWeightMissing',
  'pack-count': 'invoiceImport.reason.packCount',
  'no-prices': 'invoiceImport.reason.noPrices',
  'price-invalid': 'invoiceImport.reason.priceInvalid',
  'target-not-found': 'invoiceImport.reason.targetNotFound',
  'code-ambiguous': 'invoiceImport.reason.codeAmbiguous',
  'name-ambiguous': 'invoiceImport.reason.nameAmbiguous',
  'merge-target-not-found': 'invoiceImport.reason.mergeNotFound',
  'merge-target-ambiguous': 'invoiceImport.reason.mergeAmbiguous',
  'duplicate-vat': 'invoiceImport.reason.duplicateVat',
  'code-differs': 'invoiceImport.reason.codeDiffers',
  'unit-differs': 'invoiceImport.reason.unitDiffers',
});

const FILE_ERROR_KEYS = Object.freeze({
  'not-json': 'invoiceImport.file.notJson',
  'wrong-format': 'invoiceImport.file.wrongFormat',
  'wrong-version': 'invoiceImport.file.wrongVersion',
  invalid: 'invoiceImport.file.invalid',
});

// Reading the pages of one-by-one invoice-point lists at the same time is fine; a hundred at once is not.
const READ_CHUNK = 8;

let openOverlay = null;

// data: { suppliers(): [], ingredients(): [], prices(): { [ingredientId]: price doc }, ready(): boolean,
//         language(): 'en' | 'it', opener?: the button that opened this screen }
// — live getters from the page; `language` is the venue's OUTPUT language (the carton word and the loose
// unit written on a new ingredient are food words); `ready` waits for suppliers, ingredients AND prices.
export function openInvoiceImport(data) {
  if (openOverlay) return;
  // Focus goes back to whatever opened the screen when it closes (a browser that does not focus a button on
  // tap leaves document.activeElement elsewhere, so the page may name it).
  const opener = data.opener || (typeof document !== 'undefined' ? document.activeElement : null);

  const s = {
    step: 'file',            // 'file' | 'suppliers' | 'ingredients' | 'summary'
    busy: false,             // rows or suppliers are being written: Back is off
    finished: false,         // nothing left to lose by leaving
    file: null,
    fileName: '',
    fileByKey: new Map(),
    fileError: '',
    // suppliers
    supplierPlan: [],
    supplierDecisions: {},
    supplierProgress: { created: {}, linked: new Set() },
    supplierError: '',
    supplierIdByKey: null,
    // ingredients
    ctx: null,
    plannedRows: [],
    ingredientDecisions: {},
    checking: false,
    checkError: '',
    filter: 'all',
    open: { unchanged: false, error: false },
    // the end
    summary: null,
    remember: [],
    focusHeading: false,
    progress: null,
  };

  // ONE input for the life of the screen: redrawing it would forget the file it holds.
  const fileInput = el('input', {
    type: 'file', class: 'invimp-file-input', id: 'invimp-file', 'data-fid': 'invimp-file',
    accept: '.json,application/json',
  });
  fileInput.addEventListener('change', () => onFileChosen(fileInput.files && fileInput.files[0]));
  const scroll = el('div', { class: 'mgmt-scroll' });
  const footer = el('div', { class: 'invimp-footer', hidden: '' });
  const live = el('div', { class: 'invimp-live', role: 'status', 'aria-live': 'polite' });
  const backBtn = el('button', { type: 'button', class: 'app-icon-btn orders-icon-btn', icon: BACK_ICON, onClick: () => requestClose() });
  const titleHeading = el('h1', { id: 'invimp-title' });
  // ⚠️ A DIALOG FOR A SCREEN READER: it names itself by its title and says the page behind is out of reach.
  const node = el('div', { class: 'mgmt-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'invimp-title' }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [backBtn]),
      el('div', { class: 'app-header-title orders-header-title' }, [titleHeading]),
      el('span', { class: 'app-header-slot' }),
    ]),
    scroll,
    live,
    footer,
  ]);

  // ── Closing ───────────────────────────────────────────────────────────────────

  function close() {
    node.remove();
    openOverlay = null;
    if (opener && typeof opener.focus === 'function' && opener.isConnected !== false) opener.focus();
  }

  async function requestClose() {
    if (s.busy) return;
    if (s.file && !s.finished) {
      const ok = await confirmDialog({
        title: t('invoiceImport.discard.title'),
        message: t('invoiceImport.discard.message'),
        okLabel: t('invoiceImport.discard.ok'),
        cancelLabel: t('ui.cancel'),
        danger: true,
      });
      if (!ok) return;
    }
    close();
  }

  // ── Small pieces ──────────────────────────────────────────────────────────────

  const reasonText = (code) => (REASON_KEYS[code] ? t(REASON_KEYS[code]) : t('invoiceImport.reason.unknown'));

  function pill(tone, text) {
    return el('span', { class: `invimp-status invimp-status--${tone}`, text });
  }

  function heading(stepNumber, key) {
    return [
      el('p', { class: 'invimp-step', text: t('invoiceImport.stepOf', { n: stepNumber, total: 3 }) }),
      el('h2', { class: 'invimp-heading', tabindex: '-1', text: t(key) }),
    ];
  }

  function choice(id, labelText, options, value, onChange) {
    const select = el('select', { class: 'set-select invimp-select', id, 'data-fid': id }, options.map(o =>
      el('option', { value: o.value, text: o.label, selected: o.value === value ? '' : null })));
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    return el('div', { class: 'invimp-choice' }, [
      el('label', { class: 'invimp-choice-label', for: id, text: labelText }),
      select,
    ]);
  }

  function button(cls, text, onClick, { disabled = false, describedBy = null, fid = null } = {}) {
    return el('button', {
      type: 'button', class: cls, text, onClick, disabled: disabled ? '' : null,
      'aria-describedby': describedBy, 'data-fid': fid,
    });
  }

  function setFooter(children) {
    footer.replaceChildren(...children.filter(Boolean));
    footer.hidden = children.filter(Boolean).length === 0;
  }

  const stepOf = () => ({ file: 1, suppliers: 2, ingredients: 3, summary: 3 }[s.step]);

  // ── Drawing ───────────────────────────────────────────────────────────────────

  // The whole body is redrawn on every change, inside the SAME scroll box (its position is kept), and the
  // control that had the focus gets it back — a redraw must never drop somebody out of the select they are on.
  function render() {
    const focusedId = document.activeElement && node.contains(document.activeElement)
      ? document.activeElement.getAttribute('data-fid') : null;
    titleHeading.textContent = t('invoiceImport.title');
    backBtn.setAttribute('aria-label', t('ui.back'));
    backBtn.disabled = s.busy;

    if (s.busy) drawBusy();
    else if (s.step === 'file') drawFile();
    else if (s.step === 'suppliers') drawSuppliers();
    else if (s.step === 'ingredients') drawIngredients();
    else drawSummary();

    if (s.focusHeading) {
      s.focusHeading = false;
      const h = scroll.querySelector('h2');
      if (h) { scroll.scrollTop = 0; h.focus({ preventScroll: true }); }
    } else if (focusedId) {
      const again = node.querySelector(`[data-fid="${focusedId}"]`);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
  }

  function goTo(step) {
    s.step = step;
    s.focusHeading = true;
    render();
  }

  // ── Step 1 of 3 · Choose the file ─────────────────────────────────────────────

  function drawFile() {
    const body = [
      ...heading(1, 'invoiceImport.step.file'),
      el('p', { class: 'invimp-note', text: t('invoiceImport.file.explain') }),
      // ⚠️ THE NATIVE FILE BOX IS 23 px TALL AND SPEAKS THE BROWSER'S LANGUAGE: it stays, hidden but focusable,
      // and a label dressed as a button opens it (the focus ring is drawn on the label, orders.css).
      el('div', { class: 'invimp-file' }, [
        fileInput,
        el('label', { class: 'btn-secondary invimp-file-btn', for: 'invimp-file', text: t('invoiceImport.file.label') }),
        s.fileName ? el('p', { class: 'invimp-file-name', text: t('invoiceImport.file.chosen', { name: s.fileName }) }) : null,
      ]),
    ];
    if (s.fileError) body.push(el('p', { class: 'orders-status error', role: 'alert', text: s.fileError }));
    if (s.file) {
      body.push(el('p', { class: 'orders-status ok', role: 'status' }, [
        t('invoiceImport.file.found.suppliers', { n: s.file.suppliers.length }),
        ' · ',
        t('invoiceImport.file.found.ingredients', { n: s.file.ingredients.length }),
      ]));
    }
    scroll.replaceChildren(el('div', { class: 'invimp-screen' }, body));
    setFooter([s.file ? button('btn-primary', t('invoiceImport.next'), startSuppliers, { fid: 'invimp-next' }) : null]);
  }

  async function onFileChosen(file) {
    s.fileError = '';
    s.file = null;
    s.fileName = file ? file.name : '';
    if (!file) { render(); return; }
    let text;
    try { text = await file.text(); }
    catch (err) {
      console.error('The import file could not be read:', err);
      s.fileError = t('invoiceImport.file.unreadable');
      render();
      return;
    }
    const parsed = parseImportFile(text);
    if (!parsed.ok) {
      s.fileError = t(FILE_ERROR_KEYS[parsed.error] || FILE_ERROR_KEYS.invalid);
      render();
      return;
    }
    s.file = parsed.file;
    s.fileByKey = new Map(parsed.file.ingredients.map(i => [i.key, i]));
    s.supplierDecisions = {};
    s.supplierProgress = { created: {}, linked: new Set() };
    s.ingredientDecisions = {};
    render();
  }

  // ── Step 2 of 3 · Suppliers ───────────────────────────────────────────────────

  function startSuppliers() {
    // ⚠️ A PLAN DRAWN BEFORE THE LISTS HAVE ARRIVED WOULD CALL EVERYTHING NEW (suppliers included: the page's
    // `ready` waits for the suppliers list too).
    if (!data.ready()) {
      s.fileError = t('invoiceImport.notReady');
      render();
      return;
    }
    s.supplierPlan = planSuppliers(s.file.suppliers, data.suppliers());
    s.supplierError = '';
    goTo('suppliers');
  }

  function pendingSupplierOps(ops) {
    return ops.filter(op => !(op.type === 'create-supplier' && s.supplierProgress.created[op.key])
      && !(op.type === 'link-supplier' && s.supplierProgress.linked.has(op.key)));
  }

  function supplierRow(entry, index) {
    const existing = entry.supplierId ? data.suppliers().find(x => x.id === entry.supplierId) : null;
    const meta = [
      entry.vatNumber ? t('invoiceImport.vat', { vat: entry.vatNumber }) : t('invoiceImport.vat.none'),
      existing ? t('invoiceImport.suppliers.is', { name: supplierLabel(existing) }) : '',
    ].filter(Boolean).join(' · ');
    const children = [
      el('div', { class: 'invimp-row-top' }, [
        el('div', { class: 'invimp-row-main' }, [
          el('span', { class: 'mgmt-item-name', text: entry.name || entry.key }),
          el('span', { class: 'mgmt-item-meta', text: meta }),
        ]),
        pill(TONES[entry.status], t(STATUS_KEYS[entry.status])),
      ]),
    ];
    if (entry.reason) children.push(el('p', { class: 'invimp-reason', text: reasonText(entry.reason) }));
    if (entry.status === 'maybe') {
      const d = s.supplierDecisions[entry.key];
      const value = !d ? '' : d.linkTo ? `link:${d.linkTo}` : d.createNew ? 'new' : 'skip';
      children.push(choice(`invimp-sup-${index}`, t('invoiceImport.choose'), [
        { value: '', label: t('invoiceImport.choosePlaceholder') },
        ...entry.candidates.map(c => ({ value: `link:${c.id}`, label: t('invoiceImport.sameAs', { name: c.label }) })),
        { value: 'new', label: t('invoiceImport.suppliers.createNew') },
        { value: 'skip', label: t('invoiceImport.skip') },
      ], value, (picked) => {
        if (!picked) delete s.supplierDecisions[entry.key];
        else if (picked === 'new') s.supplierDecisions[entry.key] = { createNew: true };
        else if (picked === 'skip') s.supplierDecisions[entry.key] = { skip: true };
        else s.supplierDecisions[entry.key] = { linkTo: picked.slice(5) };
        render();
      }));
    }
    return el('div', { class: 'invimp-row' }, children);
  }

  function drawSuppliers() {
    const writes = supplierWrites(s.supplierPlan, s.supplierDecisions);
    const pending = pendingSupplierOps(writes.ops);
    const body = [...heading(2, 'invoiceImport.step.suppliers')];
    if (s.supplierError) body.push(el('p', { class: 'orders-status error', role: 'alert', text: s.supplierError }));
    if (s.supplierPlan.length === 0) body.push(el('p', { class: 'mgmt-empty', text: t('invoiceImport.suppliers.none') }));
    body.push(el('div', { class: 'invimp-list' }, s.supplierPlan.map(supplierRow)));
    scroll.replaceChildren(el('div', { class: 'invimp-screen' }, body));

    const blocked = writes.blocked.length;
    const hint = blocked > 0
      ? el('p', { class: 'invimp-hint', id: 'invimp-hint', text: t('invoiceImport.suppliers.decideFirst', { n: blocked }) })
      : null;
    const label = pending.length > 0 ? t('invoiceImport.suppliers.save', { n: pending.length }) : t('invoiceImport.next');
    setFooter([
      hint,
      button('btn-primary', label, () => (pending.length > 0 ? saveSuppliers(writes, pending) : finishSuppliers(writes)),
        { disabled: blocked > 0, describedBy: hint ? 'invimp-hint' : null, fid: 'invimp-primary' }),
    ]);
  }

  async function saveSuppliers(writes, pending) {
    const creates = pending.filter(op => op.type === 'create-supplier').length;
    const links = pending.filter(op => op.type === 'link-supplier').length;
    const lines = [
      creates > 0 ? t('invoiceImport.suppliers.confirmCreate', { n: creates }) : '',
      links > 0 ? t('invoiceImport.suppliers.confirmLink', { n: links }) : '',
    ].filter(Boolean);
    const ok = await confirmDialog({
      title: t('invoiceImport.suppliers.confirmTitle'),
      message: lines.join('\n'),
      okLabel: t('ui.save'),
      cancelLabel: t('ui.cancel'),
    });
    if (!ok) return;

    s.busy = true;
    s.supplierError = '';
    live.textContent = t('invoiceImport.suppliers.saving');
    render();
    try {
      // ⚠️ THE FRESH CHECK: the plan the owner confirmed is minutes old and another phone may have added one of
      // these suppliers since. Plan again on what the SERVER holds now; if any answer is no longer the same,
      // nothing is written — the step is drawn again with the fresh plan and the owner confirms again.
      const fresh = planSuppliers(s.file.suppliers, await freshSuppliers());
      const settled = [...Object.keys(s.supplierProgress.created), ...s.supplierProgress.linked];
      const changed = changedSupplierKeys(s.supplierPlan, fresh, settled);
      if (changed.length > 0) {
        changed.forEach(key => { delete s.supplierDecisions[key]; });
        s.supplierPlan = fresh;
        s.supplierError = t('invoiceImport.suppliers.changed');
        s.busy = false;
        live.textContent = '';
        render();
        return;
      }
      for (const op of pending) {
        if (op.type === 'create-supplier') s.supplierProgress.created[op.key] = await createImportedSupplier(op.data);
        else { await linkSupplierVat(op.supplierId, op.data.vatNumber); s.supplierProgress.linked.add(op.key); }
      }
    } catch (err) {
      console.error('Saving the imported suppliers failed:', err);
      s.supplierError = failureMessage(err, 'invoiceImport.suppliers.failed');
      s.busy = false;
      live.textContent = '';
      render();
      return;
    }
    s.busy = false;
    live.textContent = '';
    finishSuppliers(writes);
  }

  function finishSuppliers(writes) {
    s.supplierIdByKey = { ...writes.supplierIdByKey, ...s.supplierProgress.created };
    startIngredients();
  }

  // ── Step 3 of 3 · Ingredients ─────────────────────────────────────────────────

  function ctxFor(invoicePointIdsById) {
    return {
      supplierIdByKey: s.supplierIdByKey,
      ingredients: data.ingredients(),
      pricesById: data.prices() || {},
      invoicePointIds: invoicePointIdsById,
    };
  }

  // What the venue already holds comes from the page; which invoice prices are already recorded is a read
  // per ingredient, made only for the ones a row could be matched with.
  async function startIngredients() {
    s.checkError = '';
    s.checking = true;
    live.textContent = t('invoiceImport.ing.checking');
    goTo('ingredients');
    try {
      const first = planIngredients(s.file.ingredients, ctxFor({}));
      const ids = idsToCheck(first);
      const known = {};
      for (let i = 0; i < ids.length; i += READ_CHUNK) {
        const part = ids.slice(i, i + READ_CHUNK);
        const sets = await Promise.all(part.map(id => invoicePointIds(id)));
        part.forEach((id, k) => { known[id] = sets[k]; });
      }
      s.ctx = ctxFor(known);
      s.plannedRows = planIngredients(s.file.ingredients, s.ctx);
    } catch (err) {
      console.error('Checking the recorded invoice prices failed:', err);
      s.checkError = failureMessage(err, 'invoiceImport.ing.checkFailed');
    }
    s.checking = false;
    live.textContent = '';
    render();
  }

  const entriesNow = () => applyDecisions(s.plannedRows, s.ingredientDecisions, s.ctx);

  function supplierNameOf(planned) {
    const fileIng = s.fileByKey.get(planned.key);
    const id = fileIng && s.supplierIdByKey ? s.supplierIdByKey[fileIng.supplierKey] : null;
    const known = id ? data.suppliers().find(x => x.id === id) : null;
    if (known) return supplierLabel(known);
    const fromFile = fileIng ? s.file.suppliers.find(x => x.key === fileIng.supplierKey) : null;
    return fromFile ? fromFile.name : '';
  }

  function priceText(planned) {
    const fileIng = s.fileByKey.get(planned.key);
    const last = planned.allPoints[planned.allPoints.length - 1];
    if (!fileIng || !last) return '';
    return formatPricePerUnit({ pricePerUnit: last.pricePerUnit, priceUnit: fileIng.priceUnit });
  }

  function ingredientRow(entry, index) {
    const { planned, row } = entry;
    const invoices = invoiceCount(planned);
    const meta = [
      supplierNameOf(planned),
      priceText(planned),
      invoices > 0 ? t('invoiceImport.invoices', { n: invoices }) : '',
    ].filter(Boolean).join(' · ');
    const children = [
      el('div', { class: 'invimp-row-top' }, [
        el('div', { class: 'invimp-row-main' }, [
          el('span', { class: 'mgmt-item-name', text: planned.name || planned.key }),
          el('span', { class: 'mgmt-item-meta', text: meta }),
        ]),
        pill(TONES[row.status], t(STATUS_KEYS[row.status])),
      ]),
    ];
    const why = row.reason || planned.reason;
    if (why) children.push(el('p', { class: 'invimp-reason', text: reasonText(why) }));
    if (planned.status === 'maybe-duplicate' || planned.status === 'choose') {
      const d = s.ingredientDecisions[planned.key];
      const value = !d ? '' : d.sameAs ? `same:${d.sameAs}` : d.createNew ? 'new' : 'skip';
      const options = [
        { value: '', label: t('invoiceImport.choosePlaceholder') },
        ...planned.candidates.map(c => ({ value: `same:${c.id}`, label: t('invoiceImport.sameAs', { name: c.label }) })),
      ];
      // An «unisci con …» row named the ingredient it belongs to: a new one is not on offer.
      if (!planned.mergeWith) options.push({ value: 'new', label: t('invoiceImport.ing.createNew') });
      options.push({ value: 'skip', label: t('invoiceImport.skip') });
      children.push(choice(`invimp-ing-${index}`, t('invoiceImport.choose'), options, value, (picked) => {
        if (!picked) delete s.ingredientDecisions[planned.key];
        else if (picked === 'new') s.ingredientDecisions[planned.key] = { createNew: true };
        else if (picked === 'skip') s.ingredientDecisions[planned.key] = { skip: true };
        else s.ingredientDecisions[planned.key] = { sameAs: picked.slice(5) };
        render();
      }));
    }
    return el('div', { class: 'invimp-row' }, children);
  }

  function drawIngredients() {
    if (s.checking) {
      scroll.replaceChildren(el('div', { class: 'invimp-screen' }, [
        ...heading(3, 'invoiceImport.step.ingredients'),
        el('p', { class: 'invimp-note', text: t('invoiceImport.ing.checking') }),
      ]));
      setFooter([]);
      return;
    }
    if (s.checkError) {
      scroll.replaceChildren(el('div', { class: 'invimp-screen' }, [
        ...heading(3, 'invoiceImport.step.ingredients'),
        el('p', { class: 'orders-status error', role: 'alert', text: s.checkError }),
      ]));
      setFooter([button('btn-primary', t('invoiceImport.retry'), startIngredients, { fid: 'invimp-primary' })]);
      return;
    }

    const entries = entriesNow();
    const counts = filterCounts(entries);
    const chips = el('div', { class: 'invimp-filters', role: 'group', 'aria-label': t('invoiceImport.filter.label') },
      visibleFilters(counts, s.filter).map(f => el('button', {
        type: 'button', class: 'invimp-filter', 'aria-pressed': String(s.filter === f), 'data-fid': `invimp-f-${f}`,
        text: `${t(FILTER_KEYS[f])} (${counts[f]})`,
        onClick: () => { s.filter = f; render(); },
      })));

    let index = 0;
    const rowsOf = (list) => list.map(entry => ingredientRow(entry, index++));
    const body = [
      ...heading(3, 'invoiceImport.step.ingredients'),
      el('p', { class: 'invimp-note', text: t('invoiceImport.ing.note') }),
      chips,
    ];
    if (s.filter === 'all') {
      const active = entries.filter(e => !['unchanged', 'error'].includes(bucketOf(e)));
      body.push(el('div', { class: 'invimp-list' }, rowsOf(active)));
      [['unchanged', 'invoiceImport.ing.group.unchanged'], ['error', 'invoiceImport.ing.group.errors']].forEach(([bucket, key]) => {
        const list = entriesFor(entries, bucket);
        if (list.length === 0) return;
        const group = el('details', { class: 'invimp-group', open: s.open[bucket] ? '' : null }, [
          el('summary', { class: 'invimp-group-title', text: t(key, { n: list.length }) }),
          el('div', { class: 'invimp-list' }, rowsOf(list)),
        ]);
        group.addEventListener('toggle', () => { s.open[bucket] = group.open; });
        body.push(group);
      });
    } else {
      const list = entriesFor(entries, s.filter);
      body.push(list.length === 0
        ? el('p', { class: 'mgmt-empty', text: t('invoiceImport.ing.emptyFilter') })
        : el('div', { class: 'invimp-list' }, rowsOf(list)));
    }
    scroll.replaceChildren(el('div', { class: 'invimp-screen' }, body));

    const waiting = waitingCount(entries);
    const totals = importTotals(entries);
    if (waiting > 0) {
      const hint = el('p', { class: 'invimp-hint', id: 'invimp-hint', text: t('invoiceImport.ing.decideFirst', { n: waiting }) });
      setFooter([hint, button('btn-primary', t('invoiceImport.ing.import', { n: totals.rows }), () => {},
        { disabled: true, describedBy: 'invimp-hint', fid: 'invimp-primary' })]);
    } else if (totals.rows === 0) {
      setFooter([
        el('p', { class: 'invimp-hint', text: t('invoiceImport.ing.nothing') }),
        button('btn-primary', t('invoiceImport.done'), () => { s.finished = true; close(); }, { fid: 'invimp-primary' }),
      ]);
    } else {
      setFooter([button('btn-primary', t('invoiceImport.ing.import', { n: totals.rows }), () => confirmAndRun(entries, totals),
        { fid: 'invimp-primary' })]);
    }
  }

  async function confirmAndRun(entries, totals) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await alertDialog(t('invoiceImport.stop.offline'));
      return;
    }
    const lines = [
      totals.newIngredients > 0 ? t('invoiceImport.ing.confirmNew', { n: totals.newIngredients }) : '',
      totals.pricesAdded > 0 ? t('invoiceImport.ing.confirmPrices', { n: totals.pricesAdded }) : '',
    ].filter(Boolean);
    const ok = await confirmDialog({
      title: t('invoiceImport.ing.confirmTitle'),
      message: lines.join('\n'),
      okLabel: t('invoiceImport.ing.confirmOk'),
      cancelLabel: t('ui.cancel'),
    });
    if (!ok) return;
    await runImport(entries);
  }

  // ── Writing, row by row ───────────────────────────────────────────────────────

  function failureMessage(err, fallbackKey) {
    const kind = stopKind(err);
    if (kind === 'permission') return t('invoiceImport.stop.permission');
    if (kind === 'offline') return t('invoiceImport.stop.offline');
    return t(fallbackKey);
  }

  function drawBusy() {
    const total = s.progress ? s.progress.total : 0;
    const done = s.progress ? s.progress.done : 0;
    scroll.replaceChildren(el('div', { class: 'invimp-screen' }, [
      el('h2', { class: 'invimp-heading', tabindex: '-1', text: t('invoiceImport.working') }),
      total > 0 ? el('progress', { class: 'invimp-progress', max: String(total), value: String(done), 'aria-label': t('invoiceImport.working') }) : null,
    ]));
    setFooter([]);
  }

  // The label of the ingredient a row was answered «Same as»: the candidate list first, the live list after.
  function labelOfIngredient(id, planned) {
    const candidate = (planned.candidates || []).find(c => c.id === id);
    if (candidate) return candidate.label;
    const known = data.ingredients().find(i => i.id === id);
    return known ? (String(known.shortName || '').trim() || String(known.name || '')) : '';
  }

  async function runImport(entries) {
    const writing = entries.filter(writesRow);
    const language = data.language();
    const read = {
      ingredients: (supplierId) => freshIngredientsForSupplier(supplierId),
      pointIds: (id) => invoicePointIds(id),
      price: (id) => freshPrice(id),
    };
    const results = [];
    let stopped = null;
    let notRun = 0;
    s.busy = true;
    s.progress = { done: 0, total: writing.length };
    live.textContent = t('invoiceImport.progress', { done: 1, total: writing.length });
    render();

    // Everything that is not written is accounted for first: nothing is dropped silently.
    entries.forEach(entry => {
      const { planned, row } = entry;
      if (row.status === 'unchanged') results.push({ key: planned.key, name: planned.name, outcome: 'unchanged' });
      else if (row.status === 'skipped') results.push({ key: planned.key, name: planned.name, outcome: 'skipped' });
      else if (row.status === 'error') {
        results.push({ key: planned.key, name: planned.name, outcome: 'failed', reason: reasonText(row.reason), retry: isRetryableReason(row.reason) });
      }
    });

    for (let i = 0; i < writing.length; i++) {
      const { planned } = writing[i];
      const fileIngredient = s.fileByKey.get(planned.key);
      s.progress.done = i;
      live.textContent = t('invoiceImport.progress', { done: i + 1, total: writing.length });
      const bar = scroll.querySelector('progress');
      if (bar) bar.value = i;
      try {
        // ⚠️ THE RE-CHECK: the plan on screen is minutes old, and the rows before this one have changed the
        // catalogue. Plan this one row again on what the server holds NOW, so a name that now matches an
        // ingredient created a moment ago becomes an update, never a second copy.
        const fresh = await replanRow({
          fileIngredient, decision: s.ingredientDecisions[planned.key], supplierIdByKey: s.supplierIdByKey, read,
        });
        if (fresh.waiting) {
          results.push({ key: planned.key, name: planned.name, outcome: 'failed', reason: t('invoiceImport.reason.changed'), retry: true });
        } else if (fresh.row.status === 'unchanged') {
          results.push({ key: planned.key, name: planned.name, outcome: 'unchanged' });
        } else if (['new', 'update-price', 'history-only'].includes(fresh.row.status)) {
          const batches = ingredientWrites(fresh.row, fileIngredient, new Date().toISOString(), { language });
          if (batches.length > 0) await runImportBatches(batches);
          results.push({
            key: planned.key, name: planned.name, pricesAdded: fresh.row.newPoints.length,
            outcome: batches.length === 0 ? 'unchanged' : (fresh.row.status === 'new' ? 'created' : 'updated'),
          });
        } else {
          results.push({
            key: planned.key, name: planned.name, outcome: 'failed', reason: reasonText(fresh.row.reason),
            retry: isRetryableReason(fresh.row.reason),
          });
        }
      } catch (err) {
        console.error('Importing one ingredient failed:', err);
        const kind = stopKind(err);
        results.push({
          key: planned.key, name: planned.name, outcome: 'failed', retry: true,
          reason: kind ? failureMessage(err) : t('invoiceImport.reason.writeFailed', { code: String(err && err.code ? err.code : 'unknown') }),
        });
        if (kind) { stopped = kind; notRun = writing.length - i - 1; break; }
      }
    }

    s.summary = summarizeRun(results, { stopped, notRun });
    // The questions the owner answered by hand, for rows with no article code: next month they would be asked
    // again unless the workbook says «unisci con …» (the script carries it over).
    const failedKeys = new Set(results.filter(r => r.outcome === 'failed').map(r => r.key));
    s.remember = rememberHints(entries.filter(e => !failedKeys.has(e.planned.key)), s.ingredientDecisions, labelOfIngredient);
    s.busy = false;
    s.finished = true;
    live.textContent = '';
    goTo('summary');
  }

  // ── The end ───────────────────────────────────────────────────────────────────

  function drawSummary() {
    const sum = s.summary;
    const body = [
      el('h2', { class: 'invimp-heading', tabindex: '-1', text: t('invoiceImport.step.summary') }),
    ];
    if (sum.stopped) {
      body.push(el('p', { class: 'orders-status error', role: 'alert' }, [
        t(sum.stopped === 'permission' ? 'invoiceImport.stop.permission' : 'invoiceImport.stop.offline'),
        sum.notRun > 0 ? ` ${t('invoiceImport.summary.notRun', { n: sum.notRun })}` : '',
      ]));
    }
    const lines = [
      ['invoiceImport.summary.created', sum.created],
      ['invoiceImport.summary.updated', sum.updated],
      ['invoiceImport.summary.prices', sum.pricesAdded],
      ['invoiceImport.summary.unchanged', sum.unchanged],
      ['invoiceImport.summary.skipped', sum.skipped],
    ];
    body.push(el('div', { class: 'set-section' }, lines.map(([key, n]) => el('div', { class: 'set-row' }, [
      el('div', { class: 'set-text' }, [el('span', { class: 'set-title', text: t(key, { n }) })]),
    ]))));
    if (sum.failed.length > 0) {
      body.push(el('h3', { class: 'mgmt-section-title', text: t('invoiceImport.summary.failed', { n: sum.failed.length }) }));
      body.push(el('div', { class: 'invimp-list' }, sum.failed.map(f => el('div', { class: 'invimp-row' }, [
        el('span', { class: 'mgmt-item-name', text: f.name }),
        el('p', { class: 'invimp-reason', text: f.reason }),
      ]))));
    }
    // ⚠️ «LOAD THE SAME FILE AGAIN» ONLY WHEN A SECOND LOAD CAN HELP: a write that failed, a timeout, a
    // catalogue that changed. An entry that is invalid in the file stays invalid however often it is loaded.
    if (sum.retryable > 0 || sum.stopped) {
      body.push(el('p', { class: 'invimp-note', text: t('invoiceImport.summary.again') }));
    }
    if (sum.notFixableByRetry > 0) {
      body.push(el('p', { class: 'invimp-note', text: t('invoiceImport.summary.fixFile') }));
    }
    if (s.remember.length > 0) {
      body.push(el('div', { class: 'invimp-list' }, s.remember.map(r => el('p', { class: 'invimp-note', text:
        t('invoiceImport.summary.remember', { target: r.target, item: r.name }) }))));
    }
    scroll.replaceChildren(el('div', { class: 'invimp-screen' }, body));
    setFooter([button('btn-primary', t('invoiceImport.done'), close, { fid: 'invimp-primary' })]);
  }

  openOverlay = node;
  document.body.appendChild(node);
  render();
  const first = scroll.querySelector('h2');
  if (first) first.focus({ preventScroll: true });
}
