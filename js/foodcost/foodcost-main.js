// foodcost-main.js — entry point / orchestrator for the Food Cost page.
// Owns the view routing (list ↔ product ↔ history), the header, the shared
// confirm dialog and toast, and the live subscriptions.
//
// Feature-local only: it reads the catalogue's recipes and Orders' ingredients as
// Firestore COLLECTIONS, through its own data layer, and writes nothing of theirs but
// a recipe's oven loss. js/foodcost/ imports no screen and no data layer from
// js/catalogue/ or js/orders/ — only pure models: price-model.js in js/ root, and the
// catalogue's recipe-cost-model.js and catalogue-model.js, because a copy of a
// CALCULATION is worse than a crossing.

import { t, localeTag, onLanguageChange } from '../i18n.js';
import {
  initFoodCost, getProducts, tables, saveProduct, deleteProduct, setSyncErrorHandler,
  getRecipes, getIngredients, hasLiveProducts, hasLiveRecipes, getLabourCostPerHour, saveLabourRate,
} from './foodcost-store.js';
import { openFoodcostSettings } from './foodcost-settings.js';
import { renderList } from './foodcost-list.js';
import { renderEditor } from './foodcost-editor.js';
import { getProductHistory, canWriteRecipes, venueCountry, authReady, canManageHere } from './firebase-foodcost.js';
import { confirmDialog } from './confirm-dialog.js';
import { el } from './dom.js';
import { productsUsingRecipe, draftFromRecipe } from './foodcost-model.js';
import { formatRate, formatMoney, pricePerKg } from '../price-model.js';
// Food or packaging? From js/ root, where the registry that files it asks the same question.
import { isPackaging } from '../ingredient-kind.js';
// The address a recipe's «Apri nel Food cost» opens this page with, and the way back to
// that recipe. From js/ root: the catalogue and Food cost share an address, never a folder.
import { recipeIdFromHash, recipeHref } from '../recipe-link.js';
import { isTabletNow, watchTablet } from './tablet.js';
import { crossingRoute } from './crossing-route.js';

// The arrow the empty right-hand pane draws (the same one the other panes use).
const POINTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/><path d="M21 12H9"/></svg>';

const screen = document.getElementById('fcScreen');
const splitEl = document.getElementById('fcSplit');
const listCol = document.getElementById('fcListCol');
const titleEl = document.getElementById('fcTitle');
const subEl = document.getElementById('fcSub');
const homeBtn = document.getElementById('fcHome');
const backBtn = document.getElementById('fcBack');
// The round «+» in the header's right slot: the one way to add a product, list only.
const addBtn = document.getElementById('fcAdd');
addBtn.addEventListener('click', () => requestOpen(null));
// The bottom bar and its one button, Settings (13 Sep 2026). The button carries its own
// permission; the bar is shown only while a button in it is.
const footerBar = document.getElementById('fcFooter');
const settingsBtn = document.getElementById('fcSettings');

let view = 'list';          // 'list' | 'editor' | 'history' | 'loading'
let activeList = null;
let activeEditor = null;
let currentProduct = null;
let leaveGuard = null;
// ⚠️ THE TABLET SPLIT (29 Sep 2026): list on the left, a product (or its history) on the
// right. Declared here, above the first onLanguageChange below, or it is a TDZ crash when
// the language answers at once.
let splitOn = false;        // is the two-column layout showing right now?
let paneEmpty = null;       // the placeholder node kept for the right-hand pane
// The editor set aside while its margin history is shown in the pane: ITS NODE, alive, with
// the working copy and the guard it registered. Back puts the same node back.
let heldEditor = null;
// The margin history's own node, kept so a rotation MOVES it (no second fetch) instead of
// drawing it again.
let historyBody = null;
let guardPending = false;   // a «discard changes?» question is already open
// True while a move across the width runs: nothing may take the focus.
let quietFocus = false;

// ── Opened from a recipe ─────────────────────────────────────────────────────
//
// Federico, 13 Sep 2026: a button on a recipe opens «its» Food cost product. The recipe
// arrives as #recipe=<id>, and THIS page decides, because only it reads the products:
//   one product uses it  → that product;
//   several use it       → the list, narrowed to them;
//   none does            → a NEW product with the recipe on its first line, unsaved.
// ⚠️ BACK FROM THAT FIRST SCREEN RETURNS TO THE RECIPE — one level up, where the tap
// came from — never to a full list the person did not ask for.
let fromRecipe = recipeIdFromHash(window.location.hash);
let listFilter = null;       // a recipe id while the list is narrowed to its products
let entryEditor = false;     // true while the product on screen is the one the recipe opened
let draftRecipeId = null;    // the recipe a NEW product came from, while it may still give way
let recipeLinkSettled = false;
let recipeLinkDeadlinePassed = false;
const RECIPE_LINK_WAIT_MS = 1200;

function setHeader({ title, sub, back, add = false }) {
  titleEl.textContent = title;
  subEl.textContent = sub;
  homeBtn.hidden = back;
  backBtn.hidden = !back;
  addBtn.hidden = !add;
  paintFooter();
}

// The bottom bar. ⚠️ THE BUTTON CARRIES THE PERMISSION AND THE BAR CARRIES NONE (the
// v1.62.0 rule): Settings holds the hourly labour cost, a wage figure, so it is for whoever
// runs the place; the bar is drawn only while a button in it is — and only on the list, so
// it never sits under a product somebody is editing.
function paintFooter() {
  settingsBtn.hidden = !canManageHere();
  // On a tablet the list is on screen beside a product too, so its bar stays.
  footerBar.hidden = !(view === 'list' || splitOn) || settingsBtn.hidden;
}

function swap(node) {
  screen.replaceChildren(node);
  screen.scrollTop = 0;
  node.setAttribute('tabindex', '-1');
  if (quietFocus) return;
  try { node.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
}

// The products the list shows: all of them, or only those using the recipe it was
// narrowed to.
function listedProducts() {
  return listFilter ? productsUsingRecipe(getProducts(), listFilter) : getProducts();
}

// ── The tablet split ────────────────────────────────────────────────────────────

// Turn the two-column layout on or off. #fcScreen is the right-hand pane only while it is
// on (the class is what tokens.css styles); off, it is the whole screen again.
function setSplit(on) {
  splitOn = on;
  splitEl.dataset.split = on ? 'on' : 'off';
  listCol.hidden = !on;
  screen.classList.toggle('app-split-pane', on);
}

// ⚠️ THE WAIT CALLS THIS: it is not the list, a product or its history. The list column is
// emptied, not just hidden, so a screen that comes back builds a fresh one.
function leaveSplit() {
  if (!splitOn) return;
  setSplit(false);
  listCol.replaceChildren();
  paneEmpty = null;
  activeList = null;
}

// The list's own header: it stays while a product is open beside it. Back (to the recipe)
// where the list has it — narrowed to a recipe, or the product the recipe opened — else Home.
function setListChrome() {
  setHeader({
    title: t('fc.foodCost'), sub: t('fc.productsAndMargins'),
    back: !!listFilter || (!!fromRecipe && entryEditor), add: true,
  });
}

function buildList(selectedId) {
  return renderList({
    products: listedProducts(), tables: tables(), onOpen: requestOpen, onAdd: () => requestOpen(null),
    selectedId,
    filter: listFilter ? {
      title: filterTitle(listFilter),
      // Everything, and the page stops being «the recipe's»: Back becomes Home again.
      onShowAll: requestShowAll,
    } : null,
  });
}

// The list into the left column (tablet). ⚠️ NOT re-run when a product is opened while the
// list is already there: that keeps its scroll and its focus; only the open row is re-marked.
function paintListColumn(selectedId) {
  activeList = buildList(selectedId);
  listCol.replaceChildren(activeList.root);
  activeList.root.setAttribute('tabindex', '-1');
}

// What the pane says while nothing is open. ONE node, its words asked here at paint time
// and again on onLanguageChange: the venue's language arrives AFTER the first paint.
function showPaneEmpty() {
  if (!paneEmpty) {
    paneEmpty = el('div', { class: 'app-split-empty' }, [
      el('span', { class: 'app-split-empty-icon', 'aria-hidden': 'true', icon: POINTER_SVG }),
      el('h2', {}),
      el('p', {}),
    ]);
  }
  paneEmpty.querySelector('h2').textContent = t('fc.split.empty.title');
  paneEmpty.querySelector('p').textContent = t('fc.split.empty.text');
  syncPaneEmpty();
  screen.replaceChildren(paneEmpty);
}

// ⚠️ NO “Tap a product on the left” BESIDE «No products yet»: with nothing to tap the
// placeholder is hidden, and comes back when the first product arrives.
function syncPaneEmpty() {
  if (paneEmpty) paneEmpty.hidden = listedProducts().length === 0;
}

// The light head of the pane (tokens.css .app-split-pane .app-header): the product's name
// centred; a Back ONLY while the pane shows the margin history, returning to the product.
function buildPaneHead() {
  const inHistory = view === 'history';
  const title = inHistory
    ? t('fc.marginHistory')
    : (currentProduct ? (currentProduct.name || t('fc.productWord')) : t('fc.newProduct'));
  return el('header', { class: 'app-header' }, [
    el('span', { class: 'app-header-slot' }, [
      inHistory ? el('button', {
        class: 'app-icon-btn', type: 'button', 'aria-label': t('ui.back'),
        icon: backBtn.innerHTML, onclick: backToProduct,
      }) : null,
    ]),
    el('div', { class: 'app-header-title' }, [el('h1', { text: title, tabindex: '-1' })]),
    el('span', { class: 'app-header-slot' }),
  ]);
}

// A node into the pane (tablet) or the whole screen (phone). Focus goes to the pane head.
function showNode(node) {
  if (!splitOn) { swap(node); return; }
  const head = buildPaneHead();
  screen.replaceChildren(head, el('div', { class: 'fc-pane-body' }, [node]));
  if (quietFocus) return;
  try { head.querySelector('h1').focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
}

// ⚠️ P20 — UNSAVED EDITS ARE NEVER LOST SILENTLY. Every way of replacing or leaving the
// open editor asks the guard the editor itself registered, and does nothing when the answer
// is no. One question at a time.
async function askLeave() {
  if (!leaveGuard) return true;
  if (guardPending) return false;
  guardPending = true;
  try { return await leaveGuard(); } finally { guardPending = false; }
}

// A row of the list, or a «+»: open that product (null = a new one) — after the guard.
// Tapping the product that is already open does nothing.
async function requestOpen(product) {
  if (splitOn && (view === 'editor' || view === 'history') && product && currentProduct
    && currentProduct.id === product.id) return;
  if (!(await askLeave())) return;
  // Another product than the one the recipe opened: the page is no longer «the recipe's».
  if (splitOn) entryEditor = false;
  openProduct(product);
}

// «Show all» on the narrowed list.
async function requestShowAll() {
  if (!(await askLeave())) return;
  listFilter = null;
  fromRecipe = null;
  showList();
}

function showList() {
  view = 'list';
  activeEditor = null;
  currentProduct = null;
  leaveGuard = null;
  heldEditor = null;
  historyBody = null;
  entryEditor = false;
  draftRecipeId = null;
  // ⚠️ Narrowed, the list has Back (to the recipe) where it otherwise has Home.
  setListChrome();
  if (isTabletNow()) {
    setSplit(true);
    paintListColumn(null);
    showPaneEmpty();
    if (!quietFocus) { try { activeList.root.focus({ preventScroll: true }); } catch (e) { /* best-effort */ } }
    return;
  }
  leaveSplit();
  activeList = buildList(null);
  swap(activeList.root);
}

function filterTitle(recipeId) {
  const recipe = getRecipes()[recipeId];
  const name = recipe ? String(recipe.name || '').trim() : '';
  return name ? t('fc.productsWithRecipe', { name }) : t('fc.productsWithThisRecipe');
}

// The editor's header on a PHONE: its own title and a Back.
function setEditorHeaderPhone(product) {
  setHeader({ title: product ? (product.name || t('fc.productWord')) : t('fc.newProduct'), sub: t('fc.foodCost'), back: true });
}

function openProduct(product, draft = null) {
  view = 'editor';
  draftRecipeId = null;
  currentProduct = product;
  leaveGuard = null;
  heldEditor = null;
  historyBody = null;
  if (isTabletNow()) {
    // The list stays ALIVE in its column (not redrawn: its scroll and focus stay), the page
    // header stays the list's, and the editor opens in the pane.
    const listAlive = splitOn && activeList;
    setSplit(true);
    setListChrome();
    const key = product ? product.id : null;
    if (listAlive) activeList.select(key);
    else paintListColumn(key);
    activeEditor = renderEditor({ product, draft, app });
    showNode(activeEditor.root);
    return;
  }
  leaveSplit();
  activeList = null;
  setEditorHeaderPhone(product);
  activeEditor = renderEditor({ product, draft, app });
  swap(activeEditor.root);
}

// Back from the history in the pane (or on a phone that crossed the width with the editor
// set aside): the SAME editor node returns, working copy and guard intact.
function backToProduct() {
  if (!heldEditor) { openProduct(currentProduct); return; }
  view = 'editor';
  activeEditor = heldEditor;
  heldEditor = null;
  historyBody = null;
  if (!splitOn) setEditorHeaderPhone(currentProduct);
  showNode(activeEditor.root);
}

// The short wait while a recipe's link is being decided. It has Back, and Back goes to
// the recipe — somebody who changes their mind must not be stuck behind a spinner.
function showWaiting() {
  view = 'loading';
  leaveSplit();
  activeList = null;
  activeEditor = null;
  currentProduct = null;
  leaveGuard = null;
  setHeader({ title: t('fc.foodCost'), sub: t('fc.productsAndMargins'), back: true });
  swap(el('div', { class: 'fc-view' }, [el('p', { class: 'fc-empty', text: t('fc.loading') })]));
}

// ⚠️⚠️ DECIDED ONCE, AND NEVER ON A LIST THAT HAS NOT ARRIVED. On a phone that has never
// opened this page the local copy is empty, and deciding on it would say «no product
// uses this recipe» and offer a new one while the real product is still on its way. So
// it waits for the products — and for the recipes, whose name a new product takes — up
// to a short deadline counted from when the VENUE is open (before that nothing can
// arrive at all), then decides with what it has: offline, the local copy is all there
// will ever be, and a screen that waits for a server is a screen that never answers.
function settleRecipeLink() {
  if (!fromRecipe || recipeLinkSettled) return;
  const ready = hasLiveProducts() && (hasLiveRecipes() || !!getRecipes()[fromRecipe]);
  if (!ready && !recipeLinkDeadlinePassed) return;
  recipeLinkSettled = true;
  clearAddress();

  const id = fromRecipe;
  const using = productsUsingRecipe(getProducts(), id);
  if (using.length === 1) { openProduct(using[0]); entryEditor = true; refreshChrome(); return; }
  if (using.length > 1) { listFilter = id; showList(); return; }
  const draft = draftFromRecipe(getRecipes()[id]);
  if (draft) { openProduct(null, draft); entryEditor = true; draftRecipeId = id; refreshChrome(); return; }
  // A recipe nobody can find — deleted, or still not here at the deadline: the plain
  // list, whose Back is Home. There is no recipe to pretend to return to.
  fromRecipe = null;
  showList();
}

// ⚠️⚠️ A NEW PRODUCT OPENED ON A LIST THAT HAD NOT ARRIVED CHANGES ITS MIND. Found by the
// code review: on a slow first open the deadline can pass before the products do, or the
// phone's copy can predate a product made on another phone — and the page would offer a
// new product for a recipe that already has one. Saved, that is a DUPLICATE with a margin
// history of its own. So while that new product is exactly as it arrived (nothing typed,
// no Save under way), every data update asks again, and the real product wins.
function reconsiderDraft() {
  if (!draftRecipeId || view !== 'editor' || !activeEditor || !activeEditor.isUntouched()) return false;
  const id = draftRecipeId;
  const using = productsUsingRecipe(getProducts(), id);
  if (!using.length) return false;
  if (using.length === 1) { openProduct(using[0]); entryEditor = true; refreshChrome(); }
  else { listFilter = id; showList(); }
  return true;
}

// Beside the list on a tablet the page header follows what the recipe opened (its Back).
function refreshChrome() {
  if (splitOn) setListChrome();
}

// The address is spent once it has been read: a reload, or coming back to this page
// later, must not reopen the same product.
function clearAddress() {
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch (e) { /* best-effort: at worst a reload decides again */ }
}

// The margin over time. Read on demand, never watched.
async function openHistory(product) {
  view = 'history';
  // ⚠️ ON A TABLET THE EDITOR IS SET ASIDE, NOT DROPPED: its node, its working copy and its
  // guard stay alive, and the pane's Back returns to exactly what was typed. A phone drops
  // it, as it always did.
  if (splitOn && activeEditor) heldEditor = activeEditor;
  if (!heldEditor) leaveGuard = null;
  activeEditor = null;
  // Beside the list the page header stays the list's; a phone names the screen.
  if (!splitOn) setHeader({ title: t('fc.marginHistory'), sub: product.name || t('fc.productWord'), back: true });

  const body = el('div', { class: 'fc-view' }, [el('p', { class: 'fc-empty', text: t('fc.loading') })]);
  historyBody = body;
  showNode(body);

  let entries;
  try {
    entries = await getProductHistory(product.id);
  } catch (err) {
    console.error('Could not read the margin history:', err);
    body.replaceChildren(el('p', { class: 'fc-empty', text:
      t('fc.couldNotLoadThe') }));
    return;
  }

  if (!entries.length) {
    body.replaceChildren(el('p', { class: 'fc-empty', text:
      t('fc.nothingRecordedYetA') }));
    return;
  }

  body.replaceChildren(
    ...entries.map(entry => el('div', { class: 'fc-hist-row' }, [
      el('span', { class: 'fc-hist-pct', text: `${entry.foodCostPct}%` }),
      el('span', { class: 'fc-hist-detail', text: t('fc.histDetail', {
        cost: formatRate(entry.unitCost),
        price: formatMoney(entry.sellingPrice),
        vat: entry.vatRate,
      }) }),
      el('span', { class: 'fc-hist-when', text: shortDate(entry.recordedAt) }),
    ])),
    // ⚠️ SAID OUT LOUD, because the gap is invisible otherwise. A point exists only
    // where somebody changed something; ingredient prices drifting upward leave no
    // mark here at all, so a flat line does NOT mean a flat margin.
    el('p', { class: 'fc-note', text:
      t('fc.aPointIsRecorded') }),
  );
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' });
}

async function handleBack() {
  // A phone that crossed the width with the editor set aside: Back is «back to the product».
  if (view === 'history' && heldEditor && !splitOn) { backToProduct(); return; }
  if (!(await askLeave())) return;
  leaveGuard = null;
  // Beside the list the page Back is the LIST's Back (to the recipe), whatever the pane holds.
  if (splitOn && (view === 'editor' || view === 'history')) {
    if (fromRecipe && (listFilter || entryEditor)) { window.location.replace(recipeHref(fromRecipe)); return; }
    showList();
    return;
  }
  // From the history, step back into the product it belongs to — one level at a
  // time, the app's drill-in rule — rather than jumping out to the list.
  if (view === 'history' && currentProduct) { backToProduct(); return; }
  // Out of a product chosen from the narrowed list: back to that list.
  if (view === 'editor' && listFilter && !entryEditor) { showList(); return; }
  // ⚠️ THE FIRST SCREEN A RECIPE OPENED GOES BACK TO THAT RECIPE — the wait, the product
  // it opened, or the narrowed list. The unsaved-edits question above has already been
  // asked, so nothing typed is lost on the way.
  if (fromRecipe && (view === 'loading' || (view === 'editor' && entryEditor) || (view === 'list' && listFilter))) {
    // ⚠️ replace(), NOT href: Back must not ADD a page to the phone's history, or the
    // system back gesture walks forward into Food cost again — two more pages per trip.
    window.location.replace(recipeHref(fromRecipe));
    return;
  }
  showList();
}

function toast(msg) {
  const t = document.getElementById('fcToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}

const app = {
  confirm: confirmDialog,
  toast,
  showList,
  openHistory,
  saveProduct,
  deleteProduct,
  tables,
  // Every product, so a recipe line can say how many OTHERS a weighing typed on it
  // changes — the loss belongs to the recipe, not to the product it was typed on.
  products: getProducts,
  // Whether a recipe line may offer the two weighing boxes at all — see canWriteRecipes().
  canWeigh: canWriteRecipes,
  // The venue's country, which decides the VAT choices a product offers.
  country: venueCountry,
  // Whether this person runs the place — who is told where the hourly labour cost is set.
  mayManage: canManageHere,
  setLeaveGuard: (fn) => { leaveGuard = fn; },

  // The recipes a component can point at, by NAME ONLY.
  // ⚠️ NO PRICE IN THE CHOOSER. Federico, 13 Sep 2026: «nella sezione "composto da" non
  // mostrare il prezzo». What the product costs is read in «Costo di produzione», once.
  recipeOptions() {
    return Object.values(getRecipes())
      .filter(r => r && String(r.name || '').trim())
      .map(r => ({ id: r.id, label: String(r.name).trim() }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },

  // The ingredients a product can have added straight to it — never packaging, which has
  // its own section. By name, with the pack weight that tells two similar ones apart, and
  // ⚠️ NO PRICE: «nella sezione "composto da" non mostrare il prezzo».
  ingredientOptions() {
    return Object.values(getIngredients())
      .filter(i => i && i.active !== false && !isPackaging(i) && String(i.name || '').trim())
      .map(i => ({ id: i.id, name: String(i.name).trim(), meta: String(i.weight || '').trim() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  // The packaging a product can use: the items filed as PACKAGING in «Fornitori e
  // ingredienti» (Federico, 13 Sep 2026: «la voce imballaggio deve puntare ad imballaggio»).
  // Packaging is counted in pieces, so anything priced another way is shown but flagged —
  // hiding it would look like the item had been deleted.
  packagingOptions() {
    return Object.values(getIngredients())
      .filter(i => i && i.active !== false && isPackaging(i) && String(i.name || '').trim())
      .map(i => {
        const each = i.priceUnit === 'pcs' ? Number(i.pricePerUnit) : null;
        const perKg = pricePerKg(i);
        const note = each ? t('fc.priceEach', { price: formatRate(each) })
          : perKg !== null ? t('fc.pricedByWeight')
            : t('fc.notPriced');
        return { id: i.id, name: String(i.name).trim(), meta: note };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },
};

backBtn.addEventListener('click', handleBack);
// ⚠️ Home is a plain link. Beside an open editor it must ask the same guard first, or a tap on
// it would throw the typing away with the page.
homeBtn.addEventListener('click', async (e) => {
  if (!leaveGuard) return;
  e.preventDefault();
  if (await askLeave()) window.location.href = homeBtn.href;
});

// Settings: the hourly labour cost. The button is hidden until the session says this
// person runs the place, and the rules refuse anybody else whatever this page draws.
settingsBtn.addEventListener('click', () => {
  openFoodcostSettings({
    rate: getLabourCostPerHour(),
    confirm: confirmDialog,
    onSave: saveLabourRate,
    toast,
    returnFocus: settingsBtn,
  });
});
// Who is looking arrives with the session, after the first paint.
authReady.then(paintFooter);
setSyncErrorHandler(msg => toast(msg));

initFoodCost(
  () => {
    // While a recipe's link is still being decided, every arrival is a chance to decide.
    if (fromRecipe && !recipeLinkSettled) { settleRecipeLink(); return; }
    if (reconsiderDraft()) return;
    if ((view === 'list' || (splitOn && (view === 'editor' || view === 'history'))) && activeList) {
      activeList.refresh(listedProducts(), tables());
    }
    // A product on screen picks up the recipes and prices as they arrive, and any
    // change made on another phone, without losing the edit in progress. ⚠️ THE WORKING COPY
    // IS NEVER REPLACED by a remote edit (it never was): only the lines and the answer redraw.
    // Beside the list, a product deleted elsewhere sends an UNTOUCHED editor back to the
    // placeholder; one with typing in it is kept, as on a phone.
    if (view === 'editor' && activeEditor) {
      if (openProductWasDeleted(activeEditor)) { toast(t('fc.productDeleted')); showList(); return; }
      activeEditor.refreshData();
    }
    // The margin history shows the product's editor set aside: the same question about it.
    if (view === 'history' && heldEditor && openProductWasDeleted(heldEditor)) {
      toast(t('fc.productDeleted')); showList(); return;
    }
    if (heldEditor) heldEditor.refreshData();
    if (view === 'list' && splitOn) syncPaneEmpty();
  },
  () => toast(t('fc.liveSyncInterruptedProducts')),
);

// ⚠️ AND AGAIN WHEN THE LANGUAGE ARRIVES — the same rule js/i18n-dom.js already
// applies to the markup, and for the same reason: this screen is built once, at load,
// while the venue's language arrives later with the session. Without this the page
// header translated (i18n-dom does that) and everything inside it stayed English.
// ⚠️ ONLY FROM THE LIST (or the wait). Redrawing while somebody is editing would throw
// away what they have typed — and the language only ever changes at startup or from
// settings.
onLanguageChange(() => {
  if (view === 'list') showList();
  else if (view === 'loading') showWaiting();
  else if (splitOn && (view === 'editor' || view === 'history')) {
    // The list beside the product, the page header and the pane head are words too; the
    // editor itself is left alone (its typing is never redrawn away).
    setListChrome();
    paintListColumn(currentProduct ? currentProduct.id : null);
    const head = screen.querySelector('.app-header');
    if (head) head.replaceWith(buildPaneHead());
  }
});

// ⚠️ CROSSING THE WIDTH (a rotation, a resized window) re-lays out the list, a product and
// its history — and the EDITOR IS MOVED, NEVER REBUILT: it holds a working copy, and its node
// keeps every field, its scroll and its guard. The wait is left alone.
watchTablet((isTablet) => {
  const route = crossingRoute({ view, isTablet, splitOn, hasHeldEditor: !!heldEditor });
  if (route.action === 'relist') showList();
  else if (route.action === 'move-editor' && activeEditor) moveEditor(route.toTablet);
  else if (route.action === 'move-history' && historyBody) moveHistory(route.toTablet);
});

// The history node MOVES between the pane and the full screen — not fetched again — and the
// editor set aside stays alive (its node and its guard), so the Back that follows, the pane's
// or the phone's, returns to exactly what was typed.
function moveHistory(toTablet) {
  quietFocus = true;
  try {
    if (toTablet) {
      setSplit(true);
      setListChrome();
      paintListColumn(currentProduct ? currentProduct.id : null);
      showNode(historyBody);
    } else {
      setSplit(false);
      listCol.replaceChildren();
      paneEmpty = null;
      activeList = null;
      setHeader({ title: t('fc.marginHistory'), sub: (currentProduct && currentProduct.name) || t('fc.productWord'), back: true });
      swap(historyBody);
    }
  } finally { quietFocus = false; }
}

function moveEditor(toTablet) {
  const node = activeEditor.root;
  const active = document.activeElement;
  const inside = active && node.contains(active) ? active : null;
  const caret = inside && typeof inside.selectionStart === 'number'
    ? [inside.selectionStart, inside.selectionEnd] : null;
  quietFocus = true;
  try {
    if (toTablet) {
      setSplit(true);
      setListChrome();
      paintListColumn(currentProduct ? currentProduct.id : null);
      showNode(node);
    } else {
      setSplit(false);
      listCol.replaceChildren();
      activeList = null;
      setEditorHeaderPhone(currentProduct);
      swap(node);
    }
  } finally { quietFocus = false; }
  if (inside && inside.isConnected) {
    try {
      inside.focus({ preventScroll: true });
      if (caret) inside.setSelectionRange(caret[0], caret[1]);
    } catch (e) { /* best-effort */ }
  }
}

// The stored product the open editor was made from is gone from the live list.
function openProductWasDeleted(editor) {
  return splitOn && currentProduct && currentProduct.id && hasLiveProducts()
    && !getProducts().some(p => p && p.id === currentProduct.id)
    && editor.isUntouched();
}

if (fromRecipe) {
  showWaiting();
  // ⚠️ THE DEADLINE STARTS WHEN THE VENUE IS OPEN, not when the page loads: signing in
  // can take longer than the whole wait, and a deadline that passed behind the sign-in
  // screen would decide on an empty copy — the very thing the wait exists to prevent.
  authReady.then(() => {
    setTimeout(() => { recipeLinkDeadlinePassed = true; settleRecipeLink(); }, RECIPE_LINK_WAIT_MS);
    settleRecipeLink();
  });
} else {
  showList();
}
