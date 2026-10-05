// invoice-import-screen.js — «Import from invoices»: suppliers and ingredients, with their prices, from
// the supplier e-invoices. The owner picks the zip(s) downloaded from the Agenzia delle Entrate and the app reads
// them itself (invoice-zip/, selection.js); a .json file made by the local script (invoice-import/README.md) is
// still accepted. On the zip path what the owner decides is remembered in `invoice-decisions`, written only
// when the import is confirmed.
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
  rememberHints, priceChange, planPriceChanges, priceChangeBatches, ingredientDisplayName,
} from './invoice-import-plan.js';
import {
  createImportedSupplier, linkSupplierVat, freshSuppliers, freshIngredientsForSupplier, invoicePointIds,
  freshPrice, runImportBatches, loadInvoiceDecisions, writeInvoiceDecisions, storedPriceChangeIds,
} from './invoice-import-data.js';
import { buildImportFromInvoices } from './invoice-zip/build-import.js';
import { domToTree } from './invoice-zip/fatturapa.js';
import { selectImport, decisionChanges } from './invoice-zip/selection.js';

// An article code the way the model compares them (invoice-import-model.js codeOf): trimmed, lower case.
const codeKey = (code) => (typeof code === 'string' ? code.trim().toLowerCase() : '');

// The browser's own XML parser, the way build-import.js asks for one: text → tree. domToTree throws when the
// parser answered with a <parsererror> document (a broken file is skipped by the reader, never a crash).
function browserParseXml(text) {
  return domToTree(new DOMParser().parseFromString(text, 'application/xml'));
}

// The words for every code the invoice reader can hand the screen (invoice-zip/reasons.js). A note that holds
// several reasons joins their codes with «; » (codesText).
const CODE_KEYS = Object.freeze({
  // why a price needs checking, or has none
  'egg-quantity-unclear': 'invoiceImport.code.eggQuantityUnclear',
  'price-out-of-scale': 'invoiceImport.code.priceOutOfScale',
  'unattributed-discount': 'invoiceImport.code.unattributedDiscount',
  'mixed-units': 'invoiceImport.code.mixedUnits',
  'no-weight-on-invoice': 'invoiceImport.code.noWeightOnInvoice',
  'no-price-unit': 'invoiceImport.code.noPriceUnit',
  'no-piece-weight': 'invoiceImport.code.noPieceWeight',
  'quantity-zero-or-negative': 'invoiceImport.code.quantityZero',
  'amount-zero-or-negative': 'invoiceImport.code.amountZero',
  'price-unit-differs-from-invoice-unit': 'invoiceImport.code.unitDiffers',
  'price-unit-pack-mismatch': 'invoiceImport.code.packMismatch',
  'price-unit-unreadable': 'invoiceImport.code.unitUnreadable',
  'pack-weight-unreadable': 'invoiceImport.code.packWeightUnreadable',
  'pack-count-unreadable': 'invoiceImport.code.packCountUnreadable',
  // why a product could not be read
  'pieces-need-price-unit-and-weight': 'invoiceImport.code.piecesNeedUnit',
  'pieces-need-pack-weight': 'invoiceImport.code.piecesNeedWeight',
  'no-computable-price': 'invoiceImport.code.noComputablePrice',
  'needs-checking': 'invoiceImport.code.needsChecking',
  // why a file was skipped
  'file-too-large': 'invoiceImport.code.fileTooLarge',
  'dtd-not-allowed': 'invoiceImport.code.dtdNotAllowed',
  'xml-unreadable': 'invoiceImport.code.xmlUnreadable',
  'too-many-invoices-in-file': 'invoiceImport.code.tooManyInvoices',
  'zip-unreadable': 'invoiceImport.code.zipUnreadable',
  'too-many-entries': 'invoiceImport.code.tooManyEntries',
  'archive-too-large': 'invoiceImport.code.archiveTooLarge',
});

// A row's status or bucket → the tone of its pill and the word it carries. The word is ALWAYS there: the
// colour only repeats it (P18).
const TONES = Object.freeze({
  new: 'ok', present: 'ok', 'update-price': 'ok',
  'history-only': 'quiet', unchanged: 'quiet', skipped: 'quiet',
  maybe: 'warn', 'maybe-duplicate': 'warn', choose: 'warn', decide: 'warn', check: 'warn',
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
  check: 'invoiceImport.status.priceCheck',
});

const FILTER_KEYS = Object.freeze({
  all: 'invoiceImport.filter.all',
  new: 'invoiceImport.status.new',
  'update-price': 'invoiceImport.status.updatePrice',
  'history-only': 'invoiceImport.status.historyOnly',
  unchanged: 'invoiceImport.status.unchanged',
  check: 'invoiceImport.status.priceCheck',
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

// The first-screen groups of what is NOT imported: [selection group, title key, tick-box key].
const FILE_GROUPS = Object.freeze([
  ['notImported', 'invoiceImport.zip.group.notImported', 'invoiceImport.zip.importAsIngredient'],
  ['skippedByYou', 'invoiceImport.zip.group.skippedByYou', 'invoiceImport.zip.importAgain'],
]);

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
    // the invoices path (zip / xml): what was read, what the venue remembered, and what the person ticked
    reading: false,
    built: null,             // buildImportFromInvoices() result; null on the .json path
    selection: null,         // selectImport() of the state on screen
    storedDecisions: [],     // invoice-decisions as they were when the files were read
    overrides: {},           // { [productKey]: 'ingredient' } ticked on the first screen
    supplierOverrides: {},   // { [supplierKey]: 'import' } a remembered supplier ticked «import again»
    supplierSkips: new Set(),// step 2: «do not import anything from this supplier (remember)»
    forgetKeys: new Set(),   // step 3: «do not import (remember)»
    decisionsWritten: 0,
    decisionsFailed: false,
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
    open: {
      unchanged: false, error: false, check: false,
      notImported: false, skippedByYou: false, skippedSuppliers: false, unreadable: false, skippedFiles: false,
    },
    // the end
    summary: null,
    remember: [],
    focusHeading: false,
    progress: null,
  };

  // ONE input for the life of the screen: redrawing it would forget the file it holds.
  const fileInput = el('input', {
    type: 'file', class: 'invimp-file-input', id: 'invimp-file', 'data-fid': 'invimp-file',
    accept: '.zip,.xml,.json,application/zip,application/json', multiple: '',
  });
  fileInput.addEventListener('change', () => onFileChosen(Array.from(fileInput.files || [])));
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

  // One or several reader codes («a; b») → the sentence(s) a person reads.
  const codesText = (text) => String(text || '').split('; ').filter(Boolean)
    .map(code => (CODE_KEYS[code] ? t(CODE_KEYS[code]) : t('invoiceImport.reason.unknown'))).join(' · ');

  function checkbox(id, labelText, checked, onChange) {
    const box = el('input', { type: 'checkbox', id, 'data-fid': id, checked: checked ? '' : null });
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked));
    return el('label', { class: 'invimp-check', for: id }, [box, el('span', { text: labelText })]);
  }

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
    if (s.reading) body.push(el('p', { class: 'invimp-note', role: 'status', text: t('invoiceImport.file.reading') }));
    if (s.fileError) body.push(el('p', { class: 'orders-status error', role: 'alert', text: s.fileError }));
    if (s.file) {
      body.push(el('p', { class: 'orders-status ok', role: 'status' }, [
        s.selection ? `${t('invoiceImport.zip.invoices', { n: s.selection.counts.invoices })} · ` : '',
        t('invoiceImport.file.found.suppliers', { n: s.file.suppliers.length }),
        ' · ',
        t('invoiceImport.file.found.ingredients', { n: s.file.ingredients.length }),
      ]));
    }
    if (s.selection) body.push(...drawSelection());
    scroll.replaceChildren(el('div', { class: 'invimp-screen' }, body));
    setFooter([s.file && !s.reading ? button('btn-primary', t('invoiceImport.next'), startSuppliers, { fid: 'invimp-next' }) : null]);
  }

  // What the invoices held that is NOT in this import, in groups that stay closed until opened: each product with
  // a tick-box that puts it back (or, for a remembered choice, takes it out of the memory). Ticking changes the
  // selection at once, in memory — nothing is saved before the import is confirmed.
  function drawSelection() {
    const { groups, counts } = s.selection;
    const out = [];
    const facts = [
      counts.excludedDocuments > 0 ? t('invoiceImport.zip.excluded', { n: counts.excludedDocuments }) : '',
      counts.p7m > 0 ? t('invoiceImport.zip.signed', { n: counts.p7m }) : '',
    ].filter(Boolean);
    if (facts.length > 0) out.push(el('p', { class: 'invimp-note', text: facts.join(' · ') }));

    const group = (id, title, children) => {
      const details = el('details', { class: 'invimp-group', open: s.open[id] ? '' : null }, [
        el('summary', { class: 'invimp-group-title', text: title }),
        el('div', { class: 'invimp-list' }, children),
      ]);
      details.addEventListener('toggle', () => { s.open[id] = details.open; });
      return details;
    };
    const productRow = (item, groupId, tickKey, index) => {
      const rowChildren = [
        el('div', { class: 'invimp-row-main' }, [
          el('span', { class: 'mgmt-item-name', text: item.name || item.key }),
          el('span', { class: 'mgmt-item-meta', text: [item.supplierName, item.description].filter(Boolean).join(' · ') }),
        ]),
      ];
      if (item.canImport) {
        rowChildren.push(checkbox(`invimp-tick-${groupId}-${index}`, t(tickKey), item.checked, (on) => {
          if (on) s.overrides[item.key] = 'ingredient'; else delete s.overrides[item.key];
          applySelection();
          render();
        }));
      } else if (item.reason) {
        rowChildren.push(el('p', { class: 'invimp-reason', text: codesText(item.reason) }));
      }
      return el('div', { class: 'invimp-row' }, rowChildren);
    };
    FILE_GROUPS.forEach(([id, titleKey, tickKey]) => {
      const list = groups[id];
      if (list.length > 0) out.push(group(id, t(titleKey, { n: list.length }), list.map((item, i) => productRow(item, id, tickKey, i))));
    });
    if (groups.skippedSuppliers.length > 0) {
      out.push(group('skippedSuppliers', t('invoiceImport.zip.group.skippedSuppliers', { n: groups.skippedSuppliers.length }),
        groups.skippedSuppliers.map((sup, i) => el('div', { class: 'invimp-row' }, [
          el('div', { class: 'invimp-row-main' }, [
            el('span', { class: 'mgmt-item-name', text: sup.name || sup.key }),
            el('span', { class: 'mgmt-item-meta', text: t('invoiceImport.zip.supplierProducts', { n: sup.products }) }),
          ]),
          checkbox(`invimp-tick-supplier-${i}`, t('invoiceImport.zip.importAgain'), sup.checked, (on) => {
            if (on) s.supplierOverrides[sup.key] = 'import'; else delete s.supplierOverrides[sup.key];
            applySelection();
            render();
          }),
        ]))));
    }
    if (groups.unreadable.length > 0) {
      out.push(group('unreadable', t('invoiceImport.zip.group.unreadable', { n: groups.unreadable.length }),
        groups.unreadable.map((item, i) => productRow(item, 'unreadable', 'invoiceImport.zip.importAsIngredient', i))));
    }
    if (groups.skippedFiles.length > 0) {
      out.push(group('skippedFiles', t('invoiceImport.zip.group.skippedFiles', { n: groups.skippedFiles.length }),
        groups.skippedFiles.map(f => el('div', { class: 'invimp-row' }, [
          el('span', { class: 'mgmt-item-name', text: f.name }),
          el('p', { class: 'invimp-reason', text: codesText(f.reason) }),
        ]))));
    }
    return out;
  }

  // The selection of the invoices path, drawn again from what was read, what the venue remembered and what the
  // person ticked; then the plain import file the rest of the screen reads.
  function applySelection() {
    s.selection = selectImport(s.built, {
      decisions: s.storedDecisions,
      existingSuppliers: data.suppliers(),
      existingIngredients: data.ingredients(),
      overrides: s.overrides,
      supplierOverrides: s.supplierOverrides,
    });
    const parsed = parseImportFile(JSON.stringify(s.selection.importFile));
    s.file = parsed.ok ? parsed.file : null;
    s.fileByKey = new Map((s.file ? s.file.ingredients : []).map(i => [i.key, i]));
  }

  function resetImport() {
    s.file = null;
    s.built = null;
    s.selection = null;
    s.storedDecisions = [];
    s.overrides = {};
    s.supplierOverrides = {};
    s.supplierSkips = new Set();
    s.forgetKeys = new Set();
    s.supplierDecisions = {};
    s.supplierProgress = { created: {}, linked: new Set() };
    s.ingredientDecisions = {};
    s.decisionsWritten = 0;
    s.decisionsFailed = false;
  }

  const isJson = (file) => /\.json$/i.test(file.name || '');

  async function onFileChosen(files) {
    s.fileError = '';
    s.reading = false;
    resetImport();
    s.fileName = files.map(f => f.name).join(', ');
    if (files.length === 0) { render(); return; }
    // One .json file keeps the way it always was; anything else is invoices (zip or xml), one or many.
    if (files.some(isJson) && (files.length > 1 || !isJson(files[0]))) {
      s.fileError = t('invoiceImport.file.mixed');
      render();
      return;
    }
    if (isJson(files[0])) await readImportFile(files[0]);
    else await readInvoices(files);
  }

  async function readImportFile(file) {
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
    render();
  }

  // The invoices the owner downloaded: read in memory, then the venue's remembered decisions (from the server, so
  // offline refuses like every other read of this import). Nothing is written.
  async function readInvoices(files) {
    s.reading = true;
    render();
    // Let the browser paint the «reading» line before the heavy, synchronous part starts.
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      const inputs = [];
      for (const file of files) inputs.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      const parseXml = typeof data.parseXml === 'function' ? data.parseXml : browserParseXml;
      const salt = typeof data.venueId === 'function' ? data.venueId() : '';
      s.built = buildImportFromInvoices(inputs, { parseXml, now: new Date(), salt });
    } catch (err) {
      console.error('The invoices could not be read:', err);
      s.reading = false;
      s.fileError = t('invoiceImport.file.invoicesUnreadable');
      render();
      return;
    }
    try {
      s.storedDecisions = await loadInvoiceDecisions();
    } catch (err) {
      console.error('The remembered decisions could not be read:', err);
      s.reading = false;
      s.built = null;
      s.fileError = failureMessage(err, 'invoiceImport.file.decisionsFailed');
      render();
      return;
    }
    s.reading = false;
    applySelection();
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
    // The lists have arrived now: what an article code already in Mise promotes is read again before planning.
    if (s.built) applySelection();
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
    // A supplier that is not in Mise yet may be one that sells nothing to import (a honey producer, a cleaning firm):
    // «do not import anything from this supplier» drops it and every product of it, now and in the next imports.
    if (s.built && entry.status === 'new') {
      children.push(choice(`invimp-supnew-${index}`, t('invoiceImport.choose'), [
        { value: 'import', label: t('invoiceImport.suppliers.import') },
        { value: 'forget', label: t('invoiceImport.suppliers.forget') },
      ], s.supplierSkips.has(entry.key) ? 'forget' : 'import', (picked) => {
        if (picked === 'forget') s.supplierSkips.add(entry.key); else s.supplierSkips.delete(entry.key);
        render();
      }));
    }
    return el('div', { class: 'invimp-row' }, children);
  }

  // The person's answers, with every «do not import anything from this supplier» as a skip.
  function supplierDecisionsNow() {
    const out = { ...s.supplierDecisions };
    s.supplierSkips.forEach(key => { out[key] = { skip: true }; });
    return out;
  }

  function drawSuppliers() {
    const writes = supplierWrites(s.supplierPlan, supplierDecisionsNow());
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
        changed.forEach(key => { delete s.supplierDecisions[key]; s.supplierSkips.delete(key); });
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
      const active = s.file.ingredients.filter(i => !s.supplierSkips.has(i.supplierKey));
      const first = planIngredients(active, ctxFor({}));
      const ids = idsToCheck(first);
      const known = {};
      for (let i = 0; i < ids.length; i += READ_CHUNK) {
        const part = ids.slice(i, i + READ_CHUNK);
        const sets = await Promise.all(part.map(id => invoicePointIds(id)));
        part.forEach((id, k) => { known[id] = sets[k]; });
      }
      s.ctx = ctxFor(known);
      s.plannedRows = planIngredients(active, s.ctx);
    } catch (err) {
      console.error('Checking the recorded invoice prices failed:', err);
      s.checkError = failureMessage(err, 'invoiceImport.ing.checkFailed');
    }
    s.checking = false;
    live.textContent = '';
    render();
  }

  const entriesNow = () => applyDecisions(s.plannedRows, s.ingredientDecisions, s.ctx, s.forgetKeys);

  // What the person's answers of this import would leave in the remembered decisions (nothing on the .json path).
  function decisionChangesNow() {
    if (!s.built) return { set: [], remove: [] };
    const nameOf = (key) => {
      const sup = s.file.suppliers.find(x => x.key === key);
      return sup ? sup.name : key;
    };
    const itemLabel = (key) => {
      const info = s.selection.byKey.get(key);
      const ing = s.fileByKey.get(key);
      return info ? info.label : (ing ? ing.name : key);
    };
    return decisionChanges({
      selection: s.selection,
      decisions: s.storedDecisions,
      overrides: s.overrides,
      supplierOverrides: s.supplierOverrides,
      supplierSkips: [...s.supplierSkips].map(key => ({ key, name: nameOf(key) })),
      itemSkips: [...s.forgetKeys]
        .filter(key => { const ing = s.fileByKey.get(key); return ing && !s.supplierSkips.has(ing.supplierKey); })
        .map(key => ({ key, label: itemLabel(key) })),
    });
  }
  const decisionCount = () => { const c = decisionChangesNow(); return c.set.length + c.remove.length; };

  function supplierNameOf(planned) {
    const fileIng = s.fileByKey.get(planned.key);
    const id = fileIng && s.supplierIdByKey ? s.supplierIdByKey[fileIng.supplierKey] : null;
    const known = id ? data.suppliers().find(x => x.id === id) : null;
    if (known) return supplierLabel(known);
    const fromFile = fileIng ? s.file.suppliers.find(x => x.key === fileIng.supplierKey) : null;
    return fromFile ? fromFile.name : '';
  }

  // The price on a row. A row that replaces the price in force says what it replaces and by how much:
  // «2,10 €/kg → 2,31 €/kg (+10%)» — only when both prices are in the same unit.
  function priceText(planned, row) {
    const fileIng = s.fileByKey.get(planned.key);
    const last = planned.allPoints[planned.allPoints.length - 1];
    if (!fileIng || !last) return '';
    const now = formatPricePerUnit({ pricePerUnit: last.pricePerUnit, priceUnit: fileIng.priceUnit });
    if (row && row.status === 'update-price' && s.ctx) {
      const stored = (s.ctx.pricesById || {})[row.ingredientId];
      const next = row.newPoints[row.newPoints.length - 1];
      const change = next ? priceChange(stored, next.pricePerUnit, fileIng.priceUnit) : null;
      if (change) {
        const sign = change.percent === 0 ? '=' : `${change.percent > 0 ? '+' : '-'}${Math.abs(change.percent)}%`;
        return t('invoiceImport.ing.priceChange', {
          from: formatPricePerUnit({ pricePerUnit: stored.pricePerUnit, priceUnit: stored.priceUnit }),
          to: formatPricePerUnit({ pricePerUnit: next.pricePerUnit, priceUnit: fileIng.priceUnit }),
          change: sign,
        });
      }
    }
    return now;
  }

  function ingredientRow(entry, index) {
    const { planned, row } = entry;
    const invoices = invoiceCount(planned);
    const meta = [
      supplierNameOf(planned),
      priceText(planned, row),
      invoices > 0 ? t('invoiceImport.invoices', { n: invoices }) : '',
    ].filter(Boolean).join(' · ');
    // A wanted ingredient with no price of its own is told apart by a pill of its own and says why.
    const needsCheck = bucketOf(entry) === 'check' && ['new', 'unchanged'].includes(row.status);
    const children = [
      el('div', { class: 'invimp-row-top' }, [
        el('div', { class: 'invimp-row-main' }, [
          el('span', { class: 'mgmt-item-name', text: planned.name || planned.key }),
          el('span', { class: 'mgmt-item-meta', text: meta }),
        ]),
        needsCheck ? pill(TONES.check, t(STATUS_KEYS.check)) : pill(TONES[row.status], t(STATUS_KEYS[row.status])),
      ]),
    ];
    const why = row.reason || planned.reason;
    if (why) children.push(el('p', { class: 'invimp-reason', text: reasonText(why) }));
    if (planned.priceCheck) children.push(el('p', { class: 'invimp-reason', text: codesText(planned.priceCheck) }));
    // A NEW ingredient from the invoices: create it (the default, never blocking the button) or leave it out and
    // remember that, so the next import does not offer it again.
    if (s.built && planned.status === 'new') {
      children.push(choice(`invimp-new-${index}`, t('invoiceImport.choose'), [
        { value: 'create', label: t('invoiceImport.ing.create') },
        { value: 'forget', label: t('invoiceImport.ing.forget') },
      ], s.forgetKeys.has(planned.key) ? 'forget' : 'create', (picked) => {
        if (picked === 'forget') s.forgetKeys.add(planned.key); else s.forgetKeys.delete(planned.key);
        render();
      }));
    }
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
      const active = entries.filter(e => !['unchanged', 'check', 'error'].includes(bucketOf(e)));
      body.push(el('div', { class: 'invimp-list' }, rowsOf(active)));
      [
        ['unchanged', 'invoiceImport.ing.group.unchanged'],
        ['check', 'invoiceImport.ing.group.check'],
        ['error', 'invoiceImport.ing.group.errors'],
      ].forEach(([bucket, key]) => {
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
        button('btn-primary', t('invoiceImport.done'), () => finishWithoutRows(entries), { fid: 'invimp-primary' }),
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
      decisionCount() > 0 ? t('invoiceImport.decisions.confirmLine', { n: decisionCount() }) : '',
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

  // Nothing is left to import (everything is already in Mise, skipped or left out): the person's «do not import»
  // answers are still worth keeping, so they are confirmed and saved before the screen closes.
  // ⚠️ Rows already in Mise still go through the run: their stored history may hold price changes nobody
  // recorded yet (a file loaded again, last year's zips). That run ends on the summary, which says how many.
  async function finishWithoutRows(entries) {
    const n = decisionCount();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    // Offline, the changes are simply not looked for: a file with nothing new can still be closed.
    const hasQuiet = !offline && entries.some(e => e.row.status === 'unchanged' && e.row.ingredientId);
    if (n > 0 && offline) {
      await alertDialog(t('invoiceImport.stop.offline'));
      return;
    }
    if (n > 0) {
      const ok = await confirmDialog({
        title: t('invoiceImport.decisions.confirmTitle'),
        message: t('invoiceImport.decisions.confirmLine', { n }),
        okLabel: t('ui.save'),
        cancelLabel: t('ui.cancel'),
      });
      if (!ok) return;
    }
    if (hasQuiet) {
      await runImport(entries);
      return;
    }
    if (n > 0) {
      s.busy = true;
      render();
      try {
        await writeInvoiceDecisions(decisionChangesNow());
      } catch (err) {
        console.error('Remembering the decisions failed:', err);
        s.busy = false;
        render();
        await alertDialog(failureMessage(err, 'invoiceImport.decisions.failed'));
        return;
      }
      s.busy = false;
    }
    s.finished = true;
    close();
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
      changeIds: (id) => storedPriceChangeIds(id),
    };
    const nowIso = new Date().toISOString();
    // The price changes of one ingredient, written in their OWN batches after the row's prices: a refused change
    // never undoes a price that is already in. → how many were written.
    const recordChanges = async (info) => {
      const ops = await planPriceChanges({ ...info, read, nowIso });
      const batches = priceChangeBatches(ops);
      if (batches.length > 0) await runImportBatches(batches);
      return ops.length;
    };
    // ⚠️ THE RE-CHECK MUST NOT TRIP OVER THIS VERY RUN (5 Oct 2026, the first real zip: 43 of 238 rows
    // came back «a similar ingredient appeared»). Two invoice products of one supplier with DIFFERENT
    // article codes are two products by the supplier's own numbering — «Aceto bianco» and «Aceto rosso» —
    // and both were planned «new» on the screen the owner confirmed. So an ingredient created by this run
    // is hidden from the re-check of a row whose code differs from its own. Without a code on either side
    // (or a «unisci con» row) nothing is hidden: then a similar name really may be the same product, and
    // the row still becomes a question rather than a duplicate.
    const createdThisRun = new Map();   // ingredient id → its article code (normalised), created by this run
    const readFor = (fileIngredient) => {
      const code = codeKey(fileIngredient.supplierCode);
      if (!code || fileIngredient.mergeWith) return read;
      return {
        ...read,
        ingredients: async (supplierId) => (await read.ingredients(supplierId)).filter((i) => {
          const created = createdThisRun.get(i.id);
          return created === undefined || !created || created === code;
        }),
      };
    };
    const results = [];
    let stopped = null;
    let notRun = 0;
    s.busy = true;
    // Rows already in Mise are read too (their history may hold changes nobody recorded): they count in the bar.
    const quiet = entries.filter(e => e.row.status === 'unchanged' && e.row.ingredientId);
    s.progress = { done: 0, total: writing.length + quiet.length };
    live.textContent = t('invoiceImport.progress', { done: 1, total: writing.length });
    render();

    // ⚠️ THE REMEMBERED ANSWERS GO FIRST, in small batches: a run that stops half-way must not lose what the person
    // decided. A failure here stops nothing else; the summary says so.
    const changes = decisionChangesNow();
    if (changes.set.length + changes.remove.length > 0) {
      try {
        s.decisionsWritten = await writeInvoiceDecisions(changes);
      } catch (err) {
        console.error('Remembering the decisions failed:', err);
        s.decisionsFailed = true;
      }
    }

    // Everything that is not written is accounted for first: nothing is dropped silently.
    entries.forEach(entry => {
      const { planned, row } = entry;
      if (row.status === 'skipped') results.push({ key: planned.key, name: planned.name, outcome: 'skipped' });
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
          fileIngredient, decision: s.ingredientDecisions[planned.key], supplierIdByKey: s.supplierIdByKey,
          read: readFor(fileIngredient),
        });
        if (fresh.waiting) {
          results.push({ key: planned.key, name: planned.name, outcome: 'failed', reason: t('invoiceImport.reason.changed'), retry: true });
        } else if (fresh.row.status === 'unchanged') {
          const changesAdded = await recordChanges({
            ingredientId: fresh.row.ingredientId, supplierId: fresh.row.supplierId, name: ingredientDisplayName(fresh.ingredient),
            storedPoints: fresh.storedPoints, newPoints: [], priceUnit: fileIngredient.priceUnit, isNew: false,
          });
          results.push({ key: planned.key, name: planned.name, outcome: 'unchanged', changesAdded });
        } else if (['new', 'update-price', 'history-only'].includes(fresh.row.status)) {
          const batches = ingredientWrites(fresh.row, fileIngredient, new Date().toISOString(), { language });
          const isNew = fresh.row.status === 'new';
          const writtenId = batches.length > 0 ? await runImportBatches(batches) : fresh.row.ingredientId;
          if (isNew && writtenId) createdThisRun.set(writtenId, codeKey(fileIngredient.supplierCode));
          const changesAdded = await recordChanges({
            ingredientId: writtenId, supplierId: fresh.row.supplierId,
            name: isNew ? fileIngredient.name : ingredientDisplayName(fresh.ingredient),
            storedPoints: isNew ? [] : fresh.storedPoints, newPoints: fresh.row.newPoints,
            priceUnit: fileIngredient.priceUnit, isNew,
          });
          results.push({
            key: planned.key, name: planned.name, pricesAdded: fresh.row.newPoints.length, changesAdded,
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

    // Rows that were already in Mise: their stored history may hold changes nobody recorded yet (a file loaded
    // again, last year's zips). The points come from the read made when the plan was drawn.
    for (let i = 0; i < quiet.length; i++) {
      const { planned, row } = quiet[i];
      if (stopped) { results.push({ key: planned.key, name: planned.name, outcome: 'unchanged' }); continue; }
      s.progress.done = writing.length + i;
      const bar = scroll.querySelector('progress');
      if (bar) bar.value = writing.length + i;
      try {
        const known = s.ctx && s.ctx.invoicePointIds ? s.ctx.invoicePointIds[row.ingredientId] : null;
        const points = known && Array.isArray(known.points) ? known.points : (await read.pointIds(row.ingredientId)).points || [];
        const stored = data.ingredients().find(x => x.id === row.ingredientId);
        const changesAdded = await recordChanges({
          ingredientId: row.ingredientId, supplierId: row.supplierId, name: ingredientDisplayName(stored) || planned.name,
          storedPoints: points, newPoints: [], priceUnit: row.priceUnit, isNew: false,
        });
        results.push({ key: planned.key, name: planned.name, outcome: 'unchanged', changesAdded });
      } catch (err) {
        console.error('Recording the price changes of one ingredient failed:', err);
        const kind = stopKind(err);
        results.push({
          key: planned.key, name: planned.name, outcome: 'failed', retry: true,
          reason: kind ? failureMessage(err) : t('invoiceImport.reason.writeFailed', { code: String(err && err.code ? err.code : 'unknown') }),
        });
        if (kind) stopped = kind;
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
      ['invoiceImport.summary.changes', sum.changesAdded],
      ['invoiceImport.summary.unchanged', sum.unchanged],
      ['invoiceImport.summary.skipped', sum.skipped],
    ];
    if (s.decisionsWritten > 0) lines.push(['invoiceImport.summary.decisions', s.decisionsWritten]);
    body.push(el('div', { class: 'set-section' }, lines.map(([key, n]) => el('div', { class: 'set-row' }, [
      el('div', { class: 'set-text' }, [el('span', { class: 'set-title', text: t(key, { n }) })]),
    ]))));
    if (s.decisionsFailed) body.push(el('p', { class: 'orders-status error', role: 'alert', text: t('invoiceImport.decisions.failed') }));
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
