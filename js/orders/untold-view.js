// untold-view.js — the two things the app says when the shared order holds
// something nobody has been told about.
//
// ⚠️⚠️ ONE RULE, TWO SENTENCES, AND THAT IS DELIBERATE. js/orders/untold-changes.js
// answers a single question — "does the order hold more than anybody has been told
// about?" — and this file says it to the two people who can do something about it:
//
//   whoever ORDERS   "the order changed since the last send"   → go and look
//   whoever ADDS     "you have added something since"          → send it again
//
// Two audiences, one fact. If they were computed separately they could disagree, and
// the one that would be wrong is whichever nobody happened to be looking at.
//
// ⚠️ A BANNER, NEVER A DIALOG. The order is typed a keystroke at a time with an
// 800ms autosave, so a dialog would appear under somebody's finger mid-word. It is
// also the reason this project already refuses to make the "did it arrive?" question
// a modal (deliveries-view.js): a box nobody can dismiss strands somebody in the
// middle of service.
//
// ⚠️ AND IT CANNOT BE DISMISSED. There is nothing to tick and nothing to remember:
// it is derived, so it disappears the moment the list is sent again or the order is
// recorded — and until then it is exactly the thing somebody needs to see.

import { t } from '../i18n.js';
import { el } from './dom.js';

const CHEVRON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

// host: the container. groups: untoldChanges() output.
// options: { canManage, canResend }
// callbacks: { onOpen(supplierId), onResend() }
export function renderUntold(host, groups, options = {}, callbacks = {}) {
  if (!host) return;
  host.textContent = '';
  const list = groups || [];
  host.hidden = !list.length;
  if (!list.length) return;

  const { canManage = false, canResend = false } = options;

  list.forEach(group => {
    // ── what was added, and can still be dealt with ──────────────────────────
    if (group.added.length) {
      const text = t('orders.untold.changed', {
        supplier: group.supplierName, n: group.added.length,
      });
      // ⚠️ IT OPENS THE SUPPLIER, NOT THE ORDER LISTS. The rows are on the
      // supplier's own screen, and this can fire with no list involved at all —
      // somebody recorded an order and then somebody else typed more.
      host.appendChild(canManage
        ? el('button', {
          type: 'button', class: 'today-banner untold-banner',
          onClick: () => callbacks.onOpen?.(group.supplierId),
        }, [
          el('span', { class: 'untold-text', text }),
          el('span', { class: 'untold-chevron', 'aria-hidden': 'true', icon: CHEVRON }),
        ])
        : el('div', { class: 'today-banner untold-banner' }, [
          el('span', { class: 'untold-text', text }),
        ]));
    }

    // ── what has already gone out, which the app cannot put right ────────────
    //
    // ⚠️⚠️ ITS OWN BLOCK, IN THE DANGER COLOUR, AND NEVER MIXED WITH THE ABOVE.
    // Federico's decision, 24 Aug 2026. Everything above is an addition somebody
    // still has time to act on; this has already been said down a telephone. The
    // app states what happened and who to ring — it must never suggest it can
    // undo it, because it cannot.
    if (group.afterOrdering.length) {
      host.appendChild(el('div', { class: 'untold-ordered' }, [
        el('span', { class: 'untold-ordered-title', text: t('orders.untold.alreadyTitle') }),
        ...group.afterOrdering.map(row => el('span', {
          class: 'untold-ordered-line',
          text: t('orders.untold.alreadyLine', {
            name: row.name, ordered: row.ordered, live: row.live,
          }),
        })),
        el('span', { class: 'untold-ordered-note', text: t('orders.untold.callSupplier') }),
      ]));
    }
  });

  // ── the way to put it right, for whoever can ────────────────────────────────
  //
  // ⚠️ ONLY WHEN THERE IS SOMEWHERE TO SEND IT. An employee whose venue has the
  // "send to the manager" road switched off has no list to send again, so offering
  // the button would be offering a dead end. Whoever runs the place is not shown it
  // either: they are the person the list would be sent TO.
  if (!canManage && canResend) {
    host.appendChild(el('button', {
      type: 'button', class: 'btn-secondary untold-resend',
      onClick: () => callbacks.onResend?.(),
    }, t('orders.untold.resend')));
  }
}
