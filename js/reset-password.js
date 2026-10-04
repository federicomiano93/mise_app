// reset-password.js — the page «Forgot your password?» lands on (reset-password.html).
//
// Firebase's own hosted page has one password box and a six-character floor. This page asks
// for the new password TWICE and applies the app's own rules (js/credentials.js), the same
// ones the invitation form uses.
//
// ⚠️ THE PAGE LOADS js/reset-password-boot.js, NOT THIS FILE. The boot file draws the card at
// once, hands every email action that is not `resetPassword` on to Firebase's own page, and
// loads this module dynamically so that ANY failure here (an old cached dictionary, a missing
// export, a rejected start) ends in that same hand-over instead of a blank page. So start()
// refuses to run — by throwing — when the files it sits beside are too old for it.
//
// ⚠️ THE CODE AND THE EMAIL NEVER LEAVE THIS PAGE: not into a URL, not into a log (P17), and
// sw.js never stores the page's address (it carries the code). Nothing here signs anybody in —
// confirmPasswordReset does not, and that stays.
//
// start() takes its collaborators as arguments (Firebase, the document, the location, the
// storage) so tests/reset-password.test.mjs can drive the whole page with fakes; the real wiring
// is the default. The pure helpers are exported for the same tests.

import { t, setLanguage, languageFromTag } from './i18n.js';
import { passwordProblem, confirmProblem, MIN_PASSWORD_LENGTH } from './credentials.js';

// What the link carries.
export function readAction(search) {
  const params = new URLSearchParams(String(search || ''));
  return {
    mode: params.get('mode') || '',
    code: params.get('oobCode') || '',
  };
}

// The interface language: the PHONE's, always (the owner's decision, 4 Oct 2026) — the same
// guess the sign-in screen makes, because nobody is inside a venue yet. Firebase's `lang=`
// parameter is ignored: it comes from the email template, which is written once, in English.
export function pickLanguage(phoneTag) {
  return languageFromTag(phoneTag);
}

// Which sentence a Firebase error code gets. The weak-password one is the app's own
// «make it longer» message, since the server's floor is lower than the app's.
export function errorKeyFor(code) {
  switch (code) {
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return 'reset.badLink';
    case 'auth/user-disabled':
    case 'auth/user-not-found':
      return 'reset.inactive';
    case 'auth/weak-password':
      return 'help.passwordTooShort';
    default:
      return 'reset.failed';
  }
}

// Every sentence this page needs. A dictionary older than the page lacks them, and t() answers
// with the key itself — which would be put on screen — so start() checks first.
export const REQUIRED_KEYS = Object.freeze([
  'reset.title', 'reset.for', 'reset.checking', 'reset.save', 'reset.saving', 'reset.done',
  'reset.openMise', 'reset.badLink', 'reset.inactive', 'reset.failed', 'reset.checkFailed',
  'reset.retry', 'auth.signIn', 'join.choosePassword', 'join.repeatPassword',
]);

// Remembers that THIS code has been used, for a reload after success (which would otherwise
// say «link expired»). The code is consumed and worthless by then; sessionStorage dies with
// the tab. A browser that refuses storage simply loses the nicety.
export const DONE_KEY = 'mise.resetDone';

function defaultStorage() {
  try { return globalThis.sessionStorage; } catch { return null; }
}

function remembered(storage, code) {
  try { return !!storage && storage.getItem(DONE_KEY) === code; } catch { return false; }
}

function remember(storage, code) {
  try { if (storage) storage.setItem(DONE_KEY, code); } catch { /* the page still says «done» */ }
}

export async function start({ fb, doc = document, loc = location, nav = navigator, storage = defaultStorage() } = {}) {
  const firebase = fb || await import('./firebase.js');
  const { code } = readAction(loc.search);
  setLanguage(pickLanguage(nav.language));

  if (typeof firebase.checkResetCode !== 'function' || typeof firebase.setNewPassword !== 'function') {
    throw new Error('reset page: this version of firebase.js cannot check a reset code');
  }
  if (REQUIRED_KEYS.some(key => t(key) === key)) {
    throw new Error('reset page: this version of the dictionary lacks its sentences');
  }

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const passwordBox = id => {
    const input = el('input', 'auth-input');
    input.type = 'password';
    input.autocomplete = 'new-password';
    input.id = id;
    return input;
  };
  const field = (form, id, labelText, input) => {
    const label = el('label', 'auth-label', labelText);
    label.htmlFor = id;
    input.id = id;
    form.append(label, input);
  };
  const openMiseLink = (text, primary) => {
    const link = el('a', primary ? 'auth-btn auth-btn-link' : 'auth-link', text);
    link.href = 'index.html';
    return link;
  };
  // A sentence that takes the cursor: tabindex -1 so focus() works on a paragraph, and a live
  // role so a screen reader says it.
  const message = (text, kind, role) => {
    const node = el('p', `auth-status auth-status--${kind}`, text);
    node.setAttribute('role', role);
    node.setAttribute('tabindex', '-1');
    return node;
  };

  if (firebase.isPreview) {
    try {
      const { showPreviewRibbon } = await import('./preview-ribbon.js');
      showPreviewRibbon();
    } catch { /* a ribbon is decoration */ }
  }

  const root = doc.getElementById('auth-gate');
  const card = el('div', 'auth-card');
  root.textContent = '';
  root.append(card);

  const show = (...nodes) => {
    card.textContent = '';
    card.append(el('h1', 'auth-title', 'Mise'), ...nodes);
  };

  // The «link not valid» state: the sentence and the way back to the sign-in page.
  const showBadLink = () => {
    const status = message(t('reset.badLink'), 'bad', 'alert');
    show(status, openMiseLink(t('auth.signIn'), false));
    status.focus();
  };

  const showDone = () => {
    const done = message(t('reset.done'), 'good', 'status');
    show(done, openMiseLink(t('reset.openMise'), true));
    done.focus();
  };

  if (!code) { showBadLink(); return; }
  if (remembered(storage, code)) { showDone(); return; }

  const showForm = email => {
    card.textContent = '';
    card.append(el('h1', 'auth-title', t('reset.title')));
    card.append(el('p', 'auth-sub', t('reset.for', { email })));

    // `reset-form` is what js/update-gate.js's BUSY_SELECTORS names: an update must not reload
    // the page under somebody typing a new password.
    const form = el('form', 'auth-form reset-form');
    form.noValidate = true;

    // The account's email, out of sight, so a password manager saves the new password under the
    // right username. Not focusable and hidden from assistive technology: it says nothing the
    // «For {email}» line above has not.
    const username = el('input', 'auth-hidden-username');
    username.type = 'text';
    username.autocomplete = 'username';
    username.value = email;
    username.readOnly = true;
    username.tabIndex = -1;
    username.setAttribute('aria-hidden', 'true');
    form.append(username);

    const password = passwordBox('reset-password');
    const password2 = passwordBox('reset-password2');
    field(form, 'reset-password', t('join.choosePassword', { n: MIN_PASSWORD_LENGTH }), password);
    field(form, 'reset-password2', t('join.repeatPassword'), password2);

    const submit = el('button', 'auth-btn', t('reset.save'));
    submit.type = 'submit';
    const status = el('p', 'auth-status');
    status.setAttribute('role', 'alert');
    form.append(submit, status);
    card.append(form);

    const setStatus = (text, kind = 'bad') => {
      status.textContent = text;
      status.className = `auth-status auth-status--${kind}`;
    };

    form.addEventListener('submit', async event => {
      event.preventDefault();
      // Every check runs before the network, and the first wrong box gets the cursor.
      const weak = passwordProblem(password.value, email);
      if (weak) { setStatus(weak); password.focus(); return; }
      const mismatch = confirmProblem(password.value, password2.value);
      if (mismatch) { setStatus(mismatch); password2.focus(); return; }

      submit.disabled = true;
      setStatus(t('reset.saving'), 'busy');
      try {
        await firebase.setNewPassword(code, password.value);
      } catch (err) {
        const key = errorKeyFor(err && err.code);
        if (key === 'reset.badLink') { showBadLink(); return; }
        setStatus(t(key, { n: MIN_PASSWORD_LENGTH }));
        submit.disabled = false;
        return;
      }
      remember(storage, code);
      showDone();
    });

    password.focus();
  };

  // Asking Firebase whether the code is still good. A failure that is the connection's, not the
  // link's, gets its own sentence and a way to ask again — never the «could not save» wording.
  const check = async () => {
    show(el('p', 'auth-sub', t('reset.checking')));
    let email;
    try {
      email = await firebase.checkResetCode(code);
    } catch (err) {
      const key = errorKeyFor(err && err.code);
      if (key === 'reset.badLink') { showBadLink(); return; }
      if (key === 'reset.inactive') {
        const inactive = message(t('reset.inactive'), 'bad', 'alert');
        show(inactive, openMiseLink(t('auth.signIn'), false));
        inactive.focus();
        return;
      }
      const failure = message(t('reset.checkFailed'), 'bad', 'alert');
      const retry = el('button', 'auth-btn', t('reset.retry'));
      retry.type = 'button';
      retry.addEventListener('click', check);
      show(failure, retry, openMiseLink(t('auth.signIn'), false));
      failure.focus();
      return;
    }
    showForm(email);
  };

  await check();
}
