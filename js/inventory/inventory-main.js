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
  flush, setSyncErrorHandler,
} from './inventory-store.js';
import { renderList } from './inventory-list.js';
import { renderDetail } from './inventory-detail.js';
import {
  monthKey, previousMonth, nextMonth, isClosed, isMonthId, consumption,
} from './inventory-model.js';
import { confirmDialog } from './confirm-dialog.js';

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
  strip.hidden = view !== 'list';
}

function paintFooter() {
  const closed = readOnly();
  closeBtn.textContent = closed ? t('inv.reopenMonth') : t('inv.closeMonth');
  closeBtn.classList.toggle('inv-footer-btn-quiet', closed);
  footer.hidden = view !== 'list';
}

function showList() {
  view = 'list';
  activeDetail = null;
  setHeader({
    title: t('section.inventory'),
    sub: readOnly() ? t('inv.monthClosed') : t('inv.monthOpen'),
    back: false,
  });
  activeList = renderList({
    month: getMonth(),
    ingredients: getIngredients(),
    locale: localeTag(),
    readOnly: readOnly(),
    onOpen: openIngredient,
    onCount: (id, value) => { setCount('closing', id, value); },
    onCarry: handleCarry,
    onPurchases: handlePurchases,
  });
  swap(activeList.root);
  paintStrip();
  paintFooter();
}

function openIngredient(ingredient) {
  view = 'detail';
  activeList = null;
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
  });
  swap(activeDetail.root);
  paintStrip();
  paintFooter();
}

function goToMonth(id) {
  if (!isMonthId(id)) return;
  // A full reload rather than re-wiring the listeners by hand: the month is in the
  // URL, so this is the same path a reload takes, and there is exactly one way the
  // page can be in.
  flush().finally(() => { location.search = `?month=${id}`; });
}

async function handleCarry() {
  const previous = previousMonth(openMonthId);
  const ok = await confirmDialog({
    title: t('inv.carryTitle'),
    message: t('inv.carryMessage', { month: monthName(previous) }),
    okLabel: t('inv.carryOk'),
    cancelLabel: t('ui.cancel'),
  });
  if (!ok) return;
  const moved = await pullOpeningFromPrevious(previous);
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

  const countable = getIngredients().filter(i => i && i.active !== false && String(i.name || '').trim());
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

  const names = {};
  countable.forEach(i => {
    names[i.id] = [i.name, i.weight].filter(Boolean).join(' ').trim();
  });
  const opened = await closeMonth({ names, pricePerKg: {} });
  toast(opened ? t('inv.closedAndOpened', { month: monthName(opened) }) : t('inv.closed'));
  showList();
}

function handleBack() {
  if (view === 'detail') { showList(); return; }
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
    if (view === 'list' && activeList) {
      activeList.refresh(getMonth(), getIngredients());
      paintFooter();
    }
    if (view === 'detail' && activeDetail) activeDetail.refresh(getMonth());
  },
  () => toast(t('inv.liveSyncInterrupted')),
);

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
