// ingredient-merge-screen.js — the screen half of «Unisci un'altra confezione…»: the list of ingredients that
// could be the same product in another pack, and the flow that follows a tap (check where it is used → say what
// will happen → merge). The planning is ingredient-merge.js, the database half ingredient-merge-data.js; the
// registry (registry.js) owns the overlay this list sits in, so Back steps up one level as everywhere (P20).
//
// ⚠️ NO NATIVE DIALOGS: confirmDialog / alertDialog from this feature's own confirm-dialog.js.
// ⚠️ THE LANGUAGE IS READ INSIDE THE FUNCTIONS: no venue is open when this module is first evaluated.

import { t, localeTag } from '../i18n.js';
import { formatPricePerUnit } from '../price-model.js';
import { ingredientDisplayName } from '../ingredient-name.js';
import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { buildSearchBox } from './search-box.js';
import { mergeCandidates } from './ingredient-merge.js';
import { checkUsage, previewMerge, mergeIngredients } from './ingredient-merge-data.js';
import { stopKind } from './invoice-import-plan.js';

const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

// The body of the chooser level: a status line, a hint, a search box and the candidates, most alike first.
//   a        — the ingredient that STAYS (the card that was open)
//   list()   — the live ingredients (with their prices merged in, so each row can say what it costs)
//   onPick(b) — called with the stored ingredient that was tapped
// The returned node carries `setBusy(message | null)`: while a merge is being written the rows are DISABLED (a
// tap is refused, not silently ignored) and the message is announced in the polite status region at the top.
export function buildMergeChooser({ a, list, onPick }) {
  let query = '';
  let busy = false;
  const status = el('p', { class: 'orders-status', role: 'status', 'aria-live': 'polite' });
  const rows = el('div', { class: 'mgmt-list' });
  const empty = el('p', { class: 'mgmt-empty' });

  function paint() {
    const found = mergeCandidates(a, list(), query);
    rows.replaceChildren();
    found.forEach(({ ingredient, label }) => {
      const meta = [ingredient.weight, formatPricePerUnit(ingredient) || null,
        ingredient.active === false ? t('orders.merge.inactive') : null].filter(Boolean).join(' · ');
      rows.appendChild(el('button', {
        type: 'button', class: 'mgmt-item reg-drill' + (ingredient.active === false ? ' inactive' : ''),
        onClick: () => onPick(ingredient),
        ...(busy ? { disabled: 'disabled' } : {}),
      }, [
        el('div', { class: 'mgmt-item-main' }, [
          el('span', { class: 'mgmt-item-name', text: label }),
          el('span', { class: 'mgmt-item-meta', text: meta }),
        ]),
        el('span', { class: 'reg-chevron', 'aria-hidden': 'true', icon: CHEVRON_SVG }),
      ]));
    });
    empty.hidden = found.length > 0;
    empty.textContent = query.trim() ? t('orders.merge.noMatch') : t('orders.merge.none');
  }

  const search = buildSearchBox({
    value: '',
    placeholder: t('orders.merge.search'),
    ariaLabel: t('orders.merge.search'),
    onInput: (text) => { query = text; },
    onChange: paint,
  });
  paint();
  const body = el('div', { class: 'mgmt-scroll' }, [
    status,
    el('p', { class: 'notif-note', text: t('orders.merge.hint', { name: ingredientDisplayName(a) }) }),
    search.node,
    rows,
    empty,
  ]);
  body.setBusy = (message) => {
    busy = Boolean(message);
    status.textContent = message || '';
    rows.querySelectorAll('button').forEach(b => { b.disabled = busy; });
  };
  return body;
}

// «Marzo 2026» for '2026-03', in the INTERFACE language (a date is read by the person reading the screen).
function monthWords(month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return String(month || '');
  return new Intl.DateTimeFormat(localeTag(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

// One place B is used, in plain words.
function usageWords(use) {
  if (use.kind === 'product') return t('orders.merge.usedProduct', { name: use.name });
  if (use.kind === 'recipe') return t('orders.merge.usedRecipe', { name: use.name });
  if (use.kind === 'inventory') return t('orders.merge.usedInventory', { month: monthWords(use.month) });
  if (use.kind === 'request') return t('orders.merge.usedRequest');
  return t('orders.merge.usedDraft');
}

// Why a merge that could not finish is told the way it is. ⚠️ «Nothing changed» is said ONLY when no batch landed:
// after the first commit the honest words are «stopped half way, the copied prices are safe, try again».
function failureText(err) {
  if (err && err.mergeStop === 'gone') return t('orders.merge.gone');
  if (err && err.mergeCommitted === true) return t('orders.merge.interrupted');
  return t(stopKind(err) === 'offline' ? 'orders.merge.offline' : 'orders.merge.failed');
}

// The lines of the confirmation that say what the merge does besides moving prices and codes.
function detailLines(preview, keep, gone) {
  const lines = [];
  if (preview.takeover) {
    lines.push(t('orders.merge.lineTakeover', { keep, name: gone, price: formatPricePerUnit(preview.bPrice) }));
  } else if (preview.bLostPrice === 'history') {
    lines.push(t('orders.merge.lineKept', { name: gone, price: formatPricePerUnit(preview.bPrice) }));
  } else if (preview.bLostPrice === 'lost') {
    lines.push(t('orders.merge.lineLost', { name: gone, price: formatPricePerUnit(preview.bPrice) }));
  }
  if (preview.hasChanges) lines.push(t('orders.merge.lineChanges', { name: gone }));
  return lines;
}

// The flow after a tap on B. → 'merged' | 'cancelled' | 'blocked' | 'failed'. It always ends with the person
// told what happened, and writes nothing until the confirmation is answered «yes».
// onBusy(message | null) is called around the write so the screen can show «Sto unendo…» and lock itself.
export async function runMergeFlow({ a, b, onBusy = () => {} }) {
  const keep = ingredientDisplayName(a);
  const gone = ingredientDisplayName(b);

  let used;
  try {
    used = await checkUsage(b.id);
  } catch (err) {
    console.error('The merge could not check where an ingredient is used:', err);
    await alertDialog(t(stopKind(err) === 'offline' ? 'orders.merge.offline' : 'orders.merge.checkFailed'));
    return 'failed';
  }
  if (used.length > 0) {
    await alertDialog(t('orders.merge.used', { name: gone, where: used.map(usageWords).join(', '), keep }));
    return 'blocked';
  }

  let preview;
  try {
    preview = await previewMerge(a, b);
  } catch (err) {
    console.error('The merge could not read what it would move:', err);
    await alertDialog(failureText(err));
    return 'failed';
  }
  const counts = preview.counts;
  const lines = [t('orders.merge.confirmMessage', {
    prices: t('orders.merge.countPrices', { n: counts.prices }),
    codes: t('orders.merge.countCodes', { n: counts.codes }),
    name: gone,
    keep,
  })];
  if (counts.droppedCodes > 0) lines.push(t('orders.merge.droppedCodes', { n: counts.droppedCodes }));
  lines.push(...detailLines(preview, keep, gone));
  const ok = await confirmDialog({
    title: t('orders.merge.confirmTitle', { name: gone, keep }),
    message: lines.join(' '),
    okLabel: t('orders.merge.confirmOk'),
    cancelLabel: t('ui.cancel'),
    danger: true,
  });
  if (!ok) return 'cancelled';

  onBusy(t('orders.merge.working'));
  try {
    await mergeIngredients(a, b);
    return 'merged';
  } catch (err) {
    if (err && err.mergeStop === 'used') {
      onBusy(null);
      await alertDialog(t('orders.merge.used', { name: gone, where: err.used.map(usageWords).join(', '), keep }));
      return 'blocked';
    }
    console.error('The merge stopped (nothing is lost; a second try finishes it):', err);
    onBusy(null);
    await alertDialog(failureText(err));
    return 'failed';
  } finally {
    onBusy(null);
  }
}
