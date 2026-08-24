// orders-main.js — entry point for orders.html.
//
// Tabs + Firebase connectivity; the supplier list with stock + order fields; the
// autosaving real-time draft; preview/send; history; the management panel.
//
// The unit of an order is one DAY and one SUPPLIER. Everything here follows from
// that: "Order placed" lives on each supplier card and touches only that
// supplier's rows; the draft remembers which day each supplier's rows were typed
// on, so an order left unmarked overnight is filed under the day it was written,
// not under today.

import { t, joinList } from '../i18n.js';
// ⚠️ createDoc / removeDoc / saveIngredientWithPrice / getPriceHistory LEFT WITH THE
// RECORDS. This page no longer creates, deletes or prices anything — it reads the
// two collections to draw an order. js/orders/registry-main.js holds those calls now.
import {
  watchCollection, watchDoc, saveDoc, COLLECTIONS,
  watchIngredientPrices, canManageHere,
} from './firebase-orders.js';
import { withPrices } from '../price-model.js';
import { currentSession } from '../firebase.js';
import { el, groupBy } from './dom.js';
import { mountSupplierList, refreshSupplierDerived } from './suppliers.js';
import { buildSupplierDetail } from './supplier-detail.js';
import { buildSupplierItems } from './supplier-items.js';
import {
  scheduleDraftSave, saveDraftNow, flushDraftSave, watchDraft, archiveSupplier, clearSupplier,
  clearQuantities, saveHistoryRecord, deleteHistoryRecord, setDraftSaveReporter,
  confirmDelivery,
} from './draft.js';
import { buildSendScreen } from './preview.js';
import { buildSupplierPicker } from './supplier-picker.js';
import { renderHistory as renderHistoryView } from './history.js';
import { renderDeliveries, renderReorderBanner, renderOwedBanner } from './deliveries-view.js';
import { buildHistoryEditor } from './history-edit.js';
import { buildPlaceConfirm } from './place-confirm.js';
import {
  askedToday, confirmedEntries, untoldChanges, orderedToday,
} from './untold-changes.js';
import { renderUntold } from './untold-view.js';
import { buildManagement, isAdmin } from './management.js';
import { computeSuggestion, isUnusualQuantity } from './suggestions.js';
import { refreshBankHolidays } from './bank-holidays.js';
import { renderAlerts } from './notifications.js';
import { routesFor } from './send-routes.js';
import { confirmDialog } from './confirm-dialog.js';
import { todayISO, dayPhrase, daySpoken, localDayOf, dayLabel } from './day.js';
import {
  buildOrderMessage, whatsappUrl, itemsFromQuantities, indexById,
} from './order-text.js';
import {
  historyDocId, ingredientsOf, supplierHasItems, ingredientLabel, wholeNumber,
} from './archive.js';
import { todayOrders, pendingSuppliers } from './reminders.js';
import { renderTodayOrders, renderPending } from './reminder-view.js';
import { resolveSuppliers, orderSuppliers } from './no-supplier.js';
import { normalizeOrdersConfig } from './orders-config.js';
import { mountIngredientList } from './ingredient-list.js';
import { orderSummary } from './ingredient-search.js';
import {
  watchOrderRequests, sendOrderRequest, setOrderRequestDone, finishOrderRequest,
  deleteOrderRequest, getOwnMemberRow, getRosterOnce, getAwayDaysOnce,
} from './firebase-orders.js';
import {
  buildOrderRequest, senderName, waitingRequests, remainingIds, isRequestDone, supplierIdsOf,
} from './order-request-model.js';
import { awayUids, nobodyWillBeTold, awayNames } from '../away-model.js';
import {
  buildRequestListScreen, buildRequestScreen, confirmFinish, confirmDeleteRequest,
  resetRequestWindow,
} from './order-requests.js';


const state = {
  suppliers: [],
  ingredients: [],
  rawIngredients: [],
  ingredientPrices: {},
  history: [],
  requests: [],                 // order lists somebody sent to whoever runs the place
  entries: {},                  // { ingredientId: { qty, stock } } — shared object, mutated in place
  days: {},                     // { supplierId: 'YYYY-MM-DD' } — the day those rows were typed
  draftUpdatedAt: '',           // fallback day for a draft written before `days` existed
  pending: [],                  // orders typed on an earlier day and never placed
  openSupplier: null,           // the supplier whose own screen is open, or null
  viewingSupplier: null,        // the supplier whose read-only product list is open
  view: 'suppliers',            // which of the two order views is on screen
  query: '',                    // the flat list's search text, kept OUT of the DOM (see render)
  supplierQuery: '',            // the supplier list's search text — deliberately separate
  supplierFilter: false,        // supplier list showing only what is being ordered
  filterIds: null,              // FROZEN Set of ingredient ids, or null for "show everything"
  loaded: { suppliers: false, ingredients: false, draft: false },
};

let mgmt = null;                // open management panel handle, or null
let pendingChecked = false;     // the unfinished-order check runs once per page load
let ordersConfig = normalizeOrdersConfig(null);   // config/orders, mirrored locally — see below
let flatView = null;            // mounted flat-list handle, or null when not on screen
let cardsView = null;           // mounted supplier-list handle, or null
let detailView = null;          // the open supplier's screen, or null
let itemsView = null;           // the open read-only product list, or null
let requestListView = null;     // the list of sent order lists, or null
let openRequestId = null;       // the sent list being worked through, or null
let requestView = null;         // that list's own screen, or null
const placing = new Set();      // suppliers whose order is being written right now

// Replace state.entries contents WITHOUT changing the reference (row closures keep working).
function setEntries(next) {
  Object.keys(state.entries).forEach(k => delete state.entries[k]);
  Object.assign(state.entries, next || {});
}

const hooks = {
  afterChange(supplierId) {
    const supplier = findOrderSupplier(supplierId);
    if (supplier) {
      refreshSupplierDerived(supplier, ingredientsBySupplier()[supplierId] || [], state.entries);
    }
    // In the flat list there are no per-supplier cards, so the "Order placed…" button
    // is the only way to record an order. It used to wait for the change to come back
    // from Firestore before appearing; here it has to appear as you type. The summary
    // bar's numbers must move as you type for the same reason.
    refreshOrderTotals();
    // Stamp the day these rows were touched. This is what lets the app offer an
    // order typed yesterday under YESTERDAY's date instead of quietly filing it
    // under today.
    state.days[supplierId] = todayISO();
    scheduleDraftSave(state.entries, state.days);
  },
  onPlaced(supplierId) {
    placeOrder(supplierId);
  },
  onClear(supplierId) {
    clearQuantitiesFor([supplierId]);
  },
};

// ── Orders settings (config/orders) ───────────────────────────────────────────
//
// LOCAL-FIRST (P20). The cached copy is applied synchronously as the screen starts, so
// a bakery that has turned Stock off never sees it flash into view and disappear again;
// the Firestore listener then corrects it and keeps every phone in step. Same shape the
// Calculator uses for config/calculator.
const CONFIG_KEY = 'orders-config';

function readCachedConfig() {
  try {
    return normalizeOrdersConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'));
  } catch {
    return normalizeOrdersConfig(null);
  }
}

function applyOrdersConfig(config) {
  ordersConfig = config;
  // A class on <body>, not a rebuild: the rows are built by one shared function used by
  // three screens, and hiding a field is a matter of appearance, not of structure. It
  // also means the stored stock values stay exactly where they are.
  document.body.classList.toggle('hide-stock', !config.showStock);
}

function watchOrdersConfig() {
  return watchDoc(COLLECTIONS.config, 'orders', doc => {
    const config = normalizeOrdersConfig(doc);
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* private mode */ }
    applyOrdersConfig(config);
    // The window may have just changed — on this phone or on another one. Stock is a
    // <body> class and needs no repaint; how many days History shows does.
    renderHistory();
    mgmt?.refresh();
  });
}

// ── The supplier lens ─────────────────────────────────────────────────────────
//
// Everything in the order flow goes through these three, and nothing reads
// state.ingredients/state.suppliers directly for ordering purposes. That is the
// whole safety story for the pseudo-supplier: an ingredient bought without one (or
// left behind by a deleted supplier) is filed under 'no-supplier' by ONE function,
// so the card it appears on, the order it is archived into and the rows cleared
// afterwards can never disagree about where it belongs.
//
// History and the management panel deliberately keep the RAW list: they resolve
// names by id and edit the stored document, so re-pointing a supplier there would
// be a lie.

// Ingredients with every supplierId resolved against the suppliers that exist.
function orderIngredients() {
  return resolveSuppliers(state.ingredients, state.suppliers, state.loaded.suppliers);
}

function activeSuppliers() {
  return state.suppliers
    .filter(s => s.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The real active suppliers, plus "No supplier" at the end when something is
// filed under it.
function orderSupplierList() {
  return orderSuppliers(activeSuppliers(), orderIngredients());
}

// A supplier by id, the pseudo one included — state.suppliers.find would return
// undefined for it and silently do nothing.
function findOrderSupplier(supplierId) {
  return orderSupplierList().find(s => s.id === supplierId);
}

function ingredientsBySupplier() {
  return groupBy(orderIngredients().filter(i => i.active !== false), 'supplierId');
}

function refreshAllSuppliers() {
  const bySupplier = ingredientsBySupplier();
  orderSupplierList().forEach(s => refreshSupplierDerived(s, bySupplier[s.id] || [], state.entries));
  refreshOrderTotals();
}

// Everything derived from "how much is in the order right now". Counted, not listed —
// which is why it is safe to run on every keystroke while the FILTERED row list is
// deliberately frozen.
function currentSummary() {
  return orderSummary({
    ingredients: orderIngredients(),
    suppliers: orderSupplierList(),
    entries: state.entries,
  });
}

function refreshOrderTotals() {
  refreshPlaceAllButton();
  refreshClearAllButton();
  // Counts only — never the rows. See updateCounts in ingredient-list.js / suppliers.js.
  flatView?.updateCounts(currentSummary().itemCount);
  cardsView?.updateCounts();
}

// Push the draft's values back into the inputs on screen, without rebuilding anything
// (so nobody loses focus mid-typing).
//
// The selector deliberately does NOT stop at #suppliers-list: a supplier's own screen
// is an overlay OUTSIDE that container, and scoping to it would mean a quantity typed
// on another phone silently stopped appearing while you were inside a supplier.
function syncInputsFromState() {
  document.querySelectorAll('.ing-row[data-ing]').forEach(row => {
    const entry = state.entries[row.dataset.ing] || {};
    const stock = row.querySelector('.ing-stock');
    const qty = row.querySelector('.ing-qty');
    if (stock && stock !== document.activeElement) stock.value = entry.stock || '';
    if (qty && qty !== document.activeElement) qty.value = entry.qty || '';
  });
  refreshAllSuppliers();
}

// ── Rendering: order tab ──────────────────────────────────────────────────────
//
// Both list views are drawn INSIDE #suppliers-list, and that is not a detail.
// orders.css scopes the fix for the .ing-row name collision with the Calculator, and
// a row rendered outside a covered container silently falls back to the Calculator's
// flex layout and pushes the Order box off the card on a 320px phone. (The supplier's
// own screen is an overlay, so its list is covered by the `.ingredient-list .ing-row`
// half of that same rule.)
function render() {
  const container = document.getElementById('suppliers-list');
  if (!container) return;
  if (!state.loaded.suppliers || !state.loaded.ingredients) return;

  // ⚠️ THE RE-ORDER BANNER READS THE DRAFT, so it has to be redrawn here as well
  // as when history lands. The first driven run caught it: putting a missing
  // ingredient back filled the row correctly and the banner stayed up, still asking
  // for something already done — and a reminder that survives the action it asked
  // for is one people learn to ignore. A keystroke does NOT reach render(), so this
  // costs nothing per character typed.
  renderIncoming();

  const suppliers = orderSupplierList();
  const hasSomething = suppliers.length > 0;
  setViewSwitchVisible(hasSomething);
  // The first snapshots can land in any order, and the draft may already hold an order
  // from a previous session — so the totals are refreshed here too, not only from the
  // paths that react to typing.
  refreshOrderTotals();

  if (!hasSomething) {
    dropListViews();
    renderEmptyState(container);
    return;
  }

  if (state.view === 'all') renderFlatList(container);
  else renderSupplierList(container, suppliers);

  renderOpenSupplier();
  renderSupplierItems();
}

// Both list views own nodes inside the shared container, so whenever it is wiped or
// handed to the other view, the stale handle has to go with it.
function dropListViews() {
  flatView = null;
  cardsView = null;
}

// The supplier list is MOUNTED once and then only repainted — see the note on
// renderFlatList below; the same trap, the same answer.
function renderSupplierList(container, suppliers) {
  if (!cardsView) {
    flatView = null;
    container.textContent = '';
    cardsView = mountSupplierList(container, {
      query: state.supplierQuery,
      filterActive: state.supplierFilter,
      onQuery: q => { state.supplierQuery = q; },
      onFilter: active => { state.supplierFilter = active; },
      onOpen: openSupplier,
      onView: openSupplierItems,
    });
  }
  cardsView.repaint({
    suppliers,
    ingredientsBySupplier: ingredientsBySupplier(),
    entries: state.entries,
  });
}

// ── One supplier's own screen ─────────────────────────────────────────────────
function openSupplier(supplierId) {
  closeSupplierItems();         // two full-screen screens must never stack up
  state.openSupplier = supplierId;
  renderOpenSupplier();
}

function closeSupplier() {
  state.openSupplier = null;
  detailView?.overlay.remove();
  detailView = null;
}

// Create the screen, or repaint the one already up. Repainting happens on every
// suppliers/ingredients/history snapshot, exactly as the expanded card was rebuilt
// before — keystrokes never come through here, they reach the inputs through
// syncInputsFromState, which does not touch the DOM structure.
function renderOpenSupplier() {
  if (!state.openSupplier) return;

  const supplier = findOrderSupplier(state.openSupplier);
  // Deactivated or deleted while the screen was open: leave rather than show a screen
  // for something that is no longer there.
  if (!supplier) { closeSupplier(); return; }

  const ctx = {
    ingredients: ingredientsBySupplier()[supplier.id] || [],
    entries: state.entries,
    suggest: suggestFor,
    hooks,
    onBack: closeSupplier,
  };

  if (detailView && detailView.id === supplier.id) {
    detailView.repaint(ctx);
    return;
  }

  detailView?.overlay.remove();
  const built = buildSupplierDetail(supplier, ctx);
  detailView = { ...built, id: supplier.id };
  document.body.appendChild(built.overlay);
}

// ── What a supplier sells, to look at ─────────────────────────────────────────
//
// The same shape as the order screen above, on purpose: opened from the list,
// repainted on every snapshot, and closed by itself if the supplier goes away. It
// writes NOTHING — which is the whole point of it, and why it can be opened in the
// middle of an order without a thought.
function openSupplierItems(supplierId) {
  closeSupplier();
  state.viewingSupplier = supplierId;
  renderSupplierItems();
}

function closeSupplierItems() {
  state.viewingSupplier = null;
  itemsView?.overlay.remove();
  itemsView = null;
}

function renderSupplierItems() {
  if (!state.viewingSupplier) return;

  const supplier = findOrderSupplier(state.viewingSupplier);
  // Deactivated or deleted while the list was open: leave, rather than keep showing
  // a screen for something that is no longer there.
  if (!supplier) { closeSupplierItems(); return; }

  // The SAME lens the order screen uses — never state.ingredients raw, or a product
  // left without a supplier would appear on one screen and not the other.
  const ingredients = ingredientsBySupplier()[supplier.id] || [];

  if (itemsView && itemsView.id === supplier.id) {
    itemsView.repaint(ingredients);
    return;
  }

  itemsView?.overlay.remove();
  const built = buildSupplierItems(supplier, ingredients, { onBack: closeSupplierItems });
  itemsView = { ...built, id: supplier.id };
  document.body.appendChild(built.overlay);
}

// The flat list is MOUNTED once and then only repainted.
//
// render() runs on every suppliers/ingredients/history snapshot, including ones
// caused by another phone. If it rebuilt the search box each time, the text being
// typed would be wiped out mid-search by someone else's edit — the same trap
// renderSearchableList in management.js already sidesteps. The query lives in
// state.query, so it also survives a trip through the by-supplier view.
function renderFlatList(container) {
  if (!flatView) {
    cardsView = null;
    container.textContent = '';
    flatView = mountIngredientList(container, {
      query: state.query,
      onQuery: q => { state.query = q; },
      onFilter: setOrderFilter,
      suggest: suggestFor,
      entries: state.entries,
      hooks,
    });
  }
  flatView.repaint({
    ingredients: orderIngredients(),
    suppliers: orderSupplierList(),
    only: state.filterIds,
    inOrderCount: currentSummary().itemCount,
  });
}

function renderEmptyState(container) {
  container.textContent = '';
  container.appendChild(el('div', { class: 'empty-state' }, [
    el('p', { class: 'empty-title', text: t('orders.noSuppliersYet2') }),
    el('p', { class: 'empty-sub', text: t('orders.addYourSuppliersAnd') }),
  ]));
}

// ── The two order views ───────────────────────────────────────────────────────

// ⚠️⚠️ ONE PLACE WRITES THIS, AND IT HAS TO ANSWER FOR BOTH REASONS. The switch used
// to live INSIDE the order panel, so the Incoming tab hid it for free just by hiding
// its own panel. In the box's sticky head it is a sibling of both panels and would
// sit there on Incoming, offering to switch a list that is not on screen.
//
// ⚠️ Two functions writing the same `hidden` is how the two conditions come to
// disagree — one of them always wins last, and which one depends on the order the
// snapshots happen to arrive in.
let hasSomethingToOrder = false;

function setViewSwitchVisible(visible) {
  hasSomethingToOrder = visible;
  refreshViewSwitch();
}

function refreshViewSwitch() {
  const sw = document.getElementById('order-view-switch');
  if (!sw) return;
  const onOrderTab = document.getElementById('tab-order')?.classList.contains('active') === true;
  sw.hidden = !(onOrderTab && hasSomethingToOrder);
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  // The "just what I'm ordering" filter belongs to the flat list; the cards always
  // show everything, so leaving for them drops it rather than hiding it somewhere
  // invisible and surprising the operator with it on the way back.
  if (view === 'suppliers') state.filterIds = null;
  dropListViews();              // force a remount; both queries are kept in state
  syncViewButtons();
  render();
  refreshOrderTotals();
}

function syncViewButtons() {
  [['view-by-supplier', 'suppliers'], ['view-all-ingredients', 'all']].forEach(([id, view]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const on = state.view === view;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
}

// The view is NOT remembered between visits (Federico, 30 Jul 2026): opening the app
// always lands on By supplier. It does persist across a trip to the History tab and
// back, because that is one session of work and moving the screen under someone
// mid-task is worse than a forgotten preference.
function setupViewSwitch() {
  document.getElementById('view-by-supplier')?.addEventListener('click', () => setView('suppliers'));
  document.getElementById('view-all-ingredients')?.addEventListener('click', () => setView('all'));
  syncViewButtons();
}

// ── "Just what I'm ordering" ──────────────────────────────────────────────────
//
// The row list is FROZEN the moment the filter is entered and is never recomputed
// from the quantities while it is on. Recomputing per keystroke would mean that
// correcting a quantity to 0 makes the row vanish under the finger doing the
// correcting, with no way back to it. The two buttons' NUMBERS do update live — a
// count is not a list, so it can move without anything disappearing.
//
// Deliberately NOT remembered across reloads: the view is a preference, this is a
// gesture. Reopening the app to a mysteriously short list would be worse than
// tapping the bar again.
function setOrderFilter(active) {
  const next = active ? new Set(currentSummary().ids) : null;
  const changed = Boolean(state.filterIds) !== Boolean(next);
  state.filterIds = next;
  if (changed || active) render();     // re-entering refreshes the frozen set
}

// ── Rendering: history tab ────────────────────────────────────────────────────
function applyHistory(list) {
  state.history = list;
  renderHistory();
  renderIncoming();
  render(); // refresh order-tab suggestions now that history is available
}

// ── Rendering: what has been ordered and has not arrived ─────────────────────
//
// ⚠️ REDRAWN FROM THE HISTORY SNAPSHOT, never from a local flag. Two phones in one
// kitchen confirm deliveries independently, and the screen that shows what is still
// coming is exactly the screen that must not disagree with the other person's tap.
function renderIncoming() {
  const suppliersById = {};
  (state.suppliers || []).forEach(s => { suppliersById[s.id] = s; });
  const ingredientsById = indexById(orderIngredients());

  const ctx = {
    history: state.history,
    entries: state.entries,
    suppliersById,
    ingredientsById,
    today: todayISO(),
    // ⚠️ ONE ANSWER FOR BOTH HALVES. The week window and the debt read the same
    // setting: if only one honoured it they would quietly disagree about which week an
    // order is in, and an order could be in neither.
    weekStartsOn: ordersConfig.weekStartsOn,
    onConfirm: async (order, missingIds) => {
      const missing = {};
      missingIds.forEach(id => { missing[id] = true; });
      await confirmDelivery(order.id || historyDocId(order.date, order.supplierId), {
        deliveredAt: new Date().toISOString(),
        missing,
      });
    },
    // ⚠️ GOES THROUGH THE SAME AUTOSAVE EVERY KEYSTROKE USES. A second way to write
    // the draft is a second thing that can disagree with the first about what is in it.
    onReorder: async (applied) => {
      applied.forEach(({ id, qty }) => {
        state.entries[id] = { ...(state.entries[id] || { stock: 0 }), qty };
      });
      await saveDraftNow(state.entries, state.days);
      syncInputsFromState();
      render();   // redraws the banner too — see the note at the top of render()
    },
  };

  renderDeliveries(document.getElementById('deliveries-list'), ctx);
  renderOwedBanner(document.getElementById('orders-owed'), ctx);
  renderReorderBanner(document.getElementById('orders-reorder'), ctx);
}

function renderHistory() {
  renderHistoryView(
    document.getElementById('history-list'),
    state.history,
    state.suppliers,
    // Resolved, so the one legacy weekly record groups an orphaned item under
    // "No supplier" rather than "Unknown supplier". Names are unaffected either way.
    orderIngredients(),
    { onEdit: openHistoryEditor, onSend: sendRecord, onSendDay: openSendDayScreen },
    // Only what is SHOWN is narrowed. state.history stays whole, so the suggestion
    // engine (which needs 4+ past orders of an ingredient) is untouched by this.
    { historyDays: ordersConfig.historyDays },
  );
}

// ── Sending an order that is already recorded ─────────────────────────────────
//
// Recording an order clears its rows from the draft, so from that moment the only
// place the message can be built from is the archive. That is why sending lives here
// too and not only before placing: "placed" and "sent" are two different things, and
// the app should not force one order on them.

// A stored record → the picker/message row shape. Names and weights are resolved from
// the CURRENT ingredient list, the same lens the History view uses on screen.
function recordToRow(record) {
  return {
    id: record.id,
    name: record.supplierName || 'Order',
    items: itemsFromQuantities(record.quantities, indexById(state.ingredients), record.names),
  };
}

// ── The message format ────────────────────────────────────────────────────────
//
// Every send screen opens on "By supplier" (Federico, 30 Jul 2026). The choice is NOT
// remembered: "One list" is a shopping list for yourself and does not say who sells
// what, so a supplier must never receive it because of something chosen days earlier.
// Picking it is per send, deliberately.
//
// The one send that has no screen — re-sending a single recorded order from History —
// is therefore always By supplier, which is the format a supplier should get anyway.
const GROUPED_BY_DEFAULT = true;

// The option handed to any screen that offers the choice. No onChange: nothing to
// store, the picker hands the chosen value straight to onConfirm.
function messageFormatOption() {
  return { grouped: GROUPED_BY_DEFAULT };
}

function sendMessageFor(rows, { grouped = GROUPED_BY_DEFAULT } = {}) {
  const text = buildOrderMessage(
    rows.map(r => ({ supplierName: r.name, items: r.items })),
    { grouped, locationName: currentSession().name });
  if (!text) {
    setStatus(t('orders.nothingToSendThat'), 'warn', 4000);
    return;
  }
  window.open(whatsappUrl(text), '_blank');
}

// One recorded order, straight out — no tick-list to wade through for a single card,
// and so no format chooser either: it goes out By supplier.
function sendRecord(record) {
  sendMessageFor([recordToRow(record)]);
}

// A whole day: the same tick-list as everywhere else, so a day of five orders can go
// out as one message or as the three you actually still need to send.
function openSendDayScreen(date, records) {
  const rows = records.map(recordToRow).filter(r => r.items.length);
  const overlay = buildSupplierPicker(rows, {
    title: t('orders.sendDay', { day: daySpoken(date) }),
    actionLabel: t('orders.sendOnWhatsapp'),
    emptyText: t('orders.nothingToSendFor'),
    format: messageFormatOption(),
    preselect: false,           // same reason as the draft send
  }, {
    onBack: () => overlay.remove(),
    onConfirm: (selected, { grouped }) => { overlay.remove(); sendMessageFor(selected, { grouped }); },
  });
  document.body.appendChild(overlay);
}

// ── Correcting a recorded order ───────────────────────────────────────────────
function openHistoryEditor(record) {
  const overlay = buildHistoryEditor(record, state.ingredients, {
    onClose: () => overlay.remove(),
    onSave: async (id, next) => {
      try {
        await saveHistoryRecord(id, next);
        overlay.remove();
        setStatus(t('orders.orderUpdated'), 'ok', 4000);
      } catch (err) {
        console.error('Updating the order failed:', err);
        setStatus(t('orders.couldNotUpdateThe'), 'error');
      }
    },
    onDelete: async id => {
      try {
        await deleteHistoryRecord(id);
        overlay.remove();
        setStatus(t('orders.orderDeleted'), 'warn', 4000);
      } catch (err) {
        console.error('Deleting the order failed:', err);
        setStatus(t('orders.couldNotDeleteThe'), 'error');
      }
    },
  });
  document.body.appendChild(overlay);
}

function showAlerts() {
  renderAlerts(document.getElementById('orders-alerts'), state.suppliers);
}

// ── Send order (WhatsApp selection screen) ────────────────────────────────────
function openSendScreen() {
  const overlay = buildSendScreen(orderSupplierList(), ingredientsBySupplier(), state.entries, {
    // ⚠️ THE ROLE COMES FROM THE SESSION, NOT FROM THE SETTINGS. A manager or owner
    // keeps all four roads whatever the switches say: if the switches applied to
    // everybody, closing WhatsApp to hold an employee back would disarm the very
    // person who then has to reach the supplier, and the order could never leave
    // the building. The database enforces who may CHANGE the switches; this only
    // decides what to draw.
    sendSettings: ordersConfig.sendSettings,
    canManage: canManageHere(),
    onBack: () => overlay.remove(),
    onSent: supplierIds => {
      overlay.remove();
      offerToRecordSent(supplierIds);
    },
    // The same ticked suppliers, sent inside the app instead of to a chat.
    onSendToManager: supplierIds => {
      overlay.remove();
      sendListToManagers(supplierIds);
    },
  }, messageFormatOption());
  document.body.appendChild(overlay);
}

// ── Sending the list to whoever runs the place ────────────────────────────────

// Freeze what was ticked and write it. Everything that decides WHAT is frozen is
// in order-request-model.js; this is the trip to Firestore around it.
//
// ⚠️ THE DRAFT IS NOT CLEARED, ON PURPOSE (Federico's choice, 14 Aug 2026). The
// list is a photograph and the shared order carries on as it was, so nobody loses
// typing and the ordinary "Order placed" flow still works untouched. The price is
// that the two can drift apart — which is why the receiving screen says, line by
// line, where they now differ.
async function sendListToManagers(supplierIds) {
  const suppliers = supplierIds.map(findOrderSupplier).filter(Boolean);
  if (!suppliers.length) {
    setStatus(t('orders.nothingLeftToRecord'), 'warn', 5000);
    return;
  }

  const { user } = currentSession();

  // ⚠️⚠️ THE WARNING THAT MAKES THE HOLIDAY SWITCH SAFE. If everybody who runs
  // the place is away, this list reaches NOBODY — and the sender, who used to
  // know their order had gone because they sent it themselves, would be told
  // "sent" and nothing else. Asked BEFORE the write, so it is a decision rather
  // than a discovery a week later.
  //
  // ⚠️ It never BLOCKS the send: the list still belongs in the app, where the
  // banner and the badge keep showing it. It only refuses to be silent about it.
  if (!await confirmIfNobodyIsListening(user?.uid)) return;

  setStatus(t('orders.request.sending'), null);
  // The sender's own name, so the list arrives from a person rather than a uid.
  // It must never be able to stop the send — see getOwnMemberRow.
  const member = await getOwnMemberRow();
  const payload = buildOrderRequest({
    suppliers,
    ingredients: orderIngredients(),
    entries: state.entries,
    date: todayISO(),
    from: { uid: user?.uid || '', name: senderName(member, user?.email) },
  });

  if (!payload) {
    setStatus(t('orders.nothingLeftToRecord'), 'warn', 5000);
    return;
  }

  try {
    await sendOrderRequest(payload);
    // ⚠️ IT SAYS WHO WILL BE TOLD. The whole risk of this feature is a list that
    // reaches nobody: the sender used to know their order had gone because they
    // sent it themselves, and now they do not.
    setStatus(`${t('orders.request.sent')} — ${t('orders.request.sentToManagers')}`, 'ok', 6000);
  } catch (err) {
    console.error('Sending the order list failed:', err);
    setStatus(t('orders.request.sendFailed'), 'error');
  }
}

// Would anybody actually hear this list? Returns true to go ahead.
//
// ⚠️ EVERY FAILURE HERE MEANS "GO AHEAD SILENTLY". An unreadable roster, a
// refused read, a venue that has never filled one in — none of them is evidence
// that nobody is listening, and a warning that fires on no evidence is one people
// learn to tap through, taking the real one with it.
async function confirmIfNobodyIsListening(senderUid) {
  let roster = [];
  let away = new Set();
  try {
    const [people, holidays] = await Promise.all([getRosterOnce(), getAwayDaysOnce()]);
    roster = people;
    away = awayUids(holidays.map(h => ({ ...h, uid: h.uid || h.id })));
  } catch (err) {
    console.warn('Could not check who is listening; sending anyway:', err);
    return true;
  }

  if (!nobodyWillBeTold(roster, away, senderUid)) return true;

  // The model hands back '' for somebody with no name at all (it has no
  // dictionary — see away-model.js); the word belongs here.
  const names = awayNames(roster, away, senderUid)
    .map(n => n || t('orders.request.someone'));
  return confirmDialog({
    title: t('away.nobodyTitle'),
    // ⚠️ `n` IS THE COUNT, so the verb agrees. "Federico, Giulia is away" was on
    // the screen — two people and a singular verb — and no measurement would ever
    // have reported it. Intl decides the form; nothing here counts.
    message: names.length
      ? t('away.nobodyMessage', { names: names.join(', '), n: names.length })
      : t('away.nobodyMessagePlain'),
    okLabel: t('away.sendAnyway'),
    cancelLabel: t('ui.cancel'),
  });
}

// ── The lists somebody sent ───────────────────────────────────────────────────

function openRequestList() {
  resetRequestWindow();
  renderRequestList();
}

// ⚠️⚠️ IT REPLACES IN PLACE, IT DOES NOT REMOVE AND RE-APPEND — and that one word
// is the difference between working and unusable. Both screens are .req-overlay
// at the same z-index, so DOM ORDER decides which is in front. Re-appending the
// list put it back at the END of <body>, i.e. ON TOP of the open list somebody
// was ticking — so every tick threw the manager back to the list of lists, and so
// did a colleague ticking anything from their own phone.
//
// Found by driving the app: three checks went red reporting an empty screen, and
// the screen was not empty at all — it was the wrong one, in front.
function renderRequestList() {
  const next = buildRequestListScreen(state.requests, {
    onBack: closeRequestList,
    onOpen: id => { openRequestId = id; renderOpenRequest(); },
    onRepaint: renderRequestList,
  });
  if (requestListView) requestListView.replaceWith(next);
  else document.body.appendChild(next);
  requestListView = next;
}

function closeRequestList() {
  requestListView?.remove();
  requestListView = null;
}

function findRequest(id) {
  return state.requests.find(r => r.id === id) || null;
}

// ⚠️ REBUILT FROM state ON EVERY SNAPSHOT, never patched in place. Two people can
// be working the same list at once, and a screen that only redrew the row somebody
// tapped here would quietly disagree with the database about every other row.
// What today's records hold for every supplier this list names, flattened to one
// map the screen can look a row up in.
//
// ⚠️ THE LIST'S OWN DAY, not today. A list opened tomorrow must still be read
// against the orders that answered it, or it would quietly report that nothing was
// ever bought.
//
// ⚠️ AND THE DAY'S TOTAL, because a second order to the same supplier is MERGED into
// the same record (archive.js mergeArchives). "How much was bought" is the honest
// answer to what the row is asking.
function orderedForRequest(request) {
  const out = {};
  supplierIdsOf(request).forEach(supplierId => {
    Object.assign(out, orderedToday(state.history, supplierId, request.date));
  });
  return out;
}

function renderOpenRequest() {
  if (!openRequestId) { requestView?.remove(); requestView = null; return; }
  const request = findRequest(openRequestId);
  if (!request) {
    // It was deleted, by somebody else or by this phone. Step back rather than
    // sitting on a screen describing a document that is gone.
    openRequestId = null;
    requestView?.remove();
    requestView = null;
    return;
  }

  const next = buildRequestScreen(request, {
    ingredientsById: indexById(orderIngredients()),
    entries: state.entries,
    // ⚠️ WHAT WAS ACTUALLY BOUGHT, beside what was asked for. The person who sent
    // the list can otherwise only find out by asking. The two documents are joined
    // by {day, supplier} rather than by a stored link: adding a `requestId` to a
    // history record would be REFUSED by firestore.rules as it stands (a closed key
    // list), and it can be deduced from fields both documents already carry.
    orderedById: orderedForRequest(request),
    canManage: currentSession().canManage === true,
  }, {
    onBack: () => { openRequestId = null; renderOpenRequest(); },
    onToggle: (ingredientId, done, box) => tickRequestItem(request.id, ingredientId, done, box),
    onFinish: left => finishRequest(request.id, left),
    onDelete: () => deleteRequest(request.id),
    onPlaced: supplierId => placeOrder(supplierId),
  });

  if (requestView) requestView.replaceWith(next); else document.body.appendChild(next);
  requestView = next;
}

// ⚠️ THE TICK IS PUT BACK IF THE WRITE FAILS. A checkbox that stays ticked after a
// refused write is the worst possible outcome here: it says "bought" about
// something nobody bought, and the next snapshot would silently correct it long
// after the person stopped looking.
async function tickRequestItem(id, ingredientId, done, box) {
  try {
    await setOrderRequestDone(id, ingredientId, done);
  } catch (err) {
    console.error('Saving the tick failed:', err);
    if (box) box.checked = !done;
    setStatus(t('orders.request.tickFailed'), 'error');
  }
}

async function finishRequest(id, left) {
  const request = findRequest(id);
  if (!request) return;
  if (!await confirmFinish(left)) return;
  try {
    await finishOrderRequest(id, remainingIds(request));
  } catch (err) {
    console.error('Finishing the list failed:', err);
    setStatus(t('orders.request.tickFailed'), 'error');
  }
}

async function deleteRequest(id) {
  if (!await confirmDeleteRequest()) return;
  try {
    await deleteOrderRequest(id);
    openRequestId = null;
    renderOpenRequest();
  } catch (err) {
    console.error('Deleting the list failed:', err);
    setStatus(t('orders.request.deleteFailed'), 'error');
  }
}

// The one door to the order lists, at the foot of the screen.
//
// ⚠️⚠️ AND IT IS SHOWN TO EVERYBODY SINCE 24 Aug 2026, which had to change in the same
// breath as removing the green banner that used to sit at the top. That banner carried
// no role gate, so it was the ONLY sight an ordinary employee had of the lists —
// removing it while this card stayed manager-only would have left the very people who
// SEND a list with no way of ever seeing one. The rules already let anybody in the
// venue read them; hiding this was only ever hiding the door, never the room.
//
// ⚠️ WHITE UNTIL SOMETHING ARRIVES, THEN COLOURED, and that is the half that does the
// work. v1.31.1 was the tap that finished the last list removing the only entrance —
// so this is always here, whether or not anything is waiting. Federico asked for it
// SMALLER on 24 Aug; smaller is a size, not a disappearance.
function renderRequestCard() {
  const host = document.getElementById('requests-card-host');
  if (!host) return;
  host.textContent = '';
  host.hidden = false;

  const waiting = waitingRequests(state.requests).length;
  host.appendChild(el('button', {
    type: 'button',
    class: `requests-card${waiting ? ' requests-card--waiting' : ''}`,
    onClick: openRequestList,
  }, [
    el('span', { class: 'requests-card-icon', 'aria-hidden': 'true',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4"/></svg>' }),
    el('span', { class: 'requests-card-text' }, [
      el('span', { class: 'requests-card-name', text: t('orders.request.open') }),
      el('span', { class: 'requests-card-sub',
        text: waiting ? t('orders.request.waiting', { n: waiting }) : t('orders.request.none') }),
    ]),
  ]));
}

// "A", "A and B", "A, B and C".
//
// ⚠️ THE JOINER IS A WORD, and it was ' and ' written into the code here. The one
// copy now lives in js/i18n.js beside the dictionary, because the Calculator needs
// the same grammar and a feature may not import from another feature's folder.
const listNames = joinList;

// Sending is the moment the order actually leaves, so it is the moment to ask —
// forgetting to tap "Order placed" afterwards is exactly what left orders
// unrecorded. Only the suppliers that were actually ticked and sent are offered.
function offerToRecordSent(supplierIds) {
  return recordSuppliers(supplierIds, {
    title: t('orders.orderSent'),
    okLabel: t('orders.markAsPlaced'),
  });
}

// Record several suppliers' orders behind ONE confirmation screen. Shared by the
// prompt that follows a send and by the "Order placed" screen, so both show the
// same rows, both allow the same corrections, and both add to an existing same-day
// record the same way.
async function recordSuppliers(supplierIds, { title, okLabel }) {
  const ingredients = orderIngredients();
  const suppliers = supplierIds
    .map(findOrderSupplier)
    .filter(s => s && supplierHasItems(s.id, ingredients, state.entries));

  // Everything selected has since lost its rows — another device placed the order,
  // or the ingredients were deactivated. Say so: returning in silence looks exactly
  // like the app ignoring the tap, which is what it used to do here.
  if (!suppliers.length) {
    setStatus(t('orders.nothingLeftToRecord'), 'warn', 5000);
    return;
  }

  // ⚠️ THE SAME SCREEN AS ONE SUPPLIER, LISTED BY SUPPLIER. Two roads to recording
  // an order are two places the rule can drift apart, and the rule here is the
  // whole point: what gets recorded is what the person tapping confirms.
  const confirmed = await openPlaceConfirm(
    suppliers.map(supplier => ({ supplier, date: dayForSupplier(supplier.id) })),
    { title, okLabel },
  );
  if (!confirmed) return;

  // Sequentially: each archive writes and then clears its own rows, and the draft
  // is one shared document — overlapping writes would race on it.
  const saved = [];
  const failed = [];
  const skipped = [];
  for (const supplier of suppliers) {
    // Every one of this supplier's rows was set to 0 on the confirmation screen:
    // that is "not this one", not a failure. Recording it would write an empty
    // order, which archive.js refuses anyway — but silently, and a silent skip is
    // indistinguishable from a bug.
    const quantities = confirmed[supplier.id];
    if (!quantities || !Object.keys(quantities).length) {
      skipped.push(supplier.name);
      continue;
    }
    const done = await placeOrder(supplier.id, { confirm: false, quantities });
    (done ? saved : failed).push(supplier.name);
  }

  // A failure must never be buried under a success. placeOrder reports its own
  // error, but the summary below used to overwrite it with a green line naming only
  // the ones that worked — so a supplier that failed vanished from view while its
  // rows sat there untouched. With several suppliers at once that is far more likely,
  // so the summary now leads with what went wrong.
  if (failed.length) {
    setStatus(
      `${t('orders.notRecordedRowsStillThere', { names: listNames(failed) })} ` +
      (saved.length ? t('orders.andSaved', { names: listNames(saved) }) : t('orders.tryAgain')),
      'error',
    );
    return;
  }
  if (skipped.length && !saved.length) {
    setStatus(t('orders.confirm.noneRecorded', { names: listNames(skipped) }), 'warn', 5000);
    return;
  }
  if (saved.length) setStatus(t('orders.orderSavedToHistory', { names: listNames(saved) }), 'ok', 5000);
}

// ── Order placed for several suppliers at once ────────────────────────────────

// Every supplier that currently has something to order, as picker rows.
function suppliersWithItems() {
  const bySupplier = ingredientsBySupplier();
  return orderSupplierList()
    .map(supplier => ({
      id: supplier.id,
      name: supplier.name,
      items: (bySupplier[supplier.id] || []).filter(i => (state.entries[i.id]?.qty || 0) > 0),
    }))
    .filter(row => row.items.length);
}

// The same tick-list as the WhatsApp send, so recording several orders is reviewed
// rather than blind.
//
// The single global "Order placed" was deliberately REMOVED in v1.9.0 because it
// archived everything into one record and wiped the whole draft, destroying the
// quantities already typed for a supplier ordered later in the week. This is not that
// button: each supplier still gets its own {day}_{supplier} record, and the ticks
// exist so a half-typed Thursday order can be left out of a Monday run.
function openPlaceAllScreen() {
  const overlay = buildSupplierPicker(suppliersWithItems(), {
    title: t('orders.orderPlaced'),
    actionLabel: t('orders.orderPlaced'),
    emptyText: t('orders.noQuantitiesTypedYet'),
  }, {
    onBack: () => overlay.remove(),
    onConfirm: rows => {
      overlay.remove();
      recordSuppliers(rows.map(r => r.id), {
        title: t('orders.recordTheseOrders'),
        okLabel: t('orders.orderPlaced'),
      });
    },
  });
  document.body.appendChild(overlay);
}

// In the by-supplier view this button only earns its place from TWO suppliers up:
// with one, the "Order placed" button on its own card is right there and a second
// control for the same job is noise. In the flat list there are no cards and no
// per-supplier buttons, so it is the ONLY way to record an order — one supplier
// with quantities is enough.
function refreshPlaceAllButton() {
  const btn = document.getElementById('place-all-btn');
  if (!btn) return;
  const minimum = state.view === 'all' ? 1 : 2;
  btn.hidden = suppliersWithItems().length < minimum;
}

// ── Order placed (one supplier at a time) ─────────────────────────────────────

// The day a supplier's rows belong to: the day they were typed. Falls back to the
// draft's own timestamp for rows written before the app recorded that, and to
// today when there is nothing at all to go on.
function dayForSupplier(supplierId) {
  return state.days[supplierId] || localDayOf(state.draftUpdatedAt) || todayISO();
}

// Drop a supplier's rows from the in-memory draft immediately, so the screen
// clears without waiting for the write to come back (and so a debounced save
// already in flight cannot resurrect them).
function forgetSupplierLocally(supplierId) {
  ingredientsOf(supplierId, orderIngredients(), { activeOnly: false })
    .forEach(ing => { delete state.entries[ing.id]; });
  delete state.days[supplierId];
}

// Record one supplier's order. Returns true when it was written.
//
// `confirm: false` is used right after a WhatsApp send, where the operator has
// just answered the same question for every supplier that was sent.
// `date` PINS the day. The unfinished-order banner passes the day it is showing,
// because state.days[supplierId] is restamped to today by any keystroke on that
// supplier's rows — so reading it here would file a "Placed yesterday" order under
// TODAY, which is precisely the mistake this whole feature exists to prevent.
async function placeOrder(supplierId, { confirm = true, date: pinnedDate, quantities = null } = {}) {
  const supplier = findOrderSupplier(supplierId);
  if (!supplier) return false;
  const ingredients = orderIngredients();

  // An order takes a second to write. Without this, a second tap in that second
  // passes every check, archives the same rows again, and mergeArchives — which
  // ADDS by design — doubles the quantities.
  if (placing.has(supplierId)) return false;

  if (!supplierHasItems(supplierId, ingredients, state.entries)) {
    setStatus(t('orders.nothingToRecordFor'), 'warn', 4000);
    return false;
  }
  // Firestore has no offline persistence here, so the write would simply never
  // resolve and the tap would hang. Say so instead.
  if (!navigator.onLine) {
    setStatus(t('orders.youReOfflineReconnect'), 'error', 6000);
    return false;
  }

  const date = pinnedDate || dayForSupplier(supplierId);

  // ⚠️⚠️ WHAT IS RECORDED IS WHAT WAS CONFIRMED, NOT WHAT THE SHARED ORDER SAYS
  // NOW. The order is live on every phone in the building, so between reading it
  // and tapping this button somebody else can have changed a number. Federico's
  // rule, 24 Aug 2026: the order is what the person who places it confirms.
  //
  // `quantities` arrives either from the confirmation screen below or from
  // recordSuppliers, which shows the same screen once for several suppliers. It is
  // null only for the paths that deliberately do not ask (the unfinished-order
  // banner answering "placed yesterday" about an order that already went out).
  let confirmed = quantities;
  if (confirm) {
    confirmed = await askToConfirmPlacement(supplier, date);
    if (!confirmed) return false;
  }
  if (placing.has(supplierId)) return false; // the screen was open a while — re-check

  placing.add(supplierId);
  disablePlaceButton(supplierId);

  try {
    // Any keystroke from the last 800ms is still sitting in the debounce timer —
    // possibly for ANOTHER supplier. Write it before the surgical clear, or it is
    // lost when the next snapshot arrives.
    await flushDraftSave();
    await archiveSupplier({
      supplier, ingredients, entries: entriesToRecord(supplierId, ingredients, confirmed), date,
    });
  } catch (err) {
    console.error('Archiving order failed:', err);
    setStatus(t('orders.couldNotSaveThe'), 'error');
    placing.delete(supplierId);
    refreshAllSuppliers();          // restore the button to whatever the rows say
    return false;
  }

  // PAST THE POINT OF NO RETURN: the order IS in History now. Everything below is
  // tidying up, and none of it may ever report "could not save" — the operator
  // would retry, and the retry would ADD the same items to the record all over
  // again (mergeArchives adds by design).
  //
  // Forget the rows LOCALLY first: a keystroke during the archive above may have
  // queued a draft save, and that save holds state.entries BY REFERENCE. Dropping
  // the keys before it fires is what stops it writing them back after the clear.
  forgetSupplierLocally(supplierId);
  // Recorded, so there is nothing left on that supplier's screen — back to the list
  // (P20: a successful save returns you to where you came from).
  if (state.openSupplier === supplierId) closeSupplier();
  syncInputsFromState();            // also re-derives every button's enabled state
  renderReminders();

  try {
    await clearSupplier(supplierId, ingredients);
    setStatus(t('orders.orderSavedToHistory', { names: supplier.name }), 'ok', 5000);
  } catch (err) {
    console.error('Clearing the draft after archiving failed:', err);
    setStatus(
      t('orders.savedButNotCleared', { name: supplier.name }),
      'warn',
    );
  }
  placing.delete(supplierId);
  return true;
}

// ── Clearing what has been typed, WITHOUT recording an order ──────────────────
//
// "Start this order again". Everything here is about the two promises made on the
// confirmation: the STOCK readings stay, and nothing already recorded is touched.

// Drop the quantities from the in-memory draft first, keeping the readings, so the
// screen clears immediately — and so a debounced save already in flight cannot
// resurrect them: it holds state.entries BY REFERENCE, so removing the keys before
// it fires is what stops it writing them back. Same reasoning as
// forgetSupplierLocally above, which is why they sit together.
function forgetQuantitiesLocally(supplierIds) {
  const ingredients = orderIngredients();
  supplierIds.forEach(supplierId => {
    ingredientsOf(supplierId, ingredients, { activeOnly: false }).forEach(ing => {
      const entry = state.entries[ing.id];
      if (!entry) return;
      delete entry.qty;
      // Nothing ordered and nothing on the shelf is not a row at all — and it
      // matches what Firestore does when the last key of a map is deleted.
      if (!(Number(entry.stock) > 0)) delete state.entries[ing.id];
    });
    delete state.days[supplierId];
  });
}

function confirmClear(supplierIds) {
  const names = supplierIds.map(id => findOrderSupplier(id)?.name).filter(Boolean);
  const who = names.length === 1 ? names[0]
    : names.length <= 3 ? names.join(', ')
    : t('orders.nSuppliers', { n: names.length });

  return confirmDialog({
    title: t('orders.clearQuantities'),
    message: t('orders.clearConfirm', { who }),
    okLabel: t('ui.clear'),
    cancelLabel: t('ui.cancel'),
    danger: true,
  });
}

// ONE path for both entry points — the single supplier's screen and the tick-list —
// so the two can never end up behaving differently.
async function clearQuantitiesFor(supplierIds) {
  const ids = (supplierIds || []).filter(Boolean);
  if (!ids.length) return false;

  // No offline persistence: the write would never resolve and the tap would hang.
  if (!navigator.onLine) {
    setStatus(t('orders.youReOfflineReconnect2'), 'error', 6000);
    return false;
  }
  if (!await confirmClear(ids)) return false;

  const ingredients = orderIngredients();
  // A keystroke from the last 800ms is still in the debounce timer — possibly for
  // another supplier. Write it before clearing, or it comes back on the next snapshot.
  try {
    await flushDraftSave();
  } catch (err) {
    console.error('Flushing the draft before clearing failed:', err);
  }

  forgetQuantitiesLocally(ids);
  if (state.openSupplier && ids.includes(state.openSupplier)) closeSupplier();
  syncInputsFromState();
  renderReminders();

  try {
    await clearQuantities(ids, ingredients);
    setStatus(ids.length === 1
      ? t('orders.quantitiesCleared')
      : t('orders.quantitiesClearedFor', { n: ids.length }), 'ok', 4000);
    return true;
  } catch (err) {
    console.error('Clearing quantities failed:', err);
    // The screen is already clear but the database is not, and no snapshot will
    // correct that (nothing changed remotely). Say so plainly rather than leaving
    // the two quietly disagreeing.
    setStatus(t('orders.couldNotClearThem'), 'error');
    return false;
  }
}

// The same tick-list as "Order placed…", so clearing several is reviewed rather
// than blind. Nothing is ticked to start with: this throws work away.
function openClearScreen() {
  const overlay = buildSupplierPicker(suppliersWithItems(), {
    title: t('orders.clearQuantities'),
    actionLabel: 'Clear',
    emptyText: t('orders.nothingTypedYet'),
    danger: true,
    preselect: false,
  }, {
    onBack: () => overlay.remove(),
    onConfirm: rows => {
      overlay.remove();
      clearQuantitiesFor(rows.map(r => r.id));
    },
  });
  document.body.appendChild(overlay);
}

// Unlike "Order placed…", this shows from ONE supplier up in both views: in the
// flat list there are no per-supplier cards, so without it there would be no way
// to clear a single supplier at all.
function refreshClearAllButton() {
  const btn = document.getElementById('clear-all-btn');
  if (!btn) return;
  btn.hidden = suppliersWithItems().length < 1;
}

// Grey the button out while its order is being written, so what the operator sees
// matches the guard above. Re-enabling is never done by hand: refreshAllSuppliers
// derives it from the rows, so a cleared supplier's button stays correctly dead.
function disablePlaceButton(supplierId) {
  const btn = document.getElementById(`place-btn-${supplierId}`);
  if (btn) btn.disabled = true;
}

// ── What is about to be recorded ─────────────────────────────────────────────

// The entries to hand the archive. The rule itself is pure and lives in
// js/orders/untold-changes.js, where it can be proved; this only supplies the
// supplier's slice, filtered by the SAME lens buildSupplierArchive uses.
//
// `confirmed` is null only for the paths that deliberately do not ask, and then
// the shared order is recorded as it stands — which is right: nobody was shown
// anything to disagree with.
function entriesToRecord(supplierId, ingredients, confirmed) {
  if (!confirmed) return state.entries;
  return confirmedEntries(state.entries, ingredientsOf(supplierId, ingredients), confirmed);
}

// The usual amount for a row whose quantity looks like a typing mistake, else
// null. ⚠️ THE SAME LENS THE ROW HINT USES (js/orders/ingredients.js), so the
// confirmation can never warn about a row that showed no warning.
function usualFor(id, qty) {
  const result = suggestFor(id, 0);
  return result?.active && isUnusualQuantity(qty, result.par) ? result.par : null;
}

// The confirmation screen, for one supplier or for several. Resolves to
// { [supplierId]: { [ingredientId]: qty } }, or null when it was backed out of.
function openPlaceConfirm(items, { title, okLabel }) {
  const ingredients = orderIngredients();
  const groups = items.map(({ supplier, date }) => {
    // What today's sent lists asked for, so whoever confirms can see where their
    // number differs from what they were asked for. `undefined` for a row no list
    // carried — which is not the same as a list asking for none of it.
    const asked = askedToday(state.requests, supplier.id, date);
    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      when: dayPhrase(date),
      already: state.history.some(h => h.id === historyDocId(date, supplier.id)),
      rows: ingredientsOf(supplier.id, ingredients)
        .map(ing => ({
          id: ing.id,
          name: ingredientLabel(ing),
          unit: ing.unit || '',
          qty: wholeNumber(state.entries[ing.id]?.qty),
          asked: asked[ing.id],
        }))
        .filter(row => row.qty > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  return new Promise(resolve => {
    const overlay = buildPlaceConfirm({ title, okLabel, groups, usualFor }, {
      onBack: () => { overlay.remove(); resolve(null); },
      onConfirm: result => { overlay.remove(); resolve(result); },
    });
    document.body.appendChild(overlay);
  });
}

// One supplier. Resolves to that supplier's confirmed quantities, or null.
async function askToConfirmPlacement(supplier, date) {
  const already = state.history.some(h => h.id === historyDocId(date, supplier.id));
  // ⚠️ THE HEADER DOES NOT NAME THE SUPPLIER, AND THAT WAS MEASURED. "Add to Brava
  // Fresh's order" wrapped to THREE lines at 320px — and the name is already on
  // screen, in the group heading, with the day beside it. A header that repeats what
  // the first line of the body says, and wraps to do it, costs a third of a small
  // phone for nothing.
  const result = await openPlaceConfirm([{ supplier, date }], {
    title: already ? t('orders.confirm.addTitle') : t('orders.orderPlaced'),
    okLabel: already ? t('orders.addToIt') : t('orders.orderPlaced'),
  });
  return result ? (result[supplier.id] || null) : null;
}

// The suggestion engine bound to the history currently in memory. ONE definition,
// shared by every row on every screen and by the unusual-quantity check, so the
// number a row shows and the number the confirmation quotes are the same number.
function suggestFor(id, stock) {
  return computeSuggestion(id, stock, state.history);
}

// ── Reminders (today's orders / an order left from an earlier day) ────────────

// One call site for both banners, invoked from every path that changes the draft,
// the history or the supplier list.
function renderReminders() {
  if (!state.loaded.suppliers) return;

  renderTodayOrders(
    document.getElementById('orders-today'),
    todayOrders({ suppliers: state.suppliers, history: state.history, today: todayISO() }),
    { onPick: expandSupplier },
  );

  renderPending(document.getElementById('orders-pending'), state.pending, {
    onPlaced: recordPending,
    onToday: keepAsToday,
    onDiscard: discardPending,
  });

  renderUntoldChanges();
}

// ⚠️⚠️ WHAT NOBODY HAS BEEN TOLD ABOUT. The shared order is live on every phone, and
// both the sent list and the recorded order are only photographs of it — so a
// quantity can sit here that neither the person who orders nor the supplier has ever
// seen. The rule is pure and lives in js/orders/untold-changes.js; this only asks it
// and hands the answer to the screen.
//
// ⚠️ IT NEEDS THE INGREDIENTS TOO. Without them every supplier looks empty and the
// answer would be a confident, permanent silence — the worst possible failure for
// this particular question.
function renderUntoldChanges() {
  const host = document.getElementById('orders-untold');
  if (!host) return;
  if (!state.loaded.suppliers || !state.loaded.ingredients) {
    host.hidden = true;
    return;
  }

  const canManage = canManageHere();
  renderUntold(
    host,
    untoldChanges({
      suppliers: orderSupplierList(),
      ingredients: orderIngredients(),
      entries: state.entries,
      requests: state.requests,
      history: state.history,
      today: todayISO(),
    }),
    {
      canManage,
      // ⚠️ A BUTTON THAT CANNOT WORK IS WORSE THAN NO BUTTON. An employee whose
      // venue has the "send to the manager" road switched off has nowhere to send
      // the list, so the offer would be a dead end.
      canResend: routesFor(ordersConfig.sendSettings, { canManage }).includes('manager'),
    },
    { onOpen: expandSupplier, onResend: openSendScreen },
  );
}

// Look for an order typed on an earlier day and never placed — ONCE per page
// load, and only once the draft, the suppliers and the ingredients have all
// arrived (any of them missing would make every supplier look empty).
//
// Latched on purpose: the draft listener fires on every keystroke, including
// another phone's, and recomputing would rebuild these buttons under the
// operator's finger — or bring the banner back after it had been answered.
function checkPendingOnce() {
  if (pendingChecked) return;
  if (!state.loaded.suppliers || !state.loaded.ingredients || !state.loaded.draft) return;
  pendingChecked = true;

  // The pseudo-supplier is included here on purpose: it never appears in "order
  // these today" (it has no order days), but "you typed this on Sunday and never
  // placed it" is a safety net and must catch everything.
  state.pending = pendingSuppliers({
    suppliers: orderSupplierList(),
    ingredients: orderIngredients(),
    entries: state.entries,
    days: state.days,
    fallbackDay: localDayOf(state.draftUpdatedAt),
    today: todayISO(),
  });
  renderReminders();
}

function dismissPending(supplierId) {
  state.pending = state.pending.filter(p => p.supplier.id !== supplierId);
  renderReminders();
}

// "Placed <day>" — it went out that day and the tap was forgotten.
//
// The day is the one the BANNER is showing, pinned when the unfinished order was
// found, and it is passed through explicitly. It must not be re-read from
// state.days here: touching any row of that supplier restamps that to today
// (hooks.afterChange), so the record would land under today while the button
// still said "Placed yesterday".
async function recordPending(supplierId, day) {
  const done = await placeOrder(supplierId, { date: day });
  if (done) dismissPending(supplierId);
}

// "It's today's" — it was never actually ordered. Keep the rows, restamp to today.
// The banner only goes away once the new stamp is actually saved: dismissing first
// and swallowing a failure would leave the draft still stamped with the old day and
// nothing on screen to say so.
async function keepAsToday(supplierId) {
  const previous = state.days[supplierId];
  state.days[supplierId] = todayISO();
  try {
    await saveDraftNow(state.entries, state.days);
    dismissPending(supplierId);
  } catch (err) {
    console.error('Restamping the draft failed:', err);
    if (previous) state.days[supplierId] = previous; else delete state.days[supplierId];
    setStatus(t('orders.couldNotUpdateThe2'), 'error');
  }
}

// "Discard" — not wanted at all. Destructive, so it goes behind a red confirm.
async function discardPending(supplierId) {
  const supplier = findOrderSupplier(supplierId);
  if (!supplier) return;

  const ok = await confirmDialog({
    title: t('orders.discardTitle', { name: supplier.name }),
    message: t('orders.discardConfirm', { name: supplier.name }),
    okLabel: t('ui.discard'),
    cancelLabel: t('ui.cancel'),
    danger: true,
  });
  if (!ok) return;

  try {
    await clearSupplier(supplierId, orderIngredients());
    forgetSupplierLocally(supplierId);
    syncInputsFromState();
    dismissPending(supplierId);
    setStatus(`${supplier.name} — order discarded`, 'warn', 4000);
  } catch (err) {
    console.error('Discarding the order failed:', err);
    setStatus(t('orders.couldNotDiscardThe'), 'error');
  }
}

// Tapping a supplier's name in the "order today" reminder: go straight into its
// order.
//
// The search and the "Ordering" filter are cleared first. Either of them could be
// hiding that supplier's row, and the operator would come back from the screen to a
// list that appears not to contain what they just opened.
function expandSupplier(supplierId) {
  setView('suppliers');
  state.supplierQuery = '';
  state.supplierFilter = false;
  dropListViews();              // remount so the cleared search is what is drawn
  render();
  openSupplier(supplierId);
}

// ── Management panel ──────────────────────────────────────────────────────────
function openManagement() {
  if (mgmt) return;
  // ⚠️ ONLY config/orders REACHES IT NOW. The supplier and ingredient records moved
  // to their own screen (suppliers.html), so this panel no longer needs — or gets —
  // either list.
  mgmt = buildManagement(
    {
      ordersConfig: () => ordersConfig,
    },
    {
      onClose: () => { mgmt.overlay.remove(); mgmt = null; },
      // ⚠️ HISTORY IS A DESTINATION, NOT A SETTING, and it is passed in rather than
      // reached for: management.js knows nothing about this page's markup, and the
      // overlay it opens sits at a higher z-index than the panel, so the panel stays
      // underneath and Back returns to it.
      //
      // ⚠️⚠️ IT IS AN ACTION, NOT DATA, AND THE FIRST VERSION PUT IT IN THE WRONG
      // OBJECT. buildManagement(data, actions) reads it as actions.openHistory, and
      // the panel skips the whole section when it is missing — so History simply was
      // not there, in silence, with every test green. Only opening the screen showed
      // it.
      openHistory: () => {
        const overlay = document.getElementById('history-overlay');
        if (overlay) overlay.hidden = false;
      },
      // Takes a PATCH, not one flag: config/orders now holds two settings and saveDoc
      // merges, so writing `{ showStock }` alone would leave historyDays untouched —
      // but only as long as every caller keeps passing just what it changed.
      saveOrdersConfig: patch => saveDoc(COLLECTIONS.config, 'orders', patch),
    },
  );
  document.body.appendChild(mgmt.overlay);
}

// ── Tabs / status ─────────────────────────────────────────────────────────────
function setupTabs() {
  // ⚠️ HISTORY IS NO LONGER A TAB. It opens from the bottom bar as a full-screen
  // screen of its own, so the tab bar holds only the two things looked at daily.
  const tabs = [
    { btn: 'tab-order-btn', panel: 'tab-order' },
    { btn: 'tab-deliveries-btn', panel: 'tab-deliveries' },
  ];
  tabs.forEach(({ btn, panel }) => {
    const button = document.getElementById(btn);
    if (!button) return;
    button.addEventListener('click', () => {
      tabs.forEach(t => {
        document.getElementById(t.btn)?.classList.toggle('active', t.btn === btn);
        document.getElementById(t.panel)?.classList.toggle('active', t.panel === panel);
      });
      // The switch belongs to the Order panel even though it now sits above both.
      refreshViewSwitch();
    });
  });
}

// The one wording for a failed draft autosave, named because it is both SET and
// CLEARED from different places and the two must match exactly.
// The KEY, not the phrase: this file is imported before a venue is open, so a t()
// here would freeze the sentence in the app's starting language. Resolved on use.
const DRAFT_SAVE_ERROR_KEY = 'orders.couldNotSaveThe2';

let statusTimer = null;
// Set the status line. With autoHideMs, the line hides itself after that delay,
// but ONLY if its text is still the same — so a later error / "order saved"
// message set in the meantime is never wiped.
function setStatus(text, kind, autoHideMs) {
  const elStatus = document.getElementById('orders-status');
  if (!elStatus) return;
  clearTimeout(statusTimer);
  elStatus.hidden = false;
  elStatus.textContent = text;
  elStatus.className = 'orders-status' + (kind ? ' ' + kind : '');
  if (autoHideMs) {
    statusTimer = setTimeout(() => {
      if (elStatus.textContent === text) elStatus.hidden = true;
    }, autoHideMs);
  }
}

// A live stream died. Say so, and say what stopped arriving.
//
// This screen is drawn entirely from Firestore listeners, so a refused or dropped
// stream leaves it looking EXACTLY like a location that simply has no suppliers —
// and onSnapshot never resubscribes after an error, so it stays wrong until the
// page is reloaded. That is why the message names the reload: it is the fix, not
// a suggestion. No auto-hide, for the same reason.
function liveDataLost(what) {
  return () => setStatus(
    t('orders.liveConnectionLost', { what }),
    'error',
  );
}

// Hide the status line, but ONLY if it still shows `text`. Same guard as the
// auto-hide above and for the same reason: whoever set a newer message — an error,
// or "order saved to history ✓" — must never have it wiped by a stale clear.
function clearStatusIf(text) {
  const elStatus = document.getElementById('orders-status');
  if (elStatus && elStatus.textContent === text) elStatus.hidden = true;
}

// Bottom bar shown ONLY while the device is offline. There is no
// "connecting/connected" message anymore: the page fills in when data streams in,
// and this is the single, quiet signal that there is no connection. Uses the
// browser's own network state (navigator.onLine + the online/offline events).
function setupOfflineIndicator() {
  const bar = document.getElementById('orders-offline');
  if (!bar) return;
  const sync = () => { bar.hidden = navigator.onLine; };
  sync();
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Before anything is drawn: the cached setting decides whether the Stock box is on
  // the rows at all, and applying it late would show a column then snatch it away.
  applyOrdersConfig(readCachedConfig());

  setupTabs();
  setupViewSwitch();
  document.getElementById('orders-wa-btn')?.addEventListener('click', openSendScreen);

  // The debounced draft autosave has no caller to hand a rejection to, so it reports
  // through here. Never auto-hidden on a timer: an order that is no longer being
  // saved is not a message the operator may miss. It clears only when a LATER
  // autosave succeeds — every save carries the whole entries map, so one success
  // really does persist what the failed write held, and a two-second network blip
  // must not leave a permanent alarm on screen.
  setDraftSaveReporter(ok => {
    if (ok) clearStatusIf(t(DRAFT_SAVE_ERROR_KEY));
    else setStatus(t(DRAFT_SAVE_ERROR_KEY), 'error');
  });

  document.getElementById('place-all-btn')?.addEventListener('click', openPlaceAllScreen);
  document.getElementById('clear-all-btn')?.addEventListener('click', openClearScreen);

  const settingsBtn = document.getElementById('settings-footer-btn');
  if (settingsBtn) {
    if (isAdmin) settingsBtn.addEventListener('click', openManagement);
    else settingsBtn.hidden = true;
  }

  // ⚠️ THE BAR IS DERIVED FROM ITS CHILDREN, never typed: no visible button, no bar.
  // The same rule, and the same three lines, as suppliers.html (registry-main.js).
  // It matters more now than it did with three buttons — the bar is one button wide,
  // so the day something hides it there is nothing left to look at.
  const footerEl = document.getElementById('orders-footer');
  if (footerEl) footerEl.hidden = ![...footerEl.children].some(child => !child.hidden);

  // ⚠️ HISTORY OPENS FROM INSIDE SETTINGS SINCE 24 Aug 2026 (Federico), not from the
  // bottom bar. It kept a third of a bar every day for a screen consulted rarely.
  //
  // ⚠️ SHOWN AND HIDDEN WITH THE `hidden` ATTRIBUTE, which tokens.css forces to
  // `display: none !important`. Without that !important a class on this element
  // would beat the attribute and the screen would be painted while every script
  // believed it was gone — the exact defect that shipped an empty green bar in
  // v190, and the reason the app-wide rule exists.
  document.getElementById('history-back-btn')?.addEventListener('click', () => {
    const overlay = document.getElementById('history-overlay');
    if (overlay) overlay.hidden = true;
  });

  setupOfflineIndicator();

  // No "connecting/connected" status: the data watchers below each await auth
  // internally, so they attach as soon as the (persisted) anonymous session is
  // ready and then stream live. init never blocks, so the page never sits waiting.

  // Refresh the official UK bank-holiday calendar (cached for offline; used by
  // the alerts). Fire-and-forget — failure falls back to the cached list.
  refreshBankHolidays().then(list => { console.log(`Bank holidays loaded: ${list.length} dates`); showAlerts(); });

  watchOrdersConfig();

  // Real-time draft: restores exact state on open and keeps staff in sync.
  watchDraft(draft => {
    setEntries(draft.entries);
    state.days = draft.days || {};
    state.draftUpdatedAt = draft.updatedAt;
    state.loaded.draft = true;
    syncInputsFromState();
    renderReminders();
    checkPendingOnce();
    // ⚠️ THE OPEN LIST DEPENDS ON THE SHARED ORDER, NOT ONLY ON ITSELF. Its
    // "now in the list: 6" marks are a comparison against these very entries, so
    // without this the warning appeared only if the LIST document happened to
    // change too — meaning the one case it exists for, somebody editing the
    // shared order while a manager reads the frozen numbers, showed nothing at
    // all. Found by driving the app; the model's own tests were green throughout,
    // because the comparison was right and nobody was asking it again.
    renderOpenRequest();
  }, liveDataLost('the order in progress'));

  watchCollection(COLLECTIONS.history, list => {
    applyHistory(list);
    renderReminders();
  }, liveDataLost('past orders'));

  // ⚠️ A BOUNDED query, not watchCollection: this collection grows for ever and
  // nothing in this app deletes by itself, so an unbounded listener would read
  // every list ever sent on every Orders open (P14). See watchOrderRequests.
  //
  // Both open screens are repainted from the snapshot, so a colleague ticking a
  // line off shows up here without a reload — which is the whole reason the ticks
  // are stored rather than held in the page.
  watchOrderRequests(list => {
    state.requests = list;
    renderRequestCard();
    // ⚠️ AND THE UNTOLD BANNER, because sending the list again is one of the two
    // things that answers it. Without this it would keep saying "you have added
    // something" for the rest of the day to somebody who had just sent it.
    renderUntoldChanges();
    // ⚠️ renderRequestList, NOT openRequestList: the latter resets the "show
    // older" choice, so a snapshot arriving while somebody was looking at the
    // older lists would fold them away under their thumb.
    if (requestListView) renderRequestList();
    renderOpenRequest();
  }, liveDataLost('the order lists'));

  // Suppliers and ingredients stay unbounded: they are a handful of documents and
  // every one of them is needed to draw the screen. Only history grows without end.
  watchCollection(COLLECTIONS.suppliers, list => {
    state.suppliers = list;
    state.loaded.suppliers = true;
    render();
    renderHistory();
    // ⚠️ REDRAWN HERE TOO, AND THE FIRST DRIVEN RUN IS WHY. Incoming was painted
    // only when history arrived; suppliers land in a SEPARATE snapshot, so on a
    // cold open every order read "no delivery days set for this supplier" — for
    // suppliers that had them — and stayed wrong until something else forced a
    // repaint. Two live collections feed one screen, so both must redraw it. Same
    // shape as the recipe cost that computed once and said "no cost yet" (v247).
    renderIncoming();
    showAlerts();
    renderReminders();
    checkPendingOnce();
  }, liveDataLost('suppliers'));
  // ⚠️ THE PRICES ARE A SECOND COLLECTION AND ARRIVE SEPARATELY. They moved off
  // the ingredient document because Orders reads every ingredient to work at all,
  // so a rate written there is a rate everybody can read (js/price-model.js).
  // Merged in here so the management form still opens on the price it is meant to
  // edit; an employee is refused that collection and simply sees no price, which
  // is the same thing they see for an ingredient nobody has priced.
  watchIngredientPrices(map => {
    state.ingredientPrices = map;
    if (state.loaded.ingredients) {
      state.ingredients = withPrices(state.rawIngredients, map);
    }
  });
  watchCollection(COLLECTIONS.ingredients, list => {
    state.rawIngredients = list;
    state.ingredients = withPrices(list, state.ingredientPrices);
    state.loaded.ingredients = true;
    render();
    renderHistory();
    renderReminders();
    checkPendingOnce();
  }, liveDataLost('ingredients'));
}

init();
