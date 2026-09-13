// inventory-main.js — entry point / orchestrator for the monthly stocktake.
// Owns the view routing (list ↔ one product), the header, the month strip, the
// bottom bar, the shared confirm dialog and toast, and the live subscription.
//
// Feature-local only: it reads Orders' ingredients and their prices as Firestore
// COLLECTIONS, through its own data layer — js/inventory/ imports nothing from
// js/orders/ or js/foodcost/, only the shared, non-feature modules in js/ root.

import { t, localeTag, onLanguageChange } from '../i18n.js';
import {
  initInventory, getMonth, getMonthId, getIngredients, setCount, closeMonth,
  reopenMonth, pullOpeningFromPrevious, readProposedPurchases, applyPurchases,
  flush, flushBeforeLeaving, setSyncErrorHandler,
} from './inventory-store.js';
import { renderList } from './inventory-list.js';
import { renderDetail } from './inventory-detail.js';
import { renderUsage } from './inventory-usage.js';
import { monthCost, packKgFor, packPrice } from './inventory-value.js';
import {
  monthKey, previousMonth, nextMonth, isClosed, isMonthId, consumption,
  productsOfMonth,
} from './inventory-model.js';
import { confirmDialog } from './confirm-dialog.js';
import { sessionReady, currentSession } from '../firebase.js';

const screen = document.getElementById('invScreen');
const titleEl = document.getElementById('invTitle');
const subEl = document.getElementById('invSub');
const homeBtn = document.getElementById('invHome');
const backBtn = document.getElementById('invBack');
const strip = document.getElementById('invStrip');
const monthLabel = document.getElementById('invMonth');
const prevBtn = document.getElementById('invPrev');
const nextBtn = document.getElementById('invNext');
const footer = document.getElementById('invFooter');
const costBtn = document.getElementById('invCost');
const closeBtn = document.getElementById('invClose');

// ⚠️ THE MONTH ON SCREEN IS READ FROM THE URL, NOT KEPT IN A VARIABLE ALONE. A
// stocktake is done standing up, and a phone that locks and reloads must come
// back to the month that was being counted rather than to today's.
const params = new URLSearchParams(location.search);
const requested = params.get('month');
let openMonthId = isMonthId(requested) ? requested : monthKey();

let view = 'list';
let activeList = null;
let activeDetail = null;
// Which product the detail screen is showing, so it can be built again if the month
// turns out to be closed while it is open.
let activeIngredient = null;
// ⚠️ WHAT THE SCREEN WAS BUILT FOR. «Closed» is decided when a screen is built — it
// disables every box, hides the two fill-in actions and changes the note — and the
// month's own state arrives from Firestore AFTER the first paint. See the update
// callback at the bottom: when this answer changes, the screen is built again.
let builtClosed = false;
// ⚠️ WHO IS LOOKING. Since 13 Sep 2026 a venue may show this screen to its EMPLOYEES,
// who COUNT and see no money (Federico's choice): no value, no pack weight, no «what it
// cost», no closing or reopening, no carrying last month forward. FALSE until the
// session says otherwise, so nothing that is money is ever drawn before it is known —
// and firestore.rules refuses an employee all of it regardless (stocktakeMayRead/Write).
let mayManage = false;

function monthName(id) {
  const [year, month] = id.split('-').map(Number);
  const d = new Date(year, month - 1, 1, 12, 0, 0);
  // Intl names the month in the venue's own language; no month name is ever
  // written into this file or the dictionary.
  return d.toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' });
}

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

function readOnly() {
  return isClosed(getMonth());
}

function paintStrip() {
  monthLabel.textContent = monthName(openMonthId);
  // Nothing ahead of the current month: a month that has not happened has nothing
  // on its shelves to count.
  nextBtn.disabled = openMonthId >= monthKey();
  // The month arrows stay on the «cannot open this month» notice too: they are the
  // way to a month that can be.
  strip.hidden = view !== 'list' && view !== 'unavailable';
}

function paintFooter() {
  const closed = readOnly();
  closeBtn.textContent = closed ? t('inv.reopenMonth') : t('inv.closeMonth');
  closeBtn.classList.toggle('inv-footer-btn-quiet', closed);
  // Both buttons are money or the end of a month: neither is an employee's.
  costBtn.hidden = !mayManage;
  closeBtn.hidden = !mayManage;
  footer.hidden = view !== 'list' || !mayManage;
}

function showList() {
  view = 'list';
  activeDetail = null;
  activeIngredient = null;
  builtClosed = readOnly();
  setHeader({
    title: t('section.inventory'),
    sub: readOnly() ? t('inv.monthClosed') : t('inv.monthOpen'),
    back: false,
  });
  activeList = renderList({
    month: getMonth(),
    ingredients: products(),
    locale: localeTag(),
    readOnly: readOnly(),
    onOpen: openIngredient,
    onCount: (id, value) => { setCount('closing', id, value); },
    onCarry: mayManage ? handleCarry : null,
    onPurchases: handlePurchases,
  });
  swap(activeList.root);
  paintStrip();
  paintFooter();
}

function openIngredient(ingredient) {
  view = 'detail';
  activeList = null;
  activeIngredient = ingredient;
  builtClosed = readOnly();
  setHeader({
    title: [ingredient.name, ingredient.weight].filter(Boolean).join(' ') || t('inv.unnamedProduct'),
    sub: monthName(openMonthId),
    back: true,
  });
  activeDetail = renderDetail({
    month: getMonth(),
    ingredient,
    locale: localeTag(),
    readOnly: readOnly(),
    onCount: (map, id, value) => { setCount(map, id, value); },
    closed: readOnly(),
    money: mayManage,
  });
  swap(activeDetail.root);
  paintStrip();
  paintFooter();
}

// The rows this month is about — which, once it is closed, is what was frozen into
// it rather than what the venue sells today (js/inventory/inventory-model.js says
// why at length). The list, the progress figure, the close dialog and the cost
// screen all read it from here, so they cannot disagree.
function products() {
  return productsOfMonth(getMonth(), getIngredients());
}

// What the month cost. For an open month that is worked out from today's prices;
// for a closed one, only from what the close froze.
function costOfMonth() {
  return monthCost({
    month: getMonth(),
    ingredients: products(),
    consumptionOf: (ingredient) => consumption(getMonth(), ingredient.id).used,
    closed: readOnly(),
  });
}

function showUsage() {
  if (!mayManage) { showList(); return; }
  view = 'usage';
  activeList = null;
  activeDetail = null;
  activeIngredient = null;
  builtClosed = readOnly();
  setHeader({ title: t('inv.costTitle'), sub: monthName(openMonthId), back: true });
  const { root } = renderUsage({ cost: costOfMonth(), locale: localeTag(), month: getMonth() });
  swap(root);
  paintStrip();
  paintFooter();
}

function goToMonth(id) {
  if (!isMonthId(id)) return;
  // A full reload rather than re-wiring the listeners by hand: the month is in the
  // URL, so this is the same path a reload takes, and there is exactly one way the
  // page can be in.
  //
  // ⚠️ flushBeforeLeaving(), NEVER flush(). flush() answers when the write reaches
  // Firestore, which with no signal is never — so chaining the navigation onto it
  // made this arrow a dead button in a storeroom. Found by pressing it with the
  // network switched off, after the store's own waits had already been fixed.
  flushBeforeLeaving().finally(() => { location.search = `?month=${id}`; });
}

async function handleCarry() {
  if (!mayManage) return;
  const previous = previousMonth(openMonthId);
  const ok = await confirmDialog({
    title: t('inv.carryTitle'),
    message: t('inv.carryMessage', { month: monthName(previous) }),
    okLabel: t('inv.carryOk'),
    cancelLabel: t('ui.cancel'),
  });
  if (!ok) return;
  const moved = await pullOpeningFromPrevious(previous);
  // ⚠️ THREE ANSWERS, NOT TWO. "That month has nothing in it" and "I could not read
  // it" look the same on screen and mean opposite things — and this screen is used
  // where there is no signal, so the second is not a rare case.
  if (moved === null) { toast(t('inv.carryFailed')); return; }
  toast(moved ? t('inv.carriedOver', { n: moved }) : t('inv.nothingToCarry'));
}

// Fill in what was bought from the orders already recorded this month.
//
// ⚠️ THE DIALOG SAYS WHAT THIS CANNOT KNOW, and that sentence is the point of the
// whole feature being a PROPOSAL. The app records what was ORDERED; it knows what
// did not turn up only where somebody ticked it missing on the delivery. So a
// supplier who quietly short-delivers makes this number too high, and a too-high
// "bought" makes the consumption too high by exactly as much. Every row stays
// editable afterwards, which is the answer — but only if the person knows to look.
async function handlePurchases() {
  const found = await readProposedPurchases();
  if (found.failed) { toast(t('inv.purchasesFailed')); return; }
  if (!found.orders) { toast(t('inv.purchasesNone', { month: monthName(openMonthId) })); return; }

  // ⚠️ ONE COUNT IN THE SENTENCE, AND IT IS THE ONE THAT INFLECTS. A message
  // carrying two numbers cannot agree with both: the first version of this said
  // "2 orders covering 1 products", which is the kind of thing that makes an app
  // look machine-written. The sentence names the products it will fill in, and
  // says it replaces hand-typed figures without counting them — always true,
  // always grammatical.
  const ok = await confirmDialog({
    title: t('inv.purchasesTitle'),
    message: t('inv.purchasesMessage', { month: monthName(openMonthId), n: found.products }),
    okLabel: t('inv.purchasesOk'),
    cancelLabel: t('ui.cancel'),
  });
  if (!ok) return;
  const filled = applyPurchases(found.totals);
  toast(t('inv.purchasesFilled', { n: filled }));
}

// Freeze the month, and open the next one with these counts as its opening.
//
// ⚠️ WHAT IS FROZEN IS THE NAMES AND THE PRICES, not the counts. An ingredient
// deleted next spring must still be readable in the month it was counted in
// (the `names` trick orders-history already uses), and a price changed next
// spring must not restate what last September was worth.
async function handleClose() {
  if (!mayManage) return;
  if (readOnly()) {
    const ok = await confirmDialog({
      title: t('inv.reopenTitle'),
      message: t('inv.reopenMessage'),
      okLabel: t('inv.reopenOk'),
      cancelLabel: t('ui.cancel'),
    });
    if (!ok) return;
    await reopenMonth();
    showList();
    return;
  }

  const countable = products();
  const missing = countable.filter(i => !consumption(getMonth(), i.id).counted).length;

  const ok = await confirmDialog({
    title: t('inv.closeTitle'),
    message: missing
      ? t('inv.closeMessageMissing', { n: missing, month: monthName(openMonthId) })
      : t('inv.closeMessage', { month: monthName(openMonthId) }),
    okLabel: t('inv.closeOk'),
    cancelLabel: t('ui.cancel'),
  });
  if (!ok) return;

  // ⚠️ WHAT IS FROZEN IS EVERYTHING THE MONTH'S COST DEPENDS ON BUT DOES NOT OWN:
  // the label (so a product deleted next spring is still readable here), what one
  // unit cost, and how many kilos a pack held. Without the last two, reopening
  // this screen next year would recompute September at next year's prices and
  // quietly disagree with itself.
  const names = {};
  const unitPrice = {};
  const packKg = {};
  const openMonth = getMonth();
  countable.forEach(i => {
    names[i.id] = [i.name, i.weight].filter(Boolean).join(' ').trim();
    const price = packPrice(openMonth, i, false);
    if (price !== null) unitPrice[i.id] = price;
    const kg = packKgFor(openMonth, i, false);
    if (kg !== null) packKg[i.id] = kg;
  });
  const opened = await closeMonth({ names, unitPrice, packKg });
  toast(opened ? t('inv.closedAndOpened', { month: monthName(opened) }) : t('inv.closed'));
  showList();
}

// What an employee sees where a month cannot be read for them — which the rules decide:
// a closed month, or one still carrying frozen prices, is not theirs.
function showUnavailable() {
  view = 'unavailable';
  activeList = null;
  activeDetail = null;
  activeIngredient = null;
  setHeader({ title: t('section.inventory'), sub: monthName(openMonthId), back: false });
  const note = document.createElement('p');
  note.className = 'inv-note';
  note.textContent = t('inv.staffMonthUnavailable');
  const wrap = document.createElement('div');
  wrap.className = 'inv-view';
  wrap.appendChild(note);
  swap(wrap);
  paintStrip();
  paintFooter();
}

function handleBack() {
  if (view === 'detail' || view === 'usage') { showList(); return; }
  location.href = 'index.html';
}

function toast(msg) {
  const node = document.getElementById('invToast');
  node.textContent = msg;
  node.classList.add('show');
  clearTimeout(node._t);
  node._t = setTimeout(() => node.classList.remove('show'), 2600);
}

backBtn.addEventListener('click', handleBack);
costBtn.addEventListener('click', showUsage);
prevBtn.addEventListener('click', () => goToMonth(previousMonth(openMonthId)));
nextBtn.addEventListener('click', () => goToMonth(nextMonth(openMonthId)));
closeBtn.addEventListener('click', handleClose);
setSyncErrorHandler(msg => toast(msg));

// ⚠️ WHAT IS TYPED IS SENT BEFORE THE PAGE GOES AWAY. The save is debounced, so
// closing the app a moment after the last number would otherwise lose it — and it
// is the one number somebody walked across a storeroom for.
window.addEventListener('pagehide', () => { flush(); });

initInventory(
  openMonthId,
  () => {
    // The month arrived after all: whatever the notice said, the list is back.
    if (view === 'unavailable') { showList(); return; }
    // ⚠️⚠️ A MONTH'S OWN STATE ARRIVES AFTER THE FIRST PAINT, and until v1.79.0 the
    // screen never took it in: a CLOSED month was drawn as open — count boxes
    // somebody could type into, the two fill-in actions offered, the note saying an
    // empty box means "not counted yet" — while the footer button alone said
    // «Reopen». Typing there changed the figures of a month the screen promises no
    // longer change. Only the footer was repainted, because only the footer asked.
    // So when that answer changes, the screen is BUILT AGAIN, not merely refreshed.
    if (readOnly() !== builtClosed) {
      if (view === 'detail' && activeIngredient) openIngredient(activeIngredient);
      else if (view === 'usage') showUsage();
      else showList();
      return;
    }
    if (view === 'list' && activeList) {
      activeList.refresh(getMonth(), products());
      paintFooter();
    }
    if (view === 'detail' && activeDetail) activeDetail.refresh(getMonth());
  },
  // ⚠️ FOR AN EMPLOYEE A REFUSED MONTH IS THE ANSWER, NOT A HICCUP: the rules keep a
  // closed month from them, and «live sync interrupted» over an empty list would read
  // as a broken app. Asked after the session, because who is looking arrives with it.
  () => {
    sessionReady.then(() => {
      if (mayManage) toast(t('inv.liveSyncInterrupted'));
      else showUnavailable();
    });
  },
);

// ⚠️ WHO IS LOOKING ARRIVES WITH THE SESSION, after the first paint — and when it
// changes the answer, the screen is BUILT AGAIN, the same way a month's closed state is.
sessionReady.then(() => {
  const next = currentSession().canManage === true;
  if (next === mayManage) return;
  mayManage = next;
  if (view === 'detail' && activeIngredient) openIngredient(activeIngredient);
  else if (view === 'usage') showUsage();
  else if (view === 'list') showList();
});

// ⚠️ AND AGAIN WHEN THE LANGUAGE ARRIVES. This screen is built once, at load,
// while the venue's language arrives later with the session — without this the
// header translated and everything inside it stayed English.
// ⚠️ ONLY FROM THE LIST: redrawing while somebody is typing a count would take
// the cursor out of the box.
onLanguageChange(() => { if (view === 'list') showList(); });

// The id may have arrived from the URL; keep the two in step so a reload after a
// month change lands where the screen says it is.
openMonthId = getMonthId() || openMonthId;
showList();
