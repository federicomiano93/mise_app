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
  getRecipes, getIngredients, hasLiveProducts, hasLiveRecipes,
} from './foodcost-store.js';
import { renderList } from './foodcost-list.js';
import { renderEditor } from './foodcost-editor.js';
import { getProductHistory, canWriteRecipes, venueCountry, authReady } from './firebase-foodcost.js';
import { confirmDialog } from './confirm-dialog.js';
import { el } from './dom.js';
import { productsUsingRecipe, draftFromRecipe } from './foodcost-model.js';
import { formatRate, formatMoney, pricePerKg } from '../price-model.js';
// The address a recipe's «Apri nel Food cost» opens this page with, and the way back to
// that recipe. From js/ root: the catalogue and Food cost share an address, never a folder.
import { recipeIdFromHash, recipeHref } from '../recipe-link.js';

const screen = document.getElementById('fcScreen');
const titleEl = document.getElementById('fcTitle');
const subEl = document.getElementById('fcSub');
const homeBtn = document.getElementById('fcHome');
const backBtn = document.getElementById('fcBack');

let view = 'list';          // 'list' | 'editor' | 'history' | 'loading'
let activeList = null;
let activeEditor = null;
let currentProduct = null;
let leaveGuard = null;

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

function setHeader({ title, sub, back }) {
  titleEl.textContent = title;
  subEl.textContent = sub;
  homeBtn.hidden = back;
  backBtn.hidden = !back;
}

function swap(node) {
  screen.replaceChildren(node);
  screen.scrollTop = 0;
  node.setAttribute('tabindex', '-1');
  try { node.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
}

// The products the list shows: all of them, or only those using the recipe it was
// narrowed to.
function listedProducts() {
  return listFilter ? productsUsingRecipe(getProducts(), listFilter) : getProducts();
}

function showList() {
  view = 'list';
  activeEditor = null;
  currentProduct = null;
  leaveGuard = null;
  entryEditor = false;
  draftRecipeId = null;
  // ⚠️ Narrowed, the list has Back (to the recipe) where it otherwise has Home.
  setHeader({ title: t('fc.foodCost'), sub: t('fc.productsAndMargins'), back: !!listFilter });
  activeList = renderList({
    products: listedProducts(), tables: tables(), onOpen: openProduct, onAdd: () => openProduct(null),
    filter: listFilter ? {
      title: filterTitle(listFilter),
      // Everything, and the page stops being «the recipe's»: Back becomes Home again.
      onShowAll: () => { listFilter = null; fromRecipe = null; showList(); },
    } : null,
  });
  swap(activeList.root);
}

function filterTitle(recipeId) {
  const recipe = getRecipes()[recipeId];
  const name = recipe ? String(recipe.name || '').trim() : '';
  return name ? t('fc.productsWithRecipe', { name }) : t('fc.productsWithThisRecipe');
}

function openProduct(product, draft = null) {
  view = 'editor';
  draftRecipeId = null;
  activeList = null;
  currentProduct = product;
  leaveGuard = null;
  setHeader({ title: product ? (product.name || t('fc.productWord')) : t('fc.newProduct'), sub: t('fc.foodCost'), back: true });
  activeEditor = renderEditor({ product, draft, app });
  swap(activeEditor.root);
}

// The short wait while a recipe's link is being decided. It has Back, and Back goes to
// the recipe — somebody who changes their mind must not be stuck behind a spinner.
function showWaiting() {
  view = 'loading';
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
  if (using.length === 1) { openProduct(using[0]); entryEditor = true; return; }
  if (using.length > 1) { listFilter = id; showList(); return; }
  const draft = draftFromRecipe(getRecipes()[id]);
  if (draft) { openProduct(null, draft); entryEditor = true; draftRecipeId = id; return; }
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
  if (using.length === 1) { openProduct(using[0]); entryEditor = true; }
  else { listFilter = id; showList(); }
  return true;
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
  activeEditor = null;
  leaveGuard = null;
  setHeader({ title: t('fc.marginHistory'), sub: product.name || t('fc.productWord'), back: true });

  const body = el('div', { class: 'fc-view' }, [el('p', { class: 'fc-empty', text: t('fc.loading') })]);
  swap(body);

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
  if (leaveGuard) {
    const ok = await leaveGuard();
    if (!ok) return;
  }
  leaveGuard = null;
  // From the history, step back into the product it belongs to — one level at a
  // time, the app's drill-in rule — rather than jumping out to the list.
  if (view === 'history' && currentProduct) { openProduct(currentProduct); return; }
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

  // Packaging can only be counted in pieces, so anything priced another way is
  // shown but flagged — hiding it would look like the item had been deleted.
  packagingOptions() {
    return Object.values(getIngredients())
      .filter(i => i && i.active !== false && String(i.name || '').trim())
      .map(i => {
        const each = i.priceUnit === 'pcs' ? Number(i.pricePerUnit) : null;
        const perKg = pricePerKg(i);
        const note = each ? t('fc.priceEach', { price: formatRate(each) })
          : perKg !== null ? t('fc.pricedByWeight')
            : t('fc.notPriced');
        return { id: i.id, label: `${i.name} — ${note}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  },
};

backBtn.addEventListener('click', handleBack);
setSyncErrorHandler(msg => toast(msg));

initFoodCost(
  () => {
    // While a recipe's link is still being decided, every arrival is a chance to decide.
    if (fromRecipe && !recipeLinkSettled) { settleRecipeLink(); return; }
    if (reconsiderDraft()) return;
    if (view === 'list' && activeList) activeList.refresh(listedProducts(), tables());
    // A product on screen picks up the recipes and prices as they arrive, and any
    // change made on another phone, without losing the edit in progress.
    if (view === 'editor' && activeEditor) activeEditor.refreshData();
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
});

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
