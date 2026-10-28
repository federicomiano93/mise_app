// from-recipes-view.js — «which recipes should become Food cost products», opened from the
// box at the top of the list.
//
// Federico, 28 Oct 2026: a button lists the recipes that have no product, he unticks what
// he does not want, a confirm, then they are written. ⚠️ NOTHING IS WRITTEN BEFORE THE
// CONFIRM, and Back/Escape only close: a tick selection is not saved data.
// The lists are a snapshot taken when the screen opens (the caller passes them in).
//
// Modelled on vat-guide-view.js. ⚠️ NOT `.preview-overlay`: that class is a busy marker in
// js/update-gate.js, and nothing here can be lost by closing it.

import { t, localeTag } from '../i18n.js';
import { el } from './dom.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// options: { create, maybe, confirm(opts), onCreate(recipes) → Promise<{ made, failed }>,
//           returnFocus() → the element to focus on close (asked THEN: the list may have
//           been redrawn while this was open, and the button that opened it with it) }
export function openFromRecipes({ create = [], maybe = [], confirm, onCreate, returnFocus = null } = {}) {
  // Read here, not at module load: the venue's language arrives after the page starts.
  const kgFormat = new Intl.NumberFormat(localeTag(), { maximumFractionDigits: 2 });
  const ticked = new Map();
  [...create, ...maybe].forEach(item => ticked.set(item, create.includes(item)));

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    try { returnFocus?.()?.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
  };
  // ⚠️ An Escape the confirm dialog has already taken is not ours: it closes the dialog
  // only, never this screen and the ticks on it.
  const onKey = e => {
    if (e.key !== 'Escape' || e.defaultPrevented || busy) return;
    e.preventDefault();
    close();
  };
  let busy = false;

  const back = el('button', {
    class: 'app-icon-btn', type: 'button', icon: BACK_ICON, 'aria-label': t('ui.back'), onclick: close,
  });

  const createBtn = el('button', { class: 'empty-action', type: 'button' });
  const toggleBtn = el('button', { class: 'fc-link', type: 'button' });
  const boxes = new Map();

  const chosen = () => [...ticked].filter(([, on]) => on).map(([item]) => item);

  function sync() {
    if (busy) return;
    const n = chosen().length;
    createBtn.disabled = n === 0;
    createBtn.textContent = n === 0 ? t('fc.fromBook.none') : t('fc.fromBook.create', { n });
    const allOn = create.every(item => ticked.get(item));
    toggleBtn.textContent = allOn ? t('fc.fromBook.untickAll') : t('fc.fromBook.tickAll');
  }

  function metaText(item) {
    if (item.reason === 'used') return t('fc.fromBook.usedIn', { name: item.productName });
    if (item.reason === 'same-name') return t('fc.fromBook.sameName');
    return item.kg > 0
      ? t('fc.fromBook.wholeRecipe', { kg: kgFormat.format(item.kg) })
      : t('fc.fromBook.noWeight');
  }

  function rowFor(item) {
    const box = el('input', { type: 'checkbox' });
    box.checked = ticked.get(item);
    box.addEventListener('change', () => { ticked.set(item, box.checked); sync(); });
    boxes.set(item, box);
    return el('label', { class: 'fc-pick-row' }, [
      box,
      el('span', { class: 'fc-pick-text' }, [
        el('span', { class: 'fc-pick-name', text: String(item.recipe.name || '').trim() }),
        el('span', { class: 'fc-pick-meta', text: metaText(item) }),
      ]),
    ]);
  }

  toggleBtn.addEventListener('click', () => {
    const on = !create.every(item => ticked.get(item));
    create.forEach(item => { ticked.set(item, on); boxes.get(item).checked = on; });
    sync();
  });

  const body = el('div', { class: 'fc-view' }, [
    el('p', { class: 'fc-pick-intro', text: t('fc.fromBook.intro') }),
    create.length ? el('div', { class: 'fc-pick-head' }, [
      el('h2', { class: 'fc-pick-group', text: t('fc.fromBook.toCreate', { n: create.length }) }),
      toggleBtn,
    ]) : null,
    create.length ? el('div', { class: 'fc-pick-list' }, create.map(rowFor)) : null,
    maybe.length ? el('h2', { class: 'fc-pick-group', text: t('fc.fromBook.maybe', { n: maybe.length }) }) : null,
    maybe.length ? el('div', { class: 'fc-pick-list' }, maybe.map(rowFor)) : null,
  ]);

  createBtn.addEventListener('click', async () => {
    const picked = chosen();
    if (!picked.length) return;
    const yes = await confirm({
      title: t('fc.fromBook.confirmTitle', { n: picked.length }),
      message: t('fc.fromBook.confirmMsg'),
      okLabel: t('fc.fromBook.confirmOk'),
      cancelLabel: t('ui.cancel'),
    });
    if (!yes) return;
    // ⚠️ Created on the SERVER, one by one (foodcost-store.js says why), so it takes a
    // moment and can fail offline. While it runs the screen holds still; if nothing could be
    // created it stays open with the ticks as they were, for another try online.
    busy = true;
    createBtn.disabled = true;
    back.disabled = true;
    createBtn.textContent = t('fc.fromBook.creating');
    let result = null;
    try { result = await onCreate?.(picked.map(item => item.recipe)); } catch (e) { result = null; }
    busy = false;
    back.disabled = false;
    if (result && result.failed > 0 && result.made === 0) { sync(); return; }
    close();
  });

  const overlay = el('div', {
    class: 'fc-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fcFromBookTitle',
  }, [
    el('header', { class: 'app-header' }, [
      el('span', { class: 'app-header-slot' }, [back]),
      el('div', { class: 'app-header-title' }, [el('h1', { id: 'fcFromBookTitle', text: t('fc.fromBook.title') })]),
      el('span', { class: 'app-header-slot' }),
    ]),
    el('main', { class: 'fc-screen' }, [body]),
    el('div', { class: 'fc-frombook-bar' }, [createBtn]),
  ]);

  sync();
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  try { back.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
  return { close };
}
