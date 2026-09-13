// vat-guide-view.js — «which products take which VAT rate», opened from the button
// beside a product's VAT rate.
//
// Federico, 13 Sep 2026: «accanto alla casella aliquota iva mettimi un tasto che apre una
// lista, la lista mostra i prodotti a cui corrispondono le varie aliquote … secondo la
// legge» — for Italy AND the United Kingdom, each venue its own country's law.
//
// ⚠️ TWO LANGUAGES ON ONE SCREEN, ON PURPOSE. The guide's ITEMS name foods, so they come
// from js/foodcost/vat-guide.js in the venue's COUNTRY's language — the rule every food
// word in this app follows. The screen around them (title, the disclaimer, «Use 10%»)
// is interface and comes from t().
//
// ⚠️ NOT `.preview-overlay`: that class is a busy marker in js/update-gate.js. Nothing
// here can be lost by closing it — and the product editor underneath, which can, is
// already a busy marker of its own.

import { t, localeTag } from '../i18n.js';
import { el } from './dom.js';
import { vatGuideFor } from './vat-guide.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// A date written as it is read: «13 settembre 2026», «13 September 2026».
function checkedDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? String(iso || '')
    : d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'long', year: 'numeric' });
}

// options: { country, currentRate, onUse(rate), returnFocus }
export function openVatGuide({ country, currentRate = null, onUse, returnFocus = null } = {}) {
  const guide = vatGuideFor(country);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    try { returnFocus?.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
  };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

  const back = el('button', {
    class: 'fc-icon-btn', type: 'button', icon: BACK_ICON, 'aria-label': t('ui.back'), onclick: close,
  });

  const rates = guide.rates.map(group => {
    const inUse = currentRate !== null && currentRate !== undefined && Number(currentRate) === group.rate;
    return el('section', { class: 'fc-guide-rate' }, [
      el('div', { class: 'fc-guide-rate-head' }, [
        el('h2', { text: t('fc.vatGuide.rate', { rate: String(group.rate) }) }),
        inUse
          ? el('span', { class: 'fc-guide-inuse', text: t('fc.vatGuide.inUse') })
          : el('button', {
            class: 'fc-guide-use', type: 'button', text: t('fc.vatGuide.use', { rate: String(group.rate) }),
            onclick: () => { onUse?.(group.rate); close(); },
          }),
      ]),
      el('ul', { class: 'fc-guide-items' }, group.items.map(item => el('li', { text: item }))),
    ]);
  });

  const body = el('div', { class: 'fc-view' }, [
    el('p', { class: 'fc-guide-disclaimer', text: t('fc.vatGuide.disclaimer') }),
    ...rates,
    guide.notes.length ? el('section', { class: 'fc-guide-rate' }, [
      el('h2', { class: 'fc-guide-notes-title', text: t('fc.vatGuide.notes') }),
      el('ul', { class: 'fc-guide-items' }, guide.notes.map(note => el('li', { text: note }))),
    ]) : null,
    el('div', { class: 'fc-guide-sources' }, [
      el('p', { text: t('fc.vatGuide.sources', { date: checkedDate(guide.checkedOn) }) }),
      el('ul', {}, guide.sources.map(source => el('li', {}, [
        el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: source.title }),
      ]))),
    ]),
  ]);

  const overlay = el('div', {
    class: 'fc-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fcGuideTitle',
  }, [
    el('header', { class: 'fc-header' }, [
      el('span', { class: 'fc-header-slot' }, [back]),
      el('div', { class: 'fc-header-title' }, [el('h1', { id: 'fcGuideTitle', text: t('fc.vatGuide.title') })]),
      el('span', { class: 'fc-header-slot' }),
    ]),
    el('main', { class: 'fc-screen' }, [body]),
  ]);

  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  try { back.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
  return { close };
}
