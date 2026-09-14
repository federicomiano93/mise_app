// foodcost-settings.js — the Food cost settings: what an hour of work costs this venue.
//
// Federico, 13 Sep 2026: «potremmo anche mettere una sezione dove io metto il costo del
// lavoro orario e l'app mi dice quanto è il costo del lavoro per quella ricetta». One
// number for the venue; the minutes and the people are on each product.
//
// ⚠️ ONLY WHOEVER RUNS THE PLACE REACHES THIS SCREEN, and the rules say the same whatever
// it draws (P2): the rate is a wage figure, and employees shown Food cost do not see it.
// ⚠️ THE EDITING PATTERN IS THE APP'S (P20): nothing is saved until Save, Save asks
// first, and leaving with a changed number asks before throwing it away.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { currentCurrency } from '../currency.js';
import { positiveNumber } from '../price-model.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// options: { rate, confirm(options) → Promise<bool>, onSave(rate|null) → Promise, toast, returnFocus }
export function openFoodcostSettings({ rate = null, confirm, onSave, toast, returnFocus = null } = {}) {
  const stored = positiveNumber(rate);

  const input = el('input', {
    id: 'fcLabourRate', class: 'fc-input fc-number', type: 'number', min: '0', step: 'any',
    inputmode: 'decimal', placeholder: '0', 'aria-label': t('fc.settings.labourRateAs'),
    value: stored === null ? '' : String(stored),
  });
  const typed = () => positiveNumber(input.value);
  const changed = () => typed() !== stored;

  let busy = false;

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    try { returnFocus?.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
  }

  async function leave() {
    if (busy) return;
    if (changed()) {
      const ok = await confirm({
        title: t('fc.discardChanges'), message: t('fc.youHaveUnsavedChanges'),
        okLabel: t('ui.discard'), cancelLabel: t('ui.cancel'), danger: true,
      });
      if (!ok) return;
    }
    close();
  }

  async function save() {
    if (busy) return;
    busy = true;
    const ok = await confirm({ title: t('fc.settings.saveQ'), message: t('fc.saveTheseChanges'), okLabel: t('ui.save'), cancelLabel: t('ui.cancel') });
    if (!ok) { busy = false; return; }
    try {
      await onSave(typed());
      toast?.(t('fc.settings.saved'));
      busy = false;
      close();
    } catch (err) {
      console.warn('The hourly labour cost did not save:', err);
      busy = false;
      toast?.(t('fc.settings.couldNotSave'));
    }
  }

  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.app-dialog')) { e.preventDefault(); leave(); } };

  const back = el('button', { class: 'fc-icon-btn', type: 'button', icon: BACK_ICON, 'aria-label': t('ui.back'), onclick: leave });

  const overlay = el('div', {
    class: 'fc-overlay fc-settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fcSettingsTitle',
  }, [
    el('header', { class: 'fc-header' }, [
      el('span', { class: 'fc-header-slot' }, [back]),
      el('div', { class: 'fc-header-title' }, [el('h1', { id: 'fcSettingsTitle', text: t('fc.settings.title') })]),
      el('span', { class: 'fc-header-slot' }),
    ]),
    el('main', { class: 'fc-screen' }, [
      el('div', { class: 'fc-view' }, [
        el('div', { class: 'fc-field' }, [
          el('label', { class: 'fc-label', for: 'fcLabourRate', text: t('fc.settings.labourRate', { currency: currentCurrency() }) }),
          input,
          el('p', { class: 'fc-note', text: t('fc.settings.labourRateNote') }),
        ]),
        el('div', { class: 'fc-actions' }, [
          el('button', { class: 'fc-save', type: 'button', text: t('ui.save'), onclick: save }),
        ]),
      ]),
    ]),
  ]);

  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  try { input.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
  return { close };
}
