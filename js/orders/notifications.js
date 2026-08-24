// notifications.js — client-side order alerts.
//
// Computes three alerts and shows them as in-app banners; when the user grants
// permission, it also raises a browser notification while the app is open:
//   1. Place the order — a supplier's ORDER day is today (primary reminder)
//   2. Bank holiday ahead — plan orders up to a week before
//   3. Delivery conflict — an upcoming bank holiday falls on a supplier's delivery day
//
// Order timing is a fixed weekday model (per Federico): each supplier has its own
// order days (the days he places the order) and delivery days. No "days-before"
// math. Client-side only: these fire while the app is open. Pushing to staff with
// the app closed needs the server step (Firebase Cloud Functions), deferred for
// now — see js/firebase.example.js.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { isBankHoliday } from './bank-holidays.js';
import {
  visibleAlerts, hiddenAlerts, pruneDismissed, withDismissed, reopenAll,
  readDismissed, writeDismissed,
} from './alert-dismissal.js';

// Static SVG (same 24×24 stroked convention as BACK_ICON in management.js) — an
// emoji bell renders as a different picture on every OS and ignores currentColor.
const BELL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CONFLICT_WINDOW_DAYS = 14;
const notified = new Set(); // browser notifications already raised this session

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Bank-holiday ISO dates within the next `days` days (from tomorrow).
function upcomingHolidays(from, days) {
  const result = [];
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  for (let i = 1; i <= days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = toISODate(d);
    if (isBankHoliday(iso)) result.push(iso);
  }
  return result;
}

// The first bank holiday within the next `days` days (from tomorrow), as
// { iso, days }, or null. Gives an exact "in N days" countdown for the banner.
function nextHolidayWithin(from, days) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  for (let i = 1; i <= days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = toISODate(d);
    if (isBankHoliday(iso)) return { iso, days: i };
  }
  return null;
}

// The supplier's NEXT delivery relative to `now`, as a friendly label:
// 'tomorrow' when it lands on the very next day, otherwise the weekday name
// (e.g. 'Thursday'). Empty string when the supplier has no delivery days. Only
// the next delivery is returned — never the full list of delivery weekdays.
function nextDeliveryLabel(supplier, now) {
  const days = supplier.deliveryDays || [];
  if (!days.length) return '';
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const wd = WEEKDAYS[d.getDay()];
    if (days.includes(wd)) return i === 1 ? 'tomorrow' : wd;
  }
  return '';
}

export function computeAlerts(suppliers, now = new Date()) {
  const alerts = [];
  const active = (suppliers || []).filter(s => s.active !== false);
  const todayWd = WEEKDAYS[now.getDay()];

  // 1. Place the order — every supplier whose ORDER day is today, in ONE grouped,
  //    numbered banner (the primary reminder). Each line notes when they deliver.
  const toOrder = active.filter(s => (s.orderDays || []).includes(todayWd));
  if (toOrder.length) {
    const items = toOrder.map(s => {
      const when = nextDeliveryLabel(s, now);
      return when ? `${s.name} — ${when}` : s.name;
    });
    alerts.push({
      kind: 'order',
      key: `order-${toISODate(now)}`,
      title: toOrder.length === 1 ? t('orders.orderToPlaceToday') : t('orders.ordersToPlaceToday'),
      items,
      // Notification body: supplier names only. The title carries the action and
      // the phone already shows "from Misé", so the app name is never
      // repeated here.
      text: toOrder.map(s => s.name).join(', '),
    });
  }

  // 2. Bank holiday ahead — warn up to 7 days before so orders can be planned.
  const holiday = nextHolidayWithin(now, 7);
  if (holiday) {
    // ⚠️ "tomorrow" IS ITS OWN SENTENCE, not the n === 1 branch of a plural. English
    // and Italian both have a word for it, and pouring it into a count reads as
    // "in 1 day". The remaining case goes through the dictionary's plural forms
    // rather than a ternary, which is the project's i18n rule: a language whose
    // plural works differently says so in its own entry.
    const text = holiday.days === 1
      ? t('orders.alert.bankHolidayTomorrow', { date: holiday.iso })
      : t('orders.alert.bankHolidayInDays', { n: holiday.days, date: holiday.iso });
    alerts.push({ kind: 'holiday', key: `bh-${holiday.iso}`, text });
  }

  // 3. Delivery conflict — an upcoming holiday lands on a supplier's delivery day.
  upcomingHolidays(now, CONFLICT_WINDOW_DAYS).forEach(iso => {
    const dayIndex = new Date(`${iso}T00:00:00`).getDay();
    // ⚠️ TWO USES OF THE SAME WEEKDAY, AND ONLY ONE OF THEM IS A WORD. `wd` is the
    // STORED value compared against the supplier's deliveryDays and must stay
    // English — translating it would make a Monday supplier never match a Monday.
    // What reaches the screen is looked up separately.
    const wd = WEEKDAYS[dayIndex];
    active.forEach(s => {
      if ((s.deliveryDays || []).includes(wd)) {
        alerts.push({
          kind: 'conflict',
          key: `conf-${s.id}-${iso}`,
          text: t('orders.alert.deliveryClash', {
            supplier: s.name, day: t(`day.weekdayLong.${dayIndex}`), date: iso,
          }),
        });
      }
    });
  });

  return alerts;
}

// True when the daily "place the order" reminder has not yet been shown today.
// `lastShownIso` is the last date it was shown on this device ('YYYY-MM-DD') or
// null/undefined if never. Pure and date-based so it is unit-testable.
export function isReminderDue(lastShownIso, now = new Date()) {
  return lastShownIso !== toISODate(now);
}

// Raise a browser notification for each new alert (only when permission granted).
// The title is the alert's own heading (e.g. "Order to place today"); the phone
// already labels the popup "from Misé", so we never repeat the app
// name here. Alerts without a heading fall back to the app name.
export function maybeNotify(alerts) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  alerts.forEach(a => {
    if (notified.has(a.key)) return;
    notified.add(a.key);
    try { new Notification(a.title || 'Misé', { body: a.text, tag: a.key }); }
    catch (err) { console.warn('Notification failed:', err); }
  });
}

// Build one banner. A grouped alert (with items[]) renders a title + numbered list;
// a plain alert renders its text. Both use the same .alert-banner colouring by kind.
//
// ⚠️ THE CLOSE BUTTON IS A SIBLING OF THE TEXT, NEVER INSIDE IT. A button cannot
// nest inside a button, and the frame belongs to the ROW — the rule this project
// wrote down in PR #31 after a delete icon ended its card 41px short of everything
// below it.
function renderAlert(a, onClose) {
  const body = (Array.isArray(a.items) && a.items.length)
    ? el('div', { class: 'alert-body' }, [
      el('div', { class: 'alert-title', text: a.title || '' }),
      el('ol', { class: 'alert-list' }, a.items.map(t => el('li', { text: t }))),
    ])
    : el('div', { class: 'alert-body', text: a.text });

  if (!onClose) return el('div', { class: `alert-banner ${a.kind}` }, [body]);

  return el('div', { class: `alert-banner ${a.kind}` }, [
    body,
    el('button', {
      type: 'button', class: 'alert-close',
      'aria-label': t('orders.alert.close'),
      onClick: () => onClose(a.key),
      icon: CLOSE_ICON,
    }),
  ]);
}

const CLOSE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

const BELL_SMALL =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>';

// What is left when every calendar notice has been read and put away: a pill that
// says how many there were and opens them all again.
//
// ⚠️ IT IS NOT A BANNER MADE SMALL. It carries no wording of its own beyond a
// count, because its whole job is to take up almost nothing while still proving the
// notices are there — the thing a person needs after reading them once.
function renderPill(count, onReopen) {
  return el('button', {
    type: 'button', class: 'alert-pill',
    'aria-label': t('orders.alert.reopen'),
    onClick: () => onReopen(),
  }, [
    el('span', { class: 'alert-pill-icon', 'aria-hidden': 'true', icon: BELL_SMALL }),
    el('span', { class: 'alert-pill-count', text: String(count) }),
  ]);
}

// Render the alert banners into `container`, and raise browser notifications for
// new alerts. The "Enable notifications" control lives in Settings (see
// renderNotificationSettings), not here — it must not clutter the main Order screen.
export function renderAlerts(container, suppliers, now = new Date()) {
  if (!container) return;
  container.textContent = '';

  // The "place the order" alert is not rendered here. On the Home it is the
  // once-a-day badge (js/home-orders-badge.js); on the Orders screen itself it is
  // the compact chip row at the top (reminder-view.js renderTodayOrders), which
  // also knows which of today's orders are already placed and ticks them off —
  // something this function cannot do, as it never sees the history. What is left
  // here is the informational holiday / delivery-clash alerts.
  const alerts = computeAlerts(suppliers, now).filter(a => a.kind !== 'order');

  // ⚠️⚠️ PRUNED AGAINST THE DATE, NEVER AGAINST THIS PAINT'S ALERTS. The first
  // paint happens before the suppliers have arrived, so "the alerts right now" is not
  // the same list as "the alerts" — and a key pruned then reopened a notice somebody
  // had put away. Found by reloading the real app.
  const dismissed = pruneDismissed(readDismissed(storage()), toISODate(now));
  writeDismissed(storage(), dismissed);

  const shown = visibleAlerts(alerts, dismissed);
  const hidden = hiddenAlerts(alerts, dismissed);

  const close = (key) => {
    writeDismissed(storage(), withDismissed(readDismissed(storage()), key));
    renderAlerts(container, suppliers, now);
  };
  const reopen = () => {
    writeDismissed(storage(), reopenAll());
    renderAlerts(container, suppliers, now);
  };

  shown.forEach(a => container.appendChild(renderAlert(a, close)));
  // ⚠️ ONLY WHEN THERE IS NOTHING LEFT OPEN. A pill beside a banner would be two
  // controls for one fact, and the second would be the one nobody understands.
  if (!shown.length && hidden.length) container.appendChild(renderPill(hidden.length, reopen));

  container.hidden = !shown.length && !hidden.length;
  maybeNotify(alerts);
}

// ⚠️ READ THROUGH A FUNCTION, NOT CAPTURED AT MODULE LOAD. A private browsing
// window can throw on the very first touch of localStorage, and this module is
// imported by the Home badge too — a throw up here would take that down with it.
function storage() {
  try { return window.localStorage; } catch { return null; }
}

// Render the "Enable notifications" control + status into a settings container
// (the management panel), so it no longer clutters the main Order screen. Shows a
// short explanation, then either the enable button, an "on" status, or a "blocked"
// hint depending on the current browser permission.
export function renderNotificationSettings(container) {
  if (!container) return;
  container.textContent = '';

  if (!('Notification' in window)) {
    container.appendChild(el('p', { class: 'notif-note', text: t('orders.thisDeviceDoesNot') }));
    return;
  }

  container.appendChild(el('p', { class: 'notif-desc', text:
    t('orders.getAnAlertWhen') }));

  const perm = Notification.permission;
  if (perm === 'granted') {
    container.appendChild(el('p', { class: 'notif-status on' }, [
      el('span', { icon: BELL_SVG, 'aria-hidden': 'true' }),
      t('orders.notificationsAreOnFor'),
    ]));
  } else if (perm === 'denied') {
    container.appendChild(el('p', { class: 'notif-status off', text:
      t('orders.notificationsAreBlockedTurn') }));
  } else {
    container.appendChild(el('button', { type: 'button', class: 'enable-notifs', onClick: async () => {
      try { await Notification.requestPermission(); } catch (err) { console.warn('Permission request failed:', err); }
      renderNotificationSettings(container);
    } }, [
      el('span', { icon: BELL_SVG, 'aria-hidden': 'true' }),
      t('orders.enableNotifications'),
    ]));
  }
}
