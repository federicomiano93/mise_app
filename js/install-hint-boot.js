// install-hint-boot.js — the Home-only wiring for js/install-hint.js.
//
// ⚠️ THE HOME ONLY, like js/whats-new-boot.js and js/install-version-boot.js, and for
// the same reason: this is the screen somebody arrives on, not one they are working
// in. A dialog that appears while an order is being typed interrupts the one thing
// the app exists for. Somebody who has just joined lands here anyway.
//
// ⚠️ THE THREE WAITS BELOW ARE COPIED FROM js/install-version-boot.js DELIBERATELY,
// NOT IMPORTED. That file says why in its own words: these are independent Home
// features and none of them should be able to break the others. The reasoning behind
// each wait is kept with it, because a wait whose reason lives in another file is a
// wait somebody deletes.

import { t } from './i18n.js';
import { confirmDialog } from './confirm-dialog.js';
import { onSession } from './firebase.js';
import { checkInstallHint } from './install-hint.js';

// ⚠️ WAIT FOR A LOCATION TO BE OPEN BEFORE SAYING ANYTHING. js/auth-gate.js marks
// every other child of <body> `inert` while the sign-in cover is up, so a dialog
// opened before then is drawn normally, receives nothing, and sits between the person
// and the sign-in form — the fault reported from a phone in v1.53.2 ("it looks like it
// starts and it doesn't, the button will not click").
function afterSignIn() {
  return new Promise(resolve => {
    let settled = false;
    const unsubscribe = onSession(session => {
      if (settled || session.status !== 'ready') return;
      settled = true;
      resolve();
    });
    if (settled) unsubscribe();
    else queueMicrotask(() => { if (settled) unsubscribe(); });
  });
}

// The splash sits at z-index 9999 and the dialog at 10000, so showing straight away
// would put the notice on top of the logo. boot.js REMOVES the splash once it has
// faded, so that removal is the signal rather than a guessed delay.
function afterSplash() {
  return new Promise(resolve => {
    if (!document.getElementById('splash')) return resolve();
    const stop = () => { observer.disconnect(); clearTimeout(cap); resolve(); };
    const observer = new MutationObserver(() => {
      if (!document.getElementById('splash')) stop();
    });
    const cap = setTimeout(stop, 5000);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// ⚠️ AND WAIT FOR ANY OTHER DIALOG TO CLOSE. Two dialogs at once is one dialog
// covering another, and whichever is underneath is read by nobody. It waits rather
// than skipping: this is the only moment this will ever be said to this person.
function afterAnyOtherDialog() {
  return new Promise(resolve => {
    const open = () => document.querySelector('.app-dialog');
    if (!open()) return resolve();
    const stop = () => { observer.disconnect(); clearTimeout(cap); resolve(); };
    const observer = new MutationObserver(() => { if (!open()) stop(); });
    const cap = setTimeout(stop, 120000);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function run() {
  let result;
  try {
    result = checkInstallHint({
      storage: localStorage,
      // ⚠️ BOTH TESTS, because they disagree by platform: Chromium answers the media
      // query, iOS Safari sets navigator.standalone and nothing else.
      standalone: window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true,
    });
  } catch {
    return;   // ⚠️ never let this stop the Home from working
  }
  if (!result.offer) return;

  await afterSignIn();
  await afterSplash();
  await afterAnyOtherDialog();

  // Spent HERE, before the dialog rather than after: closing the app while it is open
  // would otherwise re-show it for ever. Same reasoning, same order, as
  // js/install-version-boot.js.
  result.adopt();

  const show = await confirmDialog({
    title: t('install.hint.title'),
    message: t('install.hint.body'),
    okLabel: t('install.hint.ok'),
    cancelLabel: t('install.hint.later'),
  });
  // ⚠️ A NAVIGATION, NOT A SECOND DIALOG. The guide is a whole page with pictures for
  // both kinds of phone; reprinting a paragraph of it here would be the one version
  // nobody maintains. install-guide.html carries its own way back.
  if (show) window.location.href = 'install-guide.html';
}

run();
