// place-confirm.js — what is about to be recorded, shown before it is recorded.
//
// ⚠️⚠️ THE DEFECT THIS SCREEN EXISTS TO CLOSE. "Order placed" used to raise a
// confirm dialog that named the supplier and the day, and then archive whatever
// was in the SHARED order at that instant — which is not necessarily what the
// person tapping had read. order-request-model.js says so about itself: "a manager
// reading 4 on this screen and tapping Order placed can record 6, with nothing
// saying so". The shared order is live on every phone in the building, so between
// reading a list and tapping the button somebody else can have changed it.
//
// Federico's rule, 24 Aug 2026: WHAT COUNTS IS WHAT THE PERSON WHO PLACES THE
// ORDER CONFIRMS. If an employee sends a list to whoever orders, the manager's
// confirmation is the order; if the employee orders straight from the supplier,
// theirs is. It is one rule, not two — only the person tapping changes — which is
// why there is no setting anywhere for it.
//
// ⚠️ IT IS A WORKING COPY (P20). Nothing is written until the green button is
// tapped: not History, not the shared order. Going back leaves no trace.
//
// ⚠️ AND IT IS `.preview-overlay`, WHICH IS IN BUSY_SELECTORS (js/update-gate.js),
// so a compulsory app update cannot reload the page out from under corrections
// that have been typed but not yet recorded.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { alertDialog } from './confirm-dialog.js';
import { wholeNumber as num } from './archive.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// options:
//   title, okLabel  — the words in the header and on the green button
//   groups          — [{ supplierId, supplierName, when, already, rows }]
//                     rows: [{ id, name, unit, qty, asked }]
//                     `asked` is what today's sent lists asked for, or undefined
//                     when nothing was sent — NOT 0, which would read as "they
//                     asked for none of it".
//   usualFor(id, qty) -> number | null
//                     the usual amount when this quantity looks like a typing
//                     mistake, null otherwise. Injected rather than imported so
//                     this file stays free of the suggestion engine and of state.
// callbacks: { onBack, onConfirm(result) }
//   result: { [supplierId]: { [ingredientId]: qty } } — quantities only, and only
//   the ones above zero.
export function buildPlaceConfirm(options, callbacks) {
  const { title, okLabel, groups = [], usualFor = () => null } = options || {};
  const scroll = el('div', { class: 'preview-scroll' });
  const inputs = [];               // { supplierId, id, input, unusual }

  scroll.appendChild(el('p', { class: 'pc-lead', text: t('orders.confirm.aboutToRecord') }));

  // ⚠️ THE EXTRA-DIGIT NUDGE SURVIVED THE DIALOG THIS SCREEN REPLACED, and it had
  // to: "usually about 4" beside a 40 states a fact, while this says what to do
  // about it. Shown once, and only while some row is actually odd — a warning that
  // is always there is a warning nobody reads.
  const digitWarning = el('p', {
    class: 'pc-warn', hidden: 'hidden', text: t('orders.checkExtraDigit'),
  });
  scroll.appendChild(digitWarning);

  groups.forEach(group => {
    // ⚠️ THE SUPPLIER IS NAMED EVEN WHEN THERE IS ONLY ONE. The header names it
    // too, but the header scrolls away and this list can be long enough to
    // scroll — and there is exactly one question worth never getting wrong here,
    // which is whose order is being recorded.
    scroll.appendChild(el('div', { class: 'req-group-head' }, [
      el('span', { class: 'req-group-name', text: group.supplierName }),
      group.when ? el('span', { class: 'req-group-count', text: group.when }) : null,
    ]));

    // A second order to the same supplier on the same day ADDS to the first
    // (archive.js mergeArchives). That is the safe arithmetic — it can never lose
    // the first order — but it is a surprise unless it is said here.
    if (group.already) {
      scroll.appendChild(el('p', {
        class: 'pc-note pc-note--adds',
        text: t('orders.confirm.addsToExisting', {
          supplier: group.supplierName, when: group.when || '',
        }),
      }));
    }

    (group.rows || []).forEach(row => {
      const input = el('input', {
        type: 'number', class: 'ing-qty', min: '0', inputmode: 'numeric',
        'aria-label': `${row.name} — ${t('orders.field.order')}`,
      });
      input.value = num(row.qty);

      // "usually about N" sits on the LINE the number is on, never in a paragraph
      // above it. The old dialog listed the odd rows as prose, which meant reading
      // a name in a sentence and then hunting for it again in the order.
      const unusual = el('span', { class: 'pc-unusual', hidden: 'hidden' });

      const notes = [];
      // ⚠️ `undefined` MEANS "NOBODY ASKED"; `0` WOULD MEAN "THEY ASKED FOR NONE".
      // Only draw it when a sent list actually carried this line and disagrees.
      if (row.asked !== undefined && num(row.asked) !== num(row.qty)) {
        notes.push(el('span', {
          class: 'pc-asked', text: t('orders.confirm.asked', { n: num(row.asked) }),
        }));
      }
      notes.push(unusual);

      const record = { supplierId: group.supplierId, id: row.id, input, unusual };
      inputs.push(record);
      input.addEventListener('input', () => paintUnusual(record));

      scroll.appendChild(el('div', { class: 'pc-row' }, [
        el('div', { class: 'pc-row-main' }, [
          el('span', { class: 'pc-row-name', text: row.name }),
          el('div', { class: 'pc-row-notes' }, notes),
        ]),
        el('div', { class: 'pc-row-input' }, [
          input,
          row.unit ? el('span', { class: 'ing-order-unit', text: row.unit }) : null,
        ]),
      ]));
      paintUnusual(record);
    });
  });

  scroll.appendChild(el('p', { class: 'pc-note', text: t('orders.setAQuantityTo') }));
  scroll.appendChild(el('p', { class: 'pc-note', text: t('orders.confirm.sendFirst') }));

  // Recomputed on every keystroke, from the number in the box — so correcting an
  // extra digit makes the warning go away instead of contradicting the screen.
  function paintUnusual(record) {
    const qty = num(record.input.value);
    const usual = usualFor(record.id, qty);
    const quiet = usual === null || usual === undefined;
    record.unusual.hidden = quiet;
    record.unusual.textContent = quiet ? '' : t('orders.confirm.usually', { n: usual });
    record.input.classList.toggle('pc-qty--unusual', !quiet);
    // Derived from the rows, never set by hand, so it can never disagree with them.
    digitWarning.hidden = !inputs.some(r => !r.unusual.hidden);
  }

  const okBtn = el('button', { type: 'button', class: 'btn-primary', onClick: submit }, okLabel);

  function collect() {
    const out = {};
    inputs.forEach(({ supplierId, id, input }) => {
      const qty = num(input.value);
      if (qty <= 0) return;
      (out[supplierId] = out[supplierId] || {})[id] = qty;
    });
    return out;
  }

  async function submit() {
    const result = collect();
    // Every line zeroed is not an order. Say so rather than writing nothing and
    // looking exactly like a tap the app ignored — the silence defect of v186.
    if (!Object.keys(result).length) {
      await alertDialog(t('orders.confirm.allZero'), { title: t('orders.nothingLeftToRecord') });
      return;
    }
    callbacks.onConfirm(result);
  }

  return el('div', { class: 'preview-overlay pc-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': t('ui.back'),
        icon: BACK_ICON, onClick: () => callbacks.onBack(),
      }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: title })]),
      // Keeps the title centred: the back button on the left needs a counterweight.
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    scroll,
    el('div', { class: 'preview-footer' }, [okBtn]),
  ]);
}
