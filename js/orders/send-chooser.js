// send-chooser.js — "how should this order go?", once there is more than one answer.
//
// The deciding is in the pure js/orders/send-routes.js; this is the screen and the
// four links it opens.
//
// ⚠️ WITH ONE ROAD OPEN IT ASKS NOTHING. A question with a single answer is a tap
// wasted on every order, every day, for no information.

import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { el } from './dom.js';
import { alertDialog, confirmDialog } from './confirm-dialog.js';
import { buildOrderMessage, whatsappUrl, emailSubject } from './order-text.js';
import { routesFor, routeAvailableFor, unreachable, routeSendsToSupplier } from './send-routes.js';
import { WHATSAPP_PATHS, EMAIL_PATHS, svgFrom } from '../send-icon.js';
import { canSharePhotos, renderOrderImage, sharePhoto } from './order-image.js';

// ⚠️ THE TWO SHARED GLYPHS COME FROM js/send-icon.js SINCE 24 Aug 2026, because the
// same speech bubble and the same envelope are now drawn by the sheet every OTHER
// screen opens (js/send-sheet.js). Two copies of a glyph are two glyphs waiting to
// disagree, and this project already keeps a whole test for that class of drift.
// The other two are this screen's own: nothing outside Orders has a manager to send to,
// or a supplier with a number of their own.
const ICONS = {
  manager: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4"/></svg>',
  whatsapp: svgFrom(WHATSAPP_PATHS, 22),
  whatsappSupplier: svgFrom([...WHATSAPP_PATHS, 'M12 8v5M9.5 10.5L12 8l2.5 2.5'], 22),
  email: svgFrom(EMAIL_PATHS, 22),
};

// The two that address one supplier each.
const PER_SUPPLIER = new Set(['whatsappSupplier', 'email']);

// Which roads this person could take with these suppliers, each with the sentence
// the screen shows under it.
export function offerFor({ settings, canManage, suppliers }) {
  return routesFor(settings, { canManage }).map(route => {
    const perSupplier = PER_SUPPLIER.has(route);
    const cannot = unreachable(route, suppliers);
    const reachable = suppliers.filter(s => routeAvailableFor(route, s));

    let note = '';
    // ⚠️ THE COST OF A DIRECT ROAD IS SAID BEFORE IT IS TAKEN. One message per
    // supplier means one chat at a time: with three suppliers that is three trips
    // out of the app and back. Discovering that halfway through is how somebody
    // sends the first and forgets the other two.
    if (perSupplier && reachable.length > 1) {
      note = t('orders.send.onePerSupplier', { n: reachable.length });
    }
    // ⚠️ AND WHO CANNOT BE REACHED IS NAMED, never silently dropped. A supplier
    // missing from a send nobody mentioned is an order that simply never happened.
    if (cannot.length) {
      const missing = t('orders.send.noContact', { n: cannot.length,
        names: cannot.map(s => supplierLabel(s)).join(', ') });
      note = note ? `${note} · ${missing}` : missing;
    }
    return { route, perSupplier, reachable, cannot, note, usable: reachable.length > 0 };
  });
}

// Ask, then act. `rows` are the picked suppliers ({ id, name, items }).
export function chooseAndSend({ rows, settings, canManage, suppliers, locationName, language, grouped,
                               onSendToManager, onSent, beforeSend }) {
  const offers = offerFor({ settings, canManage, suppliers }).filter(o => o.usable);

  if (!offers.length) {
    // Cannot happen through the settings screen, which refuses to close the last
    // road — but a hand-written document could, and the app must say so rather
    // than do nothing when the button is pressed.
    return alertDialog(t('orders.send.noRouteAvailable'));
  }
  if (offers.length === 1) return take(offers[0]);

  return new Promise(resolve => {
    const overlay = el('div', { class: 'app-dialog-backdrop send-chooser' }, [
      el('div', { class: 'app-dialog' }, [
        el('h2', { class: 'app-dialog-title', text: t('orders.send.howTitle') }),
        el('div', { class: 'send-routes' }, offers.map(o => el('button', {
          class: 'send-route', type: 'button',
          onclick: () => { overlay.remove(); resolve(take(o)); },
        }, [
          el('span', { class: 'send-route-icon', icon: ICONS[o.route] }),
          el('span', { class: 'send-route-text' }, [
            el('span', { class: 'send-route-name', text: t(`orders.send.route.${o.route}`) }),
            o.note ? el('span', { class: 'send-route-note', text: o.note }) : null,
          ]),
        ]))),
        el('div', { class: 'app-dialog-actions' }, [
          el('button', {
            class: 'app-dialog-btn app-dialog-btn-ghost', type: 'button',
            text: t('ui.cancel'), onclick: () => { overlay.remove(); resolve(false); },
          }),
        ]),
      ]),
    ]);
    document.body.appendChild(overlay);
    overlay.querySelector('.send-route')?.focus();
  });

  function take(offer) {
    // ⚠️ ASKED HERE, WHERE THE ROAD IS KNOWN, AND ONLY FOR ROADS THAT REACH THE SUPPLIER.
    // `beforeSend` answers false at once when all is well (so window.open below stays inside
    // the tap), or a promise once it has refused and said why — then nothing is sent.
    if (beforeSend && routeSendsToSupplier(offer.route)) {
      const refused = beforeSend(rows);
      if (refused) return refused.then(() => false);
    }
    if (offer.route === 'manager') { onSendToManager?.(rows.map(r => r.id)); return true; }

    const message = supplierName => buildOrderMessage(
      rows.filter(r => !supplierName || r.name === supplierName)
        .map(r => ({ supplierName: r.name, items: r.items })),
      { grouped, locationName, language });

    if (offer.route === 'whatsapp') {
      const text = message(null);
      if (!text) return false;               // never open an empty chat
      return viaWhatsapp([{ ids: rows.map(r => r.id), text, url: whatsappUrl(text) }]);
    }

    // ⚠️ ONE MESSAGE PER SUPPLIER, AND ONLY TO THE ONES IT CAN REACH. The rows are
    // matched to their supplier by ID rather than by name: two suppliers can share
    // a name, and the wrong order going to the wrong supplier is the one mistake
    // this feature must not be able to make.
    const sent = [];
    const jobs = [];
    offer.reachable.forEach(supplier => {
      const row = rows.find(r => r.id === supplier.id);
      if (!row) return;
      const text = buildOrderMessage([{ supplierName: row.name, items: row.items }],
        { grouped: true, locationName, language });
      if (!text) return;
      if (offer.route === 'email') {
        window.open(mailto(supplier.email, emailSubject(locationName, language), text), '_blank');
        sent.push(supplier.id);
      } else {
        jobs.push({ ids: [supplier.id], name: supplierLabel(supplier), text,
          url: `https://wa.me/${digitsOf(supplier.phone)}?text=${encodeURIComponent(text)}` });
      }
    });
    if (offer.route !== 'email') return viaWhatsapp(jobs);
    if (sent.length) onSent?.(sent);
    return sent.length > 0;
  }

  // ⚠️ THE TWO WHATSAPP ROADS ONLY. With a browser that can share a PNG the person is asked
  // «photo or text» (photo first); without one nothing is asked and the text goes exactly as
  // before, synchronously, so window.open stays inside the tap.
  function viaWhatsapp(jobs) {
    if (!jobs.length) return false;
    const finish = sentIds => {
      if (sentIds.length) onSent?.(sentIds);
      return sentIds.length > 0;
    };
    if (!canSharePhotos()) return finish(sendTexts(jobs, openTab));
    return askFormat().then(async format => {
      if (!format) return false;
      if (format === 'text') return finish(sendTexts(jobs, openTab));
      // ⚠️ ALL THE PICTURES ARE DRAWN FIRST, then one dialog per picture whose own tap starts
      // the share: navigator.share() needs a fresh tap each time (Safari and Chrome both), and
      // the share sheet must never be opened by a timer or by the previous one closing.
      let files;
      try {
        files = await Promise.all(jobs.map(j => renderOrderImage(j.text, { language })));
      } catch {
        // OK sends the text; Cancel or Escape sends and counts nothing.
        if (!await confirmText()) return false;
        return finish(sendTexts(jobs, openTab));
      }
      return finish(await runPhotoBatch({
        jobs, files, ask: photoDialog, notify: alertDialog, confirmText, open: openTab,
      }));
    });
  }
}

const openTab = url => window.open(url, '_blank');

// «Couldn't share the photo, sending the text instead.» with OK / Cancel: only a tap on OK
// opens the text, so Escape can never open or count anything.
const confirmText = () => confirmDialog({
  message: t('orders.sendFormat.photoFailed'), cancelLabel: t('ui.cancel'),
});

// Text road: open each url. Record only if the chat window actually opened (a blocked pop-up
// returns null — counting it would mark an order as sent that nobody saw).
export function sendTexts(jobs, open) {
  const sent = [];
  jobs.forEach(j => { if (open(j.url)) sent.push(...j.ids); });
  return sent;
}

// Settle a dialog's promise once. A second answer (a share() that resolves after Skip or
// Cancel, or after the dialog moved on) is ignored, so nothing is ever counted twice and a
// picture the person skipped stays NOT sent.
export function settleOnce(resolve, cleanup = () => {}) {
  let settled = false;
  return value => {
    if (settled) return false;
    settled = true;
    cleanup();
    resolve(value);
    return true;
  };
}

// What a share() result means for the dialog that started it: a resolved share is done; the
// person closing the sheet leaves the dialog open (nothing sent, they can retry, skip or
// cancel); anything else is a failure.
export function afterShare(result) {
  return result === 'shared' ? 'shared' : result === 'cancelled' ? 'again' : 'failed';
}

// One picture at a time. `ask({ job, file, i, n })` resolves 'shared' | 'skipped' | 'cancelled'
// | 'failed'; it is the dialog whose click handler calls share() itself.
//   shared    → sent
//   skipped   → not sent, carry on
//   cancelled → not sent, and so is everything after it
//   failed    → ask OK/Cancel; on OK THIS supplier's text is opened and counted as sent only if
//               the window really opened; Cancel or Escape = not sent, carry on
// Returns the ids that were sent. Who was not sent is named afterwards (suppliers only: the
// single grouped chat has no name to give).
export async function runPhotoBatch({ jobs, files, ask, notify, confirmText: confirmFallback, open }) {
  const sent = [];
  const notSent = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const outcome = await ask({ job, file: files[i], i, n: jobs.length });
    if (outcome === 'shared') { sent.push(...job.ids); continue; }
    if (outcome === 'failed') {
      if (await confirmFallback() && open(job.url)) sent.push(...job.ids);
      else notSent.push(job);
      continue;
    }
    notSent.push(job);
    if (outcome === 'cancelled') { notSent.push(...jobs.slice(i + 1)); break; }
  }
  const names = notSent.map(j => j.name).filter(Boolean);
  if (names.length) await notify(t('orders.sendFormat.notSent', { names: names.join(', ') }));
  return sent;
}

let dialogSeq = 0;

// The shell both questions share: named by its title, Escape cancels, Tab stays inside, focus
// goes back where it was (copied from confirm-dialog.js, which the roads chooser lacks).
function modalShell({ title, body, actions, onCancel }) {
  const prevFocus = document.activeElement;
  const titleId = `send-chooser-title-${++dialogSeq}`;
  const box = el('div', {
    class: 'app-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
  }, [
    el('h2', { class: 'app-dialog-title', id: titleId, text: title }),
    ...body,
    el('div', { class: 'app-dialog-actions' }, actions),
  ]);
  const overlay = el('div', { class: 'app-dialog-backdrop send-chooser' }, [box]);
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...box.querySelectorAll('button:not([disabled])')];
    if (!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  (box.querySelector('.send-route') || box.querySelector('.app-dialog-btn-solid'))?.focus();
  return {
    close() {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch { /* best effort */ }
      }
    },
  };
}

// «Photo or text?» — Escape or Cancel = null, nothing sent.
function askFormat() {
  return new Promise(resolve => {
    let shell;
    const done = value => { shell.close(); resolve(value); };
    const choice = (key, value, primary) => el('button', {
      class: 'send-route' + (primary ? ' send-route-primary' : ''), type: 'button',
      onclick: () => done(value),
    }, [el('span', { class: 'send-route-text' }, [
      el('span', { class: 'send-route-name', text: t(key) }),
    ])]);
    shell = modalShell({
      title: t('orders.sendFormat.title'),
      body: [el('div', { class: 'send-routes' }, [
        choice('orders.sendFormat.photo', 'photo', true),
        choice('orders.sendFormat.text', 'text', false),
      ])],
      actions: [el('button', { class: 'app-dialog-btn app-dialog-btn-ghost', type: 'button',
        text: t('ui.cancel'), onclick: () => done(null) })],
      onCancel: () => done(null),
    });
  });
}

// The dialog for ONE picture. ⚠️ THE SHARE IS STARTED SYNCHRONOUSLY INSIDE THE CLICK HANDLER
// — no await before it — because the browser only lets share() through on a fresh tap.
function photoDialog({ job, file, i, n }) {
  return new Promise(resolve => {
    let shell;
    const onVisible = () => {
      // Back from the share sheet with the promise still pending: let them try again.
      if (document.visibilityState === 'visible') shareBtn.disabled = false;
    };
    const done = settleOnce(resolve, () => {
      document.removeEventListener('visibilitychange', onVisible);
      shell.close();
    });
    const shareBtn = el('button', { class: 'app-dialog-btn app-dialog-btn-solid', type: 'button',
      text: t('orders.sendFormat.share') });
    const otherBtn = el('button', { class: 'app-dialog-btn app-dialog-btn-ghost', type: 'button',
      text: n > 1 ? t('orders.sendFormat.skip') : t('ui.cancel') });
    shareBtn.addEventListener('click', () => {
      // Only «Share» is disabled while the sheet is open: a share() that never settles must
      // not lock Skip, Cancel or Escape.
      shareBtn.disabled = true;
      sharePhoto(file).then(result => {
        const next = afterShare(result);
        if (next === 'again') { shareBtn.disabled = false; shareBtn.focus(); return; }
        done(next);
      });
    });
    otherBtn.addEventListener('click', () => done(n > 1 ? 'skipped' : 'cancelled'));
    document.addEventListener('visibilitychange', onVisible);
    shell = modalShell({
      title: job.name
        ? t('orders.sendFormat.shareFor', { name: job.name, i: i + 1, n })
        : t('orders.sendFormat.shareReady'),
      body: [],
      actions: [otherBtn, shareBtn],
      onCancel: () => done('cancelled'),
    });
  });
}

// ⚠️ DIGITS ONLY. wa.me refuses a number carrying spaces, brackets or a leading
// "+", and refuses it by opening a page that says the number is invalid — which
// reads as the app being broken rather than the number needing tidying.
export function digitsOf(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// ⚠️ mailto OPENS THE MAIL APP; IT DOES NOT SEND. That is the honest limit of doing
// this without a server, and the screen says so rather than letting somebody believe
// an order has gone.
export function mailto(address, subject, body) {
  return `mailto:${encodeURIComponent(String(address || '').trim())}`
    + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
