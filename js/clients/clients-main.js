// clients-main.js — entry point of clients.html, the sales owner's Clients page.
//
// «Titolare vendita» ('owner-sales') runs the clients but has no Calculator, so this page
// is their one way to the address book, the orders clients sent and the deadline for them.
// It reuses the Calculator's own screens rather than copying them: the editor
// (js/clients-editor.js), the received-orders screen and the deadline screen
// (js/calculator-client-orders.js), all fed by the same config store — in its
// «only the address book» mode, so every save sends just the clients (the rules refuse
// this role the rest of config/calculator).
//
// One door of its own: «tell me when a client orders», a notification switch.

import { t, onLanguageChange } from '../i18n.js';
import { onSession } from '../firebase.js';
import { cardVisibleTo } from '../home-cards.js';
import { initConfig, canSyncConfig, configDocMissing } from '../calculator-config-store.js';
import { openClients } from '../clients-editor.js';
import {
  initClientOrders, repaintClientOrders, openScreen,
} from '../calculator-client-orders.js';
import { el } from '../calculator-render.js';
import { alertDialog } from '../confirm-dialog.js';
import { pushOnForMe, pushSupport, enablePush, disablePush, supportText } from '../push.js';

// ── The door to the editor ───────────────────────────────────────────────────
// ⚠️ THE SAFETY GUARD: the door stays DISABLED until the server has answered. On a fresh
// phone getConfig() holds an empty default until then, and opening the editor and saving
// from it would overwrite the real address book with that empty one. The config store
// calls onConfig on its first server answer (and on every change after), which is when
// canSyncConfig() turns true and the door opens. Texts are read at paint time (t()), so a
// language that arrives late is the one drawn.
function paintClientsDoor() {
  const door = document.getElementById('open-clients-btn');
  const sub = document.getElementById('open-clients-sub');
  if (!door) return;
  // The rules let this role change the document, never start it: a venue that has none yet
  // hears so here, before typing an address book it could not save.
  const missing = configDocMissing();
  const ready = canSyncConfig() && !missing;
  door.disabled = !ready;
  if (sub) {
    sub.textContent = missing ? t('clients.noConfigYet')
      : ready ? t('ui.clientsAndTheProducts') : t('calc.loading');
  }
}

function onConfig() {
  paintClientsDoor();
  // The client names on the orders come from the config, which can arrive after them.
  repaintClientOrders();
}

// ── The notifications switch ─────────────────────────────────────────────────
let pushSavedTimer = null;
function flashPushSaved() {
  const tag = document.getElementById('clients-push-saved');
  if (!tag) return;
  tag.hidden = false;
  clearTimeout(pushSavedTimer);
  pushSavedTimer = setTimeout(() => { tag.hidden = true; }, 2000);
}

// What the row says and whether it can be tapped, from what this phone can do.
function pushRowState() {
  if (pushOnForMe()) return { on: true, disabled: false, sub: supportText('granted') };
  const support = pushSupport();
  // «Granted» without a registration in this person's name (a shared phone) is the same
  // offer as «ask»: tapping the switch registers it again.
  if (support.reason === 'ask' || support.reason === 'granted') {
    return { on: false, disabled: false, sub: t('clients.push.ask') };
  }
  return { on: false, disabled: true, sub: supportText(support.reason) };
}

function paintPushRow() {
  const host = document.getElementById('clients-push-row');
  if (!host) return;
  host.textContent = '';
  const state = pushRowState();
  const title = t('clients.push.title');

  const input = el('input', {
    type: 'checkbox', role: 'switch', 'aria-label': title, 'aria-describedby': 'clients-push-sub',
  });
  input.checked = state.on;
  input.disabled = state.disabled;
  input.addEventListener('change', () => onPushSwitch(input));

  host.appendChild(el('div', { class: 'set-row' }, [
    el('span', { class: 'set-text' }, [
      el('span', { class: 'set-title' }, title),
      el('span', { class: 'set-sub', id: 'clients-push-sub' }, state.sub),
    ]),
    el('label', { class: 'set-switch' }, [input, el('span', { class: 'set-switch-track', 'aria-hidden': 'true' })]),
  ]));
}

// ⚠️ Runs from a real tap: browsers refuse a permission prompt nobody asked for. The
// switch is locked while it works, and the row is drawn again from what the phone says
// when it is done, so it never claims more than is true.
async function onPushSwitch(input) {
  const wanted = input.checked;
  // Offline the registration would wait for ever, or be reported as a phone that cannot do it.
  if (wanted && navigator.onLine === false) {
    input.checked = false;
    await alertDialog(t('calc.notSavedCheckYour'));
    return;
  }
  input.disabled = true;
  try {
    if (wanted) {
      const result = await enablePush();
      if (!result.ok) {
        input.checked = false;
        await alertDialog(supportText(result.reason));
      } else {
        flashPushSaved();
      }
    } else {
      await disablePush();
      flashPushSaved();
    }
  } catch (err) {
    console.error('Could not change the notification:', err);
    input.checked = !wanted;
    await alertDialog(t('calc.notSavedCheckYour'));
  }
  paintPushRow();
}

// ── The page ─────────────────────────────────────────────────────────────────
function openOrdersFromAddress() {
  if (location.hash === '#orders') openScreen();
}

let started = false;

function start() {
  initConfig(onConfig, { onlyClients: true });
  // No argument: the received-orders screen is read-only here (no «put in the calculator»
  // button). It also wires the Back button of the screen and the deadline door.
  initClientOrders();

  document.getElementById('open-clients-btn').addEventListener('click', openClients);
  document.getElementById('open-received-btn').addEventListener('click', openScreen);

  paintClientsDoor();
  paintPushRow();
  onLanguageChange(() => { paintClientsDoor(); paintPushRow(); });

  // A tap on a client-order notification lands here (js/sections.js pageWhenRefused). A
  // page that is already open is not reloaded by a change of fragment, hence the listener.
  openOrdersFromAddress();
  window.addEventListener('hashchange', openOrdersFromAddress);
}

onSession(session => {
  if (started || !session || session.status !== 'ready') return;
  // The gate is sending anybody else away: start nothing for them.
  if (!cardVisibleTo(session.location, session.canManage, 'clients', session.role)) return;
  started = true;
  start();
});
