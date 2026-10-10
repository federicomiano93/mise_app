// tablet-layout.js — moves the banner HOSTS on the Order tab into the bell's panel
// and the strip above the order box, and answers «is this a tablet?» for the rest of
// Orders.
//
// ⚠️⚠️ AT EVERY SIZE SINCE 28 SEP 2026 (later): Federico wanted the order notices in
// the green bar on the phone too, so the hosts move once, at start, whatever the
// width, and never move back. The tablet query now only changes SIZES (orders.css)
// and whether the order total is drawn (orders-main.js paintMoney). The two-pane split
// it also drove was removed on 30 Sep 2026: a supplier's order opens full screen.
//
// ⚠️ `t` IS CALLED AT RENDER TIME, NEVER FROZEN AT MODULE LOAD — this module is
// imported before a venue is open, so a phrase fetched at the top of the file
// would stay in the app's starting language for the life of the page (the
// v1.57.0 defect). It is asked again inside refreshCount(), every time the
// count actually changes.

import { t } from '../i18n.js';

// ⚠️⚠️ THE RENDERERS NEVER CHANGE. Every host below is found BY ID and filled
// by its own function elsewhere (notifications.js renderAlerts,
// deliveries-view.js renderOwedBanner, reminder-view.js
// renderPending/renderTodayOrders, untold-view.js via orders-main's
// renderUntoldChanges). This file only moves the HOST NODE in the DOM — it
// never touches what is inside it.
//
// ⚠️ ONE QUERY, THE SAME TEXT tokens.css and orders.css already carry —
// tests/tablet-width.test.mjs fails the moment any of the three drifts apart.
//
// ⚠️ THE QUERY IS AN OR: (900 wide AND 600 tall) OR 1000 wide. The second half is the
// keyboard guard (9 Oct 2026): on the SM-T550 the on-screen keyboard shrinks the page to
// ~1024×420, which fails the height floor and used to flip the layout to the phone one
// while a box was being typed in. The keyboard never changes the width, so 1000+ wide is
// always a tablet. Phones sideways are ≤ ~932 wide and stay on the phone layout. Not
// device detection, not an orientation lock. Details: tokens.css.
//
// ⚠️ BUILT FROM HALVES, NOT WRITTEN AS ONE STRING. Not a translatable
// sentence — it is CSS syntax, exactly like the values already passed to
// matchMedia() elsewhere in this app — but written whole it reads as English
// prose with "and" in it and tests/nothing-stays-english.test.mjs cannot tell
// the two apart on text alone; that test's whole point is to take the
// false-positive cost rather than learn a ninth shape of exception. Composed,
// the join itself is a single word and never trips it.
const MIN_WIDTH = '(min-width: 900px)';
const MIN_HEIGHT = '(min-height: 600px)';
const WIDE_ENOUGH = '(min-width: 1000px)';
export const TABLET_QUERY = `${MIN_WIDTH} and ${MIN_HEIGHT}, ${WIDE_ENOUGH}`;

// host id -> the tablet slot it moves into. Order matters: within one slot,
// hosts are appended in the order they appear here.
//   orders-tablet-strip — today's orders, then the debt (today first).
//   orders-alerts-panel — pending, untold, then the calendar notices. (The «to re-order»
//   notice left the bell on 2 Oct 2026: it has its own round button in the green bar.)
export const TABLET_HOSTS = [
  { id: 'orders-today', slot: 'orders-tablet-strip' },
  { id: 'orders-owed', slot: 'orders-tablet-strip' },
  { id: 'orders-pending', slot: 'orders-alerts-panel' },
  { id: 'orders-untold', slot: 'orders-alerts-panel' },
  { id: 'orders-alerts', slot: 'orders-alerts-panel' },
];

// Move every host into its slot. Idempotent: a host already inside its slot is
// left alone, so calling this twice never duplicates or reorders anything.
function moveIn() {
  TABLET_HOSTS.forEach(({ id, slot }) => {
    const host = document.getElementById(id);
    const slotEl = document.getElementById(slot);
    if (!host || !slotEl || host.parentNode === slotEl) return;
    slotEl.appendChild(host);
  });
}

// Whether the tablet query matches right now — the one place every other
// module in Orders that needs to ask asks (js/orders/orders-main.js's order
// total, this file's own initAlertsPanel below), so a future change to the
// query text only has to happen here.
export function isTabletNow() {
  return window.matchMedia(TABLET_QUERY).matches;
}

// Watch the tablet query and keep every host on the right side of it — a
// window resized or a tablet rotated while the page is open, not only the
// state it opened in. `onChange(isTablet)` is called once immediately and
// again on every crossing.
export function watchTablet(onChange) {
  const mq = window.matchMedia(TABLET_QUERY);
  const apply = () => {
    moveIn();
    onChange?.(mq.matches);
  };
  apply();
  // Safari < 14 only has the older addListener form.
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else mq.addListener(apply);
}

// ── What counts as a notice, inside the alerts panel ──────────────────────
//
// ⚠️⚠️ A NOTICE AND "SOMETHING TO LOOK AT" ARE NOT THE SAME QUESTION, and
// conflating them is the review-round bug (28 Sep 2026): the bell hid itself
// at zero notices even while the panel still held the "show the notices
// again" pill (`.alert-pill`, notifications.js renderPill) — reachable on a
// phone by scrolling to it, unreachable on a tablet once the bell that opens
// its only container had hidden itself. So there are TWO answers:
//   count       — real notices only, what the NUMBER on the badge says.
//   hasContent  — count > 0 OR the pill is there; what decides whether the
//                 panel's "No notices right now." line is hidden (the bell itself
//                 is permanent since 3 Oct 2026). The pill is content even
//                 though it is not itself a notice.
//
// PURE, so it can be tested without a DOM (this project has no jsdom): given
// the CLASS NAMES of the panel's descendants, not the elements themselves.
export const NOTICE_CLASSES = [
  'pending-banner',       // reminder-view.js renderPending — one per supplier
  'untold-banner',        // untold-view.js — "the order changed since the last send"
  'untold-ordered',       // untold-view.js — "already ordered, and this changed"
  'owed-banner',          // deliveries-view.js renderOwedBanner (only ever off-tablet
                           // inside the panel if a caller ever moved it there by mistake —
                           // it normally lives in the strip, not the panel, but a notice
                           // is a notice wherever it ends up)
  'alert-banner',         // notifications.js renderAlerts — one per calendar notice
];

// Content that is NOT a notice but still means "there is something to open
// the panel for" — today just the one pill.
const NON_NOTICE_CONTENT_CLASSES = ['alert-pill'];

function classListHasAny(classNames, markers) {
  return (classNames || []).some((cls) => {
    const parts = String(cls || '').split(/\s+/);
    return markers.some((marker) => parts.includes(marker));
  });
}

// -> { count, hasContent }
export function countNoticeClassNames(classNames) {
  const list = classNames || [];
  const count = list.filter((cls) => classListHasAny([cls], NOTICE_CLASSES)).length;
  const hasContent = count > 0 || classListHasAny(list, NON_NOTICE_CONTENT_CLASSES);
  return { count, hasContent };
}

// The DOM wrapper around the pure rule above.
export function countNotices(panelEl) {
  if (!panelEl) return { count: 0, hasContent: false };
  // Ask the browser for only the elements that can matter, instead of walking and
  // mapping every descendant of the panel on each mutation: the same elements end up
  // in the count, because a descendant counts only if it carries one of these classes.
  const markers = [...NOTICE_CLASSES, ...NON_NOTICE_CONTENT_CLASSES];
  const classNames = [...panelEl.querySelectorAll(markers.map((c) => `.${c}`).join(','))]
    .map((n) => n.className || '');
  return countNoticeClassNames(classNames);
}

// ── The bell button + its panel ────────────────────────────────────────────
//
// Wires #orders-alerts-btn / #orders-alerts-panel / #orders-alerts-count
// (orders.html). Call once, from orders-main's init(), after watchTablet() —
// so the first count is right even when the page opens already at tablet
// width. Idempotent by construction: it is only ever called once.

// ⚠️ MODULE-LEVEL, NOT A CLOSURE VARIABLE RETURNED FROM initAlertsPanel(). Any
// full-screen screen opened over the Order tab (a supplier, its read-only
// list, its summary, History, Settings) must close this panel first — it is
// the only door out of the small set of callers this module cannot see from
// in here, so orders-main.js is handed one small function instead of the
// whole panel's internals.
let closePanel = null;

export function closeAlertsPanel() {
  closePanel?.();
}

export function initAlertsPanel() {
  const btn = document.getElementById('orders-alerts-btn');
  const panel = document.getElementById('orders-alerts-panel');
  const countEl = document.getElementById('orders-alerts-count');
  const emptyEl = document.getElementById('orders-alerts-empty');
  if (!btn || !panel || !countEl) return;

  function setOpen(open) {
    const changed = panel.hidden === open;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    // Announced only when the panel really opened or closed: closeAlertsPanel() is called by
    // every full screen, whether the panel was open or not.
    if (changed) globalThis.window?.dispatchEvent(new CustomEvent('mise:screen', { detail: open ? 'alerts' : '' }));
  }
  closePanel = () => setOpen(false);

  function toggle() {
    setOpen(panel.hidden);
  }

  // ⚠️ DERIVED, NEVER TYPED — the same rule js/orders/registry-main.js uses for
  // the bottom bar. A count written by hand here could say "3" over an empty
  // panel the moment a banner's own renderer quietly cleared itself.
  //
  // ⚠️ THE BELL AND THE NUMBER ANSWER TWO DIFFERENT QUESTIONS — see the long
  // note on countNoticeClassNames above. `hasContent` decides whether the panel
  // shows its empty line; the number only counts real notices, and is blank
  // rather than "0" when there are none.
  //
  // ⚠️ THE BELL IS PERMANENT (Federico, 3 Oct 2026): it never hides. With no content the
  // panel stays open on its empty line instead of closing under the thumb. The empty line
  // is excluded from the count because its class is neither a notice class nor the pill.
  // It is only written when its state CHANGES: the observer below watches the panel's
  // subtree, and rewriting the same value is needless work on every pass.
  function refreshCount() {
    const { count, hasContent } = countNotices(panel);
    countEl.textContent = count > 0 ? String(count) : '';
    countEl.hidden = count === 0;
    btn.setAttribute('aria-label', count > 0
      ? t('orders.alerts.panelButton', { n: count })
      : t('orders.alerts.panelRegion'));
    if (emptyEl && emptyEl.hidden !== hasContent) emptyEl.hidden = hasContent;
  }

  btn.addEventListener('click', toggle);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
  });
  // ⚠️ e.composedPath(), CAPTURED AT DISPATCH TIME — not panel.contains(e.target)
  // read back after the fact. Tapping a notice's own close button (the alert
  // banner's ×, or an "Order placed" button inside the panel) repaints that
  // banner SYNCHRONOUSLY, before this listener runs on the same click's
  // bubble — so by the time `contains()` asked, the tapped node was already
  // gone from the tree and the panel looked like it had not been touched,
  // closing itself under the very tap that was supposed to stay inside it.
  // composedPath() is fixed at the moment the event was dispatched and still
  // names every ancestor the tapped node had then, panel included.
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    if (path.includes(panel) || path.includes(btn)) return;
    setOpen(false);
  });

  // Every renderer that fills the panel's hosts writes into them
  // independently and has no idea the panel — or the button — exists. The
  // observer is what lets the count (and the panel's empty line) follow
  // whatever they do. Only nodes coming and going can change the answer: the count
  // reads class names, never the `hidden` attribute (a hidden host still counts its
  // banners), so attribute changes are not watched — they only woke refreshCount for
  // an unchanged result.
  const observer = new MutationObserver(refreshCount);
  observer.observe(panel, { childList: true, subtree: true });

  refreshCount();
}
