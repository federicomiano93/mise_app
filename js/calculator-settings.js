// calculator-settings.js — the Calculator's Settings hub.
//
// The footer "Settings" button opens a small chooser (#settings-overlay) whose entries
// each open their own overlay: Clients (the editor lives in clients-editor.js, shared with
// the sales owner's Clients page), WhatsApp (calculator-whatsapp-settings.js), Recipes
// (recipes.js), Extra dough and Divisor. This file keeps the hub, the two venue-wide
// switches, Extra dough and Divisor.
//
// Extra dough and Divisor work on a deep copy of the live config and touch nothing until
// the user taps Save (with a confirm), which persists through the config store (Firestore
// + cache) and triggers a calculator re-render (P20).

import { t } from './i18n.js';
import { getConfig, saveConfigOrSay, canSyncConfig } from './calculator-config-store.js';
import {
  cloneConfig, isExtraDoughEnabled, getTabProducts, isInDivisor,
  getRecipes, getRecipeById, showsClientOrdersButton, asksDoughDay,
} from './calculator-config.js';
import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';
import { openRecipes } from './recipes.js';
import { openWhatsapp } from './calculator-whatsapp-settings.js';
import { openClients } from './clients-editor.js';
import { confirmDiscard } from './calculator-confirm.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { createSaveGuard } from './save-guard.js';
import { currentSession } from './firebase.js';
import { worksOnClients } from './roles.js';

// One guard per header Save: while a write is in flight the button is disabled, a second
// tap does nothing and Back / Home are ignored until it settles (js/save-guard.js).
// The idle state of Extra and Divisor is «disabled until something changed».
const extraSaveGuard = createSaveGuard(() => document.getElementById('extra-save-btn'), () => !extraDirty);
const divisorSaveGuard = createSaveGuard(() => document.getElementById('divisor-save-btn'), () => !divisorDirty);

// A recipe's display name (falls back to its id if the recipe was deleted).
function recipeLabel(id) { const r = getRecipeById(getConfig(), id); return r ? r.name : id; }

function show(id) { document.getElementById(id).classList.add('visible'); }
function hide(id) { document.getElementById(id).classList.remove('visible'); }

// ── Hub ───────────────────────────────────────────────────────────────────────
// ⚠️ THE KITCHEN'S OWNER HAS NO CLIENTS TO RUN (js/roles.js worksOnClients, the same list as
// firestore.rules): the three doors below are not drawn for them. `hidden` wins over the
// .set-row display rule because tokens.css ends in `[hidden] { display: none !important }`.
// The switches under them stay, they are the venue's own. Read when the overlay opens, the
// session is there by then.
const CLIENT_DOORS = ['open-clients-btn', 'open-whatsapp-btn', 'open-clientorders-btn'];
function paintClientDoors() {
  const shown = worksOnClients(currentSession().role);
  for (const id of CLIENT_DOORS) {
    const door = document.getElementById(id);
    if (door) door.hidden = !shown;
  }
}

export function openSettings() {
  paintClientDoors();
  paintOrdersButtonSwitch();
  paintAskDaySwitch();
  show('settings-overlay');
  globalThis.window?.dispatchEvent(new CustomEvent('mise:screen', { detail: 'settings' }));
}
function closeSettings() { hide('settings-overlay'); globalThis.window?.dispatchEvent(new CustomEvent('mise:screen', { detail: '' })); }

// ── The bottom-bar «Orders» button switch ─────────────────────────────────────
// VENUE-WIDE (config/calculator.showClientOrdersButton), and a switch: it saves on the
// tap with «Saved ✓» like every settings switch, not through a Save + confirm form.
// The banner that announces a new client order is NOT governed by it. app.js hides or
// shows the button itself on every config change, so the tap only has to save.
function paintOrdersButtonSwitch() {
  const cb = document.getElementById('orders-button-switch');
  if (cb) cb.checked = showsClientOrdersButton(getConfig());
}

let ordersSavedTimer = null;
function flashOrdersButtonSaved() {
  const tag = document.getElementById('orders-button-saved');
  if (!tag) return;
  tag.hidden = false;
  clearTimeout(ordersSavedTimer);
  ordersSavedTimer = setTimeout(() => { tag.hidden = true; }, 2000);
}

async function onOrdersButtonSwitch() {
  const cb = document.getElementById('orders-button-switch');
  const cfg = cloneConfig(getConfig());
  const wanted = cb.checked;
  cfg.showClientOrdersButton = wanted;
  // A refused write puts the switch back where it was (the app already went back to the
  // server's copy) and says why — no «Saved ✓». 'no-server-answer' explains itself inside
  // saveConfig and is not a confirmation either, hence canSyncConfig().
  const saved = await saveConfigOrSay(cfg, { onFail: () => { cb.checked = !wanted; } });
  if (saved && canSyncConfig()) flashOrdersButtonSaved();
}

const ordersButtonSwitch = document.getElementById('orders-button-switch');
if (ordersButtonSwitch) ordersButtonSwitch.addEventListener('change', onOrdersButtonSwitch);

// ── «Ask which day the dough is for» ──────────────────────────────────────────
// Venue-wide (config/calculator.askDoughDay), saved on the tap exactly like the Orders
// button switch above and sharing its «Saved ✓» tag (same section). Off = Confirm saves
// for today at once (js/confirm-flow.js). A refused write puts the switch back.
function paintAskDaySwitch() {
  const cb = document.getElementById('ask-day-switch');
  if (cb) cb.checked = asksDoughDay(getConfig());
}

async function onAskDaySwitch() {
  const cb = document.getElementById('ask-day-switch');
  const cfg = cloneConfig(getConfig());
  const wanted = cb.checked;
  cfg.askDoughDay = wanted;
  const saved = await saveConfigOrSay(cfg, { onFail: () => { cb.checked = !wanted; } });
  if (saved && canSyncConfig()) flashOrdersButtonSaved();
}

const askDaySwitch = document.getElementById('ask-day-switch');
if (askDaySwitch) askDaySwitch.addEventListener('change', onAskDaySwitch);

// ── Extra-dough visibility (separate Settings screen) ─────────────────────────
let extraWorking = null;
let extraDirty = false;

function updateExtraSaveBtn() {
  const btn = document.getElementById('extra-save-btn');
  if (!btn) return;
  btn.disabled = extraSaveGuard.saving || !extraDirty;
  btn.classList.toggle('dirty', extraDirty);
}

function openExtra() {
  extraWorking = cloneConfig(getConfig());
  extraDirty = false;
  // One toggle per recipe, generated (recipes are dynamic).
  const list = document.getElementById('extra-content-list');
  if (list) {
    list.textContent = '';
    for (const recipe of getRecipes(extraWorking)) {
      // A real on/off switch (tokens.css .set-switch, 28 Sep 2026) — the same control
      // as every settings screen. Still a FORM: it edits the working copy, Save commits.
      const cb = el('input', { type: 'checkbox', role: 'switch', 'aria-label': recipe.name });
      cb.checked = isExtraDoughEnabled(extraWorking, recipe.id);
      cb.addEventListener('change', () => {
        if (!extraWorking.extraDough || typeof extraWorking.extraDough !== 'object') extraWorking.extraDough = {};
        extraWorking.extraDough[recipe.id] = cb.checked;
        extraDirty = true;
        updateExtraSaveBtn();
      });
      list.appendChild(el('div', { class: 'extra-toggle-row' }, [
        el('span', {}, recipe.name),
        el('label', { class: 'set-switch' }, [cb, el('span', { class: 'set-switch-track', 'aria-hidden': 'true' })]),
      ]));
    }
  }
  updateExtraSaveBtn();
  show('extra-overlay');
}
async function closeExtra() {
  if (extraSaveGuard.saving) return;
  if (!(await confirmDiscard(extraDirty))) return;
  hide('extra-overlay');
}

function saveExtra() { return extraSaveGuard.run(doSaveExtra); }

async function doSaveExtra() {
  if (!(await confirmDialog({ message: t('calc.saveTheseChanges'), okLabel: t('ui.save'), cancelLabel: t('ui.cancel') }))) return;
  try {
    if (!(await saveConfigOrSay(extraWorking))) return;
    extraDirty = false;
    updateExtraSaveBtn();
  } catch (e) {
    alertDialog(t('calc.couldNotSaveCheck'));
  }
}

document.getElementById('open-extra-btn').addEventListener('click', openExtra);
document.querySelector('.extra-back-btn').addEventListener('click', closeExtra);
document.getElementById('extra-save-btn').addEventListener('click', saveExtra);
document.getElementById('extra-home-btn').addEventListener('click', async () => {
  if (extraSaveGuard.saving) return;
  if (!(await confirmDiscard(extraDirty))) return;
  window.location.href = 'index.html';
});

// ── Divisor selection (separate Settings screen) ──────────────────────────────
let divisorTab = null;
let divisorWorking = null;
let divisorDirty = false;

function openDivisor() {
  divisorTab = null; divisorWorking = null; divisorDirty = false;
  renderDivisorSettings();
  show('divisor-overlay');
}
function closeDivisor() { hide('divisor-overlay'); }

async function backDivisor() {
  if (divisorSaveGuard.saving) return;
  if (divisorTab !== null) {
    if (!(await confirmDiscard(divisorDirty))) return;
    divisorTab = null; divisorWorking = null; divisorDirty = false;
    renderDivisorSettings();
    return;
  }
  closeDivisor();
}

function setDivisorTitle(text) {
  const t = document.querySelector('#divisor-overlay .recipe-overlay-title');
  if (t) t.textContent = text;
}
function setDivisorHomeVisible(visible) {
  const btn = document.getElementById('divisor-home-btn');
  if (btn) btn.hidden = !visible;
}

// The header Save exists only on the detail level (and only when it lists products).
function setDivisorSaveVisible(visible) {
  const btn = document.getElementById('divisor-save-btn');
  if (btn) btn.hidden = !visible;
}

function updateDivisorSaveBtn() {
  const btn = document.getElementById('divisor-save-btn');
  if (!btn) return;
  btn.disabled = divisorSaveGuard.saving || !divisorDirty;
  btn.classList.toggle('dirty', divisorDirty);
}

function renderDivisorSettings() {
  if (divisorTab === null) renderDivisorTabChooser();
  else renderDivisorTabDetail(divisorTab);
}

function renderDivisorTabChooser() {
  setDivisorTitle(t('ui.divisor'));
  setDivisorHomeVisible(true);
  setDivisorSaveVisible(false);
  const content = document.getElementById('divisor-content');
  content.textContent = '';
  content.appendChild(el('p', { class: 'extra-help' },
    t('calc.pickWhichProductsEach')));
  for (const recipe of getRecipes(getConfig())) {
    const box = el('button', { class: 'drill-item', type: 'button' }, [
      el('span', {}, recipe.name),
      el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
    ]);
    box.addEventListener('click', () => { divisorTab = recipe.id; renderDivisorSettings(); });
    content.appendChild(box);
  }
}

function renderDivisorTabDetail(tab) {
  setDivisorTitle(t('calc.divisorTitle', { recipe: recipeLabel(tab) }));
  setDivisorHomeVisible(false);
  if (divisorWorking === null) { divisorWorking = cloneConfig(getConfig()); divisorDirty = false; }
  const content = document.getElementById('divisor-content');
  content.textContent = '';
  // One checkbox per product of this recipe (by product id, not per client), so a
  // ticked product is split across every client that orders it. De-duplicate the
  // tab rows (which are per client) down to one row per product.
  const seen = new Set();
  const products = getTabProducts(getConfig(), tab).filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  if (products.length === 0) {
    content.appendChild(el('div', { class: 'cp-empty-hint' }, t('calc.noProductsInThis3')));
    setDivisorSaveVisible(false);
    return;
  }
  products.forEach(p => content.appendChild(divisorProductRow(tab, p)));
  const clearBtn = el('button', { class: 'divisor-clear-btn', type: 'button' }, t('calc.untickAll'));
  clearBtn.addEventListener('click', () => clearDivisorTab(tab));
  content.appendChild(clearBtn);
  setDivisorSaveVisible(true);
  updateDivisorSaveBtn();
}

function divisorProductRow(tab, product) {
  const box = el('input', { type: 'checkbox' });
  box.checked = isInDivisor(divisorWorking, tab, product.id);
  box.addEventListener('change', () => toggleDivisorProduct(tab, product.id, box.checked));
  return el('label', { class: 'cp-check-row' }, [box, el('span', {}, product.name)]);
}

function toggleDivisorProduct(tab, productId, included) {
  if (!divisorWorking.divisorIncluded || typeof divisorWorking.divisorIncluded !== 'object') divisorWorking.divisorIncluded = {};
  const list = Array.isArray(divisorWorking.divisorIncluded[tab]) ? divisorWorking.divisorIncluded[tab] : [];
  const i = list.indexOf(productId);
  if (included && i === -1) list.push(productId);
  else if (!included && i !== -1) list.splice(i, 1);
  divisorWorking.divisorIncluded[tab] = list;
  divisorDirty = true;
  updateDivisorSaveBtn();
}

function clearDivisorTab(tab) {
  if (!divisorWorking.divisorIncluded || typeof divisorWorking.divisorIncluded !== 'object') divisorWorking.divisorIncluded = {};
  divisorWorking.divisorIncluded[tab] = [];
  divisorDirty = true;
  renderDivisorSettings();
}

function saveDivisor() { return divisorSaveGuard.run(doSaveDivisor); }

async function doSaveDivisor() {
  if (!(await confirmDialog({ message: t('calc.saveTheseChanges'), okLabel: t('ui.save'), cancelLabel: t('ui.cancel') }))) return;
  try {
    if (!(await saveConfigOrSay(divisorWorking))) return;
    divisorWorking = cloneConfig(getConfig());
    divisorDirty = false;
    updateDivisorSaveBtn();
  } catch (e) {
    alertDialog(t('calc.couldNotSaveCheck'));
  }
}

document.getElementById('open-divisor-btn').addEventListener('click', openDivisor);
document.querySelector('.divisor-back-btn').addEventListener('click', backDivisor);
document.getElementById('divisor-save-btn').addEventListener('click', saveDivisor);
document.getElementById('divisor-home-btn').addEventListener('click', async () => {
  if (divisorSaveGuard.saving) return;
  if (!(await confirmDiscard(divisorDirty))) return;
  window.location.href = 'index.html';
});

// ── Static wiring (elements exist in calculator.html) ─────────────────────────
document.querySelector('.settings-back-btn').addEventListener('click', closeSettings);
document.getElementById('open-clients-btn').addEventListener('click', openClients);
document.getElementById('open-whatsapp-btn').addEventListener('click', openWhatsapp);
document.getElementById('open-recipes-btn').addEventListener('click', openRecipes);
