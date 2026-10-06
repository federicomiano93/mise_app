// price-changes-screen.js — «Price changes»: how supplier prices moved, by week or by month, biggest
// increases first. A full-screen level on the Fornitori page, opened from its bottom bar.
//
// READ-ONLY. The documents are written by the invoice import (create-only); this screen only reads
// `price-changes` for the period on show and draws it. What it may NOT do is guess: a read that fails says
// so (and offers a retry) instead of showing «no changes», which would read as «prices did not move».
//
// ⚠️ EVERY WORD IS ASKED INSIDE A FUNCTION (the venue's language arrives after this module loads).
// ⚠️ THE SIGN IS ALWAYS TEXT («+10%» / «−4%»): the colour only repeats it (P18).

import { t, currentLanguage, localeTag } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { formatPricePerUnit } from '../price-model.js';
import { ingredientDisplayName } from '../ingredient-name.js';
import { el } from './dom.js';
import { BACK_ICON } from './mgmt-ui.js';
import { listPriceChanges, latestPriceChangeDate } from './firebase-orders.js';
import { periodOf, shiftPeriod, periodContains, periodLabel, summarize } from './price-changes-model.js';

const NEXT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
const PREV_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';

let openOverlay = null;

function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// data: { suppliers(): [], ingredients(): [], weekStartsOn(): 'Sunday'…, opener?: the button that opened this }
export function openPriceChanges(data) {
  if (openOverlay) return;
  const opener = data.opener || (typeof document !== 'undefined' ? document.activeElement : null);
  const weekStartsOn = () => (typeof data.weekStartsOn === 'function' ? data.weekStartsOn() : undefined);

  const s = {
    kind: 'month',
    period: periodOf('month', todayISO(), weekStartsOn()),
    status: 'loading',      // 'loading' | 'ready' | 'error'
    changes: [],
    fromCache: false,       // the last answer came from the cache (no connection): changes may be missing
    anyAtAll: true,         // false only when the collection is known to be empty
    started: false,         // the newest change has been read, so a retry only reloads the period
    ticket: 0,              // a late answer for a period no longer on show is dropped
  };

  const scroll = el('div', { class: 'mgmt-scroll' });
  const backBtn = el('button', { type: 'button', class: 'app-icon-btn orders-icon-btn', icon: BACK_ICON, onClick: () => close() });
  // ONE live region for the period, kept across every redraw so its text is UPDATED (and announced), never recreated.
  const periodEl = el('span', { class: 'pchg-period', 'aria-live': 'polite', tabindex: '-1' });
  const titleHeading = el('h1', { id: 'pchg-title', tabindex: '-1' });
  const node = el('div', { class: 'mgmt-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pchg-title' }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [backBtn]),
      el('div', { class: 'app-header-title orders-header-title' }, [titleHeading]),
      el('span', { class: 'app-header-slot' }),
    ]),
    scroll,
  ]);

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    s.ticket += 1;
    node.remove();
    openOverlay = null;
    if (opener && typeof opener.focus === 'function' && opener.isConnected !== false) opener.focus();
  }

  // ── Loading ───────────────────────────────────────────────────────────────────────────────────

  async function load() {
    const ticket = ++s.ticket;
    s.status = 'loading';
    render();
    try {
      const answer = await listPriceChanges(s.period.from, s.period.to);
      if (ticket !== s.ticket) return;
      s.changes = answer.docs;
      s.fromCache = answer.fromCache === true;
      s.status = 'ready';
    } catch (err) {
      if (ticket !== s.ticket) return;
      console.error('Price changes could not be read:', err);
      s.status = 'error';
    }
    render();
  }

  async function start() {
    const ticket = ++s.ticket;
    render();
    let latest = '';
    try {
      latest = (await latestPriceChangeDate()).date;
    } catch (err) {
      if (ticket !== s.ticket) return;
      console.error('The latest price change could not be read:', err);
      s.status = 'error';
      render();
      return;
    }
    if (ticket !== s.ticket) return;
    s.anyAtAll = latest !== '';
    s.started = true;
    s.period = periodOf(s.kind, latest || todayISO(), weekStartsOn());
    load();
  }

  function setKind(kind) {
    if (kind === s.kind) return;
    // The new period holds the day the old one ended on (today, when it holds today), so switching never
    // jumps somewhere else.
    s.kind = kind;
    const anchor = periodContains(s.period, todayISO()) ? todayISO() : s.period.to;
    s.period = periodOf(kind, anchor, weekStartsOn());
    load();
  }

  function move(step) {
    s.period = shiftPeriod(s.period, step, weekStartsOn());
    load();
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────────────────────

  function formatDay(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return String(iso || '');
    return new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  }

  function percentText(pct) {
    const whole = Math.round(Math.abs(pct));
    return `${pct > 0 ? '+' : '−'}${whole}%`;
  }

  function row(change) {
    const live = data.ingredients().find(i => i.id === change.ingredientId);
    const name = live ? ingredientDisplayName(live) : String(change.name || '');
    const supplier = data.suppliers().find(x => x.id === change.supplierId);
    const date = formatDay(change.date);
    const meta = supplier
      ? t('priceChanges.meta', { supplier: supplierLabel(supplier), date })
      : t('priceChanges.metaNoSupplier', { date });
    const priceLine = t('priceChanges.priceLine', {
      old: formatPricePerUnit({ priceUnit: change.priceUnit, pricePerUnit: change.oldPrice }),
      new: formatPricePerUnit({ priceUnit: change.priceUnit, pricePerUnit: change.newPrice }),
    });
    const rising = change.pct > 0;
    const packDiffers = change.oldPack && change.newPack && change.oldPack !== change.newPack;
    return el('li', { class: 'invimp-row' }, [
      el('div', { class: 'invimp-row-top' }, [
        el('div', { class: 'invimp-row-main' }, [
          el('p', { class: 'pchg-name', text: name }),
          el('p', { class: 'pchg-meta', text: meta }),
        ]),
        el('span', { class: `invimp-status invimp-status--${rising ? 'warn' : 'ok'}`, text: percentText(change.pct) }),
      ]),
      el('p', { class: 'pchg-price', text: priceLine }),
      packDiffers ? el('p', { class: 'pchg-pack', text: t('priceChanges.packDiffers', { old: change.oldPack, new: change.newPack }) }) : null,
    ]);
  }

  function section(titleKey, list) {
    if (!list.length) return null;
    return el('section', { class: 'pchg-section' }, [
      el('h3', { class: 'mgmt-section-title', text: t(titleKey) }),
      el('ul', { class: 'pchg-list' }, list.map(row)),
    ]);
  }

  function kindButton(kind, key) {
    return el('button', {
      type: 'button', class: 'set-seg-btn', 'aria-pressed': s.kind === kind ? 'true' : 'false',
      'data-fid': `pchg-kind-${kind}`, text: t(key), onClick: () => setKind(kind),
    });
  }

  function navButton(icon, labelKey, step, disabled) {
    return el('button', {
      type: 'button', class: 'pchg-nav-btn', icon, 'aria-label': t(labelKey), 'data-fid': `pchg-nav-${step}`,
      disabled: disabled ? '' : null, onClick: () => move(step),
    });
  }

  function drawBody() {
    if (s.status === 'loading') return el('p', { class: 'invimp-note', role: 'status', text: t('priceChanges.loading') });
    if (s.status === 'error') {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      return el('div', { class: 'pchg-error' }, [
        el('p', { class: 'orders-status error', role: 'alert', text: t(offline ? 'priceChanges.offline' : 'priceChanges.error') }),
        el('button', { type: 'button', class: 'btn-secondary', 'data-fid': 'pchg-retry', text: t('priceChanges.retry'), onClick: () => (s.started ? load() : start()) }),
      ]);
    }
    const { increases, decreases, counts } = summarize(s.changes);
    // ⚠️ An empty answer from the cache is not «no changes»: the cache may simply not hold them.
    if (counts.total === 0 && s.fromCache) {
      return el('div', { class: 'pchg-empty' }, [el('p', { class: 'orders-status error', role: 'status', text: t('priceChanges.needConnection') })]);
    }
    if (counts.total === 0) {
      return el('div', { class: 'pchg-empty' }, [
        el('p', { class: 'invimp-note', text: t('priceChanges.empty') }),
        s.anyAtAll ? null : el('p', { class: 'invimp-note', text: t('priceChanges.emptyAll') }),
      ]);
    }
    return el('div', { class: 'pchg-results' }, [
      s.fromCache ? el('p', { class: 'invimp-note', role: 'status', text: t('priceChanges.cacheNote') }) : null,
      el('p', { class: 'pchg-summary', text: `${t('priceChanges.up', { n: counts.increases })} · ${t('priceChanges.down', { n: counts.decreases })}` }),
      section('priceChanges.increases', increases),
      section('priceChanges.decreases', decreases),
    ]);
  }

  function render() {
    const focusedId = document.activeElement && node.contains(document.activeElement)
      ? document.activeElement.getAttribute('data-fid') : null;
    titleHeading.textContent = t('priceChanges.title');
    backBtn.setAttribute('aria-label', t('ui.back'));
    const nextDisabled = periodContains(s.period, todayISO());
    periodEl.textContent = periodLabel(s.period, currentLanguage());
    scroll.replaceChildren(el('div', { class: 'invimp-screen' }, [
      el('div', { class: 'set-seg', role: 'group', 'aria-label': t('priceChanges.groupBy') }, [
        kindButton('week', 'priceChanges.week'),
        kindButton('month', 'priceChanges.month'),
      ]),
      el('div', { class: 'pchg-nav' }, [
        navButton(PREV_ICON, 'priceChanges.previous', -1, false),
        periodEl,
        navButton(NEXT_ICON, 'priceChanges.next', 1, nextDisabled),
      ]),
      drawBody(),
    ]));
    if (focusedId) {
      const again = node.querySelector(`[data-fid="${focusedId}"]`);
      // The button under the focus is gone («Next» became disabled on the current period, «Try again» was replaced
      // by the loading note): the focus goes to the period label, never to the page.
      if (again && !again.disabled) again.focus({ preventScroll: true });
      else periodEl.focus({ preventScroll: true });
    }
  }

  document.addEventListener('keydown', onKey);
  document.body.appendChild(node);
  openOverlay = node;
  titleHeading.textContent = t('priceChanges.title');
  titleHeading.focus({ preventScroll: true });
  start();
}
