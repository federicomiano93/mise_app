// send-sheet.js — «how do you want to send it?», for every screen that hands a piece
// of text to a person.
//
// ⚠️⚠️ IT IS THE SAME QUESTION ORDERS HAS ASKED SINCE v1.55.0, ASKED IN THE SAME BOX.
// Federico, 24 Aug 2026, looking at the recipe card's three side-by-side buttons:
// «togli la casella whatsapp e email e metti una freccia per inviare che poi mi fa
// scegliere come inviarlo», and then «usa le stesse frecce di invio uguali in tutta
// l'app». Orders already had exactly that — a send arrow that opens a list of roads —
// so this is not a new mechanism, it is that one made reachable from anywhere.
//
// ⚠️ NOT navigator.share(), AND THAT IS HIS DECISION AS WELL AS THE FILE'S. Asked
// between the phone's own share sheet and the app's, he chose the app's: the phone's
// looks different on every device, does not exist in some desktop browsers, and would
// be a SECOND mechanism standing beside the one Orders uses for every order — the
// opposite of «tutte uguali». js/share.js has said the same thing in prose for months:
// «when the whole app moves, this moves with it». This is that move.
//
// ⚠️ WHY IT IS AT THE ROOT AND BUILDS ITS OWN DOM. js/orders/send-chooser.js knows about
// suppliers, four roads and who may take them; that stays where it is. What is shared is
// the SHELL — and a root module may not import js/orders/dom.js any more than the
// Catalogue may. So it uses document APIs directly, like js/confirm-dialog.js, which is
// also why its styles live in tokens.css: catalogue.html loads neither orders.css nor
// style.css, and a look that must be identical everywhere cannot live in one feature's
// stylesheet.
//
// ⚠️ IT ANSWERS ESCAPE, TRAPS TAB AND GIVES FOCUS BACK — which the Orders chooser it is
// modelled on does not. Copied from js/confirm-dialog.js rather than invented; the two
// are the only modal shapes in the app and they should behave the same.

import { t } from './i18n.js';
import { WHATSAPP_PATHS, EMAIL_PATHS, svgElement } from './send-icon.js';
import { sendOnWhatsApp, sendByEmail } from './share.js';

let isOpen = false;   // one at a time; a re-entrant open resolves null
let seq = 0;

// The roads this sheet offers, in the order they are drawn. Both are always open: unlike
// an order, a piece of text needs no phone number and no address to be handed over.
const ROADS = [
  { id: 'whatsapp', paths: WHATSAPP_PATHS, key: 'send.whatsapp', note: null },
  { id: 'email', paths: EMAIL_PATHS, key: 'send.email', note: 'send.emailOpensApp' },
];

// chooseHowToSend({ subject, text }) -> Promise<'whatsapp' | 'email' | null>
//
// `subject` is only used by the mail road, which needs one; WhatsApp carries the text
// alone. Resolves null when the person backs out — Escape, Cancel, or the backdrop.
export function chooseHowToSend({ subject = '', text = '' } = {}) {
  if (isOpen) return Promise.resolve(null);
  if (!String(text).trim()) return Promise.resolve(null);   // never open an empty chat
  isOpen = true;

  const n = ++seq;
  const prevFocus = document.activeElement;
  const backdrop = make('div', 'app-dialog-backdrop send-chooser');
  const box = make('div', 'app-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');

  const title = make('h2', 'app-dialog-title', t('send.how'));
  title.id = `send-sheet-title-${n}`;
  box.setAttribute('aria-labelledby', title.id);
  box.appendChild(title);

  const list = make('div', 'send-routes');
  const buttons = ROADS.map((road) => {
    const b = make('button', 'send-route');
    b.type = 'button';
    const icon = make('span', 'send-route-icon');
    icon.appendChild(svgElement(road.paths, 22));
    const textCol = make('span', 'send-route-text');
    textCol.appendChild(make('span', 'send-route-name', t(road.key)));
    // ⚠️ THE COST OF A ROAD IS SAID BEFORE IT IS TAKEN — mailto OPENS the mail app, it
    // does not send. Believing a declaration has gone out when it is sitting in a draft
    // is the one way this sheet can mislead.
    if (road.note) textCol.appendChild(make('span', 'send-route-note', t(road.note)));
    b.appendChild(icon);
    b.appendChild(textCol);
    list.appendChild(b);
    return { road, b };
  });
  box.appendChild(list);

  const actions = make('div', 'app-dialog-actions');
  const cancel = make('button', 'app-dialog-btn app-dialog-btn-ghost', t('ui.cancel'));
  cancel.type = 'button';
  actions.appendChild(cancel);
  box.appendChild(actions);
  backdrop.appendChild(box);

  return new Promise((resolve) => {
    const focusable = () => [...buttons.map(x => x.b), cancel];
    const done = (value) => {
      isOpen = false;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (e) { /* focus restore is best-effort */ }
      }
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const all = focusable();
      const at = all.indexOf(document.activeElement);
      const next = e.shiftKey ? at - 1 : at + 1;
      all[(next + all.length) % all.length].focus();
    };
    buttons.forEach(({ road, b }) => b.addEventListener('click', () => {
      // ⚠️ THE SHEET CLOSES BEFORE THE ROAD IS TAKEN. Both roads open a new window, and
      // on a phone that leaves the app entirely — coming back to a dialog still sitting
      // open over the screen reads as a send that did not happen.
      done(road.id);
      if (road.id === 'whatsapp') sendOnWhatsApp(text);
      else sendByEmail(subject, text);
    }));
    cancel.addEventListener('click', () => done(null));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    buttons[0].b.focus();
  });
}

function make(tag, cls, text) {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}
