// clients-editor.js — the Clients editor (#cp-overlay), shared by two pages.
//
// It opens from the Calculator's Settings hub (calculator-settings.js) and from the sales
// owner's own Clients page (clients/clients-main.js). It was moved here out of
// calculator-settings.js unchanged, so one editor serves both and cannot drift.
//
// THE MODEL: a product belongs to the client that orders it. Open a client and you see
// everything about each of its products — name, recipe, weight, how the quantity is
// typed, and the crate box — with nothing to visit first. The separate Products screen
// (a shared catalogue you had to fill in before a client could reference it) is gone:
// it cost two screens and seven steps to add one product, and in the real data only one
// product out of ten was ever shared between two clients.
//
// The editor works on a deep copy of the live config and touches nothing until the user
// taps Save (with a confirm), which persists through the config store (Firestore +
// cache) and triggers a calculator re-render. Required fields are validated on Save;
// deleting is a small low-key icon, never competing with Save (P20).

import { t } from './i18n.js';
import { copyToClipboard } from './share.js';
import { chooseHowToSend } from './send-sheet.js';
import { SEND_PATHS, svgElement } from './send-icon.js';
import { getConfig, saveConfigOrSay } from './calculator-config-store.js';
import {
  WEIGHT_MIN, WEIGHT_MAX, cloneConfig, getRecipes, pairId,
} from './calculator-config.js';
import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';
import { confirmDiscard } from './calculator-confirm.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { createSaveGuard } from './save-guard.js';
import {
  listOrderingAccounts, createOrderingLink, revokeOrderingLink, orderingLinkFor,
} from './client-orders-data.js';
import { currentSession } from './firebase.js';
import { worksOnClients } from './roles.js';
import Sortable from './vendor/sortable.esm.js';

// One guard for the header Save: while a write is in flight the button is disabled, a second
// tap does nothing and Back / Home are ignored until it settles (js/save-guard.js).
const clientsSaveGuard = createSaveGuard(() => document.getElementById('cp-save-btn'));

// How the quantity is entered on the calculator. 'kg' is not offered here (it is a
// legacy widget tied to the old extra-dough product, no longer creatable).
// A function, not a table built at load: the venue's language arrives after that.
function typeLabel(kind) {
  return kind === 'dropdown' ? t('calc.type.dropdown') : t('calc.type.number');
}

let working = null;        // Clients editor: deep copy being edited
let activeClient = null;   // null = the client list, an index = a client's detail
let freshlyAdded = false;  // the item just opened was created by an "Add" button
let showErrors = false;    // after a failed Save, mark empty required fields
let dirty = false;

function show(id) { document.getElementById(id).classList.add('visible'); }
function hide(id) { document.getElementById(id).classList.remove('visible'); }

// Unique element id for a newly created client/product/group.
function genId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 8);
}

function isBlank(s) { return !s || !String(s).trim(); }

// ── Clients editor ─────────────────────────────────────────────────────────────
function clients() {
  if (!Array.isArray(working.clients)) working.clients = [];
  return working.clients;
}

function cpTitle() { return document.querySelector('#cp-overlay .recipe-overlay-title'); }

// The header Home button is hidden on detail screens, shown on the list.
function setHomeVisible(visible) {
  const btn = document.getElementById('cp-home-btn');
  if (btn) btn.hidden = !visible;
}

export function openClients() {
  working = cloneConfig(getConfig());
  activeClient = null;
  freshlyAdded = false;
  showErrors = false;
  dirty = false;
  renderEditor();
  show('cp-overlay');
  // Which clients already have an ordering link. Read in the background so the editor
  // opens instantly; the screen is repainted when the answer arrives, and until then
  // the link section simply offers to create one — which is also what it says if the
  // read fails, so an offline phone gets a screen it can still read.
  loadOrderingAccounts().then(() => { if (working) renderEditor(); });
}

// True when a just-added client was left untouched (no name, no products), so it should
// not be kept when leaving its detail screen.
function isEmptyClient(c) {
  return !c || (isBlank(c.name) && (!c.products || c.products.length === 0));
}

async function closeClients() {
  if (clientsSaveGuard.saving) return;
  if (activeClient !== null) {
    const client = clients()[activeClient];
    if (freshlyAdded && isEmptyClient(client)) {
      if (!(await confirmDialog({ message: t('calc.discardThisNewClient'), okLabel: t('ui.discard'), danger: true, cancelLabel: t('ui.cancel') }))) return;
      clients().splice(activeClient, 1);
    }
    freshlyAdded = false;
    activeClient = null;
    renderEditor();
    return;
  }
  if (!(await confirmDiscard(dirty))) return;
  hide('cp-overlay');
}

async function goHomeFromClients() {
  if (clientsSaveGuard.saving) return;
  if (!(await confirmDiscard(dirty))) return;
  window.location.href = 'index.html';
}

// `dirty` does not drive the header Save (#cp-save-btn) — it is always pressable —
// but it is still what asks "Discard unsaved changes?" on the way out.
function markDirty() { dirty = true; }

// The index of the first client that is invalid (a blank name, or a product with no
// name), or null if every client and product is complete.
function findInvalid() {
  const cs = clients();
  for (let i = 0; i < cs.length; i++) {
    if (isBlank(cs[i].name)) return i;
    for (const p of (cs[i].products || [])) if (isBlank(p.name)) return i;
  }
  return null;
}

function saveClients() { return clientsSaveGuard.run(doSaveClients); }

async function doSaveClients() {
  const invalid = findInvalid();
  if (invalid !== null) {
    showErrors = true;
    activeClient = invalid;
    renderEditor();
    alertDialog(t('calc.pleaseGiveEveryClient'));
    return;
  }
  if (!(await confirmDialog({ message: t('calc.saveTheseChanges'), okLabel: t('ui.save'), cancelLabel: t('ui.cancel') }))) return;
  try {
    if (!(await saveConfigOrSay(working))) return;
    forgetPausedQuantities();
    showErrors = false;
    dirty = false;
    freshlyAdded = false;
    activeClient = null;
    renderEditor();
  } catch (e) {
    alertDialog(t('calc.couldNotSaveCheck'));
  }
}

// Drop the typed quantity of every paused product.
//
// ⚠️ Quantities live for days — only "Reset all fields" clears them, and that clears
// only the rows it can SEE. A paused product has no row, so its number would become
// unreachable and then reappear inside a real dough on the day it is switched back on,
// with no warning. Idempotent, so it needs no before/after comparison.
function forgetPausedQuantities() {
  for (const client of clients()) {
    for (const product of (client.products || [])) {
      if (product && product.active === false) {
        try { localStorage.removeItem('qty-' + pairId(client.id, product.id)); } catch (e) {}
      }
    }
  }
}

function renderEditor() {
  if (activeClient === null) renderClientList();
  else renderClientDetail(activeClient);
}

function deleteIcon(label, onDelete) {
  const btn = el('button', { class: 'cp-del-icon', type: 'button', 'aria-label': label }, icon('trash', 17));
  btn.addEventListener('click', onDelete);
  return btn;
}

// ── Clients Level 0: the address book ─────────────────────────────────────────
let clientSortable = null;

function renderClientList() {
  cpTitle().textContent = t('ui.clients');
  setHomeVisible(true);
  const content = document.getElementById('cp-content');
  if (clientSortable) { clientSortable.destroy(); clientSortable = null; }
  content.textContent = '';

  // ⚠️ AN EMPTY ADDRESS BOOK IS NOW THE STATE EVERY NEW CUSTOMER STARTS IN (13 Aug
  // 2026), and it was found by LOOKING at the rendered screen rather than measuring
  // it: with no clients, "+ Add client" and "Save" sit directly on top of each other
  // as two identical full-width green buttons, and the eye cannot tell which is the
  // one to press. One line above them settles it — and says what a client is FOR,
  // which the screen never did because until now it was never seen empty.
  if (clients().length === 0) {
    content.appendChild(el('div', { class: 'cp-empty-hint' },
      t('calc.noClientsYet')));
  }

  const listWrap = el('div', { class: 'cp-client-list' });
  clients().forEach((client, ci) => listWrap.appendChild(clientBox(client, ci)));
  content.appendChild(listWrap);

  if (clients().length > 1) {
    clientSortable = Sortable.create(listWrap, {
      animation: 150,
      delay: 200,
      delayOnTouchOnly: true,
      draggable: '.drill-reorder',
      ghostClass: 'cp-sortable-ghost',
      chosenClass: 'cp-sortable-chosen',
      dragClass: 'cp-sortable-drag',
      onEnd: syncClientOrderFromDom,
    });
  }

  const add = el('button', { class: 'cp-add-client', type: 'button' }, t('calc.addClient'));
  add.addEventListener('click', () => {
    clients().push({ id: genId('c'), name: '', products: [] });
    markDirty();
    freshlyAdded = true;
    activeClient = clients().length - 1;
    renderEditor();
  });
  content.appendChild(add);

  // ⚠️ The list is savable in its own right: dragging a client to reorder marks
  // changes, so the header Save (#cp-save-btn) stays on this level too.
}

function clientBox(client, ci) {
  const box = el('button', { class: 'drill-item drill-reorder', type: 'button', 'data-cid': client.id }, [
    el('span', {}, client.name || t('calc.unnamedClient')),
    el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
  ]);
  box.addEventListener('click', () => {
    const idx = clients().findIndex(c => c.id === client.id);
    if (idx === -1) return;
    freshlyAdded = false;
    activeClient = idx;
    renderEditor();
  });
  return box;
}

function syncClientOrderFromDom() {
  const ids = [...document.querySelectorAll('#cp-content .drill-reorder')].map(n => n.dataset.cid);
  const cs = clients();
  const before = cs.map(c => c.id).join('|');
  cs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  if (cs.map(c => c.id).join('|') !== before) markDirty();
}

// ── Clients Level 1: a client's detail (name + ordered-product cards) ──────────
function renderClientDetail(ci) {
  const client = clients()[ci];
  if (!Array.isArray(client.products)) client.products = [];
  cpTitle().textContent = t('calc.editClient');
  setHomeVisible(false);
  const content = document.getElementById('cp-content');
  // The list's Sortable is bound to a node about to be thrown away; destroying it
  // here (not only when the list is redrawn) frees its document-level listeners
  // while the detail is open instead of keeping a dead list alive.
  if (clientSortable) { clientSortable.destroy(); clientSortable = null; }
  content.textContent = '';

  const nameInput = el('input', { class: 'cp-client-name', type: 'text', value: client.name || '', placeholder: t('calc.clientName') });
  if (showErrors && isBlank(client.name)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => { client.name = nameInput.value; nameInput.classList.remove('cp-invalid'); markDirty(); });
  const del = deleteIcon(t('calc.deleteClient'), async () => {
    if (!(await confirmDialog({ message: t('calc.deleteThisClientAnd'), okLabel: t('ui.delete'), danger: true, cancelLabel: t('ui.cancel') }))) return;
    clients().splice(ci, 1);
    markDirty();
    activeClient = null;
    renderEditor();
  });
  content.appendChild(el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, t('calc.clientName')),
    el('div', { class: 'cp-name-row' }, [nameInput, del]),
  ]));

  // The products this client orders, each described in full right here.
  const field = el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, t('calc.productsOrdered'))]);
  client.products.forEach((p, pi) => field.appendChild(productCard(client, p, pi)));
  const addProd = el('button', { class: 'cp-add-prod', type: 'button' }, t('calc.addProduct'));
  addProd.addEventListener('click', () => {
    const recipes = getRecipes(working);
    client.products.push({
      id: genId('p'), name: '', recipeId: recipes[0] ? recipes[0].id : '',
      weight: 100, kind: 'number', crate: { show: false, perBox: 20 },
    });
    markDirty();
    renderEditor();
  });
  field.appendChild(addProd);
  content.appendChild(field);

  content.appendChild(orderingLinkField(client));
}

// ── The client's own ordering link ────────────────────────────────────────────
// One link per client. They open it and type their order straight into the app, so
// nobody copies numbers out of a WhatsApp message any more.
//
// ⚠️ EVERY BUTTON HERE ACTS ON THE DATABASE IMMEDIATELY, unlike the rest of this
// editor, which works on a copy and touches nothing until Save. That is not an
// inconsistency to tidy away: a link is an account and a permission, not a field, and
// there is no honest way to "un-save" one by tapping Back. It is why the whole
// section refuses to do anything while there are unsaved changes — the link publishes
// the products AS SAVED, so minting one from an edited-but-unsaved client would send
// a customer a list of things the bakery has not agreed to yet.
const orderingAccounts = new Map(); // clientId -> { uid, linkToken }

async function loadOrderingAccounts() {
  orderingAccounts.clear();
  // Only those who can manage the Calculator may read the links (firestore.rules,
  // client-accounts): asking for anybody else would only collect a refusal.
  if (currentSession().canManage !== true || !worksOnClients(currentSession().role)) return;
  try {
    for (const account of await listOrderingAccounts()) {
      if (account && account.clientId) orderingAccounts.set(account.clientId, account);
    }
  } catch (err) {
    // Offline, or a location that has never used this. The section simply offers to
    // create a link; it must never block the Clients editor.
    console.warn('Could not read the ordering links:', err);
  }
}

// ⚠️ THE VENUE'S OWN NAME, NEVER THE PRODUCT'S. This sentence is sent to a
// CUSTOMER'S customer — a wholesale client of whoever is using the app — so a
// hardcoded name here tells that client they are ordering from somebody else's
// bakery. It was "The Italian Club" for everybody, which was fine while there was
// exactly one venue and is a defect the moment there are two.
function shareText(client, link) {
  const from = currentSession().name || t('calc.us');
  return t('calc.shareText', { client: client.name, from, link });
}

// ⚠️ THE CLIPBOARD IS RACED AGAINST A CLOCK, AND THIS IS NOT BELT-AND-BRACES.
// navigator.clipboard.writeText() can sit there and never settle — the page losing
// focus at the wrong moment is enough — and it was the ONLY thing standing between
// creating a link and being shown it. Observed while driving the app: the link was
// made, the account and the grant reached the database, and the owner was told
// nothing at all. A promise with no timeout is a feature that works until it hangs.
//
// Whatever happens, this function ends with the link on screen: copied if the
// clipboard took it, spelled out if it did not.
// ⚠️ THE FOURTH COPY OF THE RACE IS GONE. js/share.js was extracted to stop this
// very duplication and this file was named in its header as one of the copies; it now
// calls it. The dialog afterwards is this screen's own — what changes is only who
// holds the two-second clock.

async function copyLink(client, link) {
  const copied = await copyToClipboard(link);
  await alertDialog(copied
    ? t('calc.linkCopiedFor', { client: client.name })
    : t('calc.copyThisLinkFor', { client: client.name, link }));
}

function orderingLinkField(client) {
  const field = el('div', { class: 'cp-field' }, [
    el('label', { class: 'cp-label' }, t('calc.orderingLink')),
  ]);

  if (dirty) {
    field.appendChild(el('p', { class: 'cp-hint' },
      t('calc.saveYourChangesFirst')));
    return field;
  }

  // ⚠️ canManage, not isOwner: firestore.rules gates the client-ordering account
  // on canManage(lid, 'calculator'), so a manager really can mint and revoke one.
  // Asking isOwner here would draw the sentence for a button the database would
  // have allowed — a screen that refuses what the rules permit is its own bug.
  //
  // ⚠️ AND NOBODY ELSE SEES THE LINK AT ALL (audit, 25 Oct 2026). Its secret is the
  // ordering account's password, so the rules let only those who mint and revoke links
  // read them: «Copy» and «Send» used to hand it to every employee, who kept a way to
  // order as that client after leaving. An employee cannot even learn which clients
  // have one, so the sentence names who looks after it and promises neither answer.
  const canManage = currentSession().canManage === true;
  if (!canManage) {
    field.appendChild(el('p', { class: 'cp-hint' }, t('calc.orderingLinkManagersOnly')));
    return field;
  }

  const account = orderingAccounts.get(client.id);
  const link = account && account.linkToken ? orderingLinkFor(account.linkToken) : '';

  // The sentence has to follow what this person can actually do, or it promises
  // a button that is not there and reads as a broken screen.
  field.appendChild(el('p', { class: 'cp-hint' }, account
    ? t('calc.clientCanSendOrders', { client: client.name })
    : t('calc.createALinkAnd')));

  if (account && link) {
    const copy = el('button', { class: 'cp-add-prod', type: 'button' }, t('calc.copyLink'));
    copy.addEventListener('click', () => copyLink(client, link));
    field.appendChild(copy);

    // ⚠️ ONE ARROW, AND THE CHOICE BEHIND IT. This was an <a> straight to wa.me with
    // no recipient — so the destination was already «whoever you pick» — and Federico
    // asked on 24 Aug 2026 for the same send arrow, and the same question, everywhere.
    // A <button> rather than a link, because it no longer HAS a href to follow.
    const share = el('button', { class: 'cp-add-prod cp-link-share', type: 'button' },
      [svgElement(SEND_PATHS, 18), el('span', {}, t('ui.send'))]);
    share.addEventListener('click', () => chooseHowToSend({
      subject: client.name, text: shareText(client, link),
    }));
    field.appendChild(share);
  }

  const make = el('button', { class: 'cp-add-prod', type: 'button' },
    account ? t('calc.replaceWithANew') : t('calc.createOrderingLink'));
  make.addEventListener('click', async () => {
    // ⚠️ REPLACING IS THE DESTRUCTIVE ONE, and it is the tap most likely to be made
    // by mistake — somebody looking for "send it again" finds this first. The old
    // link stops working the moment it is replaced, so it is spelled out.
    if (account && !(await confirmDialog({
      title: t('calc.replaceThisLink'),
      message: t('calc.replaceLinkWarning', { client: client.name }),
      okLabel: t('ui.replace'),
      cancelLabel: t('ui.cancel'),
      danger: true,
    }))) return;

    make.disabled = true;
    try {
      const created = await createOrderingLink(client, { replacing: account ? account.uid : null });
      orderingAccounts.set(client.id, { uid: created.uid, clientId: client.id, linkToken: created.token });
      renderEditor();
      await copyLink(client, created.link);
    } catch (err) {
      console.error('Could not create the ordering link:', err);
      await alertDialog(t('calc.couldNotCreateThe'));
      make.disabled = false;
    }
  });
  field.appendChild(make);

  if (account) {
    const revoke = el('button', { class: 'cp-link-revoke', type: 'button' }, t('calc.turnOffOrdering'));
    revoke.addEventListener('click', async () => {
      if (!(await confirmDialog({
        message: t('calc.stopClientOrdering', { client: client.name }),
        okLabel: t('calc.turnOff'),
        cancelLabel: t('ui.cancel'),
        danger: true,
      }))) return;
      try {
        await revokeOrderingLink(account.uid);
        orderingAccounts.delete(client.id);
        renderEditor();
      } catch (err) {
        console.error('Could not revoke the ordering link:', err);
        await alertDialog(t('calc.couldNotTurnIt'));
      }
    });
    field.appendChild(revoke);
  }

  return field;
}

// One product of this client, described in full: name, the recipe it belongs to, its
// unit weight, how the quantity is typed, and the optional crate box. Everything a
// product is lives here — there is no separate catalogue screen to visit first.
//
// The four editable fields are laid out as a GRID — a label column, a field column and
// a narrow unit column — so every label starts on one line and every field starts and
// ends on another. ⚠️ It uses its own `cp-field-row` class rather than the shared
// `cp-prod-card-row`: the recipe editor uses that one for two-cell rows, and a
// three-column grid would put its grams field in the label column.
function fieldRow(labelText, control, suffix) {
  return el('div', { class: 'cp-field-row' }, [
    el('span', { class: 'cp-field-label' }, labelText),
    control,
    // Always present, even when empty, so the field column ends on the same x on
    // every row whether or not that row has a unit.
    el('span', { class: 'cp-field-suffix' }, suffix || ''),
  ]);
}

function productCard(client, product, pi) {
  const paused = product.active === false;
  const rows = [];

  // Name.
  const nameInput = el('input', { class: 'cp-prod-name', type: 'text', value: product.name || '', placeholder: t('calc.productName') });
  if (showErrors && isBlank(product.name)) nameInput.classList.add('cp-invalid');
  nameInput.addEventListener('input', () => {
    product.name = nameInput.value;
    nameInput.classList.remove('cp-invalid');
    markDirty();
  });
  rows.push(fieldRow(t('calc.field.name'), nameInput));

  // Recipe. A product whose recipe was deleted is re-homed onto the first one, so the
  // select always shows something real rather than an empty box.
  const recipes = getRecipes(working);
  const recipeSel = el('select', { class: 'cp-prod-dough', 'aria-label': t('aria.recipe') });
  for (const r of recipes) recipeSel.appendChild(el('option', { value: r.id }, r.name));
  const known = recipes.some(r => r.id === product.recipeId);
  if (!known && recipes[0]) product.recipeId = recipes[0].id;
  recipeSel.value = product.recipeId;
  recipeSel.addEventListener('change', () => { product.recipeId = recipeSel.value; markDirty(); });
  rows.push(fieldRow(t('ui.recipe'), recipeSel));

  // Weight.
  const weight = el('input', {
    class: 'cp-prod-weight', type: 'number', min: String(WEIGHT_MIN), max: String(WEIGHT_MAX),
    step: '1', value: String(product.weight), inputmode: 'numeric', 'aria-label': t('calc.weightInGrams'),
  });
  weight.addEventListener('input', () => { product.weight = +weight.value || 0; markDirty(); });
  rows.push(fieldRow(t('calc.field.weight'), weight, 'g'));

  if (product.kind === 'kg') {
    // Legacy kg product: quantity entered in kilograms; no type/crate options.
    rows.push(fieldRow(t('calc.field.type'), el('span', { class: 'cp-kg-note' }, 'kg')));
  } else {
    const type = el('select', { class: 'cp-prod-dough', 'aria-label': t('calc.quantityType') });
    for (const k of ['number', 'dropdown']) type.appendChild(el('option', { value: k }, typeLabel(k)));
    type.value = product.kind === 'dropdown' ? 'dropdown' : 'number';
    type.addEventListener('change', () => { product.kind = type.value; markDirty(); });
    rows.push(fieldRow(t('calc.field.type'), type));

    if (!product.crate || typeof product.crate !== 'object') product.crate = { show: false, perBox: 20 };
    const crateToggle = el('input', { type: 'checkbox' });
    crateToggle.checked = !!product.crate.show;
    // Re-render on toggle: the pieces field APPEARS only once the box is ticked, rather
    // than sitting there greyed out.
    crateToggle.addEventListener('change', () => {
      product.crate.show = crateToggle.checked;
      markDirty();
      renderEditor();
    });
    const crateRow = [el('label', { class: 'cp-crate-label' }, [crateToggle, el('span', {}, t('calc.crateBox'))])];
    if (product.crate.show) {
      const perBoxInput = el('input', {
        class: 'cp-prod-weight', type: 'number', min: '1', max: '1000', step: '1',
        value: String(product.crate.perBox || 20), inputmode: 'numeric', 'aria-label': t('calc.piecesPerCrate'),
      });
      perBoxInput.addEventListener('input', () => { product.crate.perBox = +perBoxInput.value || 0; markDirty(); });
      crateRow.push(perBoxInput, el('span', { class: 'cp-field-suffix' }, 'pz'));
    }
    rows.push(el('div', { class: 'cp-check-row' }, crateRow));
  }

  // Pause instead of delete: the product stays here with its recipe, weight, type and
  // crate, but leaves the calculator until it is switched back on.
  const activeToggle = el('input', { type: 'checkbox' });
  activeToggle.checked = !paused;
  activeToggle.addEventListener('change', () => {
    product.active = activeToggle.checked;
    markDirty();
    renderEditor();
  });
  rows.push(el('div', { class: 'cp-check-row' }, [
    el('label', { class: 'cp-crate-label' }, [activeToggle, el('span', {}, t('ui.active'))]),
  ]));

  // Delete sits alone at the bottom right, away from everything that edits — a small
  // icon that never competes with Save (P20).
  const foot = [];
  if (paused) foot.push(el('span', { class: 'cp-paused-tag' }, t('ui.paused')));
  foot.push(deleteIcon(t('calc.removeProduct'), () => {
    client.products.splice(pi, 1);
    markDirty();
    renderEditor();
  }));
  rows.push(el('div', { class: 'cp-prod-card-foot' }, foot));

  return el('div', { class: 'cp-prod-card' + (paused ? ' cp-prod-card-paused' : '') }, rows);
}

// ── Static wiring (elements exist in calculator.html and clients.html) ────────
document.querySelector('.cp-back-btn').addEventListener('click', closeClients);
document.getElementById('cp-save-btn').addEventListener('click', saveClients);
document.getElementById('cp-home-btn').addEventListener('click', goHomeFromClients);
