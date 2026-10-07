// sent-check-dialog.js — the three-answer dialog behind «Did you send the order?».
//
// confirm-dialog.js has two answers and is copied byte for byte into every feature
// (tests/copie-allineate.test.mjs), so a third answer is built here, in Orders only,
// out of the same .app-dialog-* markup and styles (tokens.css): same z-index, same
// fade + scale (prefers-reduced-motion is switched off there), same focus handling.
//
// sentCheckDialog({ title, yesLabel, sendNowLabel, cancelLabel })
//   -> Promise<'yes' | 'sendNow' | null>   null = Cancel / Escape / backdrop tap.

let isOpen = false;
let seq = 0;

export function sentCheckDialog({ title, yesLabel, sendNowLabel, cancelLabel }) {
  if (isOpen) return Promise.resolve(null);
  isOpen = true;
  const prevFocus = document.activeElement;
  const n = ++seq;

  const backdrop = make('div', 'app-dialog-backdrop');
  const box = make('div', 'app-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const heading = make('h3', 'app-dialog-title', title);
  heading.id = 'sent-check-title-' + n;
  box.setAttribute('aria-labelledby', heading.id);

  const yes = btn('app-dialog-btn-solid', yesLabel);
  // An empty label leaves the button out: no road to send by is open for this person.
  const sendNow = sendNowLabel ? btn('app-dialog-btn-ghost', sendNowLabel) : null;
  const cancel = btn('app-dialog-btn-ghost', cancelLabel);
  const actions = make('div', 'app-dialog-actions sent-check-actions');
  actions.append(...[yes, sendNow, cancel].filter(Boolean));
  box.append(heading, actions);
  backdrop.appendChild(box);

  return new Promise(resolve => {
    const order = [yes, sendNow, cancel].filter(Boolean);
    const done = value => {
      isOpen = false;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (e) { /* focus restore is best-effort */ }
      }
      resolve(value);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      else if (e.key === 'Tab') {
        // Trapped: Tab cycles through the three buttons and never leaves the dialog.
        e.preventDefault();
        const at = order.indexOf(document.activeElement);
        const step = e.shiftKey ? -1 : 1;
        order[(at + step + order.length) % order.length].focus();
      }
    };
    yes.addEventListener('click', () => done('yes'));
    if (sendNow) sendNow.addEventListener('click', () => done('sendNow'));
    cancel.addEventListener('click', () => done(null));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) done(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    yes.focus();
  });
}

function make(tag, cls, text) {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function btn(variant, label) {
  const b = make('button', 'app-dialog-btn ' + variant, label);
  b.type = 'button';
  return b;
}
