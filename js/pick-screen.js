// pick-screen.js — the full-screen chooser with a search box. SHARED: the Catalogue links a
// recipe row with it, Food cost picks a product's recipes, ingredients and packaging with it.
//
// A full-screen overlay with a search box, not a dropdown: there are dozens of ingredients
// and hundreds of recipes, and a <select> long enough to hold them is unusable on a phone.
// It follows the app's drill-in pattern and header spec — Back on the LEFT, title CENTRED,
// nothing on the right — and it wears the CALLING PAGE's own header (`chrome`), so it looks
// like one more level of that page rather than a screen from somewhere else.
//
// ⚠️ It deliberately does NOT use the class `.preview-overlay`: that name is in
// BUSY_SELECTORS (js/update-gate.js) and would postpone a compulsory update for as long as
// this stayed open. Nothing here can be lost by closing it, so nothing here may hold an
// update back.
// ⚠️ NO WORDS OF ITS OWN: every label arrives already translated, at draw time.

import { el } from './dom.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// Open the chooser. Resolves with the `value` of what was chosen, and with `undefined` when
// it is dismissed (Back or Escape) — so a caller can tell «cancel» apart from a real answer,
// including a deliberate `null` such as «remove the link».
//
//   title, backLabel, searchLabel  — the words
//   sections(query)   → [{ heading, items: [{ name, meta, value }] }] — empty sections are skipped
//   emptyText(query)  → what to say when nothing at all is listed
//   topAction         → optional { label, value } under the search box (e.g. remove the link)
//   extraAction(query)→ optional { label, value } at the end of the list, or null (e.g. create)
//   chrome            → the page's header classes: { header, slot, title, icon }
//   initialQuery      → open it already searching
export function openPickScreen({
  title, backLabel, searchLabel, sections, emptyText, topAction = null, extraAction = null,
  chrome = {}, initialQuery = '',
}) {
  return new Promise(resolve => {
    let query = String(initialQuery ?? '');

    const list = el('div', { class: 'pick-list' });

    const search = el('input', {
      class: 'pick-search', type: 'search', placeholder: searchLabel, 'aria-label': searchLabel, value: query,
      oninput: e => { query = e.target.value; paint(); },
    });

    function close(value) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    }

    // Escape dismisses — the same answer as Back, never a choice.
    function onKey(e) { if (e.key === 'Escape') close(undefined); }

    function row(item) {
      return el('button', { class: 'pick-row', type: 'button', onclick: () => close(item.value) }, [
        el('span', { class: 'pick-name', text: item.name }),
        item.meta ? el('span', { class: 'pick-meta', text: item.meta }) : null,
      ]);
    }

    function paint() {
      list.replaceChildren();
      let shown = 0;
      for (const section of sections(query) || []) {
        if (!section || !section.items || !section.items.length) continue;
        if (section.heading) list.appendChild(el('div', { class: 'pick-head', text: section.heading }));
        section.items.forEach(item => { list.appendChild(row(item)); shown++; });
      }
      if (!shown) list.appendChild(el('p', { class: 'pick-empty', text: emptyText(query) }));
      const extra = extraAction ? extraAction(query) : null;
      if (extra) {
        list.appendChild(el('button', {
          class: 'pick-extra', type: 'button', text: extra.label, onclick: () => close(extra.value),
        }));
      }
    }

    const overlay = el('div', { class: 'pick-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('header', { class: chrome.header || 'pick-header' }, [
        el('span', { class: chrome.slot || null }, [
          el('button', { class: chrome.icon || null, type: 'button', 'aria-label': backLabel,
            icon: BACK_ICON, onclick: () => close(undefined) }),
        ]),
        el('div', { class: chrome.title || null }, [el('h1', { text: title })]),
        el('span', { class: chrome.slot || null }),
      ]),
      el('div', { class: 'pick-body' }, [
        search,
        // Only offered when the caller has one. An action that does nothing sits exactly
        // where the first result will appear a moment later.
        topAction
          ? el('button', { class: 'pick-top-action', type: 'button', text: topAction.label,
            onclick: () => close(topAction.value) })
          : null,
        list,
      ]),
    ]);

    paint();
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    try { search.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
  });
}
