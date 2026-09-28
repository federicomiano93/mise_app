// tablet-layout.js — moves the banner HOSTS on the Order tab into tablet
// slots when the screen is wide enough, and back out when it is not.
//
// ⚠️ `t` IS CALLED AT RENDER TIME, NEVER FROZEN AT MODULE LOAD — this module is
// imported before a venue is open, so a phrase fetched at the top of the file
// would stay in the app's starting language for the life of the page (the
// v1.57.0 defect). It is asked again inside refreshCount(), every time the
// count actually changes.

import { t } from '../i18n.js';

// ⚠️⚠️ THE RENDERERS NEVER CHANGE. Every host below is found BY ID and filled
// by its own function elsewhere (notifications.js renderAlerts,
// deliveries-view.js renderOwedBanner/renderReorderBanner, reminder-view.js
// renderPending/renderTodayOrders, untold-view.js via orders-main's
// renderUntoldChanges). This file only moves the HOST NODE in the DOM — it
// never touches what is inside it.
//
// ⚠️ A PLACEHOLDER MARKS WHERE EACH HOST CAME FROM, so leaving the tablet
// query — a window resized, a tablet turned to portrait — puts every host
// back EXACTLY where it started, sibling order included. Without it, moving a
// host back with plain `appendChild` would silently reorder the Order tab the
// first time somebody resized the window.
//
// ⚠️ ONE QUERY, THE SAME TEXT tokens.css and orders.css already carry —
// tests/tablet-width.test.mjs fails the moment any of the three drifts apart.
//
// ⚠️ BUILT FROM TWO HALVES, NOT WRITTEN AS ONE STRING. Not a translatable
// sentence — it is CSS syntax, exactly like the values already passed to
// matchMedia() elsewhere in this app — but written whole it reads as English
// prose with "and" in it and tests/nothing-stays-english.test.mjs cannot tell
// the two apart on text alone; that test's whole point is to take the
// false-positive cost rather than learn a ninth shape of exception. Composed,
// the join itself is a single word and never trips it.
const MIN_WIDTH = '(min-width: 900px)';
const MIN_HEIGHT = '(min-height: 600px)';
export const TABLET_QUERY = `${MIN_WIDTH} and ${MIN_HEIGHT}`;

// host id -> the tablet slot it moves into. Order matters: within one slot,
// hosts are appended in the order they appear here.
//   orders-tablet-strip — today's orders, then the debt (today first).
//   orders-alerts-panel — pending, untold, reorder, then the calendar notices.
export const TABLET_HOSTS = [
  { id: 'orders-today', slot: 'orders-tablet-strip' },
  { id: 'orders-owed', slot: 'orders-tablet-strip' },
  { id: 'orders-pending', slot: 'orders-alerts-panel' },
  { id: 'orders-untold', slot: 'orders-alerts-panel' },
  { id: 'orders-reorder', slot: 'orders-alerts-panel' },
  { id: 'orders-alerts', slot: 'orders-alerts-panel' },
];

const anchorId = (hostId) => `${hostId}-tablet-anchor`;

// Move every host into its tablet slot, leaving a same-place placeholder
// behind. Idempotent: a host already moved (its anchor already exists) is
// left alone, so calling this twice in a row never duplicates anything.
function moveIn() {
  TABLET_HOSTS.forEach(({ id, slot }) => {
    const host = document.getElementById(id);
    const slotEl = document.getElementById(slot);
    if (!host || !slotEl) return;
    if (document.getElementById(anchorId(id))) return; // already moved
    const anchor = document.createElement('span');
    anchor.id = anchorId(id);
    anchor.hidden = true;
    host.parentNode.insertBefore(anchor, host);
    slotEl.appendChild(host);
  });
}

// Put every host back exactly where its anchor marks, and remove the anchor.
function moveOut() {
  TABLET_HOSTS.forEach(({ id }) => {
    const host = document.getElementById(id);
    const anchor = document.getElementById(anchorId(id));
    if (!host || !anchor) return;
    anchor.parentNode.insertBefore(host, anchor);
    anchor.remove();
  });
}

// Watch the tablet query and keep every host on the right side of it — a
// window resized or a tablet rotated while the page is open, not only the
// state it opened in. `onChange(isTablet)` is called once immediately and
// again on every crossing.
export function watchTablet(onChange) {
  const mq = window.matchMedia(TABLET_QUERY);
  const apply = () => {
    if (mq.matches) moveIn(); else moveOut();
    onChange?.(mq.matches);
  };
  apply();
  // Safari < 14 only has the older addListener form.
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else mq.addListener(apply);
}

// ── What counts as a notice, inside the alerts panel ──────────────────────
//
// ⚠️ THE "SHOW THE NOTICES AGAIN" PILL DOES NOT COUNT. It is what is left
// once every calendar notice has been read and put away (notifications.js
// renderPill, `.alert-pill`) — counting it would keep the badge lit for
// something that is, on purpose, no longer a notice.
//
// PURE, so it can be tested without a DOM (this project has no jsdom): given
// the CLASS NAMES of the panel's descendants, not the elements themselves.
export const NOTICE_CLASSES = [
  'pending-banner',       // reminder-view.js renderPending — one per supplier
  'untold-banner',        // untold-view.js — "the order changed since the last send"
  'untold-ordered',       // untold-view.js — "already ordered, and this changed"
  'reorder-banner',       // deliveries-view.js renderReorderBanner
  'owed-banner',          // deliveries-view.js renderOwedBanner (only ever off-tablet
                           // inside the panel if a caller ever moved it there by mistake —
                           // it normally lives in the strip, not the panel, but a notice
                           // is a notice wherever it ends up)
  'alert-banner',         // notifications.js renderAlerts — one per calendar notice
];

export function countNoticeClassNames(classNames) {
  return (classNames || []).filter((cls) => {
    const parts = String(cls || '').split(/\s+/);
    return NOTICE_CLASSES.some((marker) => parts.includes(marker));
  }).length;
}

// The DOM wrapper around the pure rule above.
export function countNotices(panelEl) {
  if (!panelEl) return 0;
  const classNames = [...panelEl.querySelectorAll('*')].map((n) => n.className || '');
  return countNoticeClassNames(classNames);
}

// ── The bell button + its panel ────────────────────────────────────────────
//
// Wires #orders-alerts-btn / #orders-alerts-panel / #orders-alerts-count
// (orders.html). Call once, from orders-main's init(), after watchTablet() —
// so the first count is right even when the page opens already at tablet
// width. Idempotent by construction: it is only ever called once.
export function initAlertsPanel() {
  const btn = document.getElementById('orders-alerts-btn');
  const panel = document.getElementById('orders-alerts-panel');
  const count = document.getElementById('orders-alerts-count');
  if (!btn || !panel || !count) return;

  function isTablet() {
    return window.matchMedia(TABLET_QUERY).matches;
  }

  function setOpen(open) {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  function toggle() {
    setOpen(panel.hidden);
  }

  // ⚠️ DERIVED, NEVER TYPED — the same rule js/orders/registry-main.js uses for
  // the bottom bar. A count written by hand here could say "3" over an empty
  // panel the moment a banner's own renderer quietly cleared itself.
  function refreshCount() {
    const n = countNotices(panel);
    count.textContent = String(n);
    btn.hidden = !isTablet() || n === 0;
    btn.setAttribute('aria-label', t('orders.alerts.panelButton', { n }));
    if (n === 0 && !panel.hidden) setOpen(false); // nothing left to show
  }

  btn.addEventListener('click', toggle);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
  });
  // A tap anywhere outside the panel and its own button closes it — the same
  // "outside tap closes it" rule as every dropdown-like control in this app.
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    setOpen(false);
  });

  // Every renderer that fills the panel's hosts writes into them
  // independently and has no idea the panel — or the button — exists. The
  // observer is what lets the count (and the button's very visibility) follow
  // whatever they do, including a host crossing in or out of `hidden`.
  const observer = new MutationObserver(refreshCount);
  observer.observe(panel, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'],
  });

  refreshCount();
}
